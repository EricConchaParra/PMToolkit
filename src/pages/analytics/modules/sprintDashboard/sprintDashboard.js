/**
 * PMsToolKit — Analytics Hub
 * Sprint Dashboard controller — data loading, state management, GitHub PR enrichment
 */

import { NoteDrawer } from '../../../../content/jira/ui/NoteDrawer.js';
import { getTrackingItems } from '../../../../common/trackingRepository.js';
import {
    TAG_DEFS_STORAGE_KEY,
    TRACKING_UPDATED_EVENT,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagsStorageKey,
    getTagObjects,
    hasTrackingStorageChange,
    matchesTagFilter,
    normalizeTagLabel,
    parseTrackingStorage,
} from '../../../../common/tagging.js';
import {
    fetchBoardConfiguration,
    fetchBoardId,
    fetchClosedSprints, fetchSprintDoneIssues, fetchSpFieldId,
    fetchSprintIssues,
    jiraFetch,
} from '../jiraApi.js';
import { createBoardFlow, resolveCurrentBoardColumnSince, resolveIssueBoardColumn } from '../boardFlow.js';
import { fetchIssueTimeline } from '../issueTimeline.js';
import { workingHoursBetween, formatDate, escapeHtml } from '../utils.js';
import { buildIssueTrackingViewModel, renderDevCard, renderReadOnlyTags } from './devCard.js';
import { renderSprintOverview } from './sprintOverview.js';
import { getDashVisibilityState } from './dashVisibility.js';
import { enrichChips, clearPrCache } from '../githubPrCache.js';
import { getActiveView } from '../nav.js';
import { getGithubAvailabilityState, subscribeGithubAvailability } from '../githubPrSnapshotStore.js';
import { logAnalyticsPerf, markAnalyticsPerf, measureAnalyticsPerf } from '../analyticsPerf.js';

// ============================================================
// MODULE STATE
// ============================================================

// Internal mutable state — accessed via getters/setters
let _currentBoardId = null;
let _currentSprints = [];
let _selectedSprintId = null;
let _host = null;
let _spFieldId = null;
let _settings = null;
let _boardFlow = null;
let _github = { enabled: false, token: '' };
let _viewListenerBound = false;
let _githubListenerBound = false;
let _trackingListenerBound = false;
let _trackingEventListenerBound = false;
let _loadRequestId = 0;
let _currentProjectKey = '';
let _githubForceRefresh = false;
let _currentSprint = null;
let _trackingReloadTimer = null;
let _currentIssues = [];
let _selectedTagFilter = '';
let _velocityByAssignee = {};
let _tagFilterListenerBound = false;
let _demoMode = false;
let _recentDirectTrackingUpdates = new Map();
let _trackingState = {
    notesMap: {},
    remindersMap: {},
    tagsMap: {},
    tagDefs: {},
};

const ANY_TAG_FILTER_VALUE = '__any_tag__';
const TRACKING_STORAGE_REFRESH_DELAY_MS = 120;
const DIRECT_TRACKING_STORAGE_SUPPRESS_MS = 1500;

export function getCurrentSprints() { return _currentSprints; }
export function getSelectedSprintId() { return _selectedSprintId; }
export function setSelectedSprintId(id) { _selectedSprintId = id; }
export function setHost(h) { _host = h; }
export function setSpFieldId(id) { _spFieldId = id; }
export function setSettings(s) { _settings = s; }
export function getSpFieldId() { return _spFieldId; }
export function setDemoMode(enabled) { _demoMode = enabled === true; }

async function loadGithubSettings() {
    if (_demoMode) {
        _github = { enabled: false, token: '' };
        return _github;
    }
    if (!(typeof chrome !== 'undefined' && chrome.storage)) {
        _github = { enabled: false, token: '' };
        return _github;
    }

    const stored = await new Promise(resolve =>
        chrome.storage.sync.get({ github_pr_link: false, github_pat: '' }, resolve)
    );
    _github = {
        enabled: stored.github_pr_link === true && !!stored.github_pat,
        token: stored.github_pat || '',
    };
    return _github;
}

function renderGithubStatus() {
    const badge = document.getElementById('dash-gh-status');
    if (!badge) return;

    const availability = getGithubAvailabilityState();
    if (!_github.enabled) {
        badge.textContent = 'GitHub PR signals OFF';
        badge.className = 'fu-data-pill is-muted';
        badge.title = '';
        return;
    }

    if (availability.blocked) {
        badge.textContent = formatGithubAvailabilityReason(availability);
        badge.className = 'fu-data-pill is-warning';
        badge.title = formatGithubAvailabilityReason(availability);
        return;
    }

    badge.textContent = 'GitHub PR signals ON';
    badge.className = 'fu-data-pill is-success';
    badge.title = '';
}

async function enrichCurrentSprintView() {
    const grid = document.getElementById('dev-cards-grid');
    if (!grid || getActiveView() !== 'sprint-dashboard') return;

    await loadGithubSettings();
    renderGithubStatus();
    if (!_github.enabled || !_github.token) return;

    enrichChips(grid, _github.token, {
        onStateChange: renderGithubStatus,
        repos: _settings?.githubRepos || [],
        allowGlobalFallback: true,
        forceRefresh: _githubForceRefresh === true,
        repoConcurrency: 1,
    });
    _githubForceRefresh = false;
}

function formatGithubAvailabilityReason(availability) {
    if (!availability?.blocked) return '';
    if (availability.retryAt) {
        const remainingMs = Math.max(0, availability.retryAt - Date.now());
        const minutes = Math.ceil(remainingMs / (60 * 1000));
        const suffix = minutes <= 1 ? 'retrying in <1m' : minutes < 60 ? `retrying in ${minutes}m` : `retrying at ${new Date(availability.retryAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
        return `${availability.reason} · ${suffix}`;
    }
    return availability.reason || '';
}

function bindSprintViewListener() {
    if (_viewListenerBound) return;
    document.addEventListener('analytics:viewchange', event => {
        if (event.detail?.view === 'sprint-dashboard') {
            enrichCurrentSprintView();
        }
    });
    _viewListenerBound = true;
}

function bindGithubAvailabilityListener() {
    if (_githubListenerBound) return;
    let wasBlocked = false;

    subscribeGithubAvailability(availability => {
        renderGithubStatus();
        if (
            wasBlocked
            && availability.blocked === false
            && getActiveView() === 'sprint-dashboard'
            && _github.enabled
            && _github.token
        ) {
            void enrichCurrentSprintView();
        }
        wasBlocked = availability.blocked === true;
    });

    _githubListenerBound = true;
}

async function loadSprintTrackingState(issues = []) {
    if (!issues.length) {
        _trackingState = { notesMap: {}, remindersMap: {}, tagsMap: {}, tagDefs: {} };
        return _trackingState;
    }

    const storageKeys = [TAG_DEFS_STORAGE_KEY];
    issues.forEach(issue => {
        storageKeys.push(getNotesStorageKey(issue.key));
        storageKeys.push(getReminderStorageKey(issue.key));
        storageKeys.push(getTagsStorageKey(issue.key));
    });

    const stored = await getTrackingItems(storageKeys, { demoMode: _demoMode });
    _trackingState = buildSprintTrackingState(stored);
    return _trackingState;
}

export function buildSprintTrackingState(stored = {}) {
    const parsed = parseTrackingStorage(stored, { activeRemindersOnly: false });
    return {
        notesMap: parsed.notesMap,
        remindersMap: parsed.remindersMap,
        tagsMap: parsed.tagsMap,
        tagDefs: parsed.tagDefs,
    };
}

export function buildSprintTagFilterOptions(issues = [], tracking = {}) {
    const tagMap = new Map();

    (Array.isArray(issues) ? issues : []).forEach(issue => {
        getTagObjects(tracking.tagsMap?.[issue.key] || [], tracking.tagDefs || {}).forEach(tag => {
            if (!tagMap.has(tag.normalized)) {
                tagMap.set(tag.normalized, tag.label);
            }
        });
    });

    const options = Array.from(tagMap.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label));

    return [
        { value: '', label: 'No Filter' },
        { value: ANY_TAG_FILTER_VALUE, label: 'Any Tag' },
        ...options,
    ];
}

export function filterSprintIssuesByTag(issues = [], selectedTag = '', tracking = {}) {
    if (selectedTag === ANY_TAG_FILTER_VALUE) {
        return (Array.isArray(issues) ? issues : []).filter(issue =>
            (tracking.tagsMap?.[issue.key] || []).length > 0
        );
    }

    const normalizedSelectedTag = normalizeTagLabel(selectedTag);
    if (!normalizedSelectedTag) return Array.isArray(issues) ? issues.slice() : [];

    return (Array.isArray(issues) ? issues : []).filter(issue =>
        matchesTagFilter(tracking.tagsMap?.[issue.key] || [], [normalizedSelectedTag])
    );
}

export function normalizeTrackingEventDetail(detail = {}) {
    const noteText = String(detail.noteText || '').trim();
    const tagLabels = Array.isArray(detail.tagLabels)
        ? detail.tagLabels.filter(label => String(label || '').trim())
        : [];
    const tagDefs = detail.tagDefs && typeof detail.tagDefs === 'object'
        ? detail.tagDefs
        : null;
    const reminderTs = Number(detail.reminderTs ?? (detail.reminderValue ? new Date(detail.reminderValue).getTime() : 0));

    return {
        noteText,
        tagLabels,
        tagDefs,
        reminderTs: Number.isFinite(reminderTs) && reminderTs > 0 ? reminderTs : null,
    };
}

export function applyTrackingEventToState(issueKey, detail = {}, trackingState = _trackingState) {
    const normalizedIssueKey = String(issueKey || '').split(':').pop();
    if (!normalizedIssueKey || !trackingState) return trackingState;

    const { noteText, tagLabels, tagDefs, reminderTs } = normalizeTrackingEventDetail(detail);

    if (noteText) trackingState.notesMap[normalizedIssueKey] = noteText;
    else delete trackingState.notesMap[normalizedIssueKey];

    if (reminderTs) trackingState.remindersMap[normalizedIssueKey] = reminderTs;
    else delete trackingState.remindersMap[normalizedIssueKey];

    if (tagLabels.length) trackingState.tagsMap[normalizedIssueKey] = tagLabels;
    else delete trackingState.tagsMap[normalizedIssueKey];

    if (tagDefs) {
        trackingState.tagDefs = {
            ...trackingState.tagDefs,
            ...tagDefs,
        };
    }

    return trackingState;
}

function cloneTrackingState(tracking = {}) {
    return {
        notesMap: { ...(tracking.notesMap || {}) },
        remindersMap: { ...(tracking.remindersMap || {}) },
        tagsMap: { ...(tracking.tagsMap || {}) },
        tagDefs: { ...(tracking.tagDefs || {}) },
    };
}

function areTagFilterOptionsEqual(left = [], right = []) {
    if (left.length !== right.length) return false;

    return left.every((option, index) =>
        option.value === right[index]?.value && option.label === right[index]?.label
    );
}

export function getSprintTrackingUpdatePlan({
    issueKey,
    issues = [],
    selectedTagFilter = '',
    previousTracking = {},
    nextTracking = {},
} = {}) {
    const normalizedIssueKey = String(issueKey || '').split(':').pop();
    const previousOptions = buildSprintTagFilterOptions(issues, previousTracking);
    const nextOptions = buildSprintTagFilterOptions(issues, nextTracking);
    const previousVisible = new Set(
        filterSprintIssuesByTag(issues, selectedTagFilter, previousTracking).map(issue => issue.key)
    );
    const nextVisible = new Set(
        filterSprintIssuesByTag(issues, selectedTagFilter, nextTracking).map(issue => issue.key)
    );
    const normalizedFilter = selectedTagFilter === ANY_TAG_FILTER_VALUE
        ? ANY_TAG_FILTER_VALUE
        : normalizeTagLabel(selectedTagFilter);
    const selectionExistedBefore = normalizedFilter
        ? previousOptions.some(option => option.value === normalizedFilter)
        : false;
    const selectionExistsAfter = normalizedFilter
        ? nextOptions.some(option => option.value === normalizedFilter)
        : false;
    const visibilityChanged = normalizedIssueKey
        ? previousVisible.has(normalizedIssueKey) !== nextVisible.has(normalizedIssueKey)
        : false;
    const selectionInvalidated = Boolean(normalizedFilter
        && normalizedFilter !== ANY_TAG_FILTER_VALUE
        && selectionExistedBefore
        && !selectionExistsAfter);

    return {
        rerenderTagFilter: !areTagFilterOptionsEqual(previousOptions, nextOptions),
        rerenderDashboard: visibilityChanged || selectionInvalidated,
        issueVisibleAfter: normalizedIssueKey ? nextVisible.has(normalizedIssueKey) : false,
    };
}

export function getTrackingStorageChangeIssueKeys(changes = {}) {
    const issueKeys = new Set();

    Object.keys(changes || {}).forEach(key => {
        const match = key.match(/^(?:notes|reminder|tags)_jira:(.+)$/);
        if (match?.[1]) issueKeys.add(match[1]);
    });

    return issueKeys;
}

function pruneRecentDirectTrackingUpdates(now = Date.now()) {
    _recentDirectTrackingUpdates.forEach((expiresAt, issueKey) => {
        if (expiresAt <= now) _recentDirectTrackingUpdates.delete(issueKey);
    });
}

export function shouldSuppressTrackingStorageRefresh(changes = {}, recentUpdates = _recentDirectTrackingUpdates, now = Date.now()) {
    const issueKeys = getTrackingStorageChangeIssueKeys(changes);
    if (!issueKeys.size) return false;

    for (const issueKey of issueKeys) {
        if ((recentUpdates.get(issueKey) || 0) <= now) return false;
    }

    return true;
}

function renderSprintTagFilter(issues = _currentIssues, tracking = _trackingState) {
    const select = document.getElementById('sprint-tag-filter');
    if (!select) return [{ value: '', label: 'No Filter' }];

    const options = buildSprintTagFilterOptions(issues, tracking);
    const optionValues = new Set(options.map(option => option.value));
    const normalizedSelection = _selectedTagFilter === ANY_TAG_FILTER_VALUE
        ? ANY_TAG_FILTER_VALUE
        : normalizeTagLabel(_selectedTagFilter);

    if (!optionValues.has(normalizedSelection)) {
        _selectedTagFilter = '';
    } else {
        _selectedTagFilter = normalizedSelection;
    }

    select.innerHTML = options.map(option => `
        <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
    `).join('');
    select.value = _selectedTagFilter;
    select.disabled = options.length <= 1;
    select.title = options.length <= 1
        ? 'No tags found in this sprint'
        : 'Filter sprint issues by tag';

    return options;
}

function applyIncrementalTrackingUpdate(issueKey, detail = {}) {
    if (!_currentIssues.length) return;

    const normalizedIssueKey = String(issueKey || '').split(':').pop();
    if (!normalizedIssueKey) return;

    clearTimeout(_trackingReloadTimer);
    pruneRecentDirectTrackingUpdates();
    _recentDirectTrackingUpdates.set(
        normalizedIssueKey,
        Date.now() + DIRECT_TRACKING_STORAGE_SUPPRESS_MS
    );

    const previousTracking = cloneTrackingState(_trackingState);
    applyTrackingEventToState(normalizedIssueKey, detail, _trackingState);

    const updatePlan = getSprintTrackingUpdatePlan({
        issueKey: normalizedIssueKey,
        issues: _currentIssues,
        selectedTagFilter: _selectedTagFilter,
        previousTracking,
        nextTracking: _trackingState,
    });

    if (updatePlan.rerenderTagFilter) {
        renderSprintTagFilter(_currentIssues, _trackingState);
    }

    if (updatePlan.rerenderDashboard) {
        renderCurrentSprintDashboard();
        return;
    }

    document
        .querySelectorAll(`.issue-chip[data-gh-key="${normalizedIssueKey}"]`)
        .forEach(updateSprintTrackingChip);
}

function getVelocity(accountId) {
    const spList = _velocityByAssignee[accountId] || [];
    if (spList.length === 0) return { avg: 0, sprints: [], trend: 'same' };

    const total = spList.reduce((sum, sprint) => sum + sprint.sp, 0);
    const avg = Math.round((total / spList.length) * 10) / 10;
    let trend = 'same';
    if (spList.length >= 2) {
        const last = spList[spList.length - 1].sp;
        const prev = spList[spList.length - 2].sp;
        trend = last > prev ? 'up' : last < prev ? 'down' : 'same';
    }

    return { avg, sprints: spList, trend };
}

function renderCurrentSprintDashboard() {
    if (!_currentSprint || !_boardFlow) return;

    const grid = document.getElementById('dev-cards-grid');
    if (!grid) return;

    const filterOptions = renderSprintTagFilter(_currentIssues, _trackingState);
    const visibleIssues = filterSprintIssuesByTag(_currentIssues, _selectedTagFilter, _trackingState);
    const selectedTagLabel = filterOptions.find(option => option.value === _selectedTagFilter)?.label || '';

    const devMap = {};
    visibleIssues.forEach(issue => {
        const key = issue.fields?.assignee?.accountId || 'unassigned';
        if (!devMap[key]) devMap[key] = { assignee: issue.fields?.assignee || null, issues: [] };
        devMap[key].issues.push(issue);
    });

    grid.innerHTML = '';

    const sortedDevs = Object.values(devMap).sort((left, right) => {
        const leftName = left.assignee?.displayName || 'Unassigned';
        const rightName = right.assignee?.displayName || 'Unassigned';
        return leftName.localeCompare(rightName);
    });

    for (const dev of sortedDevs) {
        const accountId = dev.assignee?.accountId || 'unassigned';
        const velocity = getVelocity(accountId);
        const card = renderDevCard(
            { assignee: dev.assignee, issues: dev.issues, velocity },
            _currentSprint.endDate,
            _settings,
            _host,
            _trackingState,
            _boardFlow
        );
        grid.appendChild(card);
    }

    if (!visibleIssues.length) {
        grid.innerHTML = `
            <div class="dash-filter-empty">
                No issues match the selected tag${selectedTagLabel ? `: ${escapeHtml(selectedTagLabel)}` : '.'}
            </div>
        `;
    }

    const devCount = Object.values(devMap).filter(dev => dev.assignee !== null).length;
    const totalCommittedSP = visibleIssues.reduce((sum, issue) => sum + (issue._sp || 0), 0);
    const teamVelAvg = Object.keys(devMap).reduce((sum, key) => {
        const accountId = devMap[key].assignee?.accountId || key;
        return sum + (getVelocity(accountId)?.avg || 0);
    }, 0);

    document.querySelectorAll('.prediction-velocity-hint').forEach(el => el.remove());
    renderSprintOverview(
        visibleIssues,
        _currentSprint,
        _settings,
        devCount,
        Math.round(teamVelAvg * 10) / 10,
        totalCommittedSP,
        _boardFlow
    );

    const overviewSubtitle = document.getElementById('overview-subtitle');
    if (overviewSubtitle && _selectedTagFilter) {
        overviewSubtitle.textContent = `${overviewSubtitle.textContent} · tag: ${selectedTagLabel}`;
    }

    renderGithubStatus();
    if (getActiveView() === 'sprint-dashboard') {
        void enrichCurrentSprintView();
    }
}

function bindTrackingStorageListener() {
    if (_demoMode) return;
    if (_trackingListenerBound || typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (!hasSprintTrackingStorageChange(changes)) return;
        if (!_currentIssues.length) return;
        pruneRecentDirectTrackingUpdates();
        if (shouldSuppressTrackingStorageRefresh(changes)) return;

        clearTimeout(_trackingReloadTimer);
        _trackingReloadTimer = setTimeout(() => {
            void refreshSprintTrackingChips();
        }, TRACKING_STORAGE_REFRESH_DELAY_MS);
    });

    _trackingListenerBound = true;
}

function bindTrackingEventListener() {
    if (_trackingEventListenerBound) return;

    document.addEventListener(TRACKING_UPDATED_EVENT, event => {
        const issueKey = String(event.detail?.issueKey || '').split(':').pop();
        if (!issueKey) return;
        if (!_currentIssues.some(issue => issue.key === issueKey)) return;

        applyIncrementalTrackingUpdate(issueKey, event.detail);
    });

    _trackingEventListenerBound = true;
}

export function hasSprintTrackingStorageChange(changes = {}) {
    return hasTrackingStorageChange(changes);
}

async function refreshSprintTrackingChips() {
    if (!_currentIssues.length) return;

    await loadSprintTrackingState(_currentIssues);

    renderCurrentSprintDashboard();
}

function bindTagFilterListener() {
    if (_tagFilterListenerBound) return;

    const select = document.getElementById('sprint-tag-filter');
    if (!select) return;

    select.addEventListener('change', event => {
        _selectedTagFilter = event.target.value === ANY_TAG_FILTER_VALUE
            ? ANY_TAG_FILTER_VALUE
            : normalizeTagLabel(event.target.value);
        renderCurrentSprintDashboard();
    });

    _tagFilterListenerBound = true;
}

function updateSprintTrackingChip(chip) {
    const issueKey = chip?.getAttribute('data-gh-key');
    if (!issueKey) return;

    const chipMain = chip.querySelector('.issue-chip-main');
    const existingNote = chipMain?.querySelector('.sprint-note-preview');
    const existingReminderRow = chipMain?.querySelector('.sprint-reminder-row');
    const existingRow = chipMain?.querySelector('.sprint-tag-row');
    const noteButton = chip.querySelector('.issue-chip-actions .et-notes-btn');
    const trackingModel = buildIssueTrackingViewModel(issueKey, _trackingState);
    const noteText = trackingModel.noteText;
    const tagHtml = renderReadOnlyTags(_trackingState.tagsMap[issueKey] || [], _trackingState.tagDefs);
    const hasTrackedItem = NoteDrawer.hasTrackedItem({
        noteText,
        reminderValue: trackingModel.reminderTs,
        tagLabels: _trackingState.tagsMap[issueKey] || [],
    });

    if (!chipMain) return;

    if (!noteText) {
        existingNote?.remove();
    } else if (existingNote) {
        existingNote.textContent = noteText;
        existingNote.title = noteText;
    } else {
        const noteEl = document.createElement('div');
        noteEl.className = 'sprint-note-preview';
        noteEl.textContent = noteText;
        noteEl.title = noteText;
        const summary = chipMain.querySelector('.issue-chip-summary');
        if (summary?.nextSibling) {
            chipMain.insertBefore(noteEl, summary.nextSibling);
        } else {
            chipMain.appendChild(noteEl);
        }
    }

    if (!trackingModel.reminderLabel) {
        existingReminderRow?.remove();
    } else {
        let row = existingReminderRow;
        let pill = row?.querySelector('.sprint-reminder-pill');

        if (!row) {
            row = document.createElement('div');
            row.className = 'sprint-reminder-row';
            pill = document.createElement('span');
            pill.className = 'sprint-reminder-pill';
            row.appendChild(pill);
            const anchor = chipMain.querySelector('.sprint-note-preview') || chipMain.querySelector('.issue-chip-summary');
            if (anchor?.nextSibling) {
                chipMain.insertBefore(row, anchor.nextSibling);
            } else {
                chipMain.appendChild(row);
            }
        }

        if (pill) {
            pill.className = 'sprint-reminder-pill';
            pill.textContent = `🔔 ${trackingModel.reminderLabel}`;
            pill.title = trackingModel.reminderTitle;
        }
    }

    if (!tagHtml) {
        existingRow?.remove();
    } else {
        let row = existingRow;
        if (!row) {
            row = document.createElement('div');
            row.className = 'sprint-tag-row';
            row.innerHTML = '<div class="et-tag-read-list sprint-tag-list"></div>';
            const anchor = chipMain.querySelector('.sprint-reminder-row')
                || chipMain.querySelector('.sprint-note-preview')
                || chipMain.querySelector('.issue-chip-summary');
            if (anchor?.nextSibling) {
                chipMain.insertBefore(row, anchor.nextSibling);
            } else {
                chipMain.appendChild(row);
            }
        }

        const list = row.querySelector('.sprint-tag-list');
        if (list) list.innerHTML = tagHtml;
    }

    if (noteButton) noteButton.classList.toggle('has-note', hasTrackedItem);
}

// ============================================================
// DASH STATE
// ============================================================

function setVisibility(el, isVisible) {
    el?.classList.toggle('hidden', !isVisible);
}

function isDashDataVisible() {
    return ['sprint-banner', 'sprint-overview', 'dev-cards-grid']
        .some(id => !document.getElementById(id)?.classList.contains('hidden'));
}

export function showDashState(state, msg = '') {
    const shell = document.getElementById('dash-content-shell');
    const errorText = document.getElementById('dash-error-text');
    const visibility = getDashVisibilityState(state, { hasVisibleData: isDashDataVisible() });

    if (msg && visibility.showError && errorText) {
        errorText.textContent = msg;
    }

    setVisibility(document.getElementById('dash-error'), visibility.showError);
    setVisibility(document.getElementById('dash-empty'), visibility.showEmpty);
    setVisibility(document.getElementById('dash-placeholder'), visibility.showPlaceholder);
    setVisibility(document.getElementById('dash-skeleton'), visibility.showSkeleton);
    setVisibility(document.getElementById('dash-reload-overlay'), visibility.showReloadOverlay);
    setVisibility(document.getElementById('sprint-banner'), visibility.showData);
    setVisibility(document.getElementById('sprint-overview'), visibility.showData);
    setVisibility(document.getElementById('dev-cards-grid'), visibility.showData);

    shell?.classList.toggle('is-loading-overlay', visibility.showReloadOverlay);
    if (shell) shell.setAttribute('aria-busy', visibility.isBusy ? 'true' : 'false');
}



export async function loadDashboard(projectKey) {
    if (!projectKey) { showDashState('placeholder'); return; }
    const requestId = ++_loadRequestId;
    _currentProjectKey = projectKey;
    _boardFlow = null;
    _velocityByAssignee = {};
    renderSprintTagFilter([], { notesMap: {}, remindersMap: {}, tagsMap: {}, tagDefs: {} });
    bindSprintViewListener();
    bindGithubAvailabilityListener();
    bindTrackingStorageListener();
    bindTrackingEventListener();
    bindTagFilterListener();
    showDashState('loading', 'Connecting to Jira...');
    markAnalyticsPerf(`sprint:${projectKey}:start`);

    try {
        const host = _host;
        const settings = _settings;

        if (!_spFieldId) {
            showDashState('loading', 'Detecting Story Points field...');
            _spFieldId = await fetchSpFieldId(host);
            if (requestId !== _loadRequestId) return;
        }

        showDashState('loading', 'Finding Scrum board...');
        const boardId = await fetchBoardId(host, projectKey);
        if (requestId !== _loadRequestId) return;
        _currentBoardId = boardId;
        if (!boardId) {
            showDashState('error', `No Scrum board found for project "${projectKey}". Make sure it has a Scrum board.`);
            document.getElementById('sprint-select-container').classList.add('hidden');
            return;
        }

        showDashState('loading', 'Loading Scrum board columns...');
        const boardConfig = await fetchBoardConfiguration(host, boardId);
        if (requestId !== _loadRequestId) return;
        _boardFlow = createBoardFlow(boardConfig);
        if (!_boardFlow.columns.length) {
            showDashState('error', 'Could not resolve Scrum board columns for this project.');
            document.getElementById('sprint-select-container').classList.add('hidden');
            return;
        }

        showDashState('loading', 'Fetching sprints...');
        let allSprints = [];
        let startAt = 0;
        while (true) {
            const data = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&startAt=${startAt}&maxResults=50`);
            if (requestId !== _loadRequestId) return;
            allSprints = allSprints.concat(data.values || []);
            if (data.isLast || (data.values || []).length === 0) break;
            startAt += data.values.length;
        }

        _currentSprints = allSprints.reverse();

        const sprintContainer = document.getElementById('sprint-select-container');
        if (_currentSprints.length === 0) {
            sprintContainer.classList.add('hidden');
            showDashState('empty');
            return;
        }

        sprintContainer.classList.remove('hidden');

        let activeSprint = _currentSprints.find(s => s.state === 'active');
        if (!activeSprint) activeSprint = _currentSprints[0];

        _selectedSprintId = activeSprint.id;
        const sprintSearch = document.getElementById('sprint-search');
        sprintSearch.value = `${activeSprint.state === 'active' ? '🟢 ' : ''}${activeSprint.name}`;

        loadDashboardForSprint(activeSprint, { requestId, projectKey });

    } catch (err) {
        console.error('PMsToolKit Dashboard:', err);
        showDashState('error', err.message || 'Unexpected error loading dashboard.');
        document.getElementById('sprint-select-container').classList.add('hidden');
    }
}

// ============================================================
// LOAD DASHBOARD FOR SPRINT (sprint selection → render)
// ============================================================

export async function loadDashboardForSprint(sprint, opts = {}) {
    const requestId = opts.requestId || ++_loadRequestId;
    const projectKey = opts.projectKey || _currentProjectKey || 'unknown';
    showDashState('loading', 'Loading sprint details...');
    try {
        _currentSprint = sprint || null;
        const host = _host;
        const settings = _settings;
        const boardId = _currentBoardId;
        const boardFlow = _boardFlow;

        if (!sprint) {
            showDashState('empty');
            return;
        }

        if (!boardFlow) {
            showDashState('error', 'Scrum board configuration is unavailable for this project.');
            return;
        }

        // Ensure SP field is resolved
        if (!_spFieldId) {
            showDashState('loading', 'Detecting Story Points field...');
            _spFieldId = await fetchSpFieldId(host);
            if (requestId !== _loadRequestId) return;
        }

        // Sprint banner label
        const sprintStateLabelMap = { active: 'Active Sprint', closed: 'Closed Sprint', future: 'Future Sprint' };
        const sprintBannerLabel = document.querySelector('.sprint-banner .sprint-label');
        if (sprintBannerLabel) sprintBannerLabel.textContent = sprintStateLabelMap[sprint.state] || 'Sprint';

        // Sprint banner values
        const sprintStart = sprint.startDate ? formatDate(new Date(sprint.startDate)) : '—';
        const sprintEnd = sprint.endDate ? formatDate(new Date(sprint.endDate)) : '—';
        const daysLeft = sprint.endDate
            ? Math.max(0, Math.ceil((new Date(sprint.endDate) - new Date()) / (1000 * 60 * 60 * 24)))
            : '—';
        const hoursLeft = sprint.endDate
            ? workingHoursBetween(new Date(), new Date(sprint.endDate), settings.hoursPerDay)
            : null;

        document.getElementById('sprint-name').textContent = sprint.name;
        document.getElementById('sprint-start').textContent = sprintStart;
        document.getElementById('sprint-end').textContent = sprintEnd;
        document.getElementById('sprint-days-left').textContent = typeof daysLeft === 'number' ? `${daysLeft}d` : '—';
        document.getElementById('sprint-hours-left').textContent = hoursLeft !== null ? `${hoursLeft.toFixed(1)}h` : '—';

        showDashState('loading', 'Fetching sprint issues...');
        const issues = await fetchSprintIssues(host, sprint.id, _spFieldId);
        if (requestId !== _loadRequestId) return;
        _currentIssues = issues;

        if (issues.length === 0) {
            _velocityByAssignee = {};
            _trackingState = { notesMap: {}, remindersMap: {}, tagsMap: {}, tagDefs: {} };
            renderSprintTagFilter([], _trackingState);
            showDashState('empty');
            return;
        }

        // Attach SP to each issue
        issues.forEach(i => {
            i._sp = _spFieldId ? (Number(i.fields?.[_spFieldId]) || 0) : 0;
        });

        await loadSprintTrackingState(issues);
        if (requestId !== _loadRequestId) return;

        showDashState('loading', 'Checking board column durations...');
        const activeIssues = issues.filter(issue => resolveIssueBoardColumn(issue, boardFlow)?.isDone !== true);

        const CONCURRENCY = 4;
        for (let i = 0; i < activeIssues.length; i += CONCURRENCY) {
            const batch = activeIssues.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async issue => {
                const timeline = await fetchIssueTimeline(host, issue.key).catch(() => null);
                issue._timeline = timeline;
                issue._currentBoardColumnSince = timeline?.statusChanges?.length
                    ? resolveCurrentBoardColumnSince(issue, timeline.statusChanges, boardFlow)
                    : issue.fields?.updated || null;
            }));
            if (requestId !== _loadRequestId) return;
        }

        // Fetch velocity: last 3 closed sprints
        showDashState('loading', 'Calculating velocity...');
        const closedSprints = await fetchClosedSprints(host, boardId, 3).catch(() => []);

        const velocityByDev = {};
        for (const cs of closedSprints) {
            const doneIssues = await fetchSprintDoneIssues(host, cs.id, _spFieldId).catch(() => []);
            if (requestId !== _loadRequestId) return;
            doneIssues.forEach(i => {
                const key = i.fields?.assignee?.accountId || 'unassigned';
                const sp = Number(i.fields?.[_spFieldId] || 0);
                if (!velocityByDev[key]) velocityByDev[key] = [];
                const existing = velocityByDev[key].find(x => x.sprintId === cs.id);
                if (existing) existing.sp += sp;
                else velocityByDev[key].push({ sprintId: cs.id, name: cs.name, sp });
            });
        }

        _velocityByAssignee = velocityByDev;
        showDashState('data');
        renderCurrentSprintDashboard();
        markAnalyticsPerf(`sprint:${projectKey}:base`);
        measureAnalyticsPerf(`sprint:${projectKey}:base`, `sprint:${projectKey}:start`, `sprint:${projectKey}:base`, {
            sprintId: sprint.id,
            issueCount: issues.length,
            inProgressCount: activeIssues.length,
        });

        // Event delegation — copy-for-Slack + Notes
        const grid = document.getElementById('dev-cards-grid');
        if (!grid.dataset.delegated) {
            grid.addEventListener('click', (e) => {
                const copyBtn = e.target.closest('.overdue-copy-btn');
                if (copyBtn) {
                    if (copyBtn.dataset.isCopying) return;
                    copyBtn.dataset.isCopying = 'true';

                    const { key, summary, url } = copyBtn.dataset;
                    const plainText = `${key} ${summary}\n${url}`;
                    const htmlLink = `<a href="${url}">${key} ${summary}</a>`;
                    const orig = copyBtn.textContent;

                    try {
                        navigator.clipboard.write([
                            new ClipboardItem({
                                'text/plain': new Blob([plainText], { type: 'text/plain' }),
                                'text/html': new Blob([htmlLink], { type: 'text/html' }),
                            })
                        ]).then(() => {
                            copyBtn.textContent = '✅';
                            copyBtn.style.color = '#36b37e';
                            setTimeout(() => {
                                copyBtn.textContent = orig;
                                copyBtn.style.color = '';
                                delete copyBtn.dataset.isCopying;
                            }, 1500);
                        }).catch(() => {
                            navigator.clipboard.writeText(plainText).then(() => {
                                copyBtn.textContent = '✅';
                                copyBtn.style.color = '#36b37e';
                                setTimeout(() => {
                                    copyBtn.textContent = orig;
                                    copyBtn.style.color = '';
                                    delete copyBtn.dataset.isCopying;
                                }, 1500);
                            }).catch(() => {
                                delete copyBtn.dataset.isCopying;
                            });
                        });
                    } catch {
                        navigator.clipboard.writeText(plainText).then(() => {
                            copyBtn.textContent = '✅';
                            copyBtn.style.color = '#36b37e';
                            setTimeout(() => {
                                copyBtn.textContent = orig;
                                copyBtn.style.color = '';
                                delete copyBtn.dataset.isCopying;
                            }, 1500);
                        }).catch(() => {
                            delete copyBtn.dataset.isCopying;
                        });
                    }
                    return;
                }

                const notesBtn = e.target.closest('.et-notes-btn');
                if (notesBtn) {
                    if (_demoMode) return;
                    const { issueKey, summary } = notesBtn.dataset;
                    if (issueKey) NoteDrawer.open(issueKey, summary);
                    return;
                }
            }, { once: false });
            grid.dataset.delegated = 'true';
        }

        // Initialize note indicators
        if (!_demoMode) {
            NoteDrawer.initIndicators();
        }

    } catch (err) {
        console.error('PMsToolKit Dashboard:', err);
        showDashState('error', err.message || 'Unexpected error loading sprint.');
        logAnalyticsPerf('sprint:error', { projectKey, message: err?.message || 'unknown' });
    }
}

export function highlightEngineer(accountId) {
    const card = document.querySelector(`.dev-card[data-account-id="${accountId}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlight-pulse');
        setTimeout(() => card.classList.remove('highlight-pulse'), 3000);
    }
}

export function resetSprintGithubState() {
    clearPrCache();
    _githubForceRefresh = true;
    renderGithubStatus();
}

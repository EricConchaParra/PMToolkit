/**
 * PMsToolKit — Analytics Hub
 * Follow-up Work Dashboard — Sprint Control Tower
 */

import { storage, syncStorage } from '../../../../common/storage.js';
import { createTagEditor } from '../../../../common/tagEditor.js';
import {
    TAG_DEFS_STORAGE_KEY,
    escapeHtml,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagInlineStyle,
    getTagObjects,
    getTagsStorageKey,
    hasTrackingStorageChange,
    matchesTagFilter,
    parseTrackingStorage,
} from '../../../../common/tagging.js';
import { NoteDrawer } from '../../../../content/jira/ui/NoteDrawer.js';
import {
    fetchActiveSprint,
    fetchBoardId,
    fetchSprintIssues,
    fetchSpFieldId,
} from '../jiraApi.js';
import { formatDate, formatHours, timeSince, workingHoursBetween } from '../utils.js';
import { getInitialsOrImg } from '../sprintDashboard/devCard.js';
import { switchToView } from '../nav.js';
import { highlightEngineer } from '../sprintDashboard/sprintDashboard.js';
import {
    FOLLOWUP_SIGNAL_META,
    FOLLOWUP_STATE_META,
    buildFollowupItems,
    clearFollowupSessionCaches,
    fetchIssueTimeline,
    getFollowupMetaStorageKey,
    normalizeFollowupMeta,
    parseFollowupMetaStorage,
    resolvePrSnapshots,
} from './followupModel.js';

const FOLLOWUP_META_PREFIX = 'followup_meta_jira:';

const followupState = {
    projectKey: '',
    host: '',
    settings: {},
    sprintName: '',
    sprintHoursLeft: null,
    issues: [],
    timelinesByKey: {},
    prSnapshotsByKey: {},
    notesMap: {},
    alertsMap: {},
    tagsMap: {},
    tagDefs: {},
    followupMetaMap: {},
    items: [],
    selectedTagFilters: [],
    tagFilterEditor: null,
    github: {
        enabled: false,
        token: '',
    },
    filters: {
        assignee: 'all',
        signal: 'all',
        jiraStatus: 'all',
        pr: 'all',
        state: 'all',
        tracking: 'all',
        showDone: false,
    },
    storageListenerBound: false,
    storageReloadTimer: null,
    loadRequestId: 0,
};

function showFollowupState(state, msg = '') {
    ['fu-placeholder', 'fu-loading', 'fu-error', 'fu-content'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

    if (state === 'loading') {
        document.getElementById('fu-loading')?.classList.remove('hidden');
        const txt = document.getElementById('fu-loading-text');
        if (txt && msg) txt.textContent = msg;
    } else if (state === 'error') {
        document.getElementById('fu-error')?.classList.remove('hidden');
        const txt = document.getElementById('fu-error-text');
        if (txt && msg) txt.textContent = msg;
    } else if (state === 'placeholder') {
        document.getElementById('fu-placeholder')?.classList.remove('hidden');
    } else if (state === 'content') {
        document.getElementById('fu-content')?.classList.remove('hidden');
    }
}

async function loadFollowupStorage() {
    if (!followupState.issues.length) return;

    const storageKeys = [TAG_DEFS_STORAGE_KEY];
    followupState.issues.forEach(issue => {
        storageKeys.push(
            getNotesStorageKey(issue.key),
            getReminderStorageKey(issue.key),
            getTagsStorageKey(issue.key),
            getFollowupMetaStorageKey(issue.key),
        );
    });

    const stored = await storage.get(storageKeys);
    const parsed = parseTrackingStorage(stored, { activeRemindersOnly: false });

    followupState.notesMap = parsed.notesMap;
    followupState.alertsMap = parsed.remindersMap;
    followupState.tagsMap = parsed.tagsMap;
    followupState.tagDefs = parsed.tagDefs;
    followupState.followupMetaMap = parseFollowupMetaStorage(stored);
    followupState.tagFilterEditor?.setTagDefs(followupState.tagDefs);
}

function rebuildFollowupItems() {
    followupState.items = buildFollowupItems({
        issues: followupState.issues,
        timelinesByKey: followupState.timelinesByKey,
        prSnapshotsByKey: followupState.prSnapshotsByKey,
        notesMap: followupState.notesMap,
        remindersMap: followupState.alertsMap,
        tagsMap: followupState.tagsMap,
        followupMetaMap: followupState.followupMetaMap,
        settings: followupState.settings,
        sprintHoursLeft: followupState.sprintHoursLeft,
        prSignalsEnabled: followupState.github.enabled,
    });
}

async function refreshTrackingState() {
    if (!followupState.issues.length) return;
    await loadFollowupStorage();
    rebuildFollowupItems();
    renderFollowupDashboard();
}

export async function loadFollowupDashboard(projectKey, host, settings, opts = {}) {
    if (!projectKey || !host) return;

    const requestId = ++followupState.loadRequestId;
    const forceRefresh = opts.forceRefresh === true;

    followupState.projectKey = projectKey;
    followupState.host = host;
    followupState.settings = settings || {};

    if (forceRefresh) clearFollowupSessionCaches();

    showFollowupState('loading', 'Connecting to Jira...');

    try {
        showFollowupState('loading', 'Resolving Story Points field...');
        const spFieldId = await fetchSpFieldId(host);
        if (requestId !== followupState.loadRequestId) return;

        showFollowupState('loading', 'Finding Scrum board...');
        const boardId = await fetchBoardId(host, projectKey);
        if (requestId !== followupState.loadRequestId) return;

        if (!boardId) {
            showFollowupState('error', `No Scrum board found for "${projectKey}".`);
            return;
        }

        showFollowupState('loading', 'Finding active sprint...');
        const activeSprint = await fetchActiveSprint(host, boardId);
        if (requestId !== followupState.loadRequestId) return;

        if (!activeSprint) {
            showFollowupState('error', 'No active sprint found for this project.');
            return;
        }

        showFollowupState('loading', 'Fetching sprint issues...');
        const issues = await fetchSprintIssues(host, activeSprint.id, spFieldId);
        if (requestId !== followupState.loadRequestId) return;

        issues.forEach(issue => {
            issue._sp = spFieldId ? (Number(issue.fields?.[spFieldId]) || 0) : 0;
            issue._url = `https://${host}/browse/${issue.key}`;
        });

        followupState.issues = issues;
        followupState.timelinesByKey = {};
        followupState.prSnapshotsByKey = {};

        if (issues.length === 0) {
            followupState.sprintName = activeSprint.name || '';
            followupState.notesMap = {};
            followupState.alertsMap = {};
            followupState.tagsMap = {};
            followupState.followupMetaMap = {};
            followupState.items = [];
            renderFollowupDashboard();
            showFollowupState('content');
            return;
        }

        const hoursPerDay = followupState.settings.hoursPerDay || 9;
        const sprintEnd = activeSprint.endDate ? new Date(activeSprint.endDate) : null;
        followupState.sprintHoursLeft = sprintEnd ? workingHoursBetween(new Date(), sprintEnd, hoursPerDay) : null;
        followupState.sprintName = activeSprint.name || '';

        showFollowupState('loading', 'Building Jira timelines...');
        const timelinesByKey = {};
        const CONCURRENCY = 4;
        for (let index = 0; index < issues.length; index += CONCURRENCY) {
            if (requestId !== followupState.loadRequestId) return;

            const batch = issues.slice(index, index + CONCURRENCY);
            const timelines = await Promise.all(batch.map(issue => fetchIssueTimeline(host, issue.key)));
            timelines.forEach(timeline => {
                timelinesByKey[timeline.issueKey] = timeline;
            });
        }

        showFollowupState('loading', 'Loading GitHub PR context...');
        const ghSettings = await syncStorage.get({ github_pr_link: false, github_pat: '' });
        if (requestId !== followupState.loadRequestId) return;

        followupState.github = {
            enabled: ghSettings.github_pr_link === true && !!ghSettings.github_pat,
            token: ghSettings.github_pat || '',
        };

        let prSnapshotsByKey = {};
        if (followupState.github.enabled) {
            prSnapshotsByKey = await resolvePrSnapshots(issues.map(issue => issue.key), followupState.github.token);
            if (requestId !== followupState.loadRequestId) return;
        }

        followupState.timelinesByKey = timelinesByKey;
        followupState.prSnapshotsByKey = prSnapshotsByKey;

        showFollowupState('loading', 'Loading notes, reminders, tags, and follow-up state...');
        await refreshTrackingState();
        if (requestId !== followupState.loadRequestId) return;

        showFollowupState('content');
    } catch (err) {
        console.error('PMsToolKit Follow-up Dashboard:', err);
        showFollowupState('error', err.message || 'Unexpected error loading follow-up dashboard.');
    }
}

function renderFollowupDashboard() {
    showFollowupState('content');
    renderHeaderSummary();
    renderFilterControls();
    renderQueue();
    renderHotspots();
    renderSignalMix();
    NoteDrawer.initIndicators();
}

function renderHeaderSummary() {
    const activeItems = getActionableItems();
    const visibleItems = getVisibleItems();
    const nonDoneItems = activeItems.filter(item => !isDoneItem(item));

    setText('fu-sprint-name', followupState.sprintName || 'Active sprint');
    setText('fu-queue-count', String(visibleItems.length));
    setText('fu-kpi-total', String(nonDoneItems.length));
    setText('fu-kpi-blocked', String(nonDoneItems.filter(item => item.signals.includes('blocked')).length));
    setText('fu-kpi-needs-pr', String(nonDoneItems.filter(item => item.signals.includes('needs-pr')).length));
    setText('fu-kpi-frozen', String(nonDoneItems.filter(item => item.signals.includes('frozen')).length));

    const hoursLeft = document.getElementById('fu-sprint-hours');
    if (hoursLeft) {
        hoursLeft.textContent = followupState.sprintHoursLeft !== null
            ? `${followupState.sprintHoursLeft.toFixed(1)}h left in sprint`
            : 'Sprint capacity unavailable';
    }

    const ghStatus = document.getElementById('fu-gh-status');
    if (ghStatus) {
        ghStatus.textContent = followupState.github.enabled ? 'GitHub PR signals ON' : 'GitHub PR signals OFF';
        ghStatus.className = `fu-data-pill ${followupState.github.enabled ? 'is-success' : 'is-muted'}`;
    }

    const copyBtn = document.getElementById('fu-queue-copy-all');
    if (copyBtn) {
        if (visibleItems.length === 0) {
            copyBtn.classList.add('hidden');
            delete copyBtn.dataset.payload;
        } else {
            copyBtn.classList.remove('hidden');
            copyBtn.dataset.payload = JSON.stringify(visibleItems.map(item => ({
                key: item.key,
                summary: item.jira.summary,
                assignee: item.jira.assignee?.displayName || 'Unassigned',
                reason: item.reason,
                jiraUrl: item.jira.url,
                prUrl: item.pr?.url || '',
            })));
        }
    }
}

function renderFilterControls() {
    const assigneeSelect = document.getElementById('fu-assignee-filter');
    const signalSelect = document.getElementById('fu-signal-filter');
    const jiraStatusSelect = document.getElementById('fu-jira-status-filter');
    const prSelect = document.getElementById('fu-pr-filter');
    const stateSelect = document.getElementById('fu-state-filter');
    const trackingSelect = document.getElementById('fu-tracking-filter');
    const showDone = document.getElementById('fu-show-done-toggle');

    if (!assigneeSelect || !signalSelect || !jiraStatusSelect || !prSelect || !stateSelect || !trackingSelect || !showDone) return;

    const assigneeOptions = [{ value: 'all', label: 'All assignees' }].concat(
        Array.from(new Map(
            followupState.items.map(item => [
                item.jira.assigneeId,
                {
                    value: item.jira.assigneeId,
                    label: item.jira.assignee?.displayName || 'Unassigned',
                },
            ]),
        ).values()).sort((left, right) => left.label.localeCompare(right.label)),
    );

    const signalOptions = [{ value: 'all', label: 'All reasons' }].concat(
        Object.entries(FOLLOWUP_SIGNAL_META).map(([value, meta]) => ({ value, label: meta.label })),
    );

    const jiraStatusOptions = [{ value: 'all', label: 'All Jira statuses' }].concat(
        Array.from(new Map(
            followupState.items.map(item => [
                item.jira.statusName,
                {
                    value: item.jira.statusName,
                    label: item.jira.statusName || 'Unknown',
                },
            ]),
        ).values()).sort((left, right) => left.label.localeCompare(right.label)),
    );

    const prOptions = [
        { value: 'all', label: 'All PR states' },
        { value: 'missing', label: 'Missing PR' },
        { value: 'open', label: 'Open PR' },
        { value: 'draft', label: 'Draft PR' },
        { value: 'merged', label: 'Merged PR' },
        { value: 'stale', label: 'Stale PR' },
    ];

    const stateOptions = [{ value: 'all', label: 'Any status' }].concat(
        Object.entries(FOLLOWUP_STATE_META).map(([value, meta]) => ({ value, label: meta.label })),
    );

    const trackingOptions = [
        { value: 'all', label: 'All tracking' },
        { value: 'tracked', label: 'Tracked items' },
        { value: 'note', label: 'Has note' },
        { value: 'reminder', label: 'Has reminder' },
        { value: 'none', label: 'No note/reminder' },
    ];

    setSelectOptions(assigneeSelect, assigneeOptions, followupState.filters.assignee);
    setSelectOptions(signalSelect, signalOptions, followupState.filters.signal);
    setSelectOptions(jiraStatusSelect, jiraStatusOptions, followupState.filters.jiraStatus);
    setSelectOptions(prSelect, prOptions, followupState.filters.pr);
    setSelectOptions(stateSelect, stateOptions, followupState.filters.state);
    setSelectOptions(trackingSelect, trackingOptions, followupState.filters.tracking);
    showDone.checked = followupState.filters.showDone;
}

function renderQueue() {
    const queue = document.getElementById('fu-queue-list');
    const queueMeta = document.getElementById('fu-queue-meta');
    if (!queue || !queueMeta) return;

    const visibleItems = getVisibleItems();
    const totalActionable = getActionableItems().filter(item => !isDoneItem(item)).length;
    queueMeta.textContent = `${visibleItems.length} shown · ${totalActionable} actionable total`;

    if (visibleItems.length === 0) {
        queue.innerHTML = '<div class="fu-empty-state">No tickets match the active filters.</div>';
        return;
    }

    queue.innerHTML = visibleItems.map(renderQueueItem).join('');
}

function renderHotspots() {
    const list = document.getElementById('fu-hotspot-list');
    if (!list) return;

    const actionable = getActionableItems().filter(item => !isDoneItem(item));
    const hotspotMap = new Map();

    actionable.forEach(item => {
        const key = item.jira.assigneeId;
        if (!hotspotMap.has(key)) {
            hotspotMap.set(key, {
                assignee: item.jira.assignee || null,
                capacityPct: item.engineer?.capacityPct || 0,
                committedHours: item.engineer?.committedHours || 0,
                ticketsLeft: item.engineer?.ticketsLeft || 0,
                blockedCount: 0,
                frozenCount: 0,
                queueCount: 0,
            });
        }

        const entry = hotspotMap.get(key);
        entry.capacityPct = Math.max(entry.capacityPct, item.engineer?.capacityPct || 0);
        entry.committedHours = Math.max(entry.committedHours, item.engineer?.committedHours || 0);
        entry.ticketsLeft = Math.max(entry.ticketsLeft, item.engineer?.ticketsLeft || 0);
        entry.queueCount += 1;
        if (item.signals.includes('blocked')) entry.blockedCount += 1;
        if (item.signals.includes('frozen')) entry.frozenCount += 1;
    });

    const hotspots = Array.from(hotspotMap.values())
        .filter(entry => entry.capacityPct >= 100 || entry.blockedCount > 0 || entry.frozenCount > 0)
        .sort((left, right) => {
            if (left.capacityPct !== right.capacityPct) return right.capacityPct - left.capacityPct;
            if (left.blockedCount !== right.blockedCount) return right.blockedCount - left.blockedCount;
            return right.queueCount - left.queueCount;
        });

    if (hotspots.length === 0) {
        list.innerHTML = '<div class="fu-empty-state">No engineer hotspots right now.</div>';
        return;
    }

    list.innerHTML = hotspots.map(renderHotspotRow).join('');
}

function renderSignalMix() {
    const list = document.getElementById('fu-signal-summary');
    if (!list) return;

    const counts = {};
    getActionableItems().filter(item => !isDoneItem(item)).forEach(item => {
        counts[item.primarySignal] = (counts[item.primarySignal] || 0) + 1;
    });

    const summary = Object.entries(FOLLOWUP_SIGNAL_META)
        .map(([signal, meta]) => ({ signal, label: meta.label, count: counts[signal] || 0, tone: meta.tone }))
        .filter(entry => entry.count > 0);

    if (summary.length === 0) {
        list.innerHTML = '<div class="fu-empty-state">No active signals.</div>';
        return;
    }

    list.innerHTML = summary.map(entry => `
        <div class="fu-summary-row">
            <span class="fu-signal-chip fu-tone-${entry.tone}">${escapeHtml(entry.label)}</span>
            <span class="fu-summary-count">${entry.count}</span>
        </div>
    `).join('');
}

function renderQueueItem(item) {
    const { initials, imgUrl } = getInitialsOrImg(item.jira.assignee);
    const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${escapeHtml(item.jira.assignee?.displayName || '?')}">`
        : initials;

    const assigneeName = escapeHtml(item.jira.assignee?.displayName || 'Unassigned');
    const sectionClass = getSectionClass(item.jira.section);
    const primaryMeta = item.primarySignal ? FOLLOWUP_SIGNAL_META[item.primarySignal] : FOLLOWUP_SIGNAL_META['tracked-only'];
    const stateMeta = FOLLOWUP_STATE_META[item.tracking.state] || FOLLOWUP_STATE_META.default;
    const reminderHtml = item.tracking.reminderTs
        ? `<span class="fu-inline-meta ${item.tracking.reminderTs <= Date.now() ? 'is-warning' : ''}">🔔 ${escapeHtml(formatReminder(item.tracking.reminderTs))}</span>`
        : '';
    const prHtml = renderPrSummary(item);
    const tagHtml = renderReadOnlyTags(item.tracking.tags);

    return `
        <div class="issue-chip fu-ticket-row ${sectionClass} fu-tone-border-${primaryMeta.tone}" data-issue-key="${item.key}">
            <div class="issue-chip-main">
                <div class="fu-ticket-topline">
                    <div class="issue-chip-top">
                        <button class="fu-pin-btn ${item.tracking.pinned ? 'is-active' : ''}" data-issue-key="${item.key}" title="${item.tracking.pinned ? 'Unpin' : 'Pin'}">${item.tracking.pinned ? '★' : '☆'}</button>
                        <a class="issue-chip-key" href="${item.jira.url}" target="_blank" rel="noopener noreferrer">${item.key}</a>
                        <span class="issue-chip-status">${escapeHtml(item.jira.statusName || '?')}</span>
                        <span class="issue-chip-sp">${item.jira.sp ?? 0} SP</span>
                        <span class="fu-signal-chip fu-tone-${primaryMeta.tone}">${escapeHtml(primaryMeta.label)}</span>
                        ${item.tracking.state !== 'default' ? `<span class="fu-signal-chip fu-tone-${stateMeta.tone}">${escapeHtml(stateMeta.label)}</span>` : ''}
                    </div>
                    <div class="fu-ticket-age">
                        ${item.timeline.currentStatusSince ? `In status ${escapeHtml(formatHours(item.timeline.statusAgeHours || 0))}` : ''}
                    </div>
                </div>
                <div class="issue-chip-assignee">
                    <div class="dev-avatar issue-chip-avatar" title="${assigneeName}">${avatarHtml}</div>
                    <span class="issue-chip-assignee-name">${assigneeName}</span>
                    ${item.engineer ? `<span class="fu-inline-meta">Capacity ${item.engineer.capacityPct}%</span>` : ''}
                    ${reminderHtml}
                </div>
                <div class="issue-chip-summary" title="${escapeHtml(item.jira.summary || '')}">${escapeHtml(item.jira.summary || '')}</div>
                ${prHtml}
                ${item.tracking.noteText ? `<div class="fu-note-preview">${escapeHtml(item.tracking.notePreview)}</div>` : ''}
                <div class="fu-tag-row">
                    <div class="et-tag-read-list fu-tag-list">${tagHtml}</div>
                </div>
                <div class="fu-why-line">Why now: ${escapeHtml(item.reason || 'Tracked ticket')}</div>
                ${item.secondarySignals.length ? `<div class="fu-secondary-signals">${item.secondarySignals.map(signal => {
                    const meta = FOLLOWUP_SIGNAL_META[signal];
                    const reason = getSignalReason(item, signal);
                    return `<span class="fu-signal-chip fu-tone-${meta.tone}" title="${escapeHtml(reason)}">${escapeHtml(meta.label)}</span>`;
                }).join('')}</div>` : ''}
            </div>
            <div class="issue-chip-actions fu-ticket-actions">
                <button class="et-notes-btn" data-issue-key="${item.key}" data-summary="${escapeHtml(item.jira.summary || '')}" title="Notes">📝</button>
                <a class="fu-action-btn" href="${item.jira.url}" target="_blank" rel="noopener noreferrer">Jira</a>
                ${item.pr?.url
        ? `<a class="fu-action-btn" href="${item.pr.url}" target="_blank" rel="noopener noreferrer">PR</a>`
        : `<button class="fu-action-btn is-disabled" type="button" disabled>${followupState.github.enabled ? 'No PR' : 'PR Off'}</button>`}
                <select class="fu-state-select" data-issue-key="${item.key}" title="Follow-up">
                    ${Object.entries(FOLLOWUP_STATE_META).map(([value, meta]) => `
                        <option value="${value}" ${value === item.tracking.state ? 'selected' : ''}>${escapeHtml(meta.label)}</option>
                    `).join('')}
                </select>
                <button class="fu-action-btn fu-pin-toggle" type="button" data-issue-key="${item.key}">${item.tracking.pinned ? 'Unpin' : 'Pin'}</button>
                <button class="fu-action-btn fu-snooze-btn" type="button" data-issue-key="${item.key}" data-mode="4h">+4h</button>
                <button class="fu-action-btn fu-snooze-btn" type="button" data-issue-key="${item.key}" data-mode="tomorrow">9am</button>
            </div>
        </div>
    `;
}

function renderPrSummary(item) {
    if (!followupState.github.enabled) {
        return '<div class="fu-pr-row"><span class="fu-inline-meta is-muted">GitHub PR signals disabled in Settings</span></div>';
    }

    if (!item.pr) {
        return '<div class="fu-pr-row"><span class="fu-inline-meta is-warning">No PR linked yet</span></div>';
    }

    const prStateClass = item.pr.draft ? 'draft' : item.pr.state === 'open' ? 'open' : item.pr.state === 'merged' ? 'closed' : 'closed';
    const prStateLabel = item.pr.draft ? 'Draft PR' : item.pr.state === 'merged' ? 'Merged PR' : item.pr.state === 'open' ? 'Open PR' : 'Closed PR';
    const reviewers = item.pr.requestedReviewers.length
        ? `<span class="gh-pr-label">Reviewers: ${escapeHtml(item.pr.requestedReviewers.slice(0, 2).join(', '))}${item.pr.requestedReviewers.length > 2 ? ' +' : ''}</span>`
        : '';
    const reviewState = item.pr.lastReviewState
        ? `<span class="gh-pr-label">Last review: ${escapeHtml(item.pr.lastReviewState.toLowerCase().replace(/_/g, ' '))}</span>`
        : '';

    return `
        <div class="fu-pr-row">
            <a class="gh-pr-state gh-pr-state--${prStateClass}" href="${item.pr.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(prStateLabel)}</a>
            ${item.pr.repo ? `<span class="gh-pr-label">${escapeHtml(item.pr.repo)}</span>` : ''}
            ${item.pr.updatedAt ? `<span class="gh-pr-label">Updated ${escapeHtml(timeSince(item.pr.updatedAt))} ago</span>` : ''}
            ${reviewers}
            ${reviewState}
        </div>
    `;
}

function renderHotspotRow(engineer) {
    const { initials, imgUrl } = getInitialsOrImg(engineer.assignee);
    const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${escapeHtml(engineer.assignee?.displayName || '?')}">`
        : initials;
    const name = escapeHtml(engineer.assignee?.displayName || 'Unassigned');
    const barWidth = Math.min(engineer.capacityPct, 100);
    const barClass = engineer.capacityPct > 115 ? 'danger' : engineer.capacityPct >= 100 ? 'warning' : 'safe';

    return `
        <div class="fu-hotspot-row" data-account-id="${engineer.assignee?.accountId || 'unassigned'}">
            <div class="dev-avatar fu-engineer-avatar">${avatarHtml}</div>
            <div class="fu-hotspot-main">
                <div class="fu-hotspot-head">
                    <span class="fu-engineer-name">${name}</span>
                    <span class="fu-engineer-pct ${barClass}">${engineer.capacityPct}%</span>
                </div>
                <div class="capacity-bar-track fu-engineer-bar">
                    <div class="capacity-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                </div>
                <div class="fu-engineer-stat-row">
                    <span class="fu-engineer-stat">${engineer.queueCount} queue items</span>
                    <span class="fu-engineer-stat">${engineer.blockedCount} blocked</span>
                    <span class="fu-engineer-stat">${engineer.frozenCount} frozen</span>
                </div>
            </div>
        </div>
    `;
}

function renderReadOnlyTags(tagLabels = []) {
    const tags = getTagObjects(tagLabels, followupState.tagDefs);
    if (!tags.length) return '<span class="fu-tag-empty">No tags</span>';

    return tags.map(tag => `
        <span class="et-tag-chip fu-real-tag" style="${getTagInlineStyle(tag.color)}">
            <span class="et-tag-chip-dot"></span>
            <span class="et-tag-chip-label">${escapeHtml(tag.label)}</span>
        </span>
    `).join('');
}

function getActionableItems() {
    return followupState.items.filter(item => item.actionable);
}

function getVisibleItems() {
    const includeDone = followupState.filters.showDone || followupState.filters.state === 'done';

    return getActionableItems().filter(item => {
        if (!includeDone && isDoneItem(item)) return false;
        if (followupState.filters.assignee !== 'all' && item.jira.assigneeId !== followupState.filters.assignee) return false;
        if (followupState.filters.signal !== 'all' && !item.signals.includes(followupState.filters.signal)) return false;
        if (followupState.filters.jiraStatus !== 'all' && item.jira.statusName !== followupState.filters.jiraStatus) return false;
        if (followupState.filters.state !== 'all' && item.tracking.state !== followupState.filters.state) return false;
        if (!matchesPrFilter(item, followupState.filters.pr)) return false;
        if (!matchesTrackingFilter(item, followupState.filters.tracking)) return false;
        if (!matchesTagFilter(item.tracking.tags || [], followupState.selectedTagFilters)) return false;
        return true;
    });
}

function matchesPrFilter(item, filter) {
    if (filter === 'all') return true;
    if (filter === 'missing') return !item.pr;
    if (filter === 'open') return !!item.pr && item.pr.state === 'open' && !item.pr.draft;
    if (filter === 'draft') return !!item.pr && item.pr.draft;
    if (filter === 'merged') return !!item.pr && item.pr.state === 'merged';
    if (filter === 'stale') return item.signals.includes('review-waiting') || item.signals.includes('frozen');
    return true;
}

function matchesTrackingFilter(item, filter) {
    if (filter === 'all') return true;
    if (filter === 'tracked') return Boolean(item.tracking.noteText || item.tracking.reminderTs || item.tracking.tags.length);
    if (filter === 'note') return Boolean(item.tracking.noteText);
    if (filter === 'reminder') return Boolean(item.tracking.reminderTs);
    if (filter === 'none') return !item.tracking.noteText && !item.tracking.reminderTs;
    return true;
}

function isDoneItem(item) {
    return item.jira.section === 'done' || item.tracking.state === 'done';
}

function getSectionClass(section) {
    if (section === 'done') return 'done-chip';
    if (section === 'blocked') return 'blocked-chip';
    if (section === 'inReview') return 'in-review-chip';
    if (section === 'inProgress') return 'in-progress-chip';
    return '';
}

function formatReminder(timestamp) {
    const date = new Date(timestamp);
    if (timestamp <= Date.now()) return `due ${timeSince(timestamp)} ago`;
    return `${formatDate(date)} ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function setSelectOptions(select, options, selectedValue) {
    const nextValue = options.some(option => option.value === selectedValue) ? selectedValue : options[0]?.value;
    select.innerHTML = options.map(option => `
        <option value="${option.value}" ${option.value === nextValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>
    `).join('');
    select.value = nextValue;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function getSignalReason(item, signal) {
    const index = item.signals.indexOf(signal);
    return index >= 0 ? (item.reasonLines[index] || '') : '';
}

async function persistFollowupMeta(issueKey, changes) {
    const current = normalizeFollowupMeta(followupState.followupMetaMap[issueKey]);
    const next = {
        ...current,
        ...changes,
        updatedAt: Date.now(),
    };
    const storageKey = getFollowupMetaStorageKey(issueKey);

    if (next.state === 'default' && !next.pinned) {
        delete followupState.followupMetaMap[issueKey];
        await storage.remove(storageKey);
    } else {
        followupState.followupMetaMap[issueKey] = next;
        await storage.set({ [storageKey]: next });
    }

    rebuildFollowupItems();
    renderFollowupDashboard();
}

async function applyReminderSnooze(issueKey, mode) {
    const storageKey = getReminderStorageKey(issueKey);
    const target = new Date();
    const finalKey = issueKey.includes(':') ? issueKey : `jira:${issueKey}`;

    if (mode === '4h') {
        target.setHours(target.getHours() + 4);
    } else {
        target.setDate(target.getDate() + 1);
        target.setHours(9, 0, 0, 0);
    }

    followupState.alertsMap[issueKey] = target.getTime();
    await storage.set({ [storageKey]: target.getTime() });
    await storage.remove(`ignored_${finalKey}`);

    const result = await storage.get('pending_alerts');
    const pending = (result.pending_alerts || []).filter(key => key !== issueKey);
    await storage.set({ pending_alerts: pending });

    rebuildFollowupItems();
    renderFollowupDashboard();
}

function buildSlackText(items) {
    const dateLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const lines = [`Sprint Control Tower - ${dateLabel}`, ''];

    items.forEach(item => {
        lines.push(`${item.key} · ${item.reason}`);
        lines.push(item.summary || '');
        lines.push(item.jiraUrl);
        if (item.prUrl) lines.push(item.prUrl);
        lines.push('');
    });

    return lines.join('\n').trim();
}

function attachFollowupEvents(container) {
    if (container.dataset.fuDelegated === 'true') return;

    container.addEventListener('click', async event => {
        const notesBtn = event.target.closest('.et-notes-btn');
        if (notesBtn) {
            const { issueKey, summary } = notesBtn.dataset;
            if (issueKey) NoteDrawer.open(issueKey, summary);
            return;
        }

        const pinBtn = event.target.closest('.fu-pin-btn, .fu-pin-toggle');
        if (pinBtn) {
            const issueKey = pinBtn.dataset.issueKey;
            if (!issueKey) return;
            const current = normalizeFollowupMeta(followupState.followupMetaMap[issueKey]);
            await persistFollowupMeta(issueKey, { pinned: !current.pinned });
            return;
        }

        const snoozeBtn = event.target.closest('.fu-snooze-btn');
        if (snoozeBtn) {
            const issueKey = snoozeBtn.dataset.issueKey;
            const mode = snoozeBtn.dataset.mode;
            if (issueKey && mode) await applyReminderSnooze(issueKey, mode);
            return;
        }

        const hotspotRow = event.target.closest('.fu-hotspot-row');
        if (hotspotRow) {
            const accId = hotspotRow.dataset.accountId;
            if (accId) {
                switchToView('sprint-dashboard');
                setTimeout(() => highlightEngineer(accId), 100);
            }
            return;
        }

        const copyBtn = event.target.closest('.fu-copy-all-btn');
        if (copyBtn && copyBtn.dataset.payload) {
            if (copyBtn.dataset.isCopying) return;
            copyBtn.dataset.isCopying = 'true';

            const payload = JSON.parse(copyBtn.dataset.payload);
            const text = buildSlackText(payload);
            const original = copyBtn.textContent;

            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = 'Copied';
                setTimeout(() => {
                    copyBtn.textContent = original;
                    delete copyBtn.dataset.isCopying;
                }, 1500);
            }).catch(() => {
                delete copyBtn.dataset.isCopying;
            });
        }
    });

    container.addEventListener('change', async event => {
        const stateSelect = event.target.closest('.fu-state-select');
        if (stateSelect) {
            const issueKey = stateSelect.dataset.issueKey;
            if (!issueKey) return;
            await persistFollowupMeta(issueKey, { state: stateSelect.value });
            return;
        }

        const filter = event.target.closest('[data-fu-filter]');
        if (filter) {
            const filterName = filter.dataset.fuFilter;
            if (filterName === 'showDone') {
                followupState.filters.showDone = filter.checked;
            } else if (Object.prototype.hasOwnProperty.call(followupState.filters, filterName)) {
                followupState.filters[filterName] = filter.value;
            }
            renderFollowupDashboard();
        }
    });

    container.dataset.fuDelegated = 'true';
}

function ensureFollowupTagFilter() {
    if (followupState.tagFilterEditor) return;

    const host = document.getElementById('fu-tag-filter-host');
    if (!host) return;

    followupState.tagFilterEditor = createTagEditor(host, {
        value: [],
        tagDefs: {},
        allowCreate: false,
        compact: true,
        placeholder: 'Filter tags...',
        onChange: tags => {
            followupState.selectedTagFilters = tags.slice();
            renderFollowupDashboard();
        },
    });
}

function bindFollowupStorageListener() {
    if (followupState.storageListenerBound || typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        const hasMetaChange = Object.keys(changes).some(key => key.startsWith(FOLLOWUP_META_PREFIX));
        if (!hasTrackingStorageChange(changes) && !hasMetaChange) return;
        if (!followupState.issues.length) return;

        clearTimeout(followupState.storageReloadTimer);
        followupState.storageReloadTimer = setTimeout(() => {
            refreshTrackingState();
        }, 120);
    });

    followupState.storageListenerBound = true;
}

export function initFollowupCombo(allProjects, currentHost, initialProjectKey = '', getSettings) {
    let selectedProjectKey = '';

    const search = document.getElementById('fu-project-search');
    const dropdown = document.getElementById('fu-project-dropdown');
    const comboWrapper = document.getElementById('fu-combo-wrapper');
    const content = document.getElementById('fu-content');

    if (!search || !dropdown || !comboWrapper || !content) return;

    ensureFollowupTagFilter();
    bindFollowupStorageListener();
    attachFollowupEvents(content);

    function renderOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const filtered = allProjects.filter(project =>
            !term
            || project.name.toLowerCase().includes(term)
            || project.key.toLowerCase().includes(term)
        );

        if (filtered.length === 0) {
            dropdown.innerHTML = '<div class="combo-msg">No projects found</div>';
            return;
        }

        dropdown.innerHTML = filtered.map(project => `
            <div class="combo-option ${project.key === selectedProjectKey ? 'selected' : ''}" data-key="${project.key}" data-name="${escapeHtml(project.name)}">
                <span class="combo-option-key">${project.key}</span>${escapeHtml(project.name)}
            </div>
        `).join('');
    }

    search.addEventListener('focus', () => {
        search.select();
        dropdown.classList.remove('hidden');
        renderOptions('');
    });

    search.addEventListener('input', event => {
        dropdown.classList.remove('hidden');
        renderOptions(event.target.value);
    });

    dropdown.addEventListener('click', event => {
        const option = event.target.closest('.combo-option');
        if (!option) return;

        selectedProjectKey = option.dataset.key;
        search.value = `${option.dataset.name} (${option.dataset.key})`;
        dropdown.classList.add('hidden');
        loadFollowupDashboard(selectedProjectKey, currentHost, getSettings());
    });

    document.addEventListener('click', event => {
        if (!comboWrapper.contains(event.target)) {
            dropdown.classList.add('hidden');
            if (selectedProjectKey) {
                const project = allProjects.find(item => item.key === selectedProjectKey);
                if (project) search.value = `${project.name} (${project.key})`;
            } else {
                search.value = '';
            }
        }
    });

    document.getElementById('fu-refresh-btn')?.addEventListener('click', () => {
        if (!selectedProjectKey) return;
        loadFollowupDashboard(selectedProjectKey, currentHost, getSettings(), { forceRefresh: true });
    });

    if (allProjects.length > 0) search.placeholder = 'Search project...';

    if (initialProjectKey) {
        const project = allProjects.find(item => item.key === initialProjectKey);
        if (project) {
            selectedProjectKey = initialProjectKey;
            search.value = `${project.name} (${project.key})`;
            loadFollowupDashboard(initialProjectKey, currentHost, getSettings());
        }
    }
}

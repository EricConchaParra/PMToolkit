/**
 * PMsToolKit — Analytics Hub
 * Follow-up Work Dashboard — notes/alerts, in-review, capacity
 */

import { storage } from '../../../../common/storage.js';
import { createTagEditor } from '../../../../common/tagEditor.js';
import {
    TAG_DEFS_STORAGE_KEY,
    ensureTagDefinition,
    escapeHtml,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagsStorageKey,
    getTagInlineStyle,
    getTagObjects,
    hasTrackingStorageChange,
    matchesTagFilter,
    normalizeTagList,
    parseTrackingStorage,
    saveIssueTags,
} from '../../../../common/tagging.js';
import { NoteDrawer } from '../../../../content/jira/ui/NoteDrawer.js';
import {
    fetchBoardId, fetchSprintIssues, fetchIssueInProgressSince, fetchSpFieldId, jiraFetch,
} from '../jiraApi.js';
import { spToHours, workingHoursBetween, timeSince } from '../utils.js';
import { getInitialsOrImg } from '../sprintDashboard/devCard.js';
import { enrichChips } from '../githubPrCache.js';
import { switchToView } from '../nav.js';
import { highlightEngineer } from '../sprintDashboard/sprintDashboard.js';

const followupState = {
    projectKey: '',
    host: '',
    settings: {},
    issues: [],
    notesMap: {},
    alertsMap: {},
    tagsMap: {},
    tagDefs: {},
    selectedTagFilters: [],
    expandedEditors: new Set(),
    tagFilterEditor: null,
    tagEditors: [],
    storageListenerBound: false,
    storageReloadTimer: null,
};

function sectionOf(issue, statusMap = {}) {
    const name = issue.fields?.status?.name || '';
    if (statusMap[name]) return statusMap[name];
    const normalized = name.toLowerCase();
    const category = issue.fields?.status?.statusCategory?.key || '';
    if (normalized.includes('blocked') || normalized.includes('hold')) return 'blocked';
    if (normalized.includes('in review') || normalized === 'review') return 'inReview';
    if (normalized.includes('in progress') || category === 'indeterminate') return 'inProgress';
    if (normalized.includes('qa') || normalized.includes('test')) return 'qa';
    if (category === 'done' || normalized === 'done') return 'done';
    return 'todo';
}

function issueChip(issue, jiraHost, opts = {}) {
    const { isOverdue, reminderTs, showTimeInState } = opts;

    let badgeHtml = '';
    if (showTimeInState && issue._inProgressSince) {
        badgeHtml = `<span class="fu-time-in-state-badge">⏱️ ${timeSince(issue._inProgressSince)}</span>`;
    } else if (isOverdue) {
        badgeHtml = `<span class="overdue-time-badge">⏰ ${timeSince(issue._inProgressSince)}</span>`;
    } else if (reminderTs) {
        badgeHtml = `<span class="overdue-time-badge">🔔 ${new Date(reminderTs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>`;
    }

    const { initials, imgUrl } = getInitialsOrImg(issue.fields?.assignee);
    const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${escapeHtml(issue.fields?.assignee?.displayName || '?')}">`
        : initials;
    const assigneeName = escapeHtml(issue.fields?.assignee?.displayName || 'Unassigned');

    const section = sectionOf(issue);
    const isDone = section === 'done';
    const isBlocked = section === 'blocked';
    const isInReview = section === 'inReview';
    const isInProgress = section === 'inProgress';

    return `
        <div class="issue-chip${isOverdue ? ' issue-chip-overdue' : ''}${isDone ? ' done-chip' : ''}${isBlocked ? ' blocked-chip' : ''}${isInReview ? ' in-review-chip' : ''}${isInProgress ? ' in-progress-chip' : ''}" data-gh-key="${issue.key}" data-status="${escapeHtml(issue.fields?.status?.name || '?')}">
            <div class="issue-chip-main">
                <div class="issue-chip-top">
                    <a class="issue-chip-key" href="https://${jiraHost}/browse/${issue.key}" target="_blank">${issue.key}</a>
                    <span class="issue-chip-status">${escapeHtml(issue.fields?.status?.name || '?')}</span>
                    <span class="issue-chip-sp">${issue._sp ?? '?'} SP</span>
                    ${badgeHtml}
                </div>
                <div class="issue-chip-assignee">
                    <div class="dev-avatar issue-chip-avatar" title="${assigneeName}">${avatarHtml}</div>
                    <span class="issue-chip-assignee-name">${assigneeName}</span>
                </div>
                <div class="issue-chip-summary" title="${escapeHtml(issue.fields?.summary || '')}">${escapeHtml(issue.fields?.summary || '')}</div>
            </div>
            <div class="issue-chip-actions">
                <button class="et-notes-btn" data-issue-key="${issue.key}" data-summary="${escapeHtml(issue.fields?.summary || '')}" title="Notes">📝</button>
                <button class="overdue-copy-btn" title="Copy for Slack" data-key="${issue.key}" data-summary="${escapeHtml(issue.fields?.summary || '')}" data-url="https://${jiraHost}/browse/${issue.key}">🔗</button>
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

function buildSlackText(tickets, host, notesMap, alertsMap, tagsMap) {
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const lines = [
        `🗓️ *Standup Action Items — ${today}*`,
        '',
    ];

    const groups = {};
    tickets.forEach(ticket => {
        const assignee = ticket.fields?.assignee?.displayName || 'Unassigned';
        if (!groups[assignee]) groups[assignee] = [];
        groups[assignee].push(ticket);
    });

    Object.keys(groups).sort().forEach((assignee, index, arr) => {
        lines.push(`👤 *${assignee}*`);

        groups[assignee].forEach(ticket => {
            const url = `https://${host}/browse/${ticket.key}`;
            const noteText = notesMap[ticket.key];
            const reminderTs = alertsMap[ticket.key];
            const tags = tagsMap[ticket.key] || [];

            lines.push('');
            lines.push(`📋 *${ticket.key}:* ${ticket.fields?.summary || ''}`);

            if (noteText) lines.push(`_Note: ${noteText}_`);
            if (reminderTs) {
                const dateStr = new Date(reminderTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                lines.push(`_Reminder: ${dateStr}_`);
            }
            if (tags.length) lines.push(`_Tags: ${tags.join(', ')}_`);

            lines.push(url);
        });

        if (index < arr.length - 1) {
            lines.push('');
            lines.push('-------------------------------------------');
            lines.push('');
        }
    });

    return lines.join('\n').trim();
}

function attachFollowupEvents(container) {
    if (container.dataset.fuDelegated) return;

    container.addEventListener('click', e => {
        const copyBtn = e.target.closest('.overdue-copy-btn');
        if (copyBtn) {
            if (copyBtn.dataset.isCopying) return;
            copyBtn.dataset.isCopying = 'true';
            const { key, summary, url } = copyBtn.dataset;
            const plainText = `${key} ${summary}\n${url}`;
            const htmlLink = `<a href="${url}">${escapeHtml(`${key} ${summary}`)}</a>`;
            const original = copyBtn.textContent;

            navigator.clipboard.write([
                new ClipboardItem({
                    'text/plain': new Blob([plainText], { type: 'text/plain' }),
                    'text/html': new Blob([htmlLink], { type: 'text/html' }),
                }),
            ]).then(() => flash(copyBtn, original))
                .catch(() => navigator.clipboard.writeText(plainText).then(() => flash(copyBtn, original)).catch(() => {
                    delete copyBtn.dataset.isCopying;
                }));
            return;
        }

        const copyAllBtn = e.target.closest('.fu-copy-all-btn');
        if (copyAllBtn) {
            if (copyAllBtn.dataset.isCopying) return;
            copyAllBtn.dataset.isCopying = 'true';
            const host = copyAllBtn.dataset.host;
            const tickets = JSON.parse(copyAllBtn.dataset.tickets || '[]');
            const notesMap = JSON.parse(copyAllBtn.dataset.notesMap || '{}');
            const alertsMap = JSON.parse(copyAllBtn.dataset.alertsMap || '{}');
            const tagsMap = JSON.parse(copyAllBtn.dataset.tagsMap || '{}');
            const text = buildSlackText(tickets, host, notesMap, alertsMap, tagsMap);
            const original = copyAllBtn.innerHTML;

            navigator.clipboard.writeText(text).then(() => {
                copyAllBtn.innerHTML = '✅ Copied!';
                copyAllBtn.style.color = '#36b37e';
                setTimeout(() => {
                    copyAllBtn.innerHTML = original;
                    copyAllBtn.style.color = '';
                    delete copyAllBtn.dataset.isCopying;
                }, 2000);
            }).catch(() => {
                delete copyAllBtn.dataset.isCopying;
            });
            return;
        }

        const notesBtn = e.target.closest('.et-notes-btn');
        if (notesBtn) {
            const { issueKey, summary } = notesBtn.dataset;
            if (issueKey) NoteDrawer.open(issueKey, summary);
            return;
        }

        const engineerRow = e.target.closest('.fu-engineer-row');
        if (engineerRow) {
            const accId = engineerRow.dataset.accountId;
            if (accId) {
                switchToView('sprint-dashboard');
                setTimeout(() => highlightEngineer(accId), 100);
            }
            return;
        }

        const tagToggle = e.target.closest('.fu-tag-edit-btn');
        if (tagToggle) {
            const issueKey = tagToggle.dataset.issueKey;
            const willOpen = !followupState.expandedEditors.has(issueKey);
            if (willOpen) followupState.expandedEditors.add(issueKey);
            else followupState.expandedEditors.delete(issueKey);
            renderTrackedSection();
        }
    });

    container.dataset.fuDelegated = 'true';
}

function flash(button, original) {
    button.textContent = '✅';
    button.style.color = '#36b37e';
    setTimeout(() => {
        button.textContent = original;
        button.style.color = '';
        delete button.dataset.isCopying;
    }, 1500);
}

function showFollowupState(state, msg = '') {
    ['fu-placeholder', 'fu-loading', 'fu-error', 'fu-content'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

    if (state === 'loading') {
        document.getElementById('fu-loading').classList.remove('hidden');
        const txt = document.getElementById('fu-loading-text');
        if (txt && msg) txt.textContent = msg;
    } else if (state === 'error') {
        document.getElementById('fu-error').classList.remove('hidden');
        const txt = document.getElementById('fu-error-text');
        if (txt && msg) txt.textContent = msg;
    } else if (state === 'placeholder') {
        document.getElementById('fu-placeholder').classList.remove('hidden');
    } else if (state === 'content') {
        document.getElementById('fu-content').classList.remove('hidden');
    }
}

async function refreshTrackingState() {
    if (!followupState.issues.length) return;

    const storageKeys = [TAG_DEFS_STORAGE_KEY];
    followupState.issues.forEach(issue => {
        storageKeys.push(
            getNotesStorageKey(issue.key),
            getReminderStorageKey(issue.key),
            getTagsStorageKey(issue.key),
        );
    });

    const stored = await storage.get(storageKeys);
    const parsed = parseTrackingStorage(stored, { activeRemindersOnly: true });

    followupState.notesMap = parsed.notesMap;
    followupState.alertsMap = parsed.remindersMap;
    followupState.tagsMap = parsed.tagsMap;
    followupState.tagDefs = parsed.tagDefs;
    followupState.tagFilterEditor?.setTagDefs(followupState.tagDefs);
    followupState.selectedTagFilters = followupState.tagFilterEditor?.getValue() || followupState.selectedTagFilters;
    renderTrackedSection();
}

function renderTrackedSection() {
    const trackedTickets = followupState.issues.filter(issue => {
        const tags = followupState.tagsMap[issue.key] || [];
        return followupState.notesMap[issue.key] || followupState.alertsMap[issue.key] || tags.length;
    });

    const filteredTickets = trackedTickets.filter(issue => matchesTagFilter(
        followupState.tagsMap[issue.key] || [],
        followupState.selectedTagFilters,
    ));

    renderSection1(
        filteredTickets,
        trackedTickets.length,
        followupState.host,
        followupState.notesMap,
        followupState.alertsMap,
        followupState.tagsMap,
    );
}

async function persistFollowupTags(issueKey, tagLabels) {
    const finalTags = normalizeTagList(tagLabels, followupState.tagDefs);
    await saveIssueTags(issueKey, finalTags);

    if (finalTags.length) followupState.tagsMap[issueKey] = finalTags;
    else delete followupState.tagsMap[issueKey];

    renderTrackedSection();
    NoteDrawer.initIndicators();
}

function initTagEditorsForTrackedSection() {
    followupState.tagEditors.forEach(editor => editor.destroy());
    followupState.tagEditors = [];

    const hosts = document.querySelectorAll('.fu-tag-editor-host');
    hosts.forEach(host => {
        const issueKey = host.dataset.issueKey;
        const editor = createTagEditor(host, {
            value: followupState.tagsMap[issueKey] || [],
            tagDefs: followupState.tagDefs,
            placeholder: 'Add or create tags...',
            compact: true,
            onCreateTag: async (label, color) => {
                const created = await ensureTagDefinition(label, color);
                if (!created) return false;
                followupState.tagDefs = {
                    ...followupState.tagDefs,
                    [created.normalized]: {
                        label: created.label,
                        color: created.color,
                    },
                };
                followupState.tagFilterEditor?.setTagDefs(followupState.tagDefs);
                editor.setTagDefs(followupState.tagDefs);
                return created;
            },
            onChange: tags => {
                clearTimeout(host._saveTimer);
                host._saveTimer = setTimeout(() => {
                    persistFollowupTags(issueKey, tags);
                }, 150);
            },
        });

        const isOpen = followupState.expandedEditors.has(issueKey);
        host.closest('.fu-tag-editor-panel')?.classList.toggle('hidden', !isOpen);
        host.closest('.fu-tag-editor-panel')?.setAttribute('data-open', isOpen ? 'true' : 'false');
        followupState.tagEditors.push(editor);
    });
}

export async function loadFollowupDashboard(projectKey, host, settings) {
    if (!projectKey || !host) return;

    followupState.projectKey = projectKey;
    followupState.host = host;
    followupState.settings = settings || {};

    showFollowupState('loading', 'Connecting to Jira...');
    try {
        showFollowupState('loading', 'Resolving Story Points field...');
        const spFieldId = await fetchSpFieldId(host);

        showFollowupState('loading', 'Finding Scrum board...');
        const boardId = await fetchBoardId(host, projectKey);
        if (!boardId) {
            showFollowupState('error', `No Scrum board found for "${projectKey}".`);
            return;
        }

        showFollowupState('loading', 'Finding active sprint...');
        const sprintData = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=1`);
        const activeSprint = (sprintData.values || [])[0];
        if (!activeSprint) {
            showFollowupState('error', 'No active sprint found for this project.');
            return;
        }

        showFollowupState('loading', 'Fetching sprint issues...');
        const issues = await fetchSprintIssues(host, activeSprint.id, spFieldId);
        issues.forEach(issue => {
            issue._sp = spFieldId ? (Number(issue.fields?.[spFieldId]) || 0) : 0;
        });

        showFollowupState('loading', 'Checking In Progress / In Review durations...');
        const { hoursPerDay = 9, spHours = {}, statusMap = {} } = settings || {};
        const inProgressOrReview = issues.filter(issue => {
            const section = sectionOf(issue, statusMap);
            return section === 'inProgress' || section === 'inReview';
        });

        const CONCURRENCY = 4;
        for (let index = 0; index < inProgressOrReview.length; index += CONCURRENCY) {
            const batch = inProgressOrReview.slice(index, index + CONCURRENCY);
            await Promise.all(batch.map(async issue => {
                issue._inProgressSince = await fetchIssueInProgressSince(host, issue.key).catch(() => null);
            }));
        }

        followupState.issues = issues;
        showFollowupState('loading', 'Loading notes, reminders, and tags...');
        await refreshTrackingState();

        const inReviewTickets = issues.filter(issue => sectionOf(issue, statusMap) === 'inReview');
        const sprintEnd = activeSprint.endDate ? new Date(activeSprint.endDate) : null;
        const sprintHoursLeft = sprintEnd ? workingHoursBetween(new Date(), sprintEnd, hoursPerDay) : null;

        const devMap = {};
        issues.forEach(issue => {
            const key = issue.fields?.assignee?.accountId || 'unassigned';
            if (!devMap[key]) devMap[key] = { assignee: issue.fields?.assignee || null, issues: [] };
            devMap[key].issues.push(issue);
        });

        const now = Date.now();
        const engineers = Object.values(devMap).map(dev => {
            const pending = dev.issues.filter(issue => {
                const section = sectionOf(issue, statusMap);
                return section === 'inProgress' || section === 'inReview' || section === 'todo';
            });
            const committedHours = pending.reduce((acc, issue) => acc + spToHours(issue._sp, spHours), 0);
            const spLeft = pending.reduce((acc, issue) => acc + (issue._sp || 0), 0);
            const ticketsLeft = pending.length;
            const overdueCount = pending.filter(issue => {
                const since = issue._inProgressSince;
                if (!since) return false;
                const elapsedHours = (now - new Date(since).getTime()) / (1000 * 60 * 60);
                const allowed = spToHours(issue._sp, spHours);
                return elapsedHours > allowed;
            }).length;

            let capacityPct = 0;
            if (sprintHoursLeft !== null && sprintHoursLeft > 0) {
                capacityPct = Math.min(Math.round((committedHours / sprintHoursLeft) * 100), 150);
            } else if (committedHours > 0) {
                capacityPct = 150;
            }
            return { assignee: dev.assignee, capacityPct, committedHours, ticketsLeft, spLeft, overdueCount };
        }).filter(engineer => engineer.capacityPct >= 75)
            .sort((a, b) => b.capacityPct - a.capacityPct);

        showFollowupState('content');
        renderSection2(inReviewTickets, host);
        renderSection3(engineers, sprintHoursLeft);

        const content = document.getElementById('fu-content');
        attachFollowupEvents(content);
        NoteDrawer.initIndicators();

        if (typeof chrome !== 'undefined' && chrome.storage) {
            const stored = await new Promise(resolve => chrome.storage.sync.get({ github_pr_link: false, github_pat: '' }, resolve));
            if (stored.github_pr_link && stored.github_pat) {
                enrichChips(content, stored.github_pat);
            }
        }
    } catch (err) {
        console.error('PMsToolKit Follow-up Dashboard:', err);
        showFollowupState('error', err.message || 'Unexpected error loading follow-up dashboard.');
    }
}

function renderSection1(tickets, totalTrackedCount, host, notesMap, alertsMap, tagsMap) {
    const list = document.getElementById('fu-notes-list');
    if (!list) return;

    const countEl = document.getElementById('fu-notes-count');
    if (countEl) countEl.textContent = tickets.length;

    const copyAllBtn = document.getElementById('fu-notes-copy-all');
    if (copyAllBtn) {
        if (tickets.length === 0) {
            copyAllBtn.classList.add('hidden');
        } else {
            copyAllBtn.classList.remove('hidden');
            copyAllBtn.dataset.host = host;
            copyAllBtn.dataset.tickets = JSON.stringify(tickets.map(issue => ({
                key: issue.key,
                fields: {
                    summary: issue.fields?.summary,
                    assignee: issue.fields?.assignee,
                },
            })));
            copyAllBtn.dataset.notesMap = JSON.stringify(notesMap);
            copyAllBtn.dataset.alertsMap = JSON.stringify(alertsMap);
            copyAllBtn.dataset.tagsMap = JSON.stringify(tagsMap);
        }
    }

    if (tickets.length === 0) {
        const hasFilter = followupState.selectedTagFilters.length > 0;
        list.innerHTML = `<div class="fu-empty-state">${hasFilter ? '🔎 No tracked tickets match the selected tags' : totalTrackedCount > 0 ? '🔎 No tracked tickets available in this filtered view' : '✅ No tickets with notes, reminders, or tags'}</div>`;
        return;
    }

    list.innerHTML = tickets.map(issue => {
        const noteText = notesMap[issue.key];
        const reminderTs = alertsMap[issue.key];
        const tags = tagsMap[issue.key] || [];
        const section = sectionOf(issue);
        const { initials, imgUrl } = getInitialsOrImg(issue.fields?.assignee);
        const avatarHtml = imgUrl
            ? `<img src="${imgUrl}" alt="${escapeHtml(issue.fields?.assignee?.displayName || '?')}">`
            : initials;
        const assigneeName = escapeHtml(issue.fields?.assignee?.displayName || 'Unassigned');
        const isOpen = followupState.expandedEditors.has(issue.key);

        const badges = [];
        if (noteText) badges.push('<span class="fu-tag fu-tag-note">📝 Note</span>');
        if (reminderTs) {
            badges.push(`<span class="fu-tag fu-tag-alert">🔔 Alert ${new Date(reminderTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`);
        }

        return `
            <div class="issue-chip ${section === 'done' ? 'done-chip' : ''} ${section === 'blocked' ? 'blocked-chip' : ''} ${section === 'inReview' ? 'in-review-chip' : ''} ${section === 'inProgress' ? 'in-progress-chip' : ''}" data-gh-key="${issue.key}" data-status="${escapeHtml(issue.fields?.status?.name || '?')}">
                <div class="issue-chip-main">
                    <div class="issue-chip-top">
                        <a class="issue-chip-key" href="https://${host}/browse/${issue.key}" target="_blank">${issue.key}</a>
                        <span class="issue-chip-status">${escapeHtml(issue.fields?.status?.name || '?')}</span>
                        <span class="issue-chip-sp">${issue._sp ?? '?'} SP</span>
                        ${badges.join('')}
                    </div>
                    <div class="issue-chip-assignee">
                        <div class="dev-avatar issue-chip-avatar" title="${assigneeName}">${avatarHtml}</div>
                        <span class="issue-chip-assignee-name">${assigneeName}</span>
                    </div>
                    <div class="issue-chip-summary" title="${escapeHtml(issue.fields?.summary || '')}">${escapeHtml(issue.fields?.summary || '')}</div>
                    ${noteText ? `<div class="fu-note-preview">${escapeHtml(noteText)}</div>` : ''}
                    <div class="fu-tag-row">
                        <div class="et-tag-read-list fu-tag-list">${renderReadOnlyTags(tags)}</div>
                        <button class="fu-tag-edit-btn" data-issue-key="${issue.key}">${isOpen ? 'Hide tags' : '+ Tag'}</button>
                    </div>
                    <div class="fu-tag-editor-panel ${isOpen ? '' : 'hidden'}">
                        <div class="fu-tag-editor-host" data-issue-key="${issue.key}"></div>
                    </div>
                </div>
                <div class="issue-chip-actions">
                    <button class="et-notes-btn" data-issue-key="${issue.key}" data-summary="${escapeHtml(issue.fields?.summary || '')}" title="Notes">📝</button>
                    <button class="overdue-copy-btn" title="Copy for Slack" data-key="${issue.key}" data-summary="${escapeHtml(issue.fields?.summary || '')}" data-url="https://${host}/browse/${issue.key}">🔗</button>
                </div>
            </div>
        `;
    }).join('');

    initTagEditorsForTrackedSection();
}

function renderSection2(tickets, host) {
    const list = document.getElementById('fu-review-list');
    if (!list) return;

    const countEl = document.getElementById('fu-review-count');
    if (countEl) countEl.textContent = tickets.length;

    if (tickets.length === 0) {
        list.innerHTML = '<div class="fu-empty-state">✅ No tickets currently In Review</div>';
        return;
    }

    list.innerHTML = tickets.map(issue => issueChip(issue, host, { showTimeInState: true })).join('');
}

function renderSection3(engineers, sprintHoursLeft) {
    const list = document.getElementById('fu-capacity-list');
    if (!list) return;

    const countEl = document.getElementById('fu-capacity-count');
    if (countEl) countEl.textContent = engineers.length;

    if (engineers.length === 0) {
        list.innerHTML = '<div class="fu-empty-state">✅ No engineers above 75% capacity</div>';
        return;
    }

    list.innerHTML = engineers.map(engineer => {
        const { initials, imgUrl } = getInitialsOrImg(engineer.assignee);
        const avatarHtml = imgUrl
            ? `<img src="${imgUrl}" alt="${escapeHtml(engineer.assignee?.displayName || '?')}">`
            : initials;
        const barClass = engineer.capacityPct > 110 ? 'danger' : engineer.capacityPct > 85 ? 'warning' : 'safe';
        const barWidth = Math.min(engineer.capacityPct, 100);
        const name = escapeHtml(engineer.assignee?.displayName || 'Unassigned');
        const hoursTooltip = sprintHoursLeft !== null
            ? `${engineer.committedHours.toFixed(1)}h needed / ${sprintHoursLeft.toFixed(1)}h remaining`
            : `${engineer.committedHours.toFixed(1)}h committed`;

        const overdueHtml = engineer.overdueCount > 0
            ? `<span class="fu-engineer-overdue-badge">⚠️ ${engineer.overdueCount} overdue</span>`
            : '';

        const hoursHtml = sprintHoursLeft !== null
            ? `<span class="fu-engineer-hours">${engineer.committedHours.toFixed(1)}h / ${sprintHoursLeft.toFixed(1)}h cap</span>`
            : `<span class="fu-engineer-hours">${engineer.committedHours.toFixed(1)}h committed</span>`;

        return `
            <div class="fu-engineer-row" data-account-id="${engineer.assignee?.accountId || 'unassigned'}">
                <div class="dev-avatar fu-engineer-avatar">${avatarHtml}</div>
                <div class="fu-engineer-info">
                    <div class="fu-engineer-name-row">
                        <span class="fu-engineer-name">${name}</span>
                        ${overdueHtml}
                    </div>
                    <div class="capacity-bar-track fu-engineer-bar">
                        <div class="capacity-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                    </div>
                    <div class="fu-engineer-stat-row">
                        <span class="fu-engineer-stat">🎫 ${engineer.ticketsLeft} ticket${engineer.ticketsLeft !== 1 ? 's' : ''}</span>
                        <span class="fu-engineer-stat">⚡ ${engineer.spLeft} SP</span>
                        ${hoursHtml}
                    </div>
                </div>
                <div class="fu-engineer-pct ${barClass}" title="${hoursTooltip}">
                    ${engineer.capacityPct}%
                </div>
            </div>
        `;
    }).join('');
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
            renderTrackedSection();
        },
    });
}

function bindFollowupStorageListener() {
    if (followupState.storageListenerBound || typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (!hasTrackingStorageChange(changes)) return;
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
    if (!search || !dropdown || !comboWrapper) return;

    ensureFollowupTagFilter();
    bindFollowupStorageListener();

    function renderOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const filtered = allProjects.filter(project => !term || project.name.toLowerCase().includes(term) || project.key.toLowerCase().includes(term));
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

    search.addEventListener('input', e => {
        dropdown.classList.remove('hidden');
        renderOptions(e.target.value);
    });

    dropdown.addEventListener('click', e => {
        const option = e.target.closest('.combo-option');
        if (!option) return;
        selectedProjectKey = option.dataset.key;
        search.value = `${option.dataset.name} (${option.dataset.key})`;
        dropdown.classList.add('hidden');
        followupState.expandedEditors = new Set();
        loadFollowupDashboard(selectedProjectKey, currentHost, getSettings());
    });

    document.addEventListener('click', e => {
        if (!comboWrapper.contains(e.target)) {
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
        followupState.expandedEditors = new Set();
        loadFollowupDashboard(selectedProjectKey, currentHost, getSettings());
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

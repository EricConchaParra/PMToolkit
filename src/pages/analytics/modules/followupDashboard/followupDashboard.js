/**
 * PMsToolKit — Analytics Hub
 * Follow-up Work Dashboard — notes/alerts, in-review, overdue, capacity
 */

import { NoteDrawer } from '../../../../content/jira/ui/NoteDrawer.js';
import {
    fetchBoardId, fetchSprintIssues, fetchIssueInProgressSince, fetchSpFieldId, jiraFetch,
} from '../jiraApi.js';
import { escapeHtml, spToHours, workingHoursBetween, timeSince } from '../utils.js';
import { getInitialsOrImg } from '../sprintDashboard/devCard.js';
import { enrichChips, clearPrCache } from '../githubPrCache.js';

// ============================================================
// SECTION CLASSIFIER
// ============================================================

function sectionOf(issue, statusMap = {}) {
    const name = issue.fields?.status?.name || '';
    if (statusMap[name]) return statusMap[name];
    const n = name.toLowerCase();
    const cat = issue.fields?.status?.statusCategory?.key || '';
    if (n.includes('in review') || n === 'review') return 'inReview';
    if (n.includes('in progress') || cat === 'indeterminate') return 'inProgress';
    if (n.includes('qa') || n.includes('test')) return 'qa';
    if (cat === 'done' || n === 'done') return 'done';
    return 'todo';
}

// ============================================================
// ISSUE CHIP (mirrors Sprint Dashboard chips exactly)
// ============================================================

function issueChip(i, jiraHost, opts = {}) {
    const { isOverdue, reminderTs } = opts;
    const badgeHtml = isOverdue
        ? `<span class="overdue-time-badge">⏰ ${timeSince(i._inProgressSince)}</span>`
        : (reminderTs ? `<span class="overdue-time-badge">🔔 ${new Date(reminderTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>` : '');

    const { initials, imgUrl } = getInitialsOrImg(i.fields?.assignee);
    const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${escapeHtml(i.fields?.assignee?.displayName || '?')}">`
        : initials;
    const assigneeName = escapeHtml(i.fields?.assignee?.displayName || 'Unassigned');

    return `
        <div class="issue-chip${isOverdue ? ' issue-chip-overdue' : ''} in-progress-chip" data-gh-key="${i.key}">
            <div class="issue-chip-main">
                <div class="issue-chip-top">
                    <a class="issue-chip-key" href="https://${jiraHost}/browse/${i.key}" target="_blank">${i.key}</a>
                    <span class="issue-chip-status">${escapeHtml(i.fields?.status?.name || '?')}</span>
                    <span class="issue-chip-sp">${i._sp ?? '?'} SP</span>
                    ${badgeHtml}
                </div>
                <div class="issue-chip-assignee">
                    <div class="dev-avatar issue-chip-avatar" title="${assigneeName}">${avatarHtml}</div>
                    <span class="issue-chip-assignee-name">${assigneeName}</span>
                </div>
                <div class="issue-chip-summary" title="${escapeHtml(i.fields?.summary || '')}">${escapeHtml(i.fields?.summary || '')}</div>
            </div>
            <div class="issue-chip-actions">
                <button class="et-notes-btn" data-issue-key="${i.key}" data-summary="${escapeHtml(i.fields?.summary || '')}" title="Notes">📝</button>
                <button class="overdue-copy-btn" title="Copy for Slack" data-key="${i.key}" data-summary="${escapeHtml(i.fields?.summary || '')}" data-url="https://${jiraHost}/browse/${i.key}">🔗</button>
            </div>
        </div>
    `;
}



function attachFollowupEvents(container) {
    if (container.dataset.fuDelegated) return;
    container.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.overdue-copy-btn');
        if (copyBtn) {
            if (copyBtn.dataset.isCopying) return;
            copyBtn.dataset.isCopying = 'true';
            const { key, summary, url } = copyBtn.dataset;
            const plainText = `${key} ${summary}\n${url}`;
            const htmlLink = `<a href="${url}">${key} ${summary}</a>`;
            const orig = copyBtn.textContent;
            const doCopy = () => {
                navigator.clipboard.write([
                    new ClipboardItem({
                        'text/plain': new Blob([plainText], { type: 'text/plain' }),
                        'text/html': new Blob([htmlLink], { type: 'text/html' }),
                    })
                ]).then(() => flash(copyBtn, orig)).catch(() => navigator.clipboard.writeText(plainText).then(() => flash(copyBtn, orig)).catch(() => { delete copyBtn.dataset.isCopying; }));
            };
            try { doCopy(); } catch { navigator.clipboard.writeText(plainText).then(() => flash(copyBtn, orig)).catch(() => { delete copyBtn.dataset.isCopying; }); }
            return;
        }
        const notesBtn = e.target.closest('.et-notes-btn');
        if (notesBtn) {
            const { issueKey, summary } = notesBtn.dataset;
            if (issueKey) NoteDrawer.open(issueKey, summary);
        }
    });
    container.dataset.fuDelegated = 'true';
}

function flash(btn, orig) {
    btn.textContent = '✅';
    btn.style.color = '#36b37e';
    setTimeout(() => {
        btn.textContent = orig;
        btn.style.color = '';
        delete btn.dataset.isCopying;
    }, 1500);
}

// ============================================================
// STATE HELPER
// ============================================================

function showFollowupState(state, msg = '') {
    const ids = ['fu-placeholder', 'fu-loading', 'fu-error', 'fu-content'];
    ids.forEach(id => document.getElementById(id)?.classList.add('hidden'));

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

// ============================================================
// LOAD FOLLOW-UP DASHBOARD
// ============================================================

export async function loadFollowupDashboard(projectKey, host, settings) {
    if (!projectKey || !host) return;

    showFollowupState('loading', 'Connecting to Jira...');
    try {
        // --- Resolve fields & board ---
        showFollowupState('loading', 'Resolving Story Points field...');
        const spFieldId = await fetchSpFieldId(host);

        showFollowupState('loading', 'Finding Scrum board...');
        const boardId = await fetchBoardId(host, projectKey);
        if (!boardId) {
            showFollowupState('error', `No Scrum board found for "${projectKey}".`);
            return;
        }

        // --- Active sprint ---
        showFollowupState('loading', 'Finding active sprint...');
        const sprintData = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=1`);
        const activeSprint = (sprintData.values || [])[0];
        if (!activeSprint) {
            showFollowupState('error', 'No active sprint found for this project.');
            return;
        }

        // --- Fetch issues ---
        showFollowupState('loading', 'Fetching sprint issues...');
        const issues = await fetchSprintIssues(host, activeSprint.id, spFieldId);
        issues.forEach(i => { i._sp = spFieldId ? (Number(i.fields?.[spFieldId]) || 0) : 0; });

        // --- Enrich In Progress since for overdue calc ---
        showFollowupState('loading', 'Checking In Progress durations...');
        const { hoursPerDay = 9, spHours = {}, statusMap = {} } = settings || {};
        const inProgressOrReview = issues.filter(i => {
            const sec = sectionOf(i, statusMap);
            return sec === 'inProgress' || sec === 'inReview';
        });
        const CONCURRENCY = 4;
        for (let i = 0; i < inProgressOrReview.length; i += CONCURRENCY) {
            const batch = inProgressOrReview.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async issue => {
                issue._inProgressSince = await fetchIssueInProgressSince(host, issue.key).catch(() => null);
            }));
        }

        // --- Load notes & reminders from storage ---
        showFollowupState('loading', 'Loading notes and reminders...');
        const now = Date.now();
        let notesMap = {};   // key → noteText
        let alertsMap = {};  // key → reminderTimestamp

        if (typeof chrome !== 'undefined' && chrome.storage) {
            // Build lookup keys for all sprint issues
            const storageKeys = [];
            issues.forEach(i => {
                storageKeys.push(`notes_jira:${i.key}`, `reminder_jira:${i.key}`);
            });
            const stored = await new Promise(resolve => chrome.storage.local.get(storageKeys, resolve));
            issues.forEach(i => {
                const noteVal = stored[`notes_jira:${i.key}`];
                const reminderVal = stored[`reminder_jira:${i.key}`];
                if (noteVal) notesMap[i.key] = noteVal;
                if (reminderVal && reminderVal > now) alertsMap[i.key] = reminderVal; // only future reminders
            });
        }

        // =====================================================
        // SECTION 1 — Tickets with Notes or Alerts
        // =====================================================
        const notedTickets = issues.filter(i => notesMap[i.key] || alertsMap[i.key]);

        // =====================================================
        // SECTION 2 — Tickets In Review
        // =====================================================
        const inReviewTickets = issues.filter(i => sectionOf(i, statusMap) === 'inReview');

        // =====================================================
        // SECTION 3 — Overdue tickets (In Progress / In Review longer than their SP budget)
        // =====================================================
        const overdueTickets = inProgressOrReview.filter(i => {
            const since = i._inProgressSince;
            if (!since) return false;
            const elapsedHours = (now - new Date(since).getTime()) / (1000 * 60 * 60);
            const allowed = spToHours(i._sp, spHours);
            return elapsedHours > allowed;
        });

        // =====================================================
        // SECTION 4 — Engineers at ≥75% capacity
        // =====================================================
        const sprintEnd = activeSprint.endDate ? new Date(activeSprint.endDate) : null;
        const sprintHoursLeft = sprintEnd ? workingHoursBetween(new Date(), sprintEnd, hoursPerDay) : null;

        const devMap = {};
        issues.forEach(i => {
            const key = i.fields?.assignee?.accountId || 'unassigned';
            if (!devMap[key]) devMap[key] = { assignee: i.fields?.assignee || null, issues: [] };
            devMap[key].issues.push(i);
        });

        const engineers = Object.values(devMap).map(dev => {
            const pending = dev.issues.filter(i => {
                const sec = sectionOf(i, statusMap);
                return sec === 'inProgress' || sec === 'inReview' || sec === 'todo';
            });
            const committedHours = pending.reduce((acc, i) => acc + spToHours(i._sp, spHours), 0);
            let capacityPct = 0;
            if (sprintHoursLeft !== null && sprintHoursLeft > 0) {
                capacityPct = Math.min(Math.round((committedHours / sprintHoursLeft) * 100), 150);
            } else if (committedHours > 0) {
                capacityPct = 150;
            }
            return { assignee: dev.assignee, capacityPct, committedHours };
        }).filter(e => e.capacityPct >= 75)
          .sort((a, b) => b.capacityPct - a.capacityPct);

        // =====================================================
        // RENDER
        // =====================================================
        showFollowupState('content');
        renderSection1(notedTickets, issues, host, notesMap, alertsMap);
        renderSection2(inReviewTickets, host, settings);
        renderSection3(overdueTickets, host, settings);
        renderSection4(engineers, sprintHoursLeft);

        // Attach events to the whole content container
        const content = document.getElementById('fu-content');
        attachFollowupEvents(content);
        NoteDrawer.initIndicators();

        // GitHub PR enrichment — uses shared cache (no duplicates with Sprint Dashboard)
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const stored = await new Promise(resolve =>
                chrome.storage.sync.get({ github_pr_link: false, github_pat: '' }, resolve)
            );
            if (stored.github_pr_link && stored.github_pat) {
                enrichChips(content, stored.github_pat);
            }
        }

    } catch (err) {
        console.error('PMsToolKit Follow-up Dashboard:', err);
        showFollowupState('error', err.message || 'Unexpected error loading follow-up dashboard.');
    }
}

// ============================================================
// SECTION RENDERERS
// ============================================================

function renderSection1(tickets, allIssues, host, notesMap, alertsMap) {
    const el = document.getElementById('fu-notes-list');
    if (!el) return;

    const countEl = document.getElementById('fu-notes-count');
    if (countEl) countEl.textContent = tickets.length;

    if (tickets.length === 0) {
        el.innerHTML = `<div class="fu-empty-state">✅ No tickets with notes or reminders</div>`;
        return;
    }

    el.innerHTML = tickets.map(i => {
        const noteText = notesMap[i.key];
        const reminderTs = alertsMap[i.key];
        const tags = [];
        if (noteText) tags.push(`<span class="fu-tag fu-tag-note">📝 Note</span>`);
        if (reminderTs) tags.push(`<span class="fu-tag fu-tag-alert">🔔 Alert ${new Date(reminderTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`);

        const { initials, imgUrl } = getInitialsOrImg(i.fields?.assignee);
        const avatarHtml = imgUrl
            ? `<img src="${imgUrl}" alt="${escapeHtml(i.fields?.assignee?.displayName || '?')}">`
            : initials;
        const assigneeName = escapeHtml(i.fields?.assignee?.displayName || 'Unassigned');

        return `
            <div class="issue-chip in-progress-chip" data-gh-key="${i.key}">
                <div class="issue-chip-main">
                    <div class="issue-chip-top">
                        <a class="issue-chip-key" href="https://${host}/browse/${i.key}" target="_blank">${i.key}</a>
                        <span class="issue-chip-status">${escapeHtml(i.fields?.status?.name || '?')}</span>
                        <span class="issue-chip-sp">${i._sp ?? '?'} SP</span>
                        ${tags.join('')}
                    </div>
                    <div class="issue-chip-assignee">
                        <div class="dev-avatar issue-chip-avatar" title="${assigneeName}">${avatarHtml}</div>
                        <span class="issue-chip-assignee-name">${assigneeName}</span>
                    </div>
                    <div class="issue-chip-summary" title="${escapeHtml(i.fields?.summary || '')}">${escapeHtml(i.fields?.summary || '')}</div>
                    ${noteText ? `<div class="fu-note-preview">${escapeHtml(noteText)}</div>` : ''}
                </div>
                <div class="issue-chip-actions">
                    <button class="et-notes-btn" data-issue-key="${i.key}" data-summary="${escapeHtml(i.fields?.summary || '')}" title="Notes">📝</button>
                    <button class="overdue-copy-btn" title="Copy for Slack" data-key="${i.key}" data-summary="${escapeHtml(i.fields?.summary || '')}" data-url="https://${host}/browse/${i.key}">🔗</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderSection2(tickets, host, settings) {
    const el = document.getElementById('fu-review-list');
    if (!el) return;

    const countEl = document.getElementById('fu-review-count');
    if (countEl) countEl.textContent = tickets.length;

    if (tickets.length === 0) {
        el.innerHTML = `<div class="fu-empty-state">✅ No tickets currently In Review</div>`;
        return;
    }
    el.innerHTML = tickets.map(i => issueChip(i, host)).join('');
}

function renderSection3(tickets, host, settings) {
    const el = document.getElementById('fu-overdue-list');
    if (!el) return;

    const countEl = document.getElementById('fu-overdue-count');
    if (countEl) countEl.textContent = tickets.length;

    if (tickets.length === 0) {
        el.innerHTML = `<div class="fu-empty-state">✅ No overdue tickets</div>`;
        return;
    }
    el.innerHTML = tickets.map(i => issueChip(i, host, { isOverdue: true })).join('');
}

function renderSection4(engineers, sprintHoursLeft) {
    const el = document.getElementById('fu-capacity-list');
    if (!el) return;

    const countEl = document.getElementById('fu-capacity-count');
    if (countEl) countEl.textContent = engineers.length;

    if (engineers.length === 0) {
        el.innerHTML = `<div class="fu-empty-state">✅ No engineers above 75% capacity</div>`;
        return;
    }

    el.innerHTML = engineers.map(e => {
        const { initials, imgUrl } = getInitialsOrImg(e.assignee);
        const avatarHtml = imgUrl
            ? `<img src="${imgUrl}" alt="${escapeHtml(e.assignee?.displayName || '?')}">`
            : initials;
        const barClass = e.capacityPct > 110 ? 'danger' : e.capacityPct > 85 ? 'warning' : 'safe';
        const barWidth = Math.min(e.capacityPct, 100);
        const name = escapeHtml(e.assignee?.displayName || 'Unassigned');
        const tooltip = sprintHoursLeft !== null
            ? `${e.committedHours.toFixed(1)}h needed / ${sprintHoursLeft.toFixed(1)}h capacity`
            : '';

        return `
            <div class="fu-engineer-row">
                <div class="dev-avatar fu-engineer-avatar">${avatarHtml}</div>
                <div class="fu-engineer-info">
                    <div class="fu-engineer-name">${name}</div>
                    <div class="capacity-bar-track fu-engineer-bar">
                        <div class="capacity-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                    </div>
                </div>
                <div class="fu-engineer-pct ${barClass}" data-tooltip="${tooltip}">
                    ${e.capacityPct}%
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// INIT — wires up the project combobox
// ============================================================

export function initFollowupCombo(allProjects, currentHost, initialProjectKey = '', getSettings) {
    let fuSelectedProjectKey = '';

    const fuSearch = document.getElementById('fu-project-search');
    const fuDropdown = document.getElementById('fu-project-dropdown');
    const fuComboWrapper = document.getElementById('fu-combo-wrapper');
    if (!fuSearch || !fuDropdown || !fuComboWrapper) return;

    function renderFuOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const filtered = allProjects.filter(p => !term || p.name.toLowerCase().includes(term) || p.key.toLowerCase().includes(term));
        if (filtered.length === 0) {
            fuDropdown.innerHTML = `<div class="combo-msg">No projects found</div>`;
            return;
        }
        fuDropdown.innerHTML = filtered.map(p => `
            <div class="combo-option ${p.key === fuSelectedProjectKey ? 'selected' : ''}" data-key="${p.key}" data-name="${escapeHtml(p.name)}">
                <span class="combo-option-key">${p.key}</span>${escapeHtml(p.name)}
            </div>
        `).join('');
    }

    fuSearch.addEventListener('focus', () => {
        fuSearch.select();
        fuDropdown.classList.remove('hidden');
        renderFuOptions('');
    });

    fuSearch.addEventListener('input', e => {
        fuDropdown.classList.remove('hidden');
        renderFuOptions(e.target.value);
    });

    fuDropdown.addEventListener('click', e => {
        const option = e.target.closest('.combo-option');
        if (!option) return;
        fuSelectedProjectKey = option.dataset.key;
        fuSearch.value = `${option.dataset.name} (${option.dataset.key})`;
        fuDropdown.classList.add('hidden');
        loadFollowupDashboard(fuSelectedProjectKey, currentHost, getSettings());
    });

    document.addEventListener('click', e => {
        if (!fuComboWrapper.contains(e.target)) {
            fuDropdown.classList.add('hidden');
            if (fuSelectedProjectKey) {
                const p = allProjects.find(pr => pr.key === fuSelectedProjectKey);
                if (p) fuSearch.value = `${p.name} (${p.key})`;
            } else {
                fuSearch.value = '';
            }
        }
    });

    document.getElementById('fu-refresh-btn')?.addEventListener('click', () => {
        if (fuSelectedProjectKey) loadFollowupDashboard(fuSelectedProjectKey, currentHost, getSettings());
    });

    if (allProjects.length > 0) fuSearch.placeholder = 'Search project...';

    // Auto-load if initial project provided
    if (initialProjectKey) {
        const p = allProjects.find(pr => pr.key === initialProjectKey);
        if (p) {
            fuSelectedProjectKey = initialProjectKey;
            fuSearch.value = `${p.name} (${p.key})`;
            loadFollowupDashboard(initialProjectKey, currentHost, getSettings());
        }
    }
}

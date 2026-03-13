/**
 * PMsToolKit — Analytics Hub
 * Sprint Dashboard controller — data loading, state management, GitHub PR enrichment
 */

import { NoteDrawer } from '../../../../content/jira/ui/NoteDrawer.js';
import {
    fetchBoardId, fetchSprintIssues, fetchIssueInProgressSince,
    fetchClosedSprints, fetchSprintDoneIssues, fetchSpFieldId,
    jiraFetch,
} from '../jiraApi.js';
import { workingHoursBetween, formatDate, formatHours } from '../utils.js';
import { renderDevCard } from './devCard.js';
import { renderSprintOverview } from './sprintOverview.js';
import { enrichChips, clearPrCache } from '../githubPrCache.js';

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

export function getCurrentSprints() { return _currentSprints; }
export function getSelectedSprintId() { return _selectedSprintId; }
export function setSelectedSprintId(id) { _selectedSprintId = id; }
export function setHost(h) { _host = h; }
export function setSpFieldId(id) { _spFieldId = id; }
export function setSettings(s) { _settings = s; }
export function getSpFieldId() { return _spFieldId; }

// ============================================================
// DASH STATE
// ============================================================

export function showDashState(state, msg = '') {
    document.getElementById('dash-loading').classList.add('hidden');
    document.getElementById('dash-error').classList.add('hidden');
    document.getElementById('dash-empty').classList.add('hidden');
    document.getElementById('dash-placeholder').classList.add('hidden');
    document.getElementById('dev-cards-grid').classList.add('hidden');
    document.getElementById('sprint-banner').classList.add('hidden');
    document.getElementById('sprint-overview').classList.add('hidden');

    if (state === 'loading') {
        document.getElementById('dash-loading').classList.remove('hidden');
        if (msg) document.getElementById('dash-loading-text').textContent = msg;
    } else if (state === 'error') {
        document.getElementById('dash-error').classList.remove('hidden');
        if (msg) document.getElementById('dash-error-text').textContent = msg;
    } else if (state === 'empty') {
        document.getElementById('dash-empty').classList.remove('hidden');
    } else if (state === 'placeholder') {
        document.getElementById('dash-placeholder').classList.remove('hidden');
    } else if (state === 'data') {
        document.getElementById('sprint-banner').classList.remove('hidden');
        document.getElementById('sprint-overview').classList.remove('hidden');
        document.getElementById('dev-cards-grid').classList.remove('hidden');
    }
}



export async function loadDashboard(projectKey) {
    if (!projectKey) { showDashState('placeholder'); return; }
    showDashState('loading', 'Connecting to Jira...');

    try {
        const host = _host;
        const settings = _settings;

        if (!_spFieldId) {
            showDashState('loading', 'Detecting Story Points field...');
            _spFieldId = await fetchSpFieldId(host);
        }

        showDashState('loading', 'Finding Scrum board...');
        const boardId = await fetchBoardId(host, projectKey);
        _currentBoardId = boardId;
        if (!boardId) {
            showDashState('error', `No Scrum board found for project "${projectKey}". Make sure it has a Scrum board.`);
            document.getElementById('sprint-select-container').classList.add('hidden');
            return;
        }

        showDashState('loading', 'Fetching sprints...');
        let allSprints = [];
        let startAt = 0;
        while (true) {
            const data = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&startAt=${startAt}&maxResults=50`);
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

        loadDashboardForSprint(activeSprint);

    } catch (err) {
        console.error('PMsToolKit Dashboard:', err);
        showDashState('error', err.message || 'Unexpected error loading dashboard.');
        document.getElementById('sprint-select-container').classList.add('hidden');
    }
}

// ============================================================
// LOAD DASHBOARD FOR SPRINT (sprint selection → render)
// ============================================================

export async function loadDashboardForSprint(sprint) {
    showDashState('loading', 'Loading sprint details...');
    try {
        const host = _host;
        const settings = _settings;
        const boardId = _currentBoardId;

        if (!sprint) {
            showDashState('empty');
            return;
        }

        // Ensure SP field is resolved
        if (!_spFieldId) {
            showDashState('loading', 'Detecting Story Points field...');
            _spFieldId = await fetchSpFieldId(host);
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

        if (issues.length === 0) {
            showDashState('empty');
            return;
        }

        // Attach SP to each issue
        issues.forEach(i => {
            i._sp = _spFieldId ? (Number(i.fields?.[_spFieldId]) || 0) : 0;
        });

        // Group by assignee
        const devMap = {};
        issues.forEach(i => {
            const key = i.fields?.assignee?.accountId || 'unassigned';
            if (!devMap[key]) devMap[key] = { assignee: i.fields?.assignee || null, issues: [] };
            devMap[key].issues.push(i);
        });

        // Fetch "In Progress since" for In Progress issues
        showDashState('loading', 'Checking In Progress durations...');
        const inProgressAll = issues.filter(i => {
            const cat = i.fields?.status?.statusCategory?.key || '';
            const name = (i.fields?.status?.name || '').toLowerCase();
            return cat === 'indeterminate' || name.includes('progress');
        });

        const CONCURRENCY = 4;
        for (let i = 0; i < inProgressAll.length; i += CONCURRENCY) {
            const batch = inProgressAll.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async issue => {
                issue._inProgressSince = await fetchIssueInProgressSince(host, issue.key).catch(() => null);
            }));
        }

        // Fetch velocity: last 3 closed sprints
        showDashState('loading', 'Calculating velocity...');
        const closedSprints = await fetchClosedSprints(host, boardId, 3).catch(() => []);

        const velocityByDev = {};
        for (const cs of closedSprints) {
            const doneIssues = await fetchSprintDoneIssues(host, cs.id, _spFieldId).catch(() => []);
            doneIssues.forEach(i => {
                const key = i.fields?.assignee?.accountId || 'unassigned';
                const sp = Number(i.fields?.[_spFieldId] || 0);
                if (!velocityByDev[key]) velocityByDev[key] = [];
                const existing = velocityByDev[key].find(x => x.sprintId === cs.id);
                if (existing) existing.sp += sp;
                else velocityByDev[key].push({ sprintId: cs.id, name: cs.name, sp });
            });
        }

        // Compute velocity stats per dev
        function getVelocity(accountId) {
            const spList = velocityByDev[accountId] || [];
            if (spList.length === 0) return { avg: 0, sprints: [], trend: 'same' };
            const total = spList.reduce((a, s) => a + s.sp, 0);
            const avg = Math.round((total / spList.length) * 10) / 10;
            let trend = 'same';
            if (spList.length >= 2) {
                const last = spList[spList.length - 1].sp;
                const prev = spList[spList.length - 2].sp;
                trend = last > prev ? 'up' : last < prev ? 'down' : 'same';
            }
            return { avg, sprints: spList, trend };
        }

        // Render cards
        showDashState('data');
        const grid = document.getElementById('dev-cards-grid');
        grid.innerHTML = '';

        const sortedDevs = Object.values(devMap).sort((a, b) => {
            const aName = a.assignee?.displayName || 'Unassigned';
            const bName = b.assignee?.displayName || 'Unassigned';
            return aName.localeCompare(bName);
        });

        for (const dev of sortedDevs) {
            const accountId = dev.assignee?.accountId || 'unassigned';
            const velocity = getVelocity(accountId);
            const card = renderDevCard(
                { assignee: dev.assignee, issues: dev.issues, velocity },
                sprint.endDate,
                settings,
                host
            );
            grid.appendChild(card);
        }

        // Render sprint overview panel
        const devCount = Object.keys(devMap).length;
        const totalCommittedSP = issues.reduce((a, i) => a + (i._sp || 0), 0);
        const teamVelAvg = Object.keys(devMap).reduce((sum, key) => {
            const accountId = devMap[key].assignee?.accountId || key;
            return sum + (getVelocity(accountId)?.avg || 0);
        }, 0);
        document.querySelectorAll('.prediction-velocity-hint').forEach(el => el.remove());
        renderSprintOverview(issues, sprint, settings, devCount, Math.round(teamVelAvg * 10) / 10, totalCommittedSP);

        // GitHub PR enrichment (unified cache — clears first so Refresh fetches fresh data)
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const stored = await new Promise(resolve =>
                chrome.storage.sync.get({ github_pr_link: false, github_pat: '' }, resolve)
            );
            if (stored.github_pr_link && stored.github_pat) {
                const grid = document.getElementById('dev-cards-grid');
                clearPrCache();
                enrichChips(grid, stored.github_pat);
            }
        }

        // Event delegation — copy-for-Slack + Notes
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
                    const { issueKey, summary } = notesBtn.dataset;
                    if (issueKey) NoteDrawer.open(issueKey, summary);
                    return;
                }
            }, { once: false });
            grid.dataset.delegated = 'true';
        }

        // Initialize note indicators
        NoteDrawer.initIndicators();

    } catch (err) {
        console.error('PMsToolKit Dashboard:', err);
        showDashState('error', err.message || 'Unexpected error loading sprint.');
    }
}

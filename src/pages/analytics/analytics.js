/**
 * PMsToolKit — Analytics Hub
 * Sprint Dashboard + History Exporter
 */

// ============================================================
// DEFAULTS & CONSTANTS
// ============================================================

const DEFAULT_SP_HOURS = {
    0: 9,    // null / unpointed
    1: 2.25,
    2: 4.5,
    3: 9,
    5: 18,
    8: 27,
    13: 45,
};

const DEFAULT_HOURS_PER_DAY = 9;

// SP to hours — for any SP not in default table, interpolate via nearest
function spToHours(sp, scale) {
    const key = sp == null || sp === 0 ? 0 : sp;
    if (scale[key] !== undefined) return scale[key];
    // For unusual SP values, use a rough linear interpolation vs 13 SP
    const ref = scale[13] || 45;
    return (key / 13) * ref;
}

// ============================================================
// SETTINGS STORAGE
// ============================================================

const LAST_PROJECT_KEY = 'sdk_last_project';

function settingsStorageKey(projectKey) {
    return `sdk_settings_${projectKey}`;
}

function loadSettings(projectKey) {
    return new Promise(resolve => {
        const defaults = { hoursPerDay: DEFAULT_HOURS_PER_DAY, spHours: { ...DEFAULT_SP_HOURS }, statusMap: {} };
        if (!projectKey || !(typeof chrome !== 'undefined' && chrome.storage)) {
            resolve(defaults);
            return;
        }
        chrome.storage.local.get([settingsStorageKey(projectKey)], result => {
            const saved = result[settingsStorageKey(projectKey)] || {};
            resolve({
                hoursPerDay: saved.hoursPerDay || DEFAULT_HOURS_PER_DAY,
                spHours: { ...DEFAULT_SP_HOURS, ...(saved.spHours || {}) },
                statusMap: saved.statusMap || {},
            });
        });
    });
}

function saveSettings(projectKey, settings) {
    return new Promise(resolve => {
        if (!projectKey || !(typeof chrome !== 'undefined' && chrome.storage)) { resolve(); return; }
        chrome.storage.local.set({ [settingsStorageKey(projectKey)]: settings }, resolve);
    });
}

function getLastProject() {
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([LAST_PROJECT_KEY], r => resolve(r[LAST_PROJECT_KEY] || null));
        } else resolve(null);
    });
}

function setLastProject(key) {
    if (typeof chrome !== 'undefined' && chrome.storage)
        chrome.storage.local.set({ [LAST_PROJECT_KEY]: key });
}

// ============================================================
// JIRA HOST
// ============================================================

function getJiraHost() {
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get(['et_jira_host'], result => {
                resolve(result.et_jira_host || null);
            });
        } else {
            resolve(null);
        }
    });
}

// ============================================================
// API HELPERS
// ============================================================

async function jiraFetch(host, path, opts = {}) {
    const url = path.startsWith('http') ? path : `https://${host}${path}`;
    const resp = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', ...opts.headers },
        method: opts.method || 'GET',
        body: opts.body || undefined,
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Jira API ${resp.status}: ${t.slice(0, 200)}`);
    }
    return resp.json();
}

async function fetchProjects(host) {
    let all = [];
    let startAt = 0;
    while (true) {
        const data = await jiraFetch(host, `/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=name`);
        all = all.concat(data.values || []);
        if (data.isLast || (data.values || []).length === 0) break;
        startAt += data.values.length;
    }
    return all;
}

async function fetchBoardId(host, projectKey) {
    const data = await jiraFetch(host, `/rest/agile/1.0/board?projectKeyOrId=${projectKey}&type=scrum&maxResults=1`);
    return data.values?.[0]?.id || null;
}

async function fetchActiveSprint(host, boardId) {
    const data = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=1`);
    return data.values?.[0] || null;
}

async function fetchSprintIssues(host, sprintId, spFieldId) {
    const fields = ['summary', 'status', 'assignee', spFieldId].filter(Boolean);
    let all = [];
    let nextPageToken;
    while (true) {
        const body = {
            jql: `sprint = ${sprintId} AND issuetype not in (Epic, subtask)`,
            fields,
            maxResults: 100,
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;
        const data = await jiraFetch(host, '/rest/api/3/search/jql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
            body: JSON.stringify(body),
        });
        all = all.concat(data.issues || []);
        if (!data.nextPageToken || (data.issues || []).length === 0) break;
        nextPageToken = data.nextPageToken;
    }
    return all;
}

async function fetchIssueInProgressSince(host, issueKey) {
    // Returns ISO string of when issue entered first "In Progress"-category status (most recent)
    const data = await jiraFetch(host, `/rest/api/3/issue/${issueKey}/changelog?maxResults=100`);
    const histories = (data.values || []).reverse(); // newest first
    for (const h of histories) {
        for (const item of (h.items || [])) {
            if (item.field === 'status') {
                const toStatus = (item.toString || '').toLowerCase();
                if (toStatus.includes('progress') || toStatus === 'in progress') {
                    return h.created;
                }
            }
        }
    }
    return null;
}

async function fetchClosedSprints(host, boardId, count = 3) {
    const data = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=50`);
    const all = data.values || [];
    return all.slice(-count); // take last N
}

async function fetchSprintDoneIssues(host, sprintId, spFieldId) {
    const body = {
        jql: `sprint = ${sprintId} AND statusCategory = Done AND issuetype not in (Epic, subtask)`,
        fields: [spFieldId, 'assignee'],
        maxResults: 200,
    };
    const data = await jiraFetch(host, '/rest/api/3/search/jql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
        body: JSON.stringify(body),
    });
    return data.issues || [];
}

async function fetchSpFieldId(host) {
    const fields = await jiraFetch(host, '/rest/api/3/field');
    const spField = fields.find(f => f.name === 'Story Points' || f.name === 'Story points');
    return spField?.id || null;
}

// Returns a deduplicated list of { name, categoryKey } for a project
async function fetchProjectStatuses(host, projectKey) {
    const data = await jiraFetch(host, `/rest/api/3/project/${projectKey}/statuses`);
    const seen = new Set();
    const result = [];
    for (const issueType of (data || [])) {
        for (const s of (issueType.statuses || [])) {
            if (!seen.has(s.name)) {
                seen.add(s.name);
                result.push({ name: s.name, categoryKey: s.statusCategory?.key || '' });
            }
        }
    }
    return result;
}

// ============================================================
// WORKING HOURS UTILS
// ============================================================

// Count working hours between now and a future date (Mon-Fri only)
// Assumes sprint ends at 20:00 (8 PM) on the end date
function workingHoursBetween(fromDate, toDate, hoursPerDay) {
    let hours = 0;

    // Start from the beginning of fromDate's day (or fromDate itself if we want precision, 
    // but the original logic jumped day by day so we'll maintain day-by-day logic)
    const cursor = new Date(fromDate);
    cursor.setHours(0, 0, 0, 0);

    // End date is considered to be at 20:00
    const end = new Date(toDate);
    end.setHours(20, 0, 0, 0);

    // If we're already past the end date + 20:00, return 0
    if (cursor > end) return 0;

    // Special case: if today is the end date, calculate hours remaining today up to 20:00
    const now = new Date();
    if (now.toDateString() === end.toDateString() && now < end) {
        // If it's a weekday
        if (now.getDay() !== 0 && now.getDay() !== 6) {
            // Calculate exact hours remaining today until 20:00
            const hoursRemainingToday = (end.getTime() - Math.max(now.getTime(), now.setHours(20 - hoursPerDay, 0, 0, 0))) / (1000 * 60 * 60);
            return Math.max(0, Math.min(hoursRemainingToday, hoursPerDay));
        }
    }

    // Step day by day
    while (cursor < end) {
        const day = cursor.getDay();

        // If it's a weekday
        if (day !== 0 && day !== 6) {
            // If it's the very first day (today) and we're partway through it
            if (cursor.toDateString() === now.toDateString()) {
                // Approximate remaining hours today based on a 20:00 end-of-day
                const eod = new Date(now);
                eod.setHours(20, 0, 0, 0);
                if (now < eod) {
                    const startOfWorkday = new Date(now);
                    startOfWorkday.setHours(20 - hoursPerDay, 0, 0, 0);
                    // Hours left = time from MAX(now, startOfWorkday) to 20:00
                    const msLeft = eod.getTime() - Math.max(now.getTime(), startOfWorkday.getTime());
                    hours += Math.max(0, Math.min(msLeft / (1000 * 60 * 60), hoursPerDay));
                }
            }
            // If it's the very last day (sprint end date)
            else if (cursor.toDateString() === end.toDateString()) {
                // On the last day, if they get `hoursPerDay` total, and the day ends at 20:00,
                // we just grant the full `hoursPerDay` since the whole day is available.
                hours += hoursPerDay;
            }
            // Any regular middle day
            else {
                hours += hoursPerDay;
            }
        }
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0); // reset to midnight for next iteration
    }

    // Round to 1 decimal place to avoid floating point weirdness
    return Math.round(hours * 10) / 10;
}

// Given remaining hours and start date, compute ETA (skip weekends)
function calculateETA(remainingHours, hoursPerDay) {
    if (remainingHours <= 0) return new Date();
    let hrs = remainingHours;
    const cursor = new Date();
    cursor.setSeconds(0, 0);
    while (hrs > 0) {
        cursor.setDate(cursor.getDate() + 1);
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) {
            hrs -= hoursPerDay;
        }
    }
    return cursor;
}

function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatHours(h) {
    if (h < 1) return `${Math.round(h * 60)}m`;
    return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

// Time since a past date in a human-readable string
function timeSince(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = diff / (1000 * 60 * 60);
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${Math.round(h)}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
}

// ============================================================
// SETTINGS UI
// ============================================================

const SP_KEYS = [0, 1, 2, 3, 5, 8, 13];

// Section options ordered: To Do, In Progress, QA, Done
const SECTION_OPTIONS = [
    { value: 'todo', label: 'To Do' },
    { value: 'inProgress', label: 'In Progress' },
    { value: 'qa', label: 'QA' },
    { value: 'done', label: 'Done' },
];

function populateSettingsUI(settings) {
    document.getElementById('hours-per-day').value = settings.hoursPerDay;
    SP_KEYS.forEach(k => {
        const el = document.getElementById(`sp-${k}`);
        if (el) el.value = settings.spHours[k] ?? DEFAULT_SP_HOURS[k] ?? '';
    });
}

function populateStatusMapUI(statuses, statusMap) {
    const col = document.getElementById('status-map-col');
    if (!col) return;
    if (!statuses || statuses.length === 0) {
        col.innerHTML = `<h4>Status Mapping</h4><p class="status-map-hint">Select a project to configure status mapping.</p>`;
        return;
    }
    const optionsHtml = SECTION_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    col.innerHTML = `
        <h4>Status Mapping</h4>
        <p class="status-map-hint">Assign each project status to a dashboard section.</p>
        <div class="status-map-list">
            ${statuses.map(s => {
        const selected = statusMap[s.name] || guessSection(s);
        return `
                    <div class="status-map-row">
                        <span class="status-map-name">${escapeHtml(s.name)}</span>
                        <select class="status-map-select" data-status="${escapeHtml(s.name)}">
                            ${SECTION_OPTIONS.map(o => `<option value="${o.value}"${selected === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
                        </select>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}

// Guess a section based on status name / category (used as default when no manual mapping)
function guessSection(status) {
    const n = (status.name || '').toLowerCase();
    const cat = (status.categoryKey || '').toLowerCase();
    if (n.includes('in progress') || n.includes('in review')) return 'inProgress';
    if (n.includes('qa') || n.includes('test')) return 'qa';
    if (cat === 'done' || n === 'done' || n.includes('closed') || n.includes('released')) return 'done';
    return 'todo';
}

// Read current status map from the UI
function readStatusMapFromUI() {
    const map = {};
    document.querySelectorAll('.status-map-select').forEach(sel => {
        map[sel.dataset.status] = sel.value;
    });
    return map;
}

// ============================================================
// SIDEBAR NAV
// ============================================================

function initNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            document.getElementById(`view-${view}`)?.classList.add('active');
        });
    });
}

// ============================================================
// SPRINT DASHBOARD RENDERING
// ============================================================

function getInitialsOrImg(assignee) {
    if (!assignee) return { initials: '?', imgUrl: null };
    const avatarUrls = assignee.avatarUrls;
    const imgUrl = avatarUrls?.['48x48'] || avatarUrls?.['32x32'] || null;
    const name = assignee.displayName || '';
    const parts = name.split(' ').filter(Boolean);
    const initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    return { initials, imgUrl };
}

function renderDevCard(devData, sprintEndDate, settings, jiraHost) {
    const { assignee, issues, velocity } = devData;
    const { hoursPerDay, spHours } = settings;

    const now = new Date();
    const sprintEnd = sprintEndDate ? new Date(sprintEndDate) : null;
    const sprintHoursLeft = sprintEnd ? workingHoursBetween(now, sprintEnd, hoursPerDay) : null;

    // ---- Categorize issues using statusMap ----
    function sectionOf(issue) {
        const name = issue.fields?.status?.name || '';
        if (settings.statusMap && settings.statusMap[name]) return settings.statusMap[name];
        // Fallback: guess by status name
        const n = name.toLowerCase();
        const cat = issue.fields?.status?.statusCategory?.key || '';
        if (n.includes('in progress') || n.includes('in review')) return 'inProgress';
        if (n.includes('qa') || n.includes('test')) return 'qa';
        if (cat === 'done' || n === 'done') return 'done';
        return 'todo';
    }

    const inProgressIssues = issues.filter(i => sectionOf(i) === 'inProgress');
    const qaIssues = issues.filter(i => sectionOf(i) === 'qa');
    const doneIssues = issues.filter(i => sectionOf(i) === 'done');
    const todoIssues = issues.filter(i => sectionOf(i) === 'todo');

    // ---- SP remaining: In Progress only (for overdue checks); total committed = To Do + In Progress ----
    const remainingSP = inProgressIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const remainingHours = inProgressIssues.reduce((acc, i) => acc + spToHours(i._sp, spHours), 0);
    const doneSP = doneIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const qaSP = qaIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const todoSP = todoIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const todoHours = todoIssues.reduce((acc, i) => acc + spToHours(i._sp, spHours), 0);
    // Total work for ETA and capacity bar: To Do + In Progress
    const totalCommittedSP = remainingSP + todoSP;
    const totalCommittedHours = remainingHours + todoHours;

    // ETA — based on total committed hours (To Do + In Progress)
    const eta = calculateETA(totalCommittedHours, hoursPerDay);
    const isLate = sprintEnd && eta > sprintEnd;

    // Overload — based on total committed hours
    const isOverloaded = sprintHoursLeft !== null && (totalCommittedHours > sprintHoursLeft);
    let capacityPct = 0;
    if (sprintHoursLeft !== null) {
        if (sprintHoursLeft > 0) {
            capacityPct = Math.min(Math.round((totalCommittedHours / sprintHoursLeft) * 100), 150);
        } else if (totalCommittedHours > 0) {
            capacityPct = 150; // Max out the bar
        }
    }

    // Overdue In Progress — issues that have been in progress longer than their SP time limit
    const overdueIssues = inProgressIssues.filter(i => {
        const since = i._inProgressSince;
        if (!since) return false;
        const elapsedHours = (Date.now() - new Date(since).getTime()) / (1000 * 60 * 60);
        const allowed = spToHours(i._sp, spHours);
        return elapsedHours > allowed;
    });

    // Velocity
    const velAvg = velocity.avg;
    const velSprints = velocity.sprints;
    const velTrend = velocity.trend; // 'up', 'down', 'same'
    const trendEmoji = velTrend === 'up' ? '↑' : velTrend === 'down' ? '↓' : '→';
    const trendClass = velTrend === 'up' ? 'up' : velTrend === 'down' ? 'down' : 'flat';

    // Avatar
    const { initials, imgUrl } = getInitialsOrImg(assignee);
    const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${assignee?.displayName || '?'}">`
        : initials;

    // Capacity bar color
    const barClass = capacityPct > 110 ? 'danger' : capacityPct > 85 ? 'warning' : 'safe';
    const barWidth = Math.min(capacityPct, 100);

    // ---- Helper: compact issue chip ----
    function issueChip(i, opts = {}) {
        const isOverdue = opts.isOverdue;
        return `
            <div class="issue-chip${isOverdue ? ' issue-chip-overdue' : ''}">
                <div class="issue-chip-main">
                    <div class="issue-chip-top">
                        <a class="issue-chip-key" href="https://${jiraHost}/browse/${i.key}" target="_blank">${i.key}</a>
                        <span class="issue-chip-status">${escapeHtml(i.fields?.status?.name || '?')}</span>
                        <span class="issue-chip-sp">${i._sp ?? '?'} SP</span>
                        ${isOverdue ? `<span class="overdue-time-badge">⏰ ${timeSince(i._inProgressSince)}</span>` : ''}
                    </div>
                    <div class="issue-chip-summary" title="${escapeHtml(i.fields?.summary || '')}">${escapeHtml(i.fields?.summary || '')}</div>
                </div>
                <button class="overdue-copy-btn" title="Copy for Slack" data-key="${i.key}" data-summary="${escapeHtml(i.fields?.summary || '')}" data-url="https://${jiraHost}/browse/${i.key}">🔗</button>
            </div>
        `;
    }

    const overdueSet = new Set(overdueIssues.map(i => i.key));

    const inProgressHtml = inProgressIssues.length === 0
        ? `<div class="no-issues">No tickets in progress</div>`
        : inProgressIssues.map(i => issueChip(i, { isOverdue: overdueSet.has(i.key) })).join('');

    const qaHtml = qaIssues.length === 0
        ? `<div class="no-issues">No tickets in QA</div>`
        : qaIssues.map(i => issueChip(i)).join('');

    const doneHtml = doneIssues.length === 0
        ? `<div class="no-issues">No tickets done yet</div>`
        : doneIssues.map(i => issueChip(i)).join('');

    const todoHtml = todoIssues.map(i => issueChip(i)).join('');

    // Velocity HTML
    let velocityHtml = '';
    if (velSprints.length === 0) {
        velocityHtml = `<p class="no-velocity">No closed sprint data available</p>`;
    } else {
        velocityHtml = `
            <div class="velocity-row">
                <div>
                    <div class="velocity-avg">${velAvg}</div>
                    <div class="velocity-label">avg SP / sprint</div>
                </div>
                <div class="velocity-trend ${trendClass}">${trendEmoji}</div>
            </div>
            <div class="velocity-sprints">
                ${velSprints.map(s => `<span class="sprint-pill" title="${escapeHtml(s.name)}"><span class="sprint-pill-name">${escapeHtml(s.name)}</span><span class="sprint-pill-sp">${s.sp} SP</span></span>`).join('')}
            </div>
        `;
    }

    const etaClass = isLate ? 'eta-late' : 'eta-ok';

    const card = document.createElement('div');
    card.className = `dev-card${isOverloaded ? ' overloaded' : ''}`;
    card.innerHTML = `
        <div class="dev-card-header">
            <div class="dev-avatar">${avatarHtml}</div>
            <div class="dev-name-wrap">
                <div class="dev-name">${escapeHtml(assignee?.displayName || 'Unassigned')}</div>
                <div class="dev-issues-count">${issues.length} issue${issues.length !== 1 ? 's' : ''} · ${doneIssues.length} done · ${inProgressIssues.length + qaIssues.length + todoIssues.length} pending</div>
            </div>
            ${isOverloaded ? `<div class="overload-badge">⚠️ Overloaded</div>` : ''}
        </div>
        <div class="dev-card-body">

            <!-- Remaining Work -->
            <div class="dev-section">
                <div class="dev-section-title">📊 Committed Work <span class="section-note">(To Do + In Progress)</span></div>
                <div class="remaining-summary">
                    <span class="remaining-sp">${remainingSP + todoIssues.reduce((a, i) => a + (i._sp || 0), 0)}</span>
                    <span class="remaining-sp-label">SP total</span>
                    <span class="remaining-hours">${formatHours(remainingHours + todoIssues.reduce((a, i) => a + spToHours(i._sp, spHours), 0))}</span>
                </div>
                ${sprintHoursLeft !== null ? `
                <div class="capacity-bar-track">
                    <div class="capacity-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                </div>
                <div class="eta-row">
                    <span class="capacity-tooltip" data-tooltip="${formatHours(totalCommittedHours)} needed / ${formatHours(sprintHoursLeft)} capacity">
                        ${capacityPct}% of sprint capacity
                    </span>
                    ${sprintEnd ? `<span class="eta-value ${etaClass}">ETA: ${formatDate(eta)}</span>` : ''}
                </div>
                ` : `<div class="eta-row"><span class="eta-value">ETA: ${formatDate(eta)}</span></div>`}
                ${doneSP > 0 || qaSP > 0 ? `<div class="done-summary">${doneSP > 0 ? `<span class="done-sp">${doneSP} SP</span> done` : ''}${doneSP > 0 && qaSP > 0 ? ' · ' : ''}${qaSP > 0 ? `<span class="qa-sp">${qaSP} SP</span> in QA` : ''}</div>` : ''}
            </div>

            <!-- In Progress (In Progress + In Review) -->
            <div class="dev-section">
                <div class="dev-section-title">
                    🔵 In Progress (${inProgressIssues.length})
                    ${overdueIssues.length > 0 ? `<span class="overdue-count-badge">${overdueIssues.length} overdue</span>` : ''}
                </div>
                <div class="issue-list">${inProgressHtml}</div>
            </div>

            <!-- QA -->
            <div class="dev-section">
                <div class="dev-section-title">🟣 QA <span class="section-count">(${qaIssues.length})</span></div>
                <div class="issue-list">${qaHtml}</div>
            </div>

            <!-- Done -->
            <div class="dev-section">
                <div class="dev-section-title">✅ Done <span class="section-count">(${doneIssues.length})</span></div>
                <div class="issue-list">${doneHtml}</div>
            </div>

            ${todoIssues.length > 0 ? `
            <!-- To Do -->
            <div class="dev-section">
                <div class="dev-section-title">⬜ To Do <span class="section-count">(${todoIssues.length})</span></div>
                <div class="issue-list">${todoHtml}</div>
            </div>
            ` : ''}

            <!-- Velocity -->
            <div class="dev-section">
                <div class="dev-section-title">⚡ Velocity — Last ${velSprints.length} Sprint${velSprints.length !== 1 ? 's' : ''}</div>
                ${velocityHtml}
            </div>

        </div>
    `;
    return card;
}

// ============================================================
// SPRINT OVERVIEW
// ============================================================

/**
 * Renders the team-level sprint overview panel.
 * @param {Array}  issues       - All sprint issues (with ._sp attached)
 * @param {Object} sprint       - Active sprint object (startDate, endDate, name)
 * @param {Object} settings     - Project settings {hoursPerDay, spHours, statusMap}
 * @param {number} devCount     - Number of unique assignees in this sprint
 * @param {number} teamVelAvg   - Average SP completed per sprint across all devs (from closed sprints, or 0)
 * @param {number} totalCommittedSP - Total SP committed to the sprint
 */
function renderSprintOverview(issues, sprint, settings, devCount, teamVelAvg, totalCommittedSP) {
    const { hoursPerDay, spHours } = settings;

    // ---- Bucket issues using same sectionOf logic as dev cards ----
    function sectionOf(issue) {
        const name = issue.fields?.status?.name || '';
        if (settings.statusMap && settings.statusMap[name]) return settings.statusMap[name];
        const n = name.toLowerCase();
        const cat = issue.fields?.status?.statusCategory?.key || '';
        if (n.includes('in progress') || n.includes('in review')) return 'inProgress';
        if (n.includes('qa') || n.includes('test')) return 'qa';
        if (cat === 'done' || n === 'done') return 'done';
        return 'todo';
    }

    const buckets = { todo: [], inProgress: [], qa: [], done: [] };
    issues.forEach(i => { const s = sectionOf(i); if (buckets[s]) buckets[s].push(i); });

    // ---- SP per bucket ----
    const spFor = list => list.reduce((a, i) => a + (i._sp || 0), 0);
    const spTodo = spFor(buckets.todo);
    const spInProgress = spFor(buckets.inProgress);
    const spQA = spFor(buckets.qa);
    const spDone = spFor(buckets.done);
    const spTotal = spTodo + spInProgress + spQA + spDone;

    // ---- Progress bar: Done + QA + InProgress toward total ----
    const donePct = spTotal > 0 ? Math.round((spDone / spTotal) * 100) : 0;
    const qaPct = spTotal > 0 ? Math.round((spQA / spTotal) * 100) : 0;
    const inProgPct = spTotal > 0 ? Math.round((spInProgress / spTotal) * 100) : 0;

    // ---- Capacity model ----
    const now = new Date();
    const sprintEnd = sprint.endDate ? new Date(sprint.endDate) : null;
    const sprintCapacityHoursPerDev = sprintEnd ? workingHoursBetween(now, sprintEnd, hoursPerDay) : null;
    const teamCapacityHours = (sprintCapacityHoursPerDev !== null && devCount > 0)
        ? sprintCapacityHoursPerDev * devCount
        : null;

    // Remaining work: Todo + InProgress + 50% QA buffer
    const hoursFor = list => list.reduce((a, i) => a + spToHours(i._sp, spHours), 0);
    const remainingHours = hoursFor(buckets.todo) + hoursFor(buckets.inProgress) + (hoursFor(buckets.qa) * 0.5);

    // ---- Prediction ----
    let predIcon, predLabel, predDetail, predClass;

    // Safely calculate usage percentage to handle 0 team capacity
    let usagePct = null;
    if (teamCapacityHours !== null) {
        if (teamCapacityHours > 0) {
            usagePct = Math.round((remainingHours / teamCapacityHours) * 100);
        } else if (remainingHours > 0) {
            usagePct = Infinity;
        } else {
            usagePct = 0;
        }
    }

    if (spDone === spTotal && spTotal > 0) {
        predIcon = '🎉'; predLabel = 'Sprint Complete!'; predClass = 'on-track';
        predDetail = `All ${spTotal} SP delivered.`;
    } else if (teamCapacityHours === null) {
        predIcon = '❓'; predLabel = 'No sprint end date'; predClass = 'unknown';
        predDetail = 'Cannot predict completion without a sprint end date.';
    } else if (teamCapacityHours === 0 && remainingHours > 0) {
        predIcon = '🔴'; predLabel = 'Overloaded — Sprint at Risk'; predClass = 'overloaded';
        predDetail = `Sprint ends today! Team still needs ${formatHours(remainingHours)}, but remaining capacity is 0h.`;
    } else if (usagePct <= 75) {
        predIcon = '🟢'; predLabel = 'On Track'; predClass = 'on-track';
        predDetail = `Team is using ${usagePct}% of remaining capacity (${formatHours(remainingHours)} needed / ${formatHours(teamCapacityHours)} available).`;
    } else if (usagePct <= 100) {
        predIcon = '🟡'; predLabel = 'At Risk'; predClass = 'at-risk';
        predDetail = `Team is using ${usagePct}% of remaining capacity — tight but possible. ${formatHours(remainingHours)} needed vs. ${formatHours(teamCapacityHours)} available.`;
    } else {
        predIcon = '🔴'; predLabel = 'Overloaded — Sprint at Risk'; predClass = 'overloaded';
        predDetail = `Team needs ${formatHours(remainingHours)} but only has ${formatHours(teamCapacityHours)} remaining (${usagePct}% load). Consider re-scoping.`;
    }

    // Overcommitment signal vs. team historical velocity
    let velocityHint = '';
    let velocityClass = 'aligned';
    if (teamVelAvg > 0 && totalCommittedSP > 0) {
        const ratio = Math.round((totalCommittedSP / teamVelAvg) * 100);
        if (ratio > 115) {
            velocityHint = `⚠️ Overcommitted (${ratio}%): ${totalCommittedSP} SP planned vs. ${teamVelAvg} SP avg historical velocity.`;
            velocityClass = 'overcommitted';
        } else if (ratio < 75) {
            velocityHint = `ℹ️ Under-committed (${ratio}%): ${totalCommittedSP} SP planned vs. ${teamVelAvg} SP avg historical velocity.`;
            velocityClass = 'undercommitted';
        } else {
            velocityHint = `⚡ Healthy: Commitment aligns with historical capacity (${totalCommittedSP} SP vs. ${teamVelAvg} avg).`;
            velocityClass = 'aligned';
        }
    }

    // ---- Update DOM ----
    document.getElementById('overview-subtitle').textContent =
        `${issues.length} issues · ${spTotal} SP total · ${devCount} developer${devCount !== 1 ? 's' : ''}`;

    document.getElementById('overview-todo-count').textContent = buckets.todo.length;
    document.getElementById('overview-todo-sp').textContent = `${spTodo} SP`;
    document.getElementById('overview-inprogress-count').textContent = buckets.inProgress.length;
    document.getElementById('overview-inprogress-sp').textContent = `${spInProgress} SP`;
    document.getElementById('overview-qa-count').textContent = buckets.qa.length;
    document.getElementById('overview-qa-sp').textContent = `${spQA} SP`;
    document.getElementById('overview-done-count').textContent = buckets.done.length;
    document.getElementById('overview-done-sp').textContent = `${spDone} SP`;

    document.getElementById('overview-bar-done').style.width = `${donePct}%`;
    document.getElementById('overview-bar-qa').style.width = `${qaPct}%`;
    const inProgBar = document.getElementById('overview-bar-inprogress');
    if (inProgBar) inProgBar.style.width = `${inProgPct}%`;

    document.getElementById('overview-progress-pct').textContent = `${donePct}% complete`;
    document.getElementById('overview-progress-label').textContent =
        `${spDone} SP done · ${spQA} SP in QA · ${spInProgress} SP in prog · ${spTodo} SP todo`;

    const pred = document.getElementById('overview-prediction');
    pred.className = `overview-prediction ${predClass}`;
    document.getElementById('prediction-icon').textContent = predIcon;
    document.getElementById('prediction-label').textContent = predLabel;
    const detailEl = document.getElementById('prediction-detail');
    detailEl.textContent = predDetail;
    if (velocityHint) {
        const hint = document.createElement('div');
        hint.className = `prediction-velocity-hint ${velocityClass}`;
        hint.innerHTML = `<span class="velocity-pill">Team Velocity: ${teamVelAvg} SP</span> ${velocityHint}`;
        detailEl.after(hint);
    }
}

// ============================================================
// MAIN DASHBOARD LOGIC
// ============================================================

let currentHost = null;
let currentSettings = null;
let spFieldId = null;
let currentBoardId = null;
let currentSprints = [];
let selectedSprintId = null;

function showDashState(state, msg = '') {
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

async function loadDashboard(projectKey) {
    if (!projectKey) { showDashState('placeholder'); return; }
    showDashState('loading', 'Connecting to Jira...');

    try {
        const host = currentHost;
        const settings = currentSettings;

        if (!spFieldId) {
            showDashState('loading', 'Detecting Story Points field...');
            spFieldId = await fetchSpFieldId(host);
        }

        showDashState('loading', 'Finding Scrum board...');
        const boardId = await fetchBoardId(host, projectKey);
        currentBoardId = boardId;
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

        currentSprints = allSprints.reverse();

        const sprintContainer = document.getElementById('sprint-select-container');
        if (currentSprints.length === 0) {
            sprintContainer.classList.add('hidden');
            showDashState('empty');
            return;
        }

        sprintContainer.classList.remove('hidden');

        let activeSprint = currentSprints.find(s => s.state === 'active');
        if (!activeSprint) activeSprint = currentSprints[0];

        selectedSprintId = activeSprint.id;
        const sprintSearch = document.getElementById('sprint-search');
        sprintSearch.value = `${activeSprint.state === 'active' ? '🟢 ' : ''}${activeSprint.name}`;

        loadDashboardForSprint(activeSprint);

    } catch (err) {
        console.error('PMsToolKit Dashboard:', err);
        showDashState('error', err.message || 'Unexpected error loading dashboard.');
        document.getElementById('sprint-select-container').classList.add('hidden');
    }
}

async function loadDashboardForSprint(sprint) {
    showDashState('loading', 'Loading sprint details...');
    try {
        const host = currentHost;
        const settings = currentSettings;
        const boardId = currentBoardId;

        if (!sprint) {
            showDashState('empty');
            return;
        }

        // Ensure SP field is resolved
        if (!spFieldId) {
            showDashState('loading', 'Detecting Story Points field...');
            spFieldId = await fetchSpFieldId(host);
        }

        // Sprint banner — update label to reflect sprint state
        const sprintStateLabelMap = { active: 'Active Sprint', closed: 'Closed Sprint', future: 'Future Sprint' };
        const sprintBannerLabel = document.querySelector('.sprint-banner .sprint-label');
        if (sprintBannerLabel) sprintBannerLabel.textContent = sprintStateLabelMap[sprint.state] || 'Sprint';

        // Sprint banner
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
        const issues = await fetchSprintIssues(host, sprint.id, spFieldId);

        if (issues.length === 0) {
            showDashState('empty');
            return;
        }

        // Attach SP to each issue
        issues.forEach(i => {
            i._sp = spFieldId ? (Number(i.fields?.[spFieldId]) || 0) : 0;
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

        // Fetch done issues for each closed sprint
        const velocityByDev = {}; // accountId -> [{name, sp}]
        for (const cs of closedSprints) {
            const doneIssues = await fetchSprintDoneIssues(host, cs.id, spFieldId).catch(() => []);
            doneIssues.forEach(i => {
                const key = i.fields?.assignee?.accountId || 'unassigned';
                const sp = Number(i.fields?.[spFieldId] || 0);
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
            // Overloaded first, then alphabetical
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
        // Team velocity = sum of all devs' avg velocity
        const teamVelAvg = Object.keys(devMap).reduce((sum, key) => {
            const accountId = devMap[key].assignee?.accountId || key;
            return sum + (getVelocity(accountId)?.avg || 0);
        }, 0);
        // Clear any stale velocity hint from previous load
        document.querySelectorAll('.prediction-velocity-hint').forEach(el => el.remove());
        renderSprintOverview(issues, sprint, settings, devCount, Math.round(teamVelAvg * 10) / 10, totalCommittedSP);

        // Event delegation — copy-for-Slack on overdue issue buttons
        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.overdue-copy-btn');
            if (!btn) return;
            const { key, summary, url } = btn.dataset;
            const plainText = `${key} ${summary}\n${url}`;
            const htmlLink = `<a href="${url}">${key} ${summary}</a>`;
            try {
                navigator.clipboard.write([
                    new ClipboardItem({
                        'text/plain': new Blob([plainText], { type: 'text/plain' }),
                        'text/html': new Blob([htmlLink], { type: 'text/html' }),
                    })
                ]).then(() => {
                    const orig = btn.textContent;
                    btn.textContent = '✅';
                    btn.style.color = '#36b37e';
                    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
                });
            } catch {
                navigator.clipboard.writeText(plainText);
            }
        }, { once: false });

    } catch (err) {
        console.error('PMsToolKit Dashboard:', err);
        showDashState('error', err.message || 'Unexpected error loading sprint.');
    }
}

// ============================================================
// HELPER UTILS
// ============================================================

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ============================================================
// CSV EXPORTER LOGIC
// ============================================================

const TRACKED_FIELDS = ['story points', 'story point estimate', 'description', 'acceptance criteria', 'epic link', 'epic name', 'sprint'];

function isTrackedField(fieldName) {
    const lower = (fieldName || '').toLowerCase();
    return TRACKED_FIELDS.some(f => lower.includes(f));
}

async function csvSearchIssues(host, jql, onProgress) {
    const url = `https://${host}/rest/api/3/search/jql`;
    let nextPageToken;
    const all = [];
    while (true) {
        const body = { jql, maxResults: 100, fields: ['summary', 'parent', 'customfield_10014', 'customfield_10011'] };
        if (nextPageToken) body.nextPageToken = nextPageToken;
        const resp = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Jira API ${resp.status}`);
        const data = await resp.json();
        for (const issue of (data.issues || [])) {
            const f = issue.fields || {};
            const epicKey = f.customfield_10014 || f.parent?.key || '';
            all.push({
                key: issue.key, summary: f.summary || '',
                issueUrl: `https://${host}/browse/${issue.key}`,
                epicKey, epicUrl: epicKey ? `https://${host}/browse/${epicKey}` : '',
                epicName: f.customfield_10011 || f.parent?.fields?.summary || '',
            });
        }
        onProgress(`Found ${all.length} issues...`, 10);
        if (!data.nextPageToken || (data.issues || []).length === 0) break;
        nextPageToken = data.nextPageToken;
        await new Promise(r => setTimeout(r, 80));
    }
    return all;
}

async function csvFetchChangelog(host, issueKey) {
    const all = [];
    let startAt = 0;
    while (true) {
        const resp = await fetch(`https://${host}/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=100`, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
        });
        if (!resp.ok) break;
        const data = await resp.json();
        all.push(...(data.values || []));
        if (all.length >= data.total || (data.values || []).length === 0) break;
        startAt += data.values.length;
    }
    return all;
}

function escapeCSV(v) {
    const str = String(v ?? '').replace(/"/g, '""');
    return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str}"` : str;
}

function buildCSV(issues) {
    const headers = ['Issue Key', 'Issue Summary', 'Issue Link', 'Epic Name', 'Epic Link', 'Timestamp', 'Changed By', 'Field', 'From Value', 'To Value'];
    const rows = [headers.map(escapeCSV).join(',')];
    for (const issue of issues) {
        for (const h of (issue.changelog?.histories || [])) {
            const by = h.author?.displayName || h.author?.name || 'Unknown';
            for (const item of (h.items || [])) {
                if (!isTrackedField(item.field)) continue;
                rows.push([issue.key, issue.fields?.summary || '', issue.issueUrl, issue.epicName, issue.epicUrl, h.created || '', by, item.field, item.fromString ?? item.from ?? '', item.toString ?? item.to ?? ''].map(escapeCSV).join(','));
            }
        }
    }
    return rows.join('\n');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Nav
    initNav();

    // Load settings (no project yet — load without key to get defaults for SP/hours UI)
    currentSettings = await loadSettings(null);
    populateSettingsUI(currentSettings);
    populateStatusMapUI([], {});

    // Get Jira host
    currentHost = await getJiraHost();

    // Settings panel toggle
    const settingsPanel = document.getElementById('settings-panel');
    document.getElementById('settings-toggle-btn').addEventListener('click', () => {
        settingsPanel.classList.toggle('hidden');
    });

    // Save settings
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const hoursPerDay = parseInt(document.getElementById('hours-per-day').value, 10);
        const spHours = {};
        SP_KEYS.forEach(k => {
            const val = parseFloat(document.getElementById(`sp-${k}`)?.value);
            if (!isNaN(val)) spHours[k] = val;
        });
        const statusMap = readStatusMapFromUI();
        currentSettings = { hoursPerDay, spHours, statusMap };
        await saveSettings(selectedProjectKey, currentSettings);
        const msg = document.getElementById('settings-saved-msg');
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 2000);
    });

    // Reset settings
    document.getElementById('reset-settings-btn').addEventListener('click', async () => {
        currentSettings = { hoursPerDay: DEFAULT_HOURS_PER_DAY, spHours: { ...DEFAULT_SP_HOURS }, statusMap: {} };
        await saveSettings(selectedProjectKey, currentSettings);
        populateSettingsUI(currentSettings);
        // Re-populate status map with defaults (guessed)
        if (selectedProjectKey && currentHost) {
            const statuses = await fetchProjectStatuses(currentHost, selectedProjectKey).catch(() => []);
            populateStatusMapUI(statuses, {});
        }
        const msg = document.getElementById('settings-saved-msg');
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 2000);
    });

    // Load projects combobox
    const projectSearch = document.getElementById('project-search');
    const projectDropdown = document.getElementById('project-dropdown');
    const comboWrapper = document.getElementById('combo-wrapper');
    let allProjects = [];
    let selectedProjectKey = '';

    function renderComboOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const filtered = allProjects.filter(p => !term || p.name.toLowerCase().includes(term) || p.key.toLowerCase().includes(term));

        if (filtered.length === 0) {
            projectDropdown.innerHTML = `<div class="combo-msg">No projects found</div>`;
            return;
        }

        projectDropdown.innerHTML = filtered.map(p => `
            <div class="combo-option ${p.key === selectedProjectKey ? 'selected' : ''}" data-key="${p.key}" data-name="${escapeHtml(p.name)}">
                <span class="combo-option-key">${p.key}</span>${escapeHtml(p.name)}
            </div>
        `).join('');
    }

    if (currentHost) {
        try {
            allProjects = await fetchProjects(currentHost);
            projectSearch.placeholder = "Search project...";
            renderComboOptions();
        } catch (e) {
            projectSearch.placeholder = "Failed to load projects";
        }
    } else {
        projectSearch.placeholder = "Log in to Jira first";
    }

    // Helper: select project by key (load settings, statuses, dashboard)
    async function selectProject(projectKey) {
        selectedProjectKey = projectKey;
        setLastProject(projectKey);

        // Load per-project settings
        currentSettings = await loadSettings(projectKey);
        populateSettingsUI(currentSettings);

        // Trigger dashboard
        spFieldId = null;
        loadDashboard(projectKey);

        // Non-blocking: fetch statuses and populate status map
        fetchProjectStatuses(currentHost, projectKey)
            .then(statuses => populateStatusMapUI(statuses, currentSettings.statusMap || {}))
            .catch(() => { });
    }

    // Combobox events
    projectSearch.addEventListener('focus', () => {
        projectSearch.select();
        projectDropdown.classList.remove('hidden');
        renderComboOptions('');
    });

    projectSearch.addEventListener('input', (e) => {
        projectDropdown.classList.remove('hidden');
        renderComboOptions(e.target.value);
    });

    projectDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.combo-option');
        if (!option) return;
        projectSearch.value = `${option.dataset.name} (${option.dataset.key})`;
        projectDropdown.classList.add('hidden');
        selectProject(option.dataset.key);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!comboWrapper.contains(e.target)) {
            projectDropdown.classList.add('hidden');
            if (selectedProjectKey) {
                const p = allProjects.find(pr => pr.key === selectedProjectKey);
                if (p) projectSearch.value = `${p.name} (${p.key})`;
            } else {
                projectSearch.value = '';
            }
        }
    });

    // Auto-restore last project
    const lastProject = await getLastProject();
    if (lastProject && allProjects.find(p => p.key === lastProject)) {
        const p = allProjects.find(pr => pr.key === lastProject);
        projectSearch.value = `${p.name} (${p.key})`;
        await selectProject(lastProject);
    }

    // Load sprints combobox (Sprint Dropdown)
    const sprintSearch = document.getElementById('sprint-search');
    const sprintDropdown = document.getElementById('sprint-dropdown');
    const sprintComboWrapper = document.getElementById('sprint-combo-wrapper');

    function renderSprintComboOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const filtered = currentSprints.filter(s => !term || s.name.toLowerCase().includes(term) || String(s.id).includes(term) || s.state.toLowerCase().includes(term));

        if (filtered.length === 0) {
            sprintDropdown.innerHTML = `<div class="combo-msg">No sprints found</div>`;
            return;
        }

        sprintDropdown.innerHTML = filtered.map(s => {
            let stateIndicator = '';
            if (s.state === 'active') stateIndicator = '🟢 ';
            else if (s.state === 'future') stateIndicator = '🗓️ ';
            else stateIndicator = '📦 ';

            return `
            <div class="combo-option ${s.id === selectedSprintId ? 'selected' : ''}" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-state="${s.state}">
                <span class="combo-option-key">${stateIndicator}${s.state}</span>${escapeHtml(s.name)}
            </div>
            `;
        }).join('');
    }

    sprintSearch.addEventListener('focus', () => {
        sprintSearch.select();
        sprintDropdown.classList.remove('hidden');
        renderSprintComboOptions('');
    });

    sprintSearch.addEventListener('input', (e) => {
        sprintDropdown.classList.remove('hidden');
        renderSprintComboOptions(e.target.value);
    });

    sprintDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.combo-option');
        if (!option) return;
        const id = parseInt(option.dataset.id, 10);
        selectedSprintId = id;
        const sprint = currentSprints.find(s => s.id === id);
        sprintSearch.value = `${sprint.state === 'active' ? '🟢 ' : ''}${sprint.name}`;
        sprintDropdown.classList.add('hidden');
        loadDashboardForSprint(sprint);
    });

    document.addEventListener('click', (e) => {
        if (!sprintComboWrapper.contains(e.target)) {
            sprintDropdown.classList.add('hidden');
            if (selectedSprintId) {
                const s = currentSprints.find(sr => sr.id === selectedSprintId);
                if (s) sprintSearch.value = `${s.state === 'active' ? '🟢 ' : ''}${s.name}`;
            } else {
                sprintSearch.value = '';
            }
        }
    });

    // Remove now-redundant old Refresh listener and replace
    // Refresh
    document.getElementById('refresh-btn').addEventListener('click', () => {
        if (selectedProjectKey) {
            spFieldId = null;
            if (selectedSprintId) {
                const sprint = currentSprints.find(s => s.id === selectedSprintId);
                if (sprint) {
                    loadDashboardForSprint(sprint);
                } else {
                    loadDashboard(selectedProjectKey);
                }
            } else {
                loadDashboard(selectedProjectKey);
            }
        }
    });

    // ---- CSV Exporter ----
    const exportBtn = document.getElementById('export-btn');
    const expProgress = document.getElementById('exp-progress');
    const expProgressBar = document.getElementById('exp-progress-bar');
    const expProgressText = document.getElementById('exp-progress-text');
    const expProgressPct = document.getElementById('exp-progress-pct');
    const expSuccess = document.getElementById('exp-success');
    const expSuccessText = document.getElementById('exp-success-text');
    const expError = document.getElementById('exp-error');
    const expErrorText = document.getElementById('exp-error-text');

    function showExpProgress(text, pct) {
        expProgress.classList.remove('hidden');
        expProgressText.textContent = text;
        expProgressPct.textContent = `${Math.round(pct)}%`;
        expProgressBar.style.width = `${pct}%`;
        expSuccess.classList.add('hidden');
        expError.classList.add('hidden');
    }

    function showExpSuccess(msg) {
        expProgress.classList.add('hidden');
        expSuccessText.textContent = msg;
        expSuccess.classList.remove('hidden');
        expError.classList.add('hidden');
    }

    function showExpError(msg) {
        expProgress.classList.add('hidden');
        expErrorText.textContent = msg;
        expError.classList.remove('hidden');
        expSuccess.classList.add('hidden');
    }

    exportBtn.addEventListener('click', async () => {
        const jql = document.getElementById('jql-input').value.trim();
        if (!jql) { showExpError('Please enter a JQL query.'); return; }

        const host = await getJiraHost();
        if (!host) { showExpError('Could not detect Jira host. Open a Jira tab first.'); return; }

        exportBtn.disabled = true;
        showExpProgress('Searching issues...', 2);

        try {
            const issueList = await csvSearchIssues(host, jql, (text, pct) => showExpProgress(text, pct));
            if (issueList.length === 0) {
                showExpError('No issues found for that JQL query.');
                return;
            }

            const CONCURRENCY = 5;
            const results = [];
            for (let i = 0; i < issueList.length; i += CONCURRENCY) {
                const batch = issueList.slice(i, i + CONCURRENCY);
                const batchResults = await Promise.all(batch.map(async item => {
                    const histories = await csvFetchChangelog(host, item.key);
                    return { ...item, fields: { summary: item.summary }, changelog: { histories } };
                }));
                results.push(...batchResults);
                showExpProgress(`Fetching changelogs: ${Math.min(i + CONCURRENCY, issueList.length)} / ${issueList.length}...`, 10 + ((Math.min(i + CONCURRENCY, issueList.length) / issueList.length) * 85));
            }

            showExpProgress('Building CSV...', 97);
            await new Promise(r => setTimeout(r, 80));
            const csv = buildCSV(results);

            if (csv.split('\n').length <= 1) {
                showExpSuccess(`Fetched ${results.length} issues but found 0 tracked field changes. No file downloaded.`);
                return;
            }

            const dateStr = new Date().toISOString().slice(0, 10);
            downloadFile(csv, `jira_history_${dateStr}.csv`, 'text/csv;charset=utf-8;');
            showExpSuccess(`Done! Exported ${csv.split('\n').length - 1} changes from ${results.length} issues.`);
        } catch (err) {
            showExpError(err.message || 'Unexpected error.');
        } finally {
            exportBtn.disabled = false;
        }
    });

    // JQL chips
    document.querySelectorAll('.jql-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.getElementById('jql-input').value = chip.dataset.jql;
        });
    });
});


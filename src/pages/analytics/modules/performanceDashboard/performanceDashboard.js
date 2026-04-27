/**
 * PMsToolKit — Analytics Hub
 * Performance Dashboard — team metrics across all closed sprints
 */

import {
    fetchBoardId, fetchBoardSprints, fetchSprintDoneIssues,
    fetchSprintIssues, fetchSpFieldId,
} from '../jiraApi.js';
import { escapeHtml } from '../utils.js';
import { getInitialsOrImg } from '../sprintDashboard/devCard.js';
import { getActiveView } from '../nav.js';
import { logAnalyticsPerf, markAnalyticsPerf, measureAnalyticsPerf } from '../analyticsPerf.js';
import { downloadFile, escapeCSV } from '../csvExporter/csvExporter.js';

const perfState = {
    selectedProjectKey: '',
    lastLoadedProjectKey: '',
    host: '',
    loadRequestId: 0,
    boardId: null,
    spFieldId: null,
};

function getPerfExportEls() {
    return {
        status: document.getElementById('perf-export-status'),
        button: document.getElementById('perf-export-btn'),
    };
}

function setPerfExportStatus(kind, message) {
    const { status } = getPerfExportEls();
    if (!status) return;
    if (!message) {
        status.className = 'perf-export-status hidden';
        status.textContent = '';
        return;
    }
    status.textContent = message;
    status.className = `perf-export-status perf-export-status-${kind}`;
}

function getSprintSortValue(sprint) {
    return new Date(sprint?.startDate || sprint?.endDate || 0).getTime() || 0;
}

function roundToOneDecimal(value) {
    return Math.round(value * 10) / 10;
}

export function buildDeveloperVelocityRows(sprintData, spFieldId) {
    const sprintCount = sprintData.length;
    const contribMap = {};

    sprintData.forEach(sprint => {
        (sprint.issues || []).forEach(issue => {
            const key = issue.fields?.assignee?.accountId || 'unassigned';
            const sp = Number(issue.fields?.[spFieldId]) || 0;
            if (!contribMap[key]) {
                contribMap[key] = { assignee: issue.fields?.assignee || null, totalSP: 0, count: 0, sprintSP: new Map() };
            }
            contribMap[key].totalSP += sp;
            contribMap[key].count++;
            contribMap[key].sprintSP.set(sprint.id, (contribMap[key].sprintSP.get(sprint.id) || 0) + sp);
        });
    });

    return Object.values(contribMap)
        .map(contributor => ({
            ...contributor,
            velocity: sprintCount > 0 ? roundToOneDecimal(contributor.totalSP / sprintCount) : 0,
            activeSprintCount: [...contributor.sprintSP.values()].filter(sp => sp > 0).length,
        }))
        .sort((a, b) => b.velocity - a.velocity || b.totalSP - a.totalSP);
}

function buildCapacityReportRows({ projectKey, host, sprints, spFieldId }) {
    return [...sprints]
        .sort((a, b) => getSprintSortValue(a) - getSprintSortValue(b) || String(a.name || '').localeCompare(String(b.name || '')))
        .flatMap(sprint => {
            const sprintIssues = [...(sprint.issues || [])]
                .sort((a, b) => String(a.fields?.assignee?.displayName || 'Unassigned').localeCompare(String(b.fields?.assignee?.displayName || 'Unassigned'))
                    || String(a.key || '').localeCompare(String(b.key || '')));

            return sprintIssues.map(issue => {
                const assignee = issue.fields?.assignee || null;
                return {
                    projectKey,
                    sprintId: sprint.id || '',
                    sprintName: sprint.name || '',
                    sprintState: sprint.state || '',
                    sprintStartDate: sprint.startDate || '',
                    sprintEndDate: sprint.completeDate || sprint.endDate || '',
                    developerName: assignee?.displayName || 'Unassigned',
                    developerAccountId: assignee?.accountId || '',
                    developerEmail: assignee?.emailAddress || '',
                    ticketKey: issue.key || '',
                    ticketSummary: issue.fields?.summary || '',
                    ticketStatus: issue.fields?.status?.name || '',
                    ticketStatusCategory: issue.fields?.status?.statusCategory?.key || '',
                    storyPoints: Number(issue.fields?.[spFieldId]) || 0,
                    ticketUrl: issue.key ? `https://${host}/browse/${issue.key}` : '',
                };
            });
        });
}

export function buildCapacityReportCSV({ projectKey, host, sprints, spFieldId }) {
    const rows = buildCapacityReportRows({ projectKey, host, sprints, spFieldId });
    const teamProjectTickets = rows.length;
    const teamProjectStoryPoints = rows.reduce((sum, row) => sum + row.storyPoints, 0);
    const teamBySprint = new Map();
    const developerByProject = new Map();
    const developerBySprint = new Map();

    for (const row of rows) {
        const sprintKey = String(row.sprintId);
        const devKey = row.developerAccountId || `unassigned:${row.developerName}`;
        const sprintDevKey = `${sprintKey}::${devKey}`;

        if (!teamBySprint.has(sprintKey)) teamBySprint.set(sprintKey, { tickets: 0, storyPoints: 0 });
        if (!developerByProject.has(devKey)) developerByProject.set(devKey, { tickets: 0, storyPoints: 0 });
        if (!developerBySprint.has(sprintDevKey)) developerBySprint.set(sprintDevKey, { tickets: 0, storyPoints: 0 });

        teamBySprint.get(sprintKey).tickets += 1;
        teamBySprint.get(sprintKey).storyPoints += row.storyPoints;
        developerByProject.get(devKey).tickets += 1;
        developerByProject.get(devKey).storyPoints += row.storyPoints;
        developerBySprint.get(sprintDevKey).tickets += 1;
        developerBySprint.get(sprintDevKey).storyPoints += row.storyPoints;
    }

    const headers = [
        'Project Key',
        'Sprint ID',
        'Sprint Name',
        'Sprint State',
        'Sprint Start Date',
        'Sprint End Date',
        'Developer',
        'Developer Account ID',
        'Developer Email',
        'Ticket Key',
        'Ticket Summary',
        'Ticket Status',
        'Ticket Status Category',
        'Story Points',
        'Ticket URL',
        'Developer Sprint Tickets',
        'Developer Sprint Story Points',
        'Developer Project Tickets',
        'Developer Project Story Points',
        'Team Sprint Tickets',
        'Team Sprint Story Points',
        'Team Project Tickets',
        'Team Project Story Points',
    ];

    const csvRows = [headers.map(escapeCSV).join(',')];
    for (const row of rows) {
        const sprintKey = String(row.sprintId);
        const devKey = row.developerAccountId || `unassigned:${row.developerName}`;
        const sprintDevKey = `${sprintKey}::${devKey}`;
        const sprintTotals = teamBySprint.get(sprintKey) || { tickets: 0, storyPoints: 0 };
        const devProjectTotals = developerByProject.get(devKey) || { tickets: 0, storyPoints: 0 };
        const devSprintTotals = developerBySprint.get(sprintDevKey) || { tickets: 0, storyPoints: 0 };

        csvRows.push([
            row.projectKey,
            row.sprintId,
            row.sprintName,
            row.sprintState,
            row.sprintStartDate,
            row.sprintEndDate,
            row.developerName,
            row.developerAccountId,
            row.developerEmail,
            row.ticketKey,
            row.ticketSummary,
            row.ticketStatus,
            row.ticketStatusCategory,
            row.storyPoints,
            row.ticketUrl,
            devSprintTotals.tickets,
            devSprintTotals.storyPoints,
            devProjectTotals.tickets,
            devProjectTotals.storyPoints,
            sprintTotals.tickets,
            sprintTotals.storyPoints,
            teamProjectTickets,
            teamProjectStoryPoints,
        ].map(escapeCSV).join(','));
    }

    return csvRows.join('\n');
}

async function loadCapacityExportData(projectKey, host, onProgress = () => {}) {
    if (!projectKey || !host) throw new Error('Select a project first.');

    const boardId = perfState.boardId || await fetchBoardId(host, projectKey);
    if (!boardId) throw new Error(`No Scrum board found for "${projectKey}".`);
    perfState.boardId = boardId;

    const spFieldId = perfState.spFieldId || await fetchSpFieldId(host);
    perfState.spFieldId = spFieldId;

    onProgress('Fetching active and closed sprints...', 10);
    const allSprints = await fetchBoardSprints(host, boardId, ['active', 'closed']);
    const scopedSprints = allSprints
        .filter(sprint => sprint.state !== 'future')
        .sort((a, b) => getSprintSortValue(a) - getSprintSortValue(b) || String(a.name || '').localeCompare(String(b.name || '')));

    if (scopedSprints.length === 0) throw new Error('No active or closed sprints found for this project.');

    const sprintData = [];
    const concurrency = 4;
    for (let i = 0; i < scopedSprints.length; i += concurrency) {
        const batch = scopedSprints.slice(i, i + concurrency);
        const results = await Promise.all(batch.map(async sprint => ({
            ...sprint,
            issues: await fetchSprintIssues(host, sprint.id, spFieldId).catch(() => []),
        })));
        sprintData.push(...results);
        const completed = Math.min(i + concurrency, scopedSprints.length);
        onProgress(`Fetching sprint tickets: ${completed} / ${scopedSprints.length}...`, 10 + ((completed / scopedSprints.length) * 80));
    }

    return { spFieldId, sprints: sprintData };
}

async function exportCapacityCsv() {
    const { button } = getPerfExportEls();
    if (!button) return;

    if (!perfState.selectedProjectKey || !perfState.host) {
        setPerfExportStatus('error', 'Select a project before exporting.');
        return;
    }

    button.disabled = true;
    setPerfExportStatus('info', 'Preparing detailed capacity export...');

    try {
        const { sprints, spFieldId } = await loadCapacityExportData(
            perfState.selectedProjectKey,
            perfState.host,
            message => setPerfExportStatus('info', message),
        );
        setPerfExportStatus('info', 'Building CSV...');

        const csv = buildCapacityReportCSV({
            projectKey: perfState.selectedProjectKey,
            host: perfState.host,
            sprints,
            spFieldId,
        });
        const dateStr = new Date().toISOString().slice(0, 10);
        downloadFile(csv, `${perfState.selectedProjectKey.toLowerCase()}_capacity_report_${dateStr}.csv`, 'text/csv;charset=utf-8;');
        setPerfExportStatus('success', `Exported ${csv.split('\n').length - 1} detailed ticket rows across ${sprints.length} sprints.`);
    } catch (err) {
        console.error('PMsToolKit PerfDashboard export:', err);
        setPerfExportStatus('error', err.message || 'Unexpected error exporting CSV.');
    } finally {
        button.disabled = false;
    }
}

// ============================================================
// LOAD PERFORMANCE DASHBOARD
// ============================================================

export async function loadPerfDashboard(projectKey, host) {
    if (!projectKey || !host) return;
    const requestId = ++perfState.loadRequestId;
    perfState.selectedProjectKey = projectKey;
    perfState.host = host;
    perfState.boardId = null;
    perfState.spFieldId = null;
    setPerfExportStatus('', '');

    const showState = (state, msg = '') => {
        document.getElementById('perf-placeholder').classList.add('hidden');
        document.getElementById('perf-loading').classList.add('hidden');
        document.getElementById('perf-error').classList.add('hidden');
        document.getElementById('perf-content').classList.add('hidden');
        if (state === 'loading') {
            document.getElementById('perf-loading').classList.remove('hidden');
            if (msg) document.getElementById('perf-loading-text').textContent = msg;
        } else if (state === 'error') {
            document.getElementById('perf-error').classList.remove('hidden');
            if (msg) document.getElementById('perf-error-text').textContent = msg;
        } else if (state === 'content') {
            document.getElementById('perf-content').classList.remove('hidden');
        }
    };

    showState('loading', 'Finding board...');
    try {
        markAnalyticsPerf(`perf:${projectKey}:start`);
        const boardId = await fetchBoardId(host, projectKey);
        if (requestId !== perfState.loadRequestId) return;
        perfState.boardId = boardId;
        if (!boardId) { showState('error', `No Scrum board found for "${projectKey}".`); return; }

        showState('loading', 'Fetching all closed sprints...');
        const closedSprints = (await fetchBoardSprints(host, boardId, ['closed']))
            .sort((a, b) => getSprintSortValue(a) - getSprintSortValue(b) || String(a.name || '').localeCompare(String(b.name || '')));
        if (requestId !== perfState.loadRequestId) return;
        if (closedSprints.length === 0) { showState('error', 'No closed sprints found. Complete at least one sprint first.'); return; }

        showState('loading', 'Resolving Story Points field...');
        const spFId = await fetchSpFieldId(host);
        if (requestId !== perfState.loadRequestId) return;
        perfState.spFieldId = spFId;

        showState('loading', 'Loading sprint data...');
        const sprintData = [];
        const sprintConcurrency = 4;
        for (let i = 0; i < closedSprints.length; i += sprintConcurrency) {
            const batch = closedSprints.slice(i, i + sprintConcurrency);
            const results = await Promise.all(batch.map(async cs => {
                const issues = await fetchSprintDoneIssues(host, cs.id, spFId).catch(() => []);
                return {
                    id: cs.id,
                    name: cs.name,
                    startDate: cs.startDate,
                    endDate: cs.completeDate || cs.endDate,
                    issues,
                };
            }));
            sprintData.push(...results);
            showState('loading', `Loading sprint data: ${Math.min(i + sprintConcurrency, closedSprints.length)} / ${closedSprints.length}...`);
            if (requestId !== perfState.loadRequestId) return;
        }
        if (requestId !== perfState.loadRequestId) return;

        // ---- KPI calculations ----
        const sprintCount = sprintData.length;
        const totalIssues = sprintData.reduce((a, s) => a + s.issues.length, 0);
        const totalSP = sprintData.reduce((a, s) => a + s.issues.reduce((b, i) => b + (Number(i.fields?.[spFId]) || 0), 0), 0);
        const avgThroughput = roundToOneDecimal(totalIssues / sprintCount);
        const avgVelocity = roundToOneDecimal(totalSP / sprintCount);

        // Trend: compare last sprint vs previous
        const velocityBySprintArr = sprintData.map(s => s.issues.reduce((a, i) => a + (Number(i.fields?.[spFId]) || 0), 0));
        let velTrend = 'flat', velTrendClass = 'perf-kpi-trend-flat';
        if (velocityBySprintArr.length >= 2) {
            const last = velocityBySprintArr[velocityBySprintArr.length - 1];
            const prev = velocityBySprintArr[velocityBySprintArr.length - 2];
            if (last > prev) { velTrend = '↑'; velTrendClass = 'perf-kpi-trend-up'; }
            else if (last < prev) { velTrend = '↓'; velTrendClass = 'perf-kpi-trend-down'; }
            else { velTrend = '→'; }
        }

        const throughputBySprintArr = sprintData.map(s => s.issues.length);
        let tpTrend = '→', tpTrendClass = 'perf-kpi-trend-flat';
        if (throughputBySprintArr.length >= 2) {
            const last = throughputBySprintArr[throughputBySprintArr.length - 1];
            const prev = throughputBySprintArr[throughputBySprintArr.length - 2];
            if (last > prev) { tpTrend = '↑'; tpTrendClass = 'perf-kpi-trend-up'; }
            else if (last < prev) { tpTrend = '↓'; tpTrendClass = 'perf-kpi-trend-down'; }
        }

        // Unique contributors across all sprints
        const allContribSet = new Set();
        sprintData.forEach(s => s.issues.forEach(i => {
            const id = i.fields?.assignee?.accountId;
            if (id) allContribSet.add(id);
        }));
        const teamSize = allContribSet.size;

        // ---- Render KPIs ----
        const kpiEl = document.getElementById('perf-kpis');
        kpiEl.innerHTML = [
            { icon: '⚡', label: 'Avg Velocity', value: `${avgVelocity}`, sub: 'SP per sprint', trend: velTrend, trendClass: velTrendClass },
            { icon: '🏁', label: 'Avg Throughput', value: `${avgThroughput}`, sub: 'issues per sprint', trend: tpTrend, trendClass: tpTrendClass },
            { icon: '📦', label: 'Total Sprints', value: `${sprintCount}`, sub: 'analyzed', trend: '', trendClass: '' },
            { icon: '👥', label: 'Team Size', value: `${teamSize || '—'}`, sub: 'unique contributors', trend: '', trendClass: '' },
        ].map(k => `
            <div class="perf-kpi-card">
                <span class="perf-kpi-icon">${k.icon}</span>
                <span class="perf-kpi-label">${k.label}</span>
                <span class="perf-kpi-value">${k.value} ${k.trend ? `<span class="${k.trendClass}" style="font-size:18px">${k.trend}</span>` : ''}</span>
                <span class="perf-kpi-sub">${k.sub}</span>
            </div>
        `).join('');

        // ---- Render bar charts ----
        function renderBarChart(containerId, labels, values, tooltipSuffix) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const maxVal = Math.max(...values, 1);
            container.innerHTML = values.map((v, i) => {
                const heightPct = Math.round((v / maxVal) * 100);
                const shortName = labels[i].replace(/sprint/i, 'S').replace(/\s+/g, ' ').trim();
                return `
                    <div class="perf-bar-group">
                        <div class="perf-bar-value">${v}</div>
                        <div class="perf-bar-wrap">
                            <div class="perf-bar" style="height:${heightPct}%" data-tooltip="${escapeHtml(labels[i])}: ${v}${tooltipSuffix}"></div>
                        </div>
                        <div class="perf-bar-label" title="${escapeHtml(labels[i])}">${escapeHtml(shortName)}</div>
                    </div>
                `;
            }).join('');
        }

        const sprintNames = sprintData.map(s => s.name);
        renderBarChart('perf-throughput-chart', sprintNames, throughputBySprintArr, ' issues');
        renderBarChart('perf-velocity-chart', sprintNames, velocityBySprintArr, ' SP');

        // ---- Render developer velocity ----
        const sortedContribs = buildDeveloperVelocityRows(sprintData, spFId)
            .slice(0, 8);

        const maxVelocity = Math.max(...sortedContribs.map(c => c.velocity), 1);

        const contribEl = document.getElementById('perf-contributors');
        if (sortedContribs.length === 0) {
            contribEl.innerHTML = '<p style="font-size:13px;color:var(--text-sub);padding:12px 0">No contributor data found.</p>';
        } else {
            contribEl.innerHTML = sortedContribs.map(c => {
                const { initials, imgUrl } = getInitialsOrImg(c.assignee);
                const avatarHtml = imgUrl ? `<img src="${imgUrl}" alt="avatar">` : initials;
                const barPct = Math.round((c.velocity / maxVelocity) * 100);
                const name = c.assignee?.displayName || 'Unassigned';
                return `
                    <div class="perf-contributor-row">
                        <div class="perf-contrib-avatar">${avatarHtml}</div>
                        <div class="perf-contrib-bar-wrap">
                            <span class="perf-contrib-name">${escapeHtml(name)}</span>
                            <div class="perf-contrib-bar-track">
                                <div class="perf-contrib-bar-fill" style="width:${barPct}%"></div>
                            </div>
                        </div>
                        <div>
                            <div class="perf-contrib-sp">${c.velocity} SP/sprint</div>
                            <div class="perf-contrib-sp-sub">${c.totalSP} SP · ${c.count} issues</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        showState('content');
        perfState.lastLoadedProjectKey = projectKey;
        markAnalyticsPerf(`perf:${projectKey}:end`);
        measureAnalyticsPerf(`perf:${projectKey}`, `perf:${projectKey}:start`, `perf:${projectKey}:end`, {
            sprintCount,
            totalIssues,
        });
    } catch (err) {
        console.error('PMsToolKit PerfDashboard:', err);
        showState('error', err.message || 'Unexpected error.');
    }
}

// ============================================================
// INIT — wires up the project combobox for the perf dashboard
// ============================================================

export function initPerfCombo(allProjects, currentHost, initialProjectKey = '') {
    perfState.selectedProjectKey = initialProjectKey || '';
    perfState.host = currentHost || '';

    const perfSearch = document.getElementById('perf-project-search');
    const perfDropdown = document.getElementById('perf-project-dropdown');
    const perfComboWrapper = document.getElementById('perf-combo-wrapper');

    function renderPerfOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const filtered = allProjects.filter(p => !term || p.name.toLowerCase().includes(term) || p.key.toLowerCase().includes(term));
        if (filtered.length === 0) {
            perfDropdown.innerHTML = `<div class="combo-msg">No projects found</div>`;
            return;
        }
        perfDropdown.innerHTML = filtered.map(p => `
            <div class="combo-option ${p.key === perfState.selectedProjectKey ? 'selected' : ''}" data-key="${p.key}" data-name="${escapeHtml(p.name)}">
                <span class="combo-option-key">${p.key}</span>${escapeHtml(p.name)}
            </div>
        `).join('');
    }

    function ensurePerfLoaded(opts = {}) {
        if (!perfState.selectedProjectKey || !currentHost) return;
        if (opts.forceRefresh === true) {
            loadPerfDashboard(perfState.selectedProjectKey, currentHost);
            return;
        }
        if (perfState.lastLoadedProjectKey === perfState.selectedProjectKey) {
            logAnalyticsPerf('perf:reuse', { projectKey: perfState.selectedProjectKey });
            return;
        }
        loadPerfDashboard(perfState.selectedProjectKey, currentHost);
    }

    perfSearch.addEventListener('focus', () => {
        perfSearch.select();
        perfDropdown.classList.remove('hidden');
        renderPerfOptions('');
    });

    perfSearch.addEventListener('input', e => {
        perfDropdown.classList.remove('hidden');
        renderPerfOptions(e.target.value);
    });

    perfDropdown.addEventListener('click', e => {
        const option = e.target.closest('.combo-option');
        if (!option) return;
        perfState.selectedProjectKey = option.dataset.key;
        perfState.lastLoadedProjectKey = perfState.lastLoadedProjectKey === perfState.selectedProjectKey
            ? perfState.lastLoadedProjectKey
            : '';
        perfSearch.value = `${option.dataset.name} (${option.dataset.key})`;
        perfDropdown.classList.add('hidden');
        if (getActiveView() === 'performance-dashboard') ensurePerfLoaded();
    });

    document.addEventListener('click', e => {
        if (!perfComboWrapper.contains(e.target)) {
            perfDropdown.classList.add('hidden');
            if (perfState.selectedProjectKey) {
                const p = allProjects.find(pr => pr.key === perfState.selectedProjectKey);
                if (p) perfSearch.value = `${p.name} (${p.key})`;
            } else {
                perfSearch.value = '';
            }
        }
    });

    document.getElementById('perf-refresh-btn').addEventListener('click', () => {
        if (perfState.selectedProjectKey) {
            perfState.lastLoadedProjectKey = '';
            ensurePerfLoaded({ forceRefresh: true });
        }
    });

    document.getElementById('perf-export-btn')?.addEventListener('click', () => {
        exportCapacityCsv();
    });

    document.addEventListener('analytics:viewchange', event => {
        if (event.detail?.view !== 'performance-dashboard') return;
        ensurePerfLoaded();
    });

    if (allProjects.length > 0) {
        perfSearch.placeholder = 'Search project...';
    }

    // Auto-load if initialProjectKey provided
    if (initialProjectKey) {
        const p = allProjects.find(pr => pr.key === initialProjectKey);
        if (p) {
            perfSearch.value = `${p.name} (${p.key})`;
        }
    }
}

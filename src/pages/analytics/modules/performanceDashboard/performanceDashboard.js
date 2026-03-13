/**
 * PMsToolKit — Analytics Hub
 * Performance Dashboard — team metrics across last 5 closed sprints
 */

import { fetchBoardId, fetchSprintDoneIssues, fetchSpFieldId, jiraFetch } from '../jiraApi.js';
import { escapeHtml } from '../utils.js';
import { getInitialsOrImg } from '../sprintDashboard/devCard.js';

// ============================================================
// LOAD PERFORMANCE DASHBOARD
// ============================================================

export async function loadPerfDashboard(projectKey, host) {
    if (!projectKey || !host) return;

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
        const boardId = await fetchBoardId(host, projectKey);
        if (!boardId) { showState('error', `No Scrum board found for "${projectKey}".`); return; }

        showState('loading', 'Fetching last 5 sprints...');
        const spData = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=50`);
        const closedSprints = (spData.values || []).slice(-5);
        if (closedSprints.length === 0) { showState('error', 'No closed sprints found. Complete at least one sprint first.'); return; }

        showState('loading', 'Resolving Story Points field...');
        const spFId = await fetchSpFieldId(host);

        showState('loading', 'Loading sprint data...');
        const sprintData = await Promise.all(closedSprints.map(async cs => {
            const issues = await fetchSprintDoneIssues(host, cs.id, spFId).catch(() => []);
            return {
                id: cs.id,
                name: cs.name,
                startDate: cs.startDate,
                endDate: cs.completeDate || cs.endDate,
                issues,
            };
        }));

        // ---- KPI calculations ----
        const sprintCount = sprintData.length;
        const totalIssues = sprintData.reduce((a, s) => a + s.issues.length, 0);
        const totalSP = sprintData.reduce((a, s) => a + s.issues.reduce((b, i) => b + (Number(i.fields?.[spFId]) || 0), 0), 0);
        const avgThroughput = Math.round((totalIssues / sprintCount) * 10) / 10;
        const avgVelocity = Math.round((totalSP / sprintCount) * 10) / 10;

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

        // ---- Render top contributors ----
        const contribMap = {};
        sprintData.forEach(s => {
            s.issues.forEach(i => {
                const key = i.fields?.assignee?.accountId || 'unassigned';
                const sp = Number(i.fields?.[spFId]) || 0;
                if (!contribMap[key]) contribMap[key] = { assignee: i.fields?.assignee || null, totalSP: 0, count: 0 };
                contribMap[key].totalSP += sp;
                contribMap[key].count++;
            });
        });

        const sortedContribs = Object.values(contribMap)
            .sort((a, b) => b.totalSP - a.totalSP)
            .slice(0, 8);

        const maxContribSP = Math.max(...sortedContribs.map(c => c.totalSP), 1);

        const contribEl = document.getElementById('perf-contributors');
        if (sortedContribs.length === 0) {
            contribEl.innerHTML = '<p style="font-size:13px;color:var(--text-sub);padding:12px 0">No contributor data found.</p>';
        } else {
            contribEl.innerHTML = sortedContribs.map(c => {
                const { initials, imgUrl } = getInitialsOrImg(c.assignee);
                const avatarHtml = imgUrl ? `<img src="${imgUrl}" alt="avatar">` : initials;
                const barPct = Math.round((c.totalSP / maxContribSP) * 100);
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
                            <div class="perf-contrib-sp">${c.totalSP} SP</div>
                            <div class="perf-contrib-sp-sub">${c.count} issues</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        showState('content');
    } catch (err) {
        console.error('PMsToolKit PerfDashboard:', err);
        showState('error', err.message || 'Unexpected error.');
    }
}

// ============================================================
// INIT — wires up the project combobox for the perf dashboard
// ============================================================

export function initPerfCombo(allProjects, currentHost, initialProjectKey = '') {
    let perfSelectedProjectKey = initialProjectKey;

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
            <div class="combo-option ${p.key === perfSelectedProjectKey ? 'selected' : ''}" data-key="${p.key}" data-name="${escapeHtml(p.name)}">
                <span class="combo-option-key">${p.key}</span>${escapeHtml(p.name)}
            </div>
        `).join('');
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
        perfSelectedProjectKey = option.dataset.key;
        perfSearch.value = `${option.dataset.name} (${option.dataset.key})`;
        perfDropdown.classList.add('hidden');
        loadPerfDashboard(perfSelectedProjectKey, currentHost);
    });

    document.addEventListener('click', e => {
        if (!perfComboWrapper.contains(e.target)) {
            perfDropdown.classList.add('hidden');
            if (perfSelectedProjectKey) {
                const p = allProjects.find(pr => pr.key === perfSelectedProjectKey);
                if (p) perfSearch.value = `${p.name} (${p.key})`;
            } else {
                perfSearch.value = '';
            }
        }
    });

    document.getElementById('perf-refresh-btn').addEventListener('click', () => {
        if (perfSelectedProjectKey) loadPerfDashboard(perfSelectedProjectKey, currentHost);
    });

    if (allProjects.length > 0) {
        perfSearch.placeholder = 'Search project...';
    }

    // Auto-load if initialProjectKey provided
    if (initialProjectKey) {
        const p = allProjects.find(pr => pr.key === initialProjectKey);
        if (p) {
            perfSearch.value = `${p.name} (${p.key})`;
            loadPerfDashboard(initialProjectKey, currentHost);
        }
    }
}

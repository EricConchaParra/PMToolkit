import Chart from 'chart.js/auto';
import {
    fetchBoardId,
    fetchBoardSprints,
    fetchIssueChangelog,
    fetchProjectSprintIssues,
    fetchProjectSprints,
    fetchProjectStatuses,
    fetchSprintFieldId,
    fetchSprintIssues,
    fetchSpFieldId,
} from '../jiraApi.js';
import { getActiveView } from '../nav.js';
import { escapeHtml, formatDate } from '../utils.js';
import { logAnalyticsPerf, markAnalyticsPerf, measureAnalyticsPerf } from '../analyticsPerf.js';
import { buildBurndownModel } from './burndownModel.js';

const burndownState = {
    selectedProjectKey: '',
    host: '',
    loadRequestId: 0,
    boardId: null,
    sprintFieldId: null,
    spFieldId: null,
    projectSprintFallback: false,
    currentSprints: [],
    selectedSprintId: null,
    lastLoadedSignature: '',
    chart: null,
    selectedDayIndex: 0,
    latestModel: null,
};

const weekendBandsPlugin = {
    id: 'burndownWeekendBands',
    beforeDatasetsDraw(chart, _args, pluginOptions) {
        const { ctx, chartArea, scales } = chart;
        const xScale = scales.x;
        if (!ctx || !chartArea || !xScale) return;

        const weekendIndexes = pluginOptions?.weekendIndexes || [];
        if (!weekendIndexes.length) return;

        ctx.save();
        ctx.fillStyle = pluginOptions?.color || 'rgba(9, 30, 66, 0.05)';

        weekendIndexes.forEach(index => {
            const center = xScale.getPixelForValue(index);
            const previousCenter = index > 0 ? xScale.getPixelForValue(index - 1) : null;
            const nextCenter = index < xScale.ticks.length - 1 ? xScale.getPixelForValue(index + 1) : null;
            const left = previousCenter == null ? chartArea.left : (previousCenter + center) / 2;
            const right = nextCenter == null ? chartArea.right : (center + nextCenter) / 2;

            ctx.fillRect(left, chartArea.top, Math.max(0, right - left), chartArea.bottom - chartArea.top);
        });

        ctx.restore();
    },
};

function getEls() {
    return {
        projectSearch: document.getElementById('burndown-project-search'),
        projectDropdown: document.getElementById('burndown-project-dropdown'),
        projectCombo: document.getElementById('burndown-combo-wrapper'),
        sprintWrap: document.getElementById('burndown-sprint-select-wrap'),
        sprintSearch: document.getElementById('burndown-sprint-search'),
        sprintDropdown: document.getElementById('burndown-sprint-dropdown'),
        sprintCombo: document.getElementById('burndown-sprint-combo-wrapper'),
        placeholder: document.getElementById('burndown-placeholder'),
        loading: document.getElementById('burndown-loading'),
        loadingText: document.getElementById('burndown-loading-text'),
        error: document.getElementById('burndown-error'),
        errorText: document.getElementById('burndown-error-text'),
        content: document.getElementById('burndown-content'),
        hero: document.getElementById('burndown-hero'),
        kpis: document.getElementById('burndown-kpis'),
        statusList: document.getElementById('burndown-status-list'),
        openIssues: document.getElementById('burndown-open-issues'),
        detail: document.getElementById('burndown-day-detail'),
        chartCanvas: document.getElementById('burndown-chart-canvas'),
    };
}

function showState(state, message = '') {
    const els = getEls();
    els.placeholder?.classList.add('hidden');
    els.loading?.classList.add('hidden');
    els.error?.classList.add('hidden');
    els.content?.classList.add('hidden');

    if (state === 'placeholder') {
        els.placeholder?.classList.remove('hidden');
    } else if (state === 'loading') {
        els.loading?.classList.remove('hidden');
        if (els.loadingText && message) els.loadingText.textContent = message;
    } else if (state === 'error') {
        els.error?.classList.remove('hidden');
        if (els.errorText && message) els.errorText.textContent = message;
    } else if (state === 'content') {
        els.content?.classList.remove('hidden');
    }
}

function formatSprintLabel(sprint) {
    if (!sprint) return '';
    const prefix = sprint.state === 'active' ? '🟢 ' : sprint.state === 'future' ? '🗓️ ' : '📦 ';
    return `${prefix}${sprint.name}`;
}

function formatSp(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? `${number}` : number.toFixed(1);
}

function getSprintSortValue(sprint) {
    return new Date(sprint?.startDate || sprint?.endDate || 0).getTime() || 0;
}

function getSelectedProject(allProjects, key) {
    return allProjects.find(project => project.key === key) || null;
}

function setProjectInputValue(allProjects) {
    const { projectSearch } = getEls();
    if (!projectSearch) return;
    const project = getSelectedProject(allProjects, burndownState.selectedProjectKey);
    projectSearch.value = project ? `${project.name} (${project.key})` : '';
}

function renderProjectOptions(allProjects, filterText = '') {
    const { projectDropdown } = getEls();
    if (!projectDropdown) return;

    const term = String(filterText || '').trim().toLowerCase();
    const filtered = allProjects.filter(project =>
        !term
        || project.name.toLowerCase().includes(term)
        || project.key.toLowerCase().includes(term)
    );

    if (filtered.length === 0) {
        projectDropdown.innerHTML = '<div class="combo-msg">No projects found</div>';
        return;
    }

    projectDropdown.innerHTML = filtered.map(project => `
        <div class="combo-option ${project.key === burndownState.selectedProjectKey ? 'selected' : ''}" data-key="${project.key}" data-name="${escapeHtml(project.name)}">
            <span class="combo-option-key">${project.key}</span>${escapeHtml(project.name)}
        </div>
    `).join('');
}

function sortSprints(sprints = []) {
    return (Array.isArray(sprints) ? sprints : []).slice()
        .sort((left, right) => getSprintSortValue(left) - getSprintSortValue(right) || String(left.name || '').localeCompare(String(right.name || '')));
}

function chooseDefaultSprint(sprints = []) {
    const selected = sortSprints(sprints);
    return selected.find(sprint => sprint.state === 'active')
        || selected.filter(sprint => sprint.state === 'closed').slice(-1)[0]
        || selected[0]
        || null;
}

function populateSprintOptions() {
    const { sprintDropdown, sprintSearch, sprintWrap } = getEls();
    if (!sprintDropdown || !sprintSearch || !sprintWrap) return;

    sprintWrap.classList.toggle('hidden', burndownState.currentSprints.length === 0);
    sprintDropdown.innerHTML = burndownState.currentSprints.map(sprint => `
        <div class="combo-option ${Number(sprint.id) === Number(burndownState.selectedSprintId) ? 'selected' : ''}" data-id="${sprint.id}">
            <span class="combo-option-key">${escapeHtml(String(sprint.state || ''))}</span>${escapeHtml(sprint.name || '')}
        </div>
    `).join('') || '<div class="combo-msg">No sprints found</div>';

    const selectedSprint = burndownState.currentSprints.find(sprint => Number(sprint.id) === Number(burndownState.selectedSprintId));
    sprintSearch.value = selectedSprint ? formatSprintLabel(selectedSprint) : '';
}

function renderSprintOptions(filterText = '') {
    const { sprintDropdown } = getEls();
    if (!sprintDropdown) return;

    const term = String(filterText || '').trim().toLowerCase();
    const filtered = burndownState.currentSprints.filter(sprint =>
        !term
        || String(sprint.name || '').toLowerCase().includes(term)
        || String(sprint.id || '').includes(term)
        || String(sprint.state || '').toLowerCase().includes(term)
    );

    if (filtered.length === 0) {
        sprintDropdown.innerHTML = '<div class="combo-msg">No sprints found</div>';
        return;
    }

    sprintDropdown.innerHTML = filtered.map(sprint => `
        <div class="combo-option ${Number(sprint.id) === Number(burndownState.selectedSprintId) ? 'selected' : ''}" data-id="${sprint.id}">
            <span class="combo-option-key">${escapeHtml(String(sprint.state || ''))}</span>${escapeHtml(sprint.name || '')}
        </div>
    `).join('');
}

function getSprintStatusTone(summary, sprintState) {
    if (sprintState === 'future') {
        return {
            label: 'Not started',
            className: 'burndown-pill is-info',
            copy: 'This sprint has not started yet. The chart shows planned scope and the ideal path.',
        };
    }

    if (summary.remainingSp <= 0) {
        return {
            label: 'All committed work burned',
            className: 'burndown-pill is-success',
            copy: 'Remaining scope is at zero for the currently selected sprint window.',
        };
    }

    if (summary.paceDeltaSp <= 1) {
        return {
            label: 'On pace',
            className: 'burndown-pill is-success',
            copy: 'Actual remaining work is aligned with or ahead of the ideal burn line.',
        };
    }

    if (summary.paceDeltaSp <= 4) {
        return {
            label: 'Watch closely',
            className: 'burndown-pill is-warning',
            copy: 'The sprint is slightly behind the ideal burn line. Watch carryover and blocked work.',
        };
    }

    return {
        label: 'Behind plan',
        className: 'burndown-pill is-danger',
        copy: 'Remaining work is materially above the ideal burn line for this point in the sprint.',
    };
}

function renderHero(model) {
    const { hero } = getEls();
    if (!hero) return;

    const summary = model.summary;
    const tone = getSprintStatusTone(summary, model.sprint.state);
    const progress = Math.max(0, Math.min(100, summary.completionPct));
    const sprintDates = `${formatDate(new Date(model.sprint.startDate))} → ${formatDate(new Date(model.sprint.completeDate || model.sprint.endDate))}`;

    hero.innerHTML = `
        <div class="burndown-hero-copy">
            <div class="burndown-hero-kicker">Sprint Burndown</div>
            <h2>${escapeHtml(model.sprint.name)}</h2>
            <p>${escapeHtml(tone.copy)}</p>
            <div class="burndown-hero-meta">
                <span class="${tone.className}">${escapeHtml(tone.label)}</span>
                <span class="burndown-mini-stat">${escapeHtml(model.sprint.state || 'active')}</span>
                <span class="burndown-mini-stat">${escapeHtml(sprintDates)}</span>
            </div>
        </div>
        <div class="burndown-hero-progress">
            <div class="burndown-progress-top">
                <span>Burn progress</span>
                <strong>${progress.toFixed(1)}%</strong>
            </div>
            <div class="burndown-progress-track">
                <div class="burndown-progress-fill" style="width:${progress}%"></div>
            </div>
            <div class="burndown-progress-foot">
                <span>${formatSp(summary.doneSp)} SP done</span>
                <span>${formatSp(summary.remainingSp)} SP remaining</span>
            </div>
        </div>
    `;
}

function renderKpis(model) {
    const { kpis } = getEls();
    if (!kpis) return;

    const summary = model.summary;
    const paceText = summary.paceDeltaSp > 0
        ? `${formatSp(summary.paceDeltaSp)} SP behind`
        : summary.paceDeltaSp < 0
            ? `${formatSp(Math.abs(summary.paceDeltaSp))} SP ahead`
            : 'Exactly on ideal';

    const scopeText = summary.scopeChangeSp > 0
        ? `+${formatSp(summary.scopeChangeSp)} SP added`
        : summary.scopeChangeSp < 0
            ? `${formatSp(summary.scopeChangeSp)} SP removed`
            : 'No scope movement';

    kpis.innerHTML = [
        {
            label: 'Remaining',
            value: `${formatSp(summary.remainingSp)} SP`,
            sub: `${summary.openIssues} open tickets`,
            tone: 'neutral',
        },
        {
            label: 'Completed',
            value: `${formatSp(summary.doneSp)} SP`,
            sub: `${summary.doneIssues} done tickets`,
            tone: 'success',
        },
        {
            label: 'Scope Change',
            value: `${formatSp(summary.currentScopeSp)} SP`,
            sub: scopeText,
            tone: summary.scopeChangeSp > 0 ? 'warning' : 'neutral',
        },
        {
            label: 'Pace vs Ideal',
            value: paceText,
            sub: `Ideal now: ${formatSp(summary.idealNowSp)} SP`,
            tone: summary.paceDeltaSp > 1 ? 'danger' : 'success',
        },
    ].map(card => `
        <div class="burndown-kpi-card burndown-kpi-${card.tone}">
            <span class="burndown-kpi-label">${escapeHtml(card.label)}</span>
            <strong class="burndown-kpi-value">${escapeHtml(card.value)}</strong>
            <span class="burndown-kpi-sub">${escapeHtml(card.sub)}</span>
        </div>
    `).join('');
}

function renderStatusBreakdown(model) {
    const { statusList } = getEls();
    if (!statusList) return;

    const items = model.statusBreakdown || [];
    if (items.length === 0) {
        statusList.innerHTML = '<p class="burndown-empty-copy">No status data available.</p>';
        return;
    }

    const maxSp = Math.max(...items.map(item => item.storyPoints), 1);
    statusList.innerHTML = items.map(item => `
        <div class="burndown-status-row">
            <div class="burndown-status-copy">
                <span class="burndown-status-name">${escapeHtml(item.label)}</span>
                <span class="burndown-status-helper">${escapeHtml(item.helperLabel)} · ${item.count} tickets</span>
            </div>
            <div class="burndown-status-bar">
                <div class="burndown-status-bar-fill is-${item.colorToken}" style="width:${Math.max(8, (item.storyPoints / maxSp) * 100)}%"></div>
            </div>
            <div class="burndown-status-value">${formatSp(item.storyPoints)} SP</div>
        </div>
    `).join('');
}

function renderOpenIssues(model) {
    const { openIssues } = getEls();
    if (!openIssues) return;

    if ((model.openIssues || []).length === 0) {
        openIssues.innerHTML = '<p class="burndown-empty-copy">No remaining work. The selected sprint is fully burned down.</p>';
        return;
    }

    openIssues.innerHTML = model.openIssues.slice(0, 12).map(issue => `
        <a class="burndown-issue-row" href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">
            <div class="burndown-issue-main">
                <span class="burndown-issue-key">${escapeHtml(issue.key)}</span>
                <span class="burndown-issue-summary">${escapeHtml(issue.summary)}</span>
                <span class="burndown-issue-meta">${escapeHtml(issue.assignee)} · ${escapeHtml(issue.statusName)}</span>
            </div>
            <span class="burndown-issue-sp">${formatSp(issue.storyPoints)} SP</span>
        </a>
    `).join('');
}

function renderDayDetail(model, dayIndex) {
    const { detail } = getEls();
    if (!detail) return;

    const point = model.dayPoints[dayIndex];
    if (!point) return;
    burndownState.selectedDayIndex = dayIndex;

    const snapshotCards = [
        { label: 'Remaining', value: point.remainingSp == null ? '—' : `${formatSp(point.remainingSp)} SP` },
        { label: 'Burned Today', value: `${formatSp(point.burnedTodaySp)} SP` },
        { label: 'Scope Delta', value: `${point.scopeDeltaTodaySp > 0 ? '+' : ''}${formatSp(point.scopeDeltaTodaySp)} SP` },
        { label: 'Done Events', value: `${point.doneTodayCount}` },
    ];

    const eventsHtml = point.events.length === 0
        ? '<p class="burndown-empty-copy">No burn or scope events were recorded on this day.</p>'
        : point.events.map(event => `
            <a class="burndown-day-event" href="https://${burndownState.host}/browse/${escapeHtml(event.issueKey)}" target="_blank" rel="noreferrer">
                <span class="burndown-event-type is-${escapeHtml(event.type)}">${escapeHtml(event.type)}</span>
                <div class="burndown-event-copy">
                    <span class="burndown-event-title">${escapeHtml(event.issueKey)} · ${escapeHtml(event.summary)}</span>
                    <span class="burndown-event-meta">${escapeHtml(event.label)} · ${escapeHtml(event.assignee)}</span>
                </div>
                <span class="burndown-event-time">${new Date(event.atMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
            </a>
        `).join('');

    detail.innerHTML = `
        <div class="burndown-detail-head">
            <div>
                <span class="burndown-detail-kicker">Selected Day</span>
                <h3>${escapeHtml(point.longLabel)}</h3>
            </div>
            <span class="burndown-mini-stat">${point.actualVisible ? 'Actual data' : 'Planned future point'}</span>
        </div>
        <div class="burndown-detail-grid">
            ${snapshotCards.map(card => `
                <div class="burndown-detail-card">
                    <span>${escapeHtml(card.label)}</span>
                    <strong>${escapeHtml(card.value)}</strong>
                </div>
            `).join('')}
        </div>
        <div class="burndown-detail-events">
            ${eventsHtml}
        </div>
    `;

    if (burndownState.chart) {
        burndownState.chart.update('none');
    }
}

function destroyChart() {
    if (burndownState.chart) {
        burndownState.chart.destroy();
        burndownState.chart = null;
    }
}

function renderChart(model) {
    const { chartCanvas } = getEls();
    if (!chartCanvas) return;

    destroyChart();

    const actualData = model.dayPoints.map(point => point.actualVisible ? point.remainingSp : null);
    const idealData = model.dayPoints.map(point => point.idealRemainingSp);
    const scopeData = model.dayPoints.map(point => point.actualVisible ? point.scopeSp : null);
    const weekendIndexes = model.dayPoints
        .map((point, index) => point.isWeekend ? index : -1)
        .filter(index => index >= 0);
    const latestVisibleIndex = Math.max(0, model.dayPoints.map((point, index) => point.actualVisible ? index : -1).filter(index => index >= 0).slice(-1)[0] ?? 0);
    burndownState.selectedDayIndex = latestVisibleIndex;

    burndownState.chart = new Chart(chartCanvas, {
        type: 'line',
        data: {
            labels: model.dayPoints.map(point => point.label),
            datasets: [
                {
                    label: 'Actual Remaining',
                    data: actualData,
                    borderColor: '#0052cc',
                    backgroundColor: 'rgba(0, 82, 204, 0.12)',
                    fill: true,
                    tension: 0.28,
                    borderWidth: 3,
                    pointRadius: context => context.dataIndex === burndownState.selectedDayIndex ? 6 : 3,
                    pointHoverRadius: 7,
                    pointBackgroundColor: context => context.dataIndex === burndownState.selectedDayIndex ? '#091e42' : '#0052cc',
                },
                {
                    label: 'Ideal Remaining',
                    data: idealData,
                    borderColor: '#7a869a',
                    borderDash: [6, 6],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0,
                },
                {
                    label: 'Total Scope',
                    data: scopeData,
                    borderColor: '#ff8b00',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.18,
                },
            ],
        },
        plugins: [weekendBandsPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        usePointStyle: true,
                    },
                },
                tooltip: {
                    callbacks: {
                        title(items) {
                            const point = model.dayPoints[items[0]?.dataIndex || 0];
                            return point?.longLabel || '';
                        },
                        afterBody(items) {
                            const point = model.dayPoints[items[0]?.dataIndex || 0];
                            if (!point) return '';
                            const lines = [
                                `Done today: ${formatSp(point.doneTodaySp)} SP`,
                                `Events: ${point.events.length}`,
                            ];
                            if (point.isWeekend) {
                                lines.push('Weekend');
                            }
                            if (point.scopeDeltaTodaySp !== 0) {
                                lines.push(`Scope delta: ${point.scopeDeltaTodaySp > 0 ? '+' : ''}${formatSp(point.scopeDeltaTodaySp)} SP`);
                            }
                            return lines;
                        },
                    },
                },
                burndownWeekendBands: {
                    weekendIndexes,
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                    },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Story Points',
                    },
                },
            },
            onClick(_event, elements) {
                if (!elements.length) return;
                renderDayDetail(model, elements[0].index);
            },
        },
    });

    renderDayDetail(model, latestVisibleIndex);
}

function renderBurndown(model) {
    burndownState.latestModel = model;
    renderHero(model);
    renderKpis(model);
    renderChart(model);
    renderStatusBreakdown(model);
    renderOpenIssues(model);
}

async function loadBurndownForSprint(sprint, requestId) {
    if (!sprint || !burndownState.host || !burndownState.selectedProjectKey) return;
    const signature = `${burndownState.selectedProjectKey}:${sprint.id}`;

    showState('loading', 'Detecting Story Points field...');
    if (!burndownState.spFieldId) {
        burndownState.spFieldId = await fetchSpFieldId(burndownState.host);
        if (requestId !== burndownState.loadRequestId) return;
    }

    showState('loading', 'Loading status catalog...');
    const statusCatalog = await fetchProjectStatuses(burndownState.host, burndownState.selectedProjectKey).catch(() => []);
    if (requestId !== burndownState.loadRequestId) return;

    showState('loading', 'Fetching sprint issues...');
    const issues = burndownState.projectSprintFallback
        ? await fetchProjectSprintIssues(burndownState.host, burndownState.selectedProjectKey, sprint.id, burndownState.spFieldId, ['created'])
        : await fetchSprintIssues(burndownState.host, sprint.id, burndownState.spFieldId, ['created']);
    if (requestId !== burndownState.loadRequestId) return;

    if (!issues.length) {
        showState('error', 'The selected sprint has no issues available for burndown analysis.');
        return;
    }

    showState('loading', 'Reading issue history...');
    const changelogsByIssue = {};
    const concurrency = 4;
    for (let index = 0; index < issues.length; index += concurrency) {
        const batch = issues.slice(index, index + concurrency);
        const results = await Promise.all(batch.map(async issue => ({
            key: issue.key,
            changelog: await fetchIssueChangelog(burndownState.host, issue.key).catch(() => []),
        })));
        results.forEach(result => {
            changelogsByIssue[result.key] = result.changelog;
        });
        if (requestId !== burndownState.loadRequestId) return;
        showState('loading', `Reading issue history: ${Math.min(index + concurrency, issues.length)} / ${issues.length}...`);
    }

    const model = buildBurndownModel({
        sprint,
        issues,
        changelogsByIssue,
        statusCatalog,
        spFieldId: burndownState.spFieldId,
        now: new Date(),
        host: burndownState.host,
    });

    if (!model) {
        showState('error', 'The sprint dates are incomplete, so the burndown chart could not be built.');
        return;
    }

    if (requestId !== burndownState.loadRequestId) return;
    showState('content');
    renderBurndown(model);
    burndownState.lastLoadedSignature = signature;
    markAnalyticsPerf(`burndown:${signature}:end`);
    measureAnalyticsPerf(`burndown:${signature}`, `burndown:${signature}:start`, `burndown:${signature}:end`, {
        issueCount: issues.length,
        dayCount: model.dayPoints.length,
    });
}

async function ensureSprintData(projectKey, requestId) {
    showState('loading', 'Finding Scrum board...');
    burndownState.boardId = await fetchBoardId(burndownState.host, projectKey);
    if (requestId !== burndownState.loadRequestId) return false;

    let sprints = [];
    if (burndownState.boardId) {
        showState('loading', 'Loading board sprints...');
        sprints = await fetchBoardSprints(burndownState.host, burndownState.boardId, ['active', 'future', 'closed']);
        burndownState.projectSprintFallback = false;
    } else {
        showState('loading', 'No Scrum board found. Falling back to project sprint data...');
        if (!burndownState.sprintFieldId) {
            burndownState.sprintFieldId = await fetchSprintFieldId(burndownState.host);
            if (requestId !== burndownState.loadRequestId) return false;
        }
        sprints = await fetchProjectSprints(burndownState.host, projectKey, burndownState.sprintFieldId, ['active', 'future', 'closed']);
        burndownState.projectSprintFallback = true;
    }

    if (requestId !== burndownState.loadRequestId) return false;
    burndownState.currentSprints = sortSprints(sprints);
    burndownState.selectedSprintId = burndownState.currentSprints.some(sprint => Number(sprint.id) === Number(burndownState.selectedSprintId))
        ? burndownState.selectedSprintId
        : chooseDefaultSprint(burndownState.currentSprints)?.id || null;
    populateSprintOptions();
    return true;
}

async function loadBurndown(projectKey, { forceRefresh = false } = {}) {
    if (!projectKey || !burndownState.host) {
        showState('placeholder');
        return;
    }

    const requestId = ++burndownState.loadRequestId;
    burndownState.selectedProjectKey = projectKey;
    burndownState.boardId = null;
    burndownState.projectSprintFallback = false;
    burndownState.currentSprints = [];
    burndownState.selectedSprintId = null;
    burndownState.latestModel = null;
    destroyChart();

    const signaturePrefix = `${projectKey}:`;
    if (!forceRefresh && burndownState.lastLoadedSignature.startsWith(signaturePrefix) && getActiveView() === 'burndown-dashboard') {
        logAnalyticsPerf('burndown:reuse', { projectKey });
    }

    try {
        const loaded = await ensureSprintData(projectKey, requestId);
        if (!loaded || requestId !== burndownState.loadRequestId) return;

        const sprint = burndownState.currentSprints.find(item => Number(item.id) === Number(burndownState.selectedSprintId));
        if (!sprint) {
            showState('error', 'No sprints were found for the selected project.');
            return;
        }

        markAnalyticsPerf(`burndown:${projectKey}:${sprint.id}:start`);
        await loadBurndownForSprint(sprint, requestId);
    } catch (error) {
        console.error('PMsToolKit Burndown:', error);
        showState('error', error.message || 'Unexpected error loading burndown data.');
    }
}

function bindProjectCombobox(allProjects) {
    const { projectSearch, projectDropdown, projectCombo } = getEls();
    if (!projectSearch || !projectDropdown || !projectCombo) return;

    projectSearch.addEventListener('focus', () => {
        projectSearch.select();
        projectDropdown.classList.remove('hidden');
        renderProjectOptions(allProjects, '');
    });

    projectSearch.addEventListener('input', event => {
        projectDropdown.classList.remove('hidden');
        renderProjectOptions(allProjects, event.target.value);
    });

    projectDropdown.addEventListener('click', event => {
        const option = event.target.closest('.combo-option');
        if (!option) return;
        burndownState.selectedProjectKey = option.dataset.key;
        projectDropdown.classList.add('hidden');
        setProjectInputValue(allProjects);
        if (getActiveView() === 'burndown-dashboard') {
            void loadBurndown(option.dataset.key, { forceRefresh: true });
        }
    });

    document.addEventListener('click', event => {
        if (!projectCombo.contains(event.target)) {
            projectDropdown.classList.add('hidden');
            setProjectInputValue(allProjects);
        }
    });
}

function bindSprintCombobox() {
    const { sprintSearch, sprintDropdown, sprintCombo } = getEls();
    if (!sprintSearch || !sprintDropdown || !sprintCombo) return;

    sprintSearch.addEventListener('focus', () => {
        sprintSearch.select();
        sprintDropdown.classList.remove('hidden');
        renderSprintOptions('');
    });

    sprintSearch.addEventListener('input', event => {
        sprintDropdown.classList.remove('hidden');
        renderSprintOptions(event.target.value);
    });

    sprintDropdown.addEventListener('click', event => {
        const option = event.target.closest('.combo-option');
        if (!option) return;
        burndownState.selectedSprintId = Number(option.dataset.id);
        populateSprintOptions();
        sprintDropdown.classList.add('hidden');
        const sprint = burndownState.currentSprints.find(item => Number(item.id) === Number(burndownState.selectedSprintId));
        if (sprint) {
            markAnalyticsPerf(`burndown:${burndownState.selectedProjectKey}:${sprint.id}:start`);
            void loadBurndownForSprint(sprint, burndownState.loadRequestId);
        }
    });

    document.addEventListener('click', event => {
        if (!sprintCombo.contains(event.target)) {
            sprintDropdown.classList.add('hidden');
            populateSprintOptions();
        }
    });
}

export function initBurndownDashboard(allProjects, currentHost, initialProjectKey = '') {
    burndownState.host = currentHost || '';
    burndownState.selectedProjectKey = initialProjectKey || '';
    setProjectInputValue(allProjects);
    renderProjectOptions(allProjects);
    bindProjectCombobox(allProjects);
    bindSprintCombobox();

    document.getElementById('burndown-refresh-btn')?.addEventListener('click', () => {
        if (!burndownState.selectedProjectKey) return;
        burndownState.spFieldId = null;
        burndownState.sprintFieldId = null;
        void loadBurndown(burndownState.selectedProjectKey, { forceRefresh: true });
    });

    document.addEventListener('analytics:viewchange', event => {
        if (event.detail?.view !== 'burndown-dashboard') return;
        if (!burndownState.selectedProjectKey) {
            showState('placeholder');
            return;
        }
        if (burndownState.latestModel && burndownState.lastLoadedSignature.startsWith(`${burndownState.selectedProjectKey}:`)) {
            showState('content');
            return;
        }
        void loadBurndown(burndownState.selectedProjectKey, { forceRefresh: false });
    });
}

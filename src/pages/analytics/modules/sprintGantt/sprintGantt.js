/**
 * PMsToolKit — Sprint Timeline (Gantt) view controller.
 *
 * Picks a project + one or more sprints, fetches the sprint issues with their
 * "Blocks" links, and renders a dependency-aware CPM timeline (critical path,
 * per-assignee serialization, workload audit) to sanity-check the plan.
 * All scheduling logic lives in ./ganttModel.js.
 */

import {
    fetchBoardId,
    fetchBoardSprints,
    fetchProjectSprintIssues,
    fetchProjectSprints,
    fetchSpFieldId,
    fetchSprintFieldId,
    fetchSprintIssues,
} from '../jiraApi.js';
import { escapeHtml } from '../utils.js';
import { DEFAULT_HOURS_PER_DAY } from '../constants.js';
import {
    DEFAULT_GANTT_SP_TABLE,
    addCalendarDays,
    ancestorsOf,
    computeSchedule,
    computeWorkload,
    descendantsOf,
    formatISODateLocal,
    mapIssuesToTasks,
    parseISODateLocal,
} from './ganttModel.js';

const PREFS_STORAGE_KEY = 'pmtk_analytics_sprint_gantt_prefs';
const SP_TABLE_NOTES = { 1: '2.25h', 2: '~half day', 3: '1 day', 5: '2 days', 8: '3 days', 13: '1 week' };
const ROW_H = 46;

const sgState = {
    allProjects: [],
    host: '',
    selectedProjectKey: '',
    loadRequestId: 0,
    boardId: null,
    sprintFieldId: null,
    sprintOptions: [],

    // Analysis data
    tasksById: {},
    order: [],
    dataWarnings: [],
    scheduleResult: null,
    selectedSprints: [], // chronological, the ones used in the last analysis

    // UI state
    view: 'timeline',
    selection: null,
    criticalOnly: false,
    filterText: '',
    startDateTouched: false,

    config: {
        startDate: formatISODateLocal(new Date()),
        hoursPerDay: DEFAULT_HOURS_PER_DAY,
        spTable: { ...DEFAULT_GANTT_SP_TABLE },
        pxPerDay: 22,
        showDeps: true,
        workWeekends: false,
        oneParallelPerAssignee: true,
        includeSprints: true,
        sprintOrder: [],
        sprintDates: {},
    },
};

function getEls() {
    return {
        projectSearch: document.getElementById('sg-project-search'),
        projectDropdown: document.getElementById('sg-project-dropdown'),
        comboWrapper: document.getElementById('sg-combo-wrapper'),
        sprintSelect: document.getElementById('sg-sprint-select'),
        analyzeBtn: document.getElementById('sg-analyze-btn'),
        status: document.getElementById('sg-status'),
        placeholder: document.getElementById('sg-placeholder'),
        loading: document.getElementById('sg-loading'),
        loadingText: document.getElementById('sg-loading-text'),
        error: document.getElementById('sg-error'),
        errorText: document.getElementById('sg-error-text'),
        content: document.getElementById('sg-content'),
        stats: document.getElementById('sg-stats'),
        settingsPanel: document.getElementById('sg-settings-panel'),
        warningsPanel: document.getElementById('sg-warnings-panel'),
        warningsCount: document.getElementById('sg-warnings-count'),
        warningsList: document.getElementById('sg-warnings-list'),
        legend: document.getElementById('sg-legend'),
        ganttView: document.getElementById('sg-gantt-view'),
        ganttGrid: document.getElementById('sg-gantt-grid'),
        workloadView: document.getElementById('sg-workload-view'),
        workloadFootnote: document.getElementById('sg-workload-footnote'),
        workloadGrid: document.getElementById('sg-workload-grid'),
        tableView: document.getElementById('sg-table-view'),
        tableHead: document.getElementById('sg-table-head'),
        tableBody: document.getElementById('sg-table-body'),
        tooltip: document.getElementById('sg-tooltip'),
        startDateInput: document.getElementById('sg-start-date'),
        hoursPerDayInput: document.getElementById('sg-hours-per-day'),
        workWeekendsInput: document.getElementById('sg-work-weekends'),
        oneParallelInput: document.getElementById('sg-one-parallel'),
        spTableBody: document.getElementById('sg-sp-table-body'),
        resetConfigBtn: document.getElementById('sg-reset-config'),
        zoomInBtn: document.getElementById('sg-zoom-in'),
        zoomOutBtn: document.getElementById('sg-zoom-out'),
        showDepsBtn: document.getElementById('sg-show-deps'),
        viewTimelineBtn: document.getElementById('sg-view-timeline'),
        viewWorkloadBtn: document.getElementById('sg-view-workload'),
        viewTableBtn: document.getElementById('sg-view-table'),
        searchInput: document.getElementById('sg-search'),
        fsSearchInput: document.getElementById('sg-fs-search'),
        clearSelectionBtn: document.getElementById('sg-clear-selection'),
        criticalBtn: document.getElementById('sg-critical-btn'),
        fullscreenBtn: document.getElementById('sg-fullscreen-btn'),
        fsTimelineBtn: document.getElementById('sg-fs-timeline'),
        fsWorkloadBtn: document.getElementById('sg-fs-workload'),
        fsTableBtn: document.getElementById('sg-fs-table'),
        fsZoomInBtn: document.getElementById('sg-fs-zoom-in'),
        fsZoomOutBtn: document.getElementById('sg-fs-zoom-out'),
        fsDepsBtn: document.getElementById('sg-fs-deps'),
        fsCriticalBtn: document.getElementById('sg-fs-critical'),
        fsExitBtn: document.getElementById('sg-fs-exit'),
    };
}

/* =========================================================================
 * Prefs persistence (UI prefs only — never sprint selection / start date)
 * ========================================================================= */

function savePrefs() {
    try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({
            workWeekends: sgState.config.workWeekends,
            oneParallelPerAssignee: sgState.config.oneParallelPerAssignee,
            hoursPerDay: sgState.config.hoursPerDay,
            spTable: sgState.config.spTable,
            pxPerDay: sgState.config.pxPerDay,
            showDeps: sgState.config.showDeps,
            view: sgState.view,
        }));
    } catch { /* storage unavailable */ }
}

function loadPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.workWeekends === 'boolean') sgState.config.workWeekends = saved.workWeekends;
        if (typeof saved.oneParallelPerAssignee === 'boolean') sgState.config.oneParallelPerAssignee = saved.oneParallelPerAssignee;
        if (Number.isFinite(saved.hoursPerDay) && saved.hoursPerDay > 0) sgState.config.hoursPerDay = saved.hoursPerDay;
        if (saved.spTable && typeof saved.spTable === 'object') sgState.config.spTable = { ...DEFAULT_GANTT_SP_TABLE, ...saved.spTable };
        if (Number.isFinite(saved.pxPerDay)) sgState.config.pxPerDay = Math.min(60, Math.max(8, saved.pxPerDay));
        if (typeof saved.showDeps === 'boolean') sgState.config.showDeps = saved.showDeps;
        if (['timeline', 'workload', 'table'].includes(saved.view)) sgState.view = saved.view;
    } catch { /* ignore corrupt prefs */ }
}

/* =========================================================================
 * Status colors
 * ========================================================================= */

const STATUS_NAME_COLORS = {
    'blocked': 'var(--sg-bad)',
    'in review': 'var(--sg-series-3)',
    'code review': 'var(--sg-series-3)',
    'ready for qa': 'var(--sg-series-5)',
    'qa': 'var(--sg-series-5)',
    'in qa': 'var(--sg-series-5)',
};
const FALLBACK_SLOTS = ['var(--sg-series-4)', 'var(--sg-series-6)', 'var(--sg-series-7)', 'var(--sg-series-8)'];
let fallbackAssignments = {};
let fallbackCursor = 0;

function colorForStatus(status, statusCategory) {
    const key = (status || '').trim().toLowerCase();
    if (STATUS_NAME_COLORS[key]) return STATUS_NAME_COLORS[key];
    if (statusCategory === 'done') return 'var(--sg-good)';
    if (statusCategory === 'indeterminate') return 'var(--sg-series-2)';
    if (statusCategory === 'new') return 'var(--sg-series-1)';
    if (!key) return 'var(--sg-muted)';
    if (!fallbackAssignments[key]) {
        fallbackAssignments[key] = FALLBACK_SLOTS[fallbackCursor % FALLBACK_SLOTS.length];
        fallbackCursor++;
    }
    return fallbackAssignments[key];
}

function taskColor(task) {
    return colorForStatus(task.status, task.statusCategory);
}

const ASSIGNEE_SLOTS = ['var(--sg-series-1)', 'var(--sg-series-2)', 'var(--sg-series-3)', 'var(--sg-series-4)', 'var(--sg-series-5)', 'var(--sg-series-6)', 'var(--sg-series-7)', 'var(--sg-series-8)'];
let assigneeAssignments = {};
let assigneeCursor = 0;

function colorForAssignee(name) {
    const key = (name || '').trim();
    if (!key) return null;
    if (!assigneeAssignments[key]) {
        assigneeAssignments[key] = ASSIGNEE_SLOTS[assigneeCursor % ASSIGNEE_SLOTS.length];
        assigneeCursor++;
    }
    return assigneeAssignments[key];
}

/* =========================================================================
 * Small helpers
 * ========================================================================= */

function setStatus(kind, message) {
    const { status } = getEls();
    if (!status) return;
    if (!message) {
        status.className = 'sg-status hidden';
        status.textContent = '';
        return;
    }
    status.textContent = message;
    status.className = `sg-status sg-status-${kind}`;
}

function showState(state, message = '') {
    const { placeholder, loading, loadingText, error, errorText, content } = getEls();
    [placeholder, loading, error, content].forEach(el => el?.classList.add('hidden'));
    if (state === 'placeholder') placeholder?.classList.remove('hidden');
    if (state === 'loading') {
        loading?.classList.remove('hidden');
        if (loadingText && message) loadingText.textContent = message;
    }
    if (state === 'error') {
        error?.classList.remove('hidden');
        if (errorText && message) errorText.textContent = message;
    }
    if (state === 'content') content?.classList.remove('hidden');
}

function formatDateHuman(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function getSprintSortValue(sprint) {
    return new Date(sprint?.startDate || sprint?.endDate || 0).getTime() || 0;
}

function isoDay(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatISODateLocal(date);
}

function hasAnalysis() {
    return !!sgState.scheduleResult && sgState.order.length > 0;
}

function issueUrl(key) {
    return sgState.host ? `https://${sgState.host}/browse/${encodeURIComponent(key)}` : '';
}

// Search filter: visual only — schedule, stats and warnings still use every task.
function matchesFilter(task) {
    const term = sgState.filterText.trim().toLowerCase();
    if (!term) return true;
    return String(task.displayId || '').toLowerCase().includes(term)
        || String(task.name || '').toLowerCase().includes(term)
        || String(task.assignee || '').toLowerCase().includes(term);
}

function filterActive() {
    return sgState.filterText.trim().length > 0;
}

function allWarnings() {
    return [...sgState.dataWarnings, ...(sgState.scheduleResult?.scheduleWarnings || [])];
}

/* =========================================================================
 * Sprint loading
 * ========================================================================= */

function renderSprintOptions() {
    const { sprintSelect } = getEls();
    if (!sprintSelect) return;
    sprintSelect.innerHTML = sgState.sprintOptions.map(sprint => `
        <option value="${sprint.id}">${escapeHtml(sprint.name)} (${escapeHtml(sprint.state || 'unknown')})</option>
    `).join('');
    sprintSelect.disabled = sgState.sprintOptions.length === 0;
    // Preselect the active sprint — the most common thing to validate.
    const active = sgState.sprintOptions.find(s => s.state === 'active');
    if (active) {
        const option = Array.from(sprintSelect.options).find(o => Number(o.value) === Number(active.id));
        if (option) option.selected = true;
    }
}

async function loadSprintsForProject(projectKey, requestId = sgState.loadRequestId) {
    sgState.sprintOptions = [];
    sgState.boardId = null;
    sgState.sprintFieldId = null;
    renderSprintOptions();
    if (!projectKey || !sgState.host) return;

    setStatus('info', 'Loading project sprints...');
    try {
        sgState.boardId = await fetchBoardId(sgState.host, projectKey);
        if (requestId !== sgState.loadRequestId) return;

        if (sgState.boardId) {
            sgState.sprintOptions = await fetchBoardSprints(sgState.host, sgState.boardId, ['active', 'future', 'closed']);
        } else {
            sgState.sprintFieldId = await fetchSprintFieldId(sgState.host);
            if (requestId !== sgState.loadRequestId) return;
            sgState.sprintOptions = await fetchProjectSprints(sgState.host, projectKey, sgState.sprintFieldId, ['active', 'future', 'closed']);
        }
        if (requestId !== sgState.loadRequestId) return;

        sgState.sprintOptions = [...sgState.sprintOptions]
            .sort((left, right) => getSprintSortValue(right) - getSprintSortValue(left) || String(right.name || '').localeCompare(String(left.name || '')));
        renderSprintOptions();
        setStatus(sgState.sprintOptions.length ? 'success' : 'info',
            sgState.sprintOptions.length
                ? `Loaded ${sgState.sprintOptions.length} sprints. Select one or more and hit Analyze.`
                : 'No sprints found for this project.');
    } catch (error) {
        if (requestId !== sgState.loadRequestId) return;
        sgState.sprintOptions = [];
        renderSprintOptions();
        setStatus('error', error.message || 'Could not load project sprints.');
    }
}

function getSelectedSprints() {
    const { sprintSelect } = getEls();
    if (!sprintSelect) return [];
    const ids = Array.from(sprintSelect.selectedOptions || [])
        .map(option => Number(option.value))
        .filter(value => Number.isFinite(value));
    return sgState.sprintOptions
        .filter(sprint => ids.includes(Number(sprint.id)))
        .sort((a, b) => getSprintSortValue(a) - getSprintSortValue(b)); // chronological
}

/* =========================================================================
 * Analysis
 * ========================================================================= */

async function runGanttAnalysis() {
    const { analyzeBtn } = getEls();
    if (!sgState.host || !sgState.selectedProjectKey) {
        setStatus('error', 'Select a project before building the timeline.');
        return;
    }
    const sprints = getSelectedSprints();
    if (!sprints.length) {
        setStatus('error', 'Select at least one sprint.');
        return;
    }

    const requestId = ++sgState.loadRequestId;
    if (analyzeBtn) analyzeBtn.disabled = true;
    setStatus('', '');
    showState('loading', 'Resolving Story Points field...');

    try {
        const spFieldId = await fetchSpFieldId(sgState.host);
        if (requestId !== sgState.loadRequestId) return;

        const issuesByKey = new Map();
        const sprintNameByIssueKey = {};
        for (let index = 0; index < sprints.length; index += 1) {
            const sprint = sprints[index];
            showState('loading', `Fetching sprint issues: ${index + 1} / ${sprints.length}...`);
            const issues = sgState.boardId
                ? await fetchSprintIssues(sgState.host, sprint.id, spFieldId, ['issuelinks']).catch(() => [])
                : await fetchProjectSprintIssues(sgState.host, sgState.selectedProjectKey, sprint.id, spFieldId, ['issuelinks']).catch(() => []);
            if (requestId !== sgState.loadRequestId) return;
            issues.forEach(issue => {
                if (!issue?.key || issuesByKey.has(issue.key)) return; // earliest sprint wins for shared issues
                issuesByKey.set(issue.key, issue);
                sprintNameByIssueKey[issue.key] = sprint.name;
            });
        }

        const issues = Array.from(issuesByKey.values());
        if (!issues.length) {
            showState('error', 'Jira returned no issues for the selected sprints.');
            return;
        }

        fallbackAssignments = {}; fallbackCursor = 0;
        assigneeAssignments = {}; assigneeCursor = 0;

        const { tasksById, order, warnings } = mapIssuesToTasks(issues, { spFieldId, sprintNameByIssueKey });
        sgState.tasksById = tasksById;
        sgState.order = order;
        sgState.dataWarnings = warnings;
        sgState.selection = null;
        sgState.selectedSprints = sprints;
        sgState.config.sprintOrder = sprints.map(s => s.name);
        sgState.config.sprintDates = {};
        sprints.forEach(sprint => {
            sgState.config.sprintDates[sprint.name] = { start: isoDay(sprint.startDate), end: isoDay(sprint.endDate) };
        });

        if (!sgState.startDateTouched) {
            const firstStart = isoDay(sprints[0]?.startDate);
            sgState.config.startDate = firstStart || formatISODateLocal(new Date());
            const { startDateInput } = getEls();
            if (startDateInput) startDateInput.value = sgState.config.startDate;
        }

        recompute();
        showState('content');
        const linkCount = order.reduce((sum, id) => sum + tasksById[id].needs.length, 0);
        setStatus('success', `Timeline built: ${order.length} issues, ${linkCount} blocking dependencies across ${sprints.length} sprint(s).`);
    } catch (error) {
        if (requestId !== sgState.loadRequestId) return;
        console.error('PMsToolKit Sprint Timeline:', error);
        showState('error', error.message || 'Unexpected error building the timeline.');
        setStatus('error', error.message || 'Unexpected error building the timeline.');
    } finally {
        if (requestId === sgState.loadRequestId && analyzeBtn) analyzeBtn.disabled = false;
    }
}

function recompute() {
    if (!sgState.order.length) return;
    sgState.scheduleResult = computeSchedule(sgState.tasksById, sgState.order, sgState.config);
    renderAll();
}

/* =========================================================================
 * Rendering — stats, warnings, legend, SP table
 * ========================================================================= */

function renderStats() {
    const { stats } = getEls();
    if (!stats || !hasAnalysis()) return;
    const result = sgState.scheduleResult;
    const total = sgState.order.length;
    const doneCount = sgState.order.filter(id => sgState.tasksById[id].done).length;
    const unestimated = sgState.order.filter(id => sgState.tasksById[id].points == null && !sgState.tasksById[id].done).length;
    const days = result.projectDurationHours / (sgState.config.hoursPerDay || 8);
    const warnCount = allWarnings().length;
    const overflow = allWarnings().some(w => w.type === 'sprint-overflow');

    stats.innerHTML = `
        <div class="sg-stat-tile">
            <div class="sg-stat-label">Start</div>
            <div class="sg-stat-value">${formatDateHuman(result.projectStart)}</div>
        </div>
        <div class="sg-stat-tile ${overflow ? 'sg-stat-bad' : 'sg-stat-hero'}">
            <div class="sg-stat-label">Estimated finish</div>
            <div class="sg-stat-value">${formatDateHuman(result.projectEnd)}</div>
            <div class="sg-stat-sub">${overflow ? 'overflows a sprint end date' : 'fits the selected sprints'}</div>
        </div>
        <div class="sg-stat-tile">
            <div class="sg-stat-label">Remaining work</div>
            <div class="sg-stat-value">${days.toFixed(1)}d</div>
            <div class="sg-stat-sub">~ ${(days / 5).toFixed(1)} working weeks</div>
        </div>
        <div class="sg-stat-tile">
            <div class="sg-stat-label">Issues</div>
            <div class="sg-stat-value">${total}</div>
            <div class="sg-stat-sub">${doneCount} done · ${unestimated} unestimated</div>
        </div>
        <div class="sg-stat-tile ${warnCount ? 'sg-stat-warn' : ''}" id="sg-warn-tile">
            <div class="sg-stat-label">Warnings</div>
            <div class="sg-stat-value">${warnCount}</div>
        </div>
    `;
    const warnTile = document.getElementById('sg-warn-tile');
    if (warnTile && warnCount) {
        warnTile.addEventListener('click', () => {
            const { warningsPanel } = getEls();
            if (warningsPanel) {
                warningsPanel.open = true;
                warningsPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }
}

function renderWarnings() {
    const { warningsCount, warningsList, warningsPanel } = getEls();
    if (!warningsList) return;
    const warnings = allWarnings();
    if (warningsCount) warningsCount.textContent = warnings.length ? `(${warnings.length})` : '';
    warningsList.innerHTML = warnings.length
        ? warnings.map(w => `<li class="sg-warn-${escapeHtml(w.type || 'generic')}">${escapeHtml(w.message)}</li>`).join('')
        : '<li class="sg-warn-none">No warnings — the plan is consistent.</li>';
    if (warningsPanel) warningsPanel.open = warnings.length > 0;
}

function renderLegend() {
    const { legend } = getEls();
    if (!legend || !hasAnalysis()) return;
    const seen = new Map();
    for (const id of sgState.order) {
        const t = sgState.tasksById[id];
        const label = (t.status || 'No status').trim() || 'No status';
        if (!seen.has(label)) seen.set(label, taskColor(t));
    }
    let html = '';
    seen.forEach((color, label) => {
        html += `<span class="sg-legend-item"><span class="sg-swatch" style="background:${color}"></span>${escapeHtml(label)}</span>`;
    });
    html += '<span class="sg-legend-item"><span class="sg-swatch sg-swatch-critical"></span>On critical path</span>';
    html += '<span class="sg-legend-item"><span class="sg-swatch sg-swatch-milestone"></span>Unestimated</span>';
    html += '<span class="sg-legend-item"><span class="sg-swatch sg-swatch-done">✓</span>Done (0 time)</span>';
    legend.innerHTML = html;
}

function renderSPTable() {
    const { spTableBody } = getEls();
    if (!spTableBody) return;
    const keys = Object.keys(sgState.config.spTable).map(Number).sort((a, b) => a - b);
    spTableBody.innerHTML = keys.map(k => `
        <tr>
            <td>${k} SP <span class="sg-sp-note">(${SP_TABLE_NOTES[k] || ''})</span></td>
            <td><input type="number" step="0.25" min="0" data-sp="${k}" value="${sgState.config.spTable[k]}"></td>
        </tr>
    `).join('');
    spTableBody.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
            const sp = Number(input.dataset.sp);
            const val = parseFloat(input.value);
            sgState.config.spTable[sp] = Number.isNaN(val) ? 0 : val;
            recompute();
            savePrefs();
        });
    });
}

/* =========================================================================
 * Rendering — timeline
 * ========================================================================= */

function computeTimelineRange() {
    const result = sgState.scheduleResult;
    let min = result.projectStart, max = result.projectEnd;
    for (const id of sgState.order) {
        const sc = result.schedule[id];
        if (sc.start < min) min = sc.start;
        if (sc.end > max) max = sc.end;
    }
    for (const sprint of sgState.selectedSprints) {
        const sd = sgState.config.sprintDates[sprint.name];
        if (sd?.start) { const d = parseISODateLocal(sd.start); if (d < min) min = d; }
        if (sd?.end) { const d = parseISODateLocal(sd.end); if (d > max) max = d; }
    }
    let start = addCalendarDays(min, -3);
    while (start.getDay() !== 1) start = addCalendarDays(start, -1); // back to a Monday
    const end = addCalendarDays(max, 5);
    return { start, end };
}

function dayOffset(date, timelineStart) {
    return (date.getTime() - timelineStart.getTime()) / 86400000;
}

function activeChain() {
    if (!sgState.selection) return null;
    const anc = ancestorsOf(sgState.selection, sgState.tasksById);
    const desc = descendantsOf(sgState.selection, sgState.tasksById, sgState.order);
    return new Set([sgState.selection, ...anc, ...desc]);
}

// Timeline row order: grouped by sprint (chronological, no-sprint last),
// ordered by computed start inside each group. Purely a rendering concern.
function displayOrder() {
    const groups = new Map();
    for (const id of sgState.order) {
        const s = sgState.tasksById[id].sprint || '';
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(id);
    }
    const keys = sgState.config.sprintOrder.filter(name => groups.has(name));
    if (groups.has('')) keys.push('');
    const result = [];
    for (const key of keys) {
        const ids = groups.get(key);
        ids.sort((a, b) => sgState.scheduleResult.schedule[a].start - sgState.scheduleResult.schedule[b].start);
        result.push(...ids);
    }
    return result;
}

function buildAxisHtml(timelineStart, timelineEnd, pxPerDay) {
    let html = '';
    let wk = new Date(timelineStart);
    while (wk < timelineEnd) {
        const x = dayOffset(wk, timelineStart) * pxPerDay;
        html += `<div class="sg-axis-week" style="left:${x}px; width:${7 * pxPerDay}px;">${formatDateHuman(wk)}</div>`;
        wk = addCalendarDays(wk, 7);
    }
    return html;
}

function buildSprintAxisHtml(timelineStart, timelineEnd, pxPerDay) {
    let html = '';
    for (const sprint of sgState.selectedSprints) {
        const sd = sgState.config.sprintDates[sprint.name];
        if (!sd || !sd.start || !sd.end) continue;
        const sStart = parseISODateLocal(sd.start);
        const sEnd = parseISODateLocal(sd.end);
        if (sEnd < timelineStart || sStart > timelineEnd) continue;
        const clippedStart = sStart < timelineStart ? timelineStart : sStart;
        const clippedEnd = sEnd > timelineEnd ? timelineEnd : sEnd;
        const x1 = dayOffset(clippedStart, timelineStart) * pxPerDay;
        const x2 = dayOffset(clippedEnd, timelineStart) * pxPerDay;
        html += `<div class="sg-sprint-band" style="left:${x1}px; width:${Math.max(2, x2 - x1)}px;" title="${escapeHtml(sprint.name)}: ${formatDateHuman(sStart)} – ${formatDateHuman(sEnd)}">${escapeHtml(sprint.name)}</div>`;
    }
    return html;
}

function buildTimeBackgroundHtml(timelineStart, timelineEnd, pxPerDay) {
    let bgHtml = '';
    if (!sgState.config.workWeekends) {
        let d = new Date(timelineStart);
        while (d < timelineEnd) {
            if (d.getDay() === 6) {
                const x = dayOffset(d, timelineStart) * pxPerDay;
                bgHtml += `<div class="sg-weekend-band" style="left:${x}px; width:${2 * pxPerDay}px;"></div>`;
            }
            d = addCalendarDays(d, 1);
        }
    }
    let wg = new Date(timelineStart);
    while (wg < timelineEnd) {
        const x = dayOffset(wg, timelineStart) * pxPerDay;
        bgHtml += `<div class="sg-week-gridline" style="left:${x}px;"></div>`;
        wg = addCalendarDays(wg, 7);
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (today >= timelineStart && today <= timelineEnd) {
        const x = dayOffset(today, timelineStart) * pxPerDay;
        bgHtml += `<div class="sg-today-line" style="left:${x}px;"></div><div class="sg-today-flag" style="left:${x}px;">Today</div>`;
    }
    for (const sprint of sgState.selectedSprints) {
        const sd = sgState.config.sprintDates[sprint.name];
        if (!sd) continue;
        for (const [field, cls] of [['start', 'start'], ['end', 'end']]) {
            if (!sd[field]) continue;
            const d = parseISODateLocal(sd[field]);
            if (d >= timelineStart && d <= timelineEnd) {
                const x = dayOffset(d, timelineStart) * pxPerDay;
                bgHtml += `<div class="sg-sprint-boundary" style="left:${x}px;"></div><div class="sg-sprint-boundary-label ${cls}" style="left:${x}px;">${escapeHtml(sprint.name)} ${field}</div>`;
            }
        }
    }
    return bgHtml;
}

function renderGantt() {
    const { ganttGrid } = getEls();
    if (!ganttGrid || !hasAnalysis()) return;
    const rows = displayOrder().filter(id => matchesFilter(sgState.tasksById[id]));
    if (!rows.length) {
        ganttGrid.style.gridTemplateColumns = '';
        ganttGrid.style.gridTemplateRows = '';
        ganttGrid.innerHTML = '<div class="sg-empty-state">No issues match the current filter.</div>';
        return;
    }
    const schedule = sgState.scheduleResult.schedule;
    const { start: timelineStart, end: timelineEnd } = computeTimelineRange();
    const pxPerDay = sgState.config.pxPerDay;
    const totalDays = Math.max(1, dayOffset(timelineEnd, timelineStart));
    const timelineWidth = Math.ceil(totalDays * pxPerDay) + 40;
    const showSprintAxis = sgState.selectedSprints.length > 0;
    const sprintAxisH = showSprintAxis ? 22 : 0;
    const weekAxisH = 40;
    const axisH = weekAxisH + sprintAxisH;

    ganttGrid.style.gridTemplateColumns = `var(--sg-label-w) ${timelineWidth}px`;
    ganttGrid.style.gridTemplateRows = `${axisH}px repeat(${rows.length}, ${ROW_H}px)`;

    const chain = activeChain();

    let html = `<div class="sg-corner">${filterActive() ? `${rows.length} / ${sgState.order.length}` : rows.length} issues</div>`;
    html += `<div class="sg-axis" style="height:${axisH}px;">`;
    if (showSprintAxis) html += `<div class="sg-sprint-axis" style="height:${sprintAxisH}px;">${buildSprintAxisHtml(timelineStart, timelineEnd, pxPerDay)}</div>`;
    html += `<div class="sg-axis-inner" style="height:${weekAxisH}px;">${buildAxisHtml(timelineStart, timelineEnd, pxPerDay)}</div>`;
    html += '</div>';

    for (const id of rows) {
        const t = sgState.tasksById[id];
        const dimmed = chain && !chain.has(id);
        const flag = t.done ? '✓' : (t.points == null ? '⚠' : '');
        const who = t.assignee ? escapeHtml(t.assignee) : 'Unassigned';
        const spText = t.points != null ? `${t.points} SP` : 'unestimated';
        const url = issueUrl(id);
        html += `<div class="sg-label-row ${dimmed ? 'sg-dimmed' : ''}" data-task="${escapeHtml(id)}">
            <span class="sg-status-dot" style="background:${taskColor(t)}"></span>
            <div class="sg-label-main">
                <div class="sg-label-name-row">
                    ${url
                        ? `<a class="sg-label-id" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="Open ${escapeHtml(t.displayId)} in Jira">${escapeHtml(t.displayId)}</a>`
                        : `<span class="sg-label-id">${escapeHtml(t.displayId)}</span>`}
                    <span class="sg-label-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                    ${flag ? `<span class="sg-label-flag ${t.done ? 'sg-flag-done' : ''}" title="${t.done ? 'Done' : 'Unestimated'}">${flag}</span>` : ''}
                </div>
                <div class="sg-label-meta">${who} · <span class="${t.points == null ? 'sg-unest' : ''}">${spText}</span>${t.sprint ? ` · ${escapeHtml(t.sprint)}` : ''}</div>
            </div>
        </div>`;
    }

    const bodyHeight = rows.length * ROW_H;
    const bgHtml = buildTimeBackgroundHtml(timelineStart, timelineEnd, pxPerDay);
    html += `<div class="sg-body-layer" style="grid-row: 2 / span ${rows.length}; height:${bodyHeight}px;">
        <div class="sg-bg" style="height:${bodyHeight}px;">${bgHtml}</div>
        <svg class="sg-connectors" width="${timelineWidth}" height="${bodyHeight}"></svg>`;

    rows.forEach((id, i) => {
        const t = sgState.tasksById[id];
        const sc = schedule[id];
        const dimmed = (chain && !chain.has(id)) || (sgState.criticalOnly && !sc.critical);
        const x1 = dayOffset(sc.start, timelineStart) * pxPerDay;
        const x2 = dayOffset(sc.end, timelineStart) * pxPerDay;
        const y = i * ROW_H;
        if (t.done) {
            html += `<div class="sg-done-marker ${dimmed ? 'sg-dimmed' : ''}" data-task="${escapeHtml(id)}" style="left:${x1}px; top:${y + (ROW_H - 22) / 2}px;" title="Done — no time allocated">✓ ${escapeHtml(t.displayId)}</div>`;
        } else if (t.points == null) {
            html += `<div class="sg-milestone ${dimmed ? 'sg-dimmed' : ''}" data-task="${escapeHtml(id)}" style="left:${x1}px; top:${y + (ROW_H - 14) / 2}px;"></div>`;
        } else {
            const w = Math.max(6, x2 - x1);
            const assigneeColor = colorForAssignee(t.assignee);
            html += `<div class="sg-bar ${sc.critical ? 'sg-critical' : ''} ${dimmed ? 'sg-dimmed' : ''}" data-task="${escapeHtml(id)}"
                style="left:${x1}px; top:${y + (ROW_H - 22) / 2}px; width:${w}px; background:${taskColor(t)};">
                ${assigneeColor ? `<span class="sg-bar-tick" style="background:${assigneeColor}" title="${escapeHtml(t.assignee)}"></span>` : ''}
                <span class="sg-bar-label">${escapeHtml(t.displayId)}</span>
            </div>`;
        }
    });
    html += '</div>';

    ganttGrid.innerHTML = html;

    const svg = ganttGrid.querySelector('.sg-connectors');
    if (sgState.config.showDeps && svg) {
        let paths = '';
        rows.forEach((id, i) => {
            const scTo = schedule[id];
            const toDimmed = (chain && !chain.has(id)) || (sgState.criticalOnly && !scTo.critical);
            sgState.tasksById[id].needs.forEach(dep => {
                const depIdx = rows.indexOf(dep);
                if (depIdx < 0) return;
                const scFrom = schedule[dep];
                const fromDimmed = (chain && !chain.has(dep)) || (sgState.criticalOnly && !scFrom.critical);
                const bothDimmed = fromDimmed || toDimmed;
                const x1 = dayOffset(scFrom.end, timelineStart) * pxPerDay;
                const y1 = depIdx * ROW_H + ROW_H / 2;
                const x2 = dayOffset(scTo.start, timelineStart) * pxPerDay;
                const y2 = i * ROW_H + ROW_H / 2;
                const midX = x1 + Math.max(10, (x2 - x1) / 2);
                const critical = scFrom.critical && scTo.critical;
                paths += `<path class="${critical ? 'sg-path-critical' : ''} ${bothDimmed ? 'sg-dimmed' : ''}" d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}" />`;
            });
        });
        svg.innerHTML = paths;
        svg.style.display = 'block';
    } else if (svg) {
        svg.style.display = 'none';
    }

    wireRowInteractions(ganttGrid);
}

/* =========================================================================
 * Rendering — workload
 * ========================================================================= */

function utilBadge(pct) {
    const cls = pct >= 0.8 ? 'sg-util-good' : pct >= 0.5 ? 'sg-util-warn' : 'sg-util-bad';
    return `<span class="sg-badge ${cls}">${Math.round(pct * 100)}% utilized</span>`;
}

function renderWorkload() {
    const { workloadGrid, workloadFootnote } = getEls();
    if (!workloadGrid || !hasAnalysis()) return;
    const visibleOrder = sgState.order.filter(id => matchesFilter(sgState.tasksById[id]));
    const { assignees, unassignedCount } = computeWorkload(sgState.tasksById, visibleOrder, sgState.scheduleResult);

    if (workloadFootnote) {
        workloadFootnote.textContent = unassignedCount
            ? `Utilization = busy time ÷ (last task end − first task start), in working hours. ${unassignedCount} issue(s) have no assignee and are excluded.`
            : 'Utilization = busy time ÷ (last task end − first task start), in working hours.';
    }

    if (!assignees.length) {
        workloadGrid.style.gridTemplateColumns = '';
        workloadGrid.style.gridTemplateRows = '';
        workloadGrid.innerHTML = filterActive()
            ? '<div class="sg-empty-state">No issues match the current filter.</div>'
            : '<div class="sg-empty-state">No scheduled issues have an assignee yet.</div>';
        return;
    }

    const schedule = sgState.scheduleResult.schedule;
    const { start: timelineStart, end: timelineEnd } = computeTimelineRange();
    const pxPerDay = sgState.config.pxPerDay;
    const totalDays = Math.max(1, dayOffset(timelineEnd, timelineStart));
    const timelineWidth = Math.ceil(totalDays * pxPerDay) + 40;
    const showSprintAxis = sgState.selectedSprints.length > 0;
    const sprintAxisH = showSprintAxis ? 22 : 0;
    const weekAxisH = 40;
    const axisH = weekAxisH + sprintAxisH;
    const rowH = 40;
    const hpd = sgState.config.hoursPerDay || 8;

    workloadGrid.style.gridTemplateColumns = `var(--sg-label-w) ${timelineWidth}px`;
    workloadGrid.style.gridTemplateRows = [`${axisH}px`, ...assignees.map(a => `${a.laneCount * rowH}px`)].join(' ');

    // Selection in workload highlights the clicked task + its transitive
    // "blocked by" chain only (no descendants, unlike the timeline view).
    const blockerChain = sgState.selection
        ? new Set([sgState.selection, ...ancestorsOf(sgState.selection, sgState.tasksById)])
        : null;

    let html = `<div class="sg-corner">${assignees.length} assignees${filterActive() ? ' (filtered)' : ''}</div>`;
    html += `<div class="sg-axis" style="height:${axisH}px;">`;
    if (showSprintAxis) html += `<div class="sg-sprint-axis" style="height:${sprintAxisH}px;">${buildSprintAxisHtml(timelineStart, timelineEnd, pxPerDay)}</div>`;
    html += `<div class="sg-axis-inner" style="height:${weekAxisH}px;">${buildAxisHtml(timelineStart, timelineEnd, pxPerDay)}</div>`;
    html += '</div>';

    assignees.forEach((a, i) => {
        const rowDimmed = blockerChain && !a.tasks.some(t => blockerChain.has(t.id));
        html += `<div class="sg-workload-label ${rowDimmed ? 'sg-dimmed' : ''}" style="grid-row:${i + 2};">
            <div class="sg-workload-name">
                <span class="sg-status-dot" style="background:${colorForAssignee(a.name) || 'var(--sg-muted)'}"></span>
                ${escapeHtml(a.name)}
                ${a.overbooked ? '<span class="sg-badge sg-badge-critical" title="Has overlapping tasks scheduled at the same time">double-booked</span>' : ''}
            </div>
            <div class="sg-workload-stats">${a.taskCount} tasks · ${a.totalHours}h · ${(a.idleHours / hpd).toFixed(1)}d idle ${utilBadge(a.utilization)}</div>
        </div>`;
    });

    const totalBodyHeight = assignees.reduce((s, a) => s + a.laneCount * rowH, 0);
    const bgHtml = buildTimeBackgroundHtml(timelineStart, timelineEnd, pxPerDay);
    html += `<div class="sg-bg" style="grid-row: 2 / span ${assignees.length}; grid-column:2; height:${totalBodyHeight}px;">${bgHtml}</div>`;

    const startDate = sgState.scheduleResult.projectStart;
    assignees.forEach((a, i) => {
        const toX = (date) => dayOffset(date, timelineStart) * pxPerDay;
        let layerHtml = '';
        a.gaps.forEach(g => {
            const from = schedule[a.tasks.find(t => Math.abs(t.efHours - g.start) < 0.01)?.id];
            const to = schedule[a.tasks.find(t => Math.abs(t.esHours - g.end) < 0.01)?.id];
            if (!from || !to) return;
            const x1 = toX(from.end);
            const x2 = toX(to.start);
            const days = ((g.end - g.start) / hpd).toFixed(1);
            layerHtml += `<div class="sg-idle-block ${blockerChain ? 'sg-dimmed' : ''}" style="left:${x1}px; width:${Math.max(4, x2 - x1)}px;" title="Idle: ${days}d"></div>`;
        });
        a.tasks.forEach(t => {
            const task = sgState.tasksById[t.id];
            const sc = schedule[t.id];
            const dimmed = blockerChain && !blockerChain.has(t.id);
            const x1 = toX(sc.start);
            const x2 = toX(sc.end);
            const barH = rowH - 10;
            const y = t.lane * rowH + Math.round((rowH - barH) / 2);
            layerHtml += `<div class="sg-bar ${sc.critical ? 'sg-critical' : ''} ${dimmed ? 'sg-dimmed' : ''}" data-task="${escapeHtml(t.id)}" style="left:${x1}px; top:${y}px; width:${Math.max(6, x2 - x1)}px; height:${barH}px; background:${taskColor(task)};">
                <span class="sg-bar-label">${escapeHtml(task.displayId)}</span>
            </div>`;
        });
        html += `<div class="sg-body-layer" style="grid-row:${i + 2}; height:${a.laneCount * rowH}px;">${layerHtml}</div>`;
    });

    workloadGrid.innerHTML = html;
    wireRowInteractions(workloadGrid);
}

/* =========================================================================
 * Rendering — table
 * ========================================================================= */

let sortState = { key: 'start', dir: 1 };
const COLUMNS = [
    { key: 'displayId', label: 'Key' },
    { key: 'name', label: 'Summary' },
    { key: 'sprint', label: 'Sprint' },
    { key: 'status', label: 'Status' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'points', label: 'SP' },
    { key: 'hours', label: 'Hours' },
    { key: 'start', label: 'Start' },
    { key: 'end', label: 'End' },
    { key: 'slack', label: 'Slack (d)' },
    { key: 'needs', label: 'Blocked by' },
];

function renderTable() {
    const { tableHead, tableBody } = getEls();
    if (!tableHead || !tableBody || !hasAnalysis()) return;
    const schedule = sgState.scheduleResult.schedule;

    tableHead.innerHTML = COLUMNS.map(c => `<th data-key="${c.key}">${c.label}${sortState.key === c.key ? (sortState.dir === 1 ? ' ↑' : ' ↓') : ''}</th>`).join('');
    tableHead.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (sortState.key === key) sortState.dir *= -1; else { sortState.key = key; sortState.dir = 1; }
            renderTable();
        });
    });

    const hpd = sgState.config.hoursPerDay || 8;
    const sprintIndex = name => {
        const i = sgState.config.sprintOrder.indexOf(name);
        return i === -1 ? Infinity : i;
    };
    const rows = sgState.order.filter(id => matchesFilter(sgState.tasksById[id])).sort((a, b) => {
        const ta = sgState.tasksById[a], tb = sgState.tasksById[b];
        const sa = schedule[a], sb = schedule[b];
        let va, vb;
        switch (sortState.key) {
            case 'displayId': va = ta.displayId; vb = tb.displayId; break;
            case 'name': va = ta.name; vb = tb.name; break;
            case 'sprint': va = sprintIndex(ta.sprint); vb = sprintIndex(tb.sprint); break;
            case 'status': va = ta.status; vb = tb.status; break;
            case 'assignee': va = ta.assignee; vb = tb.assignee; break;
            case 'points': va = ta.points || 0; vb = tb.points || 0; break;
            case 'hours': va = sa.durationHours; vb = sb.durationHours; break;
            case 'start': va = sa.start; vb = sb.start; break;
            case 'end': va = sa.end; vb = sb.end; break;
            case 'slack': va = sa.slack; vb = sb.slack; break;
            case 'needs': va = ta.needs.length; vb = tb.needs.length; break;
            default: va = 0; vb = 0;
        }
        if (va < vb) return -1 * sortState.dir;
        if (va > vb) return 1 * sortState.dir;
        return 0;
    });

    if (!rows.length) {
        tableBody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="sg-empty-state">No issues match the current filter.</td></tr>`;
        return;
    }
    tableBody.innerHTML = rows.map(id => {
        const t = sgState.tasksById[id];
        const sc = schedule[id];
        const needsChips = t.needs.map(d => escapeHtml(d)).join(', ') || '—';
        const url = issueUrl(id);
        return `<tr data-task="${escapeHtml(id)}">
            <td class="sg-num">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(t.displayId)}</a>` : escapeHtml(t.displayId)}</td>
            <td>${escapeHtml(t.name)}</td>
            <td>${t.sprint ? escapeHtml(t.sprint) : '—'}</td>
            <td><span class="sg-badge"><span class="sg-dot" style="background:${taskColor(t)}"></span>${escapeHtml(t.status || 'No status')}</span>${t.done ? '<span class="sg-badge sg-badge-done">✓ Done</span>' : ''}</td>
            <td>${t.assignee ? escapeHtml(t.assignee) : '—'}</td>
            <td class="sg-num">${t.points != null ? t.points : '—'}</td>
            <td class="sg-num">${sc.durationHours}</td>
            <td class="sg-num">${formatDateHuman(sc.start)}</td>
            <td class="sg-num">${formatDateHuman(sc.end)}</td>
            <td class="sg-num">${sc.critical ? '<span class="sg-badge sg-badge-critical">critical</span>' : (sc.slack / hpd).toFixed(1)}</td>
            <td>${needsChips}</td>
        </tr>`;
    }).join('');

    tableBody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', event => {
            if (event.target.closest('a')) return;
            const id = tr.dataset.task;
            sgState.selection = sgState.selection === id ? null : id;
            renderAll();
        });
    });
}

/* =========================================================================
 * Tooltip + interactions
 * ========================================================================= */

function wireRowInteractions(container) {
    container.querySelectorAll('[data-task]').forEach(el => {
        const id = el.dataset.task;
        el.addEventListener('mouseenter', e => showTooltip(id, e));
        el.addEventListener('mousemove', positionTooltip);
        el.addEventListener('mouseleave', hideTooltip);
        el.addEventListener('click', event => {
            if (event.target.closest('a')) return; // ID links open Jira, not the chain isolate
            sgState.selection = sgState.selection === id ? null : id;
            renderAll();
        });
    });
}

function showTooltip(id, evt) {
    const { tooltip } = getEls();
    const t = sgState.tasksById[id];
    const sc = sgState.scheduleResult?.schedule[id];
    if (!tooltip || !t || !sc) return;
    const depsHtml = t.needs.length
        ? t.needs.map(d => `<span class="sg-tt-chip">${escapeHtml(d)}</span>`).join('')
        : '<span class="sg-tt-row">No blocking dependencies</span>';
    tooltip.innerHTML = `
        <div class="sg-tt-title">${escapeHtml(t.displayId)} — ${escapeHtml(t.name)}</div>
        <div class="sg-tt-row">Status: ${escapeHtml(t.status || 'No status')} · ${t.points != null ? `${t.points} SP` : 'Unestimated'} · ${sc.durationHours}h${t.done ? ' · <strong class="sg-tt-done">✓ Done</strong>' : ''}</div>
        ${t.assignee ? `<div class="sg-tt-row">Assignee: ${escapeHtml(t.assignee)}</div>` : ''}
        ${t.sprint ? `<div class="sg-tt-row">Sprint: ${escapeHtml(t.sprint)}</div>` : ''}
        <div class="sg-tt-row">${formatDateHuman(sc.start)} → ${formatDateHuman(sc.end)}${sc.critical ? ' · <strong>critical path</strong>' : ` · slack ${(sc.slack / (sgState.config.hoursPerDay || 8)).toFixed(1)}d`}</div>
        <div class="sg-tt-row">Blocked by:</div>
        <div>${depsHtml}</div>
    `;
    tooltip.style.display = 'block';
    positionTooltip(evt);
}

function positionTooltip(evt) {
    const { tooltip } = getEls();
    if (!tooltip) return;
    const pad = 14;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + 330 > window.innerWidth) x = evt.clientX - 330 - pad;
    if (y + 170 > window.innerHeight) y = evt.clientY - 170 - pad;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

function hideTooltip() {
    const { tooltip } = getEls();
    if (tooltip) tooltip.style.display = 'none';
}

/* =========================================================================
 * View switching + render orchestration
 * ========================================================================= */

// Keeps the normal toggle row and the full-screen bar showing the same
// state: active view, deps label, critical highlight, and which controls
// make sense for the current view (deps/critical are Timeline-only, zoom
// applies to Timeline + Workload).
function syncFullscreenButtons() {
    const els = getEls();
    const depsLabel = `Dependencies: ${sgState.config.showDeps ? 'ON' : 'OFF'}`;
    if (els.showDepsBtn) els.showDepsBtn.textContent = depsLabel;
    if (els.fsDepsBtn) els.fsDepsBtn.textContent = depsLabel;
    els.fsCriticalBtn?.classList.toggle('active', sgState.criticalOnly);
    els.fsTimelineBtn?.classList.toggle('active', sgState.view === 'timeline');
    els.fsWorkloadBtn?.classList.toggle('active', sgState.view === 'workload');
    els.fsTableBtn?.classList.toggle('active', sgState.view === 'table');
    const timelineOnly = sgState.view === 'timeline';
    const zoomable = sgState.view !== 'table';
    if (els.fsDepsBtn) els.fsDepsBtn.style.display = timelineOnly ? '' : 'none';
    if (els.fsCriticalBtn) els.fsCriticalBtn.style.display = timelineOnly ? '' : 'none';
    if (els.fsZoomInBtn) els.fsZoomInBtn.style.display = zoomable ? '' : 'none';
    if (els.fsZoomOutBtn) els.fsZoomOutBtn.style.display = zoomable ? '' : 'none';
}

function renderAll() {
    if (!hasAnalysis()) return;
    renderStats();
    renderWarnings();
    renderLegend();
    syncFullscreenButtons();
    const { clearSelectionBtn, criticalBtn, ganttView, workloadView, tableView, viewTimelineBtn, viewWorkloadBtn, viewTableBtn } = getEls();
    if (clearSelectionBtn) clearSelectionBtn.style.display = sgState.selection ? 'inline-flex' : 'none';
    if (criticalBtn) {
        criticalBtn.classList.toggle('active', sgState.criticalOnly);
        criticalBtn.style.display = sgState.view === 'timeline' ? 'inline-flex' : 'none';
    }
    ganttView?.classList.toggle('hidden', sgState.view !== 'timeline');
    workloadView?.classList.toggle('hidden', sgState.view !== 'workload');
    tableView?.classList.toggle('hidden', sgState.view !== 'table');
    viewTimelineBtn?.classList.toggle('active', sgState.view === 'timeline');
    viewWorkloadBtn?.classList.toggle('active', sgState.view === 'workload');
    viewTableBtn?.classList.toggle('active', sgState.view === 'table');
    if (sgState.view === 'timeline') renderGantt();
    else if (sgState.view === 'workload') renderWorkload();
    else renderTable();
}

function switchView(view) {
    sgState.view = view;
    renderAll();
    savePrefs();
}

/* =========================================================================
 * Init
 * ========================================================================= */

function wireSettings() {
    const els = getEls();

    if (els.startDateInput) {
        els.startDateInput.value = sgState.config.startDate;
        els.startDateInput.addEventListener('change', event => {
            sgState.startDateTouched = true;
            sgState.config.startDate = event.target.value || formatISODateLocal(new Date());
            recompute();
        });
    }
    if (els.hoursPerDayInput) {
        els.hoursPerDayInput.value = sgState.config.hoursPerDay;
        els.hoursPerDayInput.addEventListener('input', event => {
            const v = parseFloat(event.target.value);
            sgState.config.hoursPerDay = Number.isNaN(v) || v <= 0 ? DEFAULT_HOURS_PER_DAY : v;
            recompute();
            savePrefs();
        });
    }
    if (els.workWeekendsInput) {
        els.workWeekendsInput.checked = sgState.config.workWeekends;
        els.workWeekendsInput.addEventListener('change', event => {
            sgState.config.workWeekends = event.target.checked;
            recompute();
            savePrefs();
        });
    }
    if (els.oneParallelInput) {
        els.oneParallelInput.checked = sgState.config.oneParallelPerAssignee;
        els.oneParallelInput.addEventListener('change', event => {
            sgState.config.oneParallelPerAssignee = event.target.checked;
            recompute();
            savePrefs();
        });
    }
    els.resetConfigBtn?.addEventListener('click', () => {
        sgState.config.spTable = { ...DEFAULT_GANTT_SP_TABLE };
        sgState.config.hoursPerDay = DEFAULT_HOURS_PER_DAY;
        sgState.config.workWeekends = false;
        sgState.config.oneParallelPerAssignee = true;
        if (els.hoursPerDayInput) els.hoursPerDayInput.value = DEFAULT_HOURS_PER_DAY;
        if (els.workWeekendsInput) els.workWeekendsInput.checked = false;
        if (els.oneParallelInput) els.oneParallelInput.checked = true;
        renderSPTable();
        recompute();
        savePrefs();
    });
    els.zoomInBtn?.addEventListener('click', () => {
        sgState.config.pxPerDay = Math.min(60, Math.round(sgState.config.pxPerDay * 1.25));
        renderAll();
        savePrefs();
    });
    els.zoomOutBtn?.addEventListener('click', () => {
        sgState.config.pxPerDay = Math.max(8, Math.round(sgState.config.pxPerDay * 0.8));
        renderAll();
        savePrefs();
    });
    if (els.showDepsBtn) {
        els.showDepsBtn.textContent = `Dependencies: ${sgState.config.showDeps ? 'ON' : 'OFF'}`;
        els.showDepsBtn.addEventListener('click', () => {
            sgState.config.showDeps = !sgState.config.showDeps;
            els.showDepsBtn.textContent = `Dependencies: ${sgState.config.showDeps ? 'ON' : 'OFF'}`;
            renderAll();
            savePrefs();
        });
    }

    // Search filter — the normal bar and full-screen bar inputs mirror each other.
    const applyFilter = value => {
        sgState.filterText = value || '';
        if (els.searchInput && els.searchInput.value !== sgState.filterText) els.searchInput.value = sgState.filterText;
        if (els.fsSearchInput && els.fsSearchInput.value !== sgState.filterText) els.fsSearchInput.value = sgState.filterText;
        renderAll();
    };
    els.searchInput?.addEventListener('input', event => applyFilter(event.target.value));
    els.fsSearchInput?.addEventListener('input', event => applyFilter(event.target.value));

    els.viewTimelineBtn?.addEventListener('click', () => switchView('timeline'));
    els.viewWorkloadBtn?.addEventListener('click', () => switchView('workload'));
    els.viewTableBtn?.addEventListener('click', () => switchView('table'));
    els.clearSelectionBtn?.addEventListener('click', () => {
        sgState.selection = null;
        renderAll();
    });
    els.criticalBtn?.addEventListener('click', () => {
        sgState.criticalOnly = !sgState.criticalOnly;
        renderAll();
    });

    // ---- Full screen ----
    const { content, fullscreenBtn } = els;
    const enterFs = () => { if (content?.requestFullscreen) content.requestFullscreen().catch(() => {}); };
    const exitFs = () => { if (document.fullscreenElement) document.exitFullscreen(); };
    fullscreenBtn?.addEventListener('click', () => { document.fullscreenElement ? exitFs() : enterFs(); });
    els.fsExitBtn?.addEventListener('click', exitFs);
    els.fsTimelineBtn?.addEventListener('click', () => switchView('timeline'));
    els.fsWorkloadBtn?.addEventListener('click', () => switchView('workload'));
    els.fsTableBtn?.addEventListener('click', () => switchView('table'));
    els.fsZoomInBtn?.addEventListener('click', () => els.zoomInBtn?.click());
    els.fsZoomOutBtn?.addEventListener('click', () => els.zoomOutBtn?.click());
    els.fsDepsBtn?.addEventListener('click', () => els.showDepsBtn?.click());
    els.fsCriticalBtn?.addEventListener('click', () => els.criticalBtn?.click());
    document.addEventListener('fullscreenchange', () => {
        const on = document.fullscreenElement === content;
        if (fullscreenBtn) {
            fullscreenBtn.textContent = on ? '⛶ Exit full screen' : '⛶ Full screen';
            fullscreenBtn.classList.toggle('active', on);
        }
        renderAll(); // re-fit the active view to the (new) available height
    });

    renderSPTable();
}

export function initSprintGantt(allProjects = [], currentHost = '', initialProjectKey = '') {
    sgState.allProjects = Array.isArray(allProjects) ? allProjects : [];
    sgState.host = currentHost || '';
    sgState.selectedProjectKey = initialProjectKey || '';

    const { projectSearch, projectDropdown, comboWrapper, sprintSelect, analyzeBtn } = getEls();
    if (!projectSearch || !projectDropdown || !comboWrapper || !sprintSelect || !analyzeBtn) return;

    loadPrefs();
    wireSettings();

    function renderProjectOptions(filterText = '') {
        const term = String(filterText || '').toLowerCase();
        const filtered = sgState.allProjects.filter(project =>
            !term
            || project.name.toLowerCase().includes(term)
            || project.key.toLowerCase().includes(term)
        );
        if (!filtered.length) {
            projectDropdown.innerHTML = '<div class="combo-msg">No projects found</div>';
            return;
        }
        projectDropdown.innerHTML = filtered.map(project => `
            <div class="combo-option ${project.key === sgState.selectedProjectKey ? 'selected' : ''}" data-key="${escapeHtml(project.key)}" data-name="${escapeHtml(project.name)}">
                <span class="combo-option-key">${escapeHtml(project.key)}</span>${escapeHtml(project.name)}
            </div>
        `).join('');
    }

    projectSearch.addEventListener('focus', () => {
        projectSearch.select();
        projectDropdown.classList.remove('hidden');
        renderProjectOptions('');
    });

    projectSearch.addEventListener('input', event => {
        projectDropdown.classList.remove('hidden');
        renderProjectOptions(event.target.value);
    });

    projectDropdown.addEventListener('click', event => {
        const option = event.target.closest('.combo-option');
        if (!option) return;
        const requestId = ++sgState.loadRequestId;
        sgState.selectedProjectKey = String(option.dataset.key || '').trim();
        projectSearch.value = `${option.dataset.name} (${option.dataset.key})`;
        projectDropdown.classList.add('hidden');
        sgState.scheduleResult = null;
        sgState.order = [];
        setStatus('', '');
        showState('placeholder');
        void loadSprintsForProject(sgState.selectedProjectKey, requestId);
    });

    document.addEventListener('click', event => {
        if (!comboWrapper.contains(event.target)) {
            projectDropdown.classList.add('hidden');
            if (sgState.selectedProjectKey) {
                const project = sgState.allProjects.find(item => item.key === sgState.selectedProjectKey);
                if (project) projectSearch.value = `${project.name} (${project.key})`;
            } else {
                projectSearch.value = '';
            }
        }
    });

    analyzeBtn.addEventListener('click', () => {
        void runGanttAnalysis();
    });

    if (sgState.allProjects.length > 0) {
        projectSearch.placeholder = 'Search project...';
    }

    if (initialProjectKey) {
        const project = sgState.allProjects.find(item => item.key === initialProjectKey);
        if (project) {
            projectSearch.value = `${project.name} (${project.key})`;
            // Lazy: only fetch sprint metadata once the tab is first opened.
            let sprintsLoaded = false;
            const lazyLoad = event => {
                if (event.detail?.view !== 'sprint-gantt' || sprintsLoaded) return;
                sprintsLoaded = true;
                void loadSprintsForProject(sgState.selectedProjectKey);
            };
            document.addEventListener('analytics:viewchange', lazyLoad);
        }
    }
}

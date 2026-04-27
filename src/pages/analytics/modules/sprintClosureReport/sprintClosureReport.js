import { storage } from '../../../../common/storage.js';
import { getDemoMode } from '../../../../common/demoMode.js';
import { loadDemoSessionValue, saveDemoSessionValue } from '../../../../common/demoSessionStore.js';
import {
    fetchBoardId,
    fetchBoardSprints,
    fetchIssueChangelog,
    fetchProjectSprints,
    fetchProjectSprintIssues,
    fetchProjectStatuses,
    fetchSpFieldId,
    fetchSprintFieldId,
    fetchSprintIssues,
} from '../jiraApi.js';
import { escapeHtml, formatDate } from '../utils.js';
import {
    buildSprintClosureReportModel,
    getDefaultSprintClosureState,
    getSprintClosureStorageKey,
    normalizeSprintClosureState,
    renderIssueOption,
    renderOriginBadge,
} from './sprintClosureModel.js';

const closureState = {
    allProjects: [],
    host: '',
    projectKey: '',
    boardId: null,
    allSprints: [],
    closedSprints: [],
    selectedSprintId: null,
    selectedSprint: null,
    nextSprint: null,
    spFieldId: null,
    sprintFieldId: null,
    statusCategoryMap: {},
    statusOptions: [],
    rawIssues: [],
    reportState: getDefaultSprintClosureState(),
    model: null,
    captureMode: false,
    saveTimer: null,
    loadRequestId: 0,
};

const DEMO_CLOSURE_NAMESPACE = 'closure-report';

async function readClosurePersistedState(storageKey) {
    if (await getDemoMode()) {
        const saved = await loadDemoSessionValue(DEMO_CLOSURE_NAMESPACE, {});
        return { [storageKey]: saved[storageKey] || null };
    }
    return storage.get(storageKey);
}

async function writeClosurePersistedState(storageKey, value) {
    if (await getDemoMode()) {
        const saved = await loadDemoSessionValue(DEMO_CLOSURE_NAMESPACE, {});
        await saveDemoSessionValue(DEMO_CLOSURE_NAMESPACE, {
            ...saved,
            [storageKey]: value,
        });
        return;
    }
    await storage.set({ [storageKey]: value });
}

async function removeClosurePersistedState(storageKey) {
    if (await getDemoMode()) {
        const saved = await loadDemoSessionValue(DEMO_CLOSURE_NAMESPACE, {});
        delete saved[storageKey];
        await saveDemoSessionValue(DEMO_CLOSURE_NAMESPACE, saved);
        return;
    }
    await storage.remove(storageKey);
}

export function initSprintClosureReport(allProjects = [], host = '', initialProjectKey = '') {
    closureState.allProjects = Array.isArray(allProjects) ? allProjects : [];
    closureState.host = host || '';

    bindUiEvents();
    renderProjectOptions();

    if (initialProjectKey && closureState.allProjects.some(project => project.key === initialProjectKey)) {
        const select = document.getElementById('scr-project-select');
        if (select) select.value = initialProjectKey;
        void selectClosureProject(initialProjectKey);
    }
}

function bindUiEvents() {
    const projectSelect = document.getElementById('scr-project-select');
    const sprintSelect = document.getElementById('scr-sprint-select');
    const refreshBtn = document.getElementById('scr-refresh-btn');
    const modeBtn = document.getElementById('scr-mode-btn');
    const resetBtn = document.getElementById('scr-reset-btn');
    const content = document.getElementById('scr-content');

    if (projectSelect && !projectSelect.dataset.bound) {
        projectSelect.addEventListener('change', () => {
            void selectClosureProject(projectSelect.value);
        });
        projectSelect.dataset.bound = 'true';
    }

    if (sprintSelect && !sprintSelect.dataset.bound) {
        sprintSelect.addEventListener('change', () => {
            const sprintId = Number(sprintSelect.value);
            if (!Number.isNaN(sprintId)) {
                void selectClosureSprint(sprintId);
            }
        });
        sprintSelect.dataset.bound = 'true';
    }

    if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.addEventListener('click', () => {
            if (!closureState.projectKey || !closureState.selectedSprintId) return;
            void selectClosureSprint(closureState.selectedSprintId, { forceReload: true });
        });
        refreshBtn.dataset.bound = 'true';
    }

    if (modeBtn && !modeBtn.dataset.bound) {
        modeBtn.addEventListener('click', () => {
            if (!closureState.model) return;
            if (!closureState.captureMode && closureState.model.missingObservationCount > 0) {
                renderInlineNotice(`${closureState.model.missingObservationCount} carryover observation${closureState.model.missingObservationCount === 1 ? '' : 's'} missing.`);
                return;
            }

            closureState.captureMode = !closureState.captureMode;
            syncCaptureModeUi();
        });
        modeBtn.dataset.bound = 'true';
    }

    if (resetBtn && !resetBtn.dataset.bound) {
        resetBtn.addEventListener('click', async () => {
            if (!closureState.projectKey || !closureState.selectedSprintId) return;
            if (!window.confirm('Reset this sprint report to the original auto-detected state?')) return;

            const storageKey = getSprintClosureStorageKey(closureState.host, closureState.projectKey, closureState.selectedSprintId);
            closureState.reportState = getDefaultSprintClosureState();
            closureState.captureMode = false;
            clearTimeout(closureState.saveTimer);
            await removeClosurePersistedState(storageKey);
            rebuildClosureModel();
            renderClosureContent();
            renderInlineNotice('Report reset to the original detected state.');
        });
        resetBtn.dataset.bound = 'true';
    }

    if (content && !content.dataset.bound) {
        content.addEventListener('click', event => {
            const actionBtn = event.target.closest('[data-scr-action]');
            if (!actionBtn) return;

            const action = actionBtn.dataset.scrAction;
            const issueKey = actionBtn.dataset.issueKey;
            const section = actionBtn.dataset.section;

            if (action === 'exclude' && issueKey && section) {
                setSectionOverride(section, issueKey, 'excluded');
                return;
            }
            if (action === 'restore' && issueKey && section) {
                restoreSectionIssue(section, issueKey);
                return;
            }
            if (action === 'add' && section) {
                const select = document.getElementById(section === 'carryover' ? 'scr-carryover-add-select' : 'scr-scope-add-select');
                const selectedIssueKey = select?.value || '';
                if (selectedIssueKey) setSectionOverride(section, selectedIssueKey, 'included');
            }
        });

        content.addEventListener('input', event => {
            const observation = event.target.closest('.scr-observation-input');
            if (!observation) return;

            const issueKey = observation.dataset.issueKey;
            if (!issueKey) return;

            closureState.reportState.observationsByIssue[issueKey] = observation.value;
            closureState.reportState.updatedAt = Date.now();
            syncObservationUi();
            scheduleStateSave();
        });

        content.addEventListener('change', event => {
            const statusSelect = event.target.closest('.scr-status-select');
            if (!statusSelect) return;

            const issueKey = statusSelect.dataset.issueKey;
            if (!issueKey) return;

            closureState.reportState.currentStatusOverridesByIssue[issueKey] = statusSelect.value;
            closureState.reportState.updatedAt = Date.now();
            rebuildClosureModel();
            renderClosureContent();
            scheduleStateSave();
        });

        content.dataset.bound = 'true';
    }
}

function renderProjectOptions() {
    const select = document.getElementById('scr-project-select');
    if (!select) return;

    if (!closureState.host) {
        select.innerHTML = '<option value="">Open Jira first</option>';
        select.disabled = true;
        return;
    }

    select.disabled = false;
    const options = closureState.allProjects
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(project => `<option value="${escapeHtml(project.key)}">${escapeHtml(project.name)} (${escapeHtml(project.key)})</option>`);

    select.innerHTML = ['<option value="">Select project...</option>', ...options].join('');
}

async function selectClosureProject(projectKey) {
    closureState.projectKey = projectKey || '';
    closureState.boardId = null;
    closureState.allSprints = [];
    closureState.closedSprints = [];
    closureState.selectedSprintId = null;
    closureState.selectedSprint = null;
    closureState.nextSprint = null;
    closureState.rawIssues = [];
    closureState.model = null;
    closureState.captureMode = false;
    syncCaptureModeUi();
    renderSprintOptions();

    if (!projectKey) {
        showClosureState('placeholder');
        return;
    }

    const requestId = ++closureState.loadRequestId;
    showClosureState('loading', 'Loading closed sprints...');

    try {
        closureState.spFieldId = await fetchSpFieldId(closureState.host);
        closureState.sprintFieldId = await fetchSprintFieldId(closureState.host);
        closureState.boardId = await fetchBoardId(closureState.host, projectKey);

        if (requestId !== closureState.loadRequestId) return;

        const [allSprints, statuses] = await Promise.all([
            closureState.boardId
                ? fetchBoardSprints(closureState.host, closureState.boardId, ['closed', 'active', 'future'])
                : fetchProjectSprints(closureState.host, projectKey, closureState.sprintFieldId, ['closed', 'active', 'future']),
            fetchProjectStatuses(closureState.host, projectKey).catch(() => []),
        ]);
        if (requestId !== closureState.loadRequestId) return;

        closureState.allSprints = allSprints.slice().sort(compareSprintsAsc);
        closureState.closedSprints = closureState.allSprints
            .filter(sprint => sprint.state === 'closed')
            .sort(compareSprintsDesc);
        closureState.statusCategoryMap = Object.fromEntries(
            statuses.map(status => [String(status.name || '').toLowerCase(), status.categoryKey || '']),
        );
        closureState.statusOptions = statuses
            .map(status => String(status.name || '').trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));
        renderSprintOptions();

        if (!closureState.closedSprints.length) {
            showClosureState('empty', 'No closed sprints found for this project.');
            return;
        }

        const latestClosed = closureState.closedSprints[0];
        const sprintSelect = document.getElementById('scr-sprint-select');
        if (sprintSelect) sprintSelect.value = String(latestClosed.id);
        await selectClosureSprint(latestClosed.id);
    } catch (error) {
        if (requestId !== closureState.loadRequestId) return;
        showClosureState('error', error.message || 'Failed to load sprint closure report.');
    }
}

async function selectClosureSprint(sprintId, opts = {}) {
    if (!closureState.projectKey || !sprintId) return;
    const sprint = closureState.closedSprints.find(item => item.id === sprintId);
    if (!sprint) return;

    const requestId = ++closureState.loadRequestId;
    closureState.selectedSprintId = sprintId;
    closureState.selectedSprint = sprint;
    closureState.nextSprint = findNextSprint(closureState.allSprints, sprint);
    closureState.captureMode = false;
    syncCaptureModeUi();
    showClosureState('loading', 'Loading sprint report...');

    try {
        const issues = closureState.boardId
            ? await fetchSprintIssues(
                closureState.host,
                sprint.id,
                closureState.spFieldId,
                closureState.sprintFieldId ? [closureState.sprintFieldId] : [],
            )
            : await fetchProjectSprintIssues(
                closureState.host,
                closureState.projectKey,
                sprint.id,
                closureState.spFieldId,
                closureState.sprintFieldId ? [closureState.sprintFieldId] : [],
            );
        if (requestId !== closureState.loadRequestId) return;

        issues.forEach(issue => {
            issue._sp = closureState.spFieldId ? Number(issue.fields?.[closureState.spFieldId] || 0) : 0;
        });

        const CONCURRENCY = 4;
        for (let index = 0; index < issues.length; index += CONCURRENCY) {
            const batch = issues.slice(index, index + CONCURRENCY);
            const changelogs = await Promise.all(batch.map(issue => fetchIssueChangelog(closureState.host, issue.key).catch(() => [])));
            if (requestId !== closureState.loadRequestId) return;
            batch.forEach((issue, batchIndex) => {
                issue._changelogHistories = changelogs[batchIndex];
            });
        }

        const storageKey = getSprintClosureStorageKey(closureState.host, closureState.projectKey, sprint.id);
        const saved = await readClosurePersistedState(storageKey);
        if (requestId !== closureState.loadRequestId) return;

        closureState.reportState = normalizeSprintClosureState(saved[storageKey] || {});
        closureState.rawIssues = issues;
        rebuildClosureModel();
        renderClosureContent();
    } catch (error) {
        if (requestId !== closureState.loadRequestId) return;
        showClosureState('error', error.message || 'Failed to load sprint closure report.');
    }
}

function rebuildClosureModel() {
    closureState.model = buildSprintClosureReportModel({
        issues: closureState.rawIssues,
        sprint: closureState.selectedSprint,
        nextSprint: closureState.nextSprint,
        reportState: closureState.reportState,
        statusCategoryMap: closureState.statusCategoryMap,
        host: closureState.host,
        sprintFieldId: closureState.sprintFieldId,
        spFieldId: closureState.spFieldId,
    });
}

function renderClosureContent() {
    const content = document.getElementById('scr-content');
    if (!content || !closureState.model) return;

    showClosureState('content');

    const { sprint, nextSprint, summary, carryovers, scopeCreep, hiddenCarryovers, hiddenScopeCreep, carryoverCandidates, scopeCreepCandidates } = closureState.model;
    const closeLabel = sprint?.completeDate || sprint?.endDate ? formatDate(new Date(sprint.completeDate || sprint.endDate)) : '—';
    const nextLabel = nextSprint?.name ? escapeHtml(nextSprint.name) : 'No next sprint detected';
    const progressAngle = Math.max(0, Math.min(100, summary.completionRate));
    const missingObs = closureState.model.missingObservationCount;
    const totalVisibleRows = carryovers.length + scopeCreep.length;
    const compactMode = totalVisibleRows >= (closureState.captureMode ? 7 : 9);
    const committedCompletionRate = summary.committedSP > 0
        ? Math.round((summary.completedSP / summary.committedSP) * 100)
        : 0;

    content.innerHTML = `
        <div class="scr-shell ${closureState.captureMode ? 'is-capture' : ''} ${compactMode ? 'is-compact' : ''}">
            <div class="scr-hero-card">
                <div class="scr-hero-copy">
                    <div class="scr-kicker">Sprint Closure Report</div>
                    <h2>${escapeHtml(sprint?.name || 'Closed sprint')}</h2>
                    <p>Closed on ${escapeHtml(closeLabel)} · Next sprint: ${nextLabel}</p>
                </div>
                <div class="scr-hero-actions">
                    <span class="scr-inline-pill">${summary.totalSP} SP total</span>
                    <span class="scr-inline-pill ${missingObs ? 'is-warning' : ''}" id="scr-missing-pill">${missingObs ? `${missingObs} observation${missingObs === 1 ? '' : 's'} missing` : 'Observations complete'}</span>
                    <button class="icon-action-btn" id="scr-mode-btn-inline">${closureState.captureMode ? '✏️ Edit Mode' : '📸 Capture Mode'}</button>
                </div>
            </div>

            <div class="scr-chart-card">
                <div class="scr-chart-copy scr-chart-copy-side">
                    <div class="scr-donut" style="background: conic-gradient(#ff8b00 0 ${progressAngle}%, #e5e9f2 ${progressAngle}% 100%);">
                        <div class="scr-donut-inner">${summary.completionRate}%</div>
                    </div>
                </div>

                <div class="scr-math-summary">
                    <div class="scr-math-title">Sprint Summary</div>
                    <div class="scr-math-line"><strong>${summary.committedSP}</strong><span>Committed Work</span></div>
                    <div class="scr-math-line"><strong>${summary.scopeCreepSP}</strong><span>Scope Creep during the Sprint</span></div>
                    <div class="scr-math-line is-total"><strong>${summary.totalSP}</strong><span>Total</span></div>

                    <div class="scr-math-gap"></div>

                    <div class="scr-math-line"><strong>${summary.completedSP}</strong><span>SP Completed (${committedCompletionRate}% of the committed work)</span></div>
                    <div class="scr-math-line"><strong>${summary.carryoverSP}</strong><span>SP are carryovers for next Sprint</span></div>
                    <div class="scr-math-line is-total"><strong>${summary.completionRate}%</strong><span>Completion Rate on ${escapeHtml(closeLabel)}</span></div>
                </div>
            </div>

            <div class="scr-section-card">
                <div class="scr-section-header">
                    <div>
                        <div class="scr-section-title">Carryovers</div>
                        <div class="scr-section-sub">Tickets moved to the next sprint. Observations are required before capture mode.</div>
                    </div>
                    <div class="scr-add-row scr-edit-only">
                        <select id="scr-carryover-add-select" class="scr-select">
                            <option value="">Add carryover ticket...</option>
                            ${carryoverCandidates.map(renderIssueOption).join('')}
                        </select>
                        <button class="btn-export scr-add-btn" data-scr-action="add" data-section="carryover">Add</button>
                    </div>
                </div>
                ${renderCarryoverTable(carryovers, closureState.statusOptions)}
                ${renderHiddenSection('carryover', hiddenCarryovers)}
            </div>

            <div class="scr-section-card">
                <div class="scr-section-header">
                    <div>
                        <div class="scr-section-title">Scope Creep</div>
                        <div class="scr-section-sub">Net scope delta per ticket during the sprint, including added tickets and Story Point changes after sprint start.</div>
                    </div>
                    <div class="scr-add-row scr-edit-only">
                        <select id="scr-scope-add-select" class="scr-select">
                            <option value="">Add scope creep ticket...</option>
                            ${scopeCreepCandidates.map(renderIssueOption).join('')}
                        </select>
                        <button class="btn-export scr-add-btn" data-scr-action="add" data-section="scope">Add</button>
                    </div>
                </div>
                ${renderScopeTable(scopeCreep, closureState.statusOptions)}
                ${renderHiddenSection('scope', hiddenScopeCreep)}
            </div>
        </div>
    `;

    const inlineModeBtn = document.getElementById('scr-mode-btn-inline');
    if (inlineModeBtn && !inlineModeBtn.dataset.bound) {
        inlineModeBtn.addEventListener('click', () => {
            document.getElementById('scr-mode-btn')?.click();
        });
        inlineModeBtn.dataset.bound = 'true';
    }

    syncCaptureModeUi();
    syncObservationUi();
}

function renderCarryoverTable(carryovers, statusOptions = []) {
    if (!carryovers.length) {
        return '<div class="scr-empty-row">No carryovers in this report.</div>';
    }

    return `
        <div class="scr-table-wrap">
            <table class="scr-table">
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Summary</th>
                        <th>Status At Close</th>
                        <th>Current Status</th>
                        <th>SP</th>
                        <th class="scr-origin-col">Origin</th>
                        <th>Observation</th>
                        <th class="scr-edit-only">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${carryovers.map(issue => `
                        <tr>
                            <td><a href="${escapeHtml(issue.jiraUrl)}" target="_blank" rel="noreferrer">${escapeHtml(issue.key)}</a></td>
                            <td>${escapeHtml(issue.summary)}</td>
                            <td>${escapeHtml(issue.statusAtClose || '—')}</td>
                            <td>${renderStatusCell(issue, statusOptions)}</td>
                            <td>${issue.sp}</td>
                            <td class="scr-origin-col">${renderOriginBadge(issue.origin)}</td>
                            <td>
                                <textarea class="scr-observation-input" data-issue-key="${escapeHtml(issue.key)}" placeholder="Observation for carryover">${escapeHtml(issue.observation || '')}</textarea>
                                <div class="scr-capture-observation">${escapeHtml(issue.observation || 'Observation pending')}</div>
                            </td>
                            <td class="scr-edit-only">
                                <button class="scr-row-btn" data-scr-action="exclude" data-section="carryover" data-issue-key="${escapeHtml(issue.key)}">Remove</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderScopeTable(scopeCreep, statusOptions = []) {
    if (!scopeCreep.length) {
        return '<div class="scr-empty-row">No scope creep in this report.</div>';
    }

    return `
        <div class="scr-table-wrap">
            <table class="scr-table">
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Summary</th>
                        <th>Changed On</th>
                        <th>Current Status</th>
                        <th>Δ SP</th>
                        <th class="scr-origin-col">Origin</th>
                        <th class="scr-edit-only">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${scopeCreep.map(issue => `
                        <tr>
                            <td><a href="${escapeHtml(issue.jiraUrl)}" target="_blank" rel="noreferrer">${escapeHtml(issue.key)}</a></td>
                            <td>${escapeHtml(issue.summary)}</td>
                            <td>${issue.scopeChangedAt ? escapeHtml(formatDate(new Date(issue.scopeChangedAt))) : '—'}</td>
                            <td>${renderStatusCell(issue, statusOptions)}</td>
                            <td>${escapeHtml(issue.scopeDeltaLabel)}</td>
                            <td class="scr-origin-col">${renderOriginBadge(issue.origin)}</td>
                            <td class="scr-edit-only">
                                <button class="scr-row-btn" data-scr-action="exclude" data-section="scope" data-issue-key="${escapeHtml(issue.key)}">Remove</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderStatusCell(issue, statusOptions = []) {
    const options = Array.from(new Set([issue.currentStatus, ...statusOptions].filter(Boolean)))
        .sort((left, right) => left.localeCompare(right));

    return `
        <select class="scr-select scr-status-select scr-edit-only" data-issue-key="${escapeHtml(issue.key)}">
            ${options.map(option => `<option value="${escapeHtml(option)}" ${option === issue.currentStatus ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
        <div class="scr-status-read">${escapeHtml(issue.currentStatus || '—')}</div>
    `;
}

function renderHiddenSection(section, issues) {
    if (!issues.length) return '';

    return `
        <div class="scr-hidden-block scr-edit-only">
            <div class="scr-hidden-title">Removed from report</div>
            <div class="scr-hidden-list">
                ${issues.map(issue => `
                    <div class="scr-hidden-item">
                        <span>${escapeHtml(issue.key)} · ${escapeHtml(issue.summary)}</span>
                        <button class="scr-row-btn is-secondary" data-scr-action="restore" data-section="${escapeHtml(section)}" data-issue-key="${escapeHtml(issue.key)}">Restore</button>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function setSectionOverride(section, issueKey, mode) {
    const map = section === 'carryover'
        ? closureState.reportState.carryoverOverridesByIssue
        : closureState.reportState.scopeCreepOverridesByIssue;
    map[issueKey] = mode;
    closureState.reportState.updatedAt = Date.now();
    rebuildClosureModel();
    renderClosureContent();
    scheduleStateSave();
}

function restoreSectionIssue(section, issueKey) {
    const map = section === 'carryover'
        ? closureState.reportState.carryoverOverridesByIssue
        : closureState.reportState.scopeCreepOverridesByIssue;
    const modelIssue = closureState.model?.issueMap?.[issueKey];
    const isAuto = section === 'carryover' ? modelIssue?.autoCarryover : modelIssue?.autoScopeCreep;

    if (isAuto) {
        delete map[issueKey];
    } else {
        map[issueKey] = 'included';
    }

    closureState.reportState.updatedAt = Date.now();
    rebuildClosureModel();
    renderClosureContent();
    scheduleStateSave();
}

function scheduleStateSave() {
    clearTimeout(closureState.saveTimer);
    closureState.saveTimer = setTimeout(() => {
        void persistCurrentState();
    }, 250);
}

async function persistCurrentState() {
    if (!closureState.projectKey || !closureState.selectedSprintId) return;
    const storageKey = getSprintClosureStorageKey(closureState.host, closureState.projectKey, closureState.selectedSprintId);
    closureState.reportState.updatedAt = Date.now();
    await writeClosurePersistedState(storageKey, normalizeSprintClosureState(closureState.reportState));
}

function syncCaptureModeUi() {
    const root = document.querySelector('.scr-shell');
    if (root) {
        root.classList.toggle('is-capture', closureState.captureMode);
    }

    const primaryModeBtn = document.getElementById('scr-mode-btn');
    if (primaryModeBtn) {
        primaryModeBtn.textContent = closureState.captureMode ? '✏️ Edit' : '📸 Capture';
    }

    const inlineModeBtn = document.getElementById('scr-mode-btn-inline');
    if (inlineModeBtn) {
        inlineModeBtn.textContent = closureState.captureMode ? '✏️ Edit Mode' : '📸 Capture Mode';
    }
}

function syncObservationUi() {
    const textareas = Array.from(document.querySelectorAll('.scr-observation-input'));
    const missing = textareas.filter(node => !String(node.value || '').trim()).length;
    const pill = document.getElementById('scr-missing-pill');

    if (pill) {
        pill.textContent = missing ? `${missing} observation${missing === 1 ? '' : 's'} missing` : 'Observations complete';
        pill.classList.toggle('is-warning', missing > 0);
    }

    if (closureState.model) {
        closureState.model.missingObservationCount = missing;
    }
}

function renderSprintOptions() {
    const select = document.getElementById('scr-sprint-select');
    if (!select) return;

    if (!closureState.closedSprints.length) {
        select.innerHTML = '<option value="">Select closed sprint...</option>';
        select.disabled = true;
        return;
    }

    select.disabled = false;
    select.innerHTML = closureState.closedSprints.map(sprint => {
        const closedOn = sprint.completeDate || sprint.endDate ? ` · ${formatDate(new Date(sprint.completeDate || sprint.endDate))}` : '';
        return `<option value="${sprint.id}">${escapeHtml(sprint.name)}${escapeHtml(closedOn)}</option>`;
    }).join('');
}

function showClosureState(state, message = '') {
    const placeholder = document.getElementById('scr-placeholder');
    const loading = document.getElementById('scr-loading');
    const error = document.getElementById('scr-error');
    const content = document.getElementById('scr-content');

    placeholder?.classList.add('hidden');
    loading?.classList.add('hidden');
    error?.classList.add('hidden');
    content?.classList.add('hidden');

    if (state === 'placeholder') {
        placeholder?.classList.remove('hidden');
    } else if (state === 'loading') {
        loading?.classList.remove('hidden');
        const text = document.getElementById('scr-loading-text');
        if (text && message) text.textContent = message;
    } else if (state === 'error' || state === 'empty') {
        error?.classList.remove('hidden');
        const text = document.getElementById('scr-error-text');
        if (text) text.textContent = message || 'An error occurred.';
    } else if (state === 'content') {
        content?.classList.remove('hidden');
    }
}

function renderInlineNotice(message) {
    const target = document.getElementById('scr-inline-notice');
    if (!target) return;
    target.textContent = message;
    target.classList.remove('hidden');
    clearTimeout(target._timer);
    target._timer = setTimeout(() => target.classList.add('hidden'), 2200);
}

function findNextSprint(allSprints, sprint) {
    if (!sprint) return null;
    const targetValue = getSprintSortValue(sprint);
    return allSprints
        .filter(candidate => candidate.id !== sprint.id)
        .find(candidate => getSprintSortValue(candidate) > targetValue) || null;
}

function getSprintSortValue(sprint) {
    const dateValue = sprint?.startDate || sprint?.endDate || sprint?.completeDate;
    const time = dateValue ? new Date(dateValue).getTime() : 0;
    if (!Number.isNaN(time) && time > 0) return time;
    return Number(sprint?.id || 0);
}

function compareSprintsAsc(left, right) {
    return getSprintSortValue(left) - getSprintSortValue(right);
}

function compareSprintsDesc(left, right) {
    return compareSprintsAsc(right, left);
}

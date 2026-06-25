import {
    fetchBoardId,
    fetchBoardSprints,
    fetchIssueChangelog,
    fetchProjectAnalysisIssues,
    fetchProjectSprintIssues,
    fetchProjectSprints,
    fetchSpFieldId,
    fetchSprintFieldId,
    fetchSprintIssues,
} from '../jiraApi.js';
import { downloadFile } from '../csvExporter/csvExporter.js';
import { escapeHtml } from '../utils.js';
import {
    buildQaCompletionCSV,
    buildQaCompletionReportModel,
} from './qaCompletionModel.js';

const qaState = {
    allProjects: [],
    host: '',
    selectedProjectKey: '',
    loadRequestId: 0,
    model: null,
    boardId: null,
    sprintFieldId: null,
    sprintOptions: [],
};

function getEls() {
    return {
        projectSearch: document.getElementById('qa-project-search'),
        projectDropdown: document.getElementById('qa-project-dropdown'),
        comboWrapper: document.getElementById('qa-combo-wrapper'),
        scopeSelect: document.getElementById('qa-scope-select'),
        sprintSelect: document.getElementById('qa-sprint-select'),
        analyzeBtn: document.getElementById('qa-analyze-btn'),
        exportBtn: document.getElementById('qa-export-btn'),
        placeholder: document.getElementById('qa-placeholder'),
        loading: document.getElementById('qa-loading'),
        loadingText: document.getElementById('qa-loading-text'),
        error: document.getElementById('qa-error'),
        errorText: document.getElementById('qa-error-text'),
        content: document.getElementById('qa-content'),
        status: document.getElementById('qa-status'),
        kpis: document.getElementById('qa-kpis'),
        contributors: document.getElementById('qa-contributors'),
        creators: document.getElementById('qa-creators'),
        reporters: document.getElementById('qa-reporters'),
        details: document.getElementById('qa-details'),
    };
}

function setStatus(kind, message) {
    const { status } = getEls();
    if (!status) return;
    if (!message) {
        status.className = 'qa-status hidden';
        status.textContent = '';
        return;
    }
    status.textContent = message;
    status.className = `qa-status qa-status-${kind}`;
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

function formatNumber(value) {
    const numeric = Number(value || 0);
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getSprintSortValue(sprint) {
    return new Date(sprint?.startDate || sprint?.endDate || 0).getTime() || 0;
}

function getSelectedSprintIds() {
    const { sprintSelect } = getEls();
    if (!sprintSelect) return [];
    return Array.from(sprintSelect.selectedOptions || [])
        .map(option => Number(option.value))
        .filter(value => Number.isFinite(value));
}

function renderSprintOptions() {
    const { sprintSelect, scopeSelect } = getEls();
    if (!sprintSelect) return;

    sprintSelect.innerHTML = qaState.sprintOptions.map(sprint => `
        <option value="${sprint.id}">${escapeHtml(sprint.name)} (${escapeHtml(sprint.state || 'unknown')})</option>
    `).join('');

    const useSpecificSprints = scopeSelect?.value === 'sprints';
    sprintSelect.disabled = !useSpecificSprints || qaState.sprintOptions.length === 0;
}

function syncSprintScopeUi() {
    const { sprintSelect, scopeSelect } = getEls();
    if (!sprintSelect || !scopeSelect) return;
    const useSpecificSprints = scopeSelect.value === 'sprints';
    sprintSelect.disabled = !useSpecificSprints || qaState.sprintOptions.length === 0;
}

async function loadSprintsForProject(projectKey, requestId = qaState.loadRequestId) {
    qaState.sprintOptions = [];
    qaState.boardId = null;
    qaState.sprintFieldId = null;
    renderSprintOptions();

    if (!projectKey || !qaState.host) {
        syncSprintScopeUi();
        return;
    }

    setStatus('info', 'Loading project sprints...');
    try {
        qaState.boardId = await fetchBoardId(qaState.host, projectKey);
        if (requestId !== qaState.loadRequestId) return;

        if (qaState.boardId) {
            qaState.sprintOptions = await fetchBoardSprints(qaState.host, qaState.boardId, ['active', 'future', 'closed']);
        } else {
            qaState.sprintFieldId = await fetchSprintFieldId(qaState.host);
            if (requestId !== qaState.loadRequestId) return;
            qaState.sprintOptions = await fetchProjectSprints(qaState.host, projectKey, qaState.sprintFieldId, ['active', 'future', 'closed']);
        }

        if (requestId !== qaState.loadRequestId) return;
        qaState.sprintOptions = [...qaState.sprintOptions]
            .sort((left, right) => getSprintSortValue(right) - getSprintSortValue(left) || String(right.name || '').localeCompare(String(left.name || '')));
        renderSprintOptions();
        setStatus(qaState.sprintOptions.length ? 'success' : 'info',
            qaState.sprintOptions.length
                ? `Loaded ${qaState.sprintOptions.length} sprints. Use Scope to analyze all history or selected sprints.`
                : 'No sprints found. You can still analyze all project history.');
    } catch (error) {
        if (requestId !== qaState.loadRequestId) return;
        qaState.sprintOptions = [];
        renderSprintOptions();
        setStatus('error', error.message || 'Could not load project sprints.');
    }
}

function renderKpis(summary = {}) {
    const { kpis } = getEls();
    if (!kpis) return;
    const items = [
        { label: 'QA Completed Tickets', value: summary.totalTickets || 0, sub: 'latest qualifying transitions' },
        { label: 'QA Completed SP', value: formatNumber(summary.totalStoryPoints), sub: 'SP at completion time' },
        { label: 'QA Contributors', value: summary.contributorCount || 0, sub: 'users who completed QA' },
        { label: 'Analyzed Issues', value: summary.analyzedIssues || 0, sub: `${summary.skippedIssues || 0} skipped by changelog errors` },
    ];

    kpis.innerHTML = items.map(item => `
        <div class="qa-kpi-card">
            <span class="qa-kpi-label">${escapeHtml(item.label)}</span>
            <span class="qa-kpi-value">${escapeHtml(item.value)}</span>
            <span class="qa-kpi-sub">${escapeHtml(item.sub)}</span>
        </div>
    `).join('');
}

async function fetchIssuesForSelectedScope(spFieldId, requestId) {
    const { scopeSelect } = getEls();
    const useSpecificSprints = scopeSelect?.value === 'sprints';

    if (!useSpecificSprints) {
        showState('loading', 'Fetching project issues...');
        return fetchProjectAnalysisIssues(qaState.host, qaState.selectedProjectKey, spFieldId);
    }

    if (qaState.sprintOptions.length === 0) {
        await loadSprintsForProject(qaState.selectedProjectKey, requestId);
        if (requestId !== qaState.loadRequestId) return [];
    }

    const selectedSprintIds = getSelectedSprintIds();
    if (!selectedSprintIds.length) {
        throw new Error('Select at least one sprint, or switch Scope back to All project history.');
    }

    const issuesByKey = new Map();
    for (let index = 0; index < selectedSprintIds.length; index += 1) {
        const sprintId = selectedSprintIds[index];
        const sprint = qaState.sprintOptions.find(item => Number(item.id) === sprintId);
        showState('loading', `Fetching sprint issues: ${index + 1} / ${selectedSprintIds.length}...`);
        const issues = qaState.boardId
            ? await fetchSprintIssues(qaState.host, sprintId, spFieldId, ['creator', 'reporter']).catch(() => [])
            : await fetchProjectSprintIssues(qaState.host, qaState.selectedProjectKey, sprintId, spFieldId, ['creator', 'reporter']).catch(() => []);
        if (requestId !== qaState.loadRequestId) return [];
        issues.forEach(issue => {
            if (issue?.key) {
                issuesByKey.set(issue.key, {
                    ...issue,
                    _qaSprintScope: sprint ? { id: sprint.id, name: sprint.name, state: sprint.state } : null,
                });
            }
        });
    }

    return Array.from(issuesByKey.values());
}

function renderContributors(contributors = []) {
    const { contributors: container } = getEls();
    if (!container) return;
    if (!contributors.length) {
        container.innerHTML = '<div class="qa-empty-row">No Ready for QA to QA Completed transitions were found.</div>';
        return;
    }

    container.innerHTML = `
        <div class="qa-table-wrap">
            <table class="qa-table">
                <thead>
                    <tr>
                        <th>QA</th>
                        <th>Tickets</th>
                        <th>Tickets %</th>
                        <th>Story Points</th>
                        <th>SP %</th>
                        <th>Last Completion</th>
                    </tr>
                </thead>
                <tbody>
                    ${contributors.map(row => `
                        <tr>
                            <td>
                                <strong>${escapeHtml(row.qaName)}</strong>
                                <span class="qa-muted">${escapeHtml(row.qaAccountId || row.qaKey)}</span>
                            </td>
                            <td>${row.ticketCount}</td>
                            <td>${formatNumber(row.ticketPercent)}%</td>
                            <td>${formatNumber(row.storyPoints)}</td>
                            <td>${formatNumber(row.storyPointPercent)}%</td>
                            <td>${escapeHtml(formatDateTime(row.lastCompletedAt))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderPersonDistribution(container, rows = [], emptyMessage = 'No data found.') {
    if (!container) return;
    if (!rows.length) {
        container.innerHTML = `<div class="qa-empty-row">${escapeHtml(emptyMessage)}</div>`;
        return;
    }

    container.innerHTML = `
        <div class="qa-table-wrap">
            <table class="qa-table">
                <thead>
                    <tr>
                        <th>Person</th>
                        <th>Tickets</th>
                        <th>Tickets %</th>
                        <th>Story Points</th>
                        <th>SP %</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => `
                        <tr>
                            <td>
                                <strong>${escapeHtml(row.name)}</strong>
                                <span class="qa-muted">${escapeHtml(row.accountId || row.key)}</span>
                            </td>
                            <td>${row.ticketCount}</td>
                            <td>${formatNumber(row.ticketPercent)}%</td>
                            <td>${formatNumber(row.storyPoints)}</td>
                            <td>${formatNumber(row.storyPointPercent)}%</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderIssueMetrics(model = {}) {
    const { creators, reporters } = getEls();
    renderPersonDistribution(creators, model.creators || [], 'No creator data found.');
    renderPersonDistribution(reporters, model.reporters || [], 'No reporter data found.');
}

function renderDetails(details = []) {
    const { details: container } = getEls();
    if (!container) return;
    if (!details.length) {
        container.innerHTML = '<div class="qa-empty-row">No detail rows to show.</div>';
        return;
    }

    container.innerHTML = `
        <div class="qa-table-wrap">
            <table class="qa-table qa-detail-table">
                <thead>
                    <tr>
                        <th>Ticket</th>
                        <th>Summary</th>
                        <th>QA</th>
                        <th>Completed At</th>
                        <th>SP</th>
                        <th>Current Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${details.map(row => `
                        <tr>
                            <td>
                                ${row.ticketUrl
                                    ? `<a href="${escapeHtml(row.ticketUrl)}" target="_blank" rel="noreferrer">${escapeHtml(row.ticketKey)}</a>`
                                    : escapeHtml(row.ticketKey)}
                            </td>
                            <td>${escapeHtml(row.summary)}</td>
                            <td>${escapeHtml(row.qaName)}</td>
                            <td>${escapeHtml(formatDateTime(row.completedAt))}</td>
                            <td>${formatNumber(row.storyPoints)}</td>
                            <td>${escapeHtml(row.currentStatus)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderModel(model) {
    renderKpis(model.summary);
    renderContributors(model.contributors);
    renderIssueMetrics(model);
    renderDetails(model.details);
    showState('content');
}

async function runQaAnalysis() {
    const { analyzeBtn, exportBtn } = getEls();
    if (!qaState.host || !qaState.selectedProjectKey) {
        setStatus('error', 'Select a project before running the analysis.');
        return;
    }

    const requestId = ++qaState.loadRequestId;
    qaState.model = null;
    if (analyzeBtn) analyzeBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
    setStatus('', '');
    showState('loading', 'Resolving Story Points field...');

    try {
        const spFieldId = await fetchSpFieldId(qaState.host);
        if (requestId !== qaState.loadRequestId) return;

        const issues = await fetchIssuesForSelectedScope(spFieldId, requestId);
        if (requestId !== qaState.loadRequestId) return;

        issues.forEach(issue => {
            issue._sp = spFieldId ? Number(issue.fields?.[spFieldId] || 0) : 0;
        });

        if (!issues.length) {
            qaState.model = buildQaCompletionReportModel({
                projectKey: qaState.selectedProjectKey,
                host: qaState.host,
                issueResults: [],
                spFieldId,
            });
            renderModel(qaState.model);
            setStatus('success', 'Analysis completed. No issues were returned by Jira for the selected scope.');
            if (exportBtn) exportBtn.disabled = false;
            return;
        }

        const issueResults = [];
        const concurrency = 4;
        for (let index = 0; index < issues.length; index += concurrency) {
            const batch = issues.slice(index, index + concurrency);
            const results = await Promise.all(batch.map(async issue => {
                try {
                    return {
                        issue,
                        changelog: await fetchIssueChangelog(qaState.host, issue.key),
                    };
                } catch (error) {
                    return {
                        issue,
                        changelog: [],
                        error,
                    };
                }
            }));
            if (requestId !== qaState.loadRequestId) return;
            issueResults.push(...results);
            showState('loading', `Loading changelogs: ${Math.min(index + concurrency, issues.length)} / ${issues.length}...`);
        }

        qaState.model = buildQaCompletionReportModel({
            projectKey: qaState.selectedProjectKey,
            host: qaState.host,
            issueResults,
            spFieldId,
        });
        renderModel(qaState.model);
        setStatus('success', `Analysis completed: ${qaState.model.summary.totalTickets} QA-completed tickets found.`);
        if (exportBtn) exportBtn.disabled = false;
    } catch (error) {
        if (requestId !== qaState.loadRequestId) return;
        console.error('PMsToolKit QA Completion Report:', error);
        showState('error', error.message || 'Unexpected error running QA analysis.');
        setStatus('error', error.message || 'Unexpected error running QA analysis.');
    } finally {
        if (requestId === qaState.loadRequestId && analyzeBtn) analyzeBtn.disabled = false;
    }
}

function exportQaCsv() {
    if (!qaState.model) {
        setStatus('error', 'Run a successful analysis before exporting.');
        return;
    }
    const csv = buildQaCompletionCSV(qaState.model);
    const dateStr = new Date().toISOString().slice(0, 10);
    const projectKey = String(qaState.selectedProjectKey || 'project').toLowerCase();
    downloadFile(csv, `${projectKey}_qa_completion_report_${dateStr}.csv`, 'text/csv;charset=utf-8;');
    setStatus('success', `Exported ${qaState.model.details.length} QA completion detail rows.`);
}

export function initQaCompletionReport(allProjects = [], currentHost = '', initialProjectKey = '') {
    qaState.allProjects = Array.isArray(allProjects) ? allProjects : [];
    qaState.host = currentHost || '';
    qaState.selectedProjectKey = initialProjectKey || '';
    qaState.model = null;
    qaState.boardId = null;
    qaState.sprintFieldId = null;
    qaState.sprintOptions = [];

    const { projectSearch, projectDropdown, comboWrapper, scopeSelect, sprintSelect, analyzeBtn, exportBtn } = getEls();
    if (!projectSearch || !projectDropdown || !comboWrapper || !scopeSelect || !sprintSelect || !analyzeBtn || !exportBtn) return;

    function renderProjectOptions(filterText = '') {
        const term = String(filterText || '').toLowerCase();
        const filtered = qaState.allProjects.filter(project =>
            !term
            || project.name.toLowerCase().includes(term)
            || project.key.toLowerCase().includes(term)
        );
        if (!filtered.length) {
            projectDropdown.innerHTML = '<div class="combo-msg">No projects found</div>';
            return;
        }
        projectDropdown.innerHTML = filtered.map(project => `
            <div class="combo-option ${project.key === qaState.selectedProjectKey ? 'selected' : ''}" data-key="${escapeHtml(project.key)}" data-name="${escapeHtml(project.name)}">
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
        const requestId = ++qaState.loadRequestId;
        qaState.selectedProjectKey = String(option.dataset.key || '').trim();
        qaState.model = null;
        projectSearch.value = `${option.dataset.name} (${option.dataset.key})`;
        projectDropdown.classList.add('hidden');
        exportBtn.disabled = true;
        setStatus('', '');
        showState('placeholder');
        void loadSprintsForProject(qaState.selectedProjectKey, requestId);
    });

    document.addEventListener('click', event => {
        if (!comboWrapper.contains(event.target)) {
            projectDropdown.classList.add('hidden');
            if (qaState.selectedProjectKey) {
                const project = qaState.allProjects.find(item => item.key === qaState.selectedProjectKey);
                if (project) projectSearch.value = `${project.name} (${project.key})`;
            } else {
                projectSearch.value = '';
            }
        }
    });

    analyzeBtn.addEventListener('click', () => {
        void runQaAnalysis();
    });

    scopeSelect.addEventListener('change', () => {
        syncSprintScopeUi();
        qaState.model = null;
        exportBtn.disabled = true;
        showState('placeholder');
        setStatus('', '');
        if (scopeSelect.value === 'sprints' && qaState.selectedProjectKey && qaState.sprintOptions.length === 0) {
            void loadSprintsForProject(qaState.selectedProjectKey);
        }
    });

    sprintSelect.addEventListener('change', () => {
        qaState.model = null;
        exportBtn.disabled = true;
        showState('placeholder');
        setStatus('', '');
    });

    exportBtn.addEventListener('click', () => {
        exportQaCsv();
    });

    if (qaState.allProjects.length > 0) {
        projectSearch.placeholder = 'Search project...';
    }

    if (initialProjectKey) {
        const project = qaState.allProjects.find(item => item.key === initialProjectKey);
        if (project) {
            projectSearch.value = `${project.name} (${project.key})`;
            void loadSprintsForProject(initialProjectKey);
        }
    }

    syncSprintScopeUi();
}

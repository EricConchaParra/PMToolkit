/**
 * PMsToolKit - Analytics Hub
 * Jira Snapshots - reconstructs a project issue snapshot at a selected date.
 */

import {
    fetchIssueChangelog,
    fetchSpFieldResolution,
    fetchSprintFieldId,
    fetchStoryPointsFieldCandidates,
    getJiraHost,
} from '../jiraApi.js';
import { downloadFile, escapeCSV } from '../csvExporter/csvExporter.js';
import {
    SNAPSHOT_HEADERS,
    buildSnapshotRow,
    fetchAllJiraFields,
    fetchEpicSummaries,
    getCanonicalHistoryField,
    getChangeValue,
    getLocalDateSlug,
    getSnapshotFields,
    resolveBacklogAnalyzerFields,
    searchIssues,
    unique,
} from '../backlogAnalyzer/backlogAnalyzer.js';

const JIRA_SNAPSHOT_HEADERS = ['snapshot_date', ...SNAPSHOT_HEADERS];

const jiraSnapshotsState = {
    allProjects: [],
    host: '',
    selectedProjectKey: '',
};

function getEls() {
    return {
        projectSelect: document.getElementById('jsnap-project-select'),
        dateInput: document.getElementById('jsnap-date-input'),
        exportBtn: document.getElementById('jsnap-export-btn'),
        status: document.getElementById('jsnap-status'),
        fieldsHint: document.getElementById('jsnap-fields-hint'),
        progress: document.getElementById('jsnap-progress'),
        progressBar: document.getElementById('jsnap-progress-bar'),
        progressText: document.getElementById('jsnap-progress-text'),
        progressPct: document.getElementById('jsnap-progress-pct'),
    };
}

function setStatus(kind, message) {
    const { status } = getEls();
    if (!status) return;
    if (!message) {
        status.className = 'sbe-status hidden';
        status.textContent = '';
        return;
    }
    status.textContent = message;
    status.className = `sbe-status sbe-status-${kind}`;
}

function showProgress(text, pct) {
    const { progress, progressBar, progressText, progressPct } = getEls();
    if (!progress || !progressBar || !progressText || !progressPct) return;
    progress.classList.remove('hidden');
    progressText.textContent = text;
    progressPct.textContent = `${Math.round(pct)}%`;
    progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function hideProgress() {
    getEls().progress?.classList.add('hidden');
}

function escapeJqlString(value = '') {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getEndOfLocalDay(dateString = '') {
    const [year, month, day] = String(dateString || '').split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const date = new Date(year, month - 1, day, 23, 59, 59, 999);
    return Number.isFinite(date.getTime()) ? date : null;
}

function getJqlDateTime(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function toMs(value) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : NaN;
}

function getProjectSnapshotJql(projectKey, snapshotDate) {
    return [
        `project = "${escapeJqlString(projectKey)}"`,
        `created <= "${getJqlDateTime(snapshotDate)}"`,
        'ORDER BY key ASC',
    ].join(' AND ').replace(' AND ORDER BY', ' ORDER BY');
}

function renderProjectOptions(lastProject = '') {
    const { projectSelect } = getEls();
    if (!projectSelect) return;

    const options = jiraSnapshotsState.allProjects
        .map(project => `
            <option value="${project.key}" ${project.key === lastProject ? 'selected' : ''}>${project.name} (${project.key})</option>
        `)
        .join('');

    projectSelect.innerHTML = `<option value="">Select project...</option>${options}`;
}

function syncExportState() {
    const { exportBtn, projectSelect, dateInput } = getEls();
    if (!exportBtn) return;
    exportBtn.disabled = !String(projectSelect?.value || '').trim() || !String(dateInput?.value || '').trim();
}

function getCurrentFieldHint(resolvedFields = {}) {
    const storyPointNames = (resolvedFields.storyPointFieldIds || []).map(id => resolvedFields.fieldNameById.get(id) || id);
    const estimateNames = (resolvedFields.storyPointEstimateFieldIds || []).map(id => resolvedFields.fieldNameById.get(id) || id);
    const acceptanceNames = (resolvedFields.acceptanceCriteriaFieldIds || []).map(id => resolvedFields.fieldNameById.get(id) || id);

    return [
        storyPointNames.length ? `Story Points: ${storyPointNames.join(', ')}` : 'Story Points: not detected',
        estimateNames.length ? `Story Point Estimate: ${estimateNames.join(', ')}` : 'Story Point Estimate: not detected',
        acceptanceNames.length ? `Acceptance Criteria: ${acceptanceNames.join(', ')}` : 'Acceptance Criteria: not detected',
    ].join(' · ');
}

async function resolveFields(host) {
    const fields = await fetchAllJiraFields(host);
    const storyPointsResolution = await fetchSpFieldResolution(host);
    const storyPointCandidates = await fetchStoryPointsFieldCandidates(host);
    const sprintFieldId = await fetchSprintFieldId(host);

    return resolveBacklogAnalyzerFields(fields, {
        storyPointsResolution,
        storyPointCandidates,
        sprintFieldId,
    });
}

async function updateFieldHint(host) {
    const { fieldsHint } = getEls();
    if (!fieldsHint || !host) return;

    try {
        fieldsHint.textContent = getCurrentFieldHint(await resolveFields(host));
    } catch {
        fieldsHint.textContent = 'Field metadata could not be loaded yet. Export will still use Jira defaults where available.';
    }
}

function setAsOfRowValue(row, item, canonicalField) {
    const previousValue = getChangeValue(item, 'from');
    const rawField = String(item.field || '').trim().toLowerCase();

    if (canonicalField === 'status') {
        row.status = previousValue;
        return;
    }
    if (canonicalField === 'resolution') {
        row.resolution = previousValue;
        if (!previousValue) row.resolved = '';
        return;
    }
    if (canonicalField === 'story_points') {
        row.story_points = previousValue;
        return;
    }
    if (canonicalField === 'story_point_estimate') {
        row.story_point_estimate = previousValue;
        return;
    }
    if (canonicalField === 'sprint') {
        row.sprint_current = previousValue;
        return;
    }
    if (canonicalField === 'parent') {
        row.parent_key = previousValue;
        row.parent_summary = '';
        return;
    }
    if (canonicalField === 'issue_type') {
        row.issue_type = previousValue;
        return;
    }
    if (canonicalField === 'acceptance_criteria') {
        row.acceptance_criteria = previousValue;
        return;
    }
    if (canonicalField === 'description') {
        row.description = previousValue;
        return;
    }
    if (canonicalField === 'summary') {
        row.summary = previousValue;
        return;
    }
    if (canonicalField === 'epic') {
        if (rawField.includes('name')) {
            row.epic_name = previousValue;
        } else {
            row.epic_key = previousValue;
            row.epic_name = '';
        }
    }
}

export function reconstructSnapshotRowAsOf({
    issue = {},
    changelog = [],
    snapshotDate,
    host = '',
    resolvedFields = {},
    epicSummaries = new Map(),
} = {}) {
    const targetMs = toMs(snapshotDate);
    const row = buildSnapshotRow(issue, host, resolvedFields, epicSummaries);
    row.snapshot_date = getLocalDateSlug(snapshotDate);

    if (!Number.isFinite(targetMs)) return row;

    const histories = (Array.isArray(changelog) ? changelog : [])
        .slice()
        .sort((left, right) => toMs(right.created) - toMs(left.created));

    histories.forEach(history => {
        const historyMs = toMs(history?.created);
        if (!Number.isFinite(historyMs) || historyMs <= targetMs) return;

        (history.items || []).forEach(item => {
            const canonicalField = getCanonicalHistoryField(item, resolvedFields);
            if (!canonicalField) return;
            setAsOfRowValue(row, item, canonicalField);
        });
    });

    return row;
}

export function buildJiraSnapshotsCSV(issueSnapshots = [], {
    snapshotDate = new Date(),
    host = '',
    resolvedFields = {},
    epicSummaries = new Map(),
} = {}) {
    const rows = [JIRA_SNAPSHOT_HEADERS.map(escapeCSV).join(',')];

    issueSnapshots
        .slice()
        .sort((left, right) => String(left.issue?.key || '').localeCompare(String(right.issue?.key || '')))
        .forEach(issueSnapshot => {
            const row = reconstructSnapshotRowAsOf({
                ...issueSnapshot,
                snapshotDate,
                host,
                resolvedFields,
                epicSummaries,
            });
            rows.push(JIRA_SNAPSHOT_HEADERS.map(header => escapeCSV(row[header])).join(','));
        });

    return rows.join('\n');
}

async function fetchIssueSnapshots(host, issues = []) {
    const concurrency = 5;
    const snapshots = [];

    for (let index = 0; index < issues.length; index += concurrency) {
        const batch = issues.slice(index, index + concurrency);
        const batchResults = await Promise.all(batch.map(async issue => ({
            issue,
            changelog: await fetchIssueChangelog(host, issue.key),
        })));
        snapshots.push(...batchResults);
        showProgress(`Fetching changelogs: ${Math.min(index + concurrency, issues.length)} / ${issues.length}...`, 35 + ((Math.min(index + concurrency, issues.length) / issues.length) * 55));
    }

    return snapshots;
}

async function exportJiraSnapshot() {
    const { projectSelect, dateInput, exportBtn } = getEls();
    const projectKey = String(projectSelect?.value || '').trim();
    const dateValue = String(dateInput?.value || '').trim();
    const snapshotDate = getEndOfLocalDay(dateValue);

    if (!projectKey) {
        setStatus('error', 'Select a project.');
        return;
    }
    if (!snapshotDate) {
        setStatus('error', 'Select a valid snapshot date.');
        return;
    }

    const host = jiraSnapshotsState.host || await getJiraHost();
    if (!host) {
        setStatus('error', 'Could not detect Jira host. Open a Jira tab first.');
        return;
    }

    if (exportBtn) exportBtn.disabled = true;
    setStatus('', '');

    try {
        showProgress('Resolving Jira fields...', 5);
        const resolvedFields = await resolveFields(host);
        const fields = getSnapshotFields(resolvedFields);

        showProgress('Fetching issues that existed on the selected date...', 15);
        const issues = await searchIssues(host, getProjectSnapshotJql(projectKey, snapshotDate), fields);
        if (issues.length === 0) {
            hideProgress();
            setStatus('error', 'No issues found for that project and date.');
            return;
        }

        showProgress('Enriching epic names...', 30);
        const epicSummaries = await fetchEpicSummaries(host, issues, resolvedFields);
        const issueSnapshots = await fetchIssueSnapshots(host, issues);

        showProgress('Reconstructing snapshot CSV...', 96);
        const csv = buildJiraSnapshotsCSV(issueSnapshots, {
            snapshotDate,
            host,
            resolvedFields,
            epicSummaries,
        });
        const projectSlug = projectKey.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        downloadFile(csv, `jira_snapshot_${projectSlug}_as_of_${dateValue}.csv`, 'text/csv;charset=utf-8;');

        hideProgress();
        setStatus('success', `Exported ${issues.length} issues as of ${dateValue}.`);
    } catch (error) {
        hideProgress();
        setStatus('error', error.message || 'Unexpected error exporting Jira snapshot.');
    } finally {
        syncExportState();
    }
}

function setDefaultDate() {
    const { dateInput } = getEls();
    if (!dateInput || dateInput.value) return;
    dateInput.value = getLocalDateSlug();
}

export function initJiraSnapshots(allProjects = [], host = '', lastProject = '') {
    jiraSnapshotsState.allProjects = Array.isArray(allProjects) ? allProjects : [];
    jiraSnapshotsState.host = host || '';
    jiraSnapshotsState.selectedProjectKey = lastProject || '';

    const { projectSelect, dateInput, exportBtn } = getEls();
    if (!projectSelect || !dateInput || !exportBtn) return;

    renderProjectOptions(lastProject);
    setDefaultDate();
    syncExportState();
    void updateFieldHint(jiraSnapshotsState.host);

    projectSelect.addEventListener('change', event => {
        jiraSnapshotsState.selectedProjectKey = String(event.target.value || '').trim();
        syncExportState();
        setStatus('', '');
    });

    dateInput.addEventListener('change', () => {
        syncExportState();
        setStatus('', '');
    });

    exportBtn.addEventListener('click', () => {
        void exportJiraSnapshot();
    });
}

export function getJiraSnapshotHeaders() {
    return [...JIRA_SNAPSHOT_HEADERS];
}

export function getJiraSnapshotJql(projectKey, dateString) {
    const snapshotDate = getEndOfLocalDay(dateString);
    return snapshotDate ? getProjectSnapshotJql(projectKey, snapshotDate) : '';
}

export function getTrackedSnapshotFieldIds(resolvedFields = {}) {
    return unique(getSnapshotFields(resolvedFields));
}

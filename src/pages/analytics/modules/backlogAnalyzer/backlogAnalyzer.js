/**
 * PMsToolKit - Analytics Hub
 * Backlog Analyzer - exports current issue snapshot and field-change history as separate CSV files.
 */

import {
    fetchIssueChangelog,
    fetchSpFieldResolution,
    fetchSprintFieldId,
    fetchStoryPointsFieldCandidates,
    getJiraHost,
    jiraFetch,
} from '../jiraApi.js';
import { downloadFile, escapeCSV } from '../csvExporter/csvExporter.js';

export const SNAPSHOT_HEADERS = [
    'issue_key',
    'summary',
    'issue_type',
    'status',
    'resolution',
    'created',
    'updated',
    'resolved',
    'epic_key',
    'epic_name',
    'parent_key',
    'parent_summary',
    'story_points',
    'story_point_estimate',
    'sprint_current',
    'labels',
    'components',
    'fix_versions',
    'priority',
    'assignee',
    'reporter',
    'acceptance_criteria',
    'description',
    'issue_url',
];

const HISTORY_HEADERS = [
    'issue_key',
    'changed_at',
    'changed_by',
    'field',
    'from_value',
    'to_value',
];

const FIXED_EPIC_LINK_FIELD_IDS = ['customfield_10014'];
const FIXED_EPIC_NAME_FIELD_IDS = ['customfield_10011'];

const backlogAnalyzerState = {
    allProjects: [],
    host: '',
    lastProject: '',
};

function getEls() {
    return {
        jqlInput: document.getElementById('ba-jql-input'),
        exportBtn: document.getElementById('ba-export-btn'),
        progress: document.getElementById('ba-progress'),
        progressBar: document.getElementById('ba-progress-bar'),
        progressText: document.getElementById('ba-progress-text'),
        progressPct: document.getElementById('ba-progress-pct'),
        success: document.getElementById('ba-success'),
        successText: document.getElementById('ba-success-text'),
        error: document.getElementById('ba-error'),
        errorText: document.getElementById('ba-error-text'),
        fieldsHint: document.getElementById('ba-fields-hint'),
    };
}

function showProgress(text, pct) {
    const { progress, progressBar, progressText, progressPct, success, error } = getEls();
    if (!progress || !progressBar || !progressText || !progressPct) return;
    progress.classList.remove('hidden');
    progressText.textContent = text;
    progressPct.textContent = `${Math.round(pct)}%`;
    progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    success?.classList.add('hidden');
    error?.classList.add('hidden');
}

function showSuccess(message) {
    const { progress, success, successText, error } = getEls();
    progress?.classList.add('hidden');
    if (successText) successText.textContent = message;
    success?.classList.remove('hidden');
    error?.classList.add('hidden');
}

function showError(message) {
    const { progress, success, error, errorText } = getEls();
    progress?.classList.add('hidden');
    if (errorText) errorText.textContent = message;
    error?.classList.remove('hidden');
    success?.classList.add('hidden');
}

export function normalizeFieldLabel(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function unique(values = []) {
    return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}

function fieldNameById(fields = []) {
    const byId = new Map();
    fields.forEach(field => {
        const id = String(field?.id || '').trim();
        if (id) byId.set(id, String(field?.name || '').trim());
    });
    return byId;
}

function findFieldIds(fields = [], predicate) {
    return fields
        .filter(field => predicate(normalizeFieldLabel(field?.name), field))
        .map(field => String(field?.id || '').trim())
        .filter(Boolean);
}

export function resolveBacklogAnalyzerFields(fields = [], {
    storyPointsResolution = {},
    storyPointCandidates = [],
    sprintFieldId = '',
} = {}) {
    const exactStoryPoints = findFieldIds(fields, name => name === 'story points' || name === 'story points estimated');
    const exactStoryPointEstimate = findFieldIds(fields, name => name === 'story point estimate' || name === 'story points estimate');
    const acceptanceCriteriaFieldIds = findFieldIds(fields, name => name.includes('acceptance criteria'));
    const epicLinkFieldIds = unique([
        ...findFieldIds(fields, name => name === 'epic link' || name === 'epic'),
        ...FIXED_EPIC_LINK_FIELD_IDS,
    ]);
    const epicNameFieldIds = unique([
        ...findFieldIds(fields, name => name === 'epic name'),
        ...FIXED_EPIC_NAME_FIELD_IDS,
    ]);

    const candidateIds = storyPointCandidates.map(field => field.id).filter(Boolean);
    const resolvedSpFieldId = String(storyPointsResolution?.fieldId || '').trim();
    const storyPointFieldIds = exactStoryPoints.length > 0
        ? exactStoryPoints
        : unique([
            ...(resolvedSpFieldId && !exactStoryPointEstimate.includes(resolvedSpFieldId) ? [resolvedSpFieldId] : []),
            ...candidateIds.filter(id => !exactStoryPointEstimate.includes(id)),
        ]);

    return {
        storyPointFieldIds: unique(storyPointFieldIds),
        storyPointEstimateFieldIds: unique(exactStoryPointEstimate),
        acceptanceCriteriaFieldIds: unique(acceptanceCriteriaFieldIds),
        sprintFieldId: String(sprintFieldId || '').trim(),
        epicLinkFieldIds,
        epicNameFieldIds,
        fieldNameById: fieldNameById(fields),
    };
}

function adfToPlainText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(adfToPlainText).filter(Boolean).join('\n');
    if (typeof node !== 'object') return String(node);
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return node.attrs?.text || node.attrs?.displayName || '';
    if (node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';

    const childText = (node.content || []).map(adfToPlainText).filter(Boolean).join(node.type === 'paragraph' ? '' : '\n');
    if (['paragraph', 'heading', 'blockquote', 'listItem'].includes(node.type)) return childText;
    return childText;
}

export function formatJiraValue(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(formatJiraValue).filter(Boolean).join(' | ');
    if (typeof value !== 'object') return String(value);

    const adfText = value.type === 'doc' ? adfToPlainText(value) : '';
    if (adfText) return adfText.replace(/\n{3,}/g, '\n\n').trim();

    if (value.displayName) return String(value.displayName);
    if (value.name) return String(value.name);
    if (value.value) return String(value.value);
    if (value.key) return String(value.key);
    if (value.id != null) return String(value.id);
    return JSON.stringify(value);
}

export function firstFieldValue(fields = {}, fieldIds = []) {
    for (const fieldId of fieldIds) {
        const value = fields[fieldId];
        if (value !== null && value !== undefined && value !== '') return formatJiraValue(value);
    }
    return '';
}

export function joinFieldValues(fields = {}, fieldIds = []) {
    return fieldIds
        .map(fieldId => fields[fieldId])
        .filter(value => value !== null && value !== undefined && value !== '')
        .map(formatJiraValue)
        .filter(Boolean)
        .join(' | ');
}

export function resolveIssueKeyFromFieldValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return value.key || value.id || '';
    return String(value);
}

export function resolveEpicKey(fields = {}, resolvedFields = {}) {
    for (const fieldId of resolvedFields.epicLinkFieldIds || []) {
        const key = resolveIssueKeyFromFieldValue(fields[fieldId]);
        if (key) return key;
    }
    return fields.parent?.key || '';
}

export function resolveEpicName(fields = {}, epicKey = '', epicSummaries = new Map(), resolvedFields = {}) {
    const customEpicName = firstFieldValue(fields, resolvedFields.epicNameFieldIds || []);
    if (customEpicName) return customEpicName;
    if (epicKey && epicSummaries.has(epicKey)) return epicSummaries.get(epicKey);
    if (fields.parent?.key === epicKey) return fields.parent?.fields?.summary || '';
    return '';
}

export function getLocalDateSlug(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export async function fetchAllJiraFields(host) {
    return jiraFetch(host, '/rest/api/3/field');
}

export async function searchIssues(host, jql, fields = []) {
    let all = [];
    let nextPageToken;

    while (true) {
        const body = {
            jql,
            fields,
            maxResults: 100,
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;

        const data = await jiraFetch(host, '/rest/api/3/search/jql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
            body: JSON.stringify(body),
        });

        const issues = data.issues || [];
        all = all.concat(issues);
        if (!data.nextPageToken || issues.length === 0) break;
        nextPageToken = data.nextPageToken;
    }

    return all;
}

export async function fetchEpicSummaries(host, issues = [], resolvedFields = {}) {
    const epicKeys = unique(issues.map(issue => resolveEpicKey(issue.fields || {}, resolvedFields)));
    const summaries = new Map();
    const batchSize = 50;

    for (let index = 0; index < epicKeys.length; index += batchSize) {
        const batch = epicKeys.slice(index, index + batchSize);
        const quotedKeys = batch.map(key => `"${String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
        if (!quotedKeys) continue;

        try {
            const epics = await searchIssues(host, `issuekey in (${quotedKeys})`, ['summary']);
            epics.forEach(epic => {
                if (epic.key) summaries.set(epic.key, epic.fields?.summary || '');
            });
        } catch {
            // Epic enrichment is best-effort; snapshot export still contains epic_key.
        }
    }

    return summaries;
}

export function buildSnapshotRow(issue = {}, host = '', resolvedFields = {}, epicSummaries = new Map()) {
    const fields = issue.fields || {};
    const epicKey = resolveEpicKey(fields, resolvedFields);

    return {
        issue_key: issue.key || '',
        summary: fields.summary || '',
        issue_type: fields.issuetype?.name || '',
        status: fields.status?.name || '',
        resolution: fields.resolution?.name || '',
        created: fields.created || '',
        updated: fields.updated || '',
        resolved: fields.resolutiondate || '',
        epic_key: epicKey,
        epic_name: resolveEpicName(fields, epicKey, epicSummaries, resolvedFields),
        parent_key: fields.parent?.key || '',
        parent_summary: fields.parent?.fields?.summary || '',
        story_points: joinFieldValues(fields, resolvedFields.storyPointFieldIds || []),
        story_point_estimate: joinFieldValues(fields, resolvedFields.storyPointEstimateFieldIds || []),
        sprint_current: resolvedFields.sprintFieldId ? formatJiraValue(fields[resolvedFields.sprintFieldId]) : '',
        labels: formatJiraValue(fields.labels || []),
        components: formatJiraValue(fields.components || []),
        fix_versions: formatJiraValue(fields.fixVersions || []),
        priority: fields.priority?.name || '',
        assignee: fields.assignee?.displayName || '',
        reporter: fields.reporter?.displayName || '',
        acceptance_criteria: joinFieldValues(fields, resolvedFields.acceptanceCriteriaFieldIds || []),
        description: formatJiraValue(fields.description),
        issue_url: issue.key && host ? `https://${host}/browse/${issue.key}` : '',
    };
}

export function buildBacklogSnapshotCSV(issues = [], {
    host = '',
    resolvedFields = {},
    epicSummaries = new Map(),
} = {}) {
    const rows = [SNAPSHOT_HEADERS.map(escapeCSV).join(',')];
    [...issues]
        .sort((left, right) => String(left.key || '').localeCompare(String(right.key || '')))
        .forEach(issue => {
            const row = buildSnapshotRow(issue, host, resolvedFields, epicSummaries);
            rows.push(SNAPSHOT_HEADERS.map(header => escapeCSV(row[header])).join(','));
        });
    return rows.join('\n');
}

function isHistoryField(item = {}, canonicalName, resolvedFields = {}) {
    const field = normalizeFieldLabel(item.field || '');
    const fieldId = String(item.fieldId || '').trim();

    if (canonicalName === 'story_points') {
        return (resolvedFields.storyPointFieldIds || []).includes(fieldId) || field === 'story points' || field === 'story points estimated';
    }
    if (canonicalName === 'story_point_estimate') {
        return (resolvedFields.storyPointEstimateFieldIds || []).includes(fieldId) || field === 'story point estimate' || field === 'story points estimate';
    }
    if (canonicalName === 'sprint') {
        return fieldId === resolvedFields.sprintFieldId || field === 'sprint';
    }
    if (canonicalName === 'epic') {
        return (resolvedFields.epicLinkFieldIds || []).includes(fieldId)
            || (resolvedFields.epicNameFieldIds || []).includes(fieldId)
            || field === 'epic link'
            || field === 'epic name'
            || field === 'epic';
    }
    if (canonicalName === 'acceptance_criteria') {
        return (resolvedFields.acceptanceCriteriaFieldIds || []).includes(fieldId) || field.includes('acceptance criteria');
    }
    if (canonicalName === 'issue_type') {
        return field === 'issue type' || field === 'issuetype';
    }
    return field === canonicalName;
}

export function getCanonicalHistoryField(item = {}, resolvedFields = {}) {
    const candidates = [
        'status',
        'resolution',
        'story_points',
        'story_point_estimate',
        'sprint',
        'epic',
        'parent',
        'issue_type',
        'acceptance_criteria',
        'description',
        'summary',
    ];
    return candidates.find(candidate => isHistoryField(item, candidate, resolvedFields)) || '';
}

export function getChangeValue(item = {}, key) {
    return item[`${key}String`] ?? item[key] ?? '';
}

function getChangedBy(history = {}) {
    return history.author?.displayName
        || history.author?.name
        || history.author?.emailAddress
        || history.author?.accountId
        || 'Unknown';
}

export function buildBacklogHistoryCSV(issueHistories = [], { resolvedFields = {} } = {}) {
    const rows = [HISTORY_HEADERS.map(escapeCSV).join(',')];
    [...issueHistories]
        .sort((left, right) => String(left.key || '').localeCompare(String(right.key || '')))
        .forEach(issue => {
            const histories = Array.isArray(issue.changelog) ? issue.changelog : [];
            histories
                .slice()
                .sort((left, right) => new Date(left.created || 0) - new Date(right.created || 0))
                .forEach(history => {
                    (history.items || []).forEach(item => {
                        const field = getCanonicalHistoryField(item, resolvedFields);
                        if (!field) return;
                        rows.push([
                            issue.key || '',
                            history.created || '',
                            getChangedBy(history),
                            field,
                            getChangeValue(item, 'from'),
                            getChangeValue(item, 'to'),
                        ].map(escapeCSV).join(','));
                    });
                });
        });
    return rows.join('\n');
}

export function getSnapshotFields(resolvedFields = {}) {
    return unique([
        'summary',
        'issuetype',
        'status',
        'resolution',
        'created',
        'updated',
        'resolutiondate',
        'parent',
        'labels',
        'components',
        'fixVersions',
        'priority',
        'assignee',
        'reporter',
        'description',
        ...FIXED_EPIC_LINK_FIELD_IDS,
        ...FIXED_EPIC_NAME_FIELD_IDS,
        ...(resolvedFields.storyPointFieldIds || []),
        ...(resolvedFields.storyPointEstimateFieldIds || []),
        ...(resolvedFields.acceptanceCriteriaFieldIds || []),
        resolvedFields.sprintFieldId,
        ...(resolvedFields.epicLinkFieldIds || []),
        ...(resolvedFields.epicNameFieldIds || []),
    ]);
}

async function fetchIssueHistories(host, issues = []) {
    const concurrency = 5;
    const results = [];

    for (let index = 0; index < issues.length; index += concurrency) {
        const batch = issues.slice(index, index + concurrency);
        const batchResults = await Promise.all(batch.map(async issue => ({
            key: issue.key,
            changelog: await fetchIssueChangelog(host, issue.key),
        })));
        results.push(...batchResults);
        showProgress(`Fetching changelogs: ${Math.min(index + concurrency, issues.length)} / ${issues.length}...`, 35 + ((Math.min(index + concurrency, issues.length) / issues.length) * 55));
    }

    return results;
}

async function updateFieldHint(host) {
    const { fieldsHint } = getEls();
    if (!fieldsHint || !host) return;

    try {
        const fields = await fetchAllJiraFields(host);
        const storyPointsResolution = await fetchSpFieldResolution(host);
        const storyPointCandidates = await fetchStoryPointsFieldCandidates(host);
        const sprintFieldId = await fetchSprintFieldId(host);
        const resolvedFields = resolveBacklogAnalyzerFields(fields, {
            storyPointsResolution,
            storyPointCandidates,
            sprintFieldId,
        });

        const storyPointNames = (resolvedFields.storyPointFieldIds || []).map(id => resolvedFields.fieldNameById.get(id) || id);
        const estimateNames = (resolvedFields.storyPointEstimateFieldIds || []).map(id => resolvedFields.fieldNameById.get(id) || id);
        const acceptanceNames = (resolvedFields.acceptanceCriteriaFieldIds || []).map(id => resolvedFields.fieldNameById.get(id) || id);

        fieldsHint.textContent = [
            storyPointNames.length ? `Story Points: ${storyPointNames.join(', ')}` : 'Story Points: not detected',
            estimateNames.length ? `Story Point Estimate: ${estimateNames.join(', ')}` : 'Story Point Estimate: not detected',
            acceptanceNames.length ? `Acceptance Criteria: ${acceptanceNames.join(', ')}` : 'Acceptance Criteria: not detected',
        ].join(' · ');
    } catch {
        fieldsHint.textContent = 'Field metadata could not be loaded yet. Export will still use Jira defaults where available.';
    }
}

async function exportBacklogAnalyzer() {
    const { jqlInput, exportBtn } = getEls();
    const jql = String(jqlInput?.value || '').trim();
    if (!jql) {
        showError('Please enter a JQL query.');
        return;
    }

    const host = backlogAnalyzerState.host || await getJiraHost();
    if (!host) {
        showError('Could not detect Jira host. Open a Jira tab first.');
        return;
    }

    if (exportBtn) exportBtn.disabled = true;

    try {
        showProgress('Resolving Jira fields...', 5);
        const fields = await fetchAllJiraFields(host);
        const storyPointsResolution = await fetchSpFieldResolution(host);
        const storyPointCandidates = await fetchStoryPointsFieldCandidates(host);
        const sprintFieldId = await fetchSprintFieldId(host);
        const resolvedFields = resolveBacklogAnalyzerFields(fields, {
            storyPointsResolution,
            storyPointCandidates,
            sprintFieldId,
        });

        showProgress('Fetching current issues...', 15);
        const issues = await searchIssues(host, jql, getSnapshotFields(resolvedFields));
        if (issues.length === 0) {
            showError('No issues found for that JQL query.');
            return;
        }

        showProgress('Enriching epic names...', 28);
        const epicSummaries = await fetchEpicSummaries(host, issues, resolvedFields);

        showProgress('Building snapshot CSV...', 32);
        const snapshotCsv = buildBacklogSnapshotCSV(issues, { host, resolvedFields, epicSummaries });
        const dateStr = getLocalDateSlug();
        downloadFile(snapshotCsv, `jira_issues_snapshot_${dateStr}.csv`, 'text/csv;charset=utf-8;');

        const issueHistories = await fetchIssueHistories(host, issues);
        showProgress('Building history CSV...', 95);
        const historyCsv = buildBacklogHistoryCSV(issueHistories, { resolvedFields });
        downloadFile(historyCsv, `jira_issue_history_${dateStr}.csv`, 'text/csv;charset=utf-8;');

        const historyRows = Math.max(0, historyCsv.split('\n').length - 1);
        showSuccess(`Exported ${issues.length} snapshot rows and ${historyRows} history rows as two separate CSV files.`);
    } catch (error) {
        showError(error.message || 'Unexpected error exporting Backlog Analyzer CSVs.');
    } finally {
        if (exportBtn) exportBtn.disabled = false;
    }
}

function renderDefaultJql() {
    const { jqlInput } = getEls();
    if (!jqlInput || jqlInput.value.trim()) return;
    if (backlogAnalyzerState.lastProject) {
        jqlInput.value = `project = "${backlogAnalyzerState.lastProject}" ORDER BY updated DESC`;
    }
}

export function initBacklogAnalyzer(allProjects = [], host = '', lastProject = '') {
    backlogAnalyzerState.allProjects = Array.isArray(allProjects) ? allProjects : [];
    backlogAnalyzerState.host = host || '';
    backlogAnalyzerState.lastProject = lastProject || '';

    const { exportBtn } = getEls();
    if (!exportBtn) return;

    renderDefaultJql();
    void updateFieldHint(backlogAnalyzerState.host);

    exportBtn.addEventListener('click', () => {
        void exportBacklogAnalyzer();
    });

    document.querySelectorAll('.ba-jql-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const { jqlInput } = getEls();
            if (!jqlInput) return;
            const projectKey = backlogAnalyzerState.lastProject || backlogAnalyzerState.allProjects[0]?.key || 'MY-PROJECT';
            jqlInput.value = String(chip.dataset.jql || '').replaceAll('MY-PROJECT', projectKey);
        });
    });
}

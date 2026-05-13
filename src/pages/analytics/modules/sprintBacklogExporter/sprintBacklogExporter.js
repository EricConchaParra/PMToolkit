/**
 * PMsToolKit — Analytics Hub
 * Sprint Backlog Exporter — choose a sprint and export its backlog to CSV
 */

import {
    fetchBoardId,
    fetchBoardSprints,
    fetchIssueCurrentStatusAge,
    fetchProjectSprints,
    fetchSprintBacklogIssues,
    fetchSprintFieldId,
    fetchSpFieldResolution,
    fetchStoryPointsFieldCandidates,
} from '../jiraApi.js';
import { downloadFile, escapeCSV } from '../csvExporter/csvExporter.js';

const sprintBacklogState = {
    allProjects: [],
    host: '',
    selectedProjectKey: '',
    selectedSprintId: '',
    sprintOptions: [],
};

function getEls() {
    return {
        projectSelect: document.getElementById('sbe-project-select'),
        sprintSelect: document.getElementById('sbe-sprint-select'),
        exportBtn: document.getElementById('sbe-export-btn'),
        refreshBtn: document.getElementById('sbe-refresh-btn'),
        status: document.getElementById('sbe-status'),
        fieldsHint: document.getElementById('sbe-fields-hint'),
    };
}

function getSprintSortValue(sprint) {
    return new Date(sprint?.startDate || sprint?.endDate || 0).getTime() || 0;
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

function normalizeIssueTypeName(issueTypeName = '') {
    const normalized = String(issueTypeName || '').trim().toLowerCase();
    if (normalized === 'story' || normalized === 'user story') return 'US';
    if (normalized === 'task') return 'Task';
    if (normalized === 'bug') return 'Bug';
    return issueTypeName || '';
}

function resolveEpicName(fields = {}) {
    return fields.customfield_10011 || fields.parent?.fields?.summary || '';
}

function buildBacklogRows(issues = [], storyPointFieldIds = [], host = '') {
    return [...issues]
        .sort((left, right) => String(left.key || '').localeCompare(String(right.key || '')))
        .map(issue => {
            const fields = issue.fields || {};
            const assignee = fields.assignee?.displayName || 'Unassigned';
            const storyPointValues = storyPointFieldIds
                .map(fieldId => fields[fieldId])
                .filter(value => value !== null && value !== undefined && value !== '');

            return {
                key: issue.key || '',
                summary: fields.summary || '',
                epic: resolveEpicName(fields),
                type: normalizeIssueTypeName(fields.issuetype?.name || ''),
                assignee,
                storyPoints: storyPointValues.length > 0 ? storyPointValues.join(' | ') : '',
                status: fields.status?.name || '',
                timeInStatusDays: issue.statusAge?.daysInStatus ?? '',
                url: issue.key && host ? `https://${host}/browse/${issue.key}` : '',
            };
        });
}

export function buildSprintBacklogCSV(issues = [], storyPointFieldIds = [], host = '') {
    const headers = ['Key', 'Summary', 'Epic', 'Type', 'Assignee', 'Story Points', 'Status', 'Time in Status (days)', 'URL'];
    const rows = [headers.map(escapeCSV).join(',')];

    buildBacklogRows(issues, storyPointFieldIds, host).forEach(row => {
        rows.push([
            row.key,
            row.summary,
            row.epic,
            row.type,
            row.assignee,
            row.storyPoints,
            row.status,
            row.timeInStatusDays,
            row.url,
        ].map(escapeCSV).join(','));
    });

    return rows.join('\n');
}

function renderProjectOptions(lastProject = '') {
    const { projectSelect } = getEls();
    if (!projectSelect) return;

    const options = sprintBacklogState.allProjects
        .map(project => `
            <option value="${project.key}" ${project.key === lastProject ? 'selected' : ''}>${project.name} (${project.key})</option>
        `)
        .join('');

    projectSelect.innerHTML = `<option value="">Select project...</option>${options}`;
}

function renderSprintOptions() {
    const { sprintSelect, exportBtn } = getEls();
    if (!sprintSelect || !exportBtn) return;

    const options = sprintBacklogState.sprintOptions
        .map(sprint => `
            <option value="${sprint.id}" ${String(sprint.id) === String(sprintBacklogState.selectedSprintId) ? 'selected' : ''}>
                ${sprint.name} (${sprint.state || 'unknown'})
            </option>
        `)
        .join('');

    sprintSelect.innerHTML = `<option value="">Select sprint...</option>${options}`;
    sprintSelect.disabled = sprintBacklogState.sprintOptions.length === 0;
    exportBtn.disabled = !sprintBacklogState.selectedProjectKey || !sprintBacklogState.selectedSprintId;
}

async function updateStoryPointHint() {
    const { fieldsHint } = getEls();
    if (!fieldsHint || !sprintBacklogState.host) return;

    const resolution = await fetchSpFieldResolution(sprintBacklogState.host);
    if (resolution.source === 'ambiguous') {
        const candidates = await fetchStoryPointsFieldCandidates(sprintBacklogState.host);
        fieldsHint.textContent = candidates.length > 0
            ? `Story Points is ambiguous on this Jira site. The export will include all candidate fields: ${candidates.map(field => field.name || field.id).join(', ')}.`
            : 'Story Points is ambiguous on this Jira site. The export will include every Story Points-like field Jira exposes.';
        return;
    }

    if (resolution.fieldId) {
        fieldsHint.textContent = `Story Points source: ${resolution.fieldName || resolution.fieldId}.`;
        return;
    }

    fieldsHint.textContent = resolution.warning || 'Story Points could not be resolved. The export will leave that column blank when Jira does not expose any candidate field.';
}

async function loadSprintsForProject(projectKey) {
    const { sprintSelect, exportBtn } = getEls();
    sprintBacklogState.selectedSprintId = '';
    sprintBacklogState.sprintOptions = [];
    renderSprintOptions();
    if (sprintSelect) sprintSelect.disabled = true;
    if (exportBtn) exportBtn.disabled = true;

    if (!projectKey || !sprintBacklogState.host) {
        setStatus('', '');
        return;
    }

    setStatus('info', 'Loading sprints...');

    try {
        const boardId = await fetchBoardId(sprintBacklogState.host, projectKey);
        const sprints = boardId
            ? await fetchBoardSprints(sprintBacklogState.host, boardId, ['active', 'future', 'closed'])
            : await fetchProjectSprints(
                sprintBacklogState.host,
                projectKey,
                await fetchSprintFieldId(sprintBacklogState.host),
                ['active', 'future', 'closed'],
            );

        sprintBacklogState.sprintOptions = [...sprints]
            .sort((left, right) => getSprintSortValue(right) - getSprintSortValue(left) || String(right.name || '').localeCompare(String(left.name || '')));

        renderSprintOptions();
        setStatus(sprintBacklogState.sprintOptions.length > 0 ? 'success' : 'error',
            sprintBacklogState.sprintOptions.length > 0
                ? `Loaded ${sprintBacklogState.sprintOptions.length} sprints.`
                : 'No sprints found for that project.');
    } catch (error) {
        sprintBacklogState.sprintOptions = [];
        renderSprintOptions();
        setStatus('error', error.message || 'Could not load sprints.');
    }
}

async function exportSprintBacklog() {
    const { exportBtn } = getEls();
    if (!exportBtn || !sprintBacklogState.host || !sprintBacklogState.selectedSprintId) return;

    exportBtn.disabled = true;
    setStatus('info', 'Resolving Story Points fields...');

    try {
        const resolution = await fetchSpFieldResolution(sprintBacklogState.host);
        let storyPointFieldIds = resolution.fieldId ? [resolution.fieldId] : [];

        if (resolution.source === 'ambiguous' || storyPointFieldIds.length === 0) {
            const candidates = await fetchStoryPointsFieldCandidates(sprintBacklogState.host);
            if (candidates.length > 0) {
                storyPointFieldIds = candidates.map(field => field.id);
            }
        }

        setStatus('info', 'Fetching sprint backlog...');
        const sprint = sprintBacklogState.sprintOptions.find(item => String(item.id) === String(sprintBacklogState.selectedSprintId));
        const issues = await fetchSprintBacklogIssues(
            sprintBacklogState.host,
            Number(sprintBacklogState.selectedSprintId),
            storyPointFieldIds,
        );

        if (issues.length === 0) {
            setStatus('error', 'No issues found for that sprint.');
            return;
        }

        setStatus('info', 'Calculating time in status...');
        const concurrency = 5;
        const enrichedIssues = [];
        for (let index = 0; index < issues.length; index += concurrency) {
            const batch = issues.slice(index, index + concurrency);
            const batchResults = await Promise.all(batch.map(async issue => ({
                ...issue,
                statusAge: await fetchIssueCurrentStatusAge(sprintBacklogState.host, issue.key, {
                    currentStatusName: issue.fields?.status?.name || '',
                    currentStatusCategory: issue.fields?.status?.statusCategory?.key || '',
                    createdDate: issue.fields?.created || '',
                    sprintStartDate: sprint?.startDate || '',
                }),
            })));
            enrichedIssues.push(...batchResults);
            setStatus('info', `Calculating time in status: ${Math.min(index + concurrency, issues.length)} / ${issues.length}...`);
        }

        setStatus('info', 'Building CSV...');
        const csv = buildSprintBacklogCSV(enrichedIssues, storyPointFieldIds, sprintBacklogState.host);
        const projectKey = sprintBacklogState.selectedProjectKey.toLowerCase();
        const sprintSlug = String(sprint?.name || sprintBacklogState.selectedSprintId)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || `sprint-${sprintBacklogState.selectedSprintId}`;

        downloadFile(csv, `${projectKey}_sprint_backlog_${sprintSlug}.csv`, 'text/csv;charset=utf-8;');
        setStatus('success', `Exported ${enrichedIssues.length} issues from ${sprint?.name || `sprint ${sprintBacklogState.selectedSprintId}`}.`);
    } catch (error) {
        setStatus('error', error.message || 'Unexpected error exporting CSV.');
    } finally {
        exportBtn.disabled = false;
    }
}

export function initSprintBacklogExporter(allProjects = [], host = '', lastProject = '') {
    sprintBacklogState.allProjects = Array.isArray(allProjects) ? allProjects : [];
    sprintBacklogState.host = host || '';
    sprintBacklogState.selectedProjectKey = lastProject || '';
    sprintBacklogState.selectedSprintId = '';
    sprintBacklogState.sprintOptions = [];

    const { projectSelect, sprintSelect, exportBtn, refreshBtn } = getEls();
    if (!projectSelect || !sprintSelect || !exportBtn || !refreshBtn) return;

    renderProjectOptions(lastProject);
    renderSprintOptions();
    void updateStoryPointHint();

    projectSelect.addEventListener('change', async event => {
        sprintBacklogState.selectedProjectKey = String(event.target.value || '').trim();
        await loadSprintsForProject(sprintBacklogState.selectedProjectKey);
    });

    sprintSelect.addEventListener('change', event => {
        sprintBacklogState.selectedSprintId = String(event.target.value || '').trim();
        renderSprintOptions();
        setStatus('', '');
    });

    exportBtn.addEventListener('click', () => {
        void exportSprintBacklog();
    });

    refreshBtn.addEventListener('click', () => {
        void loadSprintsForProject(sprintBacklogState.selectedProjectKey);
    });

    if (lastProject) {
        void loadSprintsForProject(lastProject);
    }
}

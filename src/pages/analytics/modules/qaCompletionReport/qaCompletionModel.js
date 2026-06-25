import { escapeCSV } from '../csvExporter/csvExporter.js';

const QA_READY_STATUS = 'ready for qa';
const QA_COMPLETED_STATUS = 'qa completed';

function normalizeStatusName(value = '') {
    return String(value || '').trim().toLowerCase();
}

function normalizeAuthor(author = {}) {
    const accountId = String(author?.accountId || '').trim();
    const displayName = String(author?.displayName || author?.name || '').trim();
    return {
        accountId,
        displayName: displayName || accountId || 'Unknown QA',
        key: accountId || displayName || 'unknown-qa',
    };
}

function normalizePerson(person = {}, fallbackName = 'Unknown') {
    const accountId = String(person?.accountId || '').trim();
    const displayName = String(person?.displayName || person?.name || '').trim();
    return {
        accountId,
        displayName: displayName || accountId || fallbackName,
        key: accountId || displayName || fallbackName.toLowerCase().replace(/\s+/g, '-'),
    };
}

function roundToOneDecimal(value) {
    return Math.round(Number(value || 0) * 10) / 10;
}

function isStoryPointsChange(item = {}, spFieldId = '') {
    const fieldName = String(item.field || '').toLowerCase();
    const fieldId = String(item.fieldId || '');
    return fieldName.includes('story point') || (spFieldId && fieldId === spFieldId);
}

function parseStoryPointValue(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getCurrentStoryPoints(issue = {}, spFieldId = '') {
    if (issue._sp !== undefined && issue._sp !== null) {
        const parsed = Number(issue._sp);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (!spFieldId) return 0;
    const parsed = Number(issue.fields?.[spFieldId]);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveStoryPointsAtTime(issue = {}, histories = [], targetIso = '', spFieldId = '') {
    let storyPoints = getCurrentStoryPoints(issue, spFieldId);
    const targetTs = new Date(targetIso).getTime();
    if (!Number.isFinite(targetTs)) return storyPoints;

    const spItems = (Array.isArray(histories) ? histories : [])
        .flatMap(history => (Array.isArray(history.items) ? history.items : [])
            .filter(item => isStoryPointsChange(item, spFieldId))
            .map(item => ({
                ...item,
                created: history.created,
            })))
        .sort((left, right) => new Date(right.created) - new Date(left.created));

    spItems.forEach(change => {
        const changedAt = new Date(change.created).getTime();
        if (!Number.isFinite(changedAt) || changedAt <= targetTs) return;
        storyPoints = parseStoryPointValue(change.fromString ?? change.from);
    });

    return storyPoints;
}

function findLatestQaCompletion(issue = {}, histories = [], spFieldId = '') {
    const completions = (Array.isArray(histories) ? histories : [])
        .flatMap(history => (Array.isArray(history.items) ? history.items : [])
            .filter(item =>
                String(item.field || '').toLowerCase() === 'status'
                && normalizeStatusName(item.fromString) === QA_READY_STATUS
                && normalizeStatusName(item.toString) === QA_COMPLETED_STATUS
            )
            .map(item => ({
                created: history.created,
                author: normalizeAuthor(history.author),
                from: item.fromString || '',
                to: item.toString || '',
            })))
        .filter(change => Number.isFinite(new Date(change.created).getTime()))
        .sort((left, right) => new Date(left.created) - new Date(right.created));

    const latest = completions[completions.length - 1] || null;
    if (!latest) return null;

    return {
        ...latest,
        storyPoints: resolveStoryPointsAtTime(issue, histories, latest.created, spFieldId),
    };
}

function buildDetailRow({ issue, completion, projectKey = '', host = '' }) {
    const fields = issue.fields || {};
    const creator = normalizePerson(fields.creator, 'Unknown Creator');
    const reporter = normalizePerson(fields.reporter, 'Unknown Reporter');
    return {
        projectKey,
        ticketKey: issue.key || '',
        summary: fields.summary || '',
        issueType: fields.issuetype?.name || '',
        currentStatus: fields.status?.name || '',
        creatorName: creator.displayName,
        creatorAccountId: creator.accountId,
        reporterName: reporter.displayName,
        reporterAccountId: reporter.accountId,
        qaName: completion.author.displayName,
        qaAccountId: completion.author.accountId,
        qaKey: completion.author.key,
        completedAt: completion.created,
        storyPoints: completion.storyPoints,
        transitionFrom: completion.from,
        transitionTo: completion.to,
        ticketUrl: host && issue.key ? `https://${host}/browse/${issue.key}` : '',
    };
}

function buildPersonDistribution(issueResults = [], fieldName = '', spFieldId = '', fallbackName = 'Unknown') {
    const issues = (Array.isArray(issueResults) ? issueResults : [])
        .map(result => result?.issue || result)
        .filter(issue => issue?.key);
    const totalTickets = issues.length;
    const totalStoryPoints = roundToOneDecimal(issues.reduce((sum, issue) => sum + getCurrentStoryPoints(issue, spFieldId), 0));
    const personMap = new Map();

    issues.forEach(issue => {
        const person = normalizePerson(issue.fields?.[fieldName], fallbackName);
        if (!personMap.has(person.key)) {
            personMap.set(person.key, {
                name: person.displayName,
                accountId: person.accountId,
                key: person.key,
                ticketCount: 0,
                storyPoints: 0,
            });
        }
        const row = personMap.get(person.key);
        row.ticketCount += 1;
        row.storyPoints += getCurrentStoryPoints(issue, spFieldId);
    });

    return Array.from(personMap.values())
        .map(row => ({
            ...row,
            storyPoints: roundToOneDecimal(row.storyPoints),
            ticketPercent: totalTickets > 0 ? roundToOneDecimal((row.ticketCount / totalTickets) * 100) : 0,
            storyPointPercent: totalStoryPoints > 0 ? roundToOneDecimal((row.storyPoints / totalStoryPoints) * 100) : 0,
        }))
        .sort((left, right) =>
            right.ticketCount - left.ticketCount
            || right.storyPoints - left.storyPoints
            || left.name.localeCompare(right.name)
        );
}

export function buildQaCompletionReportModel({
    projectKey = '',
    host = '',
    issueResults = [],
    spFieldId = '',
} = {}) {
    const details = [];
    let skippedIssues = 0;

    (Array.isArray(issueResults) ? issueResults : []).forEach(result => {
        const issue = result?.issue || result;
        if (!issue?.key) return;
        if (result?.error) {
            skippedIssues += 1;
            return;
        }

        const histories = Array.isArray(result?.changelog) ? result.changelog : [];
        const completion = findLatestQaCompletion(issue, histories, spFieldId);
        if (!completion) return;
        details.push(buildDetailRow({ issue, completion, projectKey, host }));
    });

    details.sort((left, right) =>
        new Date(right.completedAt) - new Date(left.completedAt)
        || String(left.ticketKey).localeCompare(String(right.ticketKey))
    );

    const totalTickets = details.length;
    const totalStoryPoints = roundToOneDecimal(details.reduce((sum, row) => sum + Number(row.storyPoints || 0), 0));
    const qaMap = new Map();

    details.forEach(row => {
        if (!qaMap.has(row.qaKey)) {
            qaMap.set(row.qaKey, {
                qaName: row.qaName,
                qaAccountId: row.qaAccountId,
                qaKey: row.qaKey,
                ticketCount: 0,
                storyPoints: 0,
                lastCompletedAt: '',
            });
        }
        const qa = qaMap.get(row.qaKey);
        qa.ticketCount += 1;
        qa.storyPoints += Number(row.storyPoints || 0);
        if (!qa.lastCompletedAt || new Date(row.completedAt) > new Date(qa.lastCompletedAt)) {
            qa.lastCompletedAt = row.completedAt;
        }
    });

    const contributors = Array.from(qaMap.values())
        .map(row => ({
            ...row,
            storyPoints: roundToOneDecimal(row.storyPoints),
            ticketPercent: totalTickets > 0 ? roundToOneDecimal((row.ticketCount / totalTickets) * 100) : 0,
            storyPointPercent: totalStoryPoints > 0 ? roundToOneDecimal((row.storyPoints / totalStoryPoints) * 100) : 0,
        }))
        .sort((left, right) =>
            right.storyPoints - left.storyPoints
            || right.ticketCount - left.ticketCount
            || left.qaName.localeCompare(right.qaName)
        );

    return {
        summary: {
            analyzedIssues: Array.isArray(issueResults) ? issueResults.length : 0,
            skippedIssues,
            totalTickets,
            totalStoryPoints,
            contributorCount: contributors.length,
        },
        contributors,
        creators: buildPersonDistribution(issueResults, 'creator', spFieldId, 'Unknown Creator'),
        reporters: buildPersonDistribution(issueResults, 'reporter', spFieldId, 'Unknown Reporter'),
        details,
    };
}

export function buildQaCompletionCSV(model = {}) {
    const headers = [
        'Project Key',
        'Ticket Key',
        'Summary',
        'Issue Type',
        'Current Status',
        'Creator',
        'Creator Account ID',
        'Reporter',
        'Reporter Account ID',
        'QA Completed By',
        'QA Account ID',
        'QA Completed At',
        'Story Points',
        'Transition From',
        'Transition To',
        'Jira URL',
    ];

    const rows = [headers.map(escapeCSV).join(',')];
    (Array.isArray(model.details) ? model.details : []).forEach(row => {
        rows.push([
            row.projectKey,
            row.ticketKey,
            row.summary,
            row.issueType,
            row.currentStatus,
            row.creatorName,
            row.creatorAccountId,
            row.reporterName,
            row.reporterAccountId,
            row.qaName,
            row.qaAccountId,
            row.completedAt,
            row.storyPoints,
            row.transitionFrom,
            row.transitionTo,
            row.ticketUrl,
        ].map(escapeCSV).join(','));
    });

    return rows.join('\n');
}

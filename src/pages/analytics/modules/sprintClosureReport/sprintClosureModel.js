import { escapeHtml } from '../utils.js';
import { getSprintClosureStorageKey as getScopedSprintClosureStorageKey } from '../../../../common/jiraStorageKeys.js';

const REPORT_STATE_DEFAULTS = {
    observationsByIssue: {},
    currentStatusOverridesByIssue: {},
    carryoverOverridesByIssue: {},
    scopeCreepOverridesByIssue: {},
    updatedAt: 0,
};

export function getSprintClosureStorageKey(host, projectKey, sprintId) {
    return getScopedSprintClosureStorageKey(host, projectKey, sprintId);
}

export function normalizeSprintClosureState(raw = {}) {
    return {
        observationsByIssue: normalizeStringMap(raw.observationsByIssue),
        currentStatusOverridesByIssue: normalizeStringMap(raw.currentStatusOverridesByIssue),
        carryoverOverridesByIssue: normalizeOverrideMap(raw.carryoverOverridesByIssue),
        scopeCreepOverridesByIssue: normalizeOverrideMap(raw.scopeCreepOverridesByIssue),
        updatedAt: Number(raw.updatedAt) || 0,
    };
}

export function getDefaultSprintClosureState() {
    return {
        observationsByIssue: {},
        currentStatusOverridesByIssue: {},
        carryoverOverridesByIssue: {},
        scopeCreepOverridesByIssue: {},
        updatedAt: 0,
    };
}

export function buildSprintClosureReportModel({
    issues = [],
    sprint = null,
    nextSprint = null,
    reportState = REPORT_STATE_DEFAULTS,
    statusCategoryMap = {},
    host = '',
    sprintFieldId = '',
    spFieldId = '',
} = {}) {
    const normalizedState = normalizeSprintClosureState(reportState);
    const cutoffIso = sprint?.completeDate || sprint?.endDate || '';
    const closeTs = cutoffIso ? new Date(cutoffIso).getTime() : Date.now();
    const startTs = sprint?.startDate ? new Date(sprint.startDate).getTime() : closeTs;

    const issueRecords = issues.map(issue => buildIssueRecord({
        issue,
        sprint,
        nextSprint,
        closeTs,
        startTs,
        statusCategoryMap,
        host,
        sprintFieldId,
        spFieldId,
    }));

    const issueMap = Object.fromEntries(issueRecords.map(issue => [issue.key, issue]));
    const carryoverUniverse = issueRecords.filter(issue => issue.inSprintAtClose);
    const carryoverUniverseMap = new Set(carryoverUniverse.map(issue => issue.key));
    const scopeUniverse = issueRecords.filter(issue => issue.participatedInSprint);
    const scopeUniverseMap = new Set(scopeUniverse.map(issue => issue.key));

    const finalScopeKeys = resolveFinalKeys({
        autoKeys: scopeUniverse.filter(issue => issue.autoScopeCreep).map(issue => issue.key),
        overrideMap: normalizedState.scopeCreepOverridesByIssue,
        allowedKeys: scopeUniverseMap,
    });
    const finalCarryoverKeys = resolveFinalKeys({
        autoKeys: carryoverUniverse.filter(issue => issue.autoCarryover).map(issue => issue.key),
        overrideMap: normalizedState.carryoverOverridesByIssue,
        allowedKeys: carryoverUniverseMap,
    });
    const hiddenScopeKeys = scopeUniverse
        .filter(issue => issue.autoScopeCreep && normalizedState.scopeCreepOverridesByIssue[issue.key] === 'excluded')
        .map(issue => issue.key);
    const hiddenCarryoverKeys = carryoverUniverse
        .filter(issue => issue.autoCarryover && normalizedState.carryoverOverridesByIssue[issue.key] === 'excluded')
        .map(issue => issue.key);

    const scopeKeySet = new Set(finalScopeKeys);
    const carryoverKeySet = new Set(finalCarryoverKeys);
    const totalSP = sumBy(issueRecords, issue => issue.scopeAtClose);
    const committedSP = sumBy(issueRecords, issue => issue.scopeAtStart);
    const scopeCreepSP = sumBy(finalScopeKeys.map(key => issueMap[key]).filter(Boolean), issue => issue.scopeDelta);
    const completedSP = sumBy(carryoverUniverse.filter(issue => issue.doneAtClose), issue => issue.scopeAtClose);
    const carryoverSP = sumSp(finalCarryoverKeys.map(key => issueMap[key]).filter(Boolean));
    const completionRate = totalSP > 0 ? Math.round((completedSP / totalSP) * 100) : 0;
    const missingObservationCount = finalCarryoverKeys.filter(key => !String(normalizedState.observationsByIssue[key] || '').trim()).length;

    const carryovers = finalCarryoverKeys
        .map(key => issueMap[key])
        .filter(Boolean)
        .map(issue => ({
            ...issue,
            observation: normalizedState.observationsByIssue[issue.key] || '',
            currentStatus: normalizedState.currentStatusOverridesByIssue[issue.key] || issue.currentStatus,
            origin: resolveOrigin(issue.autoCarryover, normalizedState.carryoverOverridesByIssue[issue.key]),
        }))
        .sort(compareIssueRows);

    const scopeCreep = finalScopeKeys
        .map(key => issueMap[key])
        .filter(Boolean)
        .map(issue => ({
            ...issue,
            currentStatus: normalizedState.currentStatusOverridesByIssue[issue.key] || issue.currentStatus,
            scopeDeltaLabel: formatSignedSp(issue.scopeDelta),
            origin: resolveOrigin(issue.autoScopeCreep, normalizedState.scopeCreepOverridesByIssue[issue.key]),
        }))
        .sort(compareIssueRows);

    const hiddenCarryovers = hiddenCarryoverKeys
        .map(key => issueMap[key])
        .filter(Boolean)
        .sort(compareIssueRows);
    const hiddenScopeCreep = hiddenScopeKeys
        .map(key => issueMap[key])
        .filter(Boolean)
        .sort(compareIssueRows);

    const carryoverCandidates = carryoverUniverse
        .filter(issue => !carryoverKeySet.has(issue.key) && !hiddenCarryoverKeys.includes(issue.key))
        .sort(compareIssueRows);
    const scopeCreepCandidates = scopeUniverse
        .filter(issue => !scopeKeySet.has(issue.key) && !hiddenScopeKeys.includes(issue.key))
        .sort(compareIssueRows);

    return {
        sprint,
        nextSprint,
        summary: {
            committedSP,
            scopeCreepSP,
            totalSP,
            completedSP,
            carryoverSP,
            completionRate,
        },
        missingObservationCount,
        carryovers,
        scopeCreep,
        hiddenCarryovers,
        hiddenScopeCreep,
        carryoverCandidates,
        scopeCreepCandidates,
        issueMap,
    };
}

function buildIssueRecord({
    issue,
    sprint,
    nextSprint,
    closeTs,
    startTs,
    statusCategoryMap,
    host,
    sprintFieldId,
    spFieldId,
}) {
    const histories = Array.isArray(issue._changelogHistories) ? issue._changelogHistories : [];
    const sprintFieldValue = sprintFieldId ? issue.fields?.[sprintFieldId] : null;
    const statusAtClose = resolveStatusAtClose(issue, histories, closeTs);
    const statusCategoryAtClose = resolveStatusCategory(statusAtClose.name, statusCategoryMap, issue.fields?.status);
    const inSprintAtStart = resolveSprintMembershipAtTime(sprintFieldValue, histories, sprint, startTs);
    const inSprintAtClose = resolveSprintMembershipAtTime(sprintFieldValue, histories, sprint, closeTs);
    const scopeChange = resolveScopeChangeSummary({
        issue,
        histories,
        sprint,
        sprintFieldValue,
        startTs,
        closeTs,
        spFieldId,
    });
    const autoScopeCreep = scopeChange.scopeDelta !== 0;
    const autoCarryover = Boolean(
        inSprintAtClose
        && statusCategoryAtClose !== 'done'
        && nextSprint
        && wasMovedToNextSprintAfterClose(sprintFieldValue, histories, nextSprint, closeTs)
    );

    return {
        key: issue.key,
        jiraUrl: host ? `https://${host}/browse/${issue.key}` : '',
        summary: issue.fields?.summary || '',
        sp: Number(issue._sp || 0),
        currentStatus: issue.fields?.status?.name || '',
        statusAtClose: statusAtClose.name || '',
        statusCategoryAtClose,
        doneAtClose: statusCategoryAtClose === 'done',
        inSprintAtStart,
        inSprintAtClose,
        participatedInSprint: inSprintAtStart || inSprintAtClose || scopeChange.events.length > 0,
        scopeAtStart: scopeChange.scopeAtStart,
        scopeAtClose: scopeChange.scopeAtClose,
        scopeDelta: scopeChange.scopeDelta,
        autoScopeCreep,
        autoCarryover,
        addedToSprintAt: scopeChange.addedToSprintAt,
        scopeChangedAt: scopeChange.firstChangeAt,
        assigneeName: issue.fields?.assignee?.displayName || 'Unassigned',
    };
}

function normalizeStringMap(value) {
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => typeof key === 'string' && key.trim())
            .map(([key, text]) => [key, String(text || '')]),
    );
}

function normalizeOverrideMap(value) {
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
        Object.entries(value)
            .filter(([, mode]) => mode === 'default' || mode === 'excluded' || mode === 'included'),
    );
}

function resolveFinalKeys({ autoKeys = [], overrideMap = {}, allowedKeys = new Set() }) {
    const keys = new Set(autoKeys.filter(key => allowedKeys.has(key)));

    Object.entries(overrideMap || {}).forEach(([issueKey, mode]) => {
        if (!allowedKeys.has(issueKey)) return;
        if (mode === 'included') keys.add(issueKey);
        if (mode === 'excluded') keys.delete(issueKey);
    });

    return Array.from(keys);
}

function resolveOrigin(isAuto, override) {
    if (override === 'included' && !isAuto) return 'manual';
    if (override === 'excluded') return 'excluded';
    return isAuto ? 'auto' : 'manual';
}

function sumSp(issues = []) {
    return issues.reduce((total, issue) => total + Number(issue?.sp || 0), 0);
}

function sumBy(items = [], selector = value => value) {
    return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function compareIssueRows(left, right) {
    return left.key.localeCompare(right.key);
}

function resolveStatusAtClose(issue, histories, closeTs) {
    let statusName = issue.fields?.status?.name || '';
    const statusItems = extractHistoryItems(histories, item => item.field === 'status')
        .sort((left, right) => new Date(right.created) - new Date(left.created));

    statusItems.forEach(change => {
        const changedAt = new Date(change.created).getTime();
        if (Number.isNaN(changedAt) || changedAt <= closeTs) return;
        statusName = change.fromString || statusName;
    });

    return { name: statusName };
}

function resolveStatusCategory(statusName, statusCategoryMap, currentStatus = {}) {
    const mapped = statusCategoryMap[(statusName || '').toLowerCase()];
    if (mapped) return mapped;
    const currentName = (currentStatus?.name || '').toLowerCase();
    if (currentName === (statusName || '').toLowerCase()) {
        return currentStatus?.statusCategory?.key || inferStatusCategory(statusName);
    }
    return inferStatusCategory(statusName);
}

function inferStatusCategory(statusName) {
    const normalized = (statusName || '').toLowerCase();
    if (normalized.includes('done') || normalized.includes('closed') || normalized.includes('accepted')) return 'done';
    if (normalized.includes('todo') || normalized.includes('to do') || normalized.includes('backlog')) return 'new';
    return 'indeterminate';
}

function resolveSprintMembershipAtTime(currentSprintFieldValue, histories, sprint, targetTs) {
    let hasSprint = valueContainsSprint(currentSprintFieldValue, sprint);
    const sprintItems = extractHistoryItems(histories, item => item.field.toLowerCase() === 'sprint')
        .sort((left, right) => new Date(right.created) - new Date(left.created));

    sprintItems.forEach(change => {
        const changedAt = new Date(change.created).getTime();
        if (Number.isNaN(changedAt) || changedAt <= targetTs) return;

        const fromHas = sprintChangeContains(change, 'from', sprint);
        const toHas = sprintChangeContains(change, 'to', sprint);
        if (fromHas === toHas) return;
        hasSprint = fromHas;
    });

    return hasSprint;
}

function resolveLatestAddToSprintBefore(histories, sprint, closeTs) {
    const sprintItems = extractHistoryItems(histories, item => item.field.toLowerCase() === 'sprint')
        .sort((left, right) => new Date(left.created) - new Date(right.created));
    let latest = null;

    sprintItems.forEach(change => {
        const changedAt = new Date(change.created).getTime();
        if (Number.isNaN(changedAt) || changedAt > closeTs) return;
        const fromHas = sprintChangeContains(change, 'from', sprint);
        const toHas = sprintChangeContains(change, 'to', sprint);
        if (!fromHas && toHas) {
            latest = new Date(change.created);
        }
    });

    return latest;
}

function resolveScopeChangeSummary({
    issue,
    histories,
    sprint,
    sprintFieldValue,
    startTs,
    closeTs,
    spFieldId,
}) {
    let inSprint = resolveSprintMembershipAtTime(sprintFieldValue, histories, sprint, startTs);
    let storyPoints = resolveStoryPointsAtTime(issue, histories, startTs, spFieldId);
    const scopeAtStart = inSprint ? storyPoints : 0;
    const groupedChanges = groupScopeChangesByTimestamp(histories, sprint, startTs, closeTs, spFieldId);
    const events = [];
    let addedToSprintAt = '';

    groupedChanges.forEach(changeGroup => {
        const beforeScope = inSprint ? storyPoints : 0;

        changeGroup.sprintChanges.forEach(change => {
            const fromHas = sprintChangeContains(change, 'from', sprint);
            const toHas = sprintChangeContains(change, 'to', sprint);
            if (fromHas !== toHas) {
                inSprint = toHas;
                if (!fromHas && toHas && !addedToSprintAt) {
                    addedToSprintAt = change.created;
                }
            }
        });

        changeGroup.spChanges.forEach(change => {
            storyPoints = parseStoryPointValue(change.toString ?? change.to);
        });

        const afterScope = inSprint ? storyPoints : 0;
        const delta = afterScope - beforeScope;
        if (delta !== 0) {
            events.push({
                created: changeGroup.created,
                delta,
            });
        }
    });

    const scopeAtClose = inSprint ? storyPoints : 0;

    return {
        scopeAtStart,
        scopeAtClose,
        scopeDelta: sumBy(events, event => event.delta),
        firstChangeAt: events[0]?.created || '',
        addedToSprintAt,
        events,
    };
}

function groupScopeChangesByTimestamp(histories, sprint, startTs, closeTs, spFieldId) {
    const grouped = new Map();

    const pushChange = (created, type, change) => {
        const changedAt = new Date(created).getTime();
        if (Number.isNaN(changedAt) || changedAt <= startTs || changedAt > closeTs) return;
        if (!grouped.has(created)) {
            grouped.set(created, { created, sprintChanges: [], spChanges: [] });
        }
        grouped.get(created)[type].push(change);
    };

    extractHistoryItems(histories, item => item.field.toLowerCase() === 'sprint').forEach(change => {
        if (sprintChangeContains(change, 'from', sprint) || sprintChangeContains(change, 'to', sprint)) {
            pushChange(change.created, 'sprintChanges', change);
        }
    });

    extractHistoryItems(histories, item => isStoryPointsChange(item, spFieldId)).forEach(change => {
        pushChange(change.created, 'spChanges', change);
    });

    return Array.from(grouped.values()).sort((left, right) => new Date(left.created) - new Date(right.created));
}

function wasMovedToNextSprintAfterClose(currentSprintFieldValue, histories, nextSprint, closeTs) {
    if (valueContainsSprint(currentSprintFieldValue, nextSprint)) return true;

    const sprintItems = extractHistoryItems(histories, item => item.field.toLowerCase() === 'sprint')
        .sort((left, right) => new Date(left.created) - new Date(right.created));

    return sprintItems.some(change => {
        const changedAt = new Date(change.created).getTime();
        if (Number.isNaN(changedAt) || changedAt <= closeTs) return false;
        const fromHas = sprintChangeContains(change, 'from', nextSprint);
        const toHas = sprintChangeContains(change, 'to', nextSprint);
        return !fromHas && toHas;
    });
}

function extractHistoryItems(histories, predicate) {
    return (histories || []).flatMap(history => {
        const items = Array.isArray(history.items) ? history.items : [];
        return items
            .filter(item => predicate(item))
            .map(item => ({
                ...item,
                created: history.created,
            }));
    });
}

function isStoryPointsChange(item = {}, spFieldId = '') {
    const fieldName = String(item.field || '').toLowerCase();
    const fieldId = String(item.fieldId || '');
    return fieldName.includes('story point') || (spFieldId && fieldId === spFieldId);
}

function resolveStoryPointsAtTime(issue, histories, targetTs, spFieldId = '') {
    let storyPoints = Number(issue?._sp || 0);
    const spItems = extractHistoryItems(histories, item => isStoryPointsChange(item, spFieldId))
        .sort((left, right) => new Date(right.created) - new Date(left.created));

    spItems.forEach(change => {
        const changedAt = new Date(change.created).getTime();
        if (Number.isNaN(changedAt) || changedAt <= targetTs) return;
        storyPoints = parseStoryPointValue(change.fromString ?? change.from);
    });

    return storyPoints;
}

function parseStoryPointValue(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sprintChangeContains(change, direction, sprint) {
    const rawValue = direction === 'from'
        ? [change.from, change.fromString]
        : [change.to, change.toString];
    return rawValue.some(value => valueContainsSprint(value, sprint));
}

function valueContainsSprint(value, sprint) {
    if (!sprint) return false;
    if (Array.isArray(value)) return value.some(item => valueContainsSprint(item, sprint));
    if (value && typeof value === 'object') {
        const idMatches = String(value.id || value.sequence || '') === String(sprint.id);
        const nameMatches = String(value.name || '').toLowerCase() === String(sprint.name || '').toLowerCase();
        if (idMatches || nameMatches) return true;
        return Object.values(value).some(inner => valueContainsSprint(inner, sprint));
    }

    const text = String(value || '');
    if (!text) return false;

    const lower = text.toLowerCase();
    const sprintName = String(sprint.name || '').toLowerCase();
    if (sprintName && lower.includes(sprintName)) return true;

    const sprintId = String(sprint.id || '');
    if (!sprintId) return false;
    return lower.includes(`id=${sprintId}`) || lower.includes(`"id":${sprintId}`) || lower.includes(`,${sprintId},`);
}

export function renderOriginBadge(origin) {
    if (origin === 'manual') return '<span class="scr-origin-badge is-manual">Manual</span>';
    return '<span class="scr-origin-badge is-auto">Auto</span>';
}

export function renderIssueOption(issue) {
    return `<option value="${escapeHtml(issue.key)}">${escapeHtml(issue.key)} · ${escapeHtml(issue.summary)}</option>`;
}

export function formatSignedSp(value) {
    const numeric = Number(value || 0);
    if (numeric > 0) return `+${numeric}`;
    return `${numeric}`;
}

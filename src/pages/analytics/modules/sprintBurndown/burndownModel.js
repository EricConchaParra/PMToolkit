import { formatDate } from '../utils.js';

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function parseHistoryNumber(value) {
    if (value == null || value === '') return null;
    const cleaned = String(value).replace(/,/g, '').trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
}

function toMs(value, fallback = NaN) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : fallback;
}

function startOfDay(dateLike) {
    const date = new Date(dateLike);
    date.setHours(0, 0, 0, 0);
    return date;
}

function endOfDay(dateLike) {
    const date = new Date(dateLike);
    date.setHours(23, 59, 59, 999);
    return date;
}

function dayKeyFromMs(ms) {
    const date = new Date(ms);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveStatusCategory(change = {}, lookup, fallback = '') {
    const statusId = String(change.id || '').trim();
    const statusName = String(change.name || '').trim().toLowerCase();

    if (statusId && lookup.byId.has(statusId)) return lookup.byId.get(statusId);
    if (statusName && lookup.byName.has(statusName)) return lookup.byName.get(statusName);
    return fallback || '';
}

function isDoneCategory(categoryKey = '') {
    return String(categoryKey || '').trim().toLowerCase() === 'done';
}

function buildStatusLookup(statusCatalog = [], issues = []) {
    const lookup = {
        byId: new Map(),
        byName: new Map(),
    };

    (Array.isArray(statusCatalog) ? statusCatalog : []).forEach(status => {
        const categoryKey = String(status?.categoryKey || '').trim().toLowerCase();
        if (!categoryKey) return;

        const id = String(status?.id || '').trim();
        const name = String(status?.name || '').trim().toLowerCase();
        if (id) lookup.byId.set(id, categoryKey);
        if (name) lookup.byName.set(name, categoryKey);
    });

    (Array.isArray(issues) ? issues : []).forEach(issue => {
        const status = issue?.fields?.status;
        const categoryKey = String(status?.statusCategory?.key || '').trim().toLowerCase();
        if (!categoryKey) return;

        const id = String(status?.id || '').trim();
        const name = String(status?.name || '').trim().toLowerCase();
        if (id && !lookup.byId.has(id)) lookup.byId.set(id, categoryKey);
        if (name && !lookup.byName.has(name)) lookup.byName.set(name, categoryKey);
    });

    return lookup;
}

function isStoryPointItem(item = {}, spFieldId = '') {
    const field = String(item.field || '').trim().toLowerCase();
    const fieldId = String(item.fieldId || '').trim();
    return fieldId === spFieldId || field === 'story points' || field === 'story point estimate';
}

function getCurrentStoryPoints(issue, spFieldId) {
    return toNumber(issue?.fields?.[spFieldId], 0);
}

function getStoryPointsAtTime(issue, spFieldId, changelog = [], targetMs) {
    let storyPoints = getCurrentStoryPoints(issue, spFieldId);
    const histories = (Array.isArray(changelog) ? changelog : []).slice().sort((left, right) => toMs(right.created) - toMs(left.created));

    histories.forEach(history => {
        const historyMs = toMs(history?.created);
        if (!Number.isFinite(historyMs) || historyMs <= targetMs) return;

        (history.items || []).forEach(item => {
            if (!isStoryPointItem(item, spFieldId)) return;
            const previous = parseHistoryNumber(item.fromString);
            if (previous != null) storyPoints = previous;
        });
    });

    return Math.max(0, storyPoints);
}

function getDoneStateAtTime(issue, changelog = [], statusLookup, targetMs) {
    let statusName = String(issue?.fields?.status?.name || '').trim();
    let statusId = String(issue?.fields?.status?.id || '').trim();
    let categoryKey = String(issue?.fields?.status?.statusCategory?.key || '').trim().toLowerCase();

    const histories = (Array.isArray(changelog) ? changelog : []).slice().sort((left, right) => toMs(right.created) - toMs(left.created));

    histories.forEach(history => {
        const historyMs = toMs(history?.created);
        if (!Number.isFinite(historyMs) || historyMs <= targetMs) return;

        (history.items || []).forEach(item => {
            if (String(item.field || '').trim().toLowerCase() !== 'status') return;
            statusName = String(item.fromString || statusName).trim();
            statusId = String(item.from || statusId).trim();
            categoryKey = resolveStatusCategory({ id: statusId, name: statusName }, statusLookup, categoryKey);
        });
    });

    categoryKey = resolveStatusCategory({ id: statusId, name: statusName }, statusLookup, categoryKey);
    return isDoneCategory(categoryKey);
}

function sprintMembershipContains(value, sprint) {
    if (!value || !sprint) return false;

    if (typeof value === 'object') {
        const id = Number(value.id);
        if (Number.isFinite(id) && id === Number(sprint.id)) return true;
        return String(value.name || '').trim() === String(sprint.name || '').trim();
    }

    const stringValue = String(value);
    return stringValue.includes(`id=${sprint.id}`) || stringValue.includes(`name=${sprint.name}`);
}

function getScopedAtMs(issue, sprint, changelog = [], sprintStartMs) {
    const createdMs = toMs(issue?.fields?.created, sprintStartMs);
    let scopedAtMs = Math.max(createdMs, sprintStartMs);
    const histories = (Array.isArray(changelog) ? changelog : []).slice().sort((left, right) => toMs(left.created) - toMs(right.created));

    for (const history of histories) {
        const historyMs = toMs(history?.created);
        if (!Number.isFinite(historyMs)) continue;

        for (const item of (history.items || [])) {
            if (String(item.field || '').trim().toLowerCase() !== 'sprint') continue;
            const hadSprintBefore = sprintMembershipContains(item.fromString, sprint);
            const hasSprintAfter = sprintMembershipContains(item.toString, sprint);
            if (hasSprintAfter && !hadSprintBefore) {
                scopedAtMs = Math.max(historyMs, sprintStartMs);
                return scopedAtMs;
            }
        }
    }

    return scopedAtMs;
}

function createIssueUrl(host, issueKey) {
    return host && issueKey ? `https://${host}/browse/${issueKey}` : '';
}

function getStatusBucket(categoryKey = '') {
    const normalized = String(categoryKey || '').trim().toLowerCase();
    if (normalized === 'done') return 'done';
    if (normalized === 'new' || normalized === 'todo') return 'todo';
    return 'active';
}

function summarizeStatusLabel(categoryKey = '') {
    const bucket = getStatusBucket(categoryKey);
    if (bucket === 'done') return 'Done';
    if (bucket === 'todo') return 'To Do';
    return 'In Progress';
}

function sortHistoryItems(items = [], spFieldId = '') {
    return (Array.isArray(items) ? items : []).slice().sort((left, right) => {
        const leftIsSp = isStoryPointItem(left, spFieldId);
        const rightIsSp = isStoryPointItem(right, spFieldId);
        if (leftIsSp === rightIsSp) return 0;
        return leftIsSp ? -1 : 1;
    });
}

function buildIssueEvents(issue, sprint, changelog, statusLookup, spFieldId, sprintStartMs) {
    const issueKey = String(issue?.key || '').trim();
    if (!issueKey) return [];

    const scopedAtMs = getScopedAtMs(issue, sprint, changelog, sprintStartMs);
    let storyPoints = getStoryPointsAtTime(issue, spFieldId, changelog, scopedAtMs);
    let isDone = getDoneStateAtTime(issue, changelog, statusLookup, scopedAtMs);

    const baseMeta = {
        issueKey,
        summary: String(issue?.fields?.summary || '').trim(),
        assignee: String(issue?.fields?.assignee?.displayName || 'Unassigned').trim(),
    };

    const events = [
        {
            type: 'scope',
            atMs: scopedAtMs,
            deltaScope: storyPoints,
            deltaRemaining: isDone ? 0 : storyPoints,
            deltaDone: 0,
            label: storyPoints > 0 ? `Added ${storyPoints} SP to sprint scope` : 'Added to sprint scope',
            ...baseMeta,
        },
    ];

    const histories = (Array.isArray(changelog) ? changelog : []).slice().sort((left, right) => toMs(left.created) - toMs(right.created));

    histories.forEach(history => {
        const historyMs = toMs(history?.created);
        if (!Number.isFinite(historyMs) || historyMs < scopedAtMs) return;

        sortHistoryItems(history.items, spFieldId).forEach(item => {
            if (isStoryPointItem(item, spFieldId)) {
                const nextPoints = parseHistoryNumber(item.toString);
                if (nextPoints == null || nextPoints === storyPoints) return;

                const delta = nextPoints - storyPoints;
                storyPoints = nextPoints;
                events.push({
                    type: 'estimate',
                    atMs: historyMs,
                    deltaScope: delta,
                    deltaRemaining: isDone ? 0 : delta,
                    deltaDone: 0,
                    label: `${delta >= 0 ? '+' : ''}${delta} SP estimate change`,
                    ...baseMeta,
                });
                return;
            }

            if (String(item.field || '').trim().toLowerCase() !== 'status') return;

            const nextStatusName = String(item.toString || '').trim();
            const nextStatusId = String(item.to || '').trim();
            const nextCategory = resolveStatusCategory({ id: nextStatusId, name: nextStatusName }, statusLookup, '');
            const nextIsDone = isDoneCategory(nextCategory);
            if (nextIsDone === isDone) return;

            isDone = nextIsDone;
            events.push({
                type: nextIsDone ? 'done' : 'reopened',
                atMs: historyMs,
                deltaScope: 0,
                deltaRemaining: nextIsDone ? -storyPoints : storyPoints,
                deltaDone: nextIsDone ? storyPoints : -storyPoints,
                label: nextIsDone
                    ? `Completed ${storyPoints} SP`
                    : `Reopened ${storyPoints} SP`,
                ...baseMeta,
            });
        });
    });

    return events.sort((left, right) => left.atMs - right.atMs);
}

function createDayEventAccumulator() {
    return {
        events: [],
        burnedTodaySp: 0,
        scopeDeltaTodaySp: 0,
        doneTodayCount: 0,
        reopenedTodayCount: 0,
    };
}

function pushEventIntoDay(dayMap, event) {
    const key = dayKeyFromMs(event.atMs);
    if (!dayMap.has(key)) dayMap.set(key, createDayEventAccumulator());
    const day = dayMap.get(key);
    day.events.push(event);
    day.scopeDeltaTodaySp += event.deltaScope;
    if (event.type === 'done') {
        day.burnedTodaySp += Math.max(0, -event.deltaRemaining);
        day.doneTodayCount += 1;
    }
    if (event.type === 'reopened') {
        day.reopenedTodayCount += 1;
    }
}

function summarizeVisibleDayEvents(events = []) {
    return (Array.isArray(events) ? events : []).reduce((summary, event) => {
        summary.scopeDeltaTodaySp += event.deltaScope;
        if (event.type === 'done') {
            summary.burnedTodaySp += Math.max(0, -event.deltaRemaining);
            summary.doneTodayCount += 1;
        }
        if (event.type === 'reopened') {
            summary.reopenedTodayCount += 1;
        }
        return summary;
    }, createDayEventAccumulator());
}

function buildStatusBreakdown(issues = [], spFieldId, host) {
    const byStatus = new Map();

    (Array.isArray(issues) ? issues : []).forEach(issue => {
        const statusName = String(issue?.fields?.status?.name || 'Unknown');
        const categoryKey = String(issue?.fields?.status?.statusCategory?.key || '');
        const key = `${statusName}::${categoryKey}`;
        const entry = byStatus.get(key) || {
            key,
            label: statusName,
            categoryKey,
            bucket: getStatusBucket(categoryKey),
            storyPoints: 0,
            count: 0,
        };
        entry.storyPoints += getCurrentStoryPoints(issue, spFieldId);
        entry.count += 1;
        byStatus.set(key, entry);
    });

    return Array.from(byStatus.values())
        .sort((left, right) => {
            const bucketOrder = { active: 0, todo: 1, done: 2 };
            return (bucketOrder[left.bucket] ?? 9) - (bucketOrder[right.bucket] ?? 9)
                || right.storyPoints - left.storyPoints
                || left.label.localeCompare(right.label);
        })
        .map(entry => ({
            ...entry,
            helperLabel: summarizeStatusLabel(entry.categoryKey),
            colorToken: entry.bucket === 'done' ? 'done' : entry.bucket === 'todo' ? 'todo' : 'active',
            url: createIssueUrl(host, entry.issueKey),
        }));
}

function buildOpenIssues(issues = [], spFieldId, host) {
    return (Array.isArray(issues) ? issues : [])
        .filter(issue => !isDoneCategory(issue?.fields?.status?.statusCategory?.key))
        .map(issue => ({
            key: issue.key,
            summary: String(issue?.fields?.summary || '').trim(),
            assignee: String(issue?.fields?.assignee?.displayName || 'Unassigned').trim(),
            statusName: String(issue?.fields?.status?.name || 'Unknown').trim(),
            statusCategory: String(issue?.fields?.status?.statusCategory?.key || '').trim().toLowerCase(),
            storyPoints: getCurrentStoryPoints(issue, spFieldId),
            url: createIssueUrl(host, issue.key),
        }))
        .sort((left, right) => right.storyPoints - left.storyPoints || left.key.localeCompare(right.key));
}

export function buildBurndownModel({
    sprint,
    issues = [],
    changelogsByIssue = {},
    statusCatalog = [],
    spFieldId = '',
    now = new Date(),
    host = '',
} = {}) {
    const sprintStartMs = toMs(sprint?.startDate);
    const sprintEndMs = toMs(sprint?.completeDate || sprint?.endDate);
    if (!Number.isFinite(sprintStartMs) || !Number.isFinite(sprintEndMs) || sprintEndMs <= sprintStartMs) {
        return null;
    }

    const statusLookup = buildStatusLookup(statusCatalog, issues);
    const nowMs = toMs(now, Date.now());
    const referenceMs = Math.min(
        sprintEndMs,
        sprint?.state === 'future' ? endOfDay(sprintStartMs).getTime() : nowMs,
    );

    const allEvents = [];
    (Array.isArray(issues) ? issues : []).forEach(issue => {
        const issueEvents = buildIssueEvents(
            issue,
            sprint,
            changelogsByIssue?.[issue.key] || [],
            statusLookup,
            spFieldId,
            sprintStartMs,
        );
        allEvents.push(...issueEvents);
    });
    allEvents.sort((left, right) => left.atMs - right.atMs);

    const dayEventMap = new Map();
    allEvents.forEach(event => pushEventIntoDay(dayEventMap, event));

    let runningScope = 0;
    let runningRemaining = 0;
    let runningDone = 0;
    let eventIndex = 0;
    const initialCommitmentReferenceMs = endOfDay(sprintStartMs).getTime();

    while (eventIndex < allEvents.length && allEvents[eventIndex].atMs <= initialCommitmentReferenceMs) {
        const event = allEvents[eventIndex];
        runningScope += event.deltaScope;
        runningRemaining += event.deltaRemaining;
        runningDone += event.deltaDone;
        eventIndex += 1;
    }

    const initialCommitmentSp = Math.max(0, Number(runningScope.toFixed(2)));
    const dayPoints = [];
    let previousRemaining = runningRemaining;
    let previousDone = runningDone;

    const totalSprintDays = Math.max(
        1,
        Math.floor((startOfDay(sprintEndMs).getTime() - startOfDay(sprintStartMs).getTime()) / (1000 * 60 * 60 * 24)) + 1,
    );

    let cursor = startOfDay(sprintStartMs);
    while (cursor.getTime() <= sprintEndMs) {
        const dayStartMs = startOfDay(cursor).getTime();
        const dayEndMs = Math.min(endOfDay(cursor).getTime(), sprintEndMs);
        const snapshotMs = referenceMs < dayStartMs ? null : Math.min(dayEndMs, referenceMs);

        while (snapshotMs != null && eventIndex < allEvents.length && allEvents[eventIndex].atMs <= snapshotMs) {
            const event = allEvents[eventIndex];
            runningScope += event.deltaScope;
            runningRemaining += event.deltaRemaining;
            runningDone += event.deltaDone;
            eventIndex += 1;
        }

        const key = dayKeyFromMs(dayEndMs);
        const fullDayEvents = dayEventMap.get(key)?.events || [];
        const visibleEvents = snapshotMs == null
            ? []
            : fullDayEvents.filter(event => event.atMs <= snapshotMs);
        const dayEvents = summarizeVisibleDayEvents(visibleEvents);
        const elapsedDays = Math.max(
            0,
            Math.round((startOfDay(cursor).getTime() - startOfDay(sprintStartMs).getTime()) / (1000 * 60 * 60 * 24)),
        );
        const idealRemaining = Math.max(0, initialCommitmentSp * (1 - (elapsedDays + 1) / totalSprintDays));
        const actualVisible = snapshotMs != null;
        const remainingSp = actualVisible ? Math.max(0, Number(runningRemaining.toFixed(2))) : null;
        const doneSp = actualVisible ? Math.max(0, Number(runningDone.toFixed(2))) : null;
        const scopeSp = actualVisible ? Math.max(0, Number(runningScope.toFixed(2))) : null;
        const burnedTodaySp = actualVisible && remainingSp != null
            ? Math.max(0, Number((previousRemaining - remainingSp).toFixed(2)))
            : 0;
        const doneTodaySp = actualVisible && doneSp != null
            ? Math.max(0, Number((doneSp - previousDone).toFixed(2)))
            : 0;

        dayPoints.push({
            index: dayPoints.length,
            dayKey: key,
            label: formatDate(new Date(dayEndMs)),
            longLabel: new Date(dayEndMs).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
            }),
            actualVisible,
            remainingSp,
            idealRemainingSp: Number(idealRemaining.toFixed(2)),
            scopeSp,
            doneSp,
            burnedTodaySp,
            doneTodaySp,
            scopeDeltaTodaySp: Number((dayEvents.scopeDeltaTodaySp || 0).toFixed(2)),
            doneTodayCount: dayEvents.doneTodayCount || 0,
            reopenedTodayCount: dayEvents.reopenedTodayCount || 0,
            events: visibleEvents.slice().sort((left, right) => left.atMs - right.atMs),
        });

        previousRemaining = remainingSp ?? previousRemaining;
        previousDone = doneSp ?? previousDone;
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
    }

    const latestVisiblePoint = dayPoints.filter(point => point.actualVisible).slice(-1)[0] || dayPoints[0];
    const currentScopeSp = latestVisiblePoint?.scopeSp ?? 0;
    const remainingSp = latestVisiblePoint?.remainingSp ?? 0;
    const doneSp = latestVisiblePoint?.doneSp ?? 0;
    const idealNowSp = latestVisiblePoint?.idealRemainingSp ?? 0;
    const scopeChangeSp = Number((currentScopeSp - initialCommitmentSp).toFixed(2));
    const completionPct = currentScopeSp > 0
        ? Math.max(0, Math.min(100, Number((((currentScopeSp - remainingSp) / currentScopeSp) * 100).toFixed(1))))
        : 100;
    const paceDeltaSp = Number((remainingSp - idealNowSp).toFixed(2));

    return {
        sprint: {
            id: sprint.id,
            name: sprint.name,
            state: sprint.state,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
            completeDate: sprint.completeDate || '',
        },
        summary: {
            initialCommitmentSp,
            currentScopeSp,
            remainingSp,
            doneSp,
            idealNowSp,
            scopeChangeSp,
            paceDeltaSp,
            completionPct,
            totalIssues: issues.length,
            doneIssues: issues.filter(issue => isDoneCategory(issue?.fields?.status?.statusCategory?.key)).length,
            openIssues: issues.filter(issue => !isDoneCategory(issue?.fields?.status?.statusCategory?.key)).length,
            latestDayKey: latestVisiblePoint?.dayKey || '',
            latestLabel: latestVisiblePoint?.longLabel || '',
        },
        dayPoints,
        statusBreakdown: buildStatusBreakdown(issues, spFieldId, host),
        openIssues: buildOpenIssues(issues, spFieldId, host),
    };
}

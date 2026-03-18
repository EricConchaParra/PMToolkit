import { DEFAULT_HOURS_PER_DAY, DEFAULT_SP_HOURS } from '../constants.js';
import { jiraFetch } from '../jiraApi.js';
import { getPrSnapshots } from '../githubPrSnapshotStore.js';
import { formatDate, formatHours, spToHours, timeSince, truncate, workingHoursElapsed } from '../utils.js';

const FOLLOWUP_META_PREFIX = 'followup_meta_';
const timelineCache = new Map();
const timelinePending = new Map();

export const FOLLOWUP_SIGNAL_META = {
    blocked: { label: 'Blocked', tone: 'danger', priority: 0 },
    'reminder-due': { label: 'Reminder due', tone: 'warning', priority: 1 },
    'needs-pr': { label: 'Needs PR', tone: 'info', priority: 2 },
    'review-waiting': { label: 'Review waiting', tone: 'info', priority: 3 },
    frozen: { label: 'Frozen', tone: 'danger', priority: 4 },
    'capacity-risk': { label: 'Capacity risk', tone: 'warning', priority: 5 },
    'tracked-only': { label: 'Tracked', tone: 'neutral', priority: 6 },
};

export const FOLLOWUP_STATE_META = {
    default: { label: 'No status', tone: 'neutral' },
    watching: { label: 'Watching', tone: 'neutral' },
    waiting: { label: 'Waiting', tone: 'info' },
    blocked: { label: 'Blocked', tone: 'danger' },
    'need-action': { label: 'Need action', tone: 'warning' },
    done: { label: 'Done', tone: 'success' },
};

export function resolveIssueSection(issue, statusMap = {}) {
    return resolveStatusSection(
        issue.fields?.status?.name || '',
        statusMap,
        issue.fields?.status?.statusCategory?.key || '',
    );
}

export function resolveStatusSection(statusName = '', statusMap = {}, categoryKey = '') {
    if (statusMap[statusName]) return statusMap[statusName];

    const normalized = String(statusName || '').toLowerCase();
    if (normalized.includes('blocked') || normalized.includes('hold')) return 'blocked';
    if (normalized.includes('in review') || normalized === 'review') return 'inReview';
    if (normalized.includes('in progress') || categoryKey === 'indeterminate') return 'inProgress';
    if (normalized.includes('qa') || normalized.includes('test')) return 'qa';
    if (categoryKey === 'done' || normalized === 'done') return 'done';
    return 'todo';
}

export function getFollowupMetaStorageKey(issueKey) {
    return issueKey.includes(':') ? `${FOLLOWUP_META_PREFIX}${issueKey}` : `${FOLLOWUP_META_PREFIX}jira:${issueKey}`;
}

export function normalizeFollowupMeta(raw = {}) {
    const state = Object.prototype.hasOwnProperty.call(FOLLOWUP_STATE_META, raw?.state) ? raw.state : 'default';
    const updatedAt = Number(raw?.updatedAt) || 0;

    return {
        state,
        pinned: raw?.pinned === true,
        updatedAt,
    };
}

export function parseFollowupMetaStorage(items = {}) {
    const followupMetaMap = {};

    Object.entries(items).forEach(([key, value]) => {
        if (!key.startsWith(`${FOLLOWUP_META_PREFIX}jira:`)) return;
        const issueKey = key.replace(`${FOLLOWUP_META_PREFIX}jira:`, '');
        followupMetaMap[issueKey] = normalizeFollowupMeta(value);
    });

    return followupMetaMap;
}

export function clearFollowupSessionCaches() {
    timelineCache.clear();
    timelinePending.clear();
}

export async function fetchIssueTimeline(host, issueKey) {
    if (timelineCache.has(issueKey)) return timelineCache.get(issueKey);
    if (timelinePending.has(issueKey)) return timelinePending.get(issueKey);

    const request = jiraFetch(host, `/rest/api/3/issue/${issueKey}/changelog?maxResults=100`).then(data => {
        const statusChanges = (data.values || []).flatMap(history => {
            const changes = (history.items || []).filter(item => item.field === 'status');
            return changes.map(item => ({
                created: history.created,
                from: item.fromString || '',
                to: item.toString || '',
            }));
        }).sort((a, b) => new Date(a.created) - new Date(b.created));

        const result = {
            issueKey,
            statusChanges,
            lastStatusChangeAt: statusChanges.length ? statusChanges[statusChanges.length - 1].created : null,
        };
        timelineCache.set(issueKey, result);
        timelinePending.delete(issueKey);
        return result;
    }).catch(() => {
        const fallback = {
            issueKey,
            statusChanges: [],
            lastStatusChangeAt: null,
        };
        timelineCache.set(issueKey, fallback);
        timelinePending.delete(issueKey);
        return fallback;
    });

    timelinePending.set(issueKey, request);
    return request;
}

export async function resolvePrSnapshots(ticketKeys, token) {
    return getPrSnapshots(ticketKeys, token);
}

export function buildFollowupItems({
    issues = [],
    timelinesByKey = {},
    prSnapshotsByKey = {},
    notesMap = {},
    remindersMap = {},
    tagsMap = {},
    followupMetaMap = {},
    settings = {},
    sprintHoursLeft = null,
    now = Date.now(),
    prSignalsEnabled = true,
} = {}) {
    const hoursPerDay = settings.hoursPerDay || DEFAULT_HOURS_PER_DAY;
    const spHours = { ...DEFAULT_SP_HOURS, ...(settings.spHours || {}) };
    const statusMap = settings.statusMap || {};
    const nowDate = new Date(now);
    const engineerMap = buildEngineerMap(issues, statusMap, spHours, sprintHoursLeft);

    const items = issues.map(issue => {
        const issueKey = issue.key;
        const section = resolveIssueSection(issue, statusMap);
        const timeline = buildIssueTimeline(issue, timelinesByKey[issueKey], statusMap);
        const trackingMeta = normalizeFollowupMeta(followupMetaMap[issueKey]);
        const noteText = String(notesMap[issueKey] || '');
        const reminderTs = remindersMap[issueKey] || null;
        const tags = tagsMap[issueKey] || [];
        const pr = prSnapshotsByKey[issueKey] || null;
        const engineer = engineerMap[getAssigneeId(issue)];
        const statusAgeHours = timeline.currentStatusSince
            ? workingHoursElapsed(timeline.currentStatusSince, hoursPerDay, nowDate)
            : 0;
        const statusIdleHours = timeline.lastStatusChangeAt
            ? workingHoursElapsed(timeline.lastStatusChangeAt, hoursPerDay, nowDate)
            : issue.fields?.updated
                ? workingHoursElapsed(issue.fields.updated, hoursPerDay, nowDate)
                : 0;
        const prIdleHours = pr?.updatedAt ? workingHoursElapsed(pr.updatedAt, hoursPerDay, nowDate) : Infinity;
        const freezeThreshold = Math.max(spToHours(issue._sp || 0, spHours), 8);
        const signals = [];

        if (trackingMeta.state === 'blocked' || section === 'blocked') signals.push('blocked');
        if (reminderTs && reminderTs <= now + (4 * 60 * 60 * 1000)) signals.push('reminder-due');
        if (prSignalsEnabled && (section === 'inProgress' || section === 'inReview') && !pr && statusAgeHours >= 4) signals.push('needs-pr');
        if (prSignalsEnabled && section === 'inReview' && pr && (pr.state === 'open' || pr.draft) && prIdleHours >= 12) signals.push('review-waiting');
        if (
            ['inProgress', 'inReview', 'qa', 'blocked'].includes(section)
            && statusIdleHours >= freezeThreshold
            && (!prSignalsEnabled || !pr || prIdleHours >= freezeThreshold)
        ) {
            signals.push('frozen');
        }
        if (engineer?.capacityPct >= 100 && section !== 'done') signals.push('capacity-risk');

        const isTracked = Boolean(
            noteText.trim()
            || reminderTs
            || tags.length
            || trackingMeta.state !== 'default'
            || trackingMeta.pinned,
        );
        if (!signals.length && isTracked) signals.push('tracked-only');

        const primarySignal = selectPrimarySignal(signals);
        const secondarySignals = signals.filter(signal => signal !== primarySignal);
        const actionable = signals.length > 0;
        const reasonLines = signals.map(signal => describeSignal(signal, {
            issue,
            pr,
            reminderTs,
            trackingMeta,
            timeline,
            section,
            engineer,
            now,
            statusAgeHours,
            statusIdleHours,
            prIdleHours,
        }));

        return {
            key: issueKey,
            actionable,
            jira: {
                key: issueKey,
                summary: issue.fields?.summary || '',
                statusName: issue.fields?.status?.name || '',
                section,
                assignee: issue.fields?.assignee || null,
                assigneeId: getAssigneeId(issue),
                updatedAt: issue.fields?.updated || null,
                sp: Number(issue._sp || 0),
                url: issue._url || '',
            },
            timeline: {
                ...timeline,
                statusAgeHours,
                statusIdleHours,
                freezeThreshold,
            },
            pr,
            tracking: {
                noteText,
                notePreview: truncate(noteText, 180),
                reminderTs,
                tags,
                state: trackingMeta.state,
                pinned: trackingMeta.pinned,
                updatedAt: trackingMeta.updatedAt,
            },
            engineer,
            signals,
            primarySignal,
            secondarySignals,
            reasonLines,
            reason: primarySignal ? describeSignal(primarySignal, {
                issue,
                pr,
                reminderTs,
                trackingMeta,
                timeline,
                section,
                engineer,
                now,
                statusAgeHours,
                statusIdleHours,
                prIdleHours,
            }) : '',
            sortRank: {
                pinned: trackingMeta.pinned ? 0 : 1,
                priority: primarySignal ? FOLLOWUP_SIGNAL_META[primarySignal].priority : 99,
                age: getSignalAge(primarySignal, {
                    now,
                    reminderTs,
                    statusAgeHours,
                    statusIdleHours,
                    prIdleHours,
                    trackingMeta,
                }),
            },
        };
    });

    return items.sort(compareFollowupItems);
}

function buildEngineerMap(issues, statusMap, spHours, sprintHoursLeft) {
    const map = {};

    issues.forEach(issue => {
        const section = resolveIssueSection(issue, statusMap);
        if (section === 'done' || section === 'qa') return;

        const assigneeId = getAssigneeId(issue);
        if (!map[assigneeId]) {
            map[assigneeId] = {
                assignee: issue.fields?.assignee || null,
                committedHours: 0,
                ticketsLeft: 0,
                spLeft: 0,
                capacityPct: 0,
            };
        }

        map[assigneeId].committedHours += spToHours(issue._sp || 0, spHours);
        map[assigneeId].ticketsLeft += 1;
        map[assigneeId].spLeft += Number(issue._sp || 0);
    });

    Object.values(map).forEach(engineer => {
        if (sprintHoursLeft !== null && sprintHoursLeft > 0) {
            engineer.capacityPct = Math.round((engineer.committedHours / sprintHoursLeft) * 100);
        } else if (engineer.committedHours > 0) {
            engineer.capacityPct = 150;
        }
    });

    return map;
}

function buildIssueTimeline(issue, rawTimeline = {}, statusMap = {}) {
    const statusChanges = Array.isArray(rawTimeline.statusChanges) ? rawTimeline.statusChanges : [];
    const currentStatusName = issue.fields?.status?.name || '';
    const currentStatusSince = [...statusChanges].reverse().find(change => change.to === currentStatusName)?.created
        || issue.fields?.updated
        || null;
    const inProgressSince = [...statusChanges].reverse().find(change =>
        resolveStatusSection(change.to, statusMap) === 'inProgress'
    )?.created || (resolveIssueSection(issue, statusMap) === 'inProgress' ? currentStatusSince : null);

    return {
        statusChanges,
        inProgressSince,
        currentStatusSince,
        lastStatusChangeAt: rawTimeline.lastStatusChangeAt || issue.fields?.updated || null,
    };
}

function selectPrimarySignal(signals = []) {
    if (!signals.length) return null;

    return signals.slice().sort((left, right) =>
        FOLLOWUP_SIGNAL_META[left].priority - FOLLOWUP_SIGNAL_META[right].priority
    )[0];
}

function compareFollowupItems(left, right) {
    if (left.sortRank.pinned !== right.sortRank.pinned) {
        return left.sortRank.pinned - right.sortRank.pinned;
    }

    if (left.sortRank.priority !== right.sortRank.priority) {
        return left.sortRank.priority - right.sortRank.priority;
    }

    if (left.sortRank.age !== right.sortRank.age) {
        return right.sortRank.age - left.sortRank.age;
    }

    return left.key.localeCompare(right.key);
}

function describeSignal(signal, context) {
    const {
        issue,
        pr,
        reminderTs,
        trackingMeta,
        timeline,
        section,
        engineer,
        now,
        statusAgeHours,
        statusIdleHours,
        prIdleHours,
    } = context;
    const effectivePrIdleHours = Number.isFinite(prIdleHours) ? prIdleHours : statusIdleHours;

    if (signal === 'blocked') {
        if (trackingMeta.state === 'blocked' && section === 'blocked') {
            return 'Blocked in Jira and flagged as blocked for follow-up';
        }
        if (trackingMeta.state === 'blocked') return 'Flagged as blocked for follow-up';
        return 'Jira status is blocked';
    }

    if (signal === 'reminder-due') {
        if (!reminderTs) return 'Reminder needs attention';
        if (reminderTs <= now) return `Reminder overdue by ${timeSince(reminderTs)}`;
        return `Reminder due in ${formatMs(reminderTs - now)}`;
    }

    if (signal === 'needs-pr') {
        return `No PR after ${formatHours(statusAgeHours || 0)} in ${issue.fields?.status?.name || 'current status'}`;
    }

    if (signal === 'review-waiting') {
        const reviewState = pr?.lastReviewState ? ` · last review ${humanizeReviewState(pr.lastReviewState)}` : '';
        return `PR idle for ${formatHours(prIdleHours || 0)} while ticket stays In Review${reviewState}`;
    }

    if (signal === 'frozen') {
        if (!pr) return `No Jira status change for ${formatHours(statusIdleHours || 0)}`;
        return `No Jira status change or PR activity for ${formatHours(Math.max(statusIdleHours || 0, effectivePrIdleHours || 0))}`;
    }

    if (signal === 'capacity-risk') {
        return `${issue.fields?.assignee?.displayName || 'Unassigned'} is at ${engineer?.capacityPct || 0}% sprint capacity`;
    }

    if (signal === 'tracked-only') {
        if (trackingMeta.pinned) return 'Pinned for manual follow-up';
        if (reminderTs) return `Tracked with reminder on ${formatDate(new Date(reminderTs))}`;
        if (timeline.currentStatusSince) return `Tracked ticket in ${issue.fields?.status?.name || 'current status'}`;
        return 'Tracked with notes or tags';
    }

    return '';
}

function getSignalAge(signal, context) {
    const { now, reminderTs, statusAgeHours, statusIdleHours, prIdleHours, trackingMeta } = context;
    const effectivePrIdleHours = Number.isFinite(prIdleHours) ? prIdleHours : statusIdleHours;

    if (signal === 'reminder-due' && reminderTs) {
        return reminderTs <= now ? (now - reminderTs) / (1000 * 60 * 60) : 0;
    }
    if (signal === 'needs-pr') return statusAgeHours || 0;
    if (signal === 'review-waiting') return prIdleHours || 0;
    if (signal === 'frozen') return Math.max(statusIdleHours || 0, effectivePrIdleHours || 0);
    if (signal === 'capacity-risk') return statusIdleHours || 0;
    if (signal === 'blocked') return statusIdleHours || 0;
    if (signal === 'tracked-only') return trackingMeta.updatedAt ? ((now - trackingMeta.updatedAt) / (1000 * 60 * 60)) : 0;
    return 0;
}

function getAssigneeId(issue) {
    return issue.fields?.assignee?.accountId || 'unassigned';
}

function formatMs(ms) {
    if (ms <= 0) return '0m';
    const hours = ms / (1000 * 60 * 60);
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    return `${Math.floor(hours / 24)}d`;
}

function humanizeReviewState(state) {
    return String(state || '')
        .toLowerCase()
        .replace(/_/g, ' ');
}

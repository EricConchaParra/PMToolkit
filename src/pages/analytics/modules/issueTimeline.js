import { jiraFetch } from './jiraApi.js';

const timelineCache = new Map();
const timelinePending = new Map();

export function clearIssueTimelineCache() {
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
                changedBy: history.author?.displayName || history.author?.name || '',
                from: item.fromString || '',
                fromId: item.from || '',
                to: item.toString || '',
                toId: item.to || '',
            }));
        }).sort((left, right) => new Date(left.created) - new Date(right.created));

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

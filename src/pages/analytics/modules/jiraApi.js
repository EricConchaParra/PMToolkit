/**
 * PMsToolKit — Analytics Hub
 * All Jira and GitHub API fetch helpers
 */

import {
    getCachedBoardId,
    getCachedBoardConfig,
    getCachedProjectStatuses,
    getCachedProjects,
    getCachedSpFieldId,
    getCachedSprintFieldId,
} from './analyticsDataCache.js';

// ============================================================
// JIRA HOST
// ============================================================

export function getJiraHost() {
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get(['et_jira_host'], result => {
                resolve(result.et_jira_host || null);
            });
        } else {
            resolve(null);
        }
    });
}

// ============================================================
// API HELPERS
// ============================================================

export async function jiraFetch(host, path, opts = {}) {
    const url = path.startsWith('http') ? path : `https://${host}${path}`;
    const resp = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', ...opts.headers },
        method: opts.method || 'GET',
        body: opts.body || undefined,
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Jira API ${resp.status}: ${t.slice(0, 200)}`);
    }
    return resp.json();
}

// GitHub API helper
export async function githubFetch(path, token) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const resp = await fetch(url, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '');
        const error = new Error(`GitHub API ${resp.status}`);
        error.status = resp.status;
        error.responseText = bodyText;
        error.headers = {
            reset: resp.headers.get('x-ratelimit-reset'),
            remaining: resp.headers.get('x-ratelimit-remaining'),
            limit: resp.headers.get('x-ratelimit-limit'),
            retryAfter: resp.headers.get('retry-after'),
        };
        throw error;
    }
    return resp.json();
}

/**
 * Search for a PR by ticket ID.
 * @returns {{ url: string, state: string, draft: boolean, labels: string[] } | null}
 */
export async function findPrForTicket(ticketId, token) {
    try {
        const data = await githubFetch(`/search/issues?q=${encodeURIComponent(ticketId)}+type:pr&per_page=5`, token);
        const pr = (data.items || []).find(item =>
            (item.title || '').toLowerCase().includes(ticketId.toLowerCase()) ||
            (item.body || '').toLowerCase().includes(ticketId.toLowerCase()) ||
            (item.head?.ref || '').toLowerCase().includes(ticketId.toLowerCase())
        );
        if (!pr) return null;
        return {
            url:    pr.html_url,
            state:  pr.state || 'open',
            draft:  pr.draft || false,
            labels: (pr.labels || []).map(l => l.name).filter(Boolean),
        };
    } catch {
        return null;
    }
}

export async function fetchProjects(host) {
    return getCachedProjects(host, async () => {
        let all = [];
        let startAt = 0;
        while (true) {
            const data = await jiraFetch(host, `/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=name`);
            all = all.concat(data.values || []);
            if (data.isLast || (data.values || []).length === 0) break;
            startAt += data.values.length;
        }
        return all;
    });
}

export async function fetchBoardId(host, projectKey) {
    return getCachedBoardId(host, projectKey, async () => {
        const data = await jiraFetch(host, `/rest/agile/1.0/board?projectKeyOrId=${projectKey}&type=scrum&maxResults=1`);
        return data.values?.[0]?.id || null;
    });
}

export async function fetchActiveSprint(host, boardId) {
    const data = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=1`);
    return data.values?.[0] || null;
}

export async function fetchBoardConfiguration(host, boardId) {
    return getCachedBoardConfig(host, boardId, async () =>
        jiraFetch(host, `/rest/agile/1.0/board/${boardId}/configuration`)
    );
}

export async function fetchSprintIssues(host, sprintId, spFieldId, extraFields = []) {
    const fields = ['summary', 'status', 'assignee', 'updated', spFieldId, ...extraFields].filter(Boolean);
    let all = [];
    let nextPageToken;
    while (true) {
        const body = {
            jql: `sprint = ${sprintId} AND issuetype not in (Epic, subtask)`,
            fields,
            maxResults: 100,
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;
        const data = await jiraFetch(host, '/rest/api/3/search/jql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
            body: JSON.stringify(body),
        });
        all = all.concat(data.issues || []);
        if (!data.nextPageToken || (data.issues || []).length === 0) break;
        nextPageToken = data.nextPageToken;
    }
    return all;
}

export async function fetchIssueInProgressSince(host, issueKey) {
    // Returns ISO string of when issue entered first "In Progress"-category status (most recent)
    const data = await jiraFetch(host, `/rest/api/3/issue/${issueKey}/changelog?maxResults=100`);
    const histories = (data.values || []).reverse(); // newest first
    for (const h of histories) {
        for (const item of (h.items || [])) {
            if (item.field === 'status') {
                const toStatus = (item.toString || '').toLowerCase();
                if (toStatus.includes('progress') || toStatus === 'in progress') {
                    return h.created;
                }
            }
        }
    }
    return null;
}

export async function fetchIssueChangelog(host, issueKey) {
    let all = [];
    let startAt = 0;

    while (true) {
        const data = await jiraFetch(host, `/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=100`);
        const values = data.values || [];
        all = all.concat(values);
        if (all.length >= (data.total || 0) || values.length === 0) break;
        startAt += values.length;
    }

    return all;
}

export async function fetchClosedSprints(host, boardId, count = 3) {
    const data = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=50`);
    const all = data.values || [];
    return all.slice(-count); // take last N
}

export async function fetchBoardSprints(host, boardId, states = ['active', 'closed']) {
    const stateParam = Array.isArray(states) ? states.filter(Boolean).join(',') : String(states || '');
    let all = [];
    let startAt = 0;

    while (true) {
        const suffix = stateParam ? `?state=${encodeURIComponent(stateParam)}&startAt=${startAt}&maxResults=50` : `?startAt=${startAt}&maxResults=50`;
        const data = await jiraFetch(host, `/rest/agile/1.0/board/${boardId}/sprint${suffix}`);
        const values = data.values || [];
        all = all.concat(values);
        if (data.isLast || values.length === 0) break;
        startAt += values.length;
    }

    return all;
}

export async function fetchSprintDoneIssues(host, sprintId, spFieldId) {
    const fields = [spFieldId, 'assignee'].filter(Boolean);
    let all = [];
    let nextPageToken;

    while (true) {
        const body = {
            jql: `sprint = ${sprintId} AND statusCategory = Done AND issuetype not in (Epic, subtask)`,
            fields,
            maxResults: 100,
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;

        const data = await jiraFetch(host, '/rest/api/3/search/jql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
            body: JSON.stringify(body),
        });

        all = all.concat(data.issues || []);
        if (!data.nextPageToken || (data.issues || []).length === 0) break;
        nextPageToken = data.nextPageToken;
    }

    return all;
}

export async function fetchSpFieldId(host) {
    return getCachedSpFieldId(host, async () => {
        const fields = await jiraFetch(host, '/rest/api/3/field');
        const spField = fields.find(f => f.name === 'Story Points' || f.name === 'Story points');
        return spField?.id || null;
    });
}

export async function fetchSprintFieldId(host) {
    return getCachedSprintFieldId(host, async () => {
        const fields = await jiraFetch(host, '/rest/api/3/field');
        const sprintField = fields.find(field =>
            field.name === 'Sprint'
            || field.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint'
        );
        return sprintField?.id || null;
    });
}

// Returns a deduplicated list of { name, categoryKey } for a project
export async function fetchProjectStatuses(host, projectKey) {
    return getCachedProjectStatuses(host, projectKey, async () => {
        const data = await jiraFetch(host, `/rest/api/3/project/${projectKey}/statuses`);
        const seen = new Set();
        const result = [];
        for (const issueType of (data || [])) {
            for (const s of (issueType.statuses || [])) {
                if (!seen.has(s.name)) {
                    seen.add(s.name);
                    result.push({ name: s.name, categoryKey: s.statusCategory?.key || '' });
                }
            }
        }
        return result;
    });
}

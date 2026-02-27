/**
 * Utility for Jira REST API interactions.
 */

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export const jiraApi = {
    getHost() {
        return localStorage.getItem('et_jira_host') || window.location.hostname || 'jira.atlassian.net';
    },

    async fetchIssueDetails(issueKey) {
        const host = this.getHost();
        const id = issueKey.split(':').pop();

        try {
            const resp = await fetch(
                `https://${host}/rest/api/2/issue/${id}?fields=summary,assignee,status`,
                { credentials: 'include' }
            );
            if (!resp.ok) return null;
            const data = await resp.json();
            return {
                summary: data.fields?.summary || '',
                assignee: data.fields?.assignee?.displayName || 'Unassigned',
                status: {
                    name: data.fields?.status?.name || 'Unknown',
                    category: data.fields?.status?.statusCategory?.key || 'new'
                }
            };
        } catch (e) {
            console.error('PMsToolKit: API fetch error', e);
            return null;
        }
    },

    async getBoardIdForProject(projectKey) {
        try {
            const res = await fetch(
                `${window.location.origin}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum&maxResults=1`,
                { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }
            );
            if (!res.ok) return null;
            const data = await res.json();
            return data.values?.[0]?.id || null;
        } catch (e) {
            console.error('PMsToolKit: Board fetch error', e);
            return null;
        }
    },

    async getLastClosedSprints(boardId, count = 3) {
        try {
            const res = await fetch(
                `${window.location.origin}/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=50`,
                { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }
            );
            if (!res.ok) return [];
            const data = await res.json();
            return (data.values || []).slice(-count);
        } catch (e) {
            console.error('PMsToolKit: Sprints fetch error', e);
            return [];
        }
    }
};

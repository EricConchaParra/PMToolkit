import { etEnqueue } from './utils';

const STATUS_CACHE = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const jiraClient = {
    async getLastStatusChangeDate(issueKey) {
        if (STATUS_CACHE[issueKey] && (Date.now() - STATUS_CACHE[issueKey].fetchedAt < CACHE_TTL)) {
            return STATUS_CACHE[issueKey];
        }

        return etEnqueue(async () => {
            try {
                // First call: get current status and creation date
                const basicRes = await fetch(`${window.location.origin}/rest/api/3/issue/${issueKey}?fields=status,created`, {
                    headers: { 'Accept': 'application/json' }
                });
                if (!basicRes.ok) return null;
                const basicData = await basicRes.json();

                const currentStatus = basicData.fields.status.name;
                const createdDate = basicData.fields.created;

                // Second call: get changelog for status transitions
                const changelogRes = await fetch(`${window.location.origin}/rest/api/3/issue/${issueKey}/changelog`, {
                    headers: { 'Accept': 'application/json' }
                });

                let changedDate = createdDate;
                let changedBy = null;

                if (changelogRes.ok) {
                    const changelogData = await changelogRes.json();
                    const histories = changelogData.values || [];
                    // Find the most recent status change
                    const statusChanges = histories
                        .filter(h => h.items.some(item => item.field === 'status'))
                        .sort((a, b) => new Date(b.created) - new Date(a.created));

                    if (statusChanges.length > 0) {
                        changedDate = statusChanges[0].created;
                        changedBy = statusChanges[0].author.displayName;
                    }
                }

                const result = {
                    issueKey,
                    statusName: currentStatus,
                    changedDate,
                    changedBy,
                    fetchedAt: Date.now()
                };

                STATUS_CACHE[issueKey] = result;
                return result;
            } catch (e) {
                console.error(`PMsToolKit: Error getting status for ${issueKey}`, e);
                return null;
            }
        });
    }
};

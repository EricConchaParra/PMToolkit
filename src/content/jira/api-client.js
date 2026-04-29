import { etEnqueue, etEnsureCustomFields, etParseSprintData, invokeBackgroundFetch } from './utils';

const STATUS_CACHE = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const jiraClient = {
    async getLastStatusChangeDate(issueKey) {
        if (STATUS_CACHE[issueKey] && (Date.now() - STATUS_CACHE[issueKey].fetchedAt < CACHE_TTL)) {
            return STATUS_CACHE[issueKey];
        }

        return etEnqueue(async () => {
            try {
                // 1. Get current status, creation date AND sprint info
                const { sprint: sprintFieldId } = await etEnsureCustomFields();
                const fields = ['status', 'created'];
                if (sprintFieldId) fields.push(sprintFieldId);

                const basicRes = await invokeBackgroundFetch(`/rest/api/3/issue/${issueKey}?fields=${fields.join(',')}`, {
                    headers: { 'Accept': 'application/json' }
                });
                if (!basicRes.ok) return null;
                const issueData = await basicRes.json();

                const statusObj = issueData.fields.status;
                const currentStatus = statusObj.name;
                const statusCategory = statusObj.statusCategory?.key || statusObj.statusCategory?.name || '';
                const createdDate = issueData.fields.created;

                let sprintStartDate = null;
                if (sprintFieldId) {
                    sprintStartDate = etParseSprintData(issueData.fields[sprintFieldId]);
                }

                // 2. Get changelog for status transitions
                const changelogRes = await invokeBackgroundFetch(`/rest/api/3/issue/${issueKey}/changelog`, {
                    headers: { 'Accept': 'application/json' }
                });

                let lastStatusChange = null;
                let lastStatusAuthor = null;

                if (changelogRes.ok) {
                    const changelogData = await changelogRes.json();
                    const histories = changelogData.values || [];

                    // Jira returns oldest first. We want the YOUNGEST change to status.
                    for (let i = histories.length - 1; i >= 0; i--) {
                        const h = histories[i];
                        if (h.items.some(item => item.field === 'status')) {
                            lastStatusChange = h.created;
                            lastStatusAuthor = h.author?.displayName;
                            break;
                        }
                    }
                }

                let changedDate = lastStatusChange || createdDate;

                // "To Do" logic: Compare with sprint start
                const statusLower = currentStatus.toLowerCase();
                const categoryLower = statusCategory.toLowerCase();
                const isToDo = (categoryLower === 'new' || categoryLower === 'todo' || statusLower === 'to do' || statusLower === 'todo');

                if (isToDo && sprintStartDate) {
                    const sprintDateParsed = new Date(sprintStartDate);
                    const historyDateParsed = new Date(changedDate);
                    if (sprintDateParsed > historyDateParsed) {
                        changedDate = sprintStartDate;
                    }
                }

                const result = {
                    issueKey,
                    statusName: currentStatus,
                    changedDate,
                    changedBy: lastStatusAuthor,
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

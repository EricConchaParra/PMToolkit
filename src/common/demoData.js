export const DEMO_HOST = 'demo.pmtoolkit.invalid';
export const DEMO_SP_FIELD_ID = 'customfield_10016';
export const DEMO_SPRINT_FIELD_ID = 'customfield_10020';

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function svgIcon(bg, label) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect rx="8" width="32" height="32" fill="${bg}"/><text x="16" y="21" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#fff">${label}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function assignee(accountId, displayName) {
    return {
        accountId,
        displayName,
        avatarUrls: {},
    };
}

const ISSUE_TYPES = {
    story: {
        name: 'Story',
        iconUrl: svgIcon('#0052cc', 'S'),
    },
    task: {
        name: 'Task',
        iconUrl: svgIcon('#36b37e', 'T'),
    },
    bug: {
        name: 'Bug',
        iconUrl: svgIcon('#de350b', 'B'),
    },
};

const DEMO_STATUS_CATALOG = [
    { id: 'todo', name: 'To Do', categoryKey: 'new' },
    { id: 'progress', name: 'In Progress', categoryKey: 'indeterminate' },
    { id: 'review', name: 'In Review', categoryKey: 'indeterminate' },
    { id: 'done', name: 'Done', categoryKey: 'done' },
];

function status(statusId) {
    const found = DEMO_STATUS_CATALOG.find(item => item.id === statusId) || DEMO_STATUS_CATALOG[0];
    return {
        id: found.id,
        name: found.name,
        statusCategory: { key: found.categoryKey },
    };
}

function sprintRef(id, name, state) {
    return { id, name, state };
}

function makeIssue({
    key,
    summary,
    assignee: issueAssignee,
    statusId,
    sp,
    updated,
    type = 'task',
    sprintRefs = [],
}) {
    return {
        key,
        fields: {
            summary,
            assignee: issueAssignee,
            status: status(statusId),
            issuetype: ISSUE_TYPES[type],
            updated,
            [DEMO_SP_FIELD_ID]: sp,
            [DEMO_SPRINT_FIELD_ID]: sprintRefs,
        },
    };
}

const people = {
    ada: assignee('demo-ada', 'Ada Lovelace'),
    maya: assignee('demo-maya', 'Maya Chen'),
    theo: assignee('demo-theo', 'Theo Park'),
};

const baseTrackingItems = {
    tag_defs_jira: {
        launch: { label: 'Launch', color: 'orange' },
        risk: { label: 'Risk', color: 'red' },
        unblock: { label: 'Unblock', color: 'blue' },
        exec: { label: 'Exec', color: 'black' },
        polish: { label: 'Polish', color: 'green' },
    },
    'notes_jira:OPS-142': 'Launch copy approved. Keep this card ready for the hero screenshot.',
    'tags_jira:OPS-142': ['Launch', 'Exec'],
    'reminder_jira:OPS-142': Date.parse('2026-04-22T14:30:00.000Z'),
    'meta_jira:OPS-142': {
        summary: 'Finalize launch checklist and screenshots',
        assignee: 'Ada Lovelace',
        status: { name: 'In Review', category: 'indeterminate' },
        issueType: ISSUE_TYPES.task,
    },
    'notes_jira:OPS-147': 'Waiting on pricing copy. Good example of a tracked blocker.',
    'tags_jira:OPS-147': ['Risk', 'Unblock'],
    'meta_jira:OPS-147': {
        summary: 'Resolve pricing edge cases for onboarding',
        assignee: 'Maya Chen',
        status: { name: 'In Progress', category: 'indeterminate' },
        issueType: ISSUE_TYPES.story,
    },
    'notes_jira:PLN-88': 'Use this one for a cleaner popup state with fewer tags.',
    'tags_jira:PLN-88': ['Polish'],
    'reminder_jira:PLN-88': Date.parse('2026-04-24T16:00:00.000Z'),
    'meta_jira:PLN-88': {
        summary: 'Polish handoff notes for roadmap review',
        assignee: 'Theo Park',
        status: { name: 'To Do', category: 'new' },
        issueType: ISSUE_TYPES.task,
    },
};

const demoProjects = [
    { key: 'OPS', name: 'Ops Command Center' },
    { key: 'PLN', name: 'Planning Studio' },
];

const demoBoards = {
    OPS: {
        id: 9001,
        config: {
            columnConfig: {
                columns: [
                    { id: 'demo-col-todo', name: 'To Do', statuses: [{ id: 'todo', name: 'To Do' }] },
                    { id: 'demo-col-progress', name: 'In Progress', statuses: [{ id: 'progress', name: 'In Progress' }] },
                    { id: 'demo-col-review', name: 'In Review', statuses: [{ id: 'review', name: 'In Review' }] },
                    { id: 'demo-col-done', name: 'Done', statuses: [{ id: 'done', name: 'Done' }] },
                ],
            },
        },
    },
    PLN: {
        id: 9002,
        config: {
            columnConfig: {
                columns: [
                    { id: 'demo-col-todo', name: 'To Do', statuses: [{ id: 'todo', name: 'To Do' }] },
                    { id: 'demo-col-progress', name: 'In Progress', statuses: [{ id: 'progress', name: 'In Progress' }] },
                    { id: 'demo-col-review', name: 'In Review', statuses: [{ id: 'review', name: 'In Review' }] },
                    { id: 'demo-col-done', name: 'Done', statuses: [{ id: 'done', name: 'Done' }] },
                ],
            },
        },
    },
};

const demoSprintsByProject = {
    OPS: [
        { id: 201, name: 'OPS Sprint 24', state: 'closed', startDate: '2026-03-31T13:00:00.000Z', endDate: '2026-04-11T21:00:00.000Z', completeDate: '2026-04-11T20:15:00.000Z' },
        { id: 202, name: 'OPS Sprint 25', state: 'active', startDate: '2026-04-14T13:00:00.000Z', endDate: '2026-04-25T21:00:00.000Z' },
        { id: 203, name: 'OPS Sprint 26', state: 'future', startDate: '2026-04-28T13:00:00.000Z', endDate: '2026-05-09T21:00:00.000Z' },
        { id: 196, name: 'OPS Sprint 19', state: 'closed', startDate: '2026-01-20T13:00:00.000Z', endDate: '2026-01-31T21:00:00.000Z', completeDate: '2026-01-31T20:20:00.000Z' },
        { id: 197, name: 'OPS Sprint 20', state: 'closed', startDate: '2026-02-03T13:00:00.000Z', endDate: '2026-02-14T21:00:00.000Z', completeDate: '2026-02-14T20:20:00.000Z' },
        { id: 198, name: 'OPS Sprint 21', state: 'closed', startDate: '2026-02-17T13:00:00.000Z', endDate: '2026-02-28T21:00:00.000Z', completeDate: '2026-02-28T20:20:00.000Z' },
        { id: 199, name: 'OPS Sprint 22', state: 'closed', startDate: '2026-03-03T13:00:00.000Z', endDate: '2026-03-14T21:00:00.000Z', completeDate: '2026-03-14T20:20:00.000Z' },
        { id: 200, name: 'OPS Sprint 23', state: 'closed', startDate: '2026-03-17T13:00:00.000Z', endDate: '2026-03-28T21:00:00.000Z', completeDate: '2026-03-28T20:20:00.000Z' },
    ],
    PLN: [
        { id: 301, name: 'PLN Sprint 8', state: 'closed', startDate: '2026-04-01T13:00:00.000Z', endDate: '2026-04-12T21:00:00.000Z', completeDate: '2026-04-12T20:10:00.000Z' },
        { id: 302, name: 'PLN Sprint 9', state: 'active', startDate: '2026-04-15T13:00:00.000Z', endDate: '2026-04-26T21:00:00.000Z' },
        { id: 300, name: 'PLN Sprint 7', state: 'closed', startDate: '2026-03-18T13:00:00.000Z', endDate: '2026-03-29T21:00:00.000Z', completeDate: '2026-03-29T20:10:00.000Z' },
    ],
};

const opsSprint24 = sprintRef(201, 'OPS Sprint 24', 'closed');
const opsSprint25 = sprintRef(202, 'OPS Sprint 25', 'active');
const opsSprint26 = sprintRef(203, 'OPS Sprint 26', 'future');
const plnSprint8 = sprintRef(301, 'PLN Sprint 8', 'closed');
const plnSprint9 = sprintRef(302, 'PLN Sprint 9', 'active');

const demoIssuesBySprint = {
    202: [
        makeIssue({ key: 'OPS-142', summary: 'Finalize launch checklist and screenshots', assignee: people.ada, statusId: 'review', sp: 5, updated: '2026-04-18T17:10:00.000Z', type: 'task', sprintRefs: [opsSprint25] }),
        makeIssue({ key: 'OPS-147', summary: 'Resolve pricing edge cases for onboarding', assignee: people.maya, statusId: 'progress', sp: 8, updated: '2026-04-19T12:40:00.000Z', type: 'story', sprintRefs: [opsSprint25] }),
        makeIssue({ key: 'OPS-153', summary: 'Ship polished workspace empty states', assignee: people.theo, statusId: 'todo', sp: 3, updated: '2026-04-17T15:15:00.000Z', type: 'task', sprintRefs: [opsSprint25] }),
        makeIssue({ key: 'OPS-155', summary: 'Backfill support macros for launch week', assignee: people.maya, statusId: 'done', sp: 2, updated: '2026-04-18T09:30:00.000Z', type: 'task', sprintRefs: [opsSprint25] }),
        makeIssue({ key: 'OPS-159', summary: 'Fix final QA bug on release flow', assignee: people.ada, statusId: 'progress', sp: 5, updated: '2026-04-19T10:05:00.000Z', type: 'bug', sprintRefs: [opsSprint25] }),
    ],
    201: [
        makeIssue({ key: 'OPS-130', summary: 'Redesign status legend for leadership screenshots', assignee: people.ada, statusId: 'done', sp: 5, updated: '2026-04-10T16:00:00.000Z', type: 'task', sprintRefs: [opsSprint24] }),
        makeIssue({ key: 'OPS-133', summary: 'Improve sprint health summary copy', assignee: people.maya, statusId: 'done', sp: 3, updated: '2026-04-10T18:00:00.000Z', type: 'story', sprintRefs: [opsSprint24] }),
        makeIssue({ key: 'OPS-136', summary: 'Prepare GTM readiness report', assignee: people.theo, statusId: 'done', sp: 8, updated: '2026-04-11T15:00:00.000Z', type: 'story', sprintRefs: [opsSprint24] }),
        makeIssue({ key: 'OPS-138', summary: 'Create executive launch notes pack', assignee: people.ada, statusId: 'done', sp: 5, updated: '2026-04-11T16:00:00.000Z', type: 'task', sprintRefs: [opsSprint24] }),
        makeIssue({ key: 'OPS-140', summary: 'Align support macros with release train', assignee: people.maya, statusId: 'done', sp: 2, updated: '2026-04-11T13:20:00.000Z', type: 'task', sprintRefs: [opsSprint24] }),
        makeIssue({ key: 'OPS-141', summary: 'Validate observability dashboards pre-launch', assignee: people.theo, statusId: 'done', sp: 8, updated: '2026-04-11T14:35:00.000Z', type: 'story', sprintRefs: [opsSprint24] }),
        makeIssue({ key: 'OPS-143', summary: 'Stabilize rollout runbook for launch support', assignee: people.maya, statusId: 'review', sp: 5, updated: '2026-04-12T10:15:00.000Z', type: 'story', sprintRefs: [opsSprint24, opsSprint25] }),
        makeIssue({ key: 'OPS-144', summary: 'Refine pricing toggle copy in onboarding', assignee: people.ada, statusId: 'progress', sp: 3, updated: '2026-04-12T09:45:00.000Z', type: 'task', sprintRefs: [opsSprint24, opsSprint25] }),
        makeIssue({ key: 'OPS-146', summary: 'Add launch risk review card to dashboard', assignee: people.theo, statusId: 'done', sp: 5, updated: '2026-04-11T12:00:00.000Z', type: 'task', sprintRefs: [opsSprint24] }),
    ],
    196: [
        makeIssue({ key: 'OPS-101', summary: 'Set baseline launch dashboard metrics', assignee: people.ada, statusId: 'done', sp: 8, updated: '2026-01-31T18:00:00.000Z', type: 'story', sprintRefs: [sprintRef(196, 'OPS Sprint 19', 'closed')] }),
        makeIssue({ key: 'OPS-102', summary: 'Build first draft of PM toolkit reporting', assignee: people.maya, statusId: 'done', sp: 5, updated: '2026-01-31T17:00:00.000Z', type: 'task', sprintRefs: [sprintRef(196, 'OPS Sprint 19', 'closed')] }),
        makeIssue({ key: 'OPS-103', summary: 'Polish issue export format', assignee: people.theo, statusId: 'done', sp: 3, updated: '2026-01-31T16:00:00.000Z', type: 'task', sprintRefs: [sprintRef(196, 'OPS Sprint 19', 'closed')] }),
    ],
    197: [
        makeIssue({ key: 'OPS-110', summary: 'Improve analytics onboarding flow', assignee: people.ada, statusId: 'done', sp: 5, updated: '2026-02-14T18:00:00.000Z', type: 'task', sprintRefs: [sprintRef(197, 'OPS Sprint 20', 'closed')] }),
        makeIssue({ key: 'OPS-111', summary: 'Add PR signal badge states', assignee: people.maya, statusId: 'done', sp: 8, updated: '2026-02-14T16:00:00.000Z', type: 'story', sprintRefs: [sprintRef(197, 'OPS Sprint 20', 'closed')] }),
        makeIssue({ key: 'OPS-112', summary: 'Refine empty state styling', assignee: people.theo, statusId: 'done', sp: 3, updated: '2026-02-14T15:00:00.000Z', type: 'task', sprintRefs: [sprintRef(197, 'OPS Sprint 20', 'closed')] }),
    ],
    198: [
        makeIssue({ key: 'OPS-118', summary: 'Introduce capacity overview cards', assignee: people.ada, statusId: 'done', sp: 8, updated: '2026-02-28T17:00:00.000Z', type: 'story', sprintRefs: [sprintRef(198, 'OPS Sprint 21', 'closed')] }),
        makeIssue({ key: 'OPS-119', summary: 'Ship sprint tag filter', assignee: people.maya, statusId: 'done', sp: 5, updated: '2026-02-28T18:00:00.000Z', type: 'task', sprintRefs: [sprintRef(198, 'OPS Sprint 21', 'closed')] }),
        makeIssue({ key: 'OPS-120', summary: 'Improve CSV export columns', assignee: people.theo, statusId: 'done', sp: 2, updated: '2026-02-28T14:00:00.000Z', type: 'task', sprintRefs: [sprintRef(198, 'OPS Sprint 21', 'closed')] }),
    ],
    199: [
        makeIssue({ key: 'OPS-123', summary: 'Tune sprint health predictions', assignee: people.ada, statusId: 'done', sp: 5, updated: '2026-03-14T18:00:00.000Z', type: 'task', sprintRefs: [sprintRef(199, 'OPS Sprint 22', 'closed')] }),
        makeIssue({ key: 'OPS-124', summary: 'Add screenshot-ready closure report', assignee: people.maya, statusId: 'done', sp: 8, updated: '2026-03-14T18:30:00.000Z', type: 'story', sprintRefs: [sprintRef(199, 'OPS Sprint 22', 'closed')] }),
        makeIssue({ key: 'OPS-125', summary: 'Refactor report model tests', assignee: people.theo, statusId: 'done', sp: 3, updated: '2026-03-14T15:00:00.000Z', type: 'task', sprintRefs: [sprintRef(199, 'OPS Sprint 22', 'closed')] }),
    ],
    200: [
        makeIssue({ key: 'OPS-127', summary: 'Refine banner presentation', assignee: people.ada, statusId: 'done', sp: 8, updated: '2026-03-28T18:00:00.000Z', type: 'story', sprintRefs: [sprintRef(200, 'OPS Sprint 23', 'closed')] }),
        makeIssue({ key: 'OPS-128', summary: 'Improve contributor bars', assignee: people.maya, statusId: 'done', sp: 5, updated: '2026-03-28T17:00:00.000Z', type: 'task', sprintRefs: [sprintRef(200, 'OPS Sprint 23', 'closed')] }),
        makeIssue({ key: 'OPS-129', summary: 'Polish perf dashboard titles', assignee: people.theo, statusId: 'done', sp: 2, updated: '2026-03-28T16:00:00.000Z', type: 'task', sprintRefs: [sprintRef(200, 'OPS Sprint 23', 'closed')] }),
    ],
    302: [
        makeIssue({ key: 'PLN-88', summary: 'Polish handoff notes for roadmap review', assignee: people.theo, statusId: 'todo', sp: 3, updated: '2026-04-18T14:10:00.000Z', type: 'task', sprintRefs: [plnSprint9] }),
        makeIssue({ key: 'PLN-91', summary: 'Draft strategy brief for Q3 planning', assignee: people.ada, statusId: 'progress', sp: 8, updated: '2026-04-19T11:20:00.000Z', type: 'story', sprintRefs: [plnSprint9] }),
        makeIssue({ key: 'PLN-94', summary: 'Consolidate cross-team roadmap asks', assignee: people.maya, statusId: 'review', sp: 5, updated: '2026-04-19T09:10:00.000Z', type: 'task', sprintRefs: [plnSprint9] }),
    ],
    301: [
        makeIssue({ key: 'PLN-80', summary: 'Close roadmap feedback loop', assignee: people.theo, statusId: 'done', sp: 5, updated: '2026-04-12T15:00:00.000Z', type: 'task', sprintRefs: [plnSprint8] }),
        makeIssue({ key: 'PLN-82', summary: 'Prepare executive planning packet', assignee: people.ada, statusId: 'done', sp: 8, updated: '2026-04-12T17:00:00.000Z', type: 'story', sprintRefs: [plnSprint8] }),
        makeIssue({ key: 'PLN-84', summary: 'Reduce roadmap noise in weekly recap', assignee: people.maya, statusId: 'done', sp: 3, updated: '2026-04-12T16:00:00.000Z', type: 'task', sprintRefs: [plnSprint8] }),
    ],
    300: [
        makeIssue({ key: 'PLN-71', summary: 'Reframe planning heatmap', assignee: people.ada, statusId: 'done', sp: 5, updated: '2026-03-29T18:00:00.000Z', type: 'task', sprintRefs: [sprintRef(300, 'PLN Sprint 7', 'closed')] }),
        makeIssue({ key: 'PLN-74', summary: 'Consolidate dependency tracker', assignee: people.maya, statusId: 'done', sp: 8, updated: '2026-03-29T18:00:00.000Z', type: 'story', sprintRefs: [sprintRef(300, 'PLN Sprint 7', 'closed')] }),
    ],
};

const demoChangelogsByIssue = {
    'OPS-143': [
        {
            created: '2026-04-04T15:00:00.000Z',
            items: [{ field: 'Story Points', fieldId: DEMO_SP_FIELD_ID, fromString: '3', toString: '5' }],
        },
        {
            created: '2026-04-12T09:05:00.000Z',
            items: [{ field: 'Sprint', fromString: 'id=201,name=OPS Sprint 24', toString: 'id=201,name=OPS Sprint 24,id=202,name=OPS Sprint 25' }],
        },
    ],
    'OPS-144': [
        {
            created: '2026-04-03T14:00:00.000Z',
            items: [{ field: 'Sprint', fromString: '', toString: 'id=201,name=OPS Sprint 24' }],
        },
        {
            created: '2026-04-05T10:00:00.000Z',
            items: [{ field: 'Story Points', fieldId: DEMO_SP_FIELD_ID, fromString: '1', toString: '3' }],
        },
        {
            created: '2026-04-12T08:45:00.000Z',
            items: [{ field: 'Sprint', fromString: 'id=201,name=OPS Sprint 24', toString: 'id=201,name=OPS Sprint 24,id=202,name=OPS Sprint 25' }],
        },
    ],
    'OPS-146': [
        {
            created: '2026-04-07T11:30:00.000Z',
            items: [{ field: 'Sprint', fromString: '', toString: 'id=201,name=OPS Sprint 24' }],
        },
    ],
    'OPS-142': [
        {
            created: '2026-04-16T14:20:00.000Z',
            items: [{ field: 'status', fromString: 'In Progress', toString: 'In Review', from: 'progress', to: 'review' }],
        },
    ],
    'OPS-147': [
        {
            created: '2026-04-15T13:10:00.000Z',
            items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress', from: 'todo', to: 'progress' }],
        },
    ],
    'OPS-159': [
        {
            created: '2026-04-18T16:20:00.000Z',
            items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress', from: 'todo', to: 'progress' }],
        },
    ],
};

function getProjectKeyForBoardId(boardId) {
    const entry = Object.entries(demoBoards).find(([, board]) => Number(board.id) === Number(boardId));
    return entry?.[0] || '';
}

function filterSprintsByState(sprints, states = []) {
    const stateSet = new Set((Array.isArray(states) ? states : [states]).map(value => String(value || '').trim()).filter(Boolean));
    if (!stateSet.size) return sprints.slice();
    return sprints.filter(sprint => stateSet.has(sprint.state));
}

function paginate(values, startAt = 0, maxResults = 50) {
    const safeStart = Math.max(0, Number(startAt) || 0);
    const safeMax = Math.max(1, Number(maxResults) || 50);
    const paged = values.slice(safeStart, safeStart + safeMax);
    return {
        values: clone(paged),
        startAt: safeStart,
        maxResults: safeMax,
        isLast: safeStart + safeMax >= values.length,
        total: values.length,
    };
}

export function getDemoProjects() {
    return clone(demoProjects);
}

export function getDemoTrackingItems() {
    return clone(baseTrackingItems);
}

export function getDemoIssueDetails(issueKey) {
    const meta = baseTrackingItems[`meta_jira:${issueKey}`];
    if (meta) {
        return clone(meta);
    }

    for (const issues of Object.values(demoIssuesBySprint)) {
        const issue = issues.find(item => item.key === issueKey);
        if (issue) {
            return {
                summary: issue.fields.summary,
                assignee: issue.fields.assignee?.displayName || 'Unassigned',
                status: {
                    name: issue.fields.status?.name || 'Unknown',
                    category: issue.fields.status?.statusCategory?.key || 'new',
                },
                issueType: clone(issue.fields.issuetype),
            };
        }
    }

    return null;
}

export function getDemoBoardId(projectKey) {
    return demoBoards[projectKey]?.id || null;
}

export function getDemoBoardConfig(boardId) {
    const projectKey = getProjectKeyForBoardId(boardId);
    return projectKey ? clone(demoBoards[projectKey].config) : null;
}

export function getDemoBoardSprints(boardId, states = []) {
    const projectKey = getProjectKeyForBoardId(boardId);
    if (!projectKey) return [];
    return clone(filterSprintsByState(demoSprintsByProject[projectKey] || [], states));
}

export function getDemoClosedSprints(boardId, count = 3) {
    return getDemoBoardSprints(boardId, ['closed']).slice(-count);
}

export function getDemoSprintIssues(sprintId) {
    return clone(demoIssuesBySprint[sprintId] || []);
}

export function getDemoSprintDoneIssues(sprintId) {
    return getDemoSprintIssues(sprintId).filter(issue => issue.fields?.status?.statusCategory?.key === 'done');
}

export function getDemoIssueChangelog(issueKey) {
    return clone(demoChangelogsByIssue[issueKey] || []);
}

export function getDemoProjectStatuses() {
    return DEMO_STATUS_CATALOG.map(item => ({
        name: item.name,
        categoryKey: item.categoryKey,
    }));
}

export function getDemoStatusResponse() {
    return [
        {
            name: 'Default',
            statuses: DEMO_STATUS_CATALOG.map(item => ({
                name: item.name,
                statusCategory: { key: item.categoryKey },
            })),
        },
    ];
}

export function getDemoFieldCatalog() {
    return [
        { id: DEMO_SP_FIELD_ID, name: 'Story Points' },
        { id: DEMO_SPRINT_FIELD_ID, name: 'Sprint' },
    ];
}

function trimIssueFields(issue, requestedFields = []) {
    if (!Array.isArray(requestedFields) || requestedFields.length === 0) return issue;
    const fields = {};
    requestedFields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(issue.fields, field)) {
            fields[field] = issue.fields[field];
        }
    });
    ['summary', 'status', 'assignee', 'issuetype', 'updated'].forEach(field => {
        if (Object.prototype.hasOwnProperty.call(issue.fields, field)) {
            fields[field] = issue.fields[field];
        }
    });
    return {
        ...issue,
        fields,
    };
}

export function getDemoJiraResponse(path, opts = {}) {
    const url = new URL(path.startsWith('http') ? path : `https://${DEMO_HOST}${path}`);
    const pathname = url.pathname;

    if (pathname === '/rest/api/3/project/search') {
        return paginate(demoProjects, url.searchParams.get('startAt'), url.searchParams.get('maxResults'));
    }

    if (pathname === '/rest/api/3/field') {
        return getDemoFieldCatalog();
    }

    if (/^\/rest\/api\/3\/project\/[^/]+\/statuses$/.test(pathname)) {
        return getDemoStatusResponse();
    }

    if (pathname === '/rest/agile/1.0/board') {
        const projectKey = url.searchParams.get('projectKeyOrId');
        const boardId = getDemoBoardId(projectKey);
        return {
            values: boardId ? [{ id: boardId }] : [],
        };
    }

    const boardConfigMatch = pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/configuration$/);
    if (boardConfigMatch) {
        return getDemoBoardConfig(Number(boardConfigMatch[1])) || {};
    }

    const boardSprintMatch = pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/);
    if (boardSprintMatch) {
        const states = String(url.searchParams.get('state') || '').split(',').filter(Boolean);
        const sprints = getDemoBoardSprints(Number(boardSprintMatch[1]), states);
        return paginate(sprints, url.searchParams.get('startAt'), url.searchParams.get('maxResults'));
    }

    const issueChangelogMatch = pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/changelog$/);
    if (issueChangelogMatch) {
        const all = getDemoIssueChangelog(issueChangelogMatch[1]);
        const safeStart = Math.max(0, Number(url.searchParams.get('startAt')) || 0);
        const safeMax = Math.max(1, Number(url.searchParams.get('maxResults')) || 100);
        const values = all.slice(safeStart, safeStart + safeMax);
        return {
            values,
            startAt: safeStart,
            maxResults: safeMax,
            total: all.length,
        };
    }

    if (pathname === '/rest/api/3/search/jql') {
        const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || {});
        const sprintIdMatch = String(body.jql || '').match(/sprint\s*=\s*(\d+)/i);
        const sprintId = sprintIdMatch ? Number(sprintIdMatch[1]) : 0;
        const requestedFields = Array.isArray(body.fields) ? body.fields : [];
        let issues = getDemoSprintIssues(sprintId);
        if (/statusCategory\s*=\s*Done/i.test(String(body.jql || ''))) {
            issues = issues.filter(issue => issue.fields?.status?.statusCategory?.key === 'done');
        }
        return {
            issues: issues.map(issue => trimIssueFields(issue, requestedFields)),
            nextPageToken: null,
        };
    }

    throw new Error(`Unsupported demo Jira route: ${pathname}`);
}

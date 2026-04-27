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

const people = {
    ada: assignee('demo-ada', 'Ada Lovelace'),
    maya: assignee('demo-maya', 'Maya Chen'),
    theo: assignee('demo-theo', 'Theo Park'),
    iris: assignee('demo-iris', 'Iris Navarro'),
    nolan: assignee('demo-nolan', 'Nolan Reyes'),
    sofia: assignee('demo-sofia', 'Sofia Kim'),
};

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

function addMilliseconds(date, ms) {
    return new Date(new Date(date).getTime() + ms);
}

function addMinutes(date, minutes) {
    return addMilliseconds(date, minutes * 60 * 1000);
}

function addHours(date, hours) {
    return addMilliseconds(date, hours * 60 * 60 * 1000);
}

function addDays(date, days) {
    return addMilliseconds(date, days * 24 * 60 * 60 * 1000);
}

function atUtc(date, hours, minutes = 0) {
    const next = new Date(date);
    next.setUTCHours(hours, minutes, 0, 0);
    return next;
}

function startOfUtcDay(date) {
    return atUtc(date, 0, 0);
}

function toIso(date) {
    return new Date(date).toISOString();
}

function toTimestamp(date) {
    return new Date(date).getTime();
}

function buildSprint(id, name, state, startDay, endDay) {
    const startDate = atUtc(startDay, 13, 0);
    const endDate = atUtc(endDay, 21, 0);
    return {
        id,
        name,
        state,
        startDate: toIso(startDate),
        endDate: toIso(endDate),
        ...(state === 'closed' ? { completeDate: toIso(addMinutes(endDate, -45)) } : {}),
    };
}

function buildSprintSeries({
    prefix,
    firstId,
    firstNumber,
    closedCount,
    activeDaysLeft,
}) {
    const today = startOfUtcDay(new Date());
    const activeEndDay = addDays(today, activeDaysLeft);
    const activeStartDay = addDays(activeEndDay, -11);
    const sprints = [];

    for (let index = 0; index < closedCount; index += 1) {
        const startDay = addDays(activeStartDay, -14 * (closedCount - index));
        const endDay = addDays(startDay, 11);
        const sprintNumber = firstNumber + index;
        sprints.push(buildSprint(firstId + index, `${prefix} Sprint ${sprintNumber}`, 'closed', startDay, endDay));
    }

    const activeNumber = firstNumber + closedCount;
    sprints.push(buildSprint(firstId + closedCount, `${prefix} Sprint ${activeNumber}`, 'active', activeStartDay, activeEndDay));

    const futureStartDay = addDays(activeStartDay, 14);
    const futureEndDay = addDays(futureStartDay, 11);
    sprints.push(buildSprint(firstId + closedCount + 1, `${prefix} Sprint ${activeNumber + 1}`, 'future', futureStartDay, futureEndDay));

    return sprints;
}

function getSprintTimelineIso(sprint, anchor, dayOffset, hours, minutes = 0) {
    const base = new Date(anchor === 'start' ? sprint.startDate : sprint.endDate);
    return toIso(atUtc(addDays(base, dayOffset), hours, minutes));
}

function getRecentIso(hoursAgo) {
    return toIso(addHours(new Date(), -hoursAgo));
}

function getIssueMeta(issue) {
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

function buildDemoPrSnapshot(number, state, draft, labels = []) {
    return {
        url: `https://github.com/pmtoolkit/demo-repo/pull/${number}`,
        state,
        draft,
        labels,
    };
}

function buildDemoDataset() {
    const opsSprints = buildSprintSeries({
        prefix: 'OPS',
        firstId: 196,
        firstNumber: 19,
        closedCount: 6,
        activeDaysLeft: 4,
    });
    const plnSprints = buildSprintSeries({
        prefix: 'PLN',
        firstId: 300,
        firstNumber: 7,
        closedCount: 2,
        activeDaysLeft: 5,
    });

    const [ops19, ops20, ops21, ops22, ops23, ops24, ops25, ops26] = opsSprints;
    const [pln7, pln8, pln9, pln10] = plnSprints;

    const demoSprintsByProject = {
        OPS: opsSprints,
        PLN: plnSprints,
    };

    const ops24Ref = sprintRef(ops24.id, ops24.name, ops24.state);
    const ops25Ref = sprintRef(ops25.id, ops25.name, ops25.state);
    const pln8Ref = sprintRef(pln8.id, pln8.name, pln8.state);
    const pln9Ref = sprintRef(pln9.id, pln9.name, pln9.state);

    const demoIssuesBySprint = {
        [ops25.id]: [
            makeIssue({ key: 'OPS-142', summary: 'Finalize launch checklist and screenshots', assignee: people.ada, statusId: 'review', sp: 5, updated: getRecentIso(6), type: 'task', sprintRefs: [ops25Ref] }),
            makeIssue({ key: 'OPS-143', summary: 'Stabilize rollout runbook for launch support', assignee: people.maya, statusId: 'review', sp: 5, updated: getRecentIso(18), type: 'story', sprintRefs: [ops24Ref, ops25Ref] }),
            makeIssue({ key: 'OPS-144', summary: 'Refine pricing toggle copy in onboarding', assignee: people.sofia, statusId: 'progress', sp: 3, updated: getRecentIso(14), type: 'task', sprintRefs: [ops24Ref, ops25Ref] }),
            makeIssue({ key: 'OPS-147', summary: 'Resolve pricing edge cases for onboarding', assignee: people.maya, statusId: 'progress', sp: 8, updated: getRecentIso(10), type: 'story', sprintRefs: [ops25Ref] }),
            makeIssue({ key: 'OPS-153', summary: 'Ship polished workspace empty states', assignee: people.theo, statusId: 'todo', sp: 3, updated: getRecentIso(28), type: 'task', sprintRefs: [ops25Ref] }),
            makeIssue({ key: 'OPS-155', summary: 'Backfill support macros for launch week', assignee: people.nolan, statusId: 'done', sp: 2, updated: getRecentIso(22), type: 'task', sprintRefs: [ops25Ref] }),
            makeIssue({ key: 'OPS-159', summary: 'Fix final QA bug on release flow', assignee: people.ada, statusId: 'progress', sp: 5, updated: getRecentIso(4), type: 'bug', sprintRefs: [ops25Ref] }),
            makeIssue({ key: 'OPS-161', summary: 'Prepare launch war-room staffing matrix', assignee: people.iris, statusId: 'review', sp: 3, updated: getRecentIso(12), type: 'task', sprintRefs: [ops25Ref] }),
            makeIssue({ key: 'OPS-163', summary: 'Validate billing fallback messaging in signup', assignee: people.sofia, statusId: 'progress', sp: 8, updated: getRecentIso(8), type: 'story', sprintRefs: [ops25Ref] }),
            makeIssue({ key: 'OPS-166', summary: 'Audit changelog banner copy for support handoff', assignee: people.nolan, statusId: 'todo', sp: 2, updated: getRecentIso(26), type: 'task', sprintRefs: [ops25Ref] }),
        ],
        [ops24.id]: [
            makeIssue({ key: 'OPS-130', summary: 'Redesign status legend for leadership screenshots', assignee: people.ada, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops24, 'end', -1, 16, 0), type: 'task', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-133', summary: 'Improve sprint health summary copy', assignee: people.maya, statusId: 'done', sp: 3, updated: getSprintTimelineIso(ops24, 'end', -1, 18, 0), type: 'story', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-136', summary: 'Prepare GTM readiness report', assignee: people.theo, statusId: 'done', sp: 8, updated: getSprintTimelineIso(ops24, 'end', 0, 15, 0), type: 'story', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-138', summary: 'Create executive launch notes pack', assignee: people.sofia, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops24, 'end', 0, 16, 0), type: 'task', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-140', summary: 'Align support macros with release train', assignee: people.maya, statusId: 'done', sp: 2, updated: getSprintTimelineIso(ops24, 'end', 0, 13, 20), type: 'task', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-141', summary: 'Validate observability dashboards pre-launch', assignee: people.nolan, statusId: 'done', sp: 8, updated: getSprintTimelineIso(ops24, 'end', 0, 14, 35), type: 'story', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-143', summary: 'Stabilize rollout runbook for launch support', assignee: people.maya, statusId: 'review', sp: 5, updated: getRecentIso(18), type: 'story', sprintRefs: [ops24Ref, ops25Ref] }),
            makeIssue({ key: 'OPS-144', summary: 'Refine pricing toggle copy in onboarding', assignee: people.sofia, statusId: 'progress', sp: 3, updated: getRecentIso(14), type: 'task', sprintRefs: [ops24Ref, ops25Ref] }),
            makeIssue({ key: 'OPS-146', summary: 'Add launch risk review card to dashboard', assignee: people.theo, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops24, 'end', 0, 12, 0), type: 'task', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-149', summary: 'Build stakeholder launch checklist digest', assignee: people.iris, statusId: 'done', sp: 3, updated: getSprintTimelineIso(ops24, 'end', 0, 11, 20), type: 'task', sprintRefs: [ops24Ref] }),
            makeIssue({ key: 'OPS-150', summary: 'Dry-run post-release support script', assignee: people.nolan, statusId: 'done', sp: 2, updated: getSprintTimelineIso(ops24, 'end', -1, 11, 10), type: 'task', sprintRefs: [ops24Ref] }),
        ],
        [ops19.id]: [
            makeIssue({ key: 'OPS-101', summary: 'Set baseline launch dashboard metrics', assignee: people.ada, statusId: 'done', sp: 8, updated: getSprintTimelineIso(ops19, 'end', 0, 18, 0), type: 'story', sprintRefs: [sprintRef(ops19.id, ops19.name, ops19.state)] }),
            makeIssue({ key: 'OPS-102', summary: 'Build first draft of PM toolkit reporting', assignee: people.maya, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops19, 'end', 0, 17, 0), type: 'task', sprintRefs: [sprintRef(ops19.id, ops19.name, ops19.state)] }),
            makeIssue({ key: 'OPS-103', summary: 'Polish issue export format', assignee: people.theo, statusId: 'done', sp: 3, updated: getSprintTimelineIso(ops19, 'end', 0, 16, 0), type: 'task', sprintRefs: [sprintRef(ops19.id, ops19.name, ops19.state)] }),
            makeIssue({ key: 'OPS-104', summary: 'Harden executive snapshot share links', assignee: people.iris, statusId: 'done', sp: 2, updated: getSprintTimelineIso(ops19, 'end', -1, 15, 0), type: 'bug', sprintRefs: [sprintRef(ops19.id, ops19.name, ops19.state)] }),
        ],
        [ops20.id]: [
            makeIssue({ key: 'OPS-110', summary: 'Improve analytics onboarding flow', assignee: people.ada, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops20, 'end', 0, 18, 0), type: 'task', sprintRefs: [sprintRef(ops20.id, ops20.name, ops20.state)] }),
            makeIssue({ key: 'OPS-111', summary: 'Add PR signal badge states', assignee: people.maya, statusId: 'done', sp: 8, updated: getSprintTimelineIso(ops20, 'end', 0, 16, 0), type: 'story', sprintRefs: [sprintRef(ops20.id, ops20.name, ops20.state)] }),
            makeIssue({ key: 'OPS-112', summary: 'Refine empty state styling', assignee: people.theo, statusId: 'done', sp: 3, updated: getSprintTimelineIso(ops20, 'end', 0, 15, 0), type: 'task', sprintRefs: [sprintRef(ops20.id, ops20.name, ops20.state)] }),
            makeIssue({ key: 'OPS-113', summary: 'Validate reminder queue behavior', assignee: people.nolan, statusId: 'done', sp: 2, updated: getSprintTimelineIso(ops20, 'end', -1, 14, 30), type: 'bug', sprintRefs: [sprintRef(ops20.id, ops20.name, ops20.state)] }),
        ],
        [ops21.id]: [
            makeIssue({ key: 'OPS-118', summary: 'Introduce capacity overview cards', assignee: people.ada, statusId: 'done', sp: 8, updated: getSprintTimelineIso(ops21, 'end', 0, 17, 0), type: 'story', sprintRefs: [sprintRef(ops21.id, ops21.name, ops21.state)] }),
            makeIssue({ key: 'OPS-119', summary: 'Ship sprint tag filter', assignee: people.iris, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops21, 'end', 0, 18, 0), type: 'task', sprintRefs: [sprintRef(ops21.id, ops21.name, ops21.state)] }),
            makeIssue({ key: 'OPS-120', summary: 'Improve CSV export columns', assignee: people.theo, statusId: 'done', sp: 2, updated: getSprintTimelineIso(ops21, 'end', 0, 14, 0), type: 'task', sprintRefs: [sprintRef(ops21.id, ops21.name, ops21.state)] }),
            makeIssue({ key: 'OPS-121', summary: 'Reduce noise in launch recap metrics', assignee: people.sofia, statusId: 'done', sp: 3, updated: getSprintTimelineIso(ops21, 'end', -1, 13, 0), type: 'story', sprintRefs: [sprintRef(ops21.id, ops21.name, ops21.state)] }),
        ],
        [ops22.id]: [
            makeIssue({ key: 'OPS-123', summary: 'Tune sprint health predictions', assignee: people.ada, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops22, 'end', 0, 18, 0), type: 'task', sprintRefs: [sprintRef(ops22.id, ops22.name, ops22.state)] }),
            makeIssue({ key: 'OPS-124', summary: 'Add screenshot-ready closure report', assignee: people.maya, statusId: 'done', sp: 8, updated: getSprintTimelineIso(ops22, 'end', 0, 18, 30), type: 'story', sprintRefs: [sprintRef(ops22.id, ops22.name, ops22.state)] }),
            makeIssue({ key: 'OPS-125', summary: 'Refactor report model tests', assignee: people.theo, statusId: 'done', sp: 3, updated: getSprintTimelineIso(ops22, 'end', 0, 15, 0), type: 'task', sprintRefs: [sprintRef(ops22.id, ops22.name, ops22.state)] }),
            makeIssue({ key: 'OPS-126', summary: 'Streamline blocker triage copy', assignee: people.nolan, statusId: 'done', sp: 2, updated: getSprintTimelineIso(ops22, 'end', -1, 16, 0), type: 'task', sprintRefs: [sprintRef(ops22.id, ops22.name, ops22.state)] }),
        ],
        [ops23.id]: [
            makeIssue({ key: 'OPS-127', summary: 'Refine banner presentation', assignee: people.ada, statusId: 'done', sp: 8, updated: getSprintTimelineIso(ops23, 'end', 0, 18, 0), type: 'story', sprintRefs: [sprintRef(ops23.id, ops23.name, ops23.state)] }),
            makeIssue({ key: 'OPS-128', summary: 'Improve contributor bars', assignee: people.maya, statusId: 'done', sp: 5, updated: getSprintTimelineIso(ops23, 'end', 0, 17, 0), type: 'task', sprintRefs: [sprintRef(ops23.id, ops23.name, ops23.state)] }),
            makeIssue({ key: 'OPS-129', summary: 'Polish perf dashboard titles', assignee: people.theo, statusId: 'done', sp: 2, updated: getSprintTimelineIso(ops23, 'end', 0, 16, 0), type: 'task', sprintRefs: [sprintRef(ops23.id, ops23.name, ops23.state)] }),
            makeIssue({ key: 'OPS-131', summary: 'Consolidate launch readiness scorecard', assignee: people.iris, statusId: 'done', sp: 3, updated: getSprintTimelineIso(ops23, 'end', -1, 15, 10), type: 'task', sprintRefs: [sprintRef(ops23.id, ops23.name, ops23.state)] }),
        ],
        [pln9.id]: [
            makeIssue({ key: 'PLN-86', summary: 'Finalize planning scorecard annotations', assignee: people.iris, statusId: 'review', sp: 5, updated: getRecentIso(16), type: 'task', sprintRefs: [pln8Ref, pln9Ref] }),
            makeIssue({ key: 'PLN-88', summary: 'Polish handoff notes for roadmap review', assignee: people.theo, statusId: 'todo', sp: 3, updated: getRecentIso(30), type: 'task', sprintRefs: [pln9Ref] }),
            makeIssue({ key: 'PLN-91', summary: 'Draft strategy brief for Q3 planning', assignee: people.ada, statusId: 'progress', sp: 8, updated: getRecentIso(9), type: 'story', sprintRefs: [pln9Ref] }),
            makeIssue({ key: 'PLN-94', summary: 'Consolidate cross-team roadmap asks', assignee: people.maya, statusId: 'review', sp: 5, updated: getRecentIso(11), type: 'task', sprintRefs: [pln9Ref] }),
            makeIssue({ key: 'PLN-96', summary: 'Map launch dependencies into planning board', assignee: people.sofia, statusId: 'progress', sp: 3, updated: getRecentIso(13), type: 'task', sprintRefs: [pln9Ref] }),
            makeIssue({ key: 'PLN-98', summary: 'Reconcile exec asks with staffing plan', assignee: people.nolan, statusId: 'done', sp: 2, updated: getRecentIso(20), type: 'task', sprintRefs: [pln9Ref] }),
            makeIssue({ key: 'PLN-99', summary: 'Prepare roadmap decision log template', assignee: people.iris, statusId: 'todo', sp: 2, updated: getRecentIso(32), type: 'task', sprintRefs: [pln9Ref] }),
        ],
        [pln8.id]: [
            makeIssue({ key: 'PLN-80', summary: 'Close roadmap feedback loop', assignee: people.theo, statusId: 'done', sp: 5, updated: getSprintTimelineIso(pln8, 'end', 0, 15, 0), type: 'task', sprintRefs: [pln8Ref] }),
            makeIssue({ key: 'PLN-82', summary: 'Prepare executive planning packet', assignee: people.ada, statusId: 'done', sp: 8, updated: getSprintTimelineIso(pln8, 'end', 0, 17, 0), type: 'story', sprintRefs: [pln8Ref] }),
            makeIssue({ key: 'PLN-84', summary: 'Reduce roadmap noise in weekly recap', assignee: people.maya, statusId: 'done', sp: 3, updated: getSprintTimelineIso(pln8, 'end', 0, 16, 0), type: 'task', sprintRefs: [pln8Ref] }),
            makeIssue({ key: 'PLN-86', summary: 'Finalize planning scorecard annotations', assignee: people.iris, statusId: 'review', sp: 5, updated: getRecentIso(16), type: 'task', sprintRefs: [pln8Ref, pln9Ref] }),
            makeIssue({ key: 'PLN-87', summary: 'Align roadmap narrative with launch learnings', assignee: people.sofia, statusId: 'done', sp: 2, updated: getSprintTimelineIso(pln8, 'end', -1, 14, 0), type: 'task', sprintRefs: [pln8Ref] }),
        ],
        [pln7.id]: [
            makeIssue({ key: 'PLN-71', summary: 'Reframe planning heatmap', assignee: people.ada, statusId: 'done', sp: 5, updated: getSprintTimelineIso(pln7, 'end', 0, 18, 0), type: 'task', sprintRefs: [sprintRef(pln7.id, pln7.name, pln7.state)] }),
            makeIssue({ key: 'PLN-74', summary: 'Consolidate dependency tracker', assignee: people.maya, statusId: 'done', sp: 8, updated: getSprintTimelineIso(pln7, 'end', 0, 18, 0), type: 'story', sprintRefs: [sprintRef(pln7.id, pln7.name, pln7.state)] }),
            makeIssue({ key: 'PLN-76', summary: 'Organize roadmap review intake', assignee: people.nolan, statusId: 'done', sp: 3, updated: getSprintTimelineIso(pln7, 'end', -1, 15, 0), type: 'task', sprintRefs: [sprintRef(pln7.id, pln7.name, pln7.state)] }),
            makeIssue({ key: 'PLN-77', summary: 'Summarize partner asks for planning sync', assignee: people.theo, statusId: 'done', sp: 2, updated: getSprintTimelineIso(pln7, 'end', -1, 13, 30), type: 'task', sprintRefs: [sprintRef(pln7.id, pln7.name, pln7.state)] }),
        ],
    };

    const trackedIssues = {
        'OPS-142': {
            notes: 'Launch copy approved. Keep this card ready for the hero screenshot.',
            tags: ['Launch', 'Exec'],
            reminder: toTimestamp(atUtc(addDays(new Date(ops25.endDate), -2), 14, 30)),
        },
        'OPS-147': {
            notes: 'Waiting on pricing copy and legal review. Good example of a tracked blocker.',
            tags: ['Risk', 'Unblock'],
        },
        'OPS-163': {
            notes: 'If billing fallback copy slips, this becomes a sprint-end risk immediately.',
            tags: ['Risk', 'Launch'],
            reminder: toTimestamp(atUtc(addDays(new Date(ops25.endDate), -1), 11, 0)),
        },
        'PLN-88': {
            notes: 'Use this one for a cleaner popup state with fewer tags.',
            tags: ['Polish'],
            reminder: toTimestamp(atUtc(addDays(new Date(pln9.endDate), -1), 16, 0)),
        },
        'PLN-86': {
            notes: 'Carryover task that shows how planning work rolls into the active sprint.',
            tags: ['Exec'],
        },
    };

    const baseTrackingItems = {
        tag_defs_jira: {
            launch: { label: 'Launch', color: 'orange' },
            risk: { label: 'Risk', color: 'red' },
            unblock: { label: 'Unblock', color: 'blue' },
            exec: { label: 'Exec', color: 'black' },
            polish: { label: 'Polish', color: 'green' },
        },
    };

    Object.entries(trackedIssues).forEach(([issueKey, entry]) => {
        if (entry.notes) baseTrackingItems[`notes_jira:${issueKey}`] = entry.notes;
        if (entry.tags) baseTrackingItems[`tags_jira:${issueKey}`] = entry.tags;
        if (entry.reminder) baseTrackingItems[`reminder_jira:${issueKey}`] = entry.reminder;
        const issue = Object.values(demoIssuesBySprint).flat().find(item => item.key === issueKey);
        if (issue) baseTrackingItems[`meta_jira:${issueKey}`] = getIssueMeta(issue);
    });

    const demoChangelogsByIssue = {
        'OPS-143': [
            {
                created: getSprintTimelineIso(ops24, 'start', 5, 15, 0),
                items: [{ field: 'Story Points', fieldId: DEMO_SP_FIELD_ID, fromString: '3', toString: '5' }],
            },
            {
                created: getSprintTimelineIso(ops24, 'end', 1, 9, 5),
                items: [{ field: 'Sprint', fromString: `id=${ops24.id},name=${ops24.name}`, toString: `id=${ops24.id},name=${ops24.name},id=${ops25.id},name=${ops25.name}` }],
            },
        ],
        'OPS-144': [
            {
                created: getSprintTimelineIso(ops24, 'start', 2, 14, 0),
                items: [{ field: 'Sprint', fromString: '', toString: `id=${ops24.id},name=${ops24.name}` }],
            },
            {
                created: getSprintTimelineIso(ops24, 'start', 4, 10, 0),
                items: [{ field: 'Story Points', fieldId: DEMO_SP_FIELD_ID, fromString: '1', toString: '3' }],
            },
            {
                created: getSprintTimelineIso(ops24, 'end', 1, 8, 45),
                items: [{ field: 'Sprint', fromString: `id=${ops24.id},name=${ops24.name}`, toString: `id=${ops24.id},name=${ops24.name},id=${ops25.id},name=${ops25.name}` }],
            },
        ],
        'OPS-146': [
            {
                created: getSprintTimelineIso(ops24, 'start', 6, 11, 30),
                items: [{ field: 'Sprint', fromString: '', toString: `id=${ops24.id},name=${ops24.name}` }],
            },
        ],
        'OPS-142': [
            {
                created: getRecentIso(36),
                items: [{ field: 'status', fromString: 'In Progress', toString: 'In Review', from: 'progress', to: 'review' }],
            },
        ],
        'OPS-147': [
            {
                created: getRecentIso(52),
                items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress', from: 'todo', to: 'progress' }],
            },
        ],
        'OPS-159': [
            {
                created: getRecentIso(20),
                items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress', from: 'todo', to: 'progress' }],
            },
        ],
        'OPS-161': [
            {
                created: getRecentIso(30),
                items: [{ field: 'status', fromString: 'To Do', toString: 'In Review', from: 'todo', to: 'review' }],
            },
        ],
        'PLN-86': [
            {
                created: getSprintTimelineIso(pln8, 'end', 1, 10, 15),
                items: [{ field: 'Sprint', fromString: `id=${pln8.id},name=${pln8.name}`, toString: `id=${pln8.id},name=${pln8.name},id=${pln9.id},name=${pln9.name}` }],
            },
        ],
        'PLN-94': [
            {
                created: getRecentIso(34),
                items: [{ field: 'status', fromString: 'In Progress', toString: 'In Review', from: 'progress', to: 'review' }],
            },
        ],
    };

    const demoPrSnapshotsByTicket = {
        'OPS-142': buildDemoPrSnapshot(284, 'open', false, ['QA Pass', 'design-review']),
        'OPS-143': buildDemoPrSnapshot(286, 'open', false, ['release-train', 'ops']),
        'OPS-144': buildDemoPrSnapshot(287, 'open', true, ['pricing-copy', 'draft']),
        'OPS-147': buildDemoPrSnapshot(290, 'open', true, ['backend', 'risk']),
        'OPS-155': buildDemoPrSnapshot(281, 'closed', false, ['QA Pass', 'merged-pr']),
        'OPS-159': buildDemoPrSnapshot(292, 'open', false, ['bugfix', 'release-blocker']),
        'OPS-161': buildDemoPrSnapshot(293, 'open', false, ['QA Pass', 'ops']),
        'OPS-163': buildDemoPrSnapshot(295, 'open', false, ['QA Pass', 'billing']),
        'PLN-86': buildDemoPrSnapshot(312, 'open', false, ['QA Pass', 'planning']),
        'PLN-91': buildDemoPrSnapshot(314, 'open', true, ['strategy', 'draft']),
        'PLN-94': buildDemoPrSnapshot(315, 'open', false, ['review-ready']),
        'PLN-98': buildDemoPrSnapshot(309, 'closed', false, ['QA Pass', 'merged-pr']),
    };

    return {
        baseTrackingItems,
        demoSprintsByProject,
        demoIssuesBySprint,
        demoChangelogsByIssue,
        demoPrSnapshotsByTicket,
    };
}

let demoDataset;

function getDemoDataset() {
    if (!demoDataset) {
        demoDataset = buildDemoDataset();
    }
    return demoDataset;
}

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
    return clone(getDemoDataset().baseTrackingItems);
}

export function getDemoIssueDetails(issueKey) {
    const { baseTrackingItems, demoIssuesBySprint } = getDemoDataset();
    const meta = baseTrackingItems[`meta_jira:${issueKey}`];
    if (meta) {
        return clone(meta);
    }

    for (const issues of Object.values(demoIssuesBySprint)) {
        const issue = issues.find(item => item.key === issueKey);
        if (issue) {
            return getIssueMeta(issue);
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
    return clone(filterSprintsByState(getDemoDataset().demoSprintsByProject[projectKey] || [], states));
}

export function getDemoClosedSprints(boardId, count = 3) {
    return getDemoBoardSprints(boardId, ['closed']).slice(-count);
}

export function getDemoSprintIssues(sprintId) {
    return clone(getDemoDataset().demoIssuesBySprint[sprintId] || []);
}

export function getDemoSprintDoneIssues(sprintId) {
    return getDemoSprintIssues(sprintId).filter(issue => issue.fields?.status?.statusCategory?.key === 'done');
}

export function getDemoIssueChangelog(issueKey) {
    return clone(getDemoDataset().demoChangelogsByIssue[issueKey] || []);
}

export function getDemoPrSnapshots(ticketKeys = []) {
    const snapshots = getDemoDataset().demoPrSnapshotsByTicket || {};
    if (!Array.isArray(ticketKeys) || ticketKeys.length === 0) {
        return clone(snapshots);
    }

    return ticketKeys.reduce((acc, ticketKey) => {
        const normalized = String(ticketKey || '').trim().toUpperCase();
        if (normalized && Object.prototype.hasOwnProperty.call(snapshots, normalized)) {
            acc[normalized] = clone(snapshots[normalized]);
        }
        return acc;
    }, {});
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

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_GANTT_SP_TABLE,
    computeSchedule,
    computeWorkload,
    formatISODateLocal,
    mapIssuesToTasks,
    parseBlockingLinks,
    spToHours,
} from './ganttModel.js';

const SP_FIELD_ID = 'customfield_10016';

function makeIssue(key, {
    summary = key,
    statusName = 'To Do',
    statusCategory = 'new',
    points = null,
    assignee = null,
    blockedBy = [],
    otherLinks = [],
} = {}) {
    return {
        key,
        fields: {
            summary,
            status: { name: statusName, statusCategory: { key: statusCategory } },
            assignee: assignee ? { displayName: assignee } : null,
            [SP_FIELD_ID]: points,
            issuelinks: [
                ...blockedBy.map(k => ({ type: { name: 'Blocks' }, inwardIssue: { key: k } })),
                ...otherLinks,
            ],
        },
    };
}

function baseConfig(overrides = {}) {
    return {
        startDate: '2026-07-06', // a Monday
        hoursPerDay: 9,
        spTable: { ...DEFAULT_GANTT_SP_TABLE },
        workWeekends: false,
        oneParallelPerAssignee: false,
        includeSprints: false,
        sprintOrder: [],
        sprintDates: {},
        ...overrides,
    };
}

function buildModel(issues, sprintNameByIssueKey = {}) {
    return mapIssuesToTasks(issues, { spFieldId: SP_FIELD_ID, sprintNameByIssueKey });
}

describe('parseBlockingLinks', () => {
    it('reads only inward Blocks links (the blockers), ignoring outward and other link types', () => {
        const issue = makeIssue('MMZ-853', {
            blockedBy: ['MMZ-850', 'MMZ-851'],
            otherLinks: [
                { type: { name: 'Blocks' }, outwardIssue: { key: 'MMZ-873' } }, // this issue blocks 873 — not a dependency
                { type: { name: 'Relates' }, inwardIssue: { key: 'MMZ-900' } },
            ],
        });
        expect(parseBlockingLinks(issue)).toEqual(['MMZ-850', 'MMZ-851']);
    });

    it('returns [] when issuelinks is missing (e.g. demo mode)', () => {
        expect(parseBlockingLinks({ key: 'X-1', fields: {} })).toEqual([]);
    });
});

describe('mapIssuesToTasks', () => {
    it('maps fields, marks done from status category, and resolves in-selection deps', () => {
        const { tasksById, order, warnings } = buildModel([
            makeIssue('A-1', { points: 3, assignee: 'Ana', statusName: 'Done', statusCategory: 'done' }),
            makeIssue('A-2', { points: 5, blockedBy: ['A-1'] }),
        ]);
        expect(order).toEqual(['A-1', 'A-2']);
        expect(tasksById['A-1'].done).toBe(true);
        expect(tasksById['A-1'].assignee).toBe('Ana');
        expect(tasksById['A-2'].needs).toEqual(['A-1']);
        expect(warnings).toEqual([]);
    });

    it('warns and drops deps pointing outside the selection and self-deps', () => {
        const { tasksById, warnings } = buildModel([
            makeIssue('A-1', { points: 3, blockedBy: ['A-1', 'B-99'] }),
        ]);
        expect(tasksById['A-1'].needs).toEqual([]);
        expect(warnings.map(w => w.type)).toEqual(expect.arrayContaining(['self-dep', 'external-dep']));
    });

    it('breaks dependency cycles with a warning', () => {
        const { tasksById, warnings } = buildModel([
            makeIssue('A-1', { points: 3, blockedBy: ['A-2'] }),
            makeIssue('A-2', { points: 3, blockedBy: ['A-1'] }),
        ]);
        const totalEdges = tasksById['A-1'].needs.length + tasksById['A-2'].needs.length;
        expect(totalEdges).toBe(1); // one edge removed to break the cycle
        expect(warnings.some(w => w.type === 'cycle')).toBe(true);
    });

    it('warns on unestimated tasks unless they are done', () => {
        const { warnings } = buildModel([
            makeIssue('A-1'), // no points, not done -> warning
            makeIssue('A-2', { statusCategory: 'done' }), // no points but done -> no warning
        ]);
        const unest = warnings.filter(w => w.type === 'unestimated');
        expect(unest).toHaveLength(1);
        expect(unest[0].taskId).toBe('A-1');
    });
});

describe('spToHours', () => {
    it('uses the table directly and interpolates between known points', () => {
        expect(spToHours(3, DEFAULT_GANTT_SP_TABLE)).toBe(9);
        expect(spToHours(4, DEFAULT_GANTT_SP_TABLE)).toBeCloseTo(13.5); // midway 3 (9h) and 5 (18h)
        expect(spToHours(null, DEFAULT_GANTT_SP_TABLE)).toBe(0);
    });
});

describe('computeSchedule — CPM', () => {
    it('schedules a sequential chain end-to-start', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 3 }),                    // 9h = 1 day
            makeIssue('A-2', { points: 3, blockedBy: ['A-1'] }), // 9h = 1 day
        ]);
        const result = computeSchedule(tasksById, order, baseConfig());
        expect(result.schedule['A-1'].esHours).toBe(0);
        expect(result.schedule['A-2'].esHours).toBe(9);
        expect(result.projectDurationHours).toBe(18);
        expect(formatISODateLocal(result.schedule['A-1'].start)).toBe('2026-07-06');
        expect(formatISODateLocal(result.schedule['A-2'].start)).toBe('2026-07-07');
    });

    it('gives slack to parallel branches and marks the longest chain critical', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 8 }),                     // 27h — critical
            makeIssue('A-2', { points: 1 }),                     // 2.25h — slack
            makeIssue('A-3', { points: 3, blockedBy: ['A-1'] }), // critical
        ]);
        const result = computeSchedule(tasksById, order, baseConfig());
        expect(result.schedule['A-1'].critical).toBe(true);
        expect(result.schedule['A-3'].critical).toBe(true);
        expect(result.schedule['A-2'].critical).toBe(false);
        expect(result.schedule['A-2'].slack).toBeCloseTo(36 - 2.25);
    });

    it('done tasks take 0 hours and do not push their dependents', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 13, statusCategory: 'done' }),
            makeIssue('A-2', { points: 3, blockedBy: ['A-1'] }),
        ]);
        const result = computeSchedule(tasksById, order, baseConfig());
        expect(result.schedule['A-1'].durationHours).toBe(0);
        expect(result.schedule['A-2'].esHours).toBe(0);
    });

    it('skips weekends by default and works through them with workWeekends', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 13 }), // 45h = 5 days from Mon -> ends into next Mon
            makeIssue('A-2', { points: 3, blockedBy: ['A-1'] }),
        ]);
        // 45h at 9h/day fills Mon-Fri exactly, so A-1 (and A-2's start) land on
        // the Sat 00:00 boundary either way; the difference shows in A-2's end:
        // its 9h run skips the weekend by default but consumes Saturday with
        // workWeekends on.
        const skipping = computeSchedule(tasksById, order, baseConfig());
        expect(formatISODateLocal(skipping.schedule['A-2'].end)).toBe('2026-07-14');
        const working = computeSchedule(tasksById, order, baseConfig({ workWeekends: true }));
        expect(formatISODateLocal(working.schedule['A-2'].end)).toBe('2026-07-12');
    });
});

describe('computeSchedule — 1 parallel per assignee', () => {
    it('serializes same-assignee tasks when on, keeps them parallel when off', () => {
        const issues = [
            makeIssue('A-1', { points: 3, assignee: 'Ana' }),
            makeIssue('A-2', { points: 3, assignee: 'Ana' }),
            makeIssue('A-3', { points: 3, assignee: 'Beto' }),
        ];
        const off = buildModel(issues);
        const offResult = computeSchedule(off.tasksById, off.order, baseConfig());
        expect(offResult.schedule['A-2'].esHours).toBe(0);

        const on = buildModel(issues);
        const onResult = computeSchedule(on.tasksById, on.order, baseConfig({ oneParallelPerAssignee: true }));
        expect(onResult.schedule['A-2'].esHours).toBe(9); // queued behind A-1
        expect(onResult.schedule['A-3'].esHours).toBe(0); // other assignee unaffected
    });

    it('does not constrain unassigned tasks', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 3 }),
            makeIssue('A-2', { points: 3 }),
        ]);
        const result = computeSchedule(tasksById, order, baseConfig({ oneParallelPerAssignee: true }));
        expect(result.schedule['A-1'].esHours).toBe(0);
        expect(result.schedule['A-2'].esHours).toBe(0);
    });

    it('never parks a ready task behind one that is not ready', () => {
        // Ana has A-2 (ready now) and A-3 (blocked by Beto's long A-1).
        // A-2 must run first even though A-3 appears earlier in row order.
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 8, assignee: 'Beto' }),
            makeIssue('A-3', { points: 3, assignee: 'Ana', blockedBy: ['A-1'] }),
            makeIssue('A-2', { points: 3, assignee: 'Ana' }),
        ]);
        const result = computeSchedule(tasksById, order, baseConfig({ oneParallelPerAssignee: true }));
        expect(result.schedule['A-2'].esHours).toBe(0);
        expect(result.schedule['A-3'].esHours).toBe(27); // waits for A-1 (27h), not for row order
    });
});

describe('computeSchedule — sprint blocks', () => {
    const sprintConfig = overrides => baseConfig({
        includeSprints: true,
        sprintOrder: ['Sprint 1', 'Sprint 2'],
        sprintDates: {
            'Sprint 1': { start: '2026-07-06', end: '2026-07-17' },
            'Sprint 2': { start: '2026-07-20', end: '2026-07-31' },
        },
        ...overrides,
    });

    it('floors tasks at their sprint start date', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 3 }),
            makeIssue('B-1', { points: 3 }),
        ], { 'A-1': 'Sprint 1', 'B-1': 'Sprint 2' });
        const result = computeSchedule(tasksById, order, sprintConfig());
        expect(formatISODateLocal(result.schedule['A-1'].start)).toBe('2026-07-06');
        // B-1 has no deps but cannot start before Sprint 2 opens (10 working
        // days = 90h). 90h lands exactly on end-of-Friday-17, which the
        // date mapper renders as the Sat 00:00 boundary.
        expect(result.schedule['B-1'].esHours).toBe(90);
        expect(formatISODateLocal(result.schedule['B-1'].start)).toBe('2026-07-18');
    });

    it('warns when a task overflows its sprint end date', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 13 }),
            makeIssue('A-2', { points: 13, blockedBy: ['A-1'] }),
            makeIssue('A-3', { points: 13, blockedBy: ['A-2'] }),
        ], { 'A-1': 'Sprint 1', 'A-2': 'Sprint 1', 'A-3': 'Sprint 1' });
        const result = computeSchedule(tasksById, order, sprintConfig());
        // 3 x 45h chained = 15 working days > the 10-day sprint.
        const overflow = result.scheduleWarnings.filter(w => w.type === 'sprint-overflow');
        expect(overflow.length).toBeGreaterThan(0);
        expect(overflow.map(w => w.taskId)).toContain('A-3');
    });

    it('carries real cross-sprint dependencies forward into the later block', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 13 }),
            makeIssue('B-1', { points: 3, blockedBy: ['A-1'] }),
        ], { 'A-1': 'Sprint 1', 'B-1': 'Sprint 2' });
        // Make Sprint 2 start before A-1 finishes: dep must win over the floor.
        const result = computeSchedule(tasksById, order, sprintConfig({
            sprintDates: {
                'Sprint 1': { start: '2026-07-06', end: '2026-07-17' },
                'Sprint 2': { start: '2026-07-07', end: '2026-07-17' },
            },
        }));
        expect(result.schedule['B-1'].esHours).toBe(45); // waits for A-1, not just the floor (9h)
    });
});

describe('computeWorkload', () => {
    it('reports utilization, idle gaps, and excludes unassigned tasks', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 3, assignee: 'Ana' }),
            makeIssue('A-2', { points: 3, assignee: 'Ana', blockedBy: ['GAP'] }),
            makeIssue('GAP', { points: 8, assignee: 'Beto' }),
            makeIssue('A-9', { points: 3 }), // unassigned
        ]);
        const result = computeSchedule(tasksById, order, baseConfig({ oneParallelPerAssignee: true }));
        const workload = computeWorkload(tasksById, order, result);
        expect(workload.unassignedCount).toBe(1);
        const ana = workload.assignees.find(a => a.name === 'Ana');
        // Ana: A-1 [0,9], then waits for Beto's 27h GAP, then A-2 [27,36].
        expect(ana.idleHours).toBeCloseTo(18);
        expect(ana.utilization).toBeCloseTo(18 / 36);
        expect(ana.overbooked).toBe(false);
    });

    it('flags double-booking when overlapping tasks are scheduled (constraint off)', () => {
        const { tasksById, order } = buildModel([
            makeIssue('A-1', { points: 3, assignee: 'Ana' }),
            makeIssue('A-2', { points: 3, assignee: 'Ana' }),
        ]);
        const result = computeSchedule(tasksById, order, baseConfig({ oneParallelPerAssignee: false }));
        const workload = computeWorkload(tasksById, order, result);
        expect(workload.assignees[0].overbooked).toBe(true);
    });
});

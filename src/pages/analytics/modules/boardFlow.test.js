import { describe, expect, it } from 'vitest';

import {
    buildBoardColumnBuckets,
    createBoardFlow,
    resolveBoardColumnByStatus,
    resolveBoardColumnFromHistoryChange,
    resolveCurrentBoardColumnSince,
    summarizeBoardBuckets,
} from './boardFlow.js';

const BOARD_FLOW = createBoardFlow({
    columnConfig: {
        columns: [
            { name: 'To Do', statuses: [{ id: '1', name: 'To Do' }] },
            { name: 'Build', statuses: [{ id: '2', name: 'In Progress' }] },
            { name: 'Review', statuses: [{ id: '3', name: 'In Review' }, { id: '4', name: 'QA' }] },
            { name: 'Done', statuses: [{ id: '5', name: 'Done' }] },
        ],
    },
});

function makeIssue(statusId, statusName, sp = 0) {
    return {
        _sp: sp,
        fields: {
            updated: '2026-03-17T15:00:00.000Z',
            status: {
                id: statusId,
                name: statusName,
            },
        },
    };
}

describe('boardFlow', () => {
    it('resolves statuses by id and falls back to name', () => {
        expect(resolveBoardColumnByStatus({ id: '2', name: 'Something else' }, BOARD_FLOW)?.name).toBe('Build');
        expect(resolveBoardColumnByStatus({ id: '', name: 'QA' }, BOARD_FLOW)?.name).toBe('Review');
    });

    it('marks the last mapped column as done', () => {
        expect(BOARD_FLOW.doneColumnId).toBe(BOARD_FLOW.columns.find(column => column.name === 'Done')?.id);
        expect(BOARD_FLOW.columns.find(column => column.name === 'Done')?.isDone).toBe(true);
    });

    it('falls back to the first board column for statuses that are not configured', () => {
        const column = resolveBoardColumnByStatus({ id: '99', name: 'Cancelled' }, BOARD_FLOW);
        expect(column?.name).toBe('To Do');
    });

    it('resolves changelog history to the proper board column and keeps column age stable across same-column moves', () => {
        const issue = makeIssue('4', 'QA');
        const statusChanges = [
            { created: '2026-03-17T09:00:00.000Z', toId: '2', to: 'In Progress' },
            { created: '2026-03-17T11:00:00.000Z', toId: '3', to: 'In Review' },
            { created: '2026-03-17T13:00:00.000Z', toId: '4', to: 'QA' },
        ];

        expect(resolveBoardColumnFromHistoryChange(statusChanges[1], BOARD_FLOW)?.name).toBe('Review');
        expect(resolveCurrentBoardColumnSince(issue, statusChanges, BOARD_FLOW)).toBe('2026-03-17T11:00:00.000Z');
    });

    it('aggregates issues by board column with SP and interpolated hours', () => {
        const buckets = buildBoardColumnBuckets([
            makeIssue('1', 'To Do', 3),
            makeIssue('3', 'In Review', 5),
            makeIssue('5', 'Done', 2),
            makeIssue('99', 'Custom', 1),
        ], BOARD_FLOW, { 0: 9, 1: 2.25, 2: 4.5, 3: 9, 5: 18, 8: 27, 13: 45 });
        const summary = summarizeBoardBuckets(buckets);

        expect(buckets.find(bucket => bucket.column.name === 'To Do')?.sp).toBe(4);
        expect(buckets.find(bucket => bucket.column.name === 'Review')?.hours).toBe(18);
        expect(summary.doneSp).toBe(2);
        expect(summary.pendingSp).toBe(9);
    });

    it('classifies columns into remaining-effort stages', () => {
        const flow = createBoardFlow({
            columnConfig: {
                columns: [
                    { name: 'To Do', statuses: [{ id: '1', name: 'To Do' }] },
                    { name: 'Blocked', statuses: [{ id: '2', name: 'Blocked' }] },
                    { name: 'In Progress', statuses: [{ id: '3', name: 'In Progress' }] },
                    { name: 'Changes Required', statuses: [{ id: '4', name: 'Changes Required' }] },
                    { name: 'Internal Review', statuses: [{ id: '5', name: 'Internal Review' }] },
                    { name: 'Ready For QA', statuses: [{ id: '6', name: 'Ready For QA' }] },
                    { name: 'Cancelled', statuses: [{ id: '7', name: 'Cancelled' }] },
                    { name: 'Done', statuses: [{ id: '8', name: 'Done' }] },
                ],
            },
        });
        const stageByName = new Map(flow.columns.map(column => [column.name, column.stage]));

        expect(stageByName.get('To Do')).toBe('todo');
        expect(stageByName.get('Blocked')).toBe('blocked');
        expect(stageByName.get('In Progress')).toBe('inProgress');
        expect(stageByName.get('Changes Required')).toBe('changes');
        expect(stageByName.get('Internal Review')).toBe('review');
        expect(stageByName.get('Ready For QA')).toBe('qa');
        expect(stageByName.get('Cancelled')).toBe('done');
        expect(stageByName.get('Done')).toBe('done');
    });

    it('weights pending hours by stage and keeps raw hours intact', () => {
        const spHours = { 0: 9, 1: 2.25, 2: 4.5, 3: 9, 5: 18, 8: 27, 13: 45 };
        const buckets = buildBoardColumnBuckets([
            makeIssue('1', 'To Do', 3),
            makeIssue('3', 'In Review', 5),
            makeIssue('5', 'Done', 2),
        ], BOARD_FLOW, spHours, { todo: 1, blocked: 1, inProgress: 0.75, changes: 0.5, review: 0.4, qa: 0.25, done: 0 });
        const summary = summarizeBoardBuckets(buckets);

        expect(buckets.find(bucket => bucket.column.name === 'Review')?.weightedHours).toBeCloseTo(7.2);
        expect(buckets.find(bucket => bucket.column.name === 'Review')?.hours).toBe(18);
        expect(summary.pendingHours).toBe(27);
        expect(summary.pendingWeightedHours).toBeCloseTo(16.2);
    });

    it('falls back to default stage weights when none are provided', () => {
        const spHours = { 0: 9, 1: 2.25, 2: 4.5, 3: 9, 5: 18, 8: 27, 13: 45 };
        const buckets = buildBoardColumnBuckets([makeIssue('3', 'In Review', 5)], BOARD_FLOW, spHours);
        const summary = summarizeBoardBuckets(buckets);

        expect(summary.pendingWeightedHours).toBeCloseTo(18 * 0.4);
    });
});

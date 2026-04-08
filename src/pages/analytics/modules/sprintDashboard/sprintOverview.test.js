import { describe, expect, it } from 'vitest';

import { createBoardFlow } from '../boardFlow.js';
import { buildSprintOverviewModel } from './sprintOverview.js';

const BOARD_FLOW = createBoardFlow({
    columnConfig: {
        columns: [
            { name: 'To Do', statuses: [{ id: '1', name: 'To Do' }] },
            { name: 'Build', statuses: [{ id: '2', name: 'In Progress' }] },
            { name: 'Review', statuses: [{ id: '3', name: 'In Review' }] },
            { name: 'Done', statuses: [{ id: '4', name: 'Done' }] },
        ],
    },
});

function makeIssue(statusId, statusName, sp) {
    return {
        _sp: sp,
        fields: {
            status: { id: statusId, name: statusName },
        },
    };
}

describe('buildSprintOverviewModel', () => {
    it('aggregates sprint work by board columns and computes pending capacity', () => {
        const model = buildSprintOverviewModel(
            [
                makeIssue('1', 'To Do', 3),
                makeIssue('3', 'In Review', 5),
                makeIssue('4', 'Done', 2),
            ],
            { endDate: '2099-04-20T20:00:00.000Z' },
            {
                hoursPerDay: 9,
                spHours: { 0: 9, 1: 2.25, 2: 4.5, 3: 9, 5: 18, 8: 27, 13: 45 },
            },
            2,
            10,
            10,
            BOARD_FLOW,
        );

        expect(model.totalSp).toBe(10);
        expect(model.donePct).toBe(20);
        expect(model.summary.pendingSp).toBe(8);
        expect(model.summary.pendingHours).toBe(27);
        expect(model.buckets.find(bucket => bucket.column.name === 'Review')?.count).toBe(1);
    });
});

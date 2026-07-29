import { describe, expect, it } from 'vitest';

import { createBoardFlow } from '../boardFlow.js';
import {
    buildSprintStatusFilterOptions,
    buildStatusFilterSummary,
    filterSprintIssuesByStatus,
    getStatusFilterLabels,
    sanitizeStatusFilterSelection,
} from './statusFilter.js';

const BOARD_FLOW = createBoardFlow({
    columnConfig: {
        columns: [
            { name: 'To Do', statuses: [{ id: '1', name: 'To Do' }] },
            { name: 'In Progress', statuses: [{ id: '2', name: 'In Progress' }] },
            { name: 'Internal Review', statuses: [{ id: '3', name: 'Internal Review' }] },
            { name: 'Done', statuses: [{ id: '4', name: 'Done' }] },
        ],
    },
});

function makeIssue(key, statusName, statusId) {
    return { key, fields: { status: { id: statusId, name: statusName } } };
}

const ISSUES = [
    makeIssue('PM-1', 'Done', '4'),
    makeIssue('PM-2', 'In Progress', '2'),
    makeIssue('PM-3', 'In Progress', '2'),
    makeIssue('PM-4', 'To Do', '1'),
];

describe('buildSprintStatusFilterOptions', () => {
    it('lists distinct statuses in board column order with counts', () => {
        expect(buildSprintStatusFilterOptions(ISSUES, BOARD_FLOW).map(({ value, label, count }) => ({ value, label, count })))
            .toEqual([
                { value: 'to do', label: 'To Do', count: 1 },
                { value: 'in progress', label: 'In Progress', count: 2 },
                { value: 'done', label: 'Done', count: 1 },
            ]);
    });

    it('tags each option with its board column tone', () => {
        const options = buildSprintStatusFilterOptions(ISSUES, BOARD_FLOW);
        expect(options.find(option => option.value === 'done').tone).toBe('done');
        expect(options.find(option => option.value === 'to do').tone).toBe('todo');
    });

    it('ignores issues without a status and handles a missing board flow', () => {
        const options = buildSprintStatusFilterOptions([
            makeIssue('PM-5', '', ''),
            { key: 'PM-6', fields: {} },
            makeIssue('PM-7', 'In QA', '9'),
        ], null);

        expect(options.map(option => option.label)).toEqual(['In QA']);
    });
});

describe('sanitizeStatusFilterSelection', () => {
    it('drops unknown, blank and duplicated selections', () => {
        const options = buildSprintStatusFilterOptions(ISSUES, BOARD_FLOW);

        expect(sanitizeStatusFilterSelection(['Done', 'done', '', 'Cancelled', 'To Do'], options))
            .toEqual(['done', 'to do']);
    });

    it('returns an empty selection when there are no options', () => {
        expect(sanitizeStatusFilterSelection(['done'], [])).toEqual([]);
    });
});

describe('filterSprintIssuesByStatus', () => {
    it('returns every issue when nothing is selected', () => {
        expect(filterSprintIssuesByStatus(ISSUES, [])).toEqual(ISSUES);
    });

    it('keeps only issues matching any selected status', () => {
        expect(filterSprintIssuesByStatus(ISSUES, ['in progress', 'done']).map(issue => issue.key))
            .toEqual(['PM-1', 'PM-2', 'PM-3']);
    });

    it('matches case-insensitively', () => {
        expect(filterSprintIssuesByStatus(ISSUES, ['  TO DO ']).map(issue => issue.key)).toEqual(['PM-4']);
    });
});

describe('status filter labels', () => {
    it('resolves selected values back to their display labels', () => {
        const options = buildSprintStatusFilterOptions(ISSUES, BOARD_FLOW);

        expect(getStatusFilterLabels(['done', 'to do'], options)).toEqual(['Done', 'To Do']);
    });

    it('summarizes the selection for the dropdown toggle', () => {
        const options = buildSprintStatusFilterOptions(ISSUES, BOARD_FLOW);

        expect(buildStatusFilterSummary([], options)).toBe('All Statuses');
        expect(buildStatusFilterSummary(['done'], options)).toBe('Done');
        expect(buildStatusFilterSummary(['done', 'to do'], options)).toBe('2 statuses');
    });
});

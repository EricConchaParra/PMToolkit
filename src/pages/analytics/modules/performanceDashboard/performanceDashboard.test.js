import { describe, expect, it } from 'vitest';

import { buildCapacityReportCSV, buildDeveloperVelocityRows } from './performanceDashboard.js';

describe('buildCapacityReportCSV', () => {
    it('builds detailed rows with developer, sprint and team totals', () => {
        const csv = buildCapacityReportCSV({
            projectKey: 'PM',
            host: 'jira.example.com',
            spFieldId: 'customfield_10016',
            sprints: [
                {
                    id: 10,
                    name: 'Sprint 1',
                    state: 'closed',
                    startDate: '2026-01-01',
                    endDate: '2026-01-14',
                    issues: [
                        {
                            key: 'PM-1',
                            fields: {
                                summary: 'First ticket',
                                customfield_10016: 3,
                                assignee: { displayName: 'Alice', accountId: 'alice-1', emailAddress: 'alice@example.com' },
                                status: { name: 'Done', statusCategory: { key: 'done' } },
                            },
                        },
                        {
                            key: 'PM-2',
                            fields: {
                                summary: 'Second ticket',
                                customfield_10016: 5,
                                assignee: { displayName: 'Alice', accountId: 'alice-1', emailAddress: 'alice@example.com' },
                                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                            },
                        },
                    ],
                },
                {
                    id: 11,
                    name: 'Sprint 2',
                    state: 'active',
                    startDate: '2026-01-15',
                    endDate: '2026-01-28',
                    issues: [
                        {
                            key: 'PM-3',
                            fields: {
                                summary: 'Third ticket',
                                customfield_10016: 2,
                                assignee: { displayName: 'Bob', accountId: 'bob-1', emailAddress: 'bob@example.com' },
                                status: { name: 'To Do', statusCategory: { key: 'new' } },
                            },
                        },
                    ],
                },
            ],
        });

        const [header, row1, row2, row3] = csv.split('\n');
        expect(header).toContain('Developer Sprint Tickets');
        expect(csv.split('\n')).toHaveLength(4);

        expect(row1).toContain('Sprint 1');
        expect(row1).toContain('Alice');
        expect(row1).toContain('PM-1');
        expect(row1).toContain('alice@example.com');
        expect(row1).toContain(',2,8,2,8,2,8,3,10');

        expect(row2).toContain('PM-2');
        expect(row2).toContain(',2,8,2,8,2,8,3,10');

        expect(row3).toContain('Sprint 2');
        expect(row3).toContain('Bob');
        expect(row3).toContain('PM-3');
        expect(row3).toContain(',1,2,1,2,1,2,3,10');
    });
});

describe('buildDeveloperVelocityRows', () => {
    it('calculates each developer velocity across all sprints, including sprints without their work', () => {
        const rows = buildDeveloperVelocityRows([
            {
                id: 1,
                issues: [
                    { fields: { customfield_10016: 8, assignee: { displayName: 'Alice', accountId: 'alice-1' } } },
                    { fields: { customfield_10016: 1, assignee: { displayName: 'Bob', accountId: 'bob-1' } } },
                ],
            },
            {
                id: 2,
                issues: [
                    { fields: { customfield_10016: 4, assignee: { displayName: 'Alice', accountId: 'alice-1' } } },
                ],
            },
            {
                id: 3,
                issues: [
                    { fields: { customfield_10016: 2, assignee: { displayName: 'Bob', accountId: 'bob-1' } } },
                ],
            },
        ], 'customfield_10016');

        expect(rows.map(row => [row.assignee.displayName, row.velocity, row.totalSP, row.activeSprintCount])).toEqual([
            ['Alice', 4, 12, 2],
            ['Bob', 1, 3, 2],
        ]);
    });
});

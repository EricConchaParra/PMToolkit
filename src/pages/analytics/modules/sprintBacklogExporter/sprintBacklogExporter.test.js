import { describe, expect, it } from 'vitest';

import { buildSprintBacklogCSV } from './sprintBacklogExporter.js';

describe('buildSprintBacklogCSV', () => {
    it('builds a sprint backlog export with the requested columns', () => {
        const csv = buildSprintBacklogCSV([
            {
                key: 'PM-2',
                fields: {
                    summary: 'Second ticket',
                    assignee: { displayName: 'Bob' },
                    status: { name: 'In Progress' },
                    issuetype: { name: 'Bug' },
                    customfield_10011: 'Platform Stability',
                    customfield_10016: 5,
                },
                statusAge: { daysInStatus: 1.5 },
            },
            {
                key: 'PM-1',
                fields: {
                    summary: 'First ticket',
                    assignee: null,
                    status: { name: 'To Do' },
                    issuetype: { name: 'Story' },
                    parent: { fields: { summary: 'Checkout Revamp' } },
                    customfield_10016: 3,
                },
                statusAge: { daysInStatus: 4 },
            },
        ], ['customfield_10016'], 'jira.example.com');

        const rows = csv.split('\n');
        expect(rows[0]).toBe('Key,Summary,Epic,Type,Assignee,Story Points,Status,Time in Status (days),URL');
        expect(rows[1]).toBe('PM-1,First ticket,Checkout Revamp,US,Unassigned,3,To Do,4,https://jira.example.com/browse/PM-1');
        expect(rows[2]).toBe('PM-2,Second ticket,Platform Stability,Bug,Bob,5,In Progress,1.5,https://jira.example.com/browse/PM-2');
    });

    it('keeps all story point candidate values when the field is ambiguous', () => {
        const csv = buildSprintBacklogCSV([
            {
                key: 'PM-3',
                fields: {
                    summary: 'Ambiguous SP ticket',
                    assignee: { displayName: 'Alice' },
                    status: { name: 'Done' },
                    issuetype: { name: 'Task' },
                    customfield_10011: 'Billing Refresh',
                    customfield_10016: 5,
                    customfield_10017: 8,
                },
                statusAge: { daysInStatus: 0.5 },
            },
        ], ['customfield_10016', 'customfield_10017'], 'jira.example.com');

        expect(csv.split('\n')[1]).toContain(',5 | 8,');
    });
});

import { describe, expect, it } from 'vitest';

import {
    buildJiraSnapshotsCSV,
    getJiraSnapshotHeaders,
    getJiraSnapshotJql,
    reconstructSnapshotRowAsOf,
} from './jiraSnapshots.js';

const resolvedFields = {
    storyPointFieldIds: ['customfield_10016'],
    storyPointEstimateFieldIds: ['customfield_10032'],
    acceptanceCriteriaFieldIds: ['customfield_10100'],
    sprintFieldId: 'customfield_10020',
    epicLinkFieldIds: ['customfield_10014'],
    epicNameFieldIds: ['customfield_10011'],
};

const currentIssue = {
    key: 'PM-2',
    fields: {
        summary: 'Refined summary',
        issuetype: { name: 'Story' },
        status: { name: 'Done' },
        resolution: { name: 'Fixed' },
        created: '2026-01-02T10:00:00.000Z',
        updated: '2026-05-25T10:00:00.000Z',
        resolutiondate: '2026-05-20T10:00:00.000Z',
        parent: { key: 'PM-1', fields: { summary: 'Current parent' } },
        customfield_10016: 8,
        customfield_10032: 13,
        customfield_10020: [{ id: 25, name: 'Sprint 25' }],
        customfield_10100: 'Current AC',
        labels: ['analysis'],
        components: [{ name: 'Reporting' }],
        fixVersions: [{ name: 'v1' }],
        priority: { name: 'High' },
        assignee: { displayName: 'Ada Lovelace' },
        reporter: { displayName: 'Maya Chen' },
        description: 'Current description',
    },
};

describe('Jira Snapshots', () => {
    it('reconstructs row values as of the selected date by reverting later changes', () => {
        const row = reconstructSnapshotRowAsOf({
            issue: currentIssue,
            snapshotDate: new Date('2026-01-05T23:59:59.999'),
            host: 'jira.example.com',
            resolvedFields,
            changelog: [
                {
                    created: '2026-05-18T10:00:00.000Z',
                    items: [
                        { field: 'status', fromString: 'In Progress', toString: 'Done' },
                        { field: 'resolution', fromString: '', toString: 'Fixed' },
                    ],
                },
                {
                    created: '2026-01-10T10:00:00.000Z',
                    items: [
                        { field: 'Story Points', fieldId: 'customfield_10016', fromString: '3', toString: '8' },
                        { field: 'summary', fromString: 'Original summary', toString: 'Refined summary' },
                        { field: 'Sprint', fieldId: 'customfield_10020', fromString: '', toString: 'Sprint 25' },
                    ],
                },
                {
                    created: '2026-01-04T10:00:00.000Z',
                    items: [
                        { field: 'status', fromString: 'To Do', toString: 'In Progress' },
                    ],
                },
            ],
        });

        expect(row.snapshot_date).toBe('2026-01-05');
        expect(row.summary).toBe('Original summary');
        expect(row.status).toBe('In Progress');
        expect(row.resolution).toBe('');
        expect(row.resolved).toBe('');
        expect(row.story_points).toBe('3');
        expect(row.sprint_current).toBe('');
        expect(row.issue_url).toBe('https://jira.example.com/browse/PM-2');
    });

    it('builds a CSV with snapshot_date plus the regular snapshot columns', () => {
        const csv = buildJiraSnapshotsCSV([
            {
                issue: currentIssue,
                changelog: [
                    {
                        created: '2026-01-10T10:00:00.000Z',
                        items: [{ field: 'Story Points', fieldId: 'customfield_10016', fromString: '3', toString: '8' }],
                    },
                ],
            },
        ], {
            snapshotDate: new Date('2026-01-05T23:59:59.999'),
            host: 'jira.example.com',
            resolvedFields,
        });

        const rows = csv.split('\n');
        expect(rows[0]).toBe(getJiraSnapshotHeaders().join(','));
        expect(rows[1].startsWith('2026-01-05,PM-2,Refined summary,Story,Done')).toBe(true);
        expect(rows[1]).toContain(',3,13,');
    });

    it('builds project-scoped JQL for issues created by the snapshot date', () => {
        expect(getJiraSnapshotJql('PM "Core"', '2026-01-05')).toBe('project = "PM \\"Core\\"" AND created <= "2026-01-05 23:59" ORDER BY key ASC');
    });
});

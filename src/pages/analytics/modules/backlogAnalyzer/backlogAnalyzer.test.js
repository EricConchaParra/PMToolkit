import { describe, expect, it } from 'vitest';

import {
    buildBacklogHistoryCSV,
    buildBacklogSnapshotCSV,
    resolveBacklogAnalyzerFields,
} from './backlogAnalyzer.js';

describe('Backlog Analyzer CSV builders', () => {
    it('builds a current snapshot with one row per issue', () => {
        const resolvedFields = {
            storyPointFieldIds: ['customfield_10016'],
            storyPointEstimateFieldIds: ['customfield_10032'],
            acceptanceCriteriaFieldIds: ['customfield_10100'],
            sprintFieldId: 'customfield_10020',
            epicLinkFieldIds: ['customfield_10014'],
            epicNameFieldIds: ['customfield_10011'],
        };
        const epicSummaries = new Map([['PM-1', 'Checkout Revamp']]);

        const csv = buildBacklogSnapshotCSV([
            {
                key: 'PM-2',
                fields: {
                    summary: 'Build analyzer',
                    issuetype: { name: 'Story' },
                    status: { name: 'In Progress' },
                    resolution: null,
                    created: '2026-01-05T10:00:00.000Z',
                    updated: '2026-05-25T10:00:00.000Z',
                    resolutiondate: null,
                    parent: { key: 'PM-1', fields: { summary: 'Checkout Revamp' } },
                    customfield_10016: 5,
                    customfield_10032: 8,
                    customfield_10020: [{ id: 12, name: 'Sprint 12' }],
                    customfield_10100: {
                        type: 'doc',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Given a backlog' }] }],
                    },
                    labels: ['analytics', 'backlog'],
                    components: [{ name: 'Reporting' }],
                    fixVersions: [{ name: 'v1.0' }],
                    priority: { name: 'High' },
                    assignee: { displayName: 'Ada Lovelace' },
                    reporter: { displayName: 'Maya Chen' },
                    description: {
                        type: 'doc',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Export two files' }] }],
                    },
                },
            },
        ], { host: 'jira.example.com', resolvedFields, epicSummaries });

        const rows = csv.split('\n');
        expect(rows[0]).toBe('issue_key,summary,issue_type,status,resolution,created,updated,resolved,epic_key,epic_name,parent_key,parent_summary,story_points,story_point_estimate,sprint_current,labels,components,fix_versions,priority,assignee,reporter,acceptance_criteria,description,issue_url');
        expect(rows[1]).toContain('PM-2,Build analyzer,Story,In Progress,,2026-01-05T10:00:00.000Z,2026-05-25T10:00:00.000Z,,PM-1,Checkout Revamp,PM-1,Checkout Revamp,5,8,Sprint 12');
        expect(rows[1]).toContain('analytics | backlog');
        expect(rows[1]).toContain('https://jira.example.com/browse/PM-2');
    });

    it('builds a filtered history export with canonical field names', () => {
        const csv = buildBacklogHistoryCSV([
            {
                key: 'PM-2',
                changelog: [
                    {
                        created: '2026-05-02T11:00:00.000Z',
                        author: { displayName: 'Bob' },
                        items: [
                            { field: 'status', fromString: 'To Do', toString: 'In Progress' },
                            { field: 'Rank', fromString: '1', toString: '2' },
                        ],
                    },
                    {
                        created: '2026-05-01T11:00:00.000Z',
                        author: { displayName: 'Alice' },
                        items: [
                            { field: 'Story Points', fieldId: 'customfield_10016', fromString: '', toString: '5' },
                        ],
                    },
                ],
            },
        ], {
            resolvedFields: {
                storyPointFieldIds: ['customfield_10016'],
            },
        });

        const rows = csv.split('\n');
        expect(rows[0]).toBe('issue_key,changed_at,changed_by,field,from_value,to_value');
        expect(rows[1]).toBe('PM-2,2026-05-01T11:00:00.000Z,Alice,story_points,,5');
        expect(rows[2]).toBe('PM-2,2026-05-02T11:00:00.000Z,Bob,status,To Do,In Progress');
        expect(rows).toHaveLength(3);
    });

    it('resolves field ids from Jira field metadata', () => {
        const resolved = resolveBacklogAnalyzerFields([
            { id: 'customfield_10016', name: 'Story Points' },
            { id: 'customfield_10032', name: 'Story point estimate' },
            { id: 'customfield_10100', name: 'Acceptance Criteria' },
            { id: 'customfield_10020', name: 'Sprint' },
        ], {
            storyPointsResolution: { fieldId: 'customfield_10016' },
            storyPointCandidates: [{ id: 'customfield_10016', name: 'Story Points' }],
            sprintFieldId: 'customfield_10020',
        });

        expect(resolved.storyPointFieldIds).toEqual(['customfield_10016']);
        expect(resolved.storyPointEstimateFieldIds).toEqual(['customfield_10032']);
        expect(resolved.acceptanceCriteriaFieldIds).toEqual(['customfield_10100']);
        expect(resolved.sprintFieldId).toBe('customfield_10020');
    });
});

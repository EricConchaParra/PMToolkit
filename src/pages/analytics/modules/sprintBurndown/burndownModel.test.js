import { describe, expect, it } from 'vitest';
import { buildBurndownModel } from './burndownModel.js';

const SP_FIELD_ID = 'customfield_10016';

function makeIssue({
    key,
    statusName = 'To Do',
    statusCategory = 'new',
    storyPoints = 0,
    created = '2026-05-01T10:00:00.000Z',
} = {}) {
    return {
        key,
        fields: {
            summary: `${key} summary`,
            created,
            status: {
                id: statusName.toLowerCase().replace(/\s+/g, '-'),
                name: statusName,
                statusCategory: { key: statusCategory },
            },
            assignee: {
                displayName: 'Test Dev',
            },
            [SP_FIELD_ID]: storyPoints,
        },
    };
}

describe('buildBurndownModel', () => {
    const sprint = {
        id: 11,
        name: 'Sprint 11',
        state: 'active',
        startDate: '2026-05-01T09:00:00.000Z',
        endDate: '2026-05-05T21:00:00.000Z',
    };

    const statusCatalog = [
        { id: 'to-do', name: 'To Do', categoryKey: 'new' },
        { id: 'in-progress', name: 'In Progress', categoryKey: 'indeterminate' },
        { id: 'done', name: 'Done', categoryKey: 'done' },
    ];

    it('burns remaining points when an issue is completed', () => {
        const issues = [makeIssue({
            key: 'OPS-1',
            statusName: 'Done',
            statusCategory: 'done',
            storyPoints: 5,
        })];

        const changelogsByIssue = {
            'OPS-1': [
                {
                    created: '2026-05-03T15:00:00.000Z',
                    items: [{ field: 'status', fromString: 'In Progress', toString: 'Done', from: 'in-progress', to: 'done' }],
                },
            ],
        };

        const model = buildBurndownModel({
            sprint,
            issues,
            changelogsByIssue,
            statusCatalog,
            spFieldId: SP_FIELD_ID,
            now: '2026-05-04T12:00:00.000Z',
        });

        expect(model.summary.initialCommitmentSp).toBe(5);
        expect(model.summary.remainingSp).toBe(0);
        expect(model.summary.doneSp).toBe(5);
        expect(model.dayPoints.find(point => point.dayKey === '2026-05-03')?.remainingSp).toBe(0);
    });

    it('adds scope when an issue joins the sprint after kickoff', () => {
        const issues = [makeIssue({
            key: 'OPS-2',
            statusName: 'In Progress',
            statusCategory: 'indeterminate',
            storyPoints: 3,
            created: '2026-05-02T08:00:00.000Z',
        })];

        const changelogsByIssue = {
            'OPS-2': [
                {
                    created: '2026-05-02T10:00:00.000Z',
                    items: [{ field: 'Sprint', fromString: '', toString: `id=${sprint.id},name=${sprint.name}` }],
                },
            ],
        };

        const model = buildBurndownModel({
            sprint,
            issues,
            changelogsByIssue,
            statusCatalog,
            spFieldId: SP_FIELD_ID,
            now: '2026-05-02T18:00:00.000Z',
        });

        expect(model.summary.initialCommitmentSp).toBe(0);
        expect(model.summary.currentScopeSp).toBe(3);
        expect(model.summary.remainingSp).toBe(3);
        expect(model.dayPoints.find(point => point.dayKey === '2026-05-02')?.scopeDeltaTodaySp).toBe(3);
    });

    it('restores remaining points when a done issue is reopened', () => {
        const issues = [makeIssue({
            key: 'OPS-3',
            statusName: 'In Progress',
            statusCategory: 'indeterminate',
            storyPoints: 8,
        })];

        const changelogsByIssue = {
            'OPS-3': [
                {
                    created: '2026-05-02T11:00:00.000Z',
                    items: [{ field: 'status', fromString: 'In Progress', toString: 'Done', from: 'in-progress', to: 'done' }],
                },
                {
                    created: '2026-05-04T09:00:00.000Z',
                    items: [{ field: 'status', fromString: 'Done', toString: 'In Progress', from: 'done', to: 'in-progress' }],
                },
            ],
        };

        const model = buildBurndownModel({
            sprint,
            issues,
            changelogsByIssue,
            statusCatalog,
            spFieldId: SP_FIELD_ID,
            now: '2026-05-04T18:00:00.000Z',
        });

        expect(model.summary.remainingSp).toBe(8);
        expect(model.summary.doneSp).toBe(0);
        expect(model.dayPoints.find(point => point.dayKey === '2026-05-04')?.reopenedTodayCount).toBe(1);
    });
});

import { describe, expect, it } from 'vitest';

import {
    buildSprintClosureReportModel,
    getSprintClosureStorageKey,
    normalizeSprintClosureState,
} from './sprintClosureModel.js';

const SPRINT_FIELD_ID = 'customfield_10020';
const SP_FIELD_ID = 'customfield_10016';

function makeSprint(overrides = {}) {
    return {
        id: 10,
        name: 'Sprint 10',
        startDate: '2026-04-01T12:00:00.000Z',
        endDate: '2026-04-14T22:00:00.000Z',
        completeDate: '2026-04-14T22:00:00.000Z',
        ...overrides,
    };
}

function makeIssue({
    key = 'PM-1',
    summary = 'Ticket',
    currentStatus = { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    sp = 3,
    sprintFieldValue = [{ id: 10, name: 'Sprint 10' }],
    changelog = [],
} = {}) {
    return {
        key,
        _sp: sp,
        _changelogHistories: changelog,
        fields: {
            summary,
            status: currentStatus,
            [SPRINT_FIELD_ID]: sprintFieldValue,
        },
    };
}

function sprintChange(created, fromValue, toValue) {
    return {
        created,
        items: [
            {
                field: 'Sprint',
                from: fromValue,
                fromString: fromValue,
                to: toValue,
                toString: toValue,
            },
        ],
    };
}

function statusChange(created, fromStatus, toStatus) {
    return {
        created,
        items: [
            {
                field: 'status',
                fromString: fromStatus,
                toString: toStatus,
            },
        ],
    };
}

function storyPointChange(created, fromValue, toValue) {
    return {
        created,
        items: [
            {
                field: 'Story Points',
                fieldId: SP_FIELD_ID,
                from: String(fromValue ?? ''),
                fromString: String(fromValue ?? ''),
                to: String(toValue ?? ''),
                toString: String(toValue ?? ''),
            },
        ],
    };
}

function buildModel(overrides = {}) {
    return buildSprintClosureReportModel({
        issues: overrides.issues || [],
        sprint: overrides.sprint || makeSprint(),
        nextSprint: overrides.nextSprint || { id: 11, name: 'Sprint 11' },
        reportState: overrides.reportState || {},
        statusCategoryMap: {
            done: 'done',
            'in progress': 'indeterminate',
            'to do': 'new',
            ...(overrides.statusCategoryMap || {}),
        },
        host: 'jira.example.com',
        sprintFieldId: SPRINT_FIELD_ID,
        spFieldId: SP_FIELD_ID,
    });
}

describe('sprintClosureModel', () => {
    it('normalizes storage keys and state', () => {
        expect(getSprintClosureStorageKey('jira.example.atlassian.net', 'PM', 42)).toBe('sprint_report_jira.example.atlassian.net_PM_42');
        expect(normalizeSprintClosureState({ carryoverOverridesByIssue: { 'PM-1': 'included', 'PM-2': 'foo' } }))
            .toEqual({
                observationsByIssue: {},
                currentStatusOverridesByIssue: {},
                carryoverOverridesByIssue: { 'PM-1': 'included' },
                scopeCreepOverridesByIssue: {},
                updatedAt: 0,
            });
    });

    it('does not mark sprint-start tickets as scope creep', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-1',
                    changelog: [
                        sprintChange('2026-03-31T10:00:00.000Z', '', 'id=10,name=Sprint 10'),
                    ],
                }),
            ],
        });

        expect(model.scopeCreep).toHaveLength(0);
        expect(model.summary.scopeCreepSP).toBe(0);
    });

    it('marks tickets added after sprint start as scope creep', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-2',
                    changelog: [
                        sprintChange('2026-04-05T10:00:00.000Z', '', 'id=10,name=Sprint 10'),
                    ],
                }),
            ],
        });

        expect(model.scopeCreep.map(issue => issue.key)).toEqual(['PM-2']);
        expect(model.summary.scopeCreepSP).toBe(3);
        expect(model.summary.committedSP).toBe(0);
    });

    it('counts tickets added without points and estimated later as scope delta', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-3',
                    sp: 5,
                    changelog: [
                        sprintChange('2026-04-04T10:00:00.000Z', '', 'id=10,name=Sprint 10'),
                        storyPointChange('2026-04-04T12:00:00.000Z', 0, 5),
                    ],
                }),
            ],
        });

        expect(model.scopeCreep.map(issue => issue.key)).toEqual(['PM-3']);
        expect(model.scopeCreep[0].scopeDelta).toBe(5);
        expect(model.summary.scopeCreepSP).toBe(5);
    });

    it('includes story point increases on tickets already in sprint', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-3B',
                    sp: 8,
                    changelog: [
                        sprintChange('2026-03-31T10:00:00.000Z', '', 'id=10,name=Sprint 10'),
                        storyPointChange('2026-04-06T12:00:00.000Z', 5, 8),
                    ],
                }),
            ],
        });

        expect(model.scopeCreep.map(issue => issue.key)).toEqual(['PM-3B']);
        expect(model.scopeCreep[0].scopeDelta).toBe(3);
        expect(model.summary.committedSP).toBe(5);
        expect(model.summary.totalSP).toBe(8);
    });

    it('nets added-ticket scope against later story point decreases', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-3C',
                    sp: 5,
                    changelog: [
                        sprintChange('2026-04-05T16:42:00.000Z', '', 'id=10,name=Sprint 10'),
                        storyPointChange('2026-04-05T16:43:00.000Z', 8, 5),
                    ],
                }),
            ],
        });

        expect(model.scopeCreep.map(issue => issue.key)).toEqual(['PM-3C']);
        expect(model.scopeCreep[0].scopeDelta).toBe(5);
        expect(model.summary.scopeCreepSP).toBe(5);
    });

    it('detects carryover when the ticket was not done at close and moved to the next sprint', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-4',
                    sprintFieldValue: [{ id: 10, name: 'Sprint 10' }, { id: 11, name: 'Sprint 11' }],
                    changelog: [
                        sprintChange('2026-03-31T10:00:00.000Z', '', 'id=10,name=Sprint 10'),
                        sprintChange('2026-04-15T09:00:00.000Z', 'id=10,name=Sprint 10', 'id=10,name=Sprint 10,id=11,name=Sprint 11'),
                    ],
                }),
            ],
        });

        expect(model.carryovers.map(issue => issue.key)).toEqual(['PM-4']);
        expect(model.summary.carryoverSP).toBe(3);
    });

    it('does not mark carryover when the issue was done by sprint close', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-5',
                    currentStatus: { name: 'Done', statusCategory: { key: 'done' } },
                    sprintFieldValue: [{ id: 10, name: 'Sprint 10' }, { id: 11, name: 'Sprint 11' }],
                    changelog: [
                        statusChange('2026-04-12T09:00:00.000Z', 'In Progress', 'Done'),
                        sprintChange('2026-04-15T09:00:00.000Z', 'id=10,name=Sprint 10', 'id=10,name=Sprint 10,id=11,name=Sprint 11'),
                    ],
                }),
            ],
        });

        expect(model.carryovers).toHaveLength(0);
    });

    it('supports include, exclude and reset-like default behavior through overrides', () => {
        const issues = [
            makeIssue({
                key: 'PM-6',
                changelog: [sprintChange('2026-04-05T10:00:00.000Z', '', 'id=10,name=Sprint 10')],
            }),
            makeIssue({
                key: 'PM-7',
                changelog: [sprintChange('2026-03-31T10:00:00.000Z', '', 'id=10,name=Sprint 10')],
            }),
        ];

        const model = buildModel({
            issues,
            reportState: {
                scopeCreepOverridesByIssue: {
                    'PM-6': 'excluded',
                    'PM-7': 'included',
                },
            },
        });

        expect(model.scopeCreep.map(issue => issue.key)).toEqual(['PM-7']);
        expect(model.hiddenScopeCreep.map(issue => issue.key)).toEqual(['PM-6']);
    });

    it('applies manual current status overrides to rendered report rows', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-7B',
                    changelog: [
                        sprintChange('2026-04-05T10:00:00.000Z', '', 'id=10,name=Sprint 10'),
                    ],
                }),
            ],
            reportState: {
                currentStatusOverridesByIssue: {
                    'PM-7B': 'Ready for Demo',
                },
            },
        });

        expect(model.scopeCreep[0].currentStatus).toBe('Ready for Demo');
    });

    it('counts missing observations only for included carryovers', () => {
        const model = buildModel({
            issues: [
                makeIssue({
                    key: 'PM-8',
                    sprintFieldValue: [{ id: 10, name: 'Sprint 10' }, { id: 11, name: 'Sprint 11' }],
                    changelog: [
                        sprintChange('2026-03-31T10:00:00.000Z', '', 'id=10,name=Sprint 10'),
                        sprintChange('2026-04-15T09:00:00.000Z', 'id=10,name=Sprint 10', 'id=10,name=Sprint 10,id=11,name=Sprint 11'),
                    ],
                }),
            ],
            reportState: {
                observationsByIssue: {
                    'PM-8': '',
                },
            },
        });

        expect(model.missingObservationCount).toBe(1);
    });
});

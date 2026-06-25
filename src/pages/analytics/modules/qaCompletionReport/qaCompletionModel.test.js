import { describe, expect, it } from 'vitest';

import {
    buildQaCompletionCSV,
    buildQaCompletionReportModel,
    resolveStoryPointsAtTime,
} from './qaCompletionModel.js';

const SP_FIELD = 'customfield_10016';

function makeIssue(key, {
    sp = 0,
    summary = `${key} summary`,
    type = 'Story',
    status = 'Done',
    creator = { accountId: 'creator-1', displayName: 'Creator One' },
    reporter = { accountId: 'reporter-1', displayName: 'Reporter One' },
} = {}) {
    return {
        key,
        _sp: sp,
        fields: {
            summary,
            issuetype: { name: type },
            status: { name: status },
            creator,
            reporter,
            [SP_FIELD]: sp,
        },
    };
}

function history(created, author, items) {
    return {
        created,
        author,
        items,
    };
}

function qaTransition(created, author, overrides = {}) {
    return history(created, author, [{
        field: 'status',
        fromString: overrides.fromString || 'Ready for QA',
        toString: Object.prototype.hasOwnProperty.call(overrides, 'toString') ? overrides.toString : 'QA Completed',
    }]);
}

describe('qaCompletionModel', () => {
    it('attributes one QA completion and builds project totals', () => {
        const changelog = [
            qaTransition('2026-01-10T12:00:00.000Z', { accountId: 'qa-1', displayName: 'Alicia QA' }),
        ];
        const model = buildQaCompletionReportModel({
            projectKey: 'QA',
            host: 'example.atlassian.net',
            spFieldId: SP_FIELD,
            issueResults: [{
                issue: makeIssue('QA-1', { sp: 5 }),
                changelog,
            }],
        });

        expect(model.summary).toEqual({
            analyzedIssues: 1,
            skippedIssues: 0,
            totalTickets: 1,
            totalStoryPoints: 5,
            contributorCount: 1,
        });
        expect(model.contributors[0]).toMatchObject({
            qaName: 'Alicia QA',
            qaAccountId: 'qa-1',
            ticketCount: 1,
            ticketPercent: 100,
            storyPoints: 5,
            storyPointPercent: 100,
        });
        expect(model.details[0]).toMatchObject({
            ticketKey: 'QA-1',
            qaName: 'Alicia QA',
            storyPoints: 5,
            ticketUrl: 'https://example.atlassian.net/browse/QA-1',
        });
    });

    it('calculates percentages across multiple QAs', () => {
        const model = buildQaCompletionReportModel({
            projectKey: 'QA',
            spFieldId: SP_FIELD,
            issueResults: [
                {
                    issue: makeIssue('QA-1', { sp: 5 }),
                    changelog: [qaTransition('2026-01-10T12:00:00.000Z', { accountId: 'qa-1', displayName: 'Alicia QA' })],
                },
                {
                    issue: makeIssue('QA-2', { sp: 3 }),
                    changelog: [qaTransition('2026-01-11T12:00:00.000Z', { accountId: 'qa-2', displayName: 'Bruno QA' })],
                },
                {
                    issue: makeIssue('QA-3', { sp: 2 }),
                    changelog: [qaTransition('2026-01-12T12:00:00.000Z', { accountId: 'qa-2', displayName: 'Bruno QA' })],
                },
            ],
        });

        expect(model.summary.totalTickets).toBe(3);
        expect(model.summary.totalStoryPoints).toBe(10);
        expect(model.contributors).toHaveLength(2);
        expect(model.contributors.find(row => row.qaName === 'Alicia QA')).toMatchObject({
            qaName: 'Alicia QA',
            ticketCount: 1,
            ticketPercent: 33.3,
            storyPoints: 5,
            storyPointPercent: 50,
        });
        expect(model.contributors.find(row => row.qaName === 'Bruno QA')).toMatchObject({
            qaName: 'Bruno QA',
            ticketCount: 2,
            ticketPercent: 66.7,
            storyPoints: 5,
            storyPointPercent: 50,
        });
    });

    it('counts reopened tickets once using the latest qualifying transition', () => {
        const model = buildQaCompletionReportModel({
            projectKey: 'QA',
            spFieldId: SP_FIELD,
            issueResults: [{
                issue: makeIssue('QA-4', { sp: 8 }),
                changelog: [
                    qaTransition('2026-01-10T12:00:00.000Z', { accountId: 'qa-1', displayName: 'Alicia QA' }),
                    history('2026-01-11T12:00:00.000Z', { accountId: 'dev-1', displayName: 'Dev One' }, [{
                        field: 'status',
                        fromString: 'QA Completed',
                        toString: 'Ready for QA',
                    }]),
                    qaTransition('2026-01-12T12:00:00.000Z', { accountId: 'qa-2', displayName: 'Bruno QA' }),
                ],
            }],
        });

        expect(model.summary.totalTickets).toBe(1);
        expect(model.contributors).toHaveLength(1);
        expect(model.contributors[0]).toMatchObject({
            qaName: 'Bruno QA',
            ticketCount: 1,
            storyPoints: 8,
        });
        expect(model.details[0].completedAt).toBe('2026-01-12T12:00:00.000Z');
    });

    it('uses story points at the transition time', () => {
        const issue = makeIssue('QA-5', { sp: 8 });
        const changelog = [
            history('2026-01-09T12:00:00.000Z', { displayName: 'PM' }, [{
                field: 'Story Points',
                fieldId: SP_FIELD,
                fromString: '2',
                toString: '5',
            }]),
            qaTransition('2026-01-10T12:00:00.000Z', { accountId: 'qa-1', displayName: 'Alicia QA' }),
            history('2026-01-11T12:00:00.000Z', { displayName: 'PM' }, [{
                field: 'Story Points',
                fieldId: SP_FIELD,
                fromString: '5',
                toString: '8',
            }]),
        ];

        expect(resolveStoryPointsAtTime(issue, changelog, '2026-01-10T12:00:00.000Z', SP_FIELD)).toBe(5);

        const model = buildQaCompletionReportModel({
            projectKey: 'QA',
            spFieldId: SP_FIELD,
            issueResults: [{ issue, changelog }],
        });

        expect(model.details[0].storyPoints).toBe(5);
        expect(model.summary.totalStoryPoints).toBe(5);
    });

    it('handles missing SP, missing account id, no qualifying transition, and changelog errors', () => {
        const model = buildQaCompletionReportModel({
            projectKey: 'QA',
            spFieldId: SP_FIELD,
            issueResults: [
                {
                    issue: makeIssue('QA-6', { sp: undefined }),
                    changelog: [qaTransition('2026-01-10T12:00:00.000Z', { displayName: 'Display Only' })],
                },
                {
                    issue: makeIssue('QA-7', { sp: 3 }),
                    changelog: [qaTransition('2026-01-10T12:00:00.000Z', { accountId: 'qa-1', displayName: 'Alicia QA' }, { fromString: 'In QA' })],
                },
                {
                    issue: makeIssue('QA-8', { sp: 2 }),
                    error: new Error('Forbidden'),
                    changelog: [],
                },
            ],
        });

        expect(model.summary.analyzedIssues).toBe(3);
        expect(model.summary.skippedIssues).toBe(1);
        expect(model.summary.totalTickets).toBe(1);
        expect(model.summary.totalStoryPoints).toBe(0);
        expect(model.contributors[0]).toMatchObject({
            qaName: 'Display Only',
            qaAccountId: '',
            qaKey: 'Display Only',
        });
    });

    it('builds creator and reporter ticket distributions across analyzed issues', () => {
        const model = buildQaCompletionReportModel({
            projectKey: 'QA',
            spFieldId: SP_FIELD,
            issueResults: [
                {
                    issue: makeIssue('QA-10', {
                        sp: 3,
                        creator: { accountId: 'creator-1', displayName: 'Creator One' },
                        reporter: { accountId: 'reporter-1', displayName: 'Reporter One' },
                    }),
                    changelog: [],
                },
                {
                    issue: makeIssue('QA-11', {
                        sp: 5,
                        creator: { accountId: 'creator-1', displayName: 'Creator One' },
                        reporter: { accountId: 'reporter-2', displayName: 'Reporter Two' },
                    }),
                    changelog: [],
                },
                {
                    issue: makeIssue('QA-12', {
                        sp: 2,
                        creator: { accountId: 'creator-2', displayName: 'Creator Two' },
                        reporter: { accountId: 'reporter-2', displayName: 'Reporter Two' },
                    }),
                    error: new Error('Changelog unavailable'),
                    changelog: [],
                },
            ],
        });

        expect(model.creators).toHaveLength(2);
        expect(model.creators.find(row => row.name === 'Creator One')).toMatchObject({
            ticketCount: 2,
            ticketPercent: 66.7,
            storyPoints: 8,
            storyPointPercent: 80,
        });
        expect(model.creators.find(row => row.name === 'Creator Two')).toMatchObject({
            ticketCount: 1,
            ticketPercent: 33.3,
            storyPoints: 2,
            storyPointPercent: 20,
        });
        expect(model.reporters.find(row => row.name === 'Reporter One')).toMatchObject({
            ticketCount: 1,
            ticketPercent: 33.3,
            storyPoints: 3,
            storyPointPercent: 30,
        });
        expect(model.reporters.find(row => row.name === 'Reporter Two')).toMatchObject({
            ticketCount: 2,
            ticketPercent: 66.7,
            storyPoints: 7,
            storyPointPercent: 70,
        });
    });

    it('builds detail CSV matching model output', () => {
        const model = buildQaCompletionReportModel({
            projectKey: 'QA',
            host: 'example.atlassian.net',
            spFieldId: SP_FIELD,
            issueResults: [{
                issue: makeIssue('QA-9', { sp: 3, summary: 'Comma, summary' }),
                changelog: [qaTransition('2026-01-10T12:00:00.000Z', { accountId: 'qa-1', displayName: 'Alicia QA' })],
            }],
        });

        const csv = buildQaCompletionCSV(model);

        expect(csv.split('\n')).toHaveLength(2);
        expect(csv).toContain('Project Key,Ticket Key,Summary');
        expect(csv).toContain('QA,QA-9,"Comma, summary",Story,Done,Creator One,creator-1,Reporter One,reporter-1,Alicia QA,qa-1,2026-01-10T12:00:00.000Z,3,Ready for QA,QA Completed,https://example.atlassian.net/browse/QA-9');
    });
});

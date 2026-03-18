import { describe, expect, it } from 'vitest';

import { buildFollowupItems } from './followupModel.js';

const NOW = new Date(2026, 2, 17, 18, 0, 0).getTime();

function makeIssue({
    key,
    summary = 'Control tower ticket',
    statusName = 'In Progress',
    statusCategory = 'indeterminate',
    assigneeName = 'Alice',
    assigneeId = 'alice',
    updatedHoursAgo = 1,
    sp = 3,
} = {}) {
    return {
        key,
        _sp: sp,
        _url: `https://jira.example.com/browse/${key}`,
        fields: {
            summary,
            status: {
                name: statusName,
                statusCategory: { key: statusCategory },
            },
            assignee: {
                displayName: assigneeName,
                accountId: assigneeId,
            },
            updated: new Date(NOW - (updatedHoursAgo * 60 * 60 * 1000)).toISOString(),
        },
    };
}

function makePr({
    state = 'open',
    draft = false,
    updatedHoursAgo = 1,
    lastReviewState = null,
} = {}) {
    return {
        url: 'https://github.com/acme/repo/pull/1',
        state,
        draft,
        updatedAt: new Date(NOW - (updatedHoursAgo * 60 * 60 * 1000)).toISOString(),
        requestedReviewers: [],
        lastReviewState,
        lastReviewAt: lastReviewState ? new Date(NOW - (updatedHoursAgo * 60 * 60 * 1000)).toISOString() : null,
        labels: [],
        repo: 'acme/repo',
    };
}

function buildItems(overrides = {}) {
    return buildFollowupItems({
        issues: overrides.issues || [],
        timelinesByKey: overrides.timelinesByKey || {},
        prSnapshotsByKey: overrides.prSnapshotsByKey || {},
        pendingPrKeys: overrides.pendingPrKeys || [],
        notesMap: overrides.notesMap || {},
        remindersMap: overrides.remindersMap || {},
        tagsMap: overrides.tagsMap || {},
        followupMetaMap: overrides.followupMetaMap || {},
        settings: {
            hoursPerDay: 9,
            spHours: { 0: 9, 1: 2.25, 2: 4.5, 3: 9, 5: 18, 8: 27, 13: 45 },
            statusMap: {},
            ...(overrides.settings || {}),
        },
        sprintHoursLeft: overrides.sprintHoursLeft ?? 40,
        now: NOW,
        prSignalsEnabled: overrides.prSignalsEnabled ?? true,
    });
}

describe('buildFollowupItems', () => {
    it('does not duplicate a ticket when notes and PR data coexist', () => {
        const issues = [
            makeIssue({ key: 'PM-1', updatedHoursAgo: 2, statusName: 'In Progress' }),
        ];

        const items = buildItems({
            issues,
            notesMap: { 'PM-1': 'Pending PM follow-up' },
            prSnapshotsByKey: { 'PM-1': makePr({ updatedHoursAgo: 1 }) },
        });

        expect(items).toHaveLength(1);
        expect(new Set(items.map(item => item.key)).size).toBe(1);
        expect(items[0].primarySignal).toBe('tracked-only');
    });

    it('flags in-review work without a PR as needs-pr', () => {
        const issues = [
            makeIssue({ key: 'PM-2', statusName: 'In Review', updatedHoursAgo: 6 }),
        ];

        const items = buildItems({ issues });

        expect(items[0].signals).toContain('needs-pr');
        expect(items[0].primarySignal).toBe('needs-pr');
    });

    it('does not flag needs-pr while PR lookup is still pending', () => {
        const issues = [
            makeIssue({ key: 'PM-2B', statusName: 'In Review', updatedHoursAgo: 6 }),
        ];

        const items = buildItems({
            issues,
            pendingPrKeys: ['PM-2B'],
        });

        expect(items[0].signals).not.toContain('needs-pr');
        expect(items[0].prPending).toBe(true);
    });

    it('flags stale review flow as review-waiting', () => {
        const issues = [
            makeIssue({ key: 'PM-3', statusName: 'In Review', updatedHoursAgo: 30 }),
        ];

        const items = buildItems({
            issues,
            prSnapshotsByKey: {
                'PM-3': makePr({ updatedHoursAgo: 30, lastReviewState: 'CHANGES_REQUESTED' }),
            },
        });

        expect(items[0].signals).toContain('review-waiting');
        expect(items[0].primarySignal).toBe('review-waiting');
    });

    it('flags stagnant implementation flow as frozen', () => {
        const issues = [
            makeIssue({ key: 'PM-4', statusName: 'In Progress', updatedHoursAgo: 30, sp: 1 }),
        ];

        const items = buildItems({
            issues,
            prSnapshotsByKey: { 'PM-4': makePr({ updatedHoursAgo: 30 }) },
        });

        expect(items[0].signals).toContain('frozen');
        expect(items[0].primarySignal).toBe('frozen');
    });

    it('makes manual blocked state dominate other signals', () => {
        const issues = [
            makeIssue({ key: 'PM-5', statusName: 'In Review', updatedHoursAgo: 30 }),
        ];

        const items = buildItems({
            issues,
            followupMetaMap: {
                'PM-5': { state: 'blocked', pinned: false, updatedAt: NOW - 1000 },
            },
        });

        expect(items[0].signals).toEqual(expect.arrayContaining(['blocked', 'needs-pr', 'frozen']));
        expect(items[0].primarySignal).toBe('blocked');
    });

    it('adds capacity-risk to each affected ticket without duplicating rows', () => {
        const issues = [
            makeIssue({ key: 'PM-6', statusName: 'To Do', statusCategory: 'new', updatedHoursAgo: 1, sp: 3 }),
            makeIssue({ key: 'PM-7', statusName: 'To Do', statusCategory: 'new', updatedHoursAgo: 1, sp: 3 }),
        ];

        const items = buildItems({
            issues,
            sprintHoursLeft: 12,
        });

        expect(items).toHaveLength(2);
        expect(items.map(item => item.key)).toEqual(['PM-6', 'PM-7']);
        expect(items.every(item => item.signals.includes('capacity-risk'))).toBe(true);
        expect(items.every(item => item.primarySignal === 'capacity-risk')).toBe(true);
    });

    it('keeps review-waiting as a secondary signal when a stronger one exists', () => {
        const issues = [
            makeIssue({ key: 'PM-8', statusName: 'In Review', updatedHoursAgo: 30 }),
        ];

        const items = buildItems({
            issues,
            followupMetaMap: {
                'PM-8': { state: 'blocked', pinned: false, updatedAt: NOW - 1000 },
            },
            prSnapshotsByKey: {
                'PM-8': makePr({ updatedHoursAgo: 30, lastReviewState: 'COMMENTED' }),
            },
        });

        expect(items[0].primarySignal).toBe('blocked');
        expect(items[0].signals).toContain('review-waiting');
    });
});

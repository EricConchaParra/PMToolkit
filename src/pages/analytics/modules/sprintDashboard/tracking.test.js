import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTagDefsStorageKey, getNotesStorageKey, getReminderStorageKey, getTagsStorageKey } from '../../../../common/jiraStorageKeys.js';
import { createBoardFlow } from '../boardFlow.js';
import { buildIssueTrackingMarkup, renderDevCard } from './devCard.js';
import {
    applyTrackingEventToState,
    buildSprintTagFilterOptions,
    buildSprintTrackingState,
    filterSprintIssuesByTag,
    getSprintTrackingUpdatePlan,
    getTrackingStorageChangeIssueKeys,
    setHost,
    hasSprintTrackingStorageChange,
    normalizeTrackingEventDetail,
    shouldSuppressTrackingStorageRefresh,
} from './sprintDashboard.js';

const BOARD_FLOW = createBoardFlow({
    columnConfig: {
        columns: [
            { name: 'To Do', statuses: [{ id: '1', name: 'To Do' }] },
            { name: 'Build', statuses: [{ id: '2', name: 'In Progress' }] },
            { name: 'Done', statuses: [{ id: '3', name: 'Done' }] },
        ],
    },
});

const HOST = 'jira.example.atlassian.net';

const ORIGINAL_DOCUMENT = global.document;

function makeIssue() {
    return {
        key: 'PM-1',
        _sp: 3,
        fields: {
            summary: 'Wire sprint auto-refresh',
            status: { id: '2', name: 'In Progress' },
            issuetype: {
                name: 'Task',
                iconUrl: 'https://example.atlassian.net/images/icons/issuetypes/task.svg',
            },
            assignee: {
                accountId: 'acc-1',
                displayName: 'Ada Lovelace',
                avatarUrls: {},
            },
        },
    };
}

beforeEach(() => {
    setHost(HOST);
    global.document = {
        createElement(tagName) {
            return {
                tagName: String(tagName || '').toUpperCase(),
                className: '',
                dataset: {},
                innerHTML: '',
            };
        },
    };
});

afterEach(() => {
    global.document = ORIGINAL_DOCUMENT;
});

describe('sprint tracking state', () => {
    it('loads notes, reminders, tags and tag definitions from storage', () => {
        const tracking = buildSprintTrackingState({
            [getTagDefsStorageKey(HOST)]: {
                urgent: { label: 'Urgent', color: 'red' },
            },
            [getNotesStorageKey('PM-1', HOST)]: 'Call out release risk',
            [getReminderStorageKey('PM-1', HOST)]: 1_900_000_000_000,
            [getTagsStorageKey('PM-1', HOST)]: ['Urgent'],
        });

        expect(tracking.notesMap['PM-1']).toBe('Call out release risk');
        expect(tracking.remindersMap['PM-1']).toBe(1_900_000_000_000);
        expect(tracking.tagsMap['PM-1']).toEqual(['Urgent']);
        expect(tracking.tagDefs.urgent).toEqual({ label: 'Urgent', color: 'red' });
    });

    it('treats reminder and tag definition changes as sprint tracking updates', () => {
        expect(hasSprintTrackingStorageChange({
            [getReminderStorageKey('PM-1', HOST)]: { oldValue: null, newValue: 1_900_000_000_000 },
        })).toBe(true);

        expect(hasSprintTrackingStorageChange({
            [getTagDefsStorageKey(HOST)]: { oldValue: {}, newValue: { urgent: { label: 'Urgent', color: 'red' } } },
        })).toBe(true);

        expect(hasSprintTrackingStorageChange({
            'ignored_jira:PM-1': { oldValue: null, newValue: true },
        })).toBe(false);
    });

    it('normalizes drawer tracking payloads before applying them to state', () => {
        expect(normalizeTrackingEventDetail({
            noteText: '  Need PM review  ',
            reminderValue: '2026-04-21T09:00',
            tagLabels: ['Urgent', '', '  Customer  '],
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        })).toEqual({
            noteText: 'Need PM review',
            reminderTs: new Date('2026-04-21T09:00').getTime(),
            tagLabels: ['Urgent', '  Customer  '],
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        });
    });

    it('applies a tracking event into the in-memory sprint state', () => {
        const trackingState = {
            notesMap: { 'PM-1': 'Old note' },
            remindersMap: {},
            tagsMap: {},
            tagDefs: {},
        };

        applyTrackingEventToState(`jira@${HOST}:PM-1`, {
            noteText: 'Updated note',
            reminderTs: 1_900_000_000_000,
            tagLabels: ['Urgent'],
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        }, trackingState);

        expect(trackingState).toEqual({
            notesMap: { 'PM-1': 'Updated note' },
            remindersMap: { 'PM-1': 1_900_000_000_000 },
            tagsMap: { 'PM-1': ['Urgent'] },
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        });
    });
});

describe('incremental sprint tracking updates', () => {
    it('keeps the dashboard incremental for note-only updates', () => {
        const issues = [{ key: 'PM-1' }, { key: 'PM-2' }];
        const previousTracking = {
            notesMap: {},
            remindersMap: {},
            tagsMap: { 'PM-1': ['Urgent'] },
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        };
        const nextTracking = {
            notesMap: { 'PM-1': 'Need PM review' },
            remindersMap: {},
            tagsMap: { 'PM-1': ['Urgent'] },
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        };

        expect(getSprintTrackingUpdatePlan({
            issueKey: 'PM-1',
            issues,
            selectedTagFilter: '',
            previousTracking,
            nextTracking,
        })).toEqual({
            rerenderTagFilter: false,
            rerenderDashboard: false,
            issueVisibleAfter: true,
        });
    });

    it('forces a dashboard rerender when tags change issue visibility under the active filter', () => {
        const issues = [{ key: 'PM-1' }, { key: 'PM-2' }];
        const previousTracking = {
            notesMap: {},
            remindersMap: {},
            tagsMap: { 'PM-1': ['Urgent'] },
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        };
        const nextTracking = {
            notesMap: {},
            remindersMap: {},
            tagsMap: { 'PM-1': ['Customer'] },
            tagDefs: {
                urgent: { label: 'Urgent', color: 'red' },
                customer: { label: 'Customer', color: 'blue' },
            },
        };

        expect(getSprintTrackingUpdatePlan({
            issueKey: 'PM-1',
            issues,
            selectedTagFilter: 'Urgent',
            previousTracking,
            nextTracking,
        })).toEqual({
            rerenderTagFilter: true,
            rerenderDashboard: true,
            issueVisibleAfter: false,
        });
    });

    it('does not request a full rerender for reminder-only updates', () => {
        const issues = [{ key: 'PM-1' }];
        const previousTracking = {
            notesMap: {},
            remindersMap: {},
            tagsMap: {},
            tagDefs: {},
        };
        const nextTracking = {
            notesMap: {},
            remindersMap: { 'PM-1': 1_900_000_000_000 },
            tagsMap: {},
            tagDefs: {},
        };

        expect(getSprintTrackingUpdatePlan({
            issueKey: 'PM-1',
            issues,
            selectedTagFilter: '',
            previousTracking,
            nextTracking,
        })).toEqual({
            rerenderTagFilter: false,
            rerenderDashboard: false,
            issueVisibleAfter: true,
        });
    });

    it('extracts changed tracking issue keys from storage changes', () => {
        expect(Array.from(getTrackingStorageChangeIssueKeys({
            [getNotesStorageKey('PM-1', HOST)]: { oldValue: '', newValue: 'Note' },
            [getReminderStorageKey('PM-2', HOST)]: { oldValue: null, newValue: 1_900_000_000_000 },
            [getTagDefsStorageKey(HOST)]: { oldValue: {}, newValue: {} },
        }))).toEqual(['PM-1', 'PM-2']);
    });

    it('suppresses storage refreshes that are already covered by a direct tracking event', () => {
        const recentUpdates = new Map([
            ['PM-1', 2_000],
        ]);

        expect(shouldSuppressTrackingStorageRefresh({
            [getNotesStorageKey('PM-1', HOST)]: { oldValue: '', newValue: 'Note' },
        }, recentUpdates, 1_500)).toBe(true);

        expect(shouldSuppressTrackingStorageRefresh({
            [getNotesStorageKey('PM-1', HOST)]: { oldValue: '', newValue: 'Note' },
        }, recentUpdates, 2_500)).toBe(false);

        expect(shouldSuppressTrackingStorageRefresh({
            [getNotesStorageKey('PM-2', HOST)]: { oldValue: '', newValue: 'Other note' },
        }, recentUpdates, 1_500)).toBe(false);
    });
});

describe('sprint tag filter', () => {
    it('builds tag options with No Filter and Any Tag before the sprint tag list', () => {
        const options = buildSprintTagFilterOptions(
            [
                { key: 'PM-1' },
                { key: 'PM-2' },
            ],
            {
                tagsMap: {
                    'PM-1': ['Urgent', 'Customer'],
                    'PM-2': ['Customer'],
                },
                tagDefs: {
                    urgent: { label: 'Urgent', color: 'red' },
                    customer: { label: 'Customer', color: 'blue' },
                    blocked: { label: 'Blocked', color: 'yellow' },
                },
            },
        );

        expect(options).toEqual([
            { value: '', label: 'No Filter' },
            { value: '__any_tag__', label: 'Any Tag' },
            { value: 'customer', label: 'Customer' },
            { value: 'urgent', label: 'Urgent' },
        ]);
    });

    it('filters sprint issues by Any Tag or a specific tag and leaves all issues for No Filter', () => {
        const issues = [
            { key: 'PM-1' },
            { key: 'PM-2' },
            { key: 'PM-3' },
        ];

        expect(filterSprintIssuesByTag(issues, '__any_tag__', {
            tagsMap: {
                'PM-1': ['Urgent'],
                'PM-2': ['Customer'],
            },
        })).toEqual([{ key: 'PM-1' }, { key: 'PM-2' }]);

        expect(filterSprintIssuesByTag(issues, 'Urgent', {
            tagsMap: {
                'PM-1': ['Urgent'],
                'PM-2': ['Customer'],
            },
        })).toEqual([{ key: 'PM-1' }]);

        expect(filterSprintIssuesByTag(issues, '', { tagsMap: {} })).toEqual(issues);
    });
});

describe('issue tracking markup', () => {
    it('builds note, reminder and tag fragments for a tracked issue', () => {
        const trackingMarkup = buildIssueTrackingMarkup('PM-1', {
            notesMap: { 'PM-1': 'Need PM review' },
            remindersMap: { 'PM-1': 1_900_000_000_000 },
            tagsMap: { 'PM-1': ['Urgent'] },
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        }, new Date('2026-04-09T12:00:00.000Z').getTime());

        expect(trackingMarkup.noteHtml).toContain('Need PM review');
        expect(trackingMarkup.reminderHtml).toContain('sprint-reminder-pill');
        expect(trackingMarkup.tagRowHtml).toContain('Urgent');
        expect(trackingMarkup.notesButtonClassName).toContain('has-note');
    });

    it('drops all tracking fragments when the issue no longer has content', () => {
        const trackingMarkup = buildIssueTrackingMarkup('PM-1', {
            notesMap: {},
            remindersMap: {},
            tagsMap: {},
            tagDefs: {},
        });

        expect(trackingMarkup.noteHtml).toBe('');
        expect(trackingMarkup.reminderHtml).toBe('');
        expect(trackingMarkup.tagRowHtml).toBe('');
        expect(trackingMarkup.notesButtonClassName).toBe('et-notes-btn');
    });
});

describe('renderDevCard', () => {
    it('renders reminder pills and tracked note state on first paint', () => {
        const issue = makeIssue();
        const card = renderDevCard(
            {
                assignee: issue.fields.assignee,
                issues: [issue],
                velocity: { avg: 5, sprints: [{ sprintId: 1, name: 'Sprint 1', sp: 5 }], trend: 'same' },
            },
            '2099-04-20T20:00:00.000Z',
            {
                hoursPerDay: 9,
                spHours: { 0: 9, 1: 2.25, 2: 4.5, 3: 9, 5: 18, 8: 27, 13: 45 },
            },
            'example.atlassian.net',
            {
                notesMap: { 'PM-1': 'Need PM review' },
                remindersMap: { 'PM-1': 1_900_000_000_000 },
                tagsMap: { 'PM-1': ['Urgent'] },
                tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
            },
            BOARD_FLOW,
        );

        expect(card.innerHTML).toContain('sprint-reminder-pill');
        expect(card.innerHTML).toContain('Need PM review');
        expect(card.innerHTML).toContain('Urgent');
        expect(card.innerHTML).toContain('et-notes-btn has-note');
    });

    it('renders issue actions in the header before the summary block', () => {
        const issue = makeIssue();
        const card = renderDevCard(
            {
                assignee: issue.fields.assignee,
                issues: [issue],
                velocity: { avg: 5, sprints: [{ sprintId: 1, name: 'Sprint 1', sp: 5 }], trend: 'same' },
            },
            '2099-04-20T20:00:00.000Z',
            {
                hoursPerDay: 9,
                spHours: { 0: 9, 1: 2.25, 2: 4.5, 3: 9, 5: 18, 8: 27, 13: 45 },
            },
            'example.atlassian.net',
            {
                notesMap: {},
                remindersMap: {},
                tagsMap: {},
                tagDefs: {},
            },
            BOARD_FLOW,
        );

        expect(card.innerHTML).toContain('issue-chip-header');
        expect(card.innerHTML).toContain('issue-chip-type-icon');
        expect(card.innerHTML.indexOf('issue-chip-actions')).toBeLessThan(card.innerHTML.indexOf('issue-chip-summary'));
    });
});

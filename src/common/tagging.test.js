import { describe, expect, it } from 'vitest';

import {
    matchesSearchTerm,
    parseTrackingStorage,
} from './tagging.js';
import {
    getMetaStorageKey,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagDefsStorageKey,
    getTagsStorageKey,
} from './jiraStorageKeys.js';

describe('matchesSearchTerm', () => {
    it('matches note tags from the main popup search input', () => {
        expect(matchesSearchTerm({
            key: 'PM-123',
            text: 'Draft the release plan',
            meta: {
                summary: 'Release checklist',
                assignee: 'Eric Concha',
            },
            tags: ['Ask if ready', 'Spike'],
        }, 'spike')).toBe(true);
    });
});

describe('parseTrackingStorage', () => {
    it('scopes notes and tags to the requested Jira host', () => {
        const firstHost = 'alpha.atlassian.net';
        const secondHost = 'beta.atlassian.net';
        const parsed = parseTrackingStorage({
            [getTagDefsStorageKey(firstHost)]: {
                urgent: { label: 'Urgent', color: 'red' },
            },
            [getNotesStorageKey('PM-1', firstHost)]: 'First host note',
            [getReminderStorageKey('PM-1', firstHost)]: 1_900_000_000_000,
            [getTagsStorageKey('PM-1', firstHost)]: ['Urgent'],
            [getMetaStorageKey('PM-1', firstHost)]: { summary: 'Alpha summary' },
            [getNotesStorageKey('PM-1', secondHost)]: 'Second host note',
        }, { host: firstHost });

        expect(parsed.allKeys).toEqual(['PM-1']);
        expect(parsed.notesMap['PM-1']).toBe('First host note');
        expect(parsed.remindersMap['PM-1']).toBe(1_900_000_000_000);
        expect(parsed.tagsMap['PM-1']).toEqual(['Urgent']);
        expect(parsed.metaMap['PM-1']).toEqual({ summary: 'Alpha summary' });
        expect(parsed.tagDefs.urgent).toEqual({ label: 'Urgent', color: 'red' });
    });
});

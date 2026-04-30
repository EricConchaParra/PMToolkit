import { describe, expect, it } from 'vitest';

import {
    buildJiraTrackingStorageKeys,
    getIgnoredStorageKey,
    getMetaStorageKey,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagDefsStorageKey,
    getTagsStorageKey,
} from './jiraStorageKeys.js';

describe('buildJiraTrackingStorageKeys', () => {
    it('returns scoped and legacy tracking keys for a Jira host', () => {
        const host = 'alpha.atlassian.net';
        const issueKey = 'PM-123';
        const keys = buildJiraTrackingStorageKeys(issueKey, host);

        expect(keys.notesKey).toBe(getNotesStorageKey(issueKey, host));
        expect(keys.reminderKey).toBe(getReminderStorageKey(issueKey, host));
        expect(keys.tagsKey).toBe(getTagsStorageKey(issueKey, host));
        expect(keys.metaKey).toBe(getMetaStorageKey(issueKey, host));
        expect(keys.ignoredKey).toBe(getIgnoredStorageKey(issueKey, host));
        expect(keys.tagDefsKey).toBe(getTagDefsStorageKey(host));
        expect(keys.legacy).toEqual({
            notesKey: getNotesStorageKey(issueKey),
            reminderKey: getReminderStorageKey(issueKey),
            tagsKey: getTagsStorageKey(issueKey),
            metaKey: getMetaStorageKey(issueKey),
            ignoredKey: getIgnoredStorageKey(issueKey),
            tagDefsKey: getTagDefsStorageKey(''),
        });
    });

    it('returns only legacy-compatible keys when there is no host context', () => {
        const issueKey = 'PM-123';
        const keys = buildJiraTrackingStorageKeys(issueKey);

        expect(keys.notesKey).toBe(getNotesStorageKey(issueKey));
        expect(keys.reminderKey).toBe(getReminderStorageKey(issueKey));
        expect(keys.tagsKey).toBe(getTagsStorageKey(issueKey));
        expect(keys.metaKey).toBe(getMetaStorageKey(issueKey));
        expect(keys.ignoredKey).toBe(getIgnoredStorageKey(issueKey));
        expect(keys.tagDefsKey).toBe(getTagDefsStorageKey(''));
        expect(keys.legacy).toBeNull();
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageData = {};

vi.mock('./storage.js', () => ({
    storage: {
        get: vi.fn(async keys => {
            if (Array.isArray(keys)) {
                return keys.reduce((acc, key) => {
                    if (Object.prototype.hasOwnProperty.call(storageData, key)) acc[key] = storageData[key];
                    return acc;
                }, {});
            }
            if (typeof keys === 'string') {
                return Object.prototype.hasOwnProperty.call(storageData, keys) ? { [keys]: storageData[keys] } : {};
            }
            return {};
        }),
        set: vi.fn(async payload => {
            Object.assign(storageData, payload);
        }),
        remove: vi.fn(async keys => {
            const keysToDelete = Array.isArray(keys) ? keys : [keys];
            keysToDelete.forEach(key => delete storageData[key]);
        }),
    },
}));

import {
    clearStoryPointsFieldCache,
    resolveStoryPointsField,
    saveJiraFieldOverride,
} from './jiraStoryPointsField.js';

function resetStorageData() {
    Object.keys(storageData).forEach(key => delete storageData[key]);
}

describe('resolveStoryPointsField', () => {
    beforeEach(() => {
        resetStorageData();
        clearStoryPointsFieldCache();
    });

    it('resolves an exact Story Points alias', async () => {
        const resolution = await resolveStoryPointsField('acme.atlassian.net', {
            fields: [
                { id: 'customfield_10010', name: 'Story Points', schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
            ],
        });

        expect(resolution).toEqual({
            fieldId: 'customfield_10010',
            fieldName: 'Story Points',
            source: 'auto',
            warning: '',
        });
    });

    it('resolves the story point estimate alias case-insensitively', async () => {
        const resolution = await resolveStoryPointsField('acme.atlassian.net', {
            fields: [
                { id: 'customfield_10011', name: 'story point estimate', schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
            ],
        });

        expect(resolution.fieldId).toBe('customfield_10011');
        expect(resolution.fieldName).toBe('story point estimate');
        expect(resolution.source).toBe('auto');
    });

    it('uses a clear heuristic winner when no exact alias exists', async () => {
        const resolution = await resolveStoryPointsField('acme.atlassian.net', {
            fields: [
                { id: 'summary', name: 'Summary', schema: { type: 'string' } },
                { id: 'customfield_10012', name: 'Story Points Estimated', schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
                { id: 'customfield_10013', name: 'Story Point Notes', schema: { type: 'string', custom: 'textarea' } },
            ],
        });

        expect(resolution.fieldId).toBe('customfield_10012');
        expect(resolution.source).toBe('auto');
    });

    it('marks multiple plausible candidates as ambiguous', async () => {
        const resolution = await resolveStoryPointsField('acme.atlassian.net', {
            fields: [
                { id: 'customfield_10014', name: 'Story Point Estimate', schema: { type: 'number', custom: 'float' } },
                { id: 'customfield_10015', name: 'Story Points Estimated', schema: { type: 'number', custom: 'float' } },
            ],
        });

        expect(resolution.fieldId).toBeNull();
        expect(resolution.source).toBe('ambiguous');
        expect(resolution.warning).toContain('Multiple Story Points fields were found');
    });

    it('prefers the saved override for the site', async () => {
        await saveJiraFieldOverride('acme.atlassian.net', 'customfield_10016');

        const resolution = await resolveStoryPointsField('acme.atlassian.net', {
            fields: [
                { id: 'customfield_10016', name: 'SP Company Field', schema: { type: 'number', custom: 'float' } },
                { id: 'customfield_10017', name: 'Story Points', schema: { type: 'number', custom: 'float' } },
            ],
        });

        expect(resolution).toEqual({
            fieldId: 'customfield_10016',
            fieldName: 'SP Company Field',
            source: 'override',
            warning: '',
        });
    });

    it('keeps cache isolated by Jira host', async () => {
        const first = await resolveStoryPointsField('alpha.atlassian.net', {
            fields: [
                { id: 'customfield_10018', name: 'Story Points', schema: { type: 'number', custom: 'float' } },
            ],
        });
        const second = await resolveStoryPointsField('beta.atlassian.net', {
            fields: [
                { id: 'customfield_10019', name: 'Story point estimate', schema: { type: 'number', custom: 'float' } },
            ],
        });

        expect(first.fieldId).toBe('customfield_10018');
        expect(second.fieldId).toBe('customfield_10019');
    });
});

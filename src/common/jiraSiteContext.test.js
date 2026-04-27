import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageData = {};

vi.mock('./storage.js', () => ({
    storage: {
        get: vi.fn(async (keys) => {
            if (keys == null) return { ...storageData };
            if (Array.isArray(keys)) {
                return keys.reduce((acc, key) => {
                    if (Object.prototype.hasOwnProperty.call(storageData, key)) acc[key] = storageData[key];
                    return acc;
                }, {});
            }
            if (typeof keys === 'object') {
                return Object.entries(keys).reduce((acc, [key, fallback]) => {
                    acc[key] = Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : fallback;
                    return acc;
                }, {});
            }
            return Object.prototype.hasOwnProperty.call(storageData, keys) ? { [keys]: storageData[keys] } : {};
        }),
        set: vi.fn(async payload => {
            Object.assign(storageData, payload);
        }),
        remove: vi.fn(async keys => {
            const keysToDelete = Array.isArray(keys) ? keys : [keys];
            keysToDelete.forEach(key => {
                delete storageData[key];
            });
        }),
        getAll: vi.fn(async () => ({ ...storageData })),
    },
}));

import { forgetJiraHost } from './jiraSiteContext.js';
import {
    ACTIVE_JIRA_HOST_STORAGE_KEY,
    JIRA_MULTISITE_MIGRATION_KEY,
    JIRA_SITES_STORAGE_KEY,
    PENDING_ALERTS_STORAGE_KEY,
    getJiraProjectSettingsStorageKey,
    getLastProjectStorageKey,
    getManualMenuStorageKey,
    getMetaStorageKey,
    getNotesStorageKey,
    getSprintClosureStorageKey,
    getTagDefsStorageKey,
    getTagsStorageKey,
    getTicketCacheStorageKey,
} from './jiraStorageKeys.js';

function resetStorageData() {
    Object.keys(storageData).forEach(key => delete storageData[key]);
}

describe('forgetJiraHost', () => {
    beforeEach(() => {
        resetStorageData();
    });

    it('removes host-scoped data and reassigns the active host', async () => {
        const alphaHost = 'alpha.atlassian.net';
        const betaHost = 'beta.atlassian.net';

        Object.assign(storageData, {
            [JIRA_MULTISITE_MIGRATION_KEY]: true,
            [JIRA_SITES_STORAGE_KEY]: [alphaHost, betaHost],
            [ACTIVE_JIRA_HOST_STORAGE_KEY]: alphaHost,
            [PENDING_ALERTS_STORAGE_KEY]: [
                `jira@${alphaHost}:PM-1`,
                `jira@${betaHost}:PM-2`,
            ],
            [getTagDefsStorageKey(alphaHost)]: { launch: { label: 'Launch', color: 'orange' } },
            [getManualMenuStorageKey(alphaHost)]: [{ name: 'Alpha only' }],
            [getLastProjectStorageKey(alphaHost)]: 'PM',
            [getJiraProjectSettingsStorageKey(alphaHost, 'PM')]: { board: 'alpha' },
            [getSprintClosureStorageKey(alphaHost, 'PM', 7)]: { complete: true },
            [getTicketCacheStorageKey('PM-1', alphaHost)]: { summary: 'Alpha cache' },
            [getNotesStorageKey('PM-1', alphaHost)]: 'Alpha note',
            [getTagsStorageKey('PM-1', alphaHost)]: ['Launch'],
            [getMetaStorageKey('PM-1', alphaHost)]: { summary: 'Alpha meta' },
            [getNotesStorageKey('PM-2', betaHost)]: 'Beta note',
        });

        const result = await forgetJiraHost(alphaHost);

        expect(result).toEqual({
            hosts: [betaHost],
            activeHost: betaHost,
            removed: true,
        });
        expect(storageData[JIRA_SITES_STORAGE_KEY]).toEqual([betaHost]);
        expect(storageData[ACTIVE_JIRA_HOST_STORAGE_KEY]).toBe(betaHost);
        expect(storageData[PENDING_ALERTS_STORAGE_KEY]).toEqual([`jira@${betaHost}:PM-2`]);
        expect(storageData[getNotesStorageKey('PM-2', betaHost)]).toBe('Beta note');
        expect(storageData[getTagDefsStorageKey(alphaHost)]).toBeUndefined();
        expect(storageData[getManualMenuStorageKey(alphaHost)]).toBeUndefined();
        expect(storageData[getLastProjectStorageKey(alphaHost)]).toBeUndefined();
        expect(storageData[getJiraProjectSettingsStorageKey(alphaHost, 'PM')]).toBeUndefined();
        expect(storageData[getSprintClosureStorageKey(alphaHost, 'PM', 7)]).toBeUndefined();
        expect(storageData[getTicketCacheStorageKey('PM-1', alphaHost)]).toBeUndefined();
        expect(storageData[getNotesStorageKey('PM-1', alphaHost)]).toBeUndefined();
        expect(storageData[getTagsStorageKey('PM-1', alphaHost)]).toBeUndefined();
        expect(storageData[getMetaStorageKey('PM-1', alphaHost)]).toBeUndefined();
    });
});

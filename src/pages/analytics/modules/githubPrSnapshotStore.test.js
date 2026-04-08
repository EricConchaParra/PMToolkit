import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../common/githubApi.js', () => ({
    githubFetch: vi.fn(),
}));

const storageData = {};

vi.mock('../../../common/storage.js', () => ({
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
        set: vi.fn(async (payload) => {
            Object.assign(storageData, payload);
        }),
        remove: vi.fn(async (keys) => {
            const keysToDelete = Array.isArray(keys) ? keys : [keys];
            keysToDelete.forEach(key => {
                delete storageData[key];
            });
        }),
    },
}));

import { githubFetch } from '../../../common/githubApi.js';
import {
    clearPrSnapshotCache,
    getGithubAvailabilityState,
    getPrSnapshot,
    getPrSnapshots,
    resolveGithubPrBatch,
    subscribeGithubAvailability,
} from '../../../common/githubPrPoolService.js';

const mockedGithubFetch = vi.mocked(githubFetch);

function resetStorageData() {
    Object.keys(storageData).forEach(key => delete storageData[key]);
}

function mockPrLookup(ticketKey = 'MMZ-1') {
    mockedGithubFetch.mockImplementation(async path => {
        if (String(path).startsWith('/search/issues')) {
            return {
                items: [{
                    title: `[${ticketKey}] Update`,
                    body: '',
                    updated_at: '2026-03-17T20:00:00.000Z',
                    html_url: 'https://github.com/acme/repo/pull/1',
                    pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/1' },
                    labels: [{ name: 'capacity-risk' }],
                }],
            };
        }

        if (path === 'https://api.github.com/repos/acme/repo/pulls/1') {
            return {
                url: path,
                html_url: 'https://github.com/acme/repo/pull/1',
                state: 'open',
                draft: false,
                merged_at: null,
                updated_at: '2026-03-17T20:00:00.000Z',
                title: `[${ticketKey}] Update`,
                body: '',
                labels: [{ name: 'capacity-risk' }, { name: 'in-review' }],
                requested_reviewers: [{ login: 'alice' }],
                base: { repo: { full_name: 'acme/repo' } },
                head: { ref: `${ticketKey.toLowerCase()}-branch` },
            };
        }

        throw new Error(`Unexpected path ${path}`);
    });
}

describe('githubPrPoolService', () => {
    beforeEach(async () => {
        vi.useRealTimers();
        resetStorageData();
        mockedGithubFetch.mockReset();
        await clearPrSnapshotCache();
    });

    it('deduplicates concurrent requests for the same ticket', async () => {
        mockPrLookup('MMZ-1');

        const [first, second] = await Promise.all([
            getPrSnapshot('MMZ-1', 'token'),
            getPrSnapshot('MMZ-1', 'token'),
        ]);

        expect(first).toEqual(second);
        expect(first.labels).toEqual(['capacity-risk', 'in-review']);
        expect(mockedGithubFetch).toHaveBeenCalledTimes(2);
    });

    it('re-fetches after clearing the shared cache', async () => {
        mockPrLookup('MMZ-2');

        await getPrSnapshot('MMZ-2', 'token');
        await clearPrSnapshotCache();
        await getPrSnapshot('MMZ-2', 'token');

        expect(mockedGithubFetch).toHaveBeenCalledTimes(4);
    });

    it('expires cached not-found results so a later PR can be discovered', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

        mockedGithubFetch.mockImplementation(async path => {
            if (String(path).startsWith('/search/issues')) {
                return { items: [] };
            }
            throw new Error(`Unexpected path ${path}`);
        });

        const firstResult = await getPrSnapshot('MMZ-2A', 'token');
        expect(firstResult).toBeNull();
        expect(mockedGithubFetch).toHaveBeenCalledTimes(2);

        const secondResult = await getPrSnapshot('MMZ-2A', 'token');
        expect(secondResult).toBeNull();
        expect(mockedGithubFetch).toHaveBeenCalledTimes(2);

        mockPrLookup('MMZ-2A');
        await vi.advanceTimersByTimeAsync((10 * 60 * 1000) + 1);

        const refreshedResult = await getPrSnapshot('MMZ-2A', 'token');
        expect(refreshedResult?.url).toBe('https://github.com/acme/repo/pull/1');
        expect(mockedGithubFetch.mock.calls.length).toBeGreaterThan(2);
    });

    it('blocks the session after a 403 and stops later ticket fetches', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

        const forbidden = new Error('GitHub API 403');
        forbidden.status = 403;
        forbidden.responseText = 'API rate limit exceeded';
        forbidden.headers = { reset: null, remaining: '0', retryAfter: null };
        mockedGithubFetch.mockRejectedValue(forbidden);

        const snapshots = await getPrSnapshots(['MMZ-3', 'MMZ-4'], 'token');

        expect(snapshots['MMZ-3']).toBeUndefined();
        expect([undefined, null]).toContain(snapshots['MMZ-4']);
        expect(mockedGithubFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(getGithubAvailabilityState()).toMatchObject({
            blocked: true,
            reason: 'Blocked: GitHub search rate limit reached',
            status: 'blocked',
            bucket: 'search',
            pendingKeys: ['MMZ-3', 'MMZ-4'],
        });

        const blockedCallCount = mockedGithubFetch.mock.calls.length;
        await getPrSnapshot('MMZ-5', 'token');
        expect(mockedGithubFetch.mock.calls.length).toBe(blockedCallCount);
    });

    it('auto-recovers after the GitHub reset window and notifies listeners', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

        const forbidden = new Error('GitHub API 403');
        forbidden.status = 403;
        forbidden.responseText = 'API rate limit exceeded';
        forbidden.headers = { reset: String(Math.floor(Date.now() / 1000) + 30), remaining: '0', retryAfter: null };
        mockedGithubFetch.mockRejectedValue(forbidden);

        const states = [];
        const unsubscribe = subscribeGithubAvailability(state => {
            states.push({ blocked: state.blocked, retryAt: state.retryAt });
        });

        await getPrSnapshot('MMZ-7', 'token');
        expect(getGithubAvailabilityState().blocked).toBe(true);

        await vi.advanceTimersByTimeAsync(30 * 1000);

        expect(getGithubAvailabilityState()).toMatchObject({
            blocked: false,
            reason: '',
            status: 'available',
            retryAt: null,
            retryInMs: null,
            pendingKeys: [],
            bucket: null,
        });
        expect(states.some(state => state.blocked === true)).toBe(true);
        expect(states.some(state => state.blocked === false)).toBe(true);

        unsubscribe();
    });

    it('retries a previously rate-limited ticket after recovery instead of reusing cached null', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

        const forbidden = new Error('GitHub API 403');
        forbidden.status = 403;
        forbidden.responseText = 'API rate limit exceeded';
        forbidden.headers = { reset: String(Math.floor(Date.now() / 1000) + 30), remaining: '0', retryAfter: null };

        mockedGithubFetch.mockRejectedValueOnce(forbidden);
        const firstResult = await getPrSnapshot('MMZ-8', 'token');
        expect(firstResult).toBeNull();
        expect(getGithubAvailabilityState().blocked).toBe(true);

        mockPrLookup('MMZ-8');
        await vi.advanceTimersByTimeAsync(30 * 1000);

        const recoveredResult = await getPrSnapshot('MMZ-8', 'token');
        expect(recoveredResult?.url).toBe('https://github.com/acme/repo/pull/1');
    });

    it('retries when rate limit happens during PR detail fetch', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

        const forbidden = new Error('GitHub API 403');
        forbidden.status = 403;
        forbidden.responseText = 'API rate limit exceeded';
        forbidden.headers = { reset: String(Math.floor(Date.now() / 1000) + 30), remaining: '0', retryAfter: null };

        mockedGithubFetch.mockImplementation(async path => {
            if (String(path).startsWith('/search/issues')) {
                return {
                    items: [{
                        title: '[MMZ-9] Update',
                        body: '',
                        updated_at: '2026-03-17T20:00:00.000Z',
                        html_url: 'https://github.com/acme/repo/pull/1',
                        pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/1' },
                        labels: [{ name: 'capacity-risk' }],
                    }],
                };
            }
            throw forbidden;
        });

        const firstResult = await getPrSnapshot('MMZ-9', 'token');
        expect(firstResult).toBeNull();
        expect(getGithubAvailabilityState().blocked).toBe(true);

        mockPrLookup('MMZ-9');
        await vi.advanceTimersByTimeAsync(30 * 1000);

        const recoveredResult = await getPrSnapshot('MMZ-9', 'token');
        expect(recoveredResult?.url).toBe('https://github.com/acme/repo/pull/1');
    });

    it('surfaces invalid token state after a 401', async () => {
        const unauthorized = new Error('GitHub API 401');
        unauthorized.status = 401;
        unauthorized.responseText = 'bad credentials';
        mockedGithubFetch.mockRejectedValue(unauthorized);

        const snapshot = await getPrSnapshot('MMZ-6', 'token');

        expect(snapshot).toBeNull();
        expect(getGithubAvailabilityState()).toMatchObject({
            blocked: true,
            reason: 'Blocked: invalid GitHub token',
            status: 'blocked',
            retryAt: null,
            retryInMs: null,
            bucket: 'search',
            pendingKeys: ['MMZ-6'],
        });
    });

    it('marks unresolved tickets as confirmed not found after a clean repo batch', async () => {
        mockedGithubFetch.mockImplementation(async path => {
            if (String(path).startsWith('/repos/acme/repo/pulls?state=open')) return [];
            if (String(path).startsWith('/repos/acme/repo/pulls?state=closed')) return [];
            throw new Error(`Unexpected path ${path}`);
        });

        const result = await resolveGithubPrBatch({
            ticketKeys: ['MMZ-430'],
            token: 'token',
            repos: ['acme/repo'],
            allowGlobalFallback: false,
        });

        expect(result.snapshotsByKey['MMZ-430']).toBeNull();
        expect(result.notFoundKeys).toEqual(['MMZ-430']);
        expect(result.pendingKeys).toEqual([]);
    });

    it('does not match a repo PR for MMZ-408 when looking up MMZ-40', async () => {
        mockedGithubFetch.mockImplementation(async path => {
            if (String(path).startsWith('/repos/acme/repo/pulls?state=open')) {
                return [{
                    html_url: 'https://github.com/acme/repo/pull/408',
                    url: 'https://api.github.com/repos/acme/repo/pulls/408',
                    state: 'open',
                    draft: false,
                    merged_at: null,
                    updated_at: '2026-03-17T20:00:00.000Z',
                    title: '[MMZ-408] Two-Way Event Sync (MVP)',
                    body: '',
                    labels: [{ name: 'qa-pass' }, { name: 'merged-pr' }],
                    requested_reviewers: [],
                    base: { repo: { full_name: 'acme/repo' } },
                    head: { ref: 'mmz-408-two-way-event-sync' },
                }];
            }
            if (String(path).startsWith('/repos/acme/repo/pulls?state=closed')) return [];
            throw new Error(`Unexpected path ${path}`);
        });

        const result = await resolveGithubPrBatch({
            ticketKeys: ['MMZ-40'],
            token: 'token',
            repos: ['acme/repo'],
            allowGlobalFallback: false,
        });

        expect(result.snapshotsByKey['MMZ-40']).toBeNull();
        expect(result.notFoundKeys).toEqual(['MMZ-40']);
    });

    it('does not match a search PR for MMZ-408 when looking up MMZ-40', async () => {
        mockedGithubFetch.mockImplementation(async path => {
            if (String(path).startsWith('/search/issues')) {
                return {
                    items: [{
                        title: '[MMZ-408] Two-Way Event Sync (MVP)',
                        body: '',
                        updated_at: '2026-03-17T20:00:00.000Z',
                        html_url: 'https://github.com/acme/repo/pull/408',
                        pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/408' },
                        labels: [{ name: 'qa-pass' }],
                    }],
                };
            }

            if (path === 'https://api.github.com/repos/acme/repo/pulls/408') {
                return {
                    url: path,
                    html_url: 'https://github.com/acme/repo/pull/408',
                    state: 'open',
                    draft: false,
                    merged_at: null,
                    updated_at: '2026-03-17T20:00:00.000Z',
                    title: '[MMZ-408] Two-Way Event Sync (MVP)',
                    body: '',
                    labels: [{ name: 'qa-pass' }, { name: 'merged-pr' }],
                    requested_reviewers: [],
                    base: { repo: { full_name: 'acme/repo' } },
                    head: { ref: 'mmz-408-two-way-event-sync' },
                };
            }

            throw new Error(`Unexpected path ${path}`);
        });

        const result = await getPrSnapshot('MMZ-40', 'token');

        expect(result).toBeNull();
    });

    it('finds MMZ-40 from exact search results without re-matching MMZ-408', async () => {
        mockedGithubFetch.mockImplementation(async path => {
            const requestPath = String(path);

            if (requestPath.startsWith('/search/issues')) {
                if (requestPath.includes(encodeURIComponent('"MMZ-40" type:pr'))) {
                    return {
                        items: [{
                            title: 'feat(mmz-40): [BE] two way event sync for calendars',
                            body: '',
                            updated_at: '2026-03-19T20:00:00.000Z',
                            html_url: 'https://github.com/ninja-concepts/momeaze/pull/115',
                            pull_request: { url: 'https://api.github.com/repos/ninja-concepts/momeaze/pulls/115' },
                            labels: [{ name: 'qa-pass' }],
                        }],
                    };
                }

                return {
                    items: [{
                        title: '[MMZ-408] Two-Way Event Sync (MVP)',
                        body: '',
                        updated_at: '2026-03-17T20:00:00.000Z',
                        html_url: 'https://github.com/acme/repo/pull/408',
                        pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/408' },
                        labels: [{ name: 'qa-pass' }],
                    }],
                };
            }

            if (requestPath === 'https://api.github.com/repos/ninja-concepts/momeaze/pulls/115') {
                return {
                    url: requestPath,
                    html_url: 'https://github.com/ninja-concepts/momeaze/pull/115',
                    state: 'open',
                    draft: false,
                    merged_at: null,
                    updated_at: '2026-03-19T20:00:00.000Z',
                    title: 'feat(mmz-40): [BE] two way event sync for calendars',
                    body: '',
                    labels: [{ name: 'qa-pass' }],
                    requested_reviewers: [],
                    base: { repo: { full_name: 'ninja-concepts/momeaze' } },
                    head: { ref: 'mmz-40-BE-two-way-event-sync' },
                };
            }

            if (requestPath === 'https://api.github.com/repos/acme/repo/pulls/408') {
                return {
                    url: requestPath,
                    html_url: 'https://github.com/acme/repo/pull/408',
                    state: 'open',
                    draft: false,
                    merged_at: null,
                    updated_at: '2026-03-17T20:00:00.000Z',
                    title: '[MMZ-408] Two-Way Event Sync (MVP)',
                    body: '',
                    labels: [{ name: 'qa-pass' }, { name: 'merged-pr' }],
                    requested_reviewers: [],
                    base: { repo: { full_name: 'acme/repo' } },
                    head: { ref: 'mmz-408-two-way-event-sync' },
                };
            }

            throw new Error(`Unexpected path ${path}`);
        });

        const result = await getPrSnapshot('MMZ-40', 'token');

        expect(result?.url).toBe('https://github.com/ninja-concepts/momeaze/pull/115');
        expect(result?.repo).toBe('ninja-concepts/momeaze');
    });

    it('falls back to global search after repo miss when fallback is enabled', async () => {
        mockedGithubFetch.mockImplementation(async path => {
            const requestPath = String(path);

            if (requestPath.startsWith('/repos/acme/repo/pulls?state=open')) return [];
            if (requestPath.startsWith('/repos/acme/repo/pulls?state=closed')) return [];

            if (requestPath.startsWith('/search/issues')) {
                return {
                    items: [{
                        title: 'feat(mmz-40): [BE] two way event sync for calendars',
                        body: '',
                        updated_at: '2026-03-19T20:00:00.000Z',
                        html_url: 'https://github.com/ninja-concepts/momeaze/pull/115',
                        pull_request: { url: 'https://api.github.com/repos/ninja-concepts/momeaze/pulls/115' },
                        labels: [{ name: 'qa-pass' }],
                    }],
                };
            }

            if (requestPath === 'https://api.github.com/repos/ninja-concepts/momeaze/pulls/115') {
                return {
                    url: requestPath,
                    html_url: 'https://github.com/ninja-concepts/momeaze/pull/115',
                    state: 'open',
                    draft: false,
                    merged_at: null,
                    updated_at: '2026-03-19T20:00:00.000Z',
                    title: 'feat(mmz-40): [BE] two way event sync for calendars',
                    body: '',
                    labels: [{ name: 'qa-pass' }],
                    requested_reviewers: [],
                    base: { repo: { full_name: 'ninja-concepts/momeaze' } },
                    head: { ref: 'mmonteiro/mmz-40-BE-two-way-event-sync' },
                };
            }

            throw new Error(`Unexpected path ${path}`);
        });

        const result = await resolveGithubPrBatch({
            ticketKeys: ['MMZ-40'],
            token: 'token',
            repos: ['acme/repo'],
            allowGlobalFallback: true,
        });

        expect(result.snapshotsByKey['MMZ-40']?.url).toBe('https://github.com/ninja-concepts/momeaze/pull/115');
        expect(result.pendingKeys).toEqual([]);
    });
});

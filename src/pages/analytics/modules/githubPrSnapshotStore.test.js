import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./jiraApi.js', () => ({
    githubFetch: vi.fn(),
}));

import { githubFetch } from './jiraApi.js';
import {
    clearPrSnapshotCache,
    getGithubAvailabilityState,
    getPrSnapshot,
    getPrSnapshots,
    resolveGithubPrBatch,
    subscribeGithubAvailability,
} from './githubPrSnapshotStore.js';

const mockedGithubFetch = vi.mocked(githubFetch);

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

        if (path === 'https://api.github.com/repos/acme/repo/pulls/1/reviews?per_page=20') {
            return [{ state: 'APPROVED', submitted_at: '2026-03-17T20:10:00.000Z' }];
        }

        throw new Error(`Unexpected path ${path}`);
    });
}

describe('githubPrSnapshotStore', () => {
    beforeEach(() => {
        vi.useRealTimers();
        clearPrSnapshotCache();
        mockedGithubFetch.mockReset();
    });

    it('deduplicates concurrent requests for the same ticket', async () => {
        mockPrLookup('MMZ-1');

        const [first, second] = await Promise.all([
            getPrSnapshot('MMZ-1', 'token', { staggerMs: 0 }),
            getPrSnapshot('MMZ-1', 'token', { staggerMs: 0 }),
        ]);

        expect(first).toEqual(second);
        expect(first.labels).toEqual(['capacity-risk', 'in-review']);
        expect(mockedGithubFetch).toHaveBeenCalledTimes(4);
    });

    it('re-fetches after clearing the shared cache', async () => {
        mockPrLookup('MMZ-2');

        await getPrSnapshot('MMZ-2', 'token', { staggerMs: 0 });
        clearPrSnapshotCache();
        await getPrSnapshot('MMZ-2', 'token', { staggerMs: 0 });

        expect(mockedGithubFetch).toHaveBeenCalledTimes(4);
    });

    it('blocks the session after a 403 and stops later ticket fetches', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

        const forbidden = new Error('GitHub API 403');
        forbidden.status = 403;
        forbidden.responseText = 'API rate limit exceeded';
        forbidden.headers = { reset: null, remaining: '0', retryAfter: null };
        mockedGithubFetch.mockRejectedValue(forbidden);

        const snapshots = await getPrSnapshots(['MMZ-3', 'MMZ-4'], 'token', { staggerMs: 0 });

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
        await getPrSnapshot('MMZ-5', 'token', { staggerMs: 0 });
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

        await getPrSnapshot('MMZ-7', 'token', { concurrency: 1 });
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
        const firstResult = await getPrSnapshot('MMZ-8', 'token', { concurrency: 1 });
        expect(firstResult).toBeNull();
        expect(getGithubAvailabilityState().blocked).toBe(true);

        mockPrLookup('MMZ-8');
        await vi.advanceTimersByTimeAsync(30 * 1000);

        const recoveredResult = await getPrSnapshot('MMZ-8', 'token', { concurrency: 1 });
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

        const firstResult = await getPrSnapshot('MMZ-9', 'token', { concurrency: 1 });
        expect(firstResult).toBeNull();
        expect(getGithubAvailabilityState().blocked).toBe(true);

        mockPrLookup('MMZ-9');
        await vi.advanceTimersByTimeAsync(30 * 1000);

        const recoveredResult = await getPrSnapshot('MMZ-9', 'token', { concurrency: 1 });
        expect(recoveredResult?.url).toBe('https://github.com/acme/repo/pull/1');
    });

    it('surfaces invalid token state after a 401', async () => {
        const unauthorized = new Error('GitHub API 401');
        unauthorized.status = 401;
        unauthorized.responseText = 'bad credentials';
        mockedGithubFetch.mockRejectedValue(unauthorized);

        const snapshot = await getPrSnapshot('MMZ-6', 'token', { staggerMs: 0 });

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
});

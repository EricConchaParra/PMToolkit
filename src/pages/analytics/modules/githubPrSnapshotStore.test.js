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
        expect(mockedGithubFetch).toHaveBeenCalledTimes(3);
    });

    it('re-fetches after clearing the shared cache', async () => {
        mockPrLookup('MMZ-2');

        await getPrSnapshot('MMZ-2', 'token', { staggerMs: 0 });
        clearPrSnapshotCache();
        await getPrSnapshot('MMZ-2', 'token', { staggerMs: 0 });

        expect(mockedGithubFetch).toHaveBeenCalledTimes(6);
    });

    it('blocks the session after a 403 and stops later ticket fetches', async () => {
        const forbidden = new Error('GitHub API 403');
        forbidden.status = 403;
        forbidden.responseText = 'API rate limit exceeded';
        mockedGithubFetch.mockRejectedValue(forbidden);

        const snapshots = await getPrSnapshots(['MMZ-3', 'MMZ-4'], 'token', { staggerMs: 0 });

        expect(snapshots['MMZ-3']).toBeNull();
        expect(snapshots['MMZ-4']).toBeUndefined();
        expect(mockedGithubFetch).toHaveBeenCalledTimes(1);
        expect(getGithubAvailabilityState()).toEqual({
            blocked: true,
            reason: 'Blocked: GitHub rate limit reached',
            status: 'blocked',
        });

        await getPrSnapshot('MMZ-5', 'token', { staggerMs: 0 });
        expect(mockedGithubFetch).toHaveBeenCalledTimes(1);
    });

    it('surfaces invalid token state after a 401', async () => {
        const unauthorized = new Error('GitHub API 401');
        unauthorized.status = 401;
        unauthorized.responseText = 'bad credentials';
        mockedGithubFetch.mockRejectedValue(unauthorized);

        const snapshot = await getPrSnapshot('MMZ-6', 'token', { staggerMs: 0 });

        expect(snapshot).toBeNull();
        expect(getGithubAvailabilityState()).toEqual({
            blocked: true,
            reason: 'Blocked: invalid GitHub token',
            status: 'blocked',
        });
    });
});

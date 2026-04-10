import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./githubPrSnapshotStore.js', () => ({
    clearPrSnapshotCache: vi.fn(),
    getGithubAvailabilityState: vi.fn(() => ({ blocked: false })),
    resolveGithubPrBatch: vi.fn(),
}));

import { resolveGithubPrBatch } from './githubPrSnapshotStore.js';
import { enrichChips } from './githubPrCache.js';

const mockedResolveGithubPrBatch = vi.mocked(resolveGithubPrBatch);
const ORIGINAL_DOCUMENT = global.document;

function createFakeElement(tagName = 'div') {
    return {
        tagName: String(tagName || 'div').toUpperCase(),
        className: '',
        title: '',
        innerHTML: '',
        textContent: '',
        href: '',
        target: '',
        rel: '',
        dataset: {},
        children: [],
        parentNode: null,
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
            return child;
        },
        remove() {
            if (this.parentNode?.children) {
                this.parentNode.children = this.parentNode.children.filter(item => item !== this);
            }
        },
    };
}

beforeEach(() => {
    mockedResolveGithubPrBatch.mockReset();
    global.document = {
        createElement(tagName) {
            return createFakeElement(tagName);
        },
    };
});

describe('githubPrCache', () => {
    it('enriches board-tone sprint chips with GitHub PR metadata', async () => {
        const actions = createFakeElement('div');
        const chipMain = createFakeElement('div');
        const chip = createFakeElement('div');

        chip.className = 'issue-chip board-tone-progress';
        chip.dataset.ghKey = 'PM-1';
        chip.querySelector = vi.fn(selector => {
            if (selector === '.issue-chip-actions') return actions;
            if (selector === '.issue-chip-main') return chipMain;
            return null;
        });

        actions.closest = vi.fn(selector => selector === '.issue-chip' ? chip : null);

        const container = {
            querySelectorAll: vi.fn(selector => (
                selector.includes('.board-tone-progress[data-gh-key]') ? [chip] : []
            )),
        };

        mockedResolveGithubPrBatch.mockResolvedValue({
            snapshotsByKey: {
                'PM-1': {
                    url: 'https://github.com/acme/repo/pull/1',
                    state: 'open',
                    draft: false,
                    labels: ['qa-pass'],
                },
            },
            pendingKeys: [],
            notFoundKeys: [],
            sourceMeta: {},
        });

        await enrichChips(container, 'token');

        expect(mockedResolveGithubPrBatch).toHaveBeenCalledWith(expect.objectContaining({
            ticketKeys: ['PM-1'],
            visibleTicketKeys: ['PM-1'],
            token: 'token',
        }));
        expect(chip.dataset.ghEnriched).toBe('true');
        expect(actions.children.some(child => child.className === 'gh-pr-btn gh-pr-found')).toBe(true);
        expect(chipMain.children.some(child => child.className === 'gh-pr-meta')).toBe(true);
    });
});

afterEach(() => {
    global.document = ORIGINAL_DOCUMENT;
});

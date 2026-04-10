import { describe, expect, it } from 'vitest';

import { matchesSearchTerm } from './tagging.js';

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

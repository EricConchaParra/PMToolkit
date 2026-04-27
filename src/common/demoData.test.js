import { describe, expect, it } from 'vitest';

import { getDemoBoardId, getDemoBoardSprints, getDemoPrSnapshots, getDemoSprintIssues } from './demoData.js';

describe('demoData', () => {
    it('keeps the active sprint a few days away from ending and populates richer OPS demo data', () => {
        const boardId = getDemoBoardId('OPS');
        const sprints = getDemoBoardSprints(boardId, ['closed', 'active', 'future']);
        const activeSprint = sprints.find(sprint => sprint.state === 'active');

        expect(activeSprint).toBeTruthy();

        const msUntilEnd = new Date(activeSprint.endDate).getTime() - Date.now();
        const daysUntilEnd = msUntilEnd / (24 * 60 * 60 * 1000);
        expect(daysUntilEnd).toBeGreaterThan(2);
        expect(daysUntilEnd).toBeLessThan(6);

        const issues = getDemoSprintIssues(activeSprint.id);
        const assignees = new Set(issues.map(issue => issue.fields.assignee?.displayName).filter(Boolean));

        expect(issues).toHaveLength(10);
        expect(assignees.size).toBeGreaterThanOrEqual(5);
        expect(issues.some(issue => issue.key === 'OPS-143')).toBe(true);
        expect(issues.some(issue => issue.key === 'OPS-144')).toBe(true);
    });

    it('expands PLN demo data with multiple developers and carryover work', () => {
        const boardId = getDemoBoardId('PLN');
        const activeSprint = getDemoBoardSprints(boardId, ['active'])[0];
        const issues = getDemoSprintIssues(activeSprint.id);
        const assignees = new Set(issues.map(issue => issue.fields.assignee?.displayName).filter(Boolean));

        expect(issues).toHaveLength(7);
        expect(assignees.size).toBeGreaterThanOrEqual(5);
        expect(issues.some(issue => issue.key === 'PLN-86')).toBe(true);
    });

    it('provides demo GitHub PR snapshots with draft, merged and qa-pass coverage', () => {
        const snapshots = getDemoPrSnapshots(['OPS-142', 'OPS-144', 'OPS-155', 'PLN-98']);

        expect(snapshots['OPS-142']).toMatchObject({
            state: 'open',
            draft: false,
            labels: expect.arrayContaining(['QA Pass']),
        });
        expect(snapshots['OPS-144']).toMatchObject({
            state: 'open',
            draft: true,
        });
        expect(snapshots['OPS-155']).toMatchObject({
            state: 'closed',
            draft: false,
            labels: expect.arrayContaining(['merged-pr', 'QA Pass']),
        });
        expect(snapshots['PLN-98']).toMatchObject({
            state: 'closed',
            draft: false,
        });
    });
});

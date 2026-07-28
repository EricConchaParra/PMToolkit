/**
 * PMsToolKit — Analytics Hub
 * Shared constants and defaults
 */

export const DEFAULT_SP_HOURS = {
    0: 9,    // null / unpointed
    1: 2.25,
    2: 4.5,
    3: 9,
    5: 18,
    8: 27,
    13: 45,
};

export const DEFAULT_HOURS_PER_DAY = 9;

export const SP_KEYS = [0, 1, 2, 3, 5, 8, 13];

// Share of an issue's estimated hours still considered "remaining" per board stage.
export const DEFAULT_STAGE_WEIGHTS = {
    todo: 1,
    blocked: 1,
    inProgress: 0.75,
    changes: 0.5,
    review: 0.4,
    qa: 0.25,
    done: 0,
};

export const STAGE_KEYS = ['todo', 'blocked', 'inProgress', 'changes', 'review', 'qa'];

export const STAGE_LABELS = {
    todo: 'To Do',
    blocked: 'Blocked',
    inProgress: 'In Progress',
    changes: 'Changes Required',
    review: 'Review',
    qa: 'QA',
    done: 'Done',
};

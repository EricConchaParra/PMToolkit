/**
 * PMsToolKit — Analytics Hub
 * Sprint Dashboard status filter — pure helpers for the multi-select status dropdown
 */

import { resolveIssueBoardColumn } from '../boardFlow.js';

const UNORDERED_COLUMN = Number.MAX_SAFE_INTEGER;

export function normalizeStatusValue(name = '') {
    return String(name || '').trim().toLowerCase();
}

/**
 * Builds the selectable status list from the issues currently in the sprint,
 * ordered by board column so the dropdown mirrors the workflow order.
 */
export function buildSprintStatusFilterOptions(issues = [], boardFlow = null) {
    const statusMap = new Map();

    (Array.isArray(issues) ? issues : []).forEach(issue => {
        const label = String(issue?.fields?.status?.name || '').trim();
        if (!label) return;

        const value = normalizeStatusValue(label);
        const existing = statusMap.get(value);
        if (existing) {
            existing.count += 1;
            return;
        }

        const column = boardFlow ? resolveIssueBoardColumn(issue, boardFlow) : null;
        statusMap.set(value, {
            value,
            label,
            count: 1,
            tone: column?.tone || 'default',
            columnOrder: Number.isFinite(column?.order) ? column.order : UNORDERED_COLUMN,
        });
    });

    return Array.from(statusMap.values()).sort((left, right) =>
        left.columnOrder - right.columnOrder || left.label.localeCompare(right.label)
    );
}

/** Drops selections that no longer exist in the sprint, plus blanks and duplicates. */
export function sanitizeStatusFilterSelection(selection = [], options = []) {
    const available = new Set((Array.isArray(options) ? options : []).map(option => option.value));
    const seen = new Set();

    return (Array.isArray(selection) ? selection : [])
        .map(normalizeStatusValue)
        .filter(value => {
            if (!value || !available.has(value) || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
}

export function filterSprintIssuesByStatus(issues = [], selection = []) {
    const list = Array.isArray(issues) ? issues : [];
    const selected = new Set(
        (Array.isArray(selection) ? selection : []).map(normalizeStatusValue).filter(Boolean)
    );

    if (!selected.size) return list.slice();

    return list.filter(issue => selected.has(normalizeStatusValue(issue?.fields?.status?.name)));
}

export function getStatusFilterLabels(selection = [], options = []) {
    const optionsByValue = new Map((Array.isArray(options) ? options : []).map(option => [option.value, option.label]));

    return (Array.isArray(selection) ? selection : [])
        .map(value => optionsByValue.get(normalizeStatusValue(value)) || String(value || '').trim())
        .filter(Boolean);
}

export function buildStatusFilterSummary(selection = [], options = []) {
    const labels = getStatusFilterLabels(selection, options);

    if (!labels.length) return 'All Statuses';
    if (labels.length === 1) return labels[0];
    return `${labels.length} statuses`;
}

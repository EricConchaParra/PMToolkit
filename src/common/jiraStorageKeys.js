import {
    buildJiraTicketRef,
    ensureJiraTicketRef,
    normalizeJiraHost,
    normalizeIssueKey,
    parseJiraTicketRef,
} from './jiraIdentity.js';

export const JIRA_SITES_STORAGE_KEY = 'et_jira_sites';
export const ACTIVE_JIRA_HOST_STORAGE_KEY = 'et_jira_active_host';
export const LEGACY_JIRA_HOST_STORAGE_KEY = 'et_jira_host';
export const JIRA_MULTISITE_MIGRATION_KEY = 'jira_multisite_migration_v1_done';
export const PENDING_ALERTS_STORAGE_KEY = 'pending_alerts';
export const LEGACY_TAG_DEFS_STORAGE_KEY = 'tag_defs_jira';
export const LEGACY_LAST_PROJECT_STORAGE_KEY = 'sdk_last_project';
export const LEGACY_MANUAL_MENU_STORAGE_KEY = 'et_manual_menu_items';
export const LEGACY_STARRED_ITEMS_STORAGE_KEY = 'et_starred_items';

export function getTagDefsStorageKey(host = '') {
    const normalizedHost = normalizeJiraHost(host);
    return normalizedHost ? `tag_defs_jira@${normalizedHost}` : LEGACY_TAG_DEFS_STORAGE_KEY;
}

function buildLegacyJiraTrackingStorageKey(prefix, issueKey) {
    const normalizedIssueKey = normalizeIssueKey(issueKey);
    return normalizedIssueKey ? `${prefix}_jira:${normalizedIssueKey}` : '';
}

export function buildJiraTrackingStorageKey(prefix, issueOrRef, host = '') {
    const ticketRef = ensureJiraTicketRef(issueOrRef, host);
    if (ticketRef.startsWith('jira@')) return `${prefix}_${ticketRef}`;

    const parsed = parseJiraTicketRef(issueOrRef, host);
    if (!parsed?.issueKey) return '';
    return buildLegacyJiraTrackingStorageKey(prefix, parsed.issueKey);
}

export function parseJiraTrackingStorageKey(storageKey, fallbackHost = '') {
    const match = String(storageKey || '').match(/^(notes|reminder|tags|meta|ignored)_(.+)$/);
    if (!match) return null;

    const parsed = parseJiraTicketRef(match[2], fallbackHost);
    if (!parsed?.issueKey) return null;

    return {
        prefix: match[1],
        host: parsed.host,
        issueKey: parsed.issueKey,
        ticketRef: parsed.host ? buildJiraTicketRef(parsed.host, parsed.issueKey) : parsed.ref,
        isLegacy: parsed.isLegacy === true || !parsed.host,
    };
}

export function getNotesStorageKey(issueOrRef, host = '') {
    return buildJiraTrackingStorageKey('notes', issueOrRef, host);
}

export function getReminderStorageKey(issueOrRef, host = '') {
    return buildJiraTrackingStorageKey('reminder', issueOrRef, host);
}

export function getTagsStorageKey(issueOrRef, host = '') {
    return buildJiraTrackingStorageKey('tags', issueOrRef, host);
}

export function getMetaStorageKey(issueOrRef, host = '') {
    return buildJiraTrackingStorageKey('meta', issueOrRef, host);
}

export function getIgnoredStorageKey(issueOrRef, host = '') {
    return buildJiraTrackingStorageKey('ignored', issueOrRef, host);
}

export function getTicketCacheStorageKey(issueOrRef, host = '') {
    const ticketRef = ensureJiraTicketRef(issueOrRef, host);
    if (ticketRef.startsWith('jira@')) return `ticket_cache_${ticketRef}`;

    const parsed = parseJiraTicketRef(issueOrRef, host);
    if (!parsed?.issueKey) return '';
    return `ticket_cache_${parsed.issueKey}`;
}

export function getJiraProjectSettingsStorageKey(host, projectKey) {
    const normalizedHost = normalizeJiraHost(host);
    const safeProjectKey = normalizeIssueKey(projectKey);
    if (!normalizedHost || !safeProjectKey) return '';
    return `sdk_settings_${normalizedHost}_${safeProjectKey}`;
}

export function getLegacyJiraProjectSettingsStorageKey(projectKey) {
    const safeProjectKey = normalizeIssueKey(projectKey);
    return safeProjectKey ? `sdk_settings_${safeProjectKey}` : '';
}

export function getLastProjectStorageKey(host = '') {
    const normalizedHost = normalizeJiraHost(host);
    return normalizedHost ? `sdk_last_project_${normalizedHost}` : LEGACY_LAST_PROJECT_STORAGE_KEY;
}

export function getManualMenuStorageKey(host = '') {
    const normalizedHost = normalizeJiraHost(host);
    return normalizedHost ? `et_manual_menu_items@${normalizedHost}` : LEGACY_MANUAL_MENU_STORAGE_KEY;
}

export function getSprintClosureStorageKey(host, projectKey, sprintId) {
    const normalizedHost = normalizeJiraHost(host);
    const safeProjectKey = normalizeIssueKey(projectKey);
    const safeSprintId = Number(sprintId);
    if (!normalizedHost || !safeProjectKey || !Number.isFinite(safeSprintId)) return '';
    return `sprint_report_${normalizedHost}_${safeProjectKey}_${safeSprintId}`;
}

export function getLegacySprintClosureStorageKey(projectKey, sprintId) {
    const safeProjectKey = normalizeIssueKey(projectKey);
    const safeSprintId = Number(sprintId);
    if (!safeProjectKey || !Number.isFinite(safeSprintId)) return '';
    return `sprint_report_${safeProjectKey}_${safeSprintId}`;
}

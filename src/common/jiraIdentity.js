const JIRA_HOST_SUFFIX = '.atlassian.net';
const JIRA_REF_PREFIX = 'jira@';
const LEGACY_JIRA_REF_PREFIX = 'jira:';

export function normalizeJiraHost(host) {
    const normalized = String(host || '').trim().toLowerCase();
    return normalized.endsWith(JIRA_HOST_SUFFIX) ? normalized : '';
}

export function isJiraHost(host) {
    return Boolean(normalizeJiraHost(host));
}

export function normalizeIssueKey(issueKey) {
    return String(issueKey || '').trim().toUpperCase();
}

export function buildJiraTicketRef(host, issueKey) {
    const normalizedHost = normalizeJiraHost(host);
    const normalizedIssueKey = normalizeIssueKey(issueKey);
    if (!normalizedHost || !normalizedIssueKey) return '';
    return `${JIRA_REF_PREFIX}${normalizedHost}:${normalizedIssueKey}`;
}

export function parseJiraTicketRef(value, fallbackHost = '') {
    const raw = String(value || '').trim();
    if (!raw) return null;

    if (raw.startsWith(JIRA_REF_PREFIX)) {
        const withoutPrefix = raw.slice(JIRA_REF_PREFIX.length);
        const separatorIndex = withoutPrefix.indexOf(':');
        if (separatorIndex <= 0) return null;

        const host = normalizeJiraHost(withoutPrefix.slice(0, separatorIndex));
        const issueKey = normalizeIssueKey(withoutPrefix.slice(separatorIndex + 1));
        if (!host || !issueKey) return null;

        return {
            provider: 'jira',
            host,
            issueKey,
            ref: buildJiraTicketRef(host, issueKey),
            isLegacy: false,
        };
    }

    if (raw.startsWith(LEGACY_JIRA_REF_PREFIX)) {
        const issueKey = normalizeIssueKey(raw.slice(LEGACY_JIRA_REF_PREFIX.length));
        const host = normalizeJiraHost(fallbackHost);
        if (!issueKey) return null;

        return {
            provider: 'jira',
            host,
            issueKey,
            ref: host ? buildJiraTicketRef(host, issueKey) : raw,
            isLegacy: true,
        };
    }

    const issueKey = normalizeIssueKey(raw);
    const host = normalizeJiraHost(fallbackHost);
    if (!issueKey) return null;

    return {
        provider: 'jira',
        host,
        issueKey,
        ref: host ? buildJiraTicketRef(host, issueKey) : raw,
        isLegacy: false,
    };
}

export function ensureJiraTicketRef(value, host = '') {
    const parsed = parseJiraTicketRef(value, host);
    if (!parsed?.issueKey) return '';
    return parsed.host ? buildJiraTicketRef(parsed.host, parsed.issueKey) : parsed.ref;
}

export function getJiraIssueKey(value) {
    return parseJiraTicketRef(value)?.issueKey || '';
}

export function getJiraTicketHost(value, fallbackHost = '') {
    return parseJiraTicketRef(value, fallbackHost)?.host || '';
}

export function getJiraDisplayKey(value) {
    return getJiraIssueKey(value) || String(value || '').trim();
}

export function parseJiraUrl(url) {
    try {
        const parsed = new URL(url);
        const host = normalizeJiraHost(parsed.hostname);
        if (!host || parsed.pathname.startsWith('/wiki')) return null;
        return { host, url: parsed };
    } catch {
        return null;
    }
}

export function getCurrentPageJiraHost() {
    if (typeof window === 'undefined' || !window.location) return '';
    return parseJiraUrl(window.location.href)?.host || '';
}

export const JIRA_IDENTITY = {
    hostSuffix: JIRA_HOST_SUFFIX,
    refPrefix: JIRA_REF_PREFIX,
    legacyRefPrefix: LEGACY_JIRA_REF_PREFIX,
};

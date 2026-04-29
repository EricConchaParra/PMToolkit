import { storage } from './storage.js';
import {
    ACTIVE_JIRA_HOST_STORAGE_KEY,
    JIRA_MULTISITE_MIGRATION_KEY,
    JIRA_SITES_STORAGE_KEY,
    LEGACY_JIRA_HOST_STORAGE_KEY,
    LEGACY_LAST_PROJECT_STORAGE_KEY,
    LEGACY_TAG_DEFS_STORAGE_KEY,
    PENDING_ALERTS_STORAGE_KEY,
    getIgnoredStorageKey,
    getJiraFieldOverridesStorageKey,
    getJiraProjectSettingsStorageKey,
    getLastProjectStorageKey,
    getLegacyJiraProjectSettingsStorageKey,
    getLegacySprintClosureStorageKey,
    getManualMenuStorageKey,
    getMetaStorageKey,
    getNotesStorageKey,
    getReminderStorageKey,
    getSprintClosureStorageKey,
    getTagDefsStorageKey,
    getTagsStorageKey,
    getTicketCacheStorageKey,
} from './jiraStorageKeys.js';
import {
    buildJiraTicketRef,
    getCurrentPageJiraHost,
    normalizeJiraHost,
    normalizeIssueKey,
    parseJiraTicketRef,
    parseJiraUrl,
} from './jiraIdentity.js';

let migrationPromise = null;

function normalizeHostList(hosts = []) {
    const seen = new Set();
    return (Array.isArray(hosts) ? hosts : [])
        .map(normalizeJiraHost)
        .filter(host => {
            if (!host || seen.has(host)) return false;
            seen.add(host);
            return true;
        });
}

async function getSiteState() {
    const result = await storage.get([JIRA_SITES_STORAGE_KEY, ACTIVE_JIRA_HOST_STORAGE_KEY]);
    return {
        hosts: normalizeHostList(result[JIRA_SITES_STORAGE_KEY] || []),
        activeHost: normalizeJiraHost(result[ACTIVE_JIRA_HOST_STORAGE_KEY]),
    };
}

async function persistRegisteredHost(host, opts = {}) {
    const normalizedHost = normalizeJiraHost(host);
    if (!normalizedHost) return '';

    const { hosts, activeHost } = await getSiteState();
    const nextHosts = [normalizedHost, ...hosts.filter(item => item !== normalizedHost)];
    const payload = { [JIRA_SITES_STORAGE_KEY]: nextHosts };

    if (opts.setActive === true) {
        payload[ACTIVE_JIRA_HOST_STORAGE_KEY] = normalizedHost;
    } else if (activeHost && activeHost !== normalizedHost) {
        payload[ACTIVE_JIRA_HOST_STORAGE_KEY] = activeHost;
    }

    await storage.set(payload);
    return normalizedHost;
}

export async function getKnownJiraHosts() {
    await ensureJiraMultiSiteMigration();
    return (await getSiteState()).hosts;
}

export async function getStoredActiveJiraHost() {
    await ensureJiraMultiSiteMigration();
    return (await getSiteState()).activeHost;
}

export async function registerJiraHost(host, opts = {}) {
    await ensureJiraMultiSiteMigration();
    return persistRegisteredHost(host, opts);
}

export async function setActiveJiraHost(host) {
    const normalizedHost = await registerJiraHost(host, { setActive: true });
    if (!normalizedHost) return '';
    await storage.set({ [ACTIVE_JIRA_HOST_STORAGE_KEY]: normalizedHost });
    return normalizedHost;
}

function isScopedStorageKeyForHost(key, host) {
    const normalizedHost = normalizeJiraHost(host);
    if (!normalizedHost) return false;

    return key === getTagDefsStorageKey(normalizedHost)
        || key === getJiraFieldOverridesStorageKey(normalizedHost)
        || key === getLastProjectStorageKey(normalizedHost)
        || key === getManualMenuStorageKey(normalizedHost)
        || key.startsWith(`sdk_settings_${normalizedHost}_`)
        || key.startsWith(`sprint_report_${normalizedHost}_`)
        || key.includes(`jira@${normalizedHost}:`);
}

export async function forgetJiraHost(host) {
    await ensureJiraMultiSiteMigration();

    const normalizedHost = normalizeJiraHost(host);
    if (!normalizedHost) {
        const { hosts, activeHost } = await getSiteState();
        return { hosts, activeHost, removed: false };
    }

    const items = await storage.getAll();
    const hosts = normalizeHostList(items[JIRA_SITES_STORAGE_KEY] || []).filter(item => item !== normalizedHost);
    const currentActiveHost = normalizeJiraHost(items[ACTIVE_JIRA_HOST_STORAGE_KEY]);
    const nextActiveHost = currentActiveHost === normalizedHost ? (hosts[0] || '') : currentActiveHost;
    const pendingAlerts = Array.isArray(items[PENDING_ALERTS_STORAGE_KEY]) ? items[PENDING_ALERTS_STORAGE_KEY] : [];
    const nextPendingAlerts = pendingAlerts.filter(value => parseJiraTicketRef(value)?.host !== normalizedHost);
    const scopedKeys = Object.keys(items).filter(key => isScopedStorageKeyForHost(key, normalizedHost));

    await storage.set({
        [JIRA_SITES_STORAGE_KEY]: hosts,
        [PENDING_ALERTS_STORAGE_KEY]: nextPendingAlerts,
        ...(nextActiveHost ? { [ACTIVE_JIRA_HOST_STORAGE_KEY]: nextActiveHost } : {}),
    });

    if (!nextActiveHost) {
        await storage.remove(ACTIVE_JIRA_HOST_STORAGE_KEY);
    }

    if (scopedKeys.length > 0) {
        await storage.remove(scopedKeys);
    }

    return {
        hosts,
        activeHost: nextActiveHost,
        removed: true,
    };
}

async function getActiveJiraTabHost() {
    if (!(typeof chrome !== 'undefined' && chrome.tabs?.query)) return '';

    try {
        const tabs = await new Promise(resolve => {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve);
        });
        const activeTab = Array.isArray(tabs) ? tabs[0] : null;
        return parseJiraUrl(activeTab?.url || '')?.host || '';
    } catch {
        return '';
    }
}

export async function resolveActiveJiraHost(opts = {}) {
    await ensureJiraMultiSiteMigration();
    const preferStoredActive = opts.preferStoredActive === true;

    const pageHost = getCurrentPageJiraHost();
    if (pageHost) {
        await registerJiraHost(pageHost);
        return pageHost;
    }

    const { activeHost, hosts } = await getSiteState();
    if (preferStoredActive && activeHost) return activeHost;

    const tabHost = await getActiveJiraTabHost();
    if (tabHost) {
        await registerJiraHost(tabHost);
        return tabHost;
    }

    if (activeHost) return activeHost;
    return hosts[0] || '';
}

function hasLegacyMultiSiteData(items = {}) {
    return Object.keys(items).some(key => {
        if (
            key === LEGACY_TAG_DEFS_STORAGE_KEY
            || key === LEGACY_LAST_PROJECT_STORAGE_KEY
            || key.startsWith('notes_jira:')
            || key.startsWith('reminder_jira:')
            || key.startsWith('tags_jira:')
            || key.startsWith('meta_jira:')
            || key.startsWith('ignored_jira:')
            || /^sdk_settings_[A-Z0-9-]+$/i.test(key)
        ) {
            return true;
        }

        if (key.startsWith('ticket_cache_') && !key.includes('jira@')) return true;
        return Boolean(parseLegacySprintClosureKey(key));
    });
}

function shouldCopyValue(targetKey, sourceItems, nextEntries) {
    return !Object.prototype.hasOwnProperty.call(sourceItems, targetKey)
        && !Object.prototype.hasOwnProperty.call(nextEntries, targetKey);
}

function parseLegacyProjectSettingsKey(key) {
    const match = String(key || '').match(/^sdk_settings_([A-Z0-9-]+)$/i);
    return match?.[1] ? normalizeIssueKey(match[1]) : '';
}

function parseLegacySprintClosureKey(key) {
    const match = String(key || '').match(/^sprint_report_(.+)_(\d+)$/i);
    if (!match?.[1] || !match?.[2]) return null;
    const projectKey = normalizeIssueKey(match[1]);
    if (!/^[A-Z0-9-]+$/i.test(projectKey)) return null;
    return {
        projectKey,
        sprintId: Number(match[2]),
    };
}

async function migrateLegacyJiraData(host) {
    const normalizedHost = normalizeJiraHost(host);
    if (!normalizedHost) return;

    const items = await storage.getAll();
    const nextEntries = {};
    const keysToRemove = [];

    Object.entries(items).forEach(([key, value]) => {
        if (key === LEGACY_TAG_DEFS_STORAGE_KEY) {
            const scopedKey = getTagDefsStorageKey(normalizedHost);
            if (shouldCopyValue(scopedKey, items, nextEntries)) nextEntries[scopedKey] = value;
            keysToRemove.push(key);
            return;
        }

        if (key === LEGACY_LAST_PROJECT_STORAGE_KEY) {
            const scopedKey = getLastProjectStorageKey(normalizedHost);
            if (shouldCopyValue(scopedKey, items, nextEntries)) nextEntries[scopedKey] = value;
            keysToRemove.push(key);
            return;
        }

        const legacyTrackingMatch = key.match(/^(notes|reminder|tags|meta|ignored)_jira:(.+)$/);
        if (legacyTrackingMatch?.[1] && legacyTrackingMatch?.[2]) {
            const issueKey = normalizeIssueKey(legacyTrackingMatch[2]);
            const ticketRef = buildJiraTicketRef(normalizedHost, issueKey);
            const scopedKeyMap = {
                notes: getNotesStorageKey(ticketRef),
                reminder: getReminderStorageKey(ticketRef),
                tags: getTagsStorageKey(ticketRef),
                meta: getMetaStorageKey(ticketRef),
                ignored: getIgnoredStorageKey(ticketRef),
            };
            const scopedKey = scopedKeyMap[legacyTrackingMatch[1]];
            if (scopedKey && shouldCopyValue(scopedKey, items, nextEntries)) nextEntries[scopedKey] = value;
            keysToRemove.push(key);
            return;
        }

        if (key.startsWith('ticket_cache_') && !key.includes('jira@')) {
            const legacyIssueKey = normalizeIssueKey(key.replace('ticket_cache_', ''));
            const scopedKey = getTicketCacheStorageKey(legacyIssueKey, normalizedHost);
            if (scopedKey && shouldCopyValue(scopedKey, items, nextEntries)) nextEntries[scopedKey] = value;
            keysToRemove.push(key);
            return;
        }

        const legacyProjectKey = parseLegacyProjectSettingsKey(key);
        if (legacyProjectKey) {
            const scopedKey = getJiraProjectSettingsStorageKey(normalizedHost, legacyProjectKey);
            if (scopedKey && shouldCopyValue(scopedKey, items, nextEntries)) nextEntries[scopedKey] = value;
            keysToRemove.push(key);
            return;
        }

        if (key.startsWith('sprint_report_') && !key.startsWith(`sprint_report_${normalizedHost}_`)) {
            const legacyReport = parseLegacySprintClosureKey(key);
            if (!legacyReport?.projectKey || !Number.isFinite(legacyReport.sprintId)) return;
            const scopedKey = getSprintClosureStorageKey(normalizedHost, legacyReport.projectKey, legacyReport.sprintId);
            if (scopedKey && shouldCopyValue(scopedKey, items, nextEntries)) nextEntries[scopedKey] = value;
            if (key === getLegacySprintClosureStorageKey(legacyReport.projectKey, legacyReport.sprintId)) {
                keysToRemove.push(key);
            }
            return;
        }
    });

    const pendingAlerts = Array.isArray(items[PENDING_ALERTS_STORAGE_KEY]) ? items[PENDING_ALERTS_STORAGE_KEY] : [];
    if (pendingAlerts.length > 0) {
        const scopedPendingAlerts = Array.from(new Set(
            pendingAlerts
                .map(value => parseJiraTicketRef(value, normalizedHost))
                .filter(Boolean)
                .map(parsed => buildJiraTicketRef(parsed.host || normalizedHost, parsed.issueKey))
        ));
        nextEntries[PENDING_ALERTS_STORAGE_KEY] = scopedPendingAlerts;
    }

    const existingHosts = normalizeHostList(items[JIRA_SITES_STORAGE_KEY] || []);
    nextEntries[JIRA_SITES_STORAGE_KEY] = [normalizedHost, ...existingHosts.filter(item => item !== normalizedHost)];
    nextEntries[JIRA_MULTISITE_MIGRATION_KEY] = true;

    if (Object.keys(nextEntries).length > 0) {
        await storage.set(nextEntries);
    }
    if (keysToRemove.length > 0) {
        await storage.remove(keysToRemove);
    }
}

export async function ensureJiraMultiSiteMigration() {
    if (migrationPromise) return migrationPromise;

    migrationPromise = (async () => {
        const items = await storage.getAll();
        if (items[JIRA_MULTISITE_MIGRATION_KEY] === true) return true;

        const knownHosts = normalizeHostList(items[JIRA_SITES_STORAGE_KEY] || []);
        let migrationHost = normalizeJiraHost(items[ACTIVE_JIRA_HOST_STORAGE_KEY])
            || normalizeJiraHost(items[LEGACY_JIRA_HOST_STORAGE_KEY])
            || knownHosts[0]
            || getCurrentPageJiraHost()
            || await getActiveJiraTabHost();

        if (!migrationHost) {
            if (hasLegacyMultiSiteData(items)) return false;
            await storage.set({ [JIRA_MULTISITE_MIGRATION_KEY]: true });
            return true;
        }

        migrationHost = await persistRegisteredHost(migrationHost);
        await migrateLegacyJiraData(migrationHost);
        return true;
    })().finally(() => {
        migrationPromise = null;
    });

    return migrationPromise;
}

/**
 * Background Service Worker for PMToolkit Extension.
 */

import {
    clearPrSnapshotCache,
    hydrateGithubPrPool,
    getGithubAvailabilityState,
    resolveGithubPrBatch,
} from '../common/githubPrPoolService.js';
import {
    getPrSnapshotStorageKeys,
    makePrSnapshotStorageKey,
    normalizeTicketKey,
} from '../common/githubPrStorage.js';

async function getTicketSummary(issueKey) {
    const cleanKey = issueKey.includes(':') ? issueKey.split(':')[1] : issueKey;
    const result = await new Promise(resolve => chrome.storage.local.get(['et_jira_host', `ticket_cache_${cleanKey}`], resolve));

    const cached = result[`ticket_cache_${cleanKey}`];
    if (cached && (Date.now() - cached.timestamp < 3600000)) {
        return cached.details.summary;
    }

    const host = result.et_jira_host || 'jira.atlassian.net';
    try {
        const resp = await fetch(`https://${host}/rest/api/2/issue/${cleanKey}?fields=summary`);
        if (resp.ok) {
            const data = await resp.json();
            return data.fields?.summary || '';
        }
    } catch (e) {
        console.error('Fetch error in background', e);
    }
    return '';
}

async function handleReminder(issueKey) {
    const summary = await getTicketSummary(issueKey);
    const finalKey = issueKey.includes(':') ? issueKey : `jira:${issueKey}`;

    chrome.storage.local.get([`notes_${finalKey}`, 'pending_alerts', `ignored_${finalKey}`], (result) => {
        if (result[`ignored_${finalKey}`]) return;

        const noteText = result[`notes_${finalKey}`] || '';
        const pendingAlerts = result.pending_alerts || [];

        if (!pendingAlerts.includes(issueKey)) {
            pendingAlerts.push(issueKey);
            chrome.storage.local.set({ pending_alerts: pendingAlerts });
        }

        let notificationTitle = `Reminder: ${issueKey}`;
        if (issueKey.includes(':')) {
            const [source, id] = issueKey.split(':');
            const sourceCapitalized = source.charAt(0).toUpperCase() + source.slice(1);
            notificationTitle = `Reminder on ${sourceCapitalized}: ${id}${summary ? ` (${summary})` : ''}`;
        } else {
            notificationTitle = `Reminder on Jira: ${issueKey}${summary ? ` (${summary})` : ''}`;
        }

        const notificationMessage = noteText.trim() || 'Reminder set for this ticket';

        chrome.notifications.create(`reminder_${issueKey}`, {
            type: 'basic',
            iconUrl: '/assets/icon.png',
            title: notificationTitle,
            message: notificationMessage.length > 100 ? notificationMessage.substring(0, 97) + '...' : notificationMessage,
            priority: 2,
            requireInteraction: true
        });

        chrome.tabs.query({ url: 'https://*.atlassian.net/*' }, (tabs) => {
            tabs.forEach(tab => {
                // Manually exclude Confluence (Wiki) tabs since excludeMatches is not supported in tabs.query
                if (tab.url && tab.url.includes('.atlassian.net/wiki/')) return;

                chrome.tabs.sendMessage(tab.id, {
                    type: 'REMINDER_FIRED',
                    issueKey: issueKey,
                    noteText: noteText,
                    summary: summary
                }).catch(() => { });
            });
        });
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith('reminder_')) {
        handleReminder(alarm.name.replace('reminder_', ''));
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('reminder_')) {
        const issueKey = notificationId.replace('reminder_', '');
        chrome.storage.local.get(['pending_alerts', 'et_jira_host'], (result) => {
            const pending = (result.pending_alerts || []).filter(k => k !== issueKey);
            chrome.storage.local.set({ pending_alerts: pending });

            const host = result.et_jira_host || 'jira.atlassian.net';
            const cleanKey = issueKey.includes(':') ? issueKey.split(':')[1] : issueKey;
            chrome.tabs.create({ url: `https://${host}/browse/${cleanKey}` });
            chrome.notifications.clear(notificationId);
        });
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        for (const [key, { newValue }] of Object.entries(changes)) {
            if (key.startsWith('reminder_')) {
                if (newValue) chrome.alarms.create(key, { when: newValue });
                else chrome.alarms.clear(key);
            }
        }
    }
});

function initialize() {
    chrome.storage.local.get(null, (items) => {
        const now = Date.now();
        for (const [key, value] of Object.entries(items)) {
            if (key.startsWith('reminder_')) {
                if (value > now) chrome.alarms.create(key, { when: value });
                else if (value > 0 && !items[`ignored_${key.replace('reminder_', '')}`]) {
                    handleReminder(key.replace('reminder_', ''));
                }
            }
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TEST_NOTIFICATION') {
        chrome.notifications.create('test_notif', {
            type: 'basic',
            iconUrl: '/assets/icon.png',
            title: 'PMsToolKit Test',
            message: 'Notifications are working correctly!',
            priority: 2
        });
    } else if (message.type === 'JIRA_API_FETCH') {
        fetch(message.url, message.options)
            .then(async (response) => {
                const isJson = (response.headers.get('content-type') || '').includes('application/json');
                let data = null;
                try {
                    data = isJson ? await response.json() : await response.text();
                } catch (e) {
                    console.error('PMsToolKit: Failed to parse fetch response', e);
                }
                sendResponse({ ok: response.ok, status: response.status, data });
            })
            .catch(error => {
                console.error(`PMsToolKit: Background fetch error for ${message.url}`, error);
                sendResponse({ ok: false, status: 500, error: error.message });
            });
        return true; // Required for async sendResponse
    } else if (message.type === 'GET_PR_SNAPSHOT') {
        const normalizedTicketKey = normalizeTicketKey(message.ticketKey);
        const storageKey = makePrSnapshotStorageKey(normalizedTicketKey);
        chrome.storage.local.get([storageKey], (items) => {
            sendResponse({
                ok: true,
                snapshot: Object.prototype.hasOwnProperty.call(items, storageKey) ? items[storageKey] : null,
            });
        });
        return true;
    } else if (message.type === 'GET_PR_SNAPSHOTS') {
        const ticketKeys = Array.isArray(message.ticketKeys) ? message.ticketKeys.map(normalizeTicketKey).filter(Boolean) : [];
        const storageKeys = getPrSnapshotStorageKeys(ticketKeys);
        chrome.storage.local.get(storageKeys, (items) => {
            const snapshotsByKey = {};
            ticketKeys.forEach(ticketKey => {
                const storageKey = makePrSnapshotStorageKey(ticketKey);
                if (Object.prototype.hasOwnProperty.call(items, storageKey)) {
                    snapshotsByKey[ticketKey] = items[storageKey];
                }
            });
            sendResponse({ ok: true, snapshotsByKey });
        });
        return true;
    } else if (message.type === 'REFRESH_PR_SNAPSHOTS') {
        resolveGithubPrBatch(message.payload || {})
            .then(result => sendResponse({ ok: true, ...result, availability: getGithubAvailabilityState() }))
            .catch(error => sendResponse({ ok: false, error: error.message || 'Unexpected GitHub PR sync error' }));
        return true;
    } else if (message.type === 'GET_PR_AVAILABILITY') {
        hydrateGithubPrPool()
            .then(() => sendResponse({ ok: true, availability: getGithubAvailabilityState() }))
            .catch(error => sendResponse({ ok: false, error: error.message || 'Unexpected GitHub availability error' }));
        return true;
    } else if (message.type === 'CLEAR_PR_SNAPSHOT_CACHE') {
        clearPrSnapshotCache(message.payload || {})
            .then(() => sendResponse({ ok: true, availability: getGithubAvailabilityState() }))
            .catch(error => sendResponse({ ok: false, error: error.message || 'Unexpected GitHub PR cache clear error' }));
        return true;
    }
});

chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);
initialize();

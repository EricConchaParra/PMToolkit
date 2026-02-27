// PMsToolKit — Background Script
// Handles alarms and system notifications for notes
console.log('PMsToolKit: Background script starting...');

chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('PMsToolKit: Alarm triggered:', alarm.name);
    if (alarm.name.startsWith('reminder_')) {
        const issueKey = alarm.name.replace('reminder_', '');
        handleReminder(issueKey);
    }
});

async function getTicketSummary(issueKey) {
    return new Promise((resolve) => {
        // Strip prefix for API call if it exists
        const cleanKey = issueKey.includes(':') ? issueKey.split(':')[1] : issueKey;

        chrome.storage.local.get(['et_jira_host', `ticket_cache_${cleanKey}`], async (result) => {
            const cached = result[`ticket_cache_${cleanKey}`];
            if (cached && (Date.now() - cached.timestamp < 3600000)) {
                return resolve(cached.details.summary);
            }

            const host = result.et_jira_host || 'jira.atlassian.net';
            try {
                const resp = await fetch(`https://${host}/rest/api/2/issue/${cleanKey}?fields=summary`);
                if (resp.ok) {
                    const data = await resp.json();
                    const summary = data.fields?.summary || '';
                    resolve(summary);
                } else {
                    resolve('');
                }
            } catch (e) {
                resolve('');
            }
        });
    });
}

async function handleReminder(issueKey) {
    const summary = await getTicketSummary(issueKey);
    const finalKey = issueKey.includes(':') ? issueKey : `jira:${issueKey}`;
    const ignoredKey = `ignored_${finalKey}`;
    const storageKey = `notes_${finalKey}`;

    chrome.storage.local.get([storageKey, 'pending_alerts', ignoredKey], (result) => {
        if (result[ignoredKey]) {
            console.log(`PMsToolKit: Skipping ignored reminder for ${finalKey}`);
            return;
        }

        const noteText = result[storageKey] || '';
        const pendingAlerts = result.pending_alerts || [];

        // Add to pending alerts if not already there
        if (!pendingAlerts.includes(issueKey)) {
            pendingAlerts.push(issueKey);
            chrome.storage.local.set({ pending_alerts: pendingAlerts });
        }

        chrome.notifications.create(`reminder_${issueKey}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon.png'),
            title: `Reminder: ${issueKey}`,
            message: (summary ? `${summary}\n` : '') + (noteText.length > 100 ? noteText.substring(0, 97) + '...' : noteText),
            priority: 2,
            requireInteraction: true
        });

        // Notify active content scripts
        chrome.tabs.query({ url: 'https://*.atlassian.net/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'REMINDER_FIRED',
                    issueKey: issueKey,
                    noteText: noteText,
                    summary: summary
                }).catch(() => { /* Ignore errors for inactive tabs */ });
            });
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TEST_NOTIFICATION') {
        chrome.notifications.create('test_notif', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon.png'),
            title: 'PMsToolKit Test',
            message: 'If you see this, system notifications are working correctly! 🎉',
            priority: 2,
            requireInteraction: true
        });
        sendResponse({ success: true });
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('reminder_')) {
        const issueKey = notificationId.replace('reminder_', '');

        // Remove from pending when clicked
        chrome.storage.local.get(['pending_alerts', 'et_jira_host'], (result) => {
            const pending = (result.pending_alerts || []).filter(k => k !== issueKey);
            chrome.storage.local.set({ pending_alerts: pending });

            const host = result.et_jira_host || 'jira.atlassian.net';
            const cleanKey = issueKey.includes(':') ? issueKey.split(':')[1] : issueKey;
            const url = `https://${host}/browse/${cleanKey}`;
            chrome.tabs.create({ url });
            chrome.notifications.clear(notificationId);
        });
    }
});

// Sync alarms when storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        for (const [key, { newValue }] of Object.entries(changes)) {
            if (key.startsWith('reminder_')) {
                const issueKey = key.replace('reminder_', '');
                if (newValue) {
                    console.log(`PMsToolKit: Setting alarm for ${issueKey} at ${new Date(newValue).toLocaleString()}`);
                    chrome.alarms.create(key, { when: newValue });
                } else {
                    console.log(`PMsToolKit: Clearing alarm for ${issueKey}`);
                    chrome.alarms.clear(key);
                }
            }
        }
    }
});

// Startup synchronization & Migration
function initializeExtension() {
    chrome.storage.local.get(null, (items) => {
        const now = Date.now();
        const updates = {};
        let needsUpdate = false;

        for (const [key, value] of Object.entries(items)) {
            // Migration: Add jira: prefix to legacy keys
            if (key.startsWith('notes_') && !key.includes(':')) {
                const ticketKey = key.replace('notes_', '');
                updates[`notes_jira:${ticketKey}`] = value;
                chrome.storage.local.remove(key);
                needsUpdate = true;
                continue;
            }
            if (key.startsWith('reminder_') && !key.includes(':')) {
                const ticketKey = key.replace('reminder_', '');
                updates[`reminder_jira:${ticketKey}`] = value;
                chrome.storage.local.remove(key);
                needsUpdate = true;
                continue;
            }

            // Sync Alarms
            if (key.startsWith('reminder_')) {
                const timestamp = value;
                const ticketKey = key.replace('reminder_', '');
                const ignoredKey = `ignored_${ticketKey}`;

                if (timestamp > now) {
                    chrome.alarms.create(key, { when: timestamp });
                } else if (timestamp > 0 && !items[ignoredKey]) {
                    // It fired while we were away and not ignored
                    handleReminder(ticketKey);
                }
            }
        }

        if (needsUpdate) {
            chrome.storage.local.set(updates);
        }
    });
}

chrome.runtime.onStartup.addListener(initializeExtension);
chrome.runtime.onInstalled.addListener(initializeExtension);
initializeExtension();

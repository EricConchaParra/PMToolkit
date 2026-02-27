/**
 * Background Service Worker for PMToolkit Extension.
 */

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

        chrome.notifications.create(`reminder_${issueKey}`, {
            type: 'basic',
            iconUrl: '/assets/icon.png',
            title: `Reminder: ${issueKey}`,
            message: (summary ? `${summary}\n` : '') + (noteText.length > 100 ? noteText.substring(0, 97) + '...' : noteText),
            priority: 2,
            requireInteraction: true
        });

        chrome.tabs.query({ url: 'https://*.atlassian.net/*' }, (tabs) => {
            tabs.forEach(tab => {
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

chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);
initialize();

// PMsToolKit — Popup Logic

const notesListEl = document.getElementById('notes-list');
const notesCountEl = document.getElementById('notes-count');
const searchInput = document.getElementById('search');
const settingsToggle = document.getElementById('settings-toggle');
const notesView = document.getElementById('notes-view');
const settingsView = document.getElementById('settings-view');
const viewTitle = document.getElementById('view-title');

let allNotes = [];
let currentView = 'notes';

// ---- View Management ----

function switchView(view) {
    if (view === 'settings') {
        notesView.style.display = 'none';
        settingsView.style.display = 'block';
        notesCountEl.style.display = 'none';
        viewTitle.innerHTML = '<span>⚙️</span> Settings';
        settingsToggle.innerHTML = '📝';
        settingsToggle.title = 'Back to Notes';
        currentView = 'settings';
        loadSettings();
    } else {
        notesView.style.display = 'block';
        settingsView.style.display = 'none';
        notesCountEl.style.display = 'inline-block';
        viewTitle.innerHTML = '<span>📝</span> My Notes';
        settingsToggle.innerHTML = '⚙️';
        settingsToggle.title = 'Settings';
        currentView = 'notes';
        loadNotes();
    }
}

settingsToggle.addEventListener('click', () => {
    switchView(currentView === 'notes' ? 'settings' : 'notes');
});

// ---- Settings Logic ----

function loadSettings() {
    chrome.storage.sync.get(globalThis.DEFAULT_SETTINGS, (settings) => {
        document.querySelectorAll('[data-setting]').forEach(input => {
            const key = input.dataset.setting;
            input.checked = settings[key] !== false;
        });
    });
}

document.querySelectorAll('[data-setting]').forEach(input => {
    input.addEventListener('change', (e) => {
        const key = e.target.dataset.setting;
        const value = e.target.checked;
        chrome.storage.sync.set({ [key]: value });
    });
});

const TICKET_CACHE_PREFIX = 'ticket_cache_';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

async function fetchTicketDetails(ticketKey) {
    // Determine source
    const [source, id] = ticketKey.includes(':') ? ticketKey.split(':') : ['jira', ticketKey];

    if (source !== 'jira') {
        // Placeholder for future sources (GitHub, etc.)
        return { summary: `${source} issue`, assignee: 'N/A', status: null };
    }

    const host = getJiraHost();
    const cacheKey = `${TICKET_CACHE_PREFIX}${id}`;

    // Check cache first
    try {
        const cached = await new Promise(resolve => chrome.storage.local.get(cacheKey, resolve));
        const cacheData = cached[cacheKey];
        if (cacheData && (Date.now() - cacheData.timestamp < CACHE_TTL)) {
            return cacheData.details;
        }
    } catch (e) {
        console.warn('PMsToolKit: Cache read error', e);
    }

    try {
        const resp = await fetch(
            `https://${host}/rest/api/2/issue/${id}?fields=summary,assignee,status`,
            { credentials: 'include' }
        );
        if (!resp.ok) return { summary: '', assignee: '', status: null };
        const data = await resp.json();
        const details = {
            summary: data.fields?.summary || '',
            assignee: data.fields?.assignee?.displayName || 'Unassigned',
            status: {
                name: data.fields?.status?.name || 'Unknown',
                category: data.fields?.status?.statusCategory?.key || 'new'
            }
        };

        // Update cache
        chrome.storage.local.set({
            [cacheKey]: {
                timestamp: Date.now(),
                details: details
            }
        });

        return details;
    } catch {
        return { summary: '', assignee: '', status: null };
    }
}

function loadNotes() {
    chrome.storage.local.get(null, async (items) => {
        allNotes = [];
        const ticketKeys = new Set();

        for (const key of Object.keys(items)) {
            if (key.startsWith('notes_')) ticketKeys.add(key.replace('notes_', ''));
            if (key.startsWith('reminder_')) ticketKeys.add(key.replace('reminder_', ''));
        }

        for (const ticketKey of ticketKeys) {
            const noteText = items[`notes_${ticketKey}`] || '';
            const reminder = items[`reminder_${ticketKey}`];
            const cleanKey = ticketKey.split(':').pop();
            const cacheKey = `${TICKET_CACHE_PREFIX}${cleanKey}`;
            const cachedData = items[cacheKey];

            allNotes.push({
                ticketKey,
                text: noteText,
                summary: cachedData?.details?.summary || '',
                assignee: cachedData?.details?.assignee || '',
                status: cachedData?.details?.status || null,
                reminder: reminder || null
            });
        }

        // Sort:
        // 1. Overdue reminders (fired) first
        // 2. Future reminders sorted by timestamp
        // 3. Notes without reminders
        allNotes.sort((a, b) => {
            if (a.reminder && b.reminder) return a.reminder - b.reminder;
            if (a.reminder) return -1;
            if (b.reminder) return 1;
            return (a.ticketKey || '').localeCompare(b.ticketKey || '');
        });


        // Initial render with cached data (or empty if no cache)
        renderNotes(allNotes);

        // Refresh details in parallel (only if expired or missing)
        const promises = allNotes.map(async (note) => {
            const details = await fetchTicketDetails(note.ticketKey);
            // Only re-render if data has changed to avoid flicker
            if (JSON.stringify(details) !== JSON.stringify({
                summary: note.summary,
                assignee: note.assignee,
                status: note.status
            })) {
                note.summary = details.summary;
                note.assignee = details.assignee;
                note.status = details.status;
                return true;
            }
            return false;
        });

        const results = await Promise.all(promises);
        if (results.some(r => r === true)) {
            renderNotes(allNotes);
        }
    });
}

function renderNotes(notes) {
    if (currentView !== 'notes') return;

    notesCountEl.textContent = `${notes.length} note${notes.length !== 1 ? 's' : ''}`;

    const now = Date.now();

    if (notes.length === 0) {
        notesListEl.innerHTML = `
            <div class="empty-state">
                <div class="emoji">📋</div>
                <div>${searchInput.value ? 'No results' : 'You have no saved notes'}</div>
            </div>
        `;
        return;
    }

    notesListEl.innerHTML = notes.map(note => {
        const summaryHtml = note.summary
            ? `<span class="note-summary" title="${escapeHtml(note.summary)}">${escapeHtml(note.summary)}</span>`
            : '';
        const assigneeHtml = note.assignee
            ? `<span class="note-assignee">${escapeHtml(note.assignee)}</span>`
            : '';

        const statusHtml = note.status
            ? `<span class="note-status-badge status-${note.status.category}">${escapeHtml(note.status.name)}</span>`
            : '';

        const metaLine = (summaryHtml || assigneeHtml || statusHtml)
            ? `<div class="note-meta">
                <div class="note-meta-top">
                    ${statusHtml}
                    ${summaryHtml}
                </div>
                ${assigneeHtml ? `<div class="note-meta-bottom">${assigneeHtml}</div>` : ''}
               </div>`
            : '';

        const reminderHtml = note.reminder
            ? `<div class="note-reminder-badge ${note.reminder < now ? 'overdue' : 'future'}">
                <span>🔔</span> ${new Date(note.reminder).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
               </div>`
            : '';


        const cleanKey = note.ticketKey.split(':').pop();
        const source = note.ticketKey.split(':').shift();

        return `
        <div class="note-item" data-key="${note.ticketKey}">
            <div class="note-header">
                ${source === 'jira'
                ? `<a class="note-key" href="https://${getJiraHost()}/browse/${cleanKey}" target="_blank">${cleanKey}</a>`
                : `<span class="note-key">${cleanKey}</span>`
            }
                <div class="note-actions">
                    <button class="reminder-toggle-btn icon-only" data-key="${note.ticketKey}" title="Add/Edit Reminder">🔔</button>
                    ${source === 'jira' ? `<button class="copy-btn icon-only" data-key="${note.ticketKey}" title="Copy Slack Link">🔗</button>` : ''}
                    <button class="delete-btn icon-only" data-key="${note.ticketKey}" title="Delete note">🗑️</button>
                </div>
            </div>
            ${metaLine}
            ${note.text ? `<div class="note-text">${escapeHtml(note.text)}</div>` : '<div class="note-text" style="font-style: italic; opacity: 0.7;">No note content — just a reminder.</div>'}
            ${reminderHtml}

            <div class="note-reminder-picker" id="picker-${note.ticketKey.replace(':', '\\:')}" style="display: none;">
                <div class="picker-row">
                    <input type="datetime-local" class="reminder-date-input" value="${note.reminder ? new Date(note.reminder - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ''}">
                    <button class="save-reminder-btn" data-key="${note.ticketKey}">Save</button>
                </div>
                <div class="picker-shortcuts">
                    <button class="p-shortcut" data-key="${note.ticketKey}" data-time="1h">1h</button>
                    <button class="p-shortcut" data-key="${note.ticketKey}" data-time="2h">2h</button>
                    <button class="p-shortcut" data-key="${note.ticketKey}" data-time="tomorrow">9am</button>
                </div>
            </div>
        </div>
    `;
    }).join('');

    // Event listeners
    notesListEl.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cleanKey = key.split(':').pop();
            const note = notes.find(n => n.ticketKey === key);
            if (note) {
                const url = `https://${getJiraHost()}/browse/${cleanKey}`;
                const summary = note.summary || '';
                const plainText = `${key} ${summary}`;
                const htmlLink = `<a href="${url}">${key} ${summary}</a>`;

                const data = [new ClipboardItem({
                    'text/plain': new Blob([plainText], { type: 'text/plain' }),
                    'text/html': new Blob([htmlLink], { type: 'text/html' })
                })];

                navigator.clipboard.write(data).then(() => {
                    const original = btn.innerHTML;
                    btn.innerHTML = '✅';
                    setTimeout(() => btn.innerHTML = original, 1200);
                });
            }
        });
    });

    notesListEl.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.key;
            if (confirm(`Delete note for ${key}?`)) {
                chrome.storage.local.remove(`notes_${key}`, () => {
                    chrome.storage.local.remove(`reminder_${key}`, () => loadNotes());
                });
            }
        });
    });

    notesListEl.querySelectorAll('.reminder-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.key;
            const picker = document.getElementById(`picker-${key.replace(':', '\\:')}`);
            picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
        });
    });

    notesListEl.querySelectorAll('.save-reminder-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.key;
            const input = btn.previousElementSibling;
            saveReminder(key, input.value);
        });
    });

    notesListEl.querySelectorAll('.p-shortcut').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.key;
            const time = btn.dataset.time;
            applyReminderShortcut(key, time);
        });
    });
}

function applyReminderShortcut(key, type) {
    const now = new Date();
    let target = new Date(now);

    if (type === '1h') target.setHours(now.getHours() + 1);
    else if (type === '2h') target.setHours(now.getHours() + 2);
    else if (type === 'tomorrow') {
        target.setDate(now.getDate() + 1);
        target.setHours(9, 0, 0, 0);
    }

    const timestamp = target.getTime();
    chrome.storage.local.set({ [`reminder_${key}`]: timestamp }, () => loadNotes());
}

function saveReminder(key, value) {
    if (!value) {
        chrome.storage.local.remove(`reminder_${key}`, () => loadNotes());
        return;
    }
    const timestamp = new Date(value).getTime();
    chrome.storage.local.set({ [`reminder_${key}`]: timestamp }, () => loadNotes());
}

function getJiraHost() {
    return localStorage.getItem('et_jira_host') || 'jira.atlassian.net';
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) {
        try {
            const host = new URL(tabs[0].url).hostname;
            if (host.includes('atlassian.net')) {
                localStorage.setItem('et_jira_host', host);
                chrome.storage.local.set({ 'et_jira_host': host });
            }
        } catch (e) { /* ignore */ }
    }
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
        renderNotes(allNotes);
        return;
    }
    const filtered = allNotes.filter(n =>
        n.ticketKey.toLowerCase().includes(query) ||
        n.text.toLowerCase().includes(query)
    );
    renderNotes(filtered);
});

// Diagnostics
const testNotifBtn = document.getElementById('test-notification-btn');
if (testNotifBtn) {
    testNotifBtn.addEventListener('click', () => {
        const statusEl = document.getElementById('notif-status');
        statusEl.style.display = 'block';
        statusEl.textContent = '⏱ Checking permissions...';
        statusEl.style.color = '#6b778c';

        chrome.notifications.getPermissionLevel((level) => {
            if (level !== 'granted') {
                statusEl.textContent = `❌ Permission is "${level}". Chrome has blocked notifications for this extension.`;
                statusEl.style.color = '#de350b';
                return;
            }

            statusEl.textContent = '⏱ Sending test notification...';
            chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' }, (response) => {
                if (chrome.runtime.lastError) {
                    statusEl.textContent = '❌ Error: ' + chrome.runtime.lastError.message;
                    statusEl.style.color = '#de350b';
                } else {
                    statusEl.innerHTML = `
                        <div style="color: #00875a; font-weight: bold; margin-bottom: 4px;">✅ Notification sent!</div>
                        <div style="color: #6b778c; line-height: 1.4;">
                            If you didn't see it, please check:<br>
                            1. <b>macOS System Settings</b> > Notifications > Google Chrome (Ensure "Allow Notifications" is ON)<br>
                            2. <b>Focus/Do Not Disturb</b> mode is OFF.<br>
                            3. Chrome doesn't ask for permission via popup for extensions; it's managed in System Settings.
                        </div>
                    `;
                }
            });
        });
    });
}

// Init
loadNotes();


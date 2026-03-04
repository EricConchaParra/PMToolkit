import { storage, syncStorage } from '../common/storage.js';
import { jiraApi } from '../common/jira-api.js';

const DEFAULT_SETTINGS = {
    jira_hide_elements: true,
    jira_collapse_sidebar: true,
    jira_manual_menu: true,
    jira_copy_for_slack: true,
    jira_quick_notes_list: true,
    jira_quick_notes_ticket: true,
    jira_breadcrumb_copy: true,
    jira_age_indicators: true,
    jira_board_age: true,
    jira_sp_summary: true,
    jira_velocity_per_dev: true,
    jira_native_table_icons: true,
    zoom_copy_transcript: true
};

document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const notesView = document.getElementById('notes-view');
    const settingsView = document.getElementById('settings-view');
    const settingsToggle = document.getElementById('settings-toggle');
    const viewTitle = document.getElementById('view-title');
    const notesList = document.getElementById('notes-list');
    const notesCount = document.getElementById('notes-count');
    const searchInput = document.getElementById('search');
    const testNotifBtn = document.getElementById('test-notification-btn');
    const notifStatus = document.getElementById('notif-status');

    let allNotes = [];
    let isSettingsOpen = false;
    let currentJiraHost = 'jira.atlassian.net';

    // --- View Toggling ---
    settingsToggle.addEventListener('click', () => {
        isSettingsOpen = !isSettingsOpen;
        if (isSettingsOpen) {
            notesView.style.display = 'none';
            settingsView.style.display = 'block';
            viewTitle.textContent = '⚙️ Settings';
            settingsToggle.textContent = '📝';
        } else {
            notesView.style.display = 'block';
            settingsView.style.display = 'none';
            viewTitle.textContent = '📝 My Notes';
            settingsToggle.textContent = '⚙️';
        }
    });

    // --- Notes Logic ---
    async function loadNotes() {
        const data = await storage.getAll();
        const notesMap = {};
        const remindersMap = {};
        const metaMap = {};

        Object.entries(data).forEach(([key, value]) => {
            if (key.startsWith('notes_jira:')) {
                const ticketKey = key.replace('notes_jira:', '');
                notesMap[ticketKey] = value;
            } else if (key.startsWith('reminder_jira:')) {
                const ticketKey = key.replace('reminder_jira:', '');
                remindersMap[ticketKey] = value;
            } else if (key.startsWith('meta_jira:')) {
                const ticketKey = key.replace('meta_jira:', '');
                metaMap[ticketKey] = value;
            }
        });

        const allKeys = new Set([...Object.keys(notesMap), ...Object.keys(remindersMap)]);

        // Fetch missing meta or missing status in meta
        const missingMetaKeys = [];
        for (const key of allKeys) {
            if (!metaMap[key] || !metaMap[key].status) {
                missingMetaKeys.push(key);
            }
        }

        if (missingMetaKeys.length > 0) {
            viewTitle.textContent = '⏳ Loading info...';
            // Fetch one by one or concurrently, Jira API might complain if we blast it
            for (const key of missingMetaKeys) {
                const details = await jiraApi.fetchIssueDetails(key);
                if (details) {
                    metaMap[key] = {
                        summary: details.summary,
                        assignee: details.assignee,
                        status: details.status
                    };
                    await storage.set({ [`meta_jira:${key}`]: metaMap[key] });
                }
            }
            viewTitle.textContent = '📝 My Notes';
        }

        allNotes = Array.from(allKeys).map(key => ({
            key,
            text: notesMap[key] || '',
            reminder: remindersMap[key] || null,
            meta: metaMap[key] || null
        })).sort((a, b) => b.key.localeCompare(a.key));

        renderNotes(allNotes);
    }

    function renderNotes(notes) {
        notesList.innerHTML = '';
        notesCount.textContent = notes.length;

        if (notes.length === 0) {
            notesList.innerHTML = `
                <div class="empty-state">
                    <div class="emoji">📝</div>
                    <p>No notes found.</p>
                </div>
            `;
            return;
        }

        notes.forEach(item => {
            const el = document.createElement('div');
            el.className = 'note-item';

            const isOverdue = item.reminder && item.reminder < Date.now();
            const reminderHtml = item.reminder ? `
                <div class="note-reminder-badge ${isOverdue ? 'overdue' : 'future'}">
                    <span>🔔</span> ${new Date(item.reminder).toLocaleString()}
                </div>
            ` : '';

            // Note: item.text might be the note itself
            const summaryText = item.meta ? item.meta.summary : 'No summary loaded';
            const assigneeText = item.meta ? item.meta.assignee : 'Unknown assignee';
            const status = item.meta ? item.meta.status : null;

            const statusHtml = status ? `
                <div class="note-status-badge status-${status.category}">${status.name}</div>
            ` : '';

            const summaryHtml = `
                <div class="note-meta">
                    <div class="note-meta-top">
                        ${statusHtml}
                        <div class="note-summary" title="${summaryText}">${summaryText}</div>
                    </div>
                    <div class="note-meta-bottom">
                        👤 ${assigneeText}
                    </div>
                </div>
            `;

            const host = currentJiraHost;

            el.innerHTML = `
                <div class="note-header">
                    <a href="https://${host}/browse/${item.key}" target="_blank" class="note-key">${item.key}</a>
                    <div class="note-actions">
                        <button class="icon-only copy-btn" title="Copy Link for Slack">🔗</button>
                        <button class="icon-only delete-btn" title="Delete note">🗑️</button>
                    </div>
                </div>
                ${summaryHtml}
                ${item.text ? `<div class="note-text">${item.text}</div>` : ''}
                ${reminderHtml}
            `;

            el.querySelector('.copy-btn').onclick = () => {
                const url = `https://${host}/browse/${item.key}`;
                const plainTextCopy = `${item.key} - ${summaryText}`;
                const htmlLink = `<a href="${url}">${plainTextCopy}</a>`;
                const markdownLink = `[${plainTextCopy}](${url})`;

                const data = [new ClipboardItem({
                    'text/plain': new Blob([markdownLink], { type: 'text/plain' }),
                    'text/html': new Blob([htmlLink], { type: 'text/html' })
                })];

                navigator.clipboard.write(data).then(() => {
                    const btn = el.querySelector('.copy-btn');
                    const original = btn.textContent;
                    btn.textContent = '✅';
                    setTimeout(() => btn.textContent = original, 1500);
                }).catch(err => {
                    // Fallback
                    navigator.clipboard.writeText(markdownLink).then(() => {
                        const btn = el.querySelector('.copy-btn');
                        const original = btn.textContent;
                        btn.textContent = '✅';
                        setTimeout(() => btn.textContent = original, 1500);
                    });
                });
            };

            el.querySelector('.delete-btn').onclick = async () => {
                if (confirm(`Delete note for ${item.key}?`)) {
                    await storage.remove(`notes_jira:${item.key}`);
                    await storage.remove(`reminder_jira:${item.key}`);
                    loadNotes();
                }
            };

            notesList.appendChild(el);
        });
    }

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allNotes.filter(n =>
            n.key.toLowerCase().includes(term) ||
            n.text.toLowerCase().includes(term)
        );
        renderNotes(filtered);
    });

    // --- Settings Logic ---
    async function loadSettings() {
        const settings = await syncStorage.get(DEFAULT_SETTINGS);
        document.querySelectorAll('input[data-setting]').forEach(input => {
            const key = input.getAttribute('data-setting');
            if (settings.hasOwnProperty(key)) {
                input.checked = settings[key];
            }
        });
    }

    document.querySelectorAll('input[data-setting]').forEach(input => {
        input.addEventListener('change', async () => {
            const key = input.getAttribute('data-setting');
            await syncStorage.set({ [key]: input.checked });
            // Notify content scripts if needed, but they usually reload on next run
        });
    });

    // --- Diagnostics ---
    testNotifBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
        notifStatus.textContent = 'Test signal sent to background...';
        notifStatus.style.display = 'block';
        setTimeout(() => notifStatus.style.display = 'none', 3000);
    });

    // --- Initialization ---
    // Make sure we have Inter font if requested by CSS (optional but good)
    (async () => {
        try {
            currentJiraHost = await jiraApi.getHost();
        } catch (e) {
            console.error(e);
        }
        loadNotes();
        loadSettings();
    })();
});

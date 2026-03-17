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
    jira_native_table_icons: true,
    zoom_copy_transcript: true,
    github_pr_link: false,
};

document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const notesView = document.getElementById('notes-view');
    const settingsView = document.getElementById('settings-view');
    const settingsToggle = document.getElementById('settings-toggle');
    const syncNotesBtn = document.getElementById('sync-notes-btn');
    const viewTitle = document.getElementById('view-title');
    const notesList = document.getElementById('notes-list');
    const notesCount = document.getElementById('notes-count');
    const searchInput = document.getElementById('search');
    const testNotifBtn = document.getElementById('test-notification-btn');
    const notifStatus = document.getElementById('notif-status');
    const githubToggle = document.getElementById('github-pr-link-toggle');
    const githubPatSection = document.getElementById('github-pat-section');
    const githubPatInput = document.getElementById('github-pat-input');
    const githubPatSaveBtn = document.getElementById('github-pat-save-btn');
    const githubPatStatus = document.getElementById('github-pat-status');

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

    // --- Open Analytics Hub in new tab ---
    const openExporterBtn = document.getElementById('open-exporter-btn');
    openExporterBtn.addEventListener('click', () => {
        const analyticsUrl = chrome.runtime.getURL('src/pages/analytics/index.html');
        chrome.tabs.create({ url: analyticsUrl });
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

    // --- Sync Logic ---
    syncNotesBtn.addEventListener('click', async () => {
        if (syncNotesBtn.classList.contains('syncing-spin')) return; // Prevent double clicks

        syncNotesBtn.classList.add('syncing-spin');
        viewTitle.textContent = '⏳ Syncing statuses...';

        const data = await storage.getAll();
        const allKeys = new Set();

        // Find all keys we know about
        Object.keys(data).forEach(key => {
            if (key.startsWith('notes_jira:')) {
                allKeys.add(key.replace('notes_jira:', ''));
            } else if (key.startsWith('reminder_jira:')) {
                allKeys.add(key.replace('reminder_jira:', ''));
            } else if (key.startsWith('meta_jira:')) {
                allKeys.add(key.replace('meta_jira:', ''));
            }
        });

        // Force fetch fresh data for every key
        for (const key of allKeys) {
            try {
                const details = await jiraApi.fetchIssueDetails(key);
                if (details) {
                    const freshMeta = {
                        summary: details.summary,
                        assignee: details.assignee,
                        status: details.status
                    };
                    await storage.set({ [`meta_jira:${key}`]: freshMeta });
                }
            } catch (err) {
                console.warn(`Failed to sync details for ${key}`, err);
            }
        }

        viewTitle.textContent = '📝 My Notes';
        syncNotesBtn.classList.remove('syncing-spin');

        // Re-render
        await loadNotes();
    });

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

            function renderStandardView() {
                const isOverdue = item.reminder && item.reminder < Date.now();
                const reminderHtml = item.reminder ? `
                    <div class="note-reminder-badge ${isOverdue ? 'overdue' : 'future'}">
                        <span>🔔</span> ${new Date(item.reminder).toLocaleString()}
                    </div>
                ` : '';

                const summaryText = item.meta ? item.meta.summary : 'No summary loaded';
                const assigneeText = item.meta ? item.meta.assignee : 'Unknown assignee';
                const status = item.meta ? item.meta.status : null;
                let statusClass = '';
                if (status) {
                    const n = status.name.toLowerCase();
                    if (n.includes('blocked') || n.includes('hold')) statusClass = 'status-blocked';
                    else if (n.includes('review') || n.includes('reviewing')) statusClass = 'status-inreview';
                    else if (n.includes('qa') || n.includes('test')) statusClass = 'status-qa';
                    else if (n.includes('in progress') || n.includes('progress')) statusClass = 'status-inprogress-specific';
                }

                const statusHtml = status ? `
                    <div class="note-status-badge status-${status.category} ${statusClass}">${status.name}</div>
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
                            <button class="icon-only edit-btn" title="Edit note">✏️</button>
                            <button class="icon-only copy-btn" title="Copy Link for Slack">🔗</button>
                            <button class="icon-only delete-btn" title="Delete note">🗑️</button>
                        </div>
                    </div>
                    ${summaryHtml}
                    ${item.text ? `<div class="note-text">${item.text}</div>` : ''}
                    ${reminderHtml}
                `;

                el.querySelector('.edit-btn').onclick = renderEditView;

                el.querySelector('.copy-btn').onclick = (e) => {
                    const btn = e.currentTarget;
                    if (btn.dataset.isCopying) return;
                    btn.dataset.isCopying = 'true';

                    const url = `https://${host}/browse/${item.key}`;
                    const plainTextCopy = `${item.key} - ${summaryText}`;
                    const htmlLink = `<a href="${url}">${plainTextCopy}</a>`;
                    const markdownLink = `[${plainTextCopy}](${url})`;

                    const data = [new ClipboardItem({
                        'text/plain': new Blob([markdownLink], { type: 'text/plain' }),
                        'text/html': new Blob([htmlLink], { type: 'text/html' })
                    })];

                    const original = btn.textContent;

                    navigator.clipboard.write(data).then(() => {
                        btn.textContent = '✅';
                        setTimeout(() => {
                            btn.textContent = original;
                            delete btn.dataset.isCopying;
                        }, 1500);
                    }).catch(err => {
                        // Fallback
                        navigator.clipboard.writeText(markdownLink).then(() => {
                            btn.textContent = '✅';
                            setTimeout(() => {
                                btn.textContent = original;
                                delete btn.dataset.isCopying;
                            }, 1500);
                        }).catch(e => {
                            delete btn.dataset.isCopying;
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
            }

            function renderEditView() {
                const formatDateTimeLocal = (timestamp) => {
                    if (!timestamp) return '';
                    const d = new Date(timestamp);
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    return d.toISOString().slice(0, 16);
                };

                el.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div class="note-header" style="margin-bottom: 0;">
                            <span class="note-key">${item.key}</span>
                        </div>
                        <textarea class="edit-note-text" style="width:100%; min-height:80px; padding: 10px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: inherit; font-size: 13px; resize: vertical;">${item.text || ''}</textarea>
                        
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label style="font-size: 11px; font-weight: 700; color: var(--text-subtle);">Reminder:</label>
                            <input type="datetime-local" class="edit-reminder-input" style="padding: 8px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: inherit; font-size: 13px;" value="${formatDateTimeLocal(item.reminder)}">
                        </div>
                        
                        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
                            <button class="cancel-edit-btn" style="padding: 6px 12px; background: var(--bg-alt); color: var(--text-main); font-weight: 600; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s;">Cancel</button>
                            <button class="save-edit-btn" style="padding: 6px 12px; background: var(--primary-blue); color: white; font-weight: 600; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s;">Save</button>
                        </div>
                    </div>
                `;

                el.querySelector('.cancel-edit-btn').onclick = renderStandardView;

                el.querySelector('.save-edit-btn').onclick = async () => {
                    const newText = el.querySelector('.edit-note-text').value.trim();
                    const newReminder = el.querySelector('.edit-reminder-input').value;

                    if (newText) {
                        await storage.set({ [`notes_jira:${item.key}`]: newText });
                        item.text = newText;
                    } else {
                        await storage.remove(`notes_jira:${item.key}`);
                        item.text = '';
                    }

                    if (newReminder) {
                        const reminderTimestamp = new Date(newReminder).getTime();
                        await storage.set({ [`reminder_jira:${item.key}`]: reminderTimestamp });
                        item.reminder = reminderTimestamp;
                    } else {
                        await storage.remove(`reminder_jira:${item.key}`);
                        item.reminder = null;
                    }

                    renderStandardView();
                    loadNotes();
                };
            }

            renderStandardView();
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

        // GitHub PAT: show section if already enabled, and pre-fill the stored token
        const isGhEnabled = settings['github_pr_link'] === true;
        syncGitHubPatSection(isGhEnabled);
        if (isGhEnabled) {
            const ghData = await syncStorage.get({ github_pat: '' });
            if (ghData.github_pat) githubPatInput.value = ghData.github_pat;
        }
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

    // --- GitHub PAT Logic ---
    function syncGitHubPatSection(isEnabled) {
        githubPatSection.style.display = isEnabled ? 'block' : 'none';
    }

    githubToggle.addEventListener('change', () => {
        syncGitHubPatSection(githubToggle.checked);
    });

    githubPatSaveBtn.addEventListener('click', async () => {
        const token = githubPatInput.value.trim();
        if (!token) {
            githubPatStatus.textContent = 'Please enter a token.';
            githubPatStatus.style.color = '#ff5630';
            githubPatStatus.style.display = 'block';
            return;
        }
        await syncStorage.set({ github_pat: token });
        githubPatStatus.textContent = '✅ Token saved!';
        githubPatStatus.style.color = '#36b37e';
        githubPatStatus.style.display = 'block';
        setTimeout(() => githubPatStatus.style.display = 'none', 2500);
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

import { syncStorage } from '../common/storage.js';
import { jiraApi } from '../common/jira-api.js';
import { getIssueTypeMeta } from '../common/issueType.js';
import { createTagEditor } from '../common/tagEditor.js';
import { subscribeDemoMode } from '../common/demoMode.js';
import { resetDemoTrackingItems, getAllTrackingItems, removeTrackingItems, setTrackingItems } from '../common/trackingRepository.js';
import {
    TAG_DEFS_STORAGE_KEY,
    ensureTagDefinition,
    escapeHtml,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagsStorageKey,
    getTagInlineStyle,
    getTagObjects,
    hasTrackingStorageChange,
    matchesSearchTerm,
    normalizeTagList,
    parseTrackingStorage,
} from '../common/tagging.js';

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
    demo_mode: false,
};

document.addEventListener('DOMContentLoaded', async () => {
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
    const demoBadge = document.getElementById('demo-mode-badge');
    const demoHint = document.getElementById('demo-mode-hint');
    const resetDemoBtn = document.getElementById('reset-demo-data-btn');
    const demoModeToggle = document.querySelector('input[data-setting="demo_mode"]');

    let allNotes = [];
    let isSettingsOpen = false;
    let currentJiraHost = 'jira.atlassian.net';
    let popupTagDefs = {};
    let storageReloadTimer = null;
    let demoModeEnabled = false;

    function applyDemoModeUi() {
        demoBadge?.classList.toggle('hidden', !demoModeEnabled);
        demoHint?.classList.toggle('hidden', !demoModeEnabled);
        if (resetDemoBtn) resetDemoBtn.style.display = demoModeEnabled ? 'block' : 'none';
        if (syncNotesBtn) {
            syncNotesBtn.disabled = demoModeEnabled;
            syncNotesBtn.title = demoModeEnabled
                ? 'Disabled in Demo Mode'
                : 'Sync Statuses';
        }
    }

    function setPrimaryTitle(text) {
        if (!isSettingsOpen) viewTitle.textContent = text;
    }

    function renderTagList(tagLabels = [], extraClass = '') {
        const tags = getTagObjects(tagLabels, popupTagDefs);
        if (!tags.length) return '';

        return `
            <div class="et-tag-read-list ${extraClass}">
                ${tags.map(tag => `
                    <span class="et-tag-chip" style="${getTagInlineStyle(tag.color)}">
                        <span class="et-tag-chip-dot"></span>
                        <span class="et-tag-chip-label">${escapeHtml(tag.label)}</span>
                    </span>
                `).join('')}
            </div>
        `;
    }

    function applyFiltersAndRender() {
        const filtered = allNotes.filter(item => matchesSearchTerm(item, searchInput.value));
        renderNotes(filtered);
    }

    async function loadNotes() {
        const data = await getAllTrackingItems({ demoMode: demoModeEnabled });
        const parsed = parseTrackingStorage(data);
        const metaMap = { ...parsed.metaMap };
        popupTagDefs = parsed.tagDefs;

        const missingMetaKeys = demoModeEnabled ? [] : parsed.allKeys.filter(key => {
            const meta = metaMap[key];
            return !meta || !meta.status || !Object.prototype.hasOwnProperty.call(meta, 'issueType');
        });
        if (missingMetaKeys.length > 0) {
            setPrimaryTitle('⏳ Loading info...');
            for (const key of missingMetaKeys) {
                const details = await jiraApi.fetchIssueDetails(key);
                if (details) {
                    metaMap[key] = {
                        summary: details.summary,
                        assignee: details.assignee,
                        status: details.status,
                        issueType: details.issueType,
                    };
                    await setTrackingItems({ [`meta_jira:${key}`]: metaMap[key] }, { demoMode: false });
                }
            }
            setPrimaryTitle('📝 My Notes');
        }

        allNotes = parsed.allKeys.map(key => ({
            key,
            text: parsed.notesMap[key] || '',
            reminder: parsed.remindersMap[key] || null,
            tags: parsed.tagsMap[key] || [],
            meta: metaMap[key] || null,
        })).sort((a, b) => b.key.localeCompare(a.key));

        applyFiltersAndRender();
    }

    function renderNotes(notes) {
        notesList.innerHTML = '';
        notesCount.textContent = notes.length;

        if (notes.length === 0) {
            const hasSearch = Boolean(searchInput.value.trim());
            notesList.innerHTML = `
                <div class="empty-state">
                    <div class="emoji">${hasSearch ? '🔎' : '📝'}</div>
                    <p>${hasSearch ? 'No notes, reminders or tags match your search.' : 'No notes, reminders or tags found.'}</p>
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
                        <span>🔔</span> ${escapeHtml(new Date(item.reminder).toLocaleString())}
                    </div>
                ` : '';

                const summaryText = item.meta ? item.meta.summary : 'No summary loaded';
                const assigneeText = item.meta ? item.meta.assignee : 'Unknown assignee';
                const status = item.meta ? item.meta.status : null;
                const issueType = getIssueTypeMeta(item.meta);
                let statusClass = '';
                if (status) {
                    const normalized = status.name.toLowerCase();
                    if (normalized.includes('blocked') || normalized.includes('hold')) statusClass = 'status-blocked';
                    else if (normalized.includes('review') || normalized.includes('reviewing')) statusClass = 'status-inreview';
                    else if (normalized.includes('qa') || normalized.includes('test')) statusClass = 'status-qa';
                    else if (normalized.includes('in progress') || normalized.includes('progress')) statusClass = 'status-inprogress-specific';
                }

                const statusHtml = status ? `
                    <div class="note-status-badge status-${escapeHtml(status.category)} ${statusClass}">${escapeHtml(status.name)}</div>
                ` : '';
                const issueTypeHtml = issueType.iconUrl ? `
                    <img class="note-type-icon" src="${escapeHtml(issueType.iconUrl)}" alt="${escapeHtml(issueType.name || 'Issue type')}" title="${escapeHtml(issueType.name || 'Issue type')}">
                ` : '';

                const host = currentJiraHost;

                el.innerHTML = `
                    <div class="note-header">
                        <div class="note-header-main">
                            ${issueTypeHtml}
                            <a href="https://${host}/browse/${item.key}" target="_blank" class="note-key">${escapeHtml(item.key)}</a>
                            ${statusHtml}
                        </div>
                        <div class="note-actions">
                            <button class="icon-only edit-btn" title="Edit note">✏️</button>
                            <button class="icon-only copy-btn" title="Copy Link for Slack">🔗</button>
                            <button class="icon-only delete-btn" title="Delete tracked item">🗑️</button>
                        </div>
                    </div>
                    <div class="note-summary" title="${escapeHtml(summaryText)}">${escapeHtml(summaryText)}</div>
                    <div class="note-meta">
                        <div class="note-meta-bottom">
                            👤 ${escapeHtml(assigneeText)}
                        </div>
                        ${renderTagList(item.tags, 'popup-note-tags')}
                    </div>
                    ${item.text ? `<div class="note-text">${escapeHtml(item.text)}</div>` : ''}
                    ${reminderHtml}
                `;

                el.querySelector('.edit-btn').onclick = renderEditView;

                el.querySelector('.copy-btn').onclick = e => {
                    const btn = e.currentTarget;
                    if (btn.dataset.isCopying) return;
                    btn.dataset.isCopying = 'true';

                    const url = `https://${host}/browse/${item.key}`;
                    const plainTextCopy = `${item.key} - ${summaryText}`;
                    const htmlLink = `<a href="${url}">${escapeHtml(plainTextCopy)}</a>`;
                    const markdownLink = `[${plainTextCopy}](${url})`;
                    const original = btn.textContent;
                    const data = [new ClipboardItem({
                        'text/plain': new Blob([markdownLink], { type: 'text/plain' }),
                        'text/html': new Blob([htmlLink], { type: 'text/html' }),
                    })];

                    navigator.clipboard.write(data).then(() => {
                        btn.textContent = '✅';
                        setTimeout(() => {
                            btn.textContent = original;
                            delete btn.dataset.isCopying;
                        }, 1500);
                    }).catch(() => {
                        navigator.clipboard.writeText(markdownLink).then(() => {
                            btn.textContent = '✅';
                            setTimeout(() => {
                                btn.textContent = original;
                                delete btn.dataset.isCopying;
                            }, 1500);
                        }).catch(() => {
                            delete btn.dataset.isCopying;
                        });
                    });
                };

                el.querySelector('.delete-btn').onclick = async () => {
                    if (!confirm(`Delete note, reminder, and tags for ${item.key}?`)) return;
                    await removeTrackingItems([
                        getNotesStorageKey(item.key),
                        getReminderStorageKey(item.key),
                        getTagsStorageKey(item.key),
                    ], { demoMode: demoModeEnabled });
                    await loadNotes();
                };
            }

            function renderEditView() {
                const formatDateTimeLocal = timestamp => {
                    if (!timestamp) return '';
                    const date = new Date(timestamp);
                    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
                    return date.toISOString().slice(0, 16);
                };

                let editedTags = item.tags.slice();

                el.innerHTML = `
                    <div class="popup-edit-card">
                        <div class="note-header popup-edit-header">
                            <span class="note-key">${escapeHtml(item.key)}</span>
                        </div>
                        <textarea class="edit-note-text popup-edit-text"></textarea>
                        <div class="popup-edit-field">
                            <label>Reminder</label>
                            <input type="datetime-local" class="edit-reminder-input popup-edit-reminder" value="${formatDateTimeLocal(item.reminder)}">
                        </div>
                        <div class="popup-edit-field">
                            <label>Tags</label>
                            <div class="popup-edit-tags-host"></div>
                        </div>
                        <div class="popup-edit-actions">
                            <button class="cancel-edit-btn">Cancel</button>
                            <button class="save-edit-btn">Save</button>
                        </div>
                    </div>
                `;

                const noteInput = el.querySelector('.edit-note-text');
                noteInput.value = item.text || '';

                const tagEditor = createTagEditor(el.querySelector('.popup-edit-tags-host'), {
                    value: item.tags,
                    tagDefs: popupTagDefs,
                    placeholder: 'Add or create tags...',
                    onCreateTag: async (label, color) => {
                        const created = demoModeEnabled
                            ? (() => {
                                const normalized = String(label || '').trim().toLocaleLowerCase();
                                if (!normalized) return null;
                                return {
                                    normalized,
                                    label: String(label || '').trim().replace(/\s+/g, ' '),
                                    color: color || 'gray',
                                };
                            })()
                            : await ensureTagDefinition(label, color);
                        if (!created) return false;
                        popupTagDefs = {
                            ...popupTagDefs,
                            [created.normalized]: {
                                label: created.label,
                                color: created.color,
                            },
                        };
                        if (demoModeEnabled) {
                            await setTrackingItems({
                                [TAG_DEFS_STORAGE_KEY]: popupTagDefs,
                            }, { demoMode: true });
                        }
                        tagEditor.setTagDefs(popupTagDefs);
                        return created;
                    },
                    onChange: tags => {
                        editedTags = tags.slice();
                    },
                });

                el.querySelector('.cancel-edit-btn').onclick = () => {
                    tagEditor.destroy();
                    renderStandardView();
                };

                el.querySelector('.save-edit-btn').onclick = async () => {
                    const newText = noteInput.value.trim();
                    const newReminder = el.querySelector('.edit-reminder-input').value;
                    const finalTags = normalizeTagList(editedTags, popupTagDefs);

                    if (newText) await setTrackingItems({ [getNotesStorageKey(item.key)]: newText }, { demoMode: demoModeEnabled });
                    else await removeTrackingItems(getNotesStorageKey(item.key), { demoMode: demoModeEnabled });

                    if (newReminder) {
                        const reminderTimestamp = new Date(newReminder).getTime();
                        await setTrackingItems({ [getReminderStorageKey(item.key)]: reminderTimestamp }, { demoMode: demoModeEnabled });
                    } else {
                        await removeTrackingItems(getReminderStorageKey(item.key), { demoMode: demoModeEnabled });
                    }

                    if (finalTags.length) await setTrackingItems({ [getTagsStorageKey(item.key)]: finalTags }, { demoMode: demoModeEnabled });
                    else await removeTrackingItems(getTagsStorageKey(item.key), { demoMode: demoModeEnabled });

                    item.text = newText;
                    item.reminder = newReminder ? new Date(newReminder).getTime() : null;
                    item.tags = finalTags;

                    tagEditor.destroy();
                    await loadNotes();
                };
            }

            renderStandardView();
            notesList.appendChild(el);
        });
    }

    settingsToggle.addEventListener('click', () => {
        isSettingsOpen = !isSettingsOpen;
        if (isSettingsOpen) {
            notesView.style.display = 'none';
            settingsView.style.display = 'block';
            viewTitle.textContent = '⚙️ Settings';
            settingsToggle.textContent = '📝';
        } else {
            notesView.style.display = 'flex';
            settingsView.style.display = 'none';
            viewTitle.textContent = '📝 My Notes';
            settingsToggle.textContent = '⚙️';
        }
    });

    document.getElementById('open-exporter-btn').addEventListener('click', () => {
        const analyticsUrl = chrome.runtime.getURL('src/pages/analytics/index.html');
        chrome.tabs.create({ url: analyticsUrl });
    });

    syncNotesBtn.addEventListener('click', async () => {
        if (demoModeEnabled) return;
        if (syncNotesBtn.classList.contains('syncing-spin')) return;

        syncNotesBtn.classList.add('syncing-spin');
        setPrimaryTitle('⏳ Syncing statuses...');

        const data = await getAllTrackingItems({ demoMode: false });
        const parsed = parseTrackingStorage(data);

        for (const key of parsed.allKeys) {
            try {
                const details = await jiraApi.fetchIssueDetails(key);
                if (!details) continue;
                await setTrackingItems({
                    [`meta_jira:${key}`]: {
                        summary: details.summary,
                        assignee: details.assignee,
                        status: details.status,
                        issueType: details.issueType,
                    },
                }, { demoMode: false });
            } catch (err) {
                console.warn(`Failed to sync details for ${key}`, err);
            }
        }

        syncNotesBtn.classList.remove('syncing-spin');
        setPrimaryTitle('📝 My Notes');
        await loadNotes();
    });

    searchInput.addEventListener('input', applyFiltersAndRender);

    async function loadSettings() {
        const settings = await syncStorage.get(DEFAULT_SETTINGS);
        demoModeEnabled = settings.demo_mode === true;
        applyDemoModeUi();
        document.querySelectorAll('input[data-setting]').forEach(input => {
            const key = input.getAttribute('data-setting');
            if (Object.prototype.hasOwnProperty.call(settings, key)) {
                input.checked = settings[key];
            }
        });

        const isGhEnabled = settings.github_pr_link === true;
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
            if (key === 'demo_mode') {
                demoModeEnabled = input.checked;
                applyDemoModeUi();
                currentJiraHost = await jiraApi.getHost();
                await loadNotes();
            }
        });
    });

    testNotifBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
        notifStatus.textContent = 'Test signal sent to background...';
        notifStatus.style.display = 'block';
        setTimeout(() => {
            notifStatus.style.display = 'none';
        }, 3000);
    });

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
        setTimeout(() => {
            githubPatStatus.style.display = 'none';
        }, 2500);
    });

    resetDemoBtn?.addEventListener('click', async () => {
        await resetDemoTrackingItems();
        await loadNotes();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
            if (demoModeEnabled) return;
            if (!hasTrackingStorageChange(changes, { includeMeta: true })) return;

            clearTimeout(storageReloadTimer);
            storageReloadTimer = setTimeout(() => {
                loadNotes();
            }, 120);
        }
    });

    subscribeDemoMode(async enabled => {
        demoModeEnabled = enabled;
        if (demoModeToggle) demoModeToggle.checked = enabled;
        applyDemoModeUi();
        currentJiraHost = await jiraApi.getHost();
        await loadNotes();
    });

    try {
        currentJiraHost = await jiraApi.getHost();
    } catch (e) {
        console.error(e);
    }

    await loadSettings();
    await loadNotes();
});

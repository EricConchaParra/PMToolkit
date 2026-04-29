import { createTagEditor } from '../../../common/tagEditor.js';
import { DEMO_HOST } from '../../../common/demoData.js';
import { getTrackingItems, removeTrackingItems, setTrackingItems } from '../../../common/trackingRepository.js';
import {
    TRACKING_UPDATED_EVENT,
    ensureTagDefinition,
    hasTrackedContent,
    normalizeTagDefs,
    normalizeTagList,
} from '../../../common/tagging.js';
import { buildJiraTicketRef, getCurrentPageJiraHost, getJiraIssueKey } from '../../../common/jiraIdentity.js';
import {
    getIgnoredStorageKey,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagDefsStorageKey,
    getTagsStorageKey,
} from '../../../common/jiraStorageKeys.js';

export const NoteDrawer = {
    el: null,
    backdrop: null,
    currentKey: null,
    currentHost: '',
    currentTicketRef: '',
    saveTimeout: null,
    tagEditor: null,
    currentTagDefs: {},
    baselineSnapshot: null,
    isDirty: false,
    demoMode: false,
    hostOverride: '',

    setDemoMode(enabled) {
        this.demoMode = enabled === true;
    },

    setHostOverride(host) {
        this.hostOverride = String(host || '').trim();
    },

    hasTrackedItem({ noteText = '', reminderValue = '', tagLabels = [] } = {}) {
        return hasTrackedContent(noteText, reminderValue, tagLabels);
    },

    async initIndicators() {
        const host = this.getCurrentHost();
        if (!host) return;
        const buttons = document.querySelectorAll('.et-notes-btn:not(.et-indicator-checked), .et-ticket-notes-toggle:not(.et-indicator-checked)');
        if (buttons.length === 0) return;

        const keys = new Set();
        buttons.forEach(btn => {
            btn.classList.add('et-indicator-checked');
            const key = btn.getAttribute('data-issue-key');
            if (key) keys.add(key);
        });

        if (keys.size === 0) return;

        const storageKeys = [];
        keys.forEach(k => {
            storageKeys.push(getNotesStorageKey(k, host), getReminderStorageKey(k, host), getTagsStorageKey(k, host));
        });

        const result = await getTrackingItems(storageKeys, { demoMode: this.demoMode });

        keys.forEach(k => {
            const notesKey = getNotesStorageKey(k, host);
            const reminderKey = getReminderStorageKey(k, host);
            const tagsKey = getTagsStorageKey(k, host);
            const hasNote = !!result[notesKey];
            const hasReminder = !!result[reminderKey];
            const tags = Array.isArray(result[tagsKey]) ? result[tagsKey] : [];
            const hasActiveItem = this.hasTrackedItem({
                noteText: hasNote ? result[notesKey] : '',
                reminderValue: hasReminder ? result[reminderKey] : '',
                tagLabels: tags,
            });

            if (hasActiveItem) {
                const cleanSuffix = getJiraIssueKey(k) || k;
                document.querySelectorAll(`[data-issue-key="${cleanSuffix}"], [data-issue-key="jira:${cleanSuffix}"]`).forEach(btn => {
                    if (btn.classList.contains('et-ticket-notes-toggle')) {
                        const span = btn.querySelector('span');
                        if (span) span.textContent = 'Personal notes ●';
                    } else {
                        btn.classList.add('has-note');
                    }
                });
            }
        });
    },

    init() {
        if (this.el) return;

        this.backdrop = document.createElement('div');
        this.backdrop.className = 'et-drawer-backdrop';
        this.backdrop.onclick = () => this.close();

        this.el = document.createElement('div');
        this.el.className = 'et-drawer';
        this.el.innerHTML = `
            <div class="et-drawer-header">
                <div>
                    <h2 class="et-drawer-title">📝 Note: <span id="et-drawer-key">---</span></h2>
                    <div id="et-drawer-summary" style="font-size: 13px; color: #6b778c; margin-top: 4px; font-weight: 500; line-height: 1.4;"></div>
                </div>
                <button class="et-drawer-close">×</button>
            </div>
            <div class="et-drawer-content">
                <div class="et-drawer-section">
                    <label class="et-drawer-label">Personal Notes</label>
                    <textarea class="et-drawer-textarea" placeholder="Type your notes here..."></textarea>
                </div>
                <div class="et-drawer-section">
                    <label class="et-drawer-label">Reminder</label>
                    <div class="et-drawer-reminder-row">
                        <span>🔔</span>
                        <input type="datetime-local" class="et-drawer-reminder-input">
                    </div>
                    <div class="et-drawer-shortcuts">
                        <button class="et-shortcut-btn" data-time="1h">1 Hr</button>
                        <button class="et-shortcut-btn" data-time="2h">2 Hrs</button>
                        <button class="et-shortcut-btn" data-time="tomorrow">Tomorrow 9am</button>
                        <button class="et-shortcut-btn" data-time="2days">2 Days 9am</button>
                    </div>
                </div>
                <div class="et-drawer-section">
                    <label class="et-drawer-label">Tags</label>
                    <div class="et-drawer-tags-host"></div>
                </div>
            </div>
            <div class="et-drawer-footer">
                <button class="et-drawer-save">Save Note</button>
                <span class="et-drawer-status">✓ Saved</span>
                <button class="et-drawer-delete">Delete</button>
            </div>
        `;

        document.body.appendChild(this.backdrop);
        document.body.appendChild(this.el);

        this.el.querySelector('.et-drawer-close').onclick = () => this.close();
        this.el.querySelector('.et-drawer-save').onclick = async () => {
            await this.save();
            this.close(true); // Skip redundant save on close
        };
        this.el.querySelector('.et-drawer-delete').onclick = () => this.delete();

        const textarea = this.el.querySelector('.et-drawer-textarea');
        const reminderInput = this.el.querySelector('.et-drawer-reminder-input');
        const tagsHost = this.el.querySelector('.et-drawer-tags-host');

        this.tagEditor = createTagEditor(tagsHost, {
            value: [],
            tagDefs: {},
            placeholder: 'Type a tag or create one...',
            onCreateTag: async (label, color) => {
                const created = await ensureTagDefinition(label, color, {
                    demoMode: this.demoMode,
                    host: this.currentHost,
                });
                if (!created) return false;
                this.currentTagDefs = {
                    ...this.currentTagDefs,
                    [created.normalized]: {
                        label: created.label,
                        color: created.color,
                    },
                };
                this.tagEditor?.setTagDefs(this.currentTagDefs);
                return created;
            },
            onChange: () => {
                this.updateDirtyState();
            },
        });

        textarea.oninput = () => {
            this.updateDirtyState();
        };

        reminderInput.onchange = () => this.updateDirtyState();

        this.el.querySelectorAll('.et-shortcut-btn').forEach(btn => {
            btn.onclick = () => {
                const type = btn.getAttribute('data-time');
                this.applyShortcut(type);
            };
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.el.classList.contains('visible')) {
                this.close();
            }
        });
    },

    applyShortcut(type) {
        const now = new Date();
        let target = new Date(now);

        if (type === '1h') target.setHours(now.getHours() + 1);
        else if (type === '2h') target.setHours(now.getHours() + 2);
        else if (type === 'tomorrow') {
            target.setDate(now.getDate() + 1);
            target.setHours(9, 0, 0, 0);
        } else if (type === '2days') {
            target.setDate(now.getDate() + 2);
            target.setHours(9, 0, 0, 0);
        }

        const reminderInput = this.el.querySelector('.et-drawer-reminder-input');
        const offset = target.getTimezoneOffset() * 60000;
        const localISODate = new Date(target.getTime() - offset).toISOString().slice(0, 16);
        reminderInput.value = localISODate;
        this.updateDirtyState();
    },

    getCurrentHost() {
        return this.demoMode ? DEMO_HOST : (this.hostOverride || getCurrentPageJiraHost());
    },

    buildStorageKeys(issueKey = this.currentKey, host = this.currentHost) {
        const ticketRef = buildJiraTicketRef(host, issueKey);
        const primaryRef = ticketRef || issueKey;
        const notesKey = getNotesStorageKey(primaryRef, host);
        const reminderKey = getReminderStorageKey(primaryRef, host);
        const tagsKey = getTagsStorageKey(primaryRef, host);
        const ignoredKey = getIgnoredStorageKey(primaryRef, host);
        const tagDefsKey = getTagDefsStorageKey(host);

        const legacy = host ? {
            notesKey: getNotesStorageKey(issueKey),
            reminderKey: getReminderStorageKey(issueKey),
            tagsKey: getTagsStorageKey(issueKey),
            ignoredKey: getIgnoredStorageKey(issueKey),
            tagDefsKey: getTagDefsStorageKey(''),
        } : null;

        return {
            notesKey,
            reminderKey,
            tagsKey,
            ignoredKey,
            tagDefsKey,
            legacy,
        };
    },

    getFormSnapshot() {
        if (!this.el) {
            return {
                noteText: '',
                reminderValue: '',
                tagLabels: [],
            };
        }

        return {
            noteText: this.el.querySelector('.et-drawer-textarea')?.value.trim() || '',
            reminderValue: this.el.querySelector('.et-drawer-reminder-input')?.value || '',
            tagLabels: normalizeTagList(this.tagEditor?.getValue() || [], this.currentTagDefs),
        };
    },

    setBaselineFromCurrentForm() {
        this.baselineSnapshot = this.getFormSnapshot();
        this.isDirty = false;
    },

    hasUnsavedChanges() {
        const current = this.getFormSnapshot();
        const baseline = this.baselineSnapshot || {
            noteText: '',
            reminderValue: '',
            tagLabels: [],
        };

        return current.noteText !== baseline.noteText
            || current.reminderValue !== baseline.reminderValue
            || current.tagLabels.join('\n') !== baseline.tagLabels.join('\n');
    },

    updateDirtyState() {
        this.isDirty = this.hasUnsavedChanges();
    },

    async open(issueKey, summary) {
        this.init();
        this.currentHost = this.getCurrentHost();
        this.currentKey = getJiraIssueKey(issueKey) || issueKey;
        this.currentTicketRef = buildJiraTicketRef(this.currentHost, this.currentKey);
        this.el.querySelector('#et-drawer-key').textContent = this.currentKey;
        this.el.querySelector('#et-drawer-summary').textContent = summary || '';

        const textarea = this.el.querySelector('.et-drawer-textarea');
        const reminderInput = this.el.querySelector('.et-drawer-reminder-input');

        textarea.value = '';
        reminderInput.value = '';
        this.currentTagDefs = {};
        this.tagEditor?.setTagDefs({});
        this.tagEditor?.setValue([]);

        const storageKeys = this.buildStorageKeys(this.currentKey, this.currentHost);
        const requestedKeys = [
            storageKeys.notesKey,
            storageKeys.reminderKey,
            storageKeys.tagsKey,
            storageKeys.tagDefsKey,
        ];
        if (storageKeys.legacy) {
            requestedKeys.push(
                storageKeys.legacy.notesKey,
                storageKeys.legacy.reminderKey,
                storageKeys.legacy.tagsKey,
                storageKeys.legacy.tagDefsKey,
            );
        }

        const result = await getTrackingItems(Array.from(new Set(requestedKeys.filter(Boolean))), { demoMode: this.demoMode });
        if (this.currentKey !== (getJiraIssueKey(issueKey) || issueKey)) return;

        const noteValue = result[storageKeys.notesKey] ?? result[storageKeys.legacy?.notesKey] ?? '';
        const reminderValue = result[storageKeys.reminderKey] ?? result[storageKeys.legacy?.reminderKey] ?? '';
        const tagsValue = result[storageKeys.tagsKey] ?? result[storageKeys.legacy?.tagsKey] ?? [];
        this.currentTagDefs = normalizeTagDefs(
            result[storageKeys.tagDefsKey]
            || result[storageKeys.legacy?.tagDefsKey]
            || {}
        );
        if (noteValue) textarea.value = noteValue;
        if (reminderValue) {
            const date = new Date(reminderValue);
            const offset = date.getTimezoneOffset() * 60000;
            const localISODate = new Date(date.getTime() - offset).toISOString().slice(0, 16);
            reminderInput.value = localISODate;
        }
        this.tagEditor?.setTagDefs(this.currentTagDefs);
        this.tagEditor?.setValue(normalizeTagList(tagsValue, this.currentTagDefs));
        this.setBaselineFromCurrentForm();

        this.backdrop.classList.add('visible');
        this.el.classList.add('visible');
        setTimeout(() => textarea.focus(), 350);
    },

    async close(skipSave = false) {
        if (!this.el) return;
        clearTimeout(this.saveTimeout);

        if (!skipSave && this.hasUnsavedChanges()) {
            const shouldSave = confirm('Save changes before closing? Press OK to save, or Cancel to discard.');
            if (shouldSave) {
                await this.save();
            }
        }

        this.el.classList.remove('visible');
        this.backdrop.classList.remove('visible');
        this.isDirty = false;
    },

    emitTrackingUpdated(detail = {}) {
        if (typeof document === 'undefined') return;
        const issueKey = getJiraIssueKey(detail.issueKey) || this.currentKey || '';
        if (!issueKey) return;

        document.dispatchEvent(new CustomEvent(TRACKING_UPDATED_EVENT, {
            detail: {
                ...detail,
                issueKey,
                ticketRef: this.currentTicketRef || buildJiraTicketRef(this.currentHost, issueKey),
            },
        }));
    },

    async delete() {
        if (!this.currentKey) return;

        if (!confirm('Are you sure you want to delete this note, reminder, and tags?')) {
            return;
        }

        const storageKeys = this.buildStorageKeys(this.currentKey, this.currentHost);
        const keysToRemove = Array.from(new Set([
            storageKeys.notesKey,
            storageKeys.reminderKey,
            storageKeys.tagsKey,
            storageKeys.ignoredKey,
            storageKeys.legacy?.notesKey,
            storageKeys.legacy?.reminderKey,
            storageKeys.legacy?.tagsKey,
            storageKeys.legacy?.ignoredKey,
        ].filter(Boolean)));

        this.emitTrackingUpdated({
            issueKey: this.currentKey,
            noteText: '',
            reminderValue: '',
            reminderTs: null,
            tagLabels: [],
            tagDefs: this.currentTagDefs,
        });

        await removeTrackingItems(keysToRemove, { demoMode: this.demoMode });

        // Reset fields
        this.el.querySelector('.et-drawer-textarea').value = '';
        this.el.querySelector('.et-drawer-reminder-input').value = '';
        this.tagEditor?.setValue([]);

        this.updateIndicators(false);
        this.close(true); // Close without saving (it's already deleted)
    },

    async save() {
        if (!this.currentKey) return;

        const textarea = this.el.querySelector('.et-drawer-textarea');
        const reminderInput = this.el.querySelector('.et-drawer-reminder-input');
        const status = this.el.querySelector('.et-drawer-status');

        const value = textarea.value.trim();
        const reminderValue = reminderInput.value;
        const reminderTs = reminderValue ? new Date(reminderValue).getTime() : null;
        const tagsValue = normalizeTagList(this.tagEditor?.getValue() || [], this.currentTagDefs);

        const storageKeys = this.buildStorageKeys(this.currentKey, this.currentHost);

        this.emitTrackingUpdated({
            issueKey: this.currentKey,
            noteText: value,
            reminderValue,
            reminderTs,
            tagLabels: tagsValue,
            tagDefs: this.currentTagDefs,
        });

        if (value) {
            await setTrackingItems({ [storageKeys.notesKey]: value }, { demoMode: this.demoMode });
        } else {
            await removeTrackingItems(storageKeys.notesKey, { demoMode: this.demoMode });
        }
        if (storageKeys.legacy?.notesKey && storageKeys.legacy.notesKey !== storageKeys.notesKey) {
            await removeTrackingItems(storageKeys.legacy.notesKey, { demoMode: this.demoMode });
        }

        if (reminderValue) {
            await setTrackingItems({ [storageKeys.reminderKey]: reminderTs }, { demoMode: this.demoMode });
            await removeTrackingItems(storageKeys.ignoredKey, { demoMode: this.demoMode });
        } else {
            await removeTrackingItems(storageKeys.reminderKey, { demoMode: this.demoMode });
            await removeTrackingItems(storageKeys.ignoredKey, { demoMode: this.demoMode });
        }
        if (storageKeys.legacy?.reminderKey && storageKeys.legacy.reminderKey !== storageKeys.reminderKey) {
            await removeTrackingItems(storageKeys.legacy.reminderKey, { demoMode: this.demoMode });
        }
        if (storageKeys.legacy?.ignoredKey && storageKeys.legacy.ignoredKey !== storageKeys.ignoredKey) {
            await removeTrackingItems(storageKeys.legacy.ignoredKey, { demoMode: this.demoMode });
        }

        await removeTrackingItems(storageKeys.tagsKey, { demoMode: this.demoMode });
        if (tagsValue.length) {
            await setTrackingItems({ [storageKeys.tagsKey]: tagsValue }, { demoMode: this.demoMode });
        }
        if (storageKeys.legacy?.tagsKey && storageKeys.legacy.tagsKey !== storageKeys.tagsKey) {
            await removeTrackingItems(storageKeys.legacy.tagsKey, { demoMode: this.demoMode });
        }

        status.classList.add('show');
        setTimeout(() => status.classList.remove('show'), 1500);

        this.updateIndicators(this.hasTrackedItem({
            noteText: value,
            reminderValue,
            tagLabels: tagsValue,
        }));
        this.setBaselineFromCurrentForm();
    },

    updateIndicators(hasActiveItem) {
        const cleanKey = this.currentKey;
        document.querySelectorAll(`[data-issue-key="${cleanKey}"], [data-issue-key="jira:${cleanKey}"]`).forEach(btn => {
            if (btn.classList.contains('et-ticket-notes-toggle')) {
                btn.querySelector('span').textContent = hasActiveItem ? 'Personal notes ●' : 'Personal notes';
            } else {
                if (hasActiveItem) btn.classList.add('has-note');
                else btn.classList.remove('has-note');
            }
        });
    }
};

import { storage } from '../../../common/storage.js';
import { createTagEditor } from '../../../common/tagEditor.js';
import {
    TAG_DEFS_STORAGE_KEY,
    TRACKING_UPDATED_EVENT,
    ensureTagDefinition,
    getNotesStorageKey,
    getReminderStorageKey,
    getTagsStorageKey,
    hasTrackedContent,
    normalizeTagDefs,
    normalizeTagList,
} from '../../../common/tagging.js';

export const NoteDrawer = {
    el: null,
    backdrop: null,
    currentKey: null,
    saveTimeout: null,
    tagEditor: null,
    currentTagDefs: {},

    hasTrackedItem({ noteText = '', reminderValue = '', tagLabels = [] } = {}) {
        return hasTrackedContent(noteText, reminderValue, tagLabels);
    },

    async initIndicators() {
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
            const cleanKey = k.includes(':') ? k : `jira:${k}`;
            storageKeys.push(`notes_${cleanKey}`, `reminder_${cleanKey}`, `tags_${cleanKey}`);
        });

        const result = await storage.get(storageKeys);

        keys.forEach(k => {
            const cleanKey = k.includes(':') ? k : `jira:${k}`;
            const hasNote = !!result[`notes_${cleanKey}`];
            const hasReminder = !!result[`reminder_${cleanKey}`];
            const tags = Array.isArray(result[`tags_${cleanKey}`]) ? result[`tags_${cleanKey}`] : [];
            const hasActiveItem = this.hasTrackedItem({
                noteText: hasNote ? result[`notes_${cleanKey}`] : '',
                reminderValue: hasReminder ? result[`reminder_${cleanKey}`] : '',
                tagLabels: tags,
            });

            if (hasActiveItem) {
                const cleanSuffix = k.split(':').pop();
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
                const created = await ensureTagDefinition(label, color);
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
                clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => this.save(), 350);
            },
        });

        textarea.oninput = () => {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => this.save(), 500);
        };

        reminderInput.onchange = () => this.save();

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
        this.save();
    },

    async open(issueKey, summary) {
        this.init();
        this.currentKey = issueKey;
        this.el.querySelector('#et-drawer-key').textContent = issueKey;
        this.el.querySelector('#et-drawer-summary').textContent = summary || '';

        const textarea = this.el.querySelector('.et-drawer-textarea');
        const reminderInput = this.el.querySelector('.et-drawer-reminder-input');

        textarea.value = '';
        reminderInput.value = '';
        this.currentTagDefs = {};
        this.tagEditor?.setTagDefs({});
        this.tagEditor?.setValue([]);

        const storageKey = getNotesStorageKey(issueKey);
        const reminderKey = getReminderStorageKey(issueKey);
        const tagsKey = getTagsStorageKey(issueKey);

        const result = await storage.get([storageKey, reminderKey, tagsKey, TAG_DEFS_STORAGE_KEY]);
        if (this.currentKey !== issueKey) return;

        this.currentTagDefs = normalizeTagDefs(result[TAG_DEFS_STORAGE_KEY] || {});
        if (result[storageKey]) textarea.value = result[storageKey];
        if (result[reminderKey]) {
            const date = new Date(result[reminderKey]);
            const offset = date.getTimezoneOffset() * 60000;
            const localISODate = new Date(date.getTime() - offset).toISOString().slice(0, 16);
            reminderInput.value = localISODate;
        }
        this.tagEditor?.setTagDefs(this.currentTagDefs);
        this.tagEditor?.setValue(normalizeTagList(result[tagsKey], this.currentTagDefs));

        this.backdrop.classList.add('visible');
        this.el.classList.add('visible');
        setTimeout(() => textarea.focus(), 350);
    },

    close(skipSave = false) {
        if (!this.el) return;
        this.el.classList.remove('visible');
        this.backdrop.classList.remove('visible');
        clearTimeout(this.saveTimeout);
        if (!skipSave) this.save();
    },

    emitTrackingUpdated(detail = {}) {
        if (typeof document === 'undefined') return;
        const issueKey = String(detail.issueKey || this.currentKey || '').split(':').pop();
        if (!issueKey) return;

        document.dispatchEvent(new CustomEvent(TRACKING_UPDATED_EVENT, {
            detail: {
                ...detail,
                issueKey,
            },
        }));
    },

    async delete() {
        if (!this.currentKey) return;

        if (!confirm('Are you sure you want to delete this note, reminder, and tags?')) {
            return;
        }

        const prefixedKey = this.currentKey.includes(':') ? this.currentKey : `jira:${this.currentKey}`;
        const storageKey = getNotesStorageKey(this.currentKey);
        const reminderKey = getReminderStorageKey(this.currentKey);
        const tagsKey = getTagsStorageKey(this.currentKey);
        const ignoredKey = `ignored_${prefixedKey}`;

        await storage.remove([storageKey, reminderKey, tagsKey, ignoredKey]);

        // Reset fields
        this.el.querySelector('.et-drawer-textarea').value = '';
        this.el.querySelector('.et-drawer-reminder-input').value = '';
        this.tagEditor?.setValue([]);

        this.updateIndicators(false);
        this.emitTrackingUpdated({
            issueKey: this.currentKey,
            noteText: '',
            reminderValue: '',
            reminderTs: null,
            tagLabels: [],
            tagDefs: this.currentTagDefs,
        });
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

        const storageKey = getNotesStorageKey(this.currentKey);
        const reminderKey = getReminderStorageKey(this.currentKey);
        const finalKey = this.currentKey.includes(':') ? this.currentKey : `jira:${this.currentKey}`;

        if (value) {
            await storage.set({ [storageKey]: value });
        } else {
            await storage.remove(storageKey);
        }

        if (reminderValue) {
            await storage.set({ [reminderKey]: reminderTs });
            await storage.remove(`ignored_${finalKey}`);
        } else {
            await storage.remove(reminderKey);
            await storage.remove(`ignored_${finalKey}`);
        }

        await storage.remove(getTagsStorageKey(this.currentKey));
        if (tagsValue.length) {
            await storage.set({ [getTagsStorageKey(this.currentKey)]: tagsValue });
        }

        status.classList.add('show');
        setTimeout(() => status.classList.remove('show'), 1500);

        this.updateIndicators(this.hasTrackedItem({
            noteText: value,
            reminderValue,
            tagLabels: tagsValue,
        }));

        this.emitTrackingUpdated({
            issueKey: this.currentKey,
            noteText: value,
            reminderValue,
            reminderTs,
            tagLabels: tagsValue,
            tagDefs: this.currentTagDefs,
        });
    },

    updateIndicators(hasActiveItem) {
        const cleanKey = this.currentKey.split(':').pop();
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

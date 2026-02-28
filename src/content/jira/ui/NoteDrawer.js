import { storage } from '../../../common/storage';

export const NoteDrawer = {
    el: null,
    backdrop: null,
    currentKey: null,
    saveTimeout: null,

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
            storageKeys.push(`notes_${cleanKey}`, `reminder_${cleanKey}`);
        });

        const result = await storage.get(storageKeys);

        keys.forEach(k => {
            const cleanKey = k.includes(':') ? k : `jira:${k}`;
            const hasNote = !!result[`notes_${cleanKey}`];
            const hasReminder = !!result[`reminder_${cleanKey}`];
            const hasActiveItem = hasNote || hasReminder;

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
            </div>
            <div class="et-drawer-footer">
                <button class="et-drawer-save">Save Note</button>
                <span class="et-drawer-status">✓ Saved</span>
            </div>
        `;

        document.body.appendChild(this.backdrop);
        document.body.appendChild(this.el);

        this.el.querySelector('.et-drawer-close').onclick = () => this.close();
        this.el.querySelector('.et-drawer-save').onclick = () => this.save();

        const textarea = this.el.querySelector('.et-drawer-textarea');
        const reminderInput = this.el.querySelector('.et-drawer-reminder-input');

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

        const prefixedKey = issueKey.includes(':') ? issueKey : `jira:${issueKey}`;
        const storageKey = `notes_${prefixedKey}`;
        const reminderKey = `reminder_${prefixedKey}`;

        const result = await storage.get([storageKey, reminderKey]);
        if (this.currentKey !== issueKey) return;

        if (result[storageKey]) textarea.value = result[storageKey];
        if (result[reminderKey]) {
            const date = new Date(result[reminderKey]);
            const offset = date.getTimezoneOffset() * 60000;
            const localISODate = new Date(date.getTime() - offset).toISOString().slice(0, 16);
            reminderInput.value = localISODate;
        }

        this.backdrop.classList.add('visible');
        this.el.classList.add('visible');
        setTimeout(() => textarea.focus(), 350);
    },

    close() {
        if (!this.el) return;
        this.el.classList.remove('visible');
        this.backdrop.classList.remove('visible');
        clearTimeout(this.saveTimeout);
        this.save();
    },

    async save() {
        if (!this.currentKey) return;

        const textarea = this.el.querySelector('.et-drawer-textarea');
        const reminderInput = this.el.querySelector('.et-drawer-reminder-input');
        const status = this.el.querySelector('.et-drawer-status');

        const value = textarea.value.trim();
        const reminderValue = reminderInput.value;

        const storageKey = this.currentKey.includes(':') ? `notes_${this.currentKey}` : `notes_jira:${this.currentKey}`;
        const reminderKey = this.currentKey.includes(':') ? `reminder_${this.currentKey}` : `reminder_jira:${this.currentKey}`;
        const finalKey = this.currentKey.includes(':') ? this.currentKey : `jira:${this.currentKey}`;

        if (value) {
            await storage.set({ [storageKey]: value });
        } else {
            await storage.remove(storageKey);
        }

        if (reminderValue) {
            const timestamp = new Date(reminderValue).getTime();
            await storage.set({ [reminderKey]: timestamp });
            await storage.remove(`ignored_${finalKey}`);
        } else {
            await storage.remove(reminderKey);
            await storage.remove(`ignored_${finalKey}`);
        }

        status.classList.add('show');
        setTimeout(() => status.classList.remove('show'), 1500);

        this.updateIndicators(value || reminderValue);
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

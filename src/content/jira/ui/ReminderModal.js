import { storage } from '../../../common/storage';

export const ReminderModal = {
    backdrop: null,
    el: null,
    currentKey: null,
    queue: [],
    handledKeys: new Set(),

    init() {
        if (this.el) return;

        this.backdrop = document.createElement('div');
        this.backdrop.className = 'et-alert-modal-backdrop';

        this.el = document.createElement('div');
        this.el.className = 'et-alert-modal';
        this.el.innerHTML = `
            <div class="et-alert-modal-header">
                <span style="font-size: 24px">🔔</span>
                <div style="display:flex; flex-direction:column">
                    <h3 class="et-alert-modal-title">Reminder: <span id="et-alert-key">---</span></h3>
                    <div id="et-alert-summary" style="font-size: 13px; color: #6b778c; margin-top: 2px; font-weight: 500;"></div>
                </div>
            </div>
            <div class="et-alert-modal-body" id="et-alert-text">
            </div>
            <div class="et-alert-modal-footer">
                <button class="et-alert-btn et-alert-btn-primary" id="et-alert-done">Mark as Done</button>
                <button class="et-alert-btn et-alert-btn-secondary" id="et-alert-snooze">Snooze</button>
                <div class="et-alert-snooze-options" id="et-alert-snooze-options">
                    <button class="et-alert-btn et-alert-btn-secondary" data-time="1h">1 Hr</button>
                    <button class="et-alert-btn et-alert-btn-secondary" data-time="2h">2 Hrs</button>
                    <button class="et-alert-btn et-alert-btn-secondary" data-time="tomorrow">Tomorrow 9am</button>
                    <button class="et-alert-btn et-alert-btn-secondary" data-time="2days">2 Days 9am</button>
                </div>
                <button class="et-alert-btn et-alert-btn-tertiary" id="et-alert-ignore">Ignore</button>
            </div>
            <div id="et-alert-queue-info" style="margin-top: 12px; font-size: 11px; color: #6b778c; text-align: center; border-top: 1px solid #eee; padding-top: 8px; display:none;">
            </div>
        `;

        document.body.appendChild(this.backdrop);
        this.backdrop.appendChild(this.el);

        this.el.querySelector('#et-alert-done').onclick = () => this.markAsDone();
        this.el.querySelector('#et-alert-snooze').onclick = () => this.snooze();
        this.el.querySelector('#et-alert-ignore').onclick = () => this.ignore();

        this.el.querySelectorAll('.et-alert-snooze-options button').forEach(btn => {
            btn.onclick = () => {
                const type = btn.getAttribute('data-time');
                this.applySnooze(type);
            };
        });
    },

    show(issueKey, noteText, summary) {
        this.init();
        if (this.handledKeys.has(issueKey)) return;
        if (this.currentKey === issueKey && this.backdrop.classList.contains('visible')) return;

        if (this.backdrop.classList.contains('visible')) {
            if (!this.queue.find(q => q.issueKey === issueKey)) {
                this.queue.push({ issueKey, noteText, summary });
                this.updateQueueInfo();
            }
            return;
        }

        this.resetView();
        this.currentKey = issueKey;
        const cleanKey = issueKey.split(':').pop();
        this.el.querySelector('#et-alert-key').textContent = cleanKey;
        this.el.querySelector('#et-alert-summary').textContent = summary || '';

        const textEl = this.el.querySelector('#et-alert-text');
        if (noteText && noteText.trim()) {
            textEl.textContent = noteText;
            textEl.style.display = 'block';
        } else {
            textEl.style.display = 'none';
        }

        this.updateQueueInfo();
        this.backdrop.classList.add('visible');
    },

    updateQueueInfo() {
        const info = this.el.querySelector('#et-alert-queue-info');
        if (this.queue.length > 0) {
            info.textContent = `+ ${this.queue.length} more pending alerts`;
            info.style.display = 'block';
        } else {
            info.style.display = 'none';
        }
    },

    resetView() {
        if (!this.el) return;
        this.el.querySelector('#et-alert-done').classList.remove('hidden');
        this.el.querySelector('#et-alert-snooze').classList.remove('hidden');
        this.el.querySelector('#et-alert-ignore').classList.remove('hidden');
        this.el.querySelector('#et-alert-snooze-options').classList.remove('visible');
    },

    hide() {
        if (this.backdrop) this.backdrop.classList.remove('visible');
        this.currentKey = null;

        if (this.queue.length > 0) {
            const next = this.queue.shift();
            setTimeout(() => this.show(next.issueKey, next.noteText, next.summary), 300);
        }
    },

    async ignore() {
        const keyToIgnore = this.currentKey;
        if (!keyToIgnore) return;

        this.handledKeys.add(keyToIgnore);
        const finalKey = keyToIgnore.includes(':') ? keyToIgnore : `jira:${keyToIgnore}`;
        await storage.set({ [`ignored_${finalKey}`]: true });

        const result = await storage.get('pending_alerts');
        const pending = (result.pending_alerts || []).filter(k => k !== keyToIgnore);
        await storage.set({ pending_alerts: pending });

        this.hide();
    },

    async markAsDone() {
        const keyDone = this.currentKey;
        if (!keyDone) return;

        this.handledKeys.add(keyDone);
        const storageKey = keyDone.includes(':') ? `reminder_${keyDone}` : `reminder_jira:${keyDone}`;
        await storage.remove(storageKey);

        const result = await storage.get('pending_alerts');
        const pending = (result.pending_alerts || []).filter(k => k !== keyDone);
        await storage.set({ pending_alerts: pending });

        this.hide();
    },

    snooze() {
        this.el.querySelector('#et-alert-done').classList.add('hidden');
        this.el.querySelector('#et-alert-snooze').classList.add('hidden');
        this.el.querySelector('#et-alert-ignore').classList.add('hidden');
        this.el.querySelector('#et-alert-snooze-options').classList.add('visible');
    },

    async applySnooze(type) {
        const keyToSnooze = this.currentKey;
        if (!keyToSnooze) return;

        this.handledKeys.add(keyToSnooze);
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

        const storageKey = keyToSnooze.includes(':') ? `reminder_${keyToSnooze}` : `reminder_jira:${keyToSnooze}`;
        await storage.set({ [storageKey]: target.getTime() });

        const result = await storage.get('pending_alerts');
        const pending = (result.pending_alerts || []).filter(k => k !== keyToSnooze);
        await storage.set({ pending_alerts: pending });

        this.hide();
    }
};

import { storage } from '../../../common/storage';
import {
    ensureJiraTicketRef,
    getCurrentPageJiraHost,
    getJiraDisplayKey,
    getJiraIssueKey,
    normalizeJiraHost,
    parseJiraTicketRef,
} from '../../../common/jiraIdentity.js';
import {
    buildJiraTrackingStorageKeys,
    PENDING_ALERTS_STORAGE_KEY,
    getTicketCacheStorageKey,
    getIgnoredStorageKey,
    parseJiraTrackingStorageKey,
    getReminderStorageKey,
} from '../../../common/jiraStorageKeys.js';
import { getTagInlineStyle, getTagObjects, normalizeTagDefs, normalizeTagList } from '../../../common/tagging.js';
import { NoteDrawer, NOTE_DRAWER_CLOSED_EVENT } from './NoteDrawer';

function resolveReminderTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function resolveCachedSummary(cachedTicket) {
    if (!cachedTicket || typeof cachedTicket !== 'object') return '';
    if (typeof cachedTicket.details?.summary === 'string') return cachedTicket.details.summary;
    if (typeof cachedTicket.summary === 'string') return cachedTicket.summary;
    return '';
}

function resolveMetaSummary(metaValue) {
    if (!metaValue || typeof metaValue !== 'object') return '';
    return typeof metaValue.summary === 'string' ? metaValue.summary.trim() : '';
}

function formatReminderDateTime(reminderTs) {
    const ts = resolveReminderTimestamp(reminderTs);
    if (!ts) return '';

    const target = new Date(ts);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const dayDiff = Math.round((targetStart - todayStart) / (1000 * 60 * 60 * 24));

    try {
        const timeLabel = new Intl.DateTimeFormat(undefined, {
            timeStyle: 'short',
        }).format(target);

        if (dayDiff === 0) return `Today ${timeLabel}`;
        if (dayDiff === 1) return `Tomorrow ${timeLabel}`;
        if (dayDiff === -1) return `Yesterday ${timeLabel}`;
        if (dayDiff > 1 && dayDiff < 7) return `In ${dayDiff} days ${timeLabel}`;

        const dateLabel = new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
        }).format(target);
        return `${dateLabel} ${timeLabel}`;
    } catch {
        return target.toLocaleString();
    }
}

function buildReminderAlert(
    issueKey,
    noteText = '',
    summary = '',
    reminderTs = null,
    tags = [],
    tagDefs = {},
    fallbackHost = getCurrentPageJiraHost(),
) {
    const host = normalizeJiraHost(fallbackHost);
    const ticketRef = ensureJiraTicketRef(issueKey, host);
    if (!ticketRef) return null;

    return {
        ticketRef,
        issueKey: getJiraIssueKey(ticketRef),
        noteText: typeof noteText === 'string' ? noteText : '',
        summary: typeof summary === 'string' ? summary : '',
        reminderTs: resolveReminderTimestamp(reminderTs),
        tags: normalizeTagList(tags, tagDefs),
        tagDefs: normalizeTagDefs(tagDefs),
    };
}

function removePendingAlertRefs(pendingAlerts, ticketRef, fallbackHost = getCurrentPageJiraHost()) {
    const normalizedRef = ensureJiraTicketRef(ticketRef, fallbackHost);
    return (Array.isArray(pendingAlerts) ? pendingAlerts : []).filter(value => {
        const parsed = parseJiraTicketRef(value, fallbackHost);
        return (parsed?.ref || value) !== normalizedRef;
    });
}

export function collectPendingReminderAlerts({
    pendingAlerts = [],
    storageItems = {},
    host = '',
    now = Date.now(),
    currentTicketRef = '',
    queuedTicketRefs = [],
    handledTicketRefs = [],
} = {}) {
    const normalizedHost = normalizeJiraHost(host);
    const currentHostRef = ensureJiraTicketRef(currentTicketRef, normalizedHost);
    const blockedRefs = new Set([
        currentHostRef,
        ...queuedTicketRefs,
        ...handledTicketRefs,
    ].map(ref => ensureJiraTicketRef(ref, normalizedHost)).filter(Boolean));

    const nextPendingAlerts = [];
    const alertsToShow = [];
    const seenCurrentHostRefs = new Set();

    (Array.isArray(pendingAlerts) ? pendingAlerts : []).forEach(rawValue => {
        const parsed = parseJiraTicketRef(rawValue, normalizedHost);
        if (!parsed?.issueKey) {
            nextPendingAlerts.push(rawValue);
            return;
        }

        if (parsed.host !== normalizedHost) {
            nextPendingAlerts.push(parsed.ref);
            return;
        }

        const ticketRef = parsed.ref;
        if (seenCurrentHostRefs.has(ticketRef)) return;
        seenCurrentHostRefs.add(ticketRef);

        const storageKeys = buildJiraTrackingStorageKeys(ticketRef, normalizedHost);
        const reminderTs = resolveReminderTimestamp(
            storageItems[storageKeys.reminderKey] ?? storageItems[storageKeys.legacy?.reminderKey]
        );
        const isIgnored = Boolean(storageItems[storageKeys.ignoredKey] ?? storageItems[storageKeys.legacy?.ignoredKey]);

        if (isIgnored || !reminderTs || reminderTs > now) return;

        nextPendingAlerts.push(ticketRef);
        if (blockedRefs.has(ticketRef)) return;

        const cachedSummary = resolveCachedSummary(
            storageItems[getTicketCacheStorageKey(ticketRef, normalizedHost)]
            ?? storageItems[getTicketCacheStorageKey(parsed.issueKey)]
        );
        const metaSummary = resolveMetaSummary(
            storageItems[storageKeys.metaKey] ?? storageItems[storageKeys.legacy?.metaKey]
        );
        const noteText = storageItems[storageKeys.notesKey] ?? storageItems[storageKeys.legacy?.notesKey] ?? '';
        const tagDefs = normalizeTagDefs(
            storageItems[storageKeys.tagDefsKey] || storageItems[storageKeys.legacy?.tagDefsKey] || {}
        );
        const tags = normalizeTagList(
            storageItems[storageKeys.tagsKey] ?? storageItems[storageKeys.legacy?.tagsKey] ?? [],
            tagDefs
        );
        alertsToShow.push({
            ticketRef,
            issueKey: parsed.issueKey,
            noteText: typeof noteText === 'string' ? noteText : '',
            summary: metaSummary || cachedSummary,
            reminderTs,
            tags,
            tagDefs,
        });
        blockedRefs.add(ticketRef);
    });

    const normalizedPendingAlerts = Array.isArray(pendingAlerts)
        ? pendingAlerts.map(value => {
            const parsed = parseJiraTicketRef(value, normalizedHost);
            return parsed?.ref || value;
        })
        : [];

    return {
        alertsToShow,
        nextPendingAlerts,
        didChangePendingAlerts: normalizedPendingAlerts.length !== nextPendingAlerts.length
            || normalizedPendingAlerts.some((value, index) => value !== nextPendingAlerts[index]),
    };
}

export const ReminderModal = {
    backdrop: null,
    el: null,
    currentKey: null,
    currentAlert: null,
    queue: [],
    handledKeys: new Set(),
    drawerCloseListenerAttached: false,

    init() {
        if (this.el) return;

        this.backdrop = document.createElement('div');
        this.backdrop.className = 'et-alert-modal-backdrop';

        this.el = document.createElement('div');
        this.el.className = 'et-alert-modal';
        this.el.innerHTML = `
            <div class="et-alert-modal-header">
                <span style="font-size: 24px">🔔</span>
                <div class="et-alert-modal-header-copy">
                    <div id="et-alert-key" class="et-alert-clickable-key et-alert-modal-key">---</div>
                    <h3 id="et-alert-summary" class="et-alert-modal-title"></h3>
                    <div class="et-alert-modal-meta">
                        <div id="et-alert-time" class="et-alert-modal-chip et-alert-modal-time"></div>
                        <div id="et-alert-tags" class="et-alert-modal-tags"></div>
                    </div>
                </div>
            </div>
            <div class="et-alert-modal-body" id="et-alert-text">
            </div>
            <div class="et-alert-modal-footer">
                <button class="et-alert-btn et-alert-btn-primary" id="et-alert-open">Open</button>
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

        const keyBtn = this.el.querySelector('#et-alert-key');
        keyBtn.onclick = () => this.openCurrentIssue();

        this.el.querySelector('#et-alert-open').onclick = () => this.openCurrentIssue();
        this.el.querySelector('#et-alert-snooze').onclick = () => this.snooze();
        this.el.querySelector('#et-alert-ignore').onclick = () => this.ignore();

        this.el.querySelectorAll('.et-alert-snooze-options button').forEach(btn => {
            btn.onclick = () => {
                const type = btn.getAttribute('data-time');
                this.applySnooze(type);
            };
        });

        if (!this.drawerCloseListenerAttached) {
            document.addEventListener(NOTE_DRAWER_CLOSED_EVENT, () => {
                void this.handleDrawerClosed();
            });
            this.drawerCloseListenerAttached = true;
        }
    },

    show(issueKey, noteText, summary, reminderTs = null, tags = [], tagDefs = {}) {
        const alert = buildReminderAlert(issueKey, noteText, summary, reminderTs, tags, tagDefs);
        if (!alert) return;

        this.init();
        if (this.handledKeys.has(alert.ticketRef)) return;
        if (this.currentKey === alert.ticketRef && this.backdrop.classList.contains('visible')) return;
        if (this.queue.some(queuedAlert => queuedAlert.ticketRef === alert.ticketRef)) return;

        if (this.backdrop.classList.contains('visible') || NoteDrawer.isOpen()) {
            this.queue.push(alert);
            this.updateQueueInfo();
            return;
        }

        this.resetView();
        this.currentKey = alert.ticketRef;
        this.currentAlert = alert;
        this.el.querySelector('#et-alert-key').textContent = getJiraDisplayKey(alert.ticketRef);
        this.el.querySelector('#et-alert-summary').textContent = alert.summary || getJiraDisplayKey(alert.ticketRef);
        const reminderTimeEl = this.el.querySelector('#et-alert-time');
        const tagsEl = this.el.querySelector('#et-alert-tags');
        const formattedReminderTime = formatReminderDateTime(alert.reminderTs);
        reminderTimeEl.textContent = formattedReminderTime;
        reminderTimeEl.style.display = formattedReminderTime ? 'inline-flex' : 'none';
        const tagObjects = getTagObjects(alert.tags, alert.tagDefs);
        tagsEl.innerHTML = tagObjects.map(tag => `
            <span class="et-alert-tag-chip" style="${getTagInlineStyle(tag.color)}">${tag.label}</span>
        `).join('');
        tagsEl.style.display = tagObjects.length ? 'flex' : 'none';

        const textEl = this.el.querySelector('#et-alert-text');
        if (alert.noteText && alert.noteText.trim()) {
            textEl.textContent = alert.noteText;
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
        this.el.querySelector('#et-alert-open').classList.remove('hidden');
        this.el.querySelector('#et-alert-snooze').classList.remove('hidden');
        this.el.querySelector('#et-alert-ignore').classList.remove('hidden');
        this.el.querySelector('#et-alert-snooze-options').classList.remove('visible');
    },

    hide() {
        if (this.backdrop) this.backdrop.classList.remove('visible');
        this.currentKey = null;
        this.currentAlert = null;

        if (this.queue.length > 0) {
            const next = this.queue.shift();
            setTimeout(() => this.show(next.ticketRef, next.noteText, next.summary, next.reminderTs, next.tags, next.tagDefs), 300);
        }
    },

    clearHandledAlert(ticketRef) {
        const normalizedRef = ensureJiraTicketRef(ticketRef, getCurrentPageJiraHost());
        if (normalizedRef) this.handledKeys.delete(normalizedRef);
    },

    clearHandledAlertForStorageKey(storageKey) {
        const parsed = parseJiraTrackingStorageKey(storageKey, getCurrentPageJiraHost());
        if (!parsed?.ticketRef) return;
        this.clearHandledAlert(parsed.ticketRef);
    },

    async handleDrawerClosed() {
        if (NoteDrawer.isOpen()) return;
        if (this.backdrop?.classList?.contains('visible')) return;

        if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.show(next.ticketRef, next.noteText, next.summary, next.reminderTs, next.tags, next.tagDefs);
            return;
        }

        await this.rehydratePendingAlerts();
    },

    async rehydratePendingAlerts() {
        const host = normalizeJiraHost(getCurrentPageJiraHost());
        if (!host) return;

        const result = await storage.get(PENDING_ALERTS_STORAGE_KEY);
        const pendingAlerts = Array.isArray(result[PENDING_ALERTS_STORAGE_KEY]) ? result[PENDING_ALERTS_STORAGE_KEY] : [];
        if (pendingAlerts.length === 0) return;

        const storageKeysToLoad = new Set();
        pendingAlerts.forEach(rawValue => {
            const parsed = parseJiraTicketRef(rawValue, host);
            if (!parsed?.issueKey || parsed.host !== host) return;

            const trackingKeys = buildJiraTrackingStorageKeys(parsed.ref, host);
            [
                trackingKeys.notesKey,
                trackingKeys.reminderKey,
                trackingKeys.tagsKey,
                trackingKeys.ignoredKey,
                trackingKeys.metaKey,
                trackingKeys.legacy?.notesKey,
                trackingKeys.legacy?.reminderKey,
                trackingKeys.legacy?.tagsKey,
                trackingKeys.legacy?.ignoredKey,
                trackingKeys.legacy?.metaKey,
                getTicketCacheStorageKey(parsed.ref, host),
                getTicketCacheStorageKey(parsed.issueKey),
            ].filter(Boolean).forEach(key => storageKeysToLoad.add(key));
        });

        const storageItems = storageKeysToLoad.size > 0
            ? await storage.get(Array.from(storageKeysToLoad))
            : {};

        const reconciliation = collectPendingReminderAlerts({
            pendingAlerts,
            storageItems,
            host,
            currentTicketRef: this.currentKey,
            queuedTicketRefs: this.queue.map(alert => alert.ticketRef),
            handledTicketRefs: Array.from(this.handledKeys),
        });

        if (reconciliation.didChangePendingAlerts) {
            await storage.set({ [PENDING_ALERTS_STORAGE_KEY]: reconciliation.nextPendingAlerts });
        }

        reconciliation.alertsToShow.forEach(alert => {
            this.show(alert.ticketRef, alert.noteText, alert.summary, alert.reminderTs, alert.tags, alert.tagDefs);
        });
    },

    openCurrentIssue() {
        const currentAlert = this.currentAlert;
        if (!currentAlert?.ticketRef) return;

        this.handledKeys.add(currentAlert.ticketRef);
        this.hide();
        void NoteDrawer.open(currentAlert.ticketRef, currentAlert.summary);
    },

    async ignore() {
        const keyToIgnore = this.currentKey;
        if (!keyToIgnore) return;

        this.handledKeys.add(keyToIgnore);
        await storage.set({ [getIgnoredStorageKey(keyToIgnore)]: true });

        const result = await storage.get(PENDING_ALERTS_STORAGE_KEY);
        const pending = removePendingAlertRefs(result[PENDING_ALERTS_STORAGE_KEY], keyToIgnore);
        await storage.set({ [PENDING_ALERTS_STORAGE_KEY]: pending });

        this.hide();
    },

    snooze() {
        this.el.querySelector('#et-alert-open').classList.add('hidden');
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

        await storage.set({ [getReminderStorageKey(keyToSnooze)]: target.getTime() });

        const result = await storage.get(PENDING_ALERTS_STORAGE_KEY);
        const pending = removePendingAlertRefs(result[PENDING_ALERTS_STORAGE_KEY], keyToSnooze);
        await storage.set({ [PENDING_ALERTS_STORAGE_KEY]: pending });

        this.hide();
    }
};

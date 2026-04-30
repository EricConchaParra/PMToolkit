import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storageMock, noteDrawerOpenMock, noteDrawerIsOpenMock } = vi.hoisted(() => ({
    storageMock: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
    },
    noteDrawerOpenMock: vi.fn(async () => {}),
    noteDrawerIsOpenMock: vi.fn(() => false),
}));

vi.mock('../../../common/storage', () => ({
    storage: storageMock,
}));

vi.mock('./NoteDrawer', () => ({
    NOTE_DRAWER_CLOSED_EVENT: 'pmtoolkit:note-drawer-closed',
    NoteDrawer: {
        open: noteDrawerOpenMock,
        isOpen: noteDrawerIsOpenMock,
    },
}));

import { buildJiraTicketRef } from '../../../common/jiraIdentity.js';
import { buildJiraTrackingStorageKeys, getTagDefsStorageKey, getTicketCacheStorageKey } from '../../../common/jiraStorageKeys.js';
import { ReminderModal, collectPendingReminderAlerts } from './ReminderModal.js';

const HOST = 'alpha.atlassian.net';
const OTHER_HOST = 'beta.atlassian.net';
const PM1 = buildJiraTicketRef(HOST, 'PM-1');
const PM2 = buildJiraTicketRef(HOST, 'PM-2');
const PM3 = buildJiraTicketRef(HOST, 'PM-3');
const OTHER_PM = buildJiraTicketRef(OTHER_HOST, 'PM-9');

describe('collectPendingReminderAlerts', () => {
    it('rehydrates due alerts, drops stale current-host entries, and preserves other hosts', () => {
        const now = Date.parse('2026-04-30T15:00:00.000Z');
        const pm1Keys = buildJiraTrackingStorageKeys(PM1, HOST);
        const pm2Keys = buildJiraTrackingStorageKeys(PM2, HOST);
        const pm3Keys = buildJiraTrackingStorageKeys(PM3, HOST);

        const result = collectPendingReminderAlerts({
            pendingAlerts: [PM1, PM1, PM2, PM3, OTHER_PM],
            storageItems: {
                [pm1Keys.notesKey]: 'Review launch checklist',
                [pm1Keys.reminderKey]: now - 60_000,
                [pm1Keys.tagsKey]: ['Urgent'],
                [getTagDefsStorageKey(HOST)]: { urgent: { label: 'Urgent', color: 'red' } },
                [getTicketCacheStorageKey(PM1, HOST)]: { details: { summary: 'Launch checklist' } },
                [pm2Keys.reminderKey]: now + 60_000,
                [pm3Keys.reminderKey]: now - 5_000,
                [pm3Keys.ignoredKey]: true,
            },
            host: HOST,
            now,
        });

        expect(result.alertsToShow).toEqual([{
            ticketRef: PM1,
            issueKey: 'PM-1',
            noteText: 'Review launch checklist',
            summary: 'Launch checklist',
            reminderTs: now - 60_000,
            tags: ['Urgent'],
            tagDefs: { urgent: { label: 'Urgent', color: 'red' } },
        }]);
        expect(result.nextPendingAlerts).toEqual([PM1, OTHER_PM]);
        expect(result.didChangePendingAlerts).toBe(true);
    });

    it('keeps valid pending alerts while suppressing already visible, queued, or handled ones', () => {
        const now = Date.parse('2026-04-30T15:00:00.000Z');
        const pm1Keys = buildJiraTrackingStorageKeys(PM1, HOST);
        const pm2Keys = buildJiraTrackingStorageKeys(PM2, HOST);
        const pm3Keys = buildJiraTrackingStorageKeys(PM3, HOST);

        const result = collectPendingReminderAlerts({
            pendingAlerts: [PM1, PM2, PM3],
            storageItems: {
                [pm1Keys.reminderKey]: now - 60_000,
                [pm2Keys.reminderKey]: now - 60_000,
                [pm3Keys.reminderKey]: now - 60_000,
            },
            host: HOST,
            now,
            currentTicketRef: PM1,
            queuedTicketRefs: [PM2],
            handledTicketRefs: [PM3],
        });

        expect(result.alertsToShow).toEqual([]);
        expect(result.nextPendingAlerts).toEqual([PM1, PM2, PM3]);
        expect(result.didChangePendingAlerts).toBe(false);
    });
});

describe('ReminderModal.openCurrentIssue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        noteDrawerOpenMock.mockClear();
        noteDrawerIsOpenMock.mockReset();
        noteDrawerIsOpenMock.mockReturnValue(false);
        storageMock.get.mockReset();
        storageMock.set.mockReset();
        storageMock.remove.mockReset();
        ReminderModal.backdrop = {
            classList: {
                remove: vi.fn(),
                contains: vi.fn(() => true),
            },
        };
        ReminderModal.el = null;
        ReminderModal.currentKey = PM1;
        ReminderModal.currentAlert = {
            ticketRef: PM1,
            issueKey: 'PM-1',
            noteText: 'First reminder',
            summary: 'First summary',
            reminderTs: Date.parse('2026-04-30T14:00:00.000Z'),
        };
        ReminderModal.queue = [{
            ticketRef: PM2,
            issueKey: 'PM-2',
            noteText: 'Second reminder',
            summary: 'Second summary',
            reminderTs: Date.parse('2026-04-30T14:05:00.000Z'),
        }];
        ReminderModal.handledKeys = new Set();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        ReminderModal.backdrop = null;
        ReminderModal.el = null;
        ReminderModal.currentKey = null;
        ReminderModal.currentAlert = null;
        ReminderModal.queue = [];
        ReminderModal.handledKeys.clear();
    });

    it('opens the drawer, keeps the reminder pending, and advances to the next queued alert', async () => {
        const showSpy = vi.spyOn(ReminderModal, 'show').mockImplementation(() => {});

        ReminderModal.openCurrentIssue();

        expect(noteDrawerOpenMock).toHaveBeenCalledWith(PM1, 'First summary');
        expect(ReminderModal.handledKeys.has(PM1)).toBe(true);
        expect(storageMock.remove).not.toHaveBeenCalled();
        expect(storageMock.set).not.toHaveBeenCalled();
        expect(ReminderModal.currentKey).toBeNull();
        expect(ReminderModal.currentAlert).toBeNull();

        await vi.advanceTimersByTimeAsync(300);

        expect(showSpy).toHaveBeenCalledWith(PM2, 'Second reminder', 'Second summary', Date.parse('2026-04-30T14:05:00.000Z'), undefined, undefined);
    });

    it('queues the next alert instead of reopening the modal while the drawer is visible', async () => {
        noteDrawerIsOpenMock.mockReturnValue(true);
        ReminderModal.backdrop = {
            classList: {
                remove: vi.fn(),
                contains: vi.fn(() => false),
            },
        };
        ReminderModal.el = {
            querySelector: vi.fn(() => ({
                style: {},
                textContent: '',
            })),
        };
        const initSpy = vi.spyOn(ReminderModal, 'init');

        ReminderModal.openCurrentIssue();
        await vi.advanceTimersByTimeAsync(300);

        expect(noteDrawerOpenMock).toHaveBeenCalledWith(PM1, 'First summary');
        expect(initSpy).toHaveBeenCalled();
        expect(ReminderModal.queue).toEqual([{
            ticketRef: PM2,
            issueKey: 'PM-2',
            noteText: 'Second reminder',
            summary: 'Second summary',
            reminderTs: Date.parse('2026-04-30T14:05:00.000Z'),
            tags: [],
            tagDefs: {},
        }]);
        expect(ReminderModal.currentKey).toBeNull();
    });

    it('shows the next queued alert when the drawer closes', async () => {
        ReminderModal.backdrop = {
            classList: {
                remove: vi.fn(),
                contains: vi.fn(() => false),
            },
        };
        const showSpy = vi.spyOn(ReminderModal, 'show').mockImplementation(() => {});

        await ReminderModal.handleDrawerClosed();

        expect(showSpy).toHaveBeenCalledWith(PM2, 'Second reminder', 'Second summary', Date.parse('2026-04-30T14:05:00.000Z'), undefined, undefined);
        expect(ReminderModal.queue).toEqual([]);
    });
});

import { storage, syncStorage, isContextValid } from '../../common/storage';
import { MetricsFeature } from './features/metrics';
import { InjectionFeature } from './features/injections';
import { CustomizationFeature } from './features/customization';
import { ReminderModal } from './ui/ReminderModal';
import { NoteDrawer } from './ui/NoteDrawer';
import { initTooltips } from './ui/tooltips';
import '../../assets/jira-styles.css';

// Early exit if not on a Jira page (secondary safeguard for Confluence)
if (window.location.pathname.startsWith('/wiki')) {
    throw new Error('PMsToolKit: Extension disabled on Confluence pages.');
}

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
    jira_native_table_icons: true
};

let cachedSettings = { ...DEFAULT_SETTINGS };
let runTimeout = null;
let isRunning = false;

// Initialize settings and setup listener
async function initSettings() {
    try {
        const settings = await syncStorage.get(DEFAULT_SETTINGS);
        cachedSettings = { ...DEFAULT_SETTINGS, ...settings };

        // Listen for changes to keep the cache updated
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'sync') {
                Object.keys(changes).forEach(key => {
                    if (DEFAULT_SETTINGS.hasOwnProperty(key)) {
                        cachedSettings[key] = changes[key].newValue;
                    }
                });
                // After settings change, trigger a run to apply them
                debouncedRunAll();
            }
        });
    } catch (e) {
        console.error('PMsToolKit: Failed to initialize settings', e);
    }
}

async function runAll() {
    if (!isContextValid()) {
        console.warn('PMsToolKit: Context invalidated, stopping runAll.');
        stopAll();
        return;
    }
    if (isRunning) return;
    isRunning = true;

    try {
        const settings = cachedSettings;

        if (settings.jira_hide_elements) CustomizationFeature.hideHeaderElements();
        if (settings.jira_collapse_sidebar) CustomizationFeature.collapseSidebar();
        if (settings.jira_manual_menu) CustomizationFeature.injectManualMenu();

        if (settings.jira_copy_for_slack) InjectionFeature.injectCopyForSlack();
        InjectionFeature.injectQuickNotes(settings.jira_quick_notes_list, settings.jira_quick_notes_ticket);
        if (settings.jira_breadcrumb_copy) InjectionFeature.injectBreadcrumbCopyButton();
        if (settings.jira_copy_for_slack || settings.jira_quick_notes_list) InjectionFeature.injectBoardCardIcons();

        NoteDrawer.initIndicators();

        if (settings.jira_age_indicators) MetricsFeature.injectAgeIndicators();
        if (settings.jira_board_age) MetricsFeature.injectBoardCardAgeIndicators();
        if (settings.jira_sp_summary) MetricsFeature.injectStoryPointsSummary();

    } catch (e) {
        console.error('PMsToolKit: Error in runAll', e);
    } finally {
        isRunning = false;
    }
}

function debouncedRunAll() {
    if (!isContextValid()) {
        stopAll();
        return;
    }
    clearTimeout(runTimeout);
    runTimeout = setTimeout(runAll, 300);
}

function stopAll() {
    if (observer) {
        observer.disconnect();
    }
    clearTimeout(runTimeout);
}

// Initial Run
if (window.top === window.self) {
    storage.set({ et_jira_host: window.location.hostname });
}
initTooltips();
initSettings().then(() => {
    debouncedRunAll();
});

// Observer for dynamic Jira content
const observer = new MutationObserver((mutations) => {
    const meaningfulMutation = mutations.some(m => {
        const target = m.target;
        if (!target || !target.closest) return false;
        if (target.closest('.et-drawer') || target.closest('.et-alert-modal') || target.closest('.et-notes-container')) return false;
        return true;
    });

    if (meaningfulMutation) debouncedRunAll();
});

observer.observe(document.body, { childList: true, subtree: true });

// Background message listener
chrome.runtime.onMessage.addListener((message) => {
    if (!isContextValid()) return;
    if (message.type === 'REMINDER_FIRED') {
        ReminderModal.show(message.issueKey, message.noteText, message.summary);
    }
});

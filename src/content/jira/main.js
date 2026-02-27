import { syncStorage } from '../../common/storage';
import { MetricsFeature } from './features/metrics';
import { InjectionFeature } from './features/injections';
import { CustomizationFeature } from './features/customization';
import { ReminderModal } from './ui/ReminderModal';
import '../../assets/jira-styles.css';

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
    jira_native_table_icons: true
};

let runTimeout = null;
let isRunning = false;

async function runAll() {
    if (isRunning) return;
    isRunning = true;

    try {
        const settings = await syncStorage.get(DEFAULT_SETTINGS);

        if (settings.jira_hide_elements) CustomizationFeature.hideHeaderElements();
        if (settings.jira_collapse_sidebar) CustomizationFeature.collapseSidebar();

        if (settings.jira_copy_for_slack) InjectionFeature.injectCopyForSlack();
        if (settings.jira_quick_notes_list || settings.jira_quick_notes_ticket) InjectionFeature.injectQuickNotes();
        if (settings.jira_breadcrumb_copy) InjectionFeature.injectBreadcrumbCopyButton();

        if (settings.jira_age_indicators) MetricsFeature.injectAgeIndicators();
        if (settings.jira_board_age) MetricsFeature.injectBoardCardAgeIndicators();

    } catch (e) {
        console.error('PMsToolKit: Error in runAll', e);
    } finally {
        isRunning = false;
    }
}

function debouncedRunAll() {
    clearTimeout(runTimeout);
    runTimeout = setTimeout(runAll, 300);
}

// Initial Run
debouncedRunAll();

// Observer for dynamic Jira content
const observer = new MutationObserver((mutations) => {
    const meaningfulMutation = mutations.some(m => {
        const target = m.target;
        if (target.closest?.('.et-drawer') || target.closest?.('.et-alert-modal')) return false;
        return true;
    });

    if (meaningfulMutation) debouncedRunAll();
});

observer.observe(document.body, { childList: true, subtree: true });

// Background message listener
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'REMINDER_FIRED') {
        ReminderModal.show(message.issueKey, message.noteText, message.summary);
    }
});

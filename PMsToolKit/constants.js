// PMsToolKit — Constants and Default Settings

const DEFAULT_SETTINGS = {
    // Jira - Navigation & Info
    jira_breadcrumb_copy: true,
    jira_age_indicators: true,
    jira_board_age: true,
    jira_quick_notes_ticket: true,
    jira_quick_notes_list: true,
    jira_manual_menu: true,
    jira_hide_elements: true,
    jira_collapse_sidebar: true,

    // Jira - Productivity
    jira_copy_for_slack: true,
    jira_velocity_per_dev: true,
    jira_sp_summary: true,

    // Jira - Tables
    jira_native_table_icons: true
};

// Use globalThis to make it available in both content scripts and popup
// without needing ESM (which requires more manifest changes)
globalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

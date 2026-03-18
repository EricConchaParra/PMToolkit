/**
 * PMsToolKit — Analytics Hub
 * Entry point — DOMContentLoaded bootstrap only.
 * All feature logic lives in ./modules/
 */

// ---- Modules ----
import { initNav } from './modules/nav.js';
import { loadSettings, saveSettings, getLastProject, setLastProject } from './modules/settings.js';
import { getJiraHost, fetchProjects, fetchProjectStatuses } from './modules/jiraApi.js';
import { escapeHtml } from './modules/utils.js';
import { DEFAULT_HOURS_PER_DAY, DEFAULT_SP_HOURS, SP_KEYS } from './modules/constants.js';
import { populateSettingsUI, populateStatusMapUI, readStatusMapFromUI } from './modules/sprintDashboard/settingsUI.js';
import {
    setHost, setSettings, setSpFieldId,
    loadDashboard, loadDashboardForSprint, resetSprintGithubState,
    getCurrentSprints, getSelectedSprintId, setSelectedSprintId,
} from './modules/sprintDashboard/sprintDashboard.js';
import { initCsvExporter } from './modules/csvExporter/csvExporter.js';
import { initPerfCombo } from './modules/performanceDashboard/performanceDashboard.js';
import { initFollowupCombo } from './modules/followupDashboard/followupDashboard.js';

// ============================================================
// BOOTSTRAP
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    // ---- Nav ----
    initNav();

    // ---- Initial settings (no project yet) ----
    let currentSettings = await loadSettings(null);
    setSettings(currentSettings);
    populateSettingsUI(currentSettings);
    populateStatusMapUI([], {});

    // ---- Jira host ----
    const currentHost = await getJiraHost();
    setHost(currentHost);

    // ---- Settings panel toggle ----
    const settingsPanel = document.getElementById('settings-panel');
    document.getElementById('settings-toggle-btn').addEventListener('click', () => {
        settingsPanel.classList.toggle('hidden');
    });

    // ---- Save settings ----
    let selectedProjectKey = '';

    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const hoursPerDay = parseInt(document.getElementById('hours-per-day').value, 10);
        const spHours = {};
        SP_KEYS.forEach(k => {
            const val = parseFloat(document.getElementById(`sp-${k}`)?.value);
            if (!isNaN(val)) spHours[k] = val;
        });
        const statusMap = readStatusMapFromUI();
        currentSettings = { hoursPerDay, spHours, statusMap };
        setSettings(currentSettings);
        await saveSettings(selectedProjectKey, currentSettings);
        const msg = document.getElementById('settings-saved-msg');
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 2000);
    });

    // ---- Reset settings ----
    document.getElementById('reset-settings-btn').addEventListener('click', async () => {
        currentSettings = { hoursPerDay: DEFAULT_HOURS_PER_DAY, spHours: { ...DEFAULT_SP_HOURS }, statusMap: {} };
        setSettings(currentSettings);
        await saveSettings(selectedProjectKey, currentSettings);
        populateSettingsUI(currentSettings);
        if (selectedProjectKey && currentHost) {
            const statuses = await fetchProjectStatuses(currentHost, selectedProjectKey).catch(() => []);
            populateStatusMapUI(statuses, {});
        }
        const msg = document.getElementById('settings-saved-msg');
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 2000);
    });

    // ---- Project combobox (Sprint Dashboard) ----
    const projectSearch = document.getElementById('project-search');
    const projectDropdown = document.getElementById('project-dropdown');
    const comboWrapper = document.getElementById('combo-wrapper');
    let allProjects = [];

    function renderComboOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const filtered = allProjects.filter(p => !term || p.name.toLowerCase().includes(term) || p.key.toLowerCase().includes(term));
        if (filtered.length === 0) {
            projectDropdown.innerHTML = `<div class="combo-msg">No projects found</div>`;
            return;
        }
        projectDropdown.innerHTML = filtered.map(p => `
            <div class="combo-option ${p.key === selectedProjectKey ? 'selected' : ''}" data-key="${p.key}" data-name="${escapeHtml(p.name)}">
                <span class="combo-option-key">${p.key}</span>${escapeHtml(p.name)}
            </div>
        `).join('');
    }

    if (currentHost) {
        try {
            allProjects = await fetchProjects(currentHost);
            projectSearch.placeholder = 'Search project...';
            renderComboOptions();
        } catch {
            projectSearch.placeholder = 'Failed to load projects';
        }
    } else {
        projectSearch.placeholder = 'Log in to Jira first';
    }

    // ---- Select project ----
    async function selectProject(projectKey) {
        selectedProjectKey = projectKey;
        setLastProject(projectKey);

        currentSettings = await loadSettings(projectKey);
        setSettings(currentSettings);
        populateSettingsUI(currentSettings);

        setSpFieldId(null);
        loadDashboard(projectKey);

        fetchProjectStatuses(currentHost, projectKey)
            .then(statuses => populateStatusMapUI(statuses, currentSettings.statusMap || {}))
            .catch(() => { });
    }

    // Project combobox events
    projectSearch.addEventListener('focus', () => {
        projectSearch.select();
        projectDropdown.classList.remove('hidden');
        renderComboOptions('');
    });

    projectSearch.addEventListener('input', (e) => {
        projectDropdown.classList.remove('hidden');
        renderComboOptions(e.target.value);
    });

    projectDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.combo-option');
        if (!option) return;
        projectSearch.value = `${option.dataset.name} (${option.dataset.key})`;
        projectDropdown.classList.add('hidden');
        selectProject(option.dataset.key);
    });

    document.addEventListener('click', (e) => {
        if (!comboWrapper.contains(e.target)) {
            projectDropdown.classList.add('hidden');
            if (selectedProjectKey) {
                const p = allProjects.find(pr => pr.key === selectedProjectKey);
                if (p) projectSearch.value = `${p.name} (${p.key})`;
            } else {
                projectSearch.value = '';
            }
        }
    });

    // ---- Auto-restore last project ----
    const lastProject = await getLastProject();
    if (lastProject && allProjects.find(p => p.key === lastProject)) {
        const p = allProjects.find(pr => pr.key === lastProject);
        projectSearch.value = `${p.name} (${p.key})`;
        await selectProject(lastProject);
    }

    // ---- Sprint combobox ----
    const sprintSearch = document.getElementById('sprint-search');
    const sprintDropdown = document.getElementById('sprint-dropdown');
    const sprintComboWrapper = document.getElementById('sprint-combo-wrapper');

    function renderSprintComboOptions(filterText = '') {
        const term = filterText.toLowerCase();
        const sprints = getCurrentSprints();
        const selId = getSelectedSprintId();
        const filtered = sprints.filter(s => !term || s.name.toLowerCase().includes(term) || String(s.id).includes(term) || s.state.toLowerCase().includes(term));

        if (filtered.length === 0) {
            sprintDropdown.innerHTML = `<div class="combo-msg">No sprints found</div>`;
            return;
        }

        sprintDropdown.innerHTML = filtered.map(s => {
            let stateIndicator = s.state === 'active' ? '🟢 ' : s.state === 'future' ? '🗓️ ' : '📦 ';
            return `
            <div class="combo-option ${s.id === selId ? 'selected' : ''}" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-state="${s.state}">
                <span class="combo-option-key">${stateIndicator}${s.state}</span>${escapeHtml(s.name)}
            </div>
            `;
        }).join('');
    }

    sprintSearch.addEventListener('focus', () => {
        sprintSearch.select();
        sprintDropdown.classList.remove('hidden');
        renderSprintComboOptions('');
    });

    sprintSearch.addEventListener('input', (e) => {
        sprintDropdown.classList.remove('hidden');
        renderSprintComboOptions(e.target.value);
    });

    sprintDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.combo-option');
        if (!option) return;
        const id = parseInt(option.dataset.id, 10);
        setSelectedSprintId(id);
        const sprint = getCurrentSprints().find(s => s.id === id);
        sprintSearch.value = `${sprint.state === 'active' ? '🟢 ' : ''}${sprint.name}`;
        sprintDropdown.classList.add('hidden');
        loadDashboardForSprint(sprint);
    });

    document.addEventListener('click', (e) => {
        if (!sprintComboWrapper.contains(e.target)) {
            sprintDropdown.classList.add('hidden');
            if (getSelectedSprintId()) {
                const s = getCurrentSprints().find(sr => sr.id === getSelectedSprintId());
                if (s) sprintSearch.value = `${s.state === 'active' ? '🟢 ' : ''}${s.name}`;
            } else {
                sprintSearch.value = '';
            }
        }
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
        if (!selectedProjectKey) return;
        setSpFieldId(null);
        resetSprintGithubState();
        if (getSelectedSprintId()) {
            const sprint = getCurrentSprints().find(s => s.id === getSelectedSprintId());
            sprint ? loadDashboardForSprint(sprint) : loadDashboard(selectedProjectKey);
        } else {
            loadDashboard(selectedProjectKey);
        }
    });

    // ---- CSV Exporter ----
    initCsvExporter();

    // ---- Performance Dashboard ----
    initPerfCombo(allProjects, currentHost, lastProject);

    // ---- Follow-up Work Dashboard ----
    initFollowupCombo(allProjects, currentHost, lastProject, () => currentSettings);
});

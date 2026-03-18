/**
 * PMsToolKit — Analytics Hub
 * Settings UI: populates and reads the settings panel for Sprint Dashboard
 */

import { SP_KEYS, DEFAULT_SP_HOURS, SECTION_OPTIONS } from '../constants.js';
import { escapeHtml } from '../utils.js';

// ============================================================
// SECTION GUESS
// ============================================================

// Guess a section based on status name / category (used as default when no manual mapping)
export function guessSection(status) {
    const n = (status.name || '').toLowerCase();
    const cat = (status.categoryKey || '').toLowerCase();
    if (n.includes('in progress') || n.includes('in review')) return 'inProgress';
    if (n.includes('qa') || n.includes('test')) return 'qa';
    if (cat === 'done' || n === 'done' || n.includes('closed') || n.includes('released')) return 'done';
    return 'todo';
}

// ============================================================
// POPULATE SETTINGS
// ============================================================

export function populateSettingsUI(settings) {
    document.getElementById('hours-per-day').value = settings.hoursPerDay;
    SP_KEYS.forEach(k => {
        const el = document.getElementById(`sp-${k}`);
        if (el) el.value = settings.spHours[k] ?? DEFAULT_SP_HOURS[k] ?? '';
    });
    const githubRepos = document.getElementById('github-repos');
    if (githubRepos) {
        githubRepos.value = Array.isArray(settings.githubRepos) ? settings.githubRepos.join('\n') : '';
    }
}

export function populateStatusMapUI(statuses, statusMap) {
    const col = document.getElementById('status-map-col');
    if (!col) return;
    if (!statuses || statuses.length === 0) {
        col.innerHTML = `<h4>Status Mapping</h4><p class="status-map-hint">Select a project to configure status mapping.</p>`;
        return;
    }
    col.innerHTML = `
        <h4>Status Mapping</h4>
        <p class="status-map-hint">Assign each project status to a dashboard section.</p>
        <div class="status-map-list">
            ${statuses.map(s => {
        const selected = statusMap[s.name] || guessSection(s);
        return `
                    <div class="status-map-row">
                        <span class="status-map-name">${escapeHtml(s.name)}</span>
                        <select class="status-map-select" data-status="${escapeHtml(s.name)}">
                            ${SECTION_OPTIONS.map(o => `<option value="${o.value}"${selected === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
                        </select>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}

// ============================================================
// READ STATUS MAP FROM UI
// ============================================================

// Read current status map from the UI
export function readStatusMapFromUI() {
    const map = {};
    document.querySelectorAll('.status-map-select').forEach(sel => {
        map[sel.dataset.status] = sel.value;
    });
    return map;
}

export function readGithubReposFromUI() {
    const input = document.getElementById('github-repos');
    if (!input) return [];

    return String(input.value || '')
        .split(/[\n,]+/)
        .map(repo => repo.trim())
        .filter(Boolean);
}

/**
 * PMsToolKit — Analytics Hub
 * Settings UI: populates and reads the settings panel for Sprint Dashboard
 */

import { SP_KEYS, DEFAULT_SP_HOURS } from '../constants.js';

export function populateSettingsUI(settings) {
    document.getElementById('hours-per-day').value = settings.hoursPerDay;
    SP_KEYS.forEach(key => {
        const input = document.getElementById(`sp-${key}`);
        if (input) input.value = settings.spHours[key] ?? DEFAULT_SP_HOURS[key] ?? '';
    });

    const githubRepos = document.getElementById('github-repos');
    if (githubRepos) {
        githubRepos.value = Array.isArray(settings.githubRepos) ? settings.githubRepos.join('\n') : '';
    }
}

export function readGithubReposFromUI() {
    const input = document.getElementById('github-repos');
    if (!input) return [];

    return String(input.value || '')
        .split(/[\n,]+/)
        .map(repo => repo.trim())
        .filter(Boolean);
}

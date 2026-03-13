/**
 * PMsToolKit — Analytics Hub
 * Chrome storage helpers for settings (per-project and last-used project)
 */

import { DEFAULT_HOURS_PER_DAY, DEFAULT_SP_HOURS, LAST_PROJECT_KEY } from './constants.js';

// ============================================================
// SETTINGS STORAGE
// ============================================================

export function settingsStorageKey(projectKey) {
    return `sdk_settings_${projectKey}`;
}

export function loadSettings(projectKey) {
    return new Promise(resolve => {
        const defaults = { hoursPerDay: DEFAULT_HOURS_PER_DAY, spHours: { ...DEFAULT_SP_HOURS }, statusMap: {} };
        if (!projectKey || !(typeof chrome !== 'undefined' && chrome.storage)) {
            resolve(defaults);
            return;
        }
        chrome.storage.local.get([settingsStorageKey(projectKey)], result => {
            const saved = result[settingsStorageKey(projectKey)] || {};
            resolve({
                hoursPerDay: saved.hoursPerDay || DEFAULT_HOURS_PER_DAY,
                spHours: { ...DEFAULT_SP_HOURS, ...(saved.spHours || {}) },
                statusMap: saved.statusMap || {},
            });
        });
    });
}

export function saveSettings(projectKey, settings) {
    return new Promise(resolve => {
        if (!projectKey || !(typeof chrome !== 'undefined' && chrome.storage)) { resolve(); return; }
        chrome.storage.local.set({ [settingsStorageKey(projectKey)]: settings }, resolve);
    });
}

export function getLastProject() {
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([LAST_PROJECT_KEY], r => resolve(r[LAST_PROJECT_KEY] || null));
        } else resolve(null);
    });
}

export function setLastProject(key) {
    if (typeof chrome !== 'undefined' && chrome.storage)
        chrome.storage.local.set({ [LAST_PROJECT_KEY]: key });
}

/**
 * PMsToolKit — Analytics Hub
 * Chrome storage helpers for settings (per-project and last-used project)
 */

import { DEFAULT_HOURS_PER_DAY, DEFAULT_SP_HOURS } from './constants.js';
import {
    getJiraProjectSettingsStorageKey,
    getLastProjectStorageKey,
} from '../../../common/jiraStorageKeys.js';

const ANALYTICS_SIDEBAR_COLLAPSED_KEY = 'pmtk_analytics_sidebar_collapsed';

// ============================================================
// SETTINGS STORAGE
// ============================================================

export function settingsStorageKey(host, projectKey) {
    return getJiraProjectSettingsStorageKey(host, projectKey);
}

export function loadSettings(host, projectKey) {
    return new Promise(resolve => {
        const defaults = {
            hoursPerDay: DEFAULT_HOURS_PER_DAY,
            spHours: { ...DEFAULT_SP_HOURS },
            githubRepos: [],
        };
        const storageKey = settingsStorageKey(host, projectKey);
        if (!storageKey || !(typeof chrome !== 'undefined' && chrome.storage)) {
            resolve(defaults);
            return;
        }
        chrome.storage.local.get([storageKey], result => {
            const saved = result[storageKey] || {};
            resolve({
                hoursPerDay: saved.hoursPerDay || DEFAULT_HOURS_PER_DAY,
                spHours: { ...DEFAULT_SP_HOURS, ...(saved.spHours || {}) },
                githubRepos: Array.isArray(saved.githubRepos)
                    ? saved.githubRepos.filter(Boolean).map(repo => String(repo).trim()).filter(Boolean)
                    : [],
            });
        });
    });
}

export function saveSettings(host, projectKey, settings) {
    return new Promise(resolve => {
        const storageKey = settingsStorageKey(host, projectKey);
        if (!storageKey || !(typeof chrome !== 'undefined' && chrome.storage)) { resolve(); return; }
        chrome.storage.local.set({ [storageKey]: settings }, resolve);
    });
}

export function getLastProject(host) {
    return new Promise(resolve => {
        const storageKey = getLastProjectStorageKey(host);
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([storageKey], r => resolve(r[storageKey] || null));
        } else resolve(null);
    });
}

export function setLastProject(host, key) {
    const storageKey = getLastProjectStorageKey(host);
    if (typeof chrome !== 'undefined' && chrome.storage)
        chrome.storage.local.set({ [storageKey]: key });
}

export function loadSidebarCollapsed() {
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([ANALYTICS_SIDEBAR_COLLAPSED_KEY], result => {
                resolve(result[ANALYTICS_SIDEBAR_COLLAPSED_KEY] === true);
            });
            return;
        }

        try {
            resolve(localStorage.getItem(ANALYTICS_SIDEBAR_COLLAPSED_KEY) === '1');
        } catch {
            resolve(false);
        }
    });
}

export function saveSidebarCollapsed(collapsed) {
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [ANALYTICS_SIDEBAR_COLLAPSED_KEY]: collapsed === true }, resolve);
            return;
        }

        try {
            localStorage.setItem(ANALYTICS_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
        } catch {
            // Ignore storage failures outside the extension runtime.
        }
        resolve();
    });
}

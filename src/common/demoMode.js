import { syncStorage } from './storage.js';

export const DEMO_MODE_KEY = 'demo_mode';

export async function getDemoMode() {
    const result = await syncStorage.get({ [DEMO_MODE_KEY]: false });
    return result[DEMO_MODE_KEY] === true;
}

export async function setDemoMode(enabled) {
    await syncStorage.set({ [DEMO_MODE_KEY]: enabled === true });
}

export function subscribeDemoMode(callback) {
    if (!(typeof chrome !== 'undefined' && chrome.storage?.onChanged) || typeof callback !== 'function') {
        return () => {};
    }

    const listener = (changes, areaName) => {
        if (areaName !== 'sync' || !Object.prototype.hasOwnProperty.call(changes, DEMO_MODE_KEY)) return;
        callback(changes[DEMO_MODE_KEY].newValue === true);
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
        if (chrome.storage?.onChanged?.removeListener) {
            chrome.storage.onChanged.removeListener(listener);
        }
    };
}

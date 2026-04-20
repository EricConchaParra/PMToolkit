import { sessionStorage } from './storage.js';

const fallbackStore = {};

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function getScopedKey(namespace) {
    return `pmtk_demo_session:${namespace}`;
}

export async function loadDemoSessionValue(namespace, defaults) {
    const scopedKey = getScopedKey(namespace);
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const result = await sessionStorage.get(scopedKey);
        const value = result[scopedKey];
        return value == null ? clone(defaults) : clone(value);
    }

    if (!Object.prototype.hasOwnProperty.call(fallbackStore, scopedKey)) {
        fallbackStore[scopedKey] = clone(defaults);
    }
    return clone(fallbackStore[scopedKey]);
}

export async function saveDemoSessionValue(namespace, value) {
    const scopedKey = getScopedKey(namespace);
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        await sessionStorage.set({ [scopedKey]: clone(value) });
        return;
    }

    fallbackStore[scopedKey] = clone(value);
}

export async function resetDemoSessionValue(namespace, defaults) {
    const value = clone(defaults);
    await saveDemoSessionValue(namespace, value);
    return value;
}

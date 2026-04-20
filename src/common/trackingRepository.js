import { storage } from './storage.js';
import { getDemoTrackingItems } from './demoData.js';
import { loadDemoSessionValue, resetDemoSessionValue, saveDemoSessionValue } from './demoSessionStore.js';

const DEMO_TRACKING_NAMESPACE = 'tracking';

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

async function loadDemoTrackingSnapshot() {
    return loadDemoSessionValue(DEMO_TRACKING_NAMESPACE, getDemoTrackingItems());
}

export async function getTrackingItems(keys = null, opts = {}) {
    if (opts.demoMode === true) {
        const snapshot = await loadDemoTrackingSnapshot();
        if (keys == null) return snapshot;
        if (Array.isArray(keys)) {
            return keys.reduce((acc, key) => {
                if (Object.prototype.hasOwnProperty.call(snapshot, key)) acc[key] = snapshot[key];
                return acc;
            }, {});
        }
        if (typeof keys === 'string') {
            return Object.prototype.hasOwnProperty.call(snapshot, keys) ? { [keys]: snapshot[keys] } : {};
        }
        if (keys && typeof keys === 'object') {
            return Object.entries(keys).reduce((acc, [key, fallback]) => {
                acc[key] = Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : fallback;
                return acc;
            }, {});
        }
        return snapshot;
    }

    return storage.get(keys);
}

export async function getAllTrackingItems(opts = {}) {
    return getTrackingItems(null, opts);
}

export async function setTrackingItems(payload, opts = {}) {
    if (opts.demoMode === true) {
        const snapshot = await loadDemoTrackingSnapshot();
        await saveDemoSessionValue(DEMO_TRACKING_NAMESPACE, {
            ...snapshot,
            ...clone(payload || {}),
        });
        return;
    }

    await storage.set(payload);
}

export async function removeTrackingItems(keys, opts = {}) {
    if (opts.demoMode === true) {
        const snapshot = await loadDemoTrackingSnapshot();
        const next = { ...snapshot };
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(key => {
            delete next[key];
        });
        await saveDemoSessionValue(DEMO_TRACKING_NAMESPACE, next);
        return;
    }

    await storage.remove(keys);
}

export async function resetDemoTrackingItems() {
    return resetDemoSessionValue(DEMO_TRACKING_NAMESPACE, getDemoTrackingItems());
}

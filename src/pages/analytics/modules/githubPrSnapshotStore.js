import { storage } from '../../../common/storage.js';
import { GITHUB_PR_AVAILABILITY_KEY } from '../../../common/githubPrStorage.js';

const availabilityListeners = new Set();
let storageListenerBound = false;
let cachedAvailability = {
    blocked: false,
    reason: '',
    status: 'available',
    retryAt: null,
    retryInMs: null,
    bucket: null,
    pendingKeys: [],
    lastSuccessfulSyncAt: null,
    buckets: {
        rest: { bucket: 'rest', blocked: false, reason: '', retryAt: null, pendingKeys: [], retryCount: 0 },
        search: { bucket: 'search', blocked: false, reason: '', retryAt: null, pendingKeys: [], retryCount: 0 },
    },
};

function notifyAvailabilityListeners() {
    availabilityListeners.forEach(listener => {
        try {
            listener(getGithubAvailabilityState());
        } catch (error) {
            console.warn('PMsToolKit: GitHub availability listener failed', error);
        }
    });
}

function normalizeAvailability(rawState = {}) {
    return {
        blocked: rawState.blocked === true,
        reason: rawState.reason || '',
        status: rawState.blocked ? 'blocked' : 'available',
        retryAt: rawState.retryAt || null,
        retryInMs: rawState.retryAt ? Math.max(0, rawState.retryAt - Date.now()) : null,
        bucket: rawState.bucket || null,
        pendingKeys: Array.isArray(rawState.pendingKeys) ? rawState.pendingKeys : [],
        lastSuccessfulSyncAt: rawState.lastSuccessfulSyncAt || null,
        buckets: rawState.buckets || cachedAvailability.buckets,
    };
}

async function hydrateAvailabilityFromStorage() {
    const items = await storage.get([GITHUB_PR_AVAILABILITY_KEY]);
    if (items && Object.prototype.hasOwnProperty.call(items, GITHUB_PR_AVAILABILITY_KEY)) {
        cachedAvailability = normalizeAvailability(items[GITHUB_PR_AVAILABILITY_KEY]);
    }
    return getGithubAvailabilityState();
}

function bindAvailabilityStorageListener() {
    if (storageListenerBound || typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[GITHUB_PR_AVAILABILITY_KEY]) return;
        cachedAvailability = normalizeAvailability(changes[GITHUB_PR_AVAILABILITY_KEY].newValue || {});
        notifyAvailabilityListeners();
    });

    storageListenerBound = true;
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            reject(new Error('Chrome runtime unavailable'));
            return;
        }

        chrome.runtime.sendMessage(message, response => {
            if (chrome.runtime?.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response) {
                reject(new Error('No response from background script'));
                return;
            }
            if (response.ok === false) {
                reject(new Error(response.error || 'Unexpected background error'));
                return;
            }
            resolve(response);
        });
    });
}

function updateAvailability(availability) {
    if (!availability) return;
    cachedAvailability = normalizeAvailability(availability);
    notifyAvailabilityListeners();
}

export function getGithubAvailabilityState() {
    return {
        ...cachedAvailability,
        retryInMs: cachedAvailability.retryAt ? Math.max(0, cachedAvailability.retryAt - Date.now()) : null,
    };
}

export function subscribeGithubAvailability(listener) {
    if (typeof listener !== 'function') return () => {};
    bindAvailabilityStorageListener();
    availabilityListeners.add(listener);
    void hydrateAvailabilityFromStorage().then(() => listener(getGithubAvailabilityState())).catch(() => {});
    return () => availabilityListeners.delete(listener);
}

export function clearPrSnapshotCache(scope = {}) {
    bindAvailabilityStorageListener();
    return sendRuntimeMessage({ type: 'CLEAR_PR_SNAPSHOT_CACHE', payload: scope })
        .then(response => {
            updateAvailability(response.availability);
        })
        .catch(error => {
            console.warn('PMsToolKit: Failed to clear PR snapshot cache', error);
        });
}

export async function resolveGithubPrBatch({
    ticketKeys = [],
    token,
    repos = [],
    forceRefresh = false,
    visibleTicketKeys = [],
    allowGlobalFallback = false,
    repoConcurrency = 1,
    closedWindowDays = 14,
    searchLimit = 5,
} = {}) {
    bindAvailabilityStorageListener();
    const response = await sendRuntimeMessage({
        type: 'REFRESH_PR_SNAPSHOTS',
        payload: {
            ticketKeys,
            token,
            repos,
            forceRefresh,
            visibleTicketKeys,
            allowGlobalFallback,
            repoConcurrency,
            closedWindowDays,
            searchLimit,
        },
    });
    updateAvailability(response.availability);
    return {
        snapshotsByKey: response.snapshotsByKey || {},
        pendingKeys: response.pendingKeys || [],
        notFoundKeys: response.notFoundKeys || [],
        sourceMeta: response.sourceMeta || {
            usedRepoIndex: Array.isArray(repos) && repos.length > 0,
            usedFallback: false,
            fallbackPaused: false,
            repoCount: Array.isArray(repos) ? repos.length : 0,
        },
    };
}

export async function getPrSnapshots(ticketKeys, token, options = {}) {
    const result = await resolveGithubPrBatch({
        ticketKeys,
        token,
        repos: options.repos || [],
        forceRefresh: options.forceRefresh === true,
        visibleTicketKeys: options.priorityTicketKeys || [],
        allowGlobalFallback: options.allowGlobalFallback === true,
        repoConcurrency: options.repoConcurrency,
        closedWindowDays: options.closedWindowDays,
        searchLimit: options.searchLimit,
    });
    return result.snapshotsByKey;
}

export async function getPrSnapshot(ticketKey, token, options = {}) {
    const result = await resolveGithubPrBatch({
        ticketKeys: [ticketKey],
        token,
        repos: options.repos || [],
        forceRefresh: options.forceRefresh === true,
        visibleTicketKeys: [ticketKey],
        allowGlobalFallback: options.allowGlobalFallback !== false,
        repoConcurrency: options.repoConcurrency,
        closedWindowDays: options.closedWindowDays,
        searchLimit: 1,
    });
    return Object.prototype.hasOwnProperty.call(result.snapshotsByKey, String(ticketKey || '').toUpperCase())
        ? result.snapshotsByKey[String(ticketKey || '').toUpperCase()]
        : null;
}

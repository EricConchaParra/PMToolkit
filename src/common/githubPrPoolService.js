import { storage } from './storage.js';
import { githubFetch } from './githubApi.js';
import {
    extractTicketKeyFromNotFoundStorageKey,
    extractTicketKeyFromSnapshotStorageKey,
    GITHUB_PR_AVAILABILITY_KEY,
    getPrNotFoundStorageKeys,
    getPrSnapshotStorageKeys,
    isPrNotFoundStorageKey,
    isPrSnapshotStorageKey,
    makePrNotFoundStorageKey,
    makePrSnapshotStorageKey,
    normalizeTicketKey,
} from './githubPrStorage.js';

const snapshotCache = new Map();
const notFoundMetaCache = new Map();
const availabilityListeners = new Set();
const recoveryTimers = new Map();
const pendingBatchRequests = new Map();
const pendingSingleRequests = new Map();

const ACTIVE_NOT_FOUND_CACHE_TTL_MS = 10 * 60 * 1000;
const DONE_NOT_FOUND_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_RESERVE_REQUESTS = 5;
const CORE_RESERVE_REQUESTS = 100;
const SEARCH_REQUESTS_PER_LOOKUP = 2;
const CORE_REQUESTS_PER_LOOKUP = 2;

const DEFAULT_OPTIONS = {
    repoConcurrency: 1,
    closedWindowDays: 14,
    allowGlobalFallback: false,
};

const rateLimitState = {
    rest: createBucketState('rest'),
    search: createBucketState('search'),
};

let lastSuccessfulSyncAt = 0;
let hydrated = false;

function createBucketState(bucket) {
    return {
        bucket,
        blocked: false,
        paused: false,
        reason: '',
        retryAt: null,
        pendingKeys: new Set(),
        retryCount: 0,
    };
}

async function ensureHydrated() {
    if (hydrated) return;

    const items = await storage.get(null);
    snapshotCache.clear();
    notFoundMetaCache.clear();

    Object.entries(items || {}).forEach(([key, value]) => {
        if (isPrSnapshotStorageKey(key)) {
            const ticketKey = extractTicketKeyFromSnapshotStorageKey(key);
            if (!ticketKey) return;
            snapshotCache.set(ticketKey, value ?? null);
            return;
        }

        if (isPrNotFoundStorageKey(key)) {
            const ticketKey = extractTicketKeyFromNotFoundStorageKey(key);
            const meta = normalizeNotFoundMeta(value);
            if (!ticketKey || !meta) return;
            notFoundMetaCache.set(ticketKey, meta);
        }
    });

    restoreAvailabilityState(items?.[GITHUB_PR_AVAILABILITY_KEY]);
    hydrated = true;
}

export async function hydrateGithubPrPool() {
    await ensureHydrated();
}

function restoreAvailabilityState(rawState = null) {
    Object.keys(rateLimitState).forEach(bucketName => {
        clearRecoveryTimer(bucketName);
        resetBucket(bucketName);
    });

    lastSuccessfulSyncAt = Number(rawState?.lastSuccessfulSyncAt) || 0;
    const rawBuckets = rawState?.buckets || {};

    Object.entries(rateLimitState).forEach(([bucketName, bucketState]) => {
        const rawBucket = rawBuckets[bucketName];
        if (!rawBucket) return;

        bucketState.blocked = rawBucket.blocked === true;
        bucketState.paused = rawBucket.paused === true;
        bucketState.reason = rawBucket.reason || '';
        bucketState.retryAt = Number(rawBucket.retryAt) || null;
        bucketState.retryCount = Number(rawBucket.retryCount) || 0;
        bucketState.pendingKeys = new Set(
            Array.isArray(rawBucket.pendingKeys)
                ? rawBucket.pendingKeys.map(ticketKey => normalizeTicketKey(ticketKey)).filter(Boolean)
                : [],
        );

        if (bucketState.blocked && bucketState.retryAt && bucketState.retryAt > Date.now()) {
            scheduleRecovery(bucketName, bucketState.retryAt);
        } else if (bucketState.blocked && bucketState.retryAt && bucketState.retryAt <= Date.now()) {
            resetBucket(bucketName);
        }
    });
}

async function persistSnapshots(snapshotEntries = {}, ticketStateByKey = {}) {
    const payload = {};
    const removeKeys = [];
    const now = Date.now();

    Object.entries(snapshotEntries).forEach(([ticketKey, snapshot]) => {
        payload[makePrSnapshotStorageKey(ticketKey)] = snapshot;
        if (snapshot == null) {
            const meta = {
                fetchedAt: now,
                isDone: resolveTicketDoneState(ticketStateByKey[ticketKey]),
            };
            payload[makePrNotFoundStorageKey(ticketKey)] = meta;
            notFoundMetaCache.set(ticketKey, meta);
            return;
        }

        removeKeys.push(makePrNotFoundStorageKey(ticketKey));
        notFoundMetaCache.delete(ticketKey);
    });

    if (Object.keys(payload).length === 0) return;
    await storage.set(payload);
    if (removeKeys.length > 0) {
        await storage.remove(removeKeys);
    }
}

async function persistAvailabilityState() {
    await storage.set({
        [GITHUB_PR_AVAILABILITY_KEY]: {
            lastSuccessfulSyncAt: lastSuccessfulSyncAt || null,
            buckets: {
                rest: serializeBucketState(rateLimitState.rest),
                search: serializeBucketState(rateLimitState.search),
            },
        },
    });
}

async function notifyAvailabilityListeners() {
    const state = getGithubAvailabilityState();
    await persistAvailabilityState();
    availabilityListeners.forEach(listener => {
        try {
            listener(state);
        } catch (error) {
            console.warn('PMsToolKit: GitHub availability listener failed', error);
        }
    });
}

export function subscribeGithubAvailability(listener) {
    if (typeof listener !== 'function') return () => {};
    availabilityListeners.add(listener);
    return () => availabilityListeners.delete(listener);
}

export function getGithubAvailabilityState() {
    const blockedBuckets = Object.values(rateLimitState).filter(bucket => bucket.blocked);
    const pausedBuckets = Object.values(rateLimitState).filter(bucket => bucket.paused);
    const activeBlock = blockedBuckets
        .slice()
        .sort((left, right) => Number(left.retryAt || Infinity) - Number(right.retryAt || Infinity))[0] || null;
    const activePause = pausedBuckets[0] || null;
    const activeBucket = activeBlock || activePause;
    const activePendingBuckets = Object.values(rateLimitState).filter(bucket => bucket.blocked || bucket.paused);

    return {
        blocked: blockedBuckets.length > 0,
        paused: blockedBuckets.length === 0 && pausedBuckets.length > 0,
        reason: activeBucket?.reason || '',
        status: blockedBuckets.length > 0 ? 'blocked' : pausedBuckets.length > 0 ? 'paused' : 'available',
        retryAt: activeBlock?.retryAt || null,
        retryInMs: activeBlock?.retryAt ? Math.max(0, activeBlock.retryAt - Date.now()) : null,
        bucket: activeBucket?.bucket || null,
        pendingKeys: Array.from(new Set(activePendingBuckets.flatMap(bucket => Array.from(bucket.pendingKeys)))),
        lastSuccessfulSyncAt: lastSuccessfulSyncAt || null,
        buckets: {
            rest: serializeBucketState(rateLimitState.rest),
            search: serializeBucketState(rateLimitState.search),
        },
    };
}

export async function clearPrSnapshotCache(scope = {}) {
    await ensureHydrated();

    const keys = Array.isArray(scope.ticketKeys)
        ? scope.ticketKeys.map(ticketKey => normalizeTicketKey(ticketKey)).filter(Boolean)
        : null;

    if (keys && keys.length > 0) {
        keys.forEach(ticketKey => {
            snapshotCache.delete(ticketKey);
            notFoundMetaCache.delete(ticketKey);
        });
        Object.values(rateLimitState).forEach(bucket => {
            keys.forEach(ticketKey => bucket.pendingKeys.delete(ticketKey));
        });
        await storage.remove([
            ...getPrSnapshotStorageKeys(keys),
            ...getPrNotFoundStorageKeys(keys),
        ]);
    } else {
        const snapshotKeys = Array.from(snapshotCache.keys());
        snapshotCache.clear();
        notFoundMetaCache.clear();
        Object.values(rateLimitState).forEach(bucket => {
            bucket.pendingKeys.clear();
        });
        if (snapshotKeys.length > 0) {
            await storage.remove([
                ...getPrSnapshotStorageKeys(snapshotKeys),
                ...getPrNotFoundStorageKeys(snapshotKeys),
            ]);
        }
    }

    Object.keys(rateLimitState).forEach(bucketName => {
        clearRecoveryTimer(bucketName);
        resetBucket(bucketName);
    });

    await notifyAvailabilityListeners();
}

export async function resolveGithubPrBatch(options = {}) {
    await ensureHydrated();

    const normalizedKeys = uniqueTicketKeys(options.ticketKeys || []);
    const orderedKeys = uniqueTicketKeys([...(options.visibleTicketKeys || []), ...normalizedKeys]);
    const normalizedRepos = uniqueRepos(options.repos || []);
    const ticketStateByKey = normalizeTicketStateMap(options.ticketStateByKey || {}, orderedKeys);
    const requestOptions = {
        ...DEFAULT_OPTIONS,
        ...options,
        ticketKeys: normalizedKeys,
        visibleTicketKeys: orderedKeys,
        repos: normalizedRepos,
        ticketStateByKey,
    };

    const requestKey = JSON.stringify({
        ticketKeys: orderedKeys,
        repos: normalizedRepos,
        ticketStateByKey,
        forceRefresh: requestOptions.forceRefresh === true,
        allowGlobalFallback: requestOptions.allowGlobalFallback === true,
        repoConcurrency: requestOptions.repoConcurrency,
        closedWindowDays: requestOptions.closedWindowDays,
        token: requestOptions.token,
    });

    if (pendingBatchRequests.has(requestKey)) {
        return pendingBatchRequests.get(requestKey);
    }

    const request = resolveGithubPrBatchInternal(requestOptions)
        .finally(() => pendingBatchRequests.delete(requestKey));
    pendingBatchRequests.set(requestKey, request);
    return request;
}

async function resolveGithubPrBatchInternal({
    ticketKeys = [],
    token,
    repos = [],
    forceRefresh = false,
    visibleTicketKeys = [],
    allowGlobalFallback = false,
    repoConcurrency = DEFAULT_OPTIONS.repoConcurrency,
    closedWindowDays = DEFAULT_OPTIONS.closedWindowDays,
    ticketStateByKey = {},
} = {}) {
    clearPreventivePauses();

    const orderedKeys = uniqueTicketKeys([...visibleTicketKeys, ...ticketKeys]);
    const snapshotsByKey = {};
    const pendingKeys = new Set();
    const notFoundKeys = new Set();
    const sourceMeta = {
        usedRepoIndex: repos.length > 0,
        usedFallback: false,
        fallbackPaused: false,
        repoCount: repos.length,
    };

    if (!token || orderedKeys.length === 0) {
        return { snapshotsByKey, pendingKeys: [], notFoundKeys: [], sourceMeta };
    }

    if (forceRefresh) {
        await clearPrSnapshotCache({ ticketKeys: orderedKeys });
    }

    const unresolved = [];
    orderedKeys.forEach(ticketKey => {
        if (hasFreshCachedSnapshot(ticketKey, ticketStateByKey[ticketKey])) {
            snapshotsByKey[ticketKey] = snapshotCache.get(ticketKey);
        } else {
            snapshotCache.delete(ticketKey);
            notFoundMetaCache.delete(ticketKey);
            unresolved.push(ticketKey);
        }
    });

    let keysRemaining = unresolved.slice();

    if (keysRemaining.length > 0 && repos.length > 0) {
        if (rateLimitState.rest.blocked) {
            keysRemaining.forEach(ticketKey => pendingKeys.add(ticketKey));
            sourceMeta.fallbackPaused = true;
        } else {
            try {
                const repoSnapshots = await resolveSnapshotsFromRepos(keysRemaining, token, repos, {
                    repoConcurrency,
                    closedWindowDays,
                });
                Object.entries(repoSnapshots).forEach(([ticketKey, snapshot]) => {
                    snapshotsByKey[ticketKey] = snapshot;
                    snapshotCache.set(ticketKey, snapshot);
                });
                await persistSnapshots(repoSnapshots, ticketStateByKey);

                keysRemaining = keysRemaining.filter(ticketKey => !Object.prototype.hasOwnProperty.call(repoSnapshots, ticketKey));
                lastSuccessfulSyncAt = Date.now();
                resetBucket('rest');

                if (!allowGlobalFallback && keysRemaining.length > 0) {
                    const notFoundSnapshots = {};
                    keysRemaining.forEach(ticketKey => {
                        snapshotsByKey[ticketKey] = null;
                        snapshotCache.set(ticketKey, null);
                        notFoundSnapshots[ticketKey] = null;
                        notFoundKeys.add(ticketKey);
                    });
                    await persistSnapshots(notFoundSnapshots, ticketStateByKey);
                    keysRemaining = [];
                }
            } catch (error) {
                if (isGithubBlocker(error)) {
                    await blockBucket('rest', error, keysRemaining);
                    keysRemaining.forEach(ticketKey => pendingKeys.add(ticketKey));
                    sourceMeta.fallbackPaused = true;
                } else {
                    throw error;
                }
            }
        }
    }

    const shouldUseFallback = allowGlobalFallback || repos.length === 0;
    if (keysRemaining.length > 0) {
        if (!shouldUseFallback) {
            keysRemaining.forEach(ticketKey => pendingKeys.add(ticketKey));
        } else if (rateLimitState.search.blocked) {
            keysRemaining.forEach(ticketKey => pendingKeys.add(ticketKey));
            sourceMeta.fallbackPaused = true;
        } else {
            sourceMeta.usedFallback = true;
            const fallbackOrder = uniqueTicketKeys([...visibleTicketKeys, ...keysRemaining]);
            const budget = await getSearchRateLimitBudget(token).catch(async error => {
                if (isGithubBlocker(error)) {
                    await blockBucket('search', error, fallbackOrder);
                    return null;
                }
                throw error;
            });

            if (!budget) {
                fallbackOrder.forEach(ticketKey => pendingKeys.add(ticketKey));
                sourceMeta.fallbackPaused = true;
            } else {
                const fallbackResults = await resolveSnapshotsFromSearch(fallbackOrder, token, budget).catch(async error => {
                    if (isGithubBlocker(error)) {
                        await blockBucket('search', error, fallbackOrder);
                        return null;
                    }
                    throw error;
                });

                if (!fallbackResults) {
                    fallbackOrder.forEach(ticketKey => pendingKeys.add(ticketKey));
                    sourceMeta.fallbackPaused = true;
                } else {
                    const persistedSnapshots = {};
                    Object.entries(fallbackResults.snapshotsByKey).forEach(([ticketKey, snapshot]) => {
                        snapshotsByKey[ticketKey] = snapshot;
                        snapshotCache.set(ticketKey, snapshot);
                        persistedSnapshots[ticketKey] = snapshot;
                        if (snapshot == null) notFoundKeys.add(ticketKey);
                    });
                    await persistSnapshots(persistedSnapshots, ticketStateByKey);
                    lastSuccessfulSyncAt = Date.now();

                    if (fallbackResults.pendingKeys.length > 0) {
                        await pauseBucket('search', 'Paused: holding GitHub search budget', fallbackResults.pendingKeys);
                        fallbackResults.pendingKeys.forEach(ticketKey => pendingKeys.add(ticketKey));
                        sourceMeta.fallbackPaused = true;
                    } else {
                        resetBucket('search');
                    }
                }
            }
        }
    }

    syncPendingKeys(pendingKeys);
    await notifyAvailabilityListeners();

    return {
        snapshotsByKey,
        pendingKeys: Array.from(pendingKeys),
        notFoundKeys: Array.from(notFoundKeys),
        sourceMeta,
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
        ticketStateByKey: options.ticketStateByKey || {},
    });
    return result.snapshotsByKey;
}

export async function getPrSnapshot(ticketKey, token, options = {}) {
    const normalizedTicketKey = normalizeTicketKey(ticketKey);
    if (!normalizedTicketKey) return null;

    const normalizedTicketStateByKey = normalizeTicketStateMap(
        options.ticketStateByKey || { [normalizedTicketKey]: options.ticketState || {} },
        [normalizedTicketKey],
    );

    const singleRequestKey = JSON.stringify({
        ticketKey: normalizedTicketKey,
        token,
        repos: uniqueRepos(options.repos || []),
        ticketStateByKey: normalizedTicketStateByKey,
        forceRefresh: options.forceRefresh === true,
        allowGlobalFallback: options.allowGlobalFallback !== false,
        repoConcurrency: options.repoConcurrency ?? DEFAULT_OPTIONS.repoConcurrency,
        closedWindowDays: options.closedWindowDays ?? DEFAULT_OPTIONS.closedWindowDays,
    });

    if (pendingSingleRequests.has(singleRequestKey)) {
        return pendingSingleRequests.get(singleRequestKey);
    }

    const request = resolveGithubPrBatch({
        ticketKeys: [normalizedTicketKey],
        token,
        repos: options.repos || [],
        forceRefresh: options.forceRefresh === true,
        visibleTicketKeys: [normalizedTicketKey],
        allowGlobalFallback: options.allowGlobalFallback !== false,
        repoConcurrency: options.repoConcurrency,
        closedWindowDays: options.closedWindowDays,
        ticketStateByKey: normalizedTicketStateByKey,
    }).then(result => (
        Object.prototype.hasOwnProperty.call(result.snapshotsByKey, normalizedTicketKey)
            ? result.snapshotsByKey[normalizedTicketKey]
            : null
    )).finally(() => pendingSingleRequests.delete(singleRequestKey));

    pendingSingleRequests.set(singleRequestKey, request);
    return request;
}

async function resolveSnapshotsFromRepos(ticketKeys, token, repos, options) {
    const requestedKeys = ticketKeys.map(ticketKey => String(ticketKey).toLowerCase());
    const snapshotsByKey = {};

    await runWithConcurrency(repos, options.repoConcurrency, async repo => {
        const pulls = await fetchRecentPullsForRepo(repo, token, options.closedWindowDays);
        pulls.forEach(pull => {
            const matchedKey = findMatchingTicketKey(pull, ticketKeys, requestedKeys);
            if (!matchedKey) return;

            const normalized = normalizePullSnapshot(pull, repo, null, matchedKey);
            const existing = snapshotsByKey[matchedKey];
            if (!existing || new Date(normalized.updatedAt || 0) > new Date(existing.updatedAt || 0)) {
                snapshotsByKey[matchedKey] = normalized;
            }
        });
    });

    return snapshotsByKey;
}

async function fetchRecentPullsForRepo(repo, token, closedWindowDays) {
    const pulls = [];
    const cutoff = Date.now() - (closedWindowDays * 24 * 60 * 60 * 1000);

    const openPulls = await fetchPullPage(repo, 'open', token, 1);
    pulls.push(...openPulls);
    if (openPulls.length === 100) {
        pulls.push(...await fetchPullPage(repo, 'open', token, 2));
    }

    for (let page = 1; page <= 2; page += 1) {
        const closedPulls = await fetchPullPage(repo, 'closed', token, page);
        if (closedPulls.length === 0) break;

        const recentPulls = closedPulls.filter(pull => new Date(pull.updated_at || 0).getTime() >= cutoff);
        pulls.push(...recentPulls);
        if (recentPulls.length !== closedPulls.length || closedPulls.length < 100) break;
    }

    return pulls;
}

async function fetchPullPage(repo, state, token, page) {
    return githubFetch(`/repos/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`, token);
}

async function getSearchRateLimitBudget(token) {
    const data = await githubFetch('/rate_limit', token);
    return createSearchBudget({
        searchRemaining: Number(data?.resources?.search?.remaining) || 0,
        coreRemaining: Number(data?.resources?.core?.remaining) || 0,
    });
}

function createSearchBudget({ searchRemaining = 0, coreRemaining = 0 } = {}) {
    return {
        searchBudget: Math.max(0, (Number(searchRemaining) || 0) - SEARCH_RESERVE_REQUESTS),
        coreBudget: Math.max(0, (Number(coreRemaining) || 0) - CORE_RESERVE_REQUESTS),
    };
}

function canStartBudgetedLookup(budget) {
    return budget.searchBudget >= SEARCH_REQUESTS_PER_LOOKUP && budget.coreBudget >= CORE_REQUESTS_PER_LOOKUP;
}

function consumeBudget(budget, bucketName, amount = 1) {
    if (!budget || amount <= 0) return true;
    if (bucketName === 'search') {
        if (budget.searchBudget < amount) return false;
        budget.searchBudget -= amount;
        return true;
    }
    if (bucketName === 'core') {
        if (budget.coreBudget < amount) return false;
        budget.coreBudget -= amount;
        return true;
    }
    return false;
}

async function resolveSnapshotsFromSearch(ticketKeys, token, budget) {
    const snapshotsByKey = {};
    const pendingKeys = [];

    for (let index = 0; index < ticketKeys.length; index += 1) {
        const ticketKey = ticketKeys[index];
        if (!canStartBudgetedLookup(budget)) {
            pendingKeys.push(...ticketKeys.slice(index));
            break;
        }

        const result = await fetchPrSnapshotBySearch(ticketKey, token, budget);
        if (result.status === 'pending') {
            pendingKeys.push(...ticketKeys.slice(index));
            break;
        }

        snapshotsByKey[ticketKey] = result.snapshot;
    }

    return { snapshotsByKey, pendingKeys };
}

async function fetchPrSnapshotBySearch(ticketKey, token, budget) {
    const searchQueries = [
        `"${ticketKey}" type:pr`,
        `${ticketKey} type:pr`,
    ];

    for (const query of searchQueries) {
        if (!consumeBudget(budget, 'search')) {
            return { status: 'pending', snapshot: null };
        }

        const data = await githubFetch(
            `/search/issues?q=${encodeURIComponent(query)}&per_page=10&sort=updated&order=desc`,
            token,
        );

        const items = Array.isArray(data.items) ? data.items : [];
        const candidate = items.find(item => item.pull_request?.url && prMatchesTicket({}, item, ticketKey));
        if (!candidate) continue;

        if (!consumeBudget(budget, 'core')) {
            return { status: 'pending', snapshot: null };
        }

        const detail = await githubFetch(candidate.pull_request.url, token).catch(error => {
            if (isGithubBlocker(error)) throw error;
            return null;
        });
        if (!detail) continue;
        if (!prMatchesTicket(detail, candidate, ticketKey)) continue;

        return {
            status: 'resolved',
            snapshot: normalizePullSnapshot(
                detail,
                detail.base?.repo?.full_name || null,
                candidate,
                normalizeTicketKey(ticketKey),
            ),
        };
    }

    return { status: 'resolved', snapshot: null };
}

function normalizePullSnapshot(pull, repoName = null, searchItem = null, ticketKey = null) {
    return {
        ticketKey: ticketKey ? normalizeTicketKey(ticketKey) : null,
        url: pull.html_url || searchItem?.html_url || '',
        apiUrl: pull.url || searchItem?.pull_request?.url || '',
        state: pull.merged_at ? 'merged' : (pull.state || 'open'),
        draft: pull.draft === true,
        mergedAt: pull.merged_at || null,
        updatedAt: pull.updated_at || searchItem?.updated_at || null,
        requestedReviewers: (pull.requested_reviewers || []).map(reviewer => reviewer.login).filter(Boolean),
        lastReviewState: null,
        lastReviewAt: null,
        labels: (pull.labels || searchItem?.labels || []).map(label => label.name).filter(Boolean),
        repo: pull.base?.repo?.full_name || repoName || null,
        branch: pull.head?.ref || null,
        fetchedAt: Date.now(),
    };
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ticketKeyMatcher(ticketKey) {
    const normalized = String(ticketKey || '').trim().toLowerCase();
    if (!normalized) return null;
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(normalized)}(?=$|[^a-z0-9])`);
}

function pullTextCandidates(pull = {}, searchItem = null) {
    return [
        pull.title,
        pull.body,
        pull.head?.ref,
        pull.base?.ref,
        searchItem?.title,
        searchItem?.body,
    ].filter(Boolean);
}

function prMatchesTicket(pull, searchItem, ticketKey) {
    const matcher = ticketKeyMatcher(ticketKey);
    if (!matcher) return false;

    return pullTextCandidates(pull, searchItem)
        .some(candidate => matcher.test(String(candidate).toLowerCase()));
}

function findMatchingTicketKey(pull, ticketKeys, requestedKeys) {
    const candidates = pullTextCandidates(pull);

    for (const candidate of candidates) {
        const normalizedCandidate = String(candidate).toLowerCase();
        for (let index = 0; index < ticketKeys.length; index += 1) {
            const ticketKey = ticketKeys[index];
            const requestedKey = requestedKeys[index];
            if (!requestedKey) continue;

            const matcher = ticketKeyMatcher(requestedKey);
            if (matcher?.test(normalizedCandidate)) {
                return normalizeTicketKey(ticketKey);
            }
        }
    }

    return null;
}

function isGithubBlocker(error) {
    return [401, 403, 429].includes(Number(error?.status));
}

async function blockBucket(bucketName, error, ticketKeys = []) {
    const bucket = rateLimitState[bucketName];
    if (!bucket) return;

    const retryAfterMs = resolveRetryAfterMs(error, bucket.retryCount + 1);
    bucket.blocked = true;
    bucket.paused = false;
    bucket.reason = formatGithubBlockReason(bucketName, error);
    bucket.retryAt = retryAfterMs ? Date.now() + retryAfterMs : null;
    bucket.retryCount += 1;
    bucket.pendingKeys = new Set(ticketKeys.map(ticketKey => normalizeTicketKey(ticketKey)).filter(Boolean));

    if (bucket.retryAt) {
        scheduleRecovery(bucketName, bucket.retryAt);
    } else {
        clearRecoveryTimer(bucketName);
    }

    await notifyAvailabilityListeners();
}

async function pauseBucket(bucketName, reason, ticketKeys = []) {
    const bucket = rateLimitState[bucketName];
    if (!bucket || bucket.blocked) return;

    bucket.paused = true;
    bucket.reason = reason || 'Paused: holding GitHub rate limit budget';
    bucket.retryAt = null;
    bucket.pendingKeys = new Set(ticketKeys.map(ticketKey => normalizeTicketKey(ticketKey)).filter(Boolean));

    await notifyAvailabilityListeners();
}

function clearPreventivePauses() {
    Object.values(rateLimitState).forEach(bucket => {
        if (!bucket.paused || bucket.blocked) return;
        bucket.paused = false;
        bucket.reason = '';
        bucket.pendingKeys.clear();
    });
}

function formatGithubBlockReason(bucketName, error) {
    if (Number(error?.status) === 401) return 'Blocked: invalid GitHub token';
    if (bucketName === 'rest') return 'Blocked: GitHub repo sync rate limit reached';
    return 'Blocked: GitHub search rate limit reached';
}

function resolveRetryAfterMs(error, retryCount) {
    const retryAfterHeader = Number(error?.headers?.retryAfter || 0);
    if (retryAfterHeader > 0) return retryAfterHeader * 1000;

    const resetHeader = Number(error?.headers?.reset || 0);
    if (resetHeader > 0) {
        const retryAt = resetHeader * 1000;
        return Math.max(1000, retryAt - Date.now());
    }

    if (Number(error?.status) === 401) return null;
    return Math.min(5 * 60 * 1000, Math.max(30 * 1000, retryCount * 30 * 1000));
}

function scheduleRecovery(bucketName, retryAt) {
    clearRecoveryTimer(bucketName);
    const delay = Math.max(0, retryAt - Date.now());

    recoveryTimers.set(bucketName, setTimeout(async () => {
        resetBucket(bucketName);
        await notifyAvailabilityListeners();
    }, delay));
}

function clearRecoveryTimer(bucketName) {
    const timer = recoveryTimers.get(bucketName);
    if (timer) {
        clearTimeout(timer);
        recoveryTimers.delete(bucketName);
    }
}

function resetBucket(bucketName) {
    const bucket = rateLimitState[bucketName];
    if (!bucket) return;
    bucket.blocked = false;
    bucket.paused = false;
    bucket.reason = '';
    bucket.retryAt = null;
    bucket.pendingKeys.clear();
    bucket.retryCount = 0;
}

function serializeBucketState(bucket) {
    return {
        bucket: bucket.bucket,
        blocked: bucket.blocked,
        paused: bucket.paused,
        reason: bucket.reason,
        retryAt: bucket.retryAt || null,
        pendingKeys: Array.from(bucket.pendingKeys),
        retryCount: bucket.retryCount,
    };
}

function syncPendingKeys(pendingKeys) {
    Object.values(rateLimitState).forEach(bucket => {
        if (!bucket.blocked && !bucket.paused) {
            bucket.pendingKeys.clear();
            return;
        }

        bucket.pendingKeys = new Set(
            Array.from(new Set([...bucket.pendingKeys, ...pendingKeys]))
                .map(ticketKey => normalizeTicketKey(ticketKey))
                .filter(Boolean),
        );
    });
}

function normalizeNotFoundMeta(rawValue) {
    const fetchedAt = Number(rawValue?.fetchedAt ?? rawValue) || 0;
    if (!fetchedAt) return null;
    return {
        fetchedAt,
        isDone: rawValue?.isDone === true,
    };
}

function hasFreshCachedSnapshot(ticketKey, ticketState = null) {
    if (!snapshotCache.has(ticketKey)) return false;

    const snapshot = snapshotCache.get(ticketKey);
    if (snapshot !== null) return true;

    const notFoundMeta = notFoundMetaCache.get(ticketKey);
    if (!notFoundMeta?.fetchedAt) return false;

    const ttlMs = resolveNotFoundTtlMs(ticketState, notFoundMeta);
    return (Date.now() - notFoundMeta.fetchedAt) < ttlMs;
}

function resolveNotFoundTtlMs(ticketState = null, cachedMeta = null) {
    const isDone = resolveTicketDoneState(ticketState) ?? cachedMeta?.isDone === true;
    return isDone ? DONE_NOT_FOUND_CACHE_TTL_MS : ACTIVE_NOT_FOUND_CACHE_TTL_MS;
}

function normalizeTicketStateMap(ticketStateByKey = {}, ticketKeys = []) {
    return ticketKeys.reduce((acc, ticketKey) => {
        acc[ticketKey] = normalizeTicketState(ticketStateByKey[ticketKey]);
        return acc;
    }, {});
}

function normalizeTicketState(ticketState = {}) {
    if (ticketState == null || typeof ticketState !== 'object') {
        return { isDone: false };
    }

    return {
        isDone: resolveTicketDoneState(ticketState) === true,
    };
}

function resolveTicketDoneState(ticketState = null) {
    if (ticketState == null) return null;
    if (typeof ticketState === 'boolean') return ticketState;
    if (ticketState.isDone === true) return true;
    if (ticketState.isDone === false) return false;
    return null;
}

function uniqueTicketKeys(ticketKeys = []) {
    return Array.from(new Set(
        ticketKeys
            .map(ticketKey => normalizeTicketKey(ticketKey))
            .filter(Boolean),
    ));
}

function uniqueRepos(repos = []) {
    return Array.from(new Set(
        repos
            .map(repo => String(repo || '').trim())
            .filter(Boolean),
    ));
}

async function runWithConcurrency(items, concurrency, worker) {
    const queue = items.slice();
    const maxWorkers = Math.max(1, Number(concurrency) || 1);

    await Promise.all(
        Array.from({ length: Math.min(maxWorkers, queue.length) }, async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                await worker(item);
            }
        }),
    );
}

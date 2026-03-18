import { githubFetch } from './jiraApi.js';

const snapshotCache = new Map();
const availabilityListeners = new Set();
const recoveryTimers = new Map();

const DEFAULT_OPTIONS = {
    repoConcurrency: 1,
    closedWindowDays: 14,
    searchLimit: 5,
    allowGlobalFallback: false,
};

const rateLimitState = {
    rest: createBucketState('rest'),
    search: createBucketState('search'),
};

let lastSuccessfulSyncAt = 0;

function createBucketState(bucket) {
    return {
        bucket,
        blocked: false,
        reason: '',
        retryAt: null,
        pendingKeys: new Set(),
        retryCount: 0,
    };
}

export function clearPrSnapshotCache(scope = {}) {
    const keys = Array.isArray(scope.ticketKeys) ? scope.ticketKeys.filter(Boolean) : null;

    if (keys && keys.length > 0) {
        Array.from(snapshotCache.keys()).forEach(cacheKey => {
            if (keys.some(key => cacheKey.endsWith(`:${key}`))) snapshotCache.delete(cacheKey);
        });
        Object.values(rateLimitState).forEach(bucket => {
            keys.forEach(key => bucket.pendingKeys.delete(key));
        });
    } else {
        snapshotCache.clear();
        Object.values(rateLimitState).forEach(bucket => {
            bucket.pendingKeys.clear();
        });
    }

    Object.keys(rateLimitState).forEach(bucketName => resetBucket(bucketName));
    notifyAvailabilityListeners();
}

export function getGithubAvailabilityState() {
    const blockedBuckets = Object.values(rateLimitState).filter(bucket => bucket.blocked);
    const activeBlock = blockedBuckets
        .slice()
        .sort((left, right) => Number(left.retryAt || Infinity) - Number(right.retryAt || Infinity))[0] || null;

    return {
        blocked: blockedBuckets.length > 0,
        reason: activeBlock?.reason || '',
        status: blockedBuckets.length > 0 ? 'blocked' : 'available',
        retryAt: activeBlock?.retryAt || null,
        retryInMs: activeBlock?.retryAt ? Math.max(0, activeBlock.retryAt - Date.now()) : null,
        bucket: activeBlock?.bucket || null,
        pendingKeys: Array.from(new Set(blockedBuckets.flatMap(bucket => Array.from(bucket.pendingKeys)))),
        lastSuccessfulSyncAt: lastSuccessfulSyncAt || null,
        buckets: {
            rest: serializeBucketState(rateLimitState.rest),
            search: serializeBucketState(rateLimitState.search),
        },
    };
}

export function subscribeGithubAvailability(listener) {
    if (typeof listener !== 'function') return () => {};
    availabilityListeners.add(listener);
    return () => availabilityListeners.delete(listener);
}

export async function resolveGithubPrBatch({
    ticketKeys = [],
    token,
    repos = [],
    forceRefresh = false,
    visibleTicketKeys = [],
    allowGlobalFallback = false,
    repoConcurrency = DEFAULT_OPTIONS.repoConcurrency,
    closedWindowDays = DEFAULT_OPTIONS.closedWindowDays,
    searchLimit = DEFAULT_OPTIONS.searchLimit,
} = {}) {
    const normalizedKeys = uniqueTicketKeys(ticketKeys);
    const orderedKeys = uniqueTicketKeys([...visibleTicketKeys, ...normalizedKeys]);
    const normalizedRepos = uniqueRepos(repos);
    const snapshotsByKey = {};
    const pendingKeys = new Set();
    const notFoundKeys = new Set();
    const sourceMeta = {
        usedRepoIndex: normalizedRepos.length > 0,
        usedFallback: false,
        fallbackPaused: false,
        repoCount: normalizedRepos.length,
    };

    if (!token || orderedKeys.length === 0) {
        return { snapshotsByKey, pendingKeys: [], notFoundKeys: [], sourceMeta };
    }

    if (forceRefresh) {
        clearPrSnapshotCache({ ticketKeys: orderedKeys });
    }

    const unresolved = [];
    orderedKeys.forEach(ticketKey => {
        const cacheKey = buildCacheKey(ticketKey, token);
        if (snapshotCache.has(cacheKey)) {
            snapshotsByKey[ticketKey] = snapshotCache.get(cacheKey);
        } else {
            unresolved.push(ticketKey);
        }
    });

    let keysRemaining = unresolved.slice();

    if (keysRemaining.length > 0 && normalizedRepos.length > 0) {
        if (rateLimitState.rest.blocked) {
            keysRemaining.forEach(key => pendingKeys.add(key));
            sourceMeta.fallbackPaused = true;
        } else {
            try {
                const repoSnapshots = await resolveSnapshotsFromRepos(keysRemaining, token, normalizedRepos, {
                    repoConcurrency,
                    closedWindowDays,
                });
                Object.entries(repoSnapshots).forEach(([ticketKey, snapshot]) => {
                    snapshotsByKey[ticketKey] = snapshot;
                    snapshotCache.set(buildCacheKey(ticketKey, token), snapshot);
                });
                keysRemaining = keysRemaining.filter(ticketKey => !repoSnapshots[ticketKey]);
                lastSuccessfulSyncAt = Date.now();
                resetBucket('rest');

                if (!allowGlobalFallback && keysRemaining.length > 0) {
                    keysRemaining.forEach(ticketKey => {
                        snapshotsByKey[ticketKey] = null;
                        snapshotCache.set(buildCacheKey(ticketKey, token), null);
                        notFoundKeys.add(ticketKey);
                    });
                    keysRemaining = [];
                }
            } catch (error) {
                if (isGithubBlocker(error)) {
                    blockBucket('rest', error, keysRemaining);
                    keysRemaining.forEach(key => pendingKeys.add(key));
                    sourceMeta.fallbackPaused = true;
                } else {
                    throw error;
                }
            }
        }
    }

    const shouldUseFallback = allowGlobalFallback || normalizedRepos.length === 0;
    if (keysRemaining.length > 0) {
        if (!shouldUseFallback) {
            keysRemaining.forEach(key => pendingKeys.add(key));
        } else if (rateLimitState.search.blocked) {
            keysRemaining.forEach(key => pendingKeys.add(key));
            sourceMeta.fallbackPaused = true;
        } else {
            sourceMeta.usedFallback = true;
            const fallbackOrder = uniqueTicketKeys([...visibleTicketKeys, ...keysRemaining]).slice(0, Math.max(1, searchLimit));
            const fallbackSet = new Set(fallbackOrder);
            const fallbackResults = await resolveSnapshotsFromSearch(fallbackOrder, token).catch(error => {
                if (isGithubBlocker(error)) {
                    blockBucket('search', error, fallbackOrder);
                    return null;
                }
                throw error;
            });

            if (!fallbackResults) {
                fallbackOrder.forEach(key => pendingKeys.add(key));
            } else {
                fallbackOrder.forEach(ticketKey => {
                    if (fallbackResults[ticketKey]) {
                        snapshotsByKey[ticketKey] = fallbackResults[ticketKey];
                        snapshotCache.set(buildCacheKey(ticketKey, token), fallbackResults[ticketKey]);
                    } else {
                        snapshotsByKey[ticketKey] = null;
                        snapshotCache.set(buildCacheKey(ticketKey, token), null);
                        notFoundKeys.add(ticketKey);
                    }
                });
                lastSuccessfulSyncAt = Date.now();
                resetBucket('search');
            }

            keysRemaining
                .filter(ticketKey => !fallbackSet.has(ticketKey))
                .forEach(ticketKey => pendingKeys.add(ticketKey));
        }
    }

    syncPendingKeys(pendingKeys);
    notifyAvailabilityListeners();

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
    return Object.prototype.hasOwnProperty.call(result.snapshotsByKey, ticketKey)
        ? result.snapshotsByKey[ticketKey]
        : null;
}

async function resolveSnapshotsFromRepos(ticketKeys, token, repos, options) {
    const requestedKeys = ticketKeys.map(key => String(key).toLowerCase());
    const snapshotsByKey = {};

    await runWithConcurrency(repos, options.repoConcurrency, async repo => {
        const pulls = await fetchRecentPullsForRepo(repo, token, options.closedWindowDays);
        pulls.forEach(pull => {
            const matchedKey = findMatchingTicketKey(pull, ticketKeys, requestedKeys);
            if (!matchedKey) return;

            const normalized = normalizePullSnapshot(pull, repo);
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

async function resolveSnapshotsFromSearch(ticketKeys, token) {
    const snapshotsByKey = {};

    for (const ticketKey of ticketKeys) {
        snapshotsByKey[ticketKey] = await fetchPrSnapshotBySearch(ticketKey, token);
    }

    return snapshotsByKey;
}

async function fetchPrSnapshotBySearch(ticketKey, token) {
    const data = await githubFetch(
        `/search/issues?q=${encodeURIComponent(`${ticketKey} type:pr`)}&per_page=10&sort=updated&order=desc`,
        token,
    );

    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items.slice(0, 4)) {
        if (!item.pull_request?.url) continue;

        const detail = await githubFetch(item.pull_request.url, token).catch(error => {
            if (isGithubBlocker(error)) throw error;
            return null;
        });
        if (!detail) continue;
        if (!prMatchesTicket(detail, item, ticketKey)) continue;

        return normalizePullSnapshot(detail, detail.base?.repo?.full_name || null, item);
    }

    return null;
}

function normalizePullSnapshot(pull, repoName = null, searchItem = null) {
    return {
        ticketKey: null,
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
    };
}

function findMatchingTicketKey(pull, ticketKeys, lowerTicketKeys) {
    const text = [pull.title, pull.body, pull.head?.ref].map(value => String(value || '').toLowerCase()).join('\n');
    for (let index = 0; index < lowerTicketKeys.length; index += 1) {
        if (text.includes(lowerTicketKeys[index])) return ticketKeys[index];
    }
    return null;
}

function prMatchesTicket(detail, searchItem, ticketKey) {
    const search = String(ticketKey || '').toLowerCase();
    return [
        detail?.title,
        detail?.body,
        detail?.head?.ref,
        searchItem?.title,
        searchItem?.body,
    ].some(value => String(value || '').toLowerCase().includes(search));
}

function isGithubBlocker(error) {
    const status = Number(error?.status);
    return status === 401 || status === 403;
}

function isRateLimitError(error) {
    const body = String(error?.responseText || '').toLowerCase();
    return body.includes('rate limit') || Number(error?.headers?.remaining) === 0;
}

function blockBucket(bucketName, error, pendingKeys = []) {
    const bucket = rateLimitState[bucketName];
    bucket.blocked = true;
    bucket.reason = describeGithubBlocker(error, bucketName);
    bucket.pendingKeys = new Set(pendingKeys);
    bucket.retryCount = isRateLimitError(error) ? (bucket.retryCount + 1) : 0;
    bucket.retryAt = resolveGithubRetryAt(error, bucket.retryCount);
    scheduleBucketRecovery(bucketName, bucket.retryAt);
}

function resetBucket(bucketName) {
    const bucket = rateLimitState[bucketName];
    bucket.blocked = false;
    bucket.reason = '';
    bucket.retryAt = null;
    bucket.retryCount = 0;
    bucket.pendingKeys.clear();

    if (recoveryTimers.has(bucketName)) {
        clearTimeout(recoveryTimers.get(bucketName));
        recoveryTimers.delete(bucketName);
    }
}

function resolveGithubRetryAt(error, retryCount = 0) {
    if (!isRateLimitError(error)) return null;

    if (isRateLimitError(error)) {
        const retryAfterSeconds = Number(error?.headers?.retryAfter || 0);
        if (retryAfterSeconds > 0) return Date.now() + (retryAfterSeconds * 1000);

        const resetEpochSeconds = Number(error?.headers?.reset || 0);
        if (resetEpochSeconds > 0) return resetEpochSeconds * 1000;
    }

    const backoffMinutes = retryCount <= 1 ? 2 : retryCount === 2 ? 5 : 15;
    const jitterMs = Math.floor(Math.random() * 15000);
    return Date.now() + (backoffMinutes * 60 * 1000) + jitterMs;
}

function describeGithubBlocker(error, bucketName) {
    const body = String(error?.responseText || '').toLowerCase();
    if (body.includes('rate limit')) return `Blocked: GitHub ${bucketName} rate limit reached`;
    if (body.includes('resource not accessible') || body.includes('forbidden')) {
        return 'Blocked: GitHub PAT missing repo access or SSO authorization';
    }
    if (Number(error?.status) === 401) return 'Blocked: invalid GitHub token';
    return 'Blocked: GitHub denied API access';
}

function scheduleBucketRecovery(bucketName, retryAt) {
    if (recoveryTimers.has(bucketName)) {
        clearTimeout(recoveryTimers.get(bucketName));
        recoveryTimers.delete(bucketName);
    }

    if (!retryAt) return;

    const delayMs = Math.max(0, retryAt - Date.now());
    const timer = setTimeout(() => {
        recoveryTimers.delete(bucketName);
        resetBucket(bucketName);
        notifyAvailabilityListeners();
    }, delayMs);
    recoveryTimers.set(bucketName, timer);
}

function syncPendingKeys(pendingKeys) {
    const mergedPending = new Set(pendingKeys);
    Object.values(rateLimitState).forEach(bucket => {
        bucket.pendingKeys = new Set(Array.from(bucket.pendingKeys).filter(key => mergedPending.has(key)));
    });
}

function serializeBucketState(bucket) {
    return {
        blocked: bucket.blocked,
        reason: bucket.reason,
        retryAt: bucket.retryAt,
        retryInMs: bucket.retryAt ? Math.max(0, bucket.retryAt - Date.now()) : null,
        pendingKeys: Array.from(bucket.pendingKeys),
    };
}

function notifyAvailabilityListeners() {
    const snapshot = getGithubAvailabilityState();
    availabilityListeners.forEach(listener => {
        try {
            listener(snapshot);
        } catch {
            // ignore listener errors
        }
    });
}

function buildCacheKey(ticketKey, token) {
    return `${token}:${ticketKey}`;
}

function uniqueTicketKeys(ticketKeys = []) {
    return Array.from(new Set(ticketKeys.filter(Boolean)));
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
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
        while (queue.length > 0) {
            const next = queue.shift();
            if (!next) return;
            await worker(next);
        }
    });
    await Promise.all(workers);
}

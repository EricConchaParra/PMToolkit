import { githubFetch } from './jiraApi.js';

const snapshotCache = new Map();
const pendingSnapshots = new Map();
let queueTail = Promise.resolve();

const githubAvailability = {
    blocked: false,
    reason: '',
    status: 'available',
};

const DEFAULT_OPTIONS = {
    staggerMs: 350,
    maxCandidates: 4,
};

export function clearPrSnapshotCache(scope = {}) {
    const keys = Array.isArray(scope.ticketKeys) ? scope.ticketKeys.filter(Boolean) : null;

    if (keys && keys.length > 0) {
        keys.forEach(key => {
            snapshotCache.delete(key);
            pendingSnapshots.delete(key);
        });
    } else {
        snapshotCache.clear();
        pendingSnapshots.clear();
    }

    githubAvailability.blocked = false;
    githubAvailability.reason = '';
    githubAvailability.status = 'available';
    queueTail = Promise.resolve();
}

export function getGithubAvailabilityState() {
    return { ...githubAvailability };
}

export async function getPrSnapshots(ticketKeys, token, options = {}) {
    const snapshots = {};
    if (!token) return snapshots;

    for (const ticketKey of ticketKeys) {
        if (!ticketKey || githubAvailability.blocked) break;
        snapshots[ticketKey] = await getPrSnapshot(ticketKey, token, options);
    }

    return snapshots;
}

export async function getPrSnapshot(ticketKey, token, options = {}) {
    if (!ticketKey || !token) return null;
    if (githubAvailability.blocked) return null;
    if (snapshotCache.has(ticketKey)) return snapshotCache.get(ticketKey);
    if (pendingSnapshots.has(ticketKey)) return pendingSnapshots.get(ticketKey);

    const settings = { ...DEFAULT_OPTIONS, ...options };
    const request = scheduleSnapshotFetch(ticketKey, token, settings).then(snapshot => {
        snapshotCache.set(ticketKey, snapshot);
        pendingSnapshots.delete(ticketKey);
        return snapshot;
    }).catch(error => {
        if (isGithubBlocker(error)) {
            githubAvailability.blocked = true;
            githubAvailability.reason = describeGithubBlocker(error);
            githubAvailability.status = 'blocked';
        }
        snapshotCache.set(ticketKey, null);
        pendingSnapshots.delete(ticketKey);
        return null;
    });

    pendingSnapshots.set(ticketKey, request);
    return request;
}

function scheduleSnapshotFetch(ticketKey, token, options) {
    const run = queueTail.catch(() => {}).then(async () => {
        if (githubAvailability.blocked) return null;
        const snapshot = await fetchPrSnapshot(ticketKey, token, options);
        await sleep(options.staggerMs);
        return snapshot;
    });
    queueTail = run.catch(() => {});
    return run;
}

async function fetchPrSnapshot(ticketKey, token, options) {
    const data = await githubFetch(
        `/search/issues?q=${encodeURIComponent(`${ticketKey} type:pr`)}&per_page=10&sort=updated&order=desc`,
        token,
    );

    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items.slice(0, options.maxCandidates)) {
        if (!item.pull_request?.url) continue;

        const detail = await githubFetch(item.pull_request.url, token).catch(() => null);
        if (!detail) continue;
        if (!prMatchesTicket(detail, item, ticketKey)) continue;

        const reviews = await githubFetch(`${detail.url}/reviews?per_page=20`, token).catch(() => []);
        const lastReview = pickLastReview(Array.isArray(reviews) ? reviews : []);

        return {
            ticketKey,
            url: detail.html_url || item.html_url,
            apiUrl: detail.url,
            state: detail.merged_at ? 'merged' : (detail.state || 'open'),
            draft: detail.draft === true,
            mergedAt: detail.merged_at || null,
            updatedAt: detail.updated_at || item.updated_at || null,
            requestedReviewers: (detail.requested_reviewers || []).map(reviewer => reviewer.login).filter(Boolean),
            lastReviewState: lastReview?.state || null,
            lastReviewAt: lastReview?.submitted_at || null,
            labels: (detail.labels || item.labels || []).map(label => label.name).filter(Boolean),
            repo: detail.base?.repo?.full_name || null,
            branch: detail.head?.ref || null,
        };
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

function pickLastReview(reviews = []) {
    const normalized = reviews
        .filter(review => review?.state && review.state !== 'PENDING')
        .sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0));

    const decisive = normalized.filter(review => review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED');
    return decisive[decisive.length - 1] || normalized[normalized.length - 1] || null;
}

function isGithubBlocker(error) {
    const status = Number(error?.status);
    return status === 401 || status === 403;
}

function describeGithubBlocker(error) {
    const body = String(error?.responseText || '').toLowerCase();
    if (body.includes('rate limit')) return 'Blocked: GitHub rate limit reached';
    if (body.includes('resource not accessible') || body.includes('forbidden')) {
        return 'Blocked: GitHub PAT missing repo access or SSO authorization';
    }
    if (Number(error?.status) === 401) return 'Blocked: invalid GitHub token';
    return 'Blocked: GitHub denied API access';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

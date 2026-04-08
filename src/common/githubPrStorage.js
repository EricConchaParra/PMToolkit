export const GITHUB_PR_SNAPSHOT_PREFIX = 'github_pr_snapshot_';
export const GITHUB_PR_NOT_FOUND_PREFIX = 'github_pr_not_found_';
export const GITHUB_PR_AVAILABILITY_KEY = 'github_pr_availability';

export function normalizeTicketKey(ticketKey) {
    return String(ticketKey || '').trim().toUpperCase();
}

export function makePrSnapshotStorageKey(ticketKey) {
    return `${GITHUB_PR_SNAPSHOT_PREFIX}${normalizeTicketKey(ticketKey)}`;
}

export function getPrSnapshotStorageKeys(ticketKeys = []) {
    return ticketKeys
        .map(ticketKey => normalizeTicketKey(ticketKey))
        .filter(Boolean)
        .map(makePrSnapshotStorageKey);
}

export function makePrNotFoundStorageKey(ticketKey) {
    return `${GITHUB_PR_NOT_FOUND_PREFIX}${normalizeTicketKey(ticketKey)}`;
}

export function getPrNotFoundStorageKeys(ticketKeys = []) {
    return ticketKeys
        .map(ticketKey => normalizeTicketKey(ticketKey))
        .filter(Boolean)
        .map(makePrNotFoundStorageKey);
}

export function isPrSnapshotStorageKey(storageKey) {
    return typeof storageKey === 'string' && storageKey.startsWith(GITHUB_PR_SNAPSHOT_PREFIX);
}

export function isPrNotFoundStorageKey(storageKey) {
    return typeof storageKey === 'string' && storageKey.startsWith(GITHUB_PR_NOT_FOUND_PREFIX);
}

export function extractTicketKeyFromSnapshotStorageKey(storageKey) {
    if (!isPrSnapshotStorageKey(storageKey)) return '';
    return storageKey.slice(GITHUB_PR_SNAPSHOT_PREFIX.length);
}

export function extractTicketKeyFromNotFoundStorageKey(storageKey) {
    if (!isPrNotFoundStorageKey(storageKey)) return '';
    return storageKey.slice(GITHUB_PR_NOT_FOUND_PREFIX.length);
}

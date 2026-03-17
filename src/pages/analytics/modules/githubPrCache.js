/**
 * PMsToolKit — Analytics Hub
 * Unified GitHub PR cache + enrichment
 *
 * – In-flight deduplication: concurrent callers for the same key await one request
 * – Session cache: resolved results live for the page lifetime
 * – Serial queue: requests are staggered 500 ms apart to respect rate limits
 * – enrichChips(container, token): single entry-point for both dashboards
 */

import { findPrForTicket } from './jiraApi.js';

// ============================================================
// MODULE-LEVEL CACHE STATE
// ============================================================

/** @type {Map<string, { url: string, state: string, draft: boolean, labels: string[] } | null>} */
const _cache   = new Map(); // ticketId → PrResult | null (resolved results)
/** @type {Map<string, Promise>} */
const _pending = new Map(); // ticketId → in-flight Promise (deduplication)
let   _queue   = Promise.resolve(); // serial queue tail

const STAGGER_MS = 550; // delay between serial requests

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Clear all cached PR results (call before a fresh dashboard load / Refresh).
 * @param {string[]} [keys] - if provided, clears only those ticket keys
 */
export function clearPrCache(keys) {
    if (!keys) {
        _cache.clear();
        _pending.clear();
    } else {
        keys.forEach(k => { _cache.delete(k); _pending.delete(k); });
    }
}

/**
 * Enriches all `.in-progress-chip[data-gh-key]` chips inside `container`
 * with a GitHub PR button, state badge, and label pills.
 *
 * @param {Element} container
 * @param {string}  token  - GitHub PAT
 */
export async function enrichChips(container, token) {
    if (!container || !token) return;

    const chips = /** @type {NodeListOf<Element>} */ (
        container.querySelectorAll('.in-progress-chip[data-gh-key], .in-review-chip[data-gh-key], .blocked-chip[data-gh-key]')
    );
    if (chips.length === 0) return;

    chips.forEach(chip => {
        const ticketId = chip.dataset.ghKey;
        const actions  = chip.querySelector('.issue-chip-actions');
        if (!actions || !ticketId) return;

        // Skip if already enriched for this ticket in this chip
        if (chip.dataset.ghEnriched === 'true') return;
        chip.dataset.ghEnriched = 'true';

        // Immediately show loading spinner
        const loadingBtn = _makeLoadingBtn();
        actions.appendChild(loadingBtn);

        // Schedule via serial queue
        _queue = _queue.then(async () => {
            const result = await _getOrFetch(ticketId, token);
            loadingBtn.remove();
            if (result) {
                _injectPrButton(actions, result);
            }
            await _sleep(STAGGER_MS);
        });
    });
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

async function _getOrFetch(ticketId, token) {
    // 1. Already have a resolved result?
    if (_cache.has(ticketId)) return _cache.get(ticketId);

    // 2. Already in-flight? Return the same promise (deduplication)
    if (_pending.has(ticketId)) return _pending.get(ticketId);

    // 3. Fire new request
    const p = findPrForTicket(ticketId, token).then(result => {
        _cache.set(ticketId, result);
        _pending.delete(ticketId);
        return result;
    }).catch(() => {
        _cache.set(ticketId, null);
        _pending.delete(ticketId);
        return null;
    });

    _pending.set(ticketId, p);
    return p;
}

function _injectPrButton(actions, result) {
    const { url, state, draft, labels } = result;

    // -- Main PR button --
    const prBtn = document.createElement('a');
    prBtn.href   = url;
    prBtn.target = '_blank';
    prBtn.rel    = 'noopener noreferrer';
    prBtn.className = 'gh-pr-btn gh-pr-found';
    prBtn.title  = `GitHub PR · ${draft ? 'Draft' : state === 'closed' ? 'Merged/Closed' : 'Open'}`;
    prBtn.innerHTML = _ghSvg();
    actions.appendChild(prBtn);

    // -- State badge, inserted after the actions div (into the chip-main area) --
    const chip = actions.closest('.issue-chip');
    if (!chip) return;

    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'gh-pr-meta';

    const stateClass = draft ? 'draft' : state === 'open' ? 'open' : 'closed';
    const stateLabel = draft ? '🟣 Draft' : state === 'open' ? '🟢 Open' : '🔴 Merged';
    badgeWrap.innerHTML = `<span class="gh-pr-state gh-pr-state--${stateClass}">${stateLabel}</span>`;

    if (labels && labels.length > 0) {
        labels.slice(0, 3).forEach(lbl => {
            const pill = document.createElement('span');
            pill.className = 'gh-pr-label';
            pill.textContent = lbl;
            badgeWrap.appendChild(pill);
        });
    }

    // Append after issue-chip-summary (or at end of chip-main)
    const chipMain = chip.querySelector('.issue-chip-main');
    if (chipMain) chipMain.appendChild(badgeWrap);
}

function _makeLoadingBtn() {
    const btn = document.createElement('button');
    btn.className = 'gh-pr-btn gh-pr-loading';
    btn.title     = 'Looking up GitHub PR…';
    btn.innerHTML = _ghSvg();
    return btn;
}

function _ghSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg>`;
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

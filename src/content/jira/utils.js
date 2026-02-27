/**
 * Concurrency queue and formatting utilities for Jira features.
 */

let _etQueue = [];
let _etRunningCount = 0;
const MAX_CONCURRENT = 3;

export function etEnqueue(fn) {
    return new Promise((resolve, reject) => {
        _etQueue.push({ fn, resolve, reject });
        etProcessQueue();
    });
}

async function etProcessQueue() {
    if (_etRunningCount >= MAX_CONCURRENT || _etQueue.length === 0) return;

    const { fn, resolve, reject } = _etQueue.shift();
    _etRunningCount++;

    try {
        const result = await fn();
        resolve(result);
    } catch (e) {
        reject(e);
    } finally {
        _etRunningCount--;
        etProcessQueue();
    }
}

export function formatAge(diffMs) {
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        return diffHrs === 0 ? '<1h' : `${diffHrs}h`;
    }
    return `${diffDays}d`;
}

export function getColorClass(diffMs) {
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 3) return 'et-age-young';
    if (diffDays < 7) return 'et-age-middle';
    return 'et-age-old';
}

export function getGadgetTitle(container) {
    if (!container) return '';
    const titleEl = container.querySelector('.dashboard-item-title, .gadget-title');
    return titleEl?.textContent?.trim() || '';
}

export function etCopyTicketLink(issueKey, summaryText, url, feedbackEl) {
    const plainText = `${issueKey} ${summaryText}`;
    const htmlLink = `<a href="${url}">${issueKey} ${summaryText}</a>`;

    const data = [new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([htmlLink], { type: 'text/html' })
    })];

    navigator.clipboard.write(data).then(() => {
        const original = feedbackEl.innerHTML;
        const originalBg = feedbackEl.style.backgroundColor;
        feedbackEl.innerHTML = '✅';
        feedbackEl.style.backgroundColor = '#e3fcef';
        setTimeout(() => {
            feedbackEl.innerHTML = original;
            feedbackEl.style.backgroundColor = originalBg || '';
        }, 1500);
    });
}

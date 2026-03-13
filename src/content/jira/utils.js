/**
 * Concurrency queue and formatting utilities for Jira features.
 */
import { storage, syncStorage } from '../../common/storage';

let _etQueue = [];
let _etRunningCount = 0;
const MAX_CONCURRENT = 3;

let _etStoryPointsFieldId = null;
let _etSprintFieldId = null;
let _etFieldIdFetched = false;

export async function getJiraHost() {
    // 1. Try to get from storage (set by top frame)
    const settings = await storage.get(['et_jira_host']);
    if (settings.et_jira_host) return settings.et_jira_host;

    // 2. Fallback to current hostname if it looks like Jira
    if (window.location.hostname.endsWith('.atlassian.net')) {
        return window.location.hostname;
    }

    // 3. Default fallback
    return 'jira.atlassian.net';
}

export async function invokeBackgroundFetch(urlOrPath, options = {}) {
    let url = urlOrPath;
    if (!url.startsWith('http')) {
        const host = await getJiraHost();
        url = `https://${host}${urlOrPath}`;
    }

    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { type: 'JIRA_API_FETCH', url, options },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error('PMsToolKit: Background fetch error', chrome.runtime.lastError);
                    resolve({ ok: false, status: 500, error: chrome.runtime.lastError.message });
                } else if (!response) {
                    resolve({ ok: false, status: 500, error: 'No response from background script' });
                } else {
                    // Mimic the fetch response
                    response.json = async () => response.data;
                    response.text = async () => response.data;
                    resolve(response);
                }
            }
        );
    });
}

export async function etEnsureCustomFields() {
    if (_etFieldIdFetched) return { sp: _etStoryPointsFieldId, sprint: _etSprintFieldId };

    const host = await getJiraHost();
    try {
        const res = await invokeBackgroundFetch(`/rest/api/3/field`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return { sp: null, sprint: null };
        const fields = await res.json();

        const spField = fields.find(f => f.name === 'Story Points' || f.name === 'Story points');
        _etStoryPointsFieldId = spField ? spField.id : null;

        const sprintField = fields.find(f => f.name && f.name.toLowerCase() === 'sprint');
        _etSprintFieldId = sprintField ? sprintField.id : null;

        _etFieldIdFetched = true;
    } catch (e) {
        console.warn('PMsToolKit: Could not detect custom fields', e);
    }
    return { sp: _etStoryPointsFieldId, sprint: _etSprintFieldId };
}

export function etParseSprintData(sprintValue) {
    if (!sprintValue || !Array.isArray(sprintValue)) return null;

    for (const sprint of sprintValue) {
        if (typeof sprint === 'object' && sprint !== null) {
            if (sprint.state && sprint.state.toUpperCase() === 'ACTIVE' && sprint.startDate) {
                return sprint.startDate;
            }
            continue;
        }
        if (typeof sprint === 'string' && sprint.toLowerCase().includes('state=active')) {
            const startDateMatch = sprint.match(/startDate=([^,\]]+)/i);
            if (startDateMatch && startDateMatch[1] !== '<null>') {
                return startDateMatch[1];
            }
        }
    }
    return null;
}

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
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffDays === 0) return '<1d';
    if (diffDays === 1) return '1d';
    if (diffDays < 7) return `${diffDays}d`;
    if (diffWeeks < 4) return `${diffWeeks}w`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}m`;
}

export function formatTooltipDate(date) {
    const then = new Date(date);
    const now = new Date();
    const diffMs = now - then;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const timeStr = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    if (diffDays < 7) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const thenStart = new Date(then.getFullYear(), then.getMonth(), then.getDate());
        const dayDiff = Math.round((todayStart - thenStart) / (1000 * 60 * 60 * 24));

        if (dayDiff === 0) return `Today, ${timeStr}`;
        if (dayDiff === 1) return `Yesterday, ${timeStr}`;

        return `last ${dayNames[then.getDay()]}, ${timeStr}`;
    } else {
        const month = then.toLocaleString('en-US', { month: 'short' });
        const day = then.getDate();
        return `on ${month} ${day}, ${timeStr}`;
    }
}

export function getColorClass(diffMs) {
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 2) return 'et-age-green';
    if (diffDays <= 4) return 'et-age-yellow';
    return 'et-age-red';
}

export function getGadgetTitle(gadgetContainer) {
    if (!gadgetContainer) return '';
    const frame = gadgetContainer.closest('.dashboard-item-frame') || gadgetContainer.parentElement;
    if (!frame) return '';
    const titleEl = frame.querySelector('.dashboard-item-title, .gadget-title, h1, h2, h3, h4');
    return titleEl?.textContent?.trim() || '';
}

export function etCopyTicketLink(issueKey, summaryText, url, feedbackEl) {
    if (feedbackEl.dataset.isCopying) return;
    feedbackEl.dataset.isCopying = 'true';

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
            delete feedbackEl.dataset.isCopying;
        }, 1500);
    }).catch((err) => {
        console.error('Clipboard write failed', err);
        delete feedbackEl.dataset.isCopying;
    });
}

/**
 * Shared helper to find the best injection target for row-based icons.
 */
export function etGetRowIconTarget(row) {
    const target = row.querySelector('.key, .issuetype, [data-field-id="issuekey"], [data-field-id="issuetype"]');
    if (target && target.prepend) return target;

    const nativeActionContainer = row.querySelector('[data-testid="native-issue-table.common.ui.issue-cells.issue-key.action-container"]');
    if (nativeActionContainer && nativeActionContainer.prepend) {
        return nativeActionContainer;
    }

    const nativeKeyLink = row.querySelector('a[href*="/browse/"]');
    if (nativeKeyLink) {
        const td = nativeKeyLink.closest('td');
        if (td && td.prepend) return td;
    }

    const firstTd = row.querySelector('td');
    if (firstTd && firstTd.prepend) return firstTd;

    return row;
}

export function etGetIconContainer(row) {
    let container = row.querySelector('.et-row-icons');
    if (!container) {
        container = document.createElement('span');
        container.className = 'et-row-icons';
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';
        container.style.gap = '4px';
        container.style.marginRight = '8px';

        const target = etGetRowIconTarget(row);
        if (target && target.prepend) {
            target.prepend(container);
        } else if (target && target.parentNode) {
            target.parentNode.insertBefore(container, target);
        } else {
            row.prepend(container); // Fallback
        }
    }
    return container;
}

// ==================================================
// PMsToolKit — Jira Tools (Content Script)
// ==================================================

// Wrapper to avoid "Extension context invalidated" when reloading the extension
const safeStorage = {
    get(key, cb) {
        try { chrome.storage.local.get(key, cb); }
        catch (e) { console.warn('PMsToolKit: context invalidated, please refresh the page.'); }
    },
    set(data) {
        try { chrome.storage.local.set(data); }
        catch (e) { console.warn('PMsToolKit: context invalidated, please refresh the page.'); }
    },
    remove(key) {
        try { chrome.storage.local.remove(key); }
        catch (e) { console.warn('PMsToolKit: context invalidated, please refresh the page.'); }
    }
};

// ---- Original Feature: 🔗 Copy for Slack button in list views ----

function injectPMsToolKitJira() {
    const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-added), .issuerow:not(.et-added)');

    rows.forEach(row => {
        const issueKey = row.getAttribute('data-issuekey') || row.querySelector('.key')?.innerText.trim();
        const summaryElement = row.querySelector('.summary a, [data-field-id="summary"] a');

        if (issueKey && summaryElement) {
            row.classList.add('et-added');

            const btn = document.createElement('button');
            btn.innerHTML = '🔗';
            btn.title = 'PMsToolKit: Copy for Slack';
            btn.style.cssText = `
                background: #f4f5f7;
                border: 1px solid #dfe1e6;
                border-radius: 3px;
                cursor: pointer;
                margin-right: 8px;
                padding: 2px 4px;
                font-size: 10px;
                transition: all 0.2s;
            `;

            btn.onclick = (e) => {
                e.preventDefault();
                const summaryText = summaryElement.innerText.trim();
                const url = `https://${window.location.hostname}/browse/${issueKey}`;
                etCopyTicketLink(issueKey, summaryText, url, btn);
            };

            const target = row.querySelector('.key, .issuetype') || row.querySelector('td') || row;
            if (target.prepend) {
                target.prepend(btn);
            } else {
                target.parentNode.insertBefore(btn, target);
            }
        }
    });
}

// ---- Shared copy link utility ----

function etCopyTicketLink(issueKey, summaryText, url, feedbackEl) {
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

// ---- Feature 5: Quick Notes ----

function injectQuickNotesListView() {
    const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-notes-added), .issuerow:not(.et-notes-added)');

    rows.forEach(row => {
        const issueKey = row.getAttribute('data-issuekey') || row.querySelector('.key')?.innerText.trim();
        if (!issueKey) return;

        row.classList.add('et-notes-added');

        const container = document.createElement('span');
        container.className = 'et-notes-container';

        const btn = document.createElement('button');
        btn.className = 'et-notes-btn';
        btn.innerHTML = '📝';
        btn.title = 'PMsToolKit: Personal notes';

        // Notes popup
        const popup = document.createElement('div');
        popup.className = 'et-notes-popup';
        popup.innerHTML = `
            <textarea placeholder="Write your note here..."></textarea>
            <div class="et-notes-footer">
                <button class="et-notes-save-btn">Save</button>
                <span class="et-notes-save-indicator">✓ Saved</span>
                <span style="font-size:9px;color:#97a0af">Esc to close</span>
            </div>
        `;

        const textarea = popup.querySelector('textarea');
        const saveIndicator = popup.querySelector('.et-notes-save-indicator');
        const saveBtn = popup.querySelector('.et-notes-save-btn');
        let saveTimeout = null;
        const storageKey = `notes_${issueKey}`;

        // Manual save helper
        function doSave() {
            clearTimeout(saveTimeout);
            const value = textarea.value.trim();
            if (value) {
                safeStorage.set({ [storageKey]: value });
                btn.classList.add('has-note');
            } else {
                safeStorage.remove(storageKey);
                btn.classList.remove('has-note');
            }
            saveIndicator.classList.add('show');
            setTimeout(() => saveIndicator.classList.remove('show'), 1200);
        }

        // Save button click
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doSave();
        });

        // Load existing note
        safeStorage.get(storageKey, (result) => {
            if (result[storageKey]) {
                textarea.value = result[storageKey];
                btn.classList.add('has-note');
            }
        });

        // Auto-save on input
        textarea.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => doSave(), 400);
        });

        // Toggle popup
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Close other open popups
            document.querySelectorAll('.et-notes-popup.visible').forEach(p => {
                if (p !== popup) p.classList.remove('visible');
            });
            popup.classList.toggle('visible');
            if (popup.classList.contains('visible')) {
                setTimeout(() => textarea.focus(), 50);
            }
        };

        // Close with Esc
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                popup.classList.remove('visible');
            }
        });

        container.appendChild(btn);
        container.appendChild(popup);

        const target = row.querySelector('.key, .issuetype') || row.querySelector('td') || row;
        if (target.prepend) {
            target.prepend(container);
        } else {
            target.parentNode.insertBefore(container, target);
        }
    });
}

function injectQuickNotesTicketView() {
    // Only on individual ticket views (/browse/XXX-NNN)
    const match = window.location.pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i);
    if (!match) return;

    const issueKey = match[1];
    const headerArea = document.querySelector('#jira-issue-header, [data-testid="issue.views.issue-details.issue-layout.container-left"]');
    if (!headerArea || headerArea.querySelector('.et-ticket-notes-panel')) return;

    const storageKey = `notes_${issueKey}`;

    const panel = document.createElement('div');
    panel.className = 'et-ticket-notes-panel';

    const toggle = document.createElement('button');
    toggle.className = 'et-ticket-notes-toggle';
    toggle.innerHTML = '📝 <span>Personal notes</span> <span class="et-notes-save-indicator" style="margin-left:auto">✓ Saved</span>';

    const body = document.createElement('div');
    body.className = 'et-ticket-notes-body';
    body.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Write your notes about this ticket...';

    const saveManualBtn = document.createElement('button');
    saveManualBtn.className = 'et-notes-save-btn';
    saveManualBtn.textContent = 'Save';
    saveManualBtn.style.marginTop = '6px';
    body.appendChild(textarea);
    body.appendChild(saveManualBtn);

    const saveIndicator = toggle.querySelector('.et-notes-save-indicator');
    let saveTimeout = null;

    // Load existing note
    safeStorage.get(storageKey, (result) => {
        if (result[storageKey]) {
            textarea.value = result[storageKey];
            toggle.querySelector('span').textContent = 'Personal notes ●';
        }
    });

    // Manual save helper
    function doSaveTicket() {
        clearTimeout(saveTimeout);
        const value = textarea.value.trim();
        if (value) {
            safeStorage.set({ [storageKey]: value });
            toggle.querySelector('span').textContent = 'Personal notes ●';
        } else {
            safeStorage.remove(storageKey);
            toggle.querySelector('span').textContent = 'Personal notes';
        }
        saveIndicator.classList.add('show');
        setTimeout(() => saveIndicator.classList.remove('show'), 1200);
    }

    // Save button click
    saveManualBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        doSaveTicket();
    });

    // Auto-save on input
    textarea.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => doSaveTicket(), 400);
    });

    // Toggle
    toggle.onclick = () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) setTimeout(() => textarea.focus(), 50);
    };

    panel.appendChild(toggle);
    panel.appendChild(body);
    headerArea.appendChild(panel);
}

// ---- Feature 7: Copy button in breadcrumbs ----

function injectBreadcrumbCopyButton() {
    // Only on individual ticket views
    const match = window.location.pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i);
    if (!match) return;

    // Already injected?
    if (document.querySelector('.et-breadcrumb-copy')) return;

    const issueKey = match[1];

    // Find the breadcrumb: try multiple selectors
    let breadcrumbNav = document.querySelector('#jira-issue-header nav ol');

    if (!breadcrumbNav) {
        // Jira Cloud: usar data-testid de los breadcrumb items
        const breadcrumbItem = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.item"]');
        if (breadcrumbItem) {
            breadcrumbNav = breadcrumbItem.closest('ol');
        }
    }

    if (!breadcrumbNav) {
        // Fallback: any nav > ol containing the issueKey
        const allNavOls = document.querySelectorAll('nav ol');
        for (const ol of allNavOls) {
            if (ol.textContent.includes(issueKey)) {
                breadcrumbNav = ol;
                break;
            }
        }
    }

    if (!breadcrumbNav) return;

    // Get the ticket summary
    const summaryEl = document.querySelector(
        '[data-testid="issue.views.issue-base.foundation.summary.heading"] h1, ' +
        '#summary-val, ' +
        '#jira-issue-header + * h1, ' +
        'h1[data-test-id="issue.views.issue-base.foundation.summary.heading"]'
    );

    const summaryText = summaryEl?.innerText?.trim() || '';
    const url = `https://${window.location.hostname}/browse/${issueKey}`;

    // -- Copy button 🔗 --
    const copyBtn = document.createElement('button');
    copyBtn.className = 'et-breadcrumb-copy';
    copyBtn.innerHTML = '🔗';
    copyBtn.title = 'PMsToolKit: Copy link for Slack';

    copyBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentSummary = summaryEl?.innerText?.trim() || summaryText;
        etCopyTicketLink(issueKey, currentSummary, url, copyBtn);
    };

    // -- Notes button 📝 --
    const notesContainer = document.createElement('span');
    notesContainer.className = 'et-notes-container';
    notesContainer.style.position = 'relative';

    const notesBtn = document.createElement('button');
    notesBtn.className = 'et-breadcrumb-copy et-notes-btn';
    notesBtn.innerHTML = '📝';
    notesBtn.title = 'PMsToolKit: Personal notes';

    const popup = document.createElement('div');
    popup.className = 'et-notes-popup';
    popup.innerHTML = `
        <textarea placeholder="Write your note here..."></textarea>
        <div class="et-notes-footer">
            <button class="et-notes-save-btn">Save</button>
            <span class="et-notes-save-indicator">✓ Saved</span>
            <span style="font-size:9px;color:#97a0af">Esc to close</span>
        </div>
    `;

    const textarea = popup.querySelector('textarea');
    const saveIndicator = popup.querySelector('.et-notes-save-indicator');
    const saveBtnBc = popup.querySelector('.et-notes-save-btn');
    const storageKey = `notes_${issueKey}`;
    let saveTimeout = null;

    // Manual save helper
    function doSaveBc() {
        clearTimeout(saveTimeout);
        const value = textarea.value.trim();
        if (value) {
            safeStorage.set({ [storageKey]: value });
            notesBtn.classList.add('has-note');
        } else {
            safeStorage.remove(storageKey);
            notesBtn.classList.remove('has-note');
        }
        saveIndicator.classList.add('show');
        setTimeout(() => saveIndicator.classList.remove('show'), 1200);
    }

    // Save button click
    saveBtnBc.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        doSaveBc();
    });

    // Load existing note
    safeStorage.get(storageKey, (result) => {
        if (result[storageKey]) {
            textarea.value = result[storageKey];
            notesBtn.classList.add('has-note');
        }
    });

    // Auto-save on input
    textarea.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => doSaveBc(), 400);
    });

    // Toggle popup
    notesBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        popup.classList.toggle('visible');
        if (popup.classList.contains('visible')) {
            setTimeout(() => textarea.focus(), 50);
        }
    };

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') popup.classList.remove('visible');
    });

    notesContainer.appendChild(notesBtn);
    notesContainer.appendChild(popup);

    // -- Time in state badge ⏱ --
    const ageBadge = document.createElement('span');
    ageBadge.className = 'et-age-badge et-age-loading et-breadcrumb-age';
    ageBadge.textContent = '⏳';
    ageBadge.setAttribute('data-tooltip', 'Checking status...');

    // Fetch time-in-state data
    _etEnqueue(() => getLastStatusChangeDate(issueKey)).then(result => {
        if (!result) {
            ageBadge.textContent = '⚠️';
            ageBadge.setAttribute('data-tooltip', 'Could not retrieve status');
            ageBadge.className = 'et-age-badge et-breadcrumb-age';
            return;
        }

        const changedDate = new Date(result.changedDate);
        const diffMs = Date.now() - changedDate;

        ageBadge.textContent = _etFormatAge(diffMs);
        ageBadge.className = `et-age-badge ${_etGetColorClass(diffMs)} et-breadcrumb-age`;
        const byText = result.changedBy ? `\nMoved by: ${result.changedBy}` : '';
        ageBadge.setAttribute('data-tooltip', `In "${result.statusName}" since ${changedDate.toLocaleDateString('en-US')} ${changedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${byText}`);
    }).catch(err => {
        console.warn(`PMsToolKit: Error getting status for ${issueKey}:`, err);
        ageBadge.textContent = '⚠️';
        ageBadge.setAttribute('data-tooltip', 'Error checking status');
        ageBadge.className = 'et-age-badge et-breadcrumb-age';
    });

    // Insert all buttons in the breadcrumb (Jira uses div[role=listitem])
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'listitem');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '4px';
    wrapper.appendChild(copyBtn);
    wrapper.appendChild(notesContainer);
    wrapper.appendChild(ageBadge);
    breadcrumbNav.appendChild(wrapper);
}

// ---- Feature 10: Icons in Jira Cloud Native Issue Table ----

function injectNativeTableIcons() {
    const rows = document.querySelectorAll(
        'tr[data-testid="native-issue-table.ui.issue-row"]:not(.et-native-added)'
    );

    rows.forEach(row => {
        // Extract issue key
        const keyLink = row.querySelector(
            '[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]'
        );
        const issueKey = keyLink?.textContent?.trim();
        if (!issueKey) return;

        row.classList.add('et-native-added');

        // Extract summary text
        const summaryEl = row.querySelector(
            '[data-testid="native-issue-table.common.ui.issue-cells.issue-summary.issue-summary-cell"]'
        );
        const summaryText = summaryEl?.textContent?.trim() || '';
        const url = `https://${window.location.hostname}/browse/${issueKey}`;

        // Create wrapper for all icons
        const wrapper = document.createElement('span');
        wrapper.className = 'et-native-icons';

        // ---- 📝 Notes button ----
        const notesContainer = document.createElement('span');
        notesContainer.className = 'et-notes-container';

        const notesBtn = document.createElement('button');
        notesBtn.className = 'et-notes-btn';
        notesBtn.innerHTML = '📝';
        notesBtn.title = 'PMsToolKit: Personal notes';

        const popup = document.createElement('div');
        popup.className = 'et-notes-popup';
        popup.innerHTML = `
            <textarea placeholder="Write your note here..."></textarea>
            <div class="et-notes-footer">
                <button class="et-notes-save-btn">Save</button>
                <span class="et-notes-save-indicator">✓ Saved</span>
                <span style="font-size:9px;color:#97a0af">Esc to close</span>
            </div>
        `;

        const textarea = popup.querySelector('textarea');
        const saveIndicator = popup.querySelector('.et-notes-save-indicator');
        const saveBtn = popup.querySelector('.et-notes-save-btn');
        let saveTimeout = null;
        const storageKey = `notes_${issueKey}`;

        function doSaveNative() {
            clearTimeout(saveTimeout);
            const value = textarea.value.trim();
            if (value) {
                safeStorage.set({ [storageKey]: value });
                notesBtn.classList.add('has-note');
            } else {
                safeStorage.remove(storageKey);
                notesBtn.classList.remove('has-note');
            }
            saveIndicator.classList.add('show');
            setTimeout(() => saveIndicator.classList.remove('show'), 1200);
        }

        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doSaveNative();
        });

        safeStorage.get(storageKey, (result) => {
            if (result[storageKey]) {
                textarea.value = result[storageKey];
                notesBtn.classList.add('has-note');
            }
        });

        textarea.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => doSaveNative(), 400);
        });

        notesBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.et-notes-popup.visible').forEach(p => {
                if (p !== popup) p.classList.remove('visible');
            });
            popup.classList.toggle('visible');
            if (popup.classList.contains('visible')) {
                setTimeout(() => textarea.focus(), 50);
            }
        };

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') popup.classList.remove('visible');
        });

        notesContainer.appendChild(notesBtn);
        notesContainer.appendChild(popup);

        // ---- 🔗 Copy button ----
        const copyBtn = document.createElement('button');
        copyBtn.className = 'et-notes-btn';
        copyBtn.innerHTML = '🔗';
        copyBtn.title = 'PMsToolKit: Copy for Slack';
        copyBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            etCopyTicketLink(issueKey, summaryText, url, copyBtn);
        };

        // ---- ⏱ Time in State badge ----
        const badge = document.createElement('span');
        badge.className = 'et-age-badge et-age-loading';
        badge.textContent = '⏳';
        badge.setAttribute('data-tooltip', 'Checking status...');

        _etEnqueue(() => getLastStatusChangeDate(issueKey)).then(result => {
            if (!result) {
                badge.textContent = '⚠️';
                badge.setAttribute('data-tooltip', 'Could not retrieve status');
                badge.className = 'et-age-badge';
                return;
            }
            const changedDate = new Date(result.changedDate);
            const diffMs = Date.now() - changedDate;
            badge.textContent = _etFormatAge(diffMs);
            badge.className = `et-age-badge ${_etGetColorClass(diffMs)}`;
            const byText = result.changedBy ? `\nMoved by: ${result.changedBy}` : '';
            badge.setAttribute('data-tooltip',
                `In "${result.statusName}" since ${changedDate.toLocaleDateString('en-US')} ${changedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${byText}`);
        }).catch(err => {
            console.warn(`PMsToolKit: Error getting status for ${issueKey}:`, err);
            badge.textContent = '⚠️';
            badge.setAttribute('data-tooltip', 'Error checking status');
            badge.className = 'et-age-badge';
        });

        // Assemble wrapper
        wrapper.appendChild(notesContainer);
        wrapper.appendChild(copyBtn);
        wrapper.appendChild(badge);

        // Insert into the merged cell, right before the issue key so
        // all 3 icons are grouped between the type icon and the key
        const mergedCell = row.querySelector('[data-testid="native-issue-table.ui.row.issue-row.merged-cell"]');
        if (mergedCell) {
            const keyContainer = mergedCell.querySelector(
                '[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]'
            );
            if (keyContainer) {
                // Insert wrapper right before the key
                keyContainer.parentElement.insertBefore(wrapper, keyContainer);
            } else {
                // Fallback: insert after the first child (type icon)
                const firstChild = mergedCell.firstElementChild;
                if (firstChild && firstChild.nextSibling) {
                    mergedCell.insertBefore(wrapper, firstChild.nextSibling);
                } else {
                    mergedCell.appendChild(wrapper);
                }
            }
        } else {
            // Fallback for non-merged tables
            const firstTd = row.querySelector('td:nth-child(2)') || row.querySelector('td');
            if (firstTd) firstTd.prepend(wrapper);
        }
    });
}

// ---- Global tooltip for age badges (appended to body to avoid overflow clipping) ----

const _etTooltipEl = document.createElement('div');
_etTooltipEl.className = 'et-tooltip';
document.body.appendChild(_etTooltipEl);

document.addEventListener('mouseover', (e) => {
    const badge = e.target.closest('.et-age-badge[data-tooltip]');
    if (!badge) return;

    const text = badge.getAttribute('data-tooltip');
    if (!text) return;

    _etTooltipEl.textContent = '';
    // Support newlines in the tooltip text
    text.split('\n').forEach((line, i) => {
        if (i > 0) _etTooltipEl.appendChild(document.createElement('br'));
        _etTooltipEl.appendChild(document.createTextNode(line));
    });

    const rect = badge.getBoundingClientRect();
    _etTooltipEl.style.left = `${rect.left}px`;
    _etTooltipEl.style.top = `${rect.top - 6}px`;
    _etTooltipEl.style.transform = 'translateY(-100%)';
    _etTooltipEl.classList.add('visible');
});

document.addEventListener('mouseout', (e) => {
    const badge = e.target.closest('.et-age-badge[data-tooltip]');
    if (!badge) return;
    // Only hide if we're leaving the badge (not entering a child)
    if (!badge.contains(e.relatedTarget)) {
        _etTooltipEl.classList.remove('visible');
    }
});

// ---- Feature 8: Time in State Indicator (via Jira API) ----

// In-memory cache: { issueKey: { statusName, changedDate, fetchedAt } }
const _etStatusCache = {};
const ET_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Concurrency queue to avoid overloading the API
let _etActiveRequests = 0;
const ET_MAX_CONCURRENT = 3;
const _etRequestQueue = [];

function _etProcessQueue() {
    while (_etActiveRequests < ET_MAX_CONCURRENT && _etRequestQueue.length > 0) {
        const next = _etRequestQueue.shift();
        _etActiveRequests++;
        next().finally(() => {
            _etActiveRequests--;
            _etProcessQueue();
        });
    }
}

function _etEnqueue(fn) {
    return new Promise((resolve, reject) => {
        _etRequestQueue.push(() => fn().then(resolve, reject));
        _etProcessQueue();
    });
}

/**
 * Gets the date of the last status transition and the current status name
 * via the Jira REST API. Uses in-memory cache with TTL.
 *
 * Uses two calls: one to get the current status and creation date,
 * and another to the dedicated changelog endpoint sorted by date descending
 * to ensure we always get the most recent transition (the expand=changelog
 * on the main endpoint paginates and may omit recent entries).
 */
async function getLastStatusChangeDate(issueKey) {
    // Check cache
    const cached = _etStatusCache[issueKey];
    if (cached && (Date.now() - cached.fetchedAt) < ET_CACHE_TTL) {
        return cached;
    }

    try {
        // 1. Get current status and creation date
        const issueRes = await fetch(`/rest/api/2/issue/${issueKey}?fields=status,created`, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });

        if (!issueRes.ok) {
            console.warn(`PMsToolKit: Error fetching ${issueKey}: ${issueRes.status}`);
            return null;
        }

        const issueData = await issueRes.json();
        const statusName = issueData.fields?.status?.name || '?';
        const createdDate = issueData.fields?.created;

        // 2. Get changelog sorted by most recent first
        //    We use a low maxResults because we only need the last status transition
        const changelogRes = await fetch(
            `/rest/api/2/issue/${issueKey}/changelog?maxResults=50`,
            {
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' }
            }
        );

        let lastStatusChange = null;
        let lastStatusAuthor = null;

        if (changelogRes.ok) {
            const changelogData = await changelogRes.json();
            const values = changelogData.values || [];

            // values are in chronological order (oldest first),
            // we iterate from most recent to oldest
            for (let i = values.length - 1; i >= 0; i--) {
                const entry = values[i];
                const statusItem = entry.items?.find(item => item.field === 'status');
                if (statusItem) {
                    lastStatusChange = entry.created;
                    lastStatusAuthor = entry.author?.displayName || null;
                    break;
                }
            }

            // If not found and there are more pages, paginate backwards
            // to search in more recent entries
            if (!lastStatusChange && changelogData.total > changelogData.maxResults) {
                // Go to the last page
                const lastPageStart = changelogData.total - changelogData.maxResults;
                const startAt = Math.max(0, lastPageStart);

                const lastPageRes = await fetch(
                    `/rest/api/2/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=50`,
                    {
                        credentials: 'same-origin',
                        headers: { 'Accept': 'application/json' }
                    }
                );

                if (lastPageRes.ok) {
                    const lastPageData = await lastPageRes.json();
                    const lastValues = lastPageData.values || [];

                    for (let i = lastValues.length - 1; i >= 0; i--) {
                        const entry = lastValues[i];
                        const statusItem = entry.items?.find(item => item.field === 'status');
                        if (statusItem) {
                            lastStatusChange = entry.created;
                            lastStatusAuthor = entry.author?.displayName || null;
                            break;
                        }
                    }
                }
            }
        }

        // If state never changed, use creation date
        const changedDate = lastStatusChange || createdDate;

        const result = {
            statusName,
            changedDate,
            changedBy: lastStatusAuthor,
            fetchedAt: Date.now()
        };

        _etStatusCache[issueKey] = result;
        return result;

    } catch (err) {
        // "Failed to fetch" is expected for issues in projects with restricted access
        if (err.message === 'Failed to fetch') {
            console.debug(`PMsToolKit: Skipping ${issueKey} (no access or network issue)`);
        } else {
            console.warn(`PMsToolKit: Error fetching status for ${issueKey}:`, err);
        }
        return null;
    }
}

/**
 * Formats the time difference into a readable label.
 */
function _etFormatAge(diffMs) {
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffDays === 0) return '<1d';
    if (diffDays === 1) return '1d';
    if (diffDays < 7) return `${diffDays}d`;
    if (diffWeeks < 4) return `${diffWeeks}w`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}m`;
}

function _etGetColorClass(diffMs) {
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 2) return 'et-age-green';
    if (diffDays <= 4) return 'et-age-yellow';
    return 'et-age-red';
}

function injectAgeIndicators() {
    const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-age-added), .issuerow:not(.et-age-added)');

    rows.forEach(row => {
        const issueKey = row.getAttribute('data-issuekey');
        if (!issueKey) return;

        row.classList.add('et-age-added');

        // Crear badge placeholder (loading)
        const badge = document.createElement('span');
        badge.className = 'et-age-badge et-age-loading';
        badge.textContent = '⏳';
        badge.setAttribute('data-tooltip', 'Checking status...');

        // Insert after the key
        const keyCell = row.querySelector('.key a, [data-field-id="issuekey"] a');
        if (keyCell) {
            keyCell.parentNode.insertBefore(badge, keyCell.nextSibling);
        } else {
            const firstCell = row.querySelector('td');
            if (firstCell) firstCell.appendChild(badge);
        }

        // Query API with concurrency control
        _etEnqueue(() => getLastStatusChangeDate(issueKey)).then(result => {
            if (!result) {
                badge.textContent = '⚠️';
                badge.setAttribute('data-tooltip', 'Could not retrieve status');
                badge.className = 'et-age-badge';
                return;
            }

            const changedDate = new Date(result.changedDate);
            const diffMs = Date.now() - changedDate;

            badge.textContent = _etFormatAge(diffMs);
            badge.className = `et-age-badge ${_etGetColorClass(diffMs)}`;
            const byText = result.changedBy ? `\nMoved by: ${result.changedBy}` : '';
            badge.setAttribute('data-tooltip', `In "${result.statusName}" since ${changedDate.toLocaleDateString('en-US')} ${changedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${byText}`);
        }).catch(err => {
            console.warn(`PMsToolKit: Error getting status for ${issueKey}:`, err);
            badge.textContent = '⚠️';
            badge.setAttribute('data-tooltip', 'Error checking status');
            badge.className = 'et-age-badge';
        });
    });
}

// ---- Feature 8b: Time in State on Board Cards ----

function injectBoardCardAgeIndicators() {
    // Find all board cards that haven't been processed yet
    const cards = document.querySelectorAll('[data-testid="platform-card.common.ui.key.key"]:not(.et-board-age-added)');

    cards.forEach(keyContainer => {
        keyContainer.classList.add('et-board-age-added');

        // Extract issue key from the link text inside the key container
        const keyLink = keyContainer.querySelector('a');
        const issueKey = keyLink?.textContent?.trim();
        if (!issueKey) return;

        // Find the card root element
        const cardRoot = keyContainer.closest('[draggable="true"]');
        if (!cardRoot) return;

        // Find the content wrapper (the div that holds all card content sections)
        const contentWrapper = cardRoot.querySelector('[class*="content"]')
            || cardRoot.querySelector('[data-component-selector="platform-card.ui.card.card-content.content-section"]')?.parentElement;

        // Use the card root as the ultimate fallback
        const targetContainer = contentWrapper || cardRoot;

        // Create a new row at the bottom of the card for the badge
        const badgeRow = document.createElement('div');
        badgeRow.className = 'et-board-age-row';

        const badge = document.createElement('span');
        badge.className = 'et-age-badge et-age-loading et-board-age';
        badge.textContent = '⏳';
        badge.setAttribute('data-tooltip', 'Checking status...');

        badgeRow.appendChild(badge);
        targetContainer.appendChild(badgeRow);

        // Fetch time-in-state data
        _etEnqueue(() => getLastStatusChangeDate(issueKey)).then(result => {
            if (!result) {
                badge.textContent = '⚠️';
                badge.setAttribute('data-tooltip', 'Could not retrieve status');
                badge.className = 'et-age-badge et-board-age';
                return;
            }

            const changedDate = new Date(result.changedDate);
            const diffMs = Date.now() - changedDate;

            badge.textContent = _etFormatAge(diffMs);
            badge.className = `et-age-badge ${_etGetColorClass(diffMs)} et-board-age`;
            const dateStr = changedDate.toLocaleDateString('en-US') + ' ' + changedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const byLine = result.changedBy ? `\nMoved by: ${result.changedBy}` : '';
            badge.setAttribute('data-tooltip', `In "${result.statusName}" since ${dateStr}${byLine}`);
        }).catch(err => {
            console.warn(`PMsToolKit: Error getting status for ${issueKey}:`, err);
            badge.textContent = '⚠️';
            badge.setAttribute('data-tooltip', 'Error checking status');
            badge.className = 'et-age-badge et-board-age';
        });
    });
}

// ---- Feature 9: Story Points en gadgets del Dashboard ----

let _etStoryPointsFieldId = null;
let _etFieldIdFetched = false;
const _etProcessedGadgets = new Set(); // IDs of already processed gadgets

async function _etEnsureStoryPointsField() {
    if (_etFieldIdFetched) return _etStoryPointsFieldId;
    _etFieldIdFetched = true;

    try {
        const res = await fetch(`${window.location.origin}/rest/api/2/field`, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return null;
        const fields = await res.json();
        const spField = fields.find(f => f.name === 'Story Points' || f.name === 'Story points');
        _etStoryPointsFieldId = spField ? spField.id : null;
    } catch (e) {
        console.warn('PMsToolKit: Could not detect the Story Points field', e);
    }
    return _etStoryPointsFieldId;
}

async function injectStoryPointsSummary() {
    const gadgetTables = document.querySelectorAll('table.stats-gadget-table');
    if (gadgetTables.length === 0) return;

    const fieldId = await _etEnsureStoryPointsField();
    if (!fieldId) return;

    for (const table of gadgetTables) {
        // Identify the gadget to avoid reprocessing
        const gadgetContainer = table.closest('[id^="gadget-content-"]') || table.closest('[id^="gadget-"]');
        const gadgetId = gadgetContainer?.id || '';
        if (_etProcessedGadgets.has(gadgetId)) continue;

        // Extract JQL from link in the Total row
        const totalRow = table.querySelector('tr.stats-gadget-final-row');
        if (!totalRow) continue;

        const totalLink = totalRow.querySelector('a[href*="jql="]');
        if (!totalLink) continue;

        let jql;
        try {
            const url = new URL(totalLink.href);
            jql = url.searchParams.get('jql');
        } catch (e) {
            const m = totalLink.href.match(/jql=([^&]+)/);
            jql = m ? decodeURIComponent(m[1]) : null;
        }
        if (!jql) continue;

        _etProcessedGadgets.add(gadgetId);

        // Remove ORDER BY for the API (doesn't affect results)
        const jqlClean = jql.replace(/\s+ORDER\s+BY\s+.*/i, '');

        // Single query via POST (avoids URL encoding issues)
        console.debug('PMsToolKit SP: JQL =', jqlClean);

        try {
            const res = await fetch(`${window.location.origin}/rest/api/3/search/jql`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Atlassian-Token': 'no-check'
                },
                body: JSON.stringify({
                    jql: jqlClean,
                    fields: [fieldId, 'assignee'],
                    maxResults: 200
                })
            });
            console.debug('PMsToolKit SP: Response status =', res.status);
            if (!res.ok) {
                const errText = await res.text();
                console.warn('PMsToolKit SP: Error response =', errText);
                continue;
            }

            const data = await res.json();
            console.debug('PMsToolKit SP: Got', data.total ?? data.issues?.length ?? 0, 'issues');

            // Group SP by assignee displayName
            const spByAssignee = {}; // displayName → totalSP
            let grandTotal = 0;

            (data.issues || []).forEach(issue => {
                const sp = issue.fields?.[fieldId];
                const spVal = (sp != null && !isNaN(sp)) ? Number(sp) : 0;
                const assigneeName = issue.fields?.assignee?.displayName || 'Unassigned';

                if (!spByAssignee[assigneeName]) spByAssignee[assigneeName] = 0;
                spByAssignee[assigneeName] += spVal;
                grandTotal += spVal;
            });

            // --- Modify the table ---

            // 1. Hide progress bar columns (percentage)
            table.querySelectorAll('.stats-gadget-progress-indicator, [headers$="-stats-percentage"]').forEach(cell => {
                cell.style.display = 'none';
            });
            // Hide percentage headers
            const percentHeader = table.querySelector('[id$="-stats-percentage"]');
            if (percentHeader) percentHeader.style.display = 'none';

            // 2. Add "SP" header
            const headerRow = table.querySelector('tr.stats-gadget-table-header');
            if (headerRow && !headerRow.querySelector('.et-sp-header')) {
                const th = document.createElement('th');
                th.className = 'stats-gadget-numeric et-sp-header';
                th.textContent = 'SP';
                // Insert after Count
                const countHeader = headerRow.querySelector('[id$="-stats-count"]');
                if (countHeader) {
                    countHeader.insertAdjacentElement('afterend', th);
                } else {
                    headerRow.appendChild(th);
                }
            }

            // 3. Add SP to each data row
            const dataRows = table.querySelectorAll('tbody tr:not(.stats-gadget-final-row)');
            dataRows.forEach(row => {
                if (row.querySelector('.et-sp-cell')) return;

                // Get assignee name from the row link
                const nameLink = row.querySelector('[headers$="-stats-category"] a');
                const assigneeName = nameLink?.textContent?.trim() || '';

                const sp = spByAssignee[assigneeName] || 0;

                const td = document.createElement('td');
                td.className = 'cell-type-collapsed stats-gadget-numeric et-sp-cell';
                td.innerHTML = `<strong class="et-sp-value">${sp}</strong>`;

                // Insert after the Count cell
                const countCell = row.querySelector('[headers$="-stats-count"]');
                if (countCell) {
                    countCell.insertAdjacentElement('afterend', td);
                } else {
                    row.appendChild(td);
                }
            });

            // 4. Add total SP to the final row
            if (totalRow && !totalRow.querySelector('.et-sp-cell')) {
                // Adjust colspan of the final cell (removed progress columns)
                const finalCell = totalRow.querySelector('.final-table-cell');
                if (finalCell) finalCell.style.display = 'none';

                const td = document.createElement('td');
                td.className = 'stats-gadget-numeric stats-gadget-final-row-cell et-sp-cell';
                td.innerHTML = `<strong class="et-sp-total">${grandTotal}</strong>`;

                const countCell = totalRow.querySelector('[headers$="-stats-count"]');
                if (countCell) {
                    countCell.insertAdjacentElement('afterend', td);
                } else {
                    totalRow.appendChild(td);
                }
            }

        } catch (e) {
            console.warn('PMsToolKit: Error querying Story Points for gadget', e);
        }
    }
}

// ---- Close note popups when clicking outside ----

document.addEventListener('click', (e) => {
    if (!e.target.closest('.et-notes-container')) {
        document.querySelectorAll('.et-notes-popup.visible').forEach(p => {
            p.classList.remove('visible');
        });
    }
});

// ---- Main execution ----

function etRunAll() {
    injectPMsToolKitJira();     // Original: copy button in list views
    injectQuickNotesListView();  // Feature 5: notes in list views
    injectQuickNotesTicketView(); // Feature 5: notes in ticket view
    injectBreadcrumbCopyButton(); // Feature 7: copy in breadcrumbs
    injectAgeIndicators();        // Feature 8: age indicator
    injectBoardCardAgeIndicators(); // Feature 8b: age on board cards
    injectStoryPointsSummary();   // Feature 9: SP summary
    injectNativeTableIcons();     // Feature 10: icons in native issue table
}

// Run when Jira loads dynamic content
const observer = new MutationObserver(() => etRunAll());
observer.observe(document.body, { childList: true, subtree: true });
etRunAll();
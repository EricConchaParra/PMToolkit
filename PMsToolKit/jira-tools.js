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

        // Create a new row at the bottom of the card for the badge + notes
        const badgeRow = document.createElement('div');
        badgeRow.className = 'et-board-age-row';

        // ---- 📝 Notes icon on board card ----
        const notesContainer = document.createElement('span');
        notesContainer.className = 'et-notes-container et-board-notes-container';

        const notesBtn = document.createElement('button');
        notesBtn.className = 'et-notes-btn et-board-notes-btn';
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

        function doSaveBoard() {
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
            doSaveBoard();
        });

        safeStorage.get(storageKey, (result) => {
            if (result[storageKey]) {
                textarea.value = result[storageKey];
                notesBtn.classList.add('has-note');
            }
        });

        textarea.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => doSaveBoard(), 400);
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

        // ---- ⏱ Time in State badge ----
        const badge = document.createElement('span');
        badge.className = 'et-age-badge et-age-loading et-board-age';
        badge.textContent = '⏳';
        badge.setAttribute('data-tooltip', 'Checking status...');

        badgeRow.appendChild(notesContainer);
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

// ---- Shared: Gadget title detection ----

/**
 * Returns the user-facing title of a dashboard gadget, given its
 * content container element (id="gadget-content-...").
 * Jira structure: gadget frame > header (title) + content (table).
 */
function _etGetGadgetTitle(gadgetContainer) {
    if (!gadgetContainer) return '';
    // Walk up to the frame element, then search for the title
    const frame = gadgetContainer.closest('.dashboard-item-frame')
        || gadgetContainer.parentElement;
    if (!frame) return '';
    const titleEl = frame.querySelector('.dashboard-item-title, .gadget-title, h1, h2, h3, h4');
    return titleEl?.textContent?.trim() || '';
}

// ---- Feature 9: Story Points en gadgets del Dashboard ----

let _etStoryPointsFieldId = null;
let _etFieldIdFetched = false;
const _etProcessedGadgets = new Set(); // IDs of already processed gadgets

async function _etEnsureStoryPointsField() {
    if (_etFieldIdFetched) return _etStoryPointsFieldId;

    try {
        const res = await fetch(`${window.location.origin}/rest/api/2/field`, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return null; // leave _etFieldIdFetched false → retries next cycle
        const fields = await res.json();
        const spField = fields.find(f => f.name === 'Story Points' || f.name === 'Story points');
        _etStoryPointsFieldId = spField ? spField.id : null;
        _etFieldIdFetched = true; // only cache after successful fetch
    } catch (e) {
        console.warn('PMsToolKit: Could not detect the Story Points field', e);
        // _etFieldIdFetched stays false → next call will retry
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

        // Skip gadgets whose title contains "Velocity" — handled by Feature #11
        const gadgetTitleF9 = _etGetGadgetTitle(gadgetContainer);
        if (gadgetTitleF9.toLowerCase().includes('velocity')) continue;

        // Idempotency guard: if SP column already injected (e.g. by a previous
        // successful retry), mark as processed and skip.
        if (table.querySelector('.et-sp-header')) {
            _etProcessedGadgets.add(gadgetId);
            continue;
        }

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

            // All SP data injected successfully — mark gadget as processed
            _etProcessedGadgets.add(gadgetId);

        } catch (e) {
            console.warn('PMsToolKit: Error querying Story Points for gadget', e);

            // Show error indicator with Retry button in the header row
            const errHeaderRow = table.querySelector('tr.stats-gadget-table-header');
            if (errHeaderRow && !errHeaderRow.querySelector('.et-sp-header')) {
                const th = document.createElement('th');
                th.className = 'stats-gadget-numeric et-sp-header et-sp-error-header';
                th.innerHTML = `<span class="et-sp-error">⚠️ SP</span><button class="et-sp-retry-btn" title="Retry loading Story Points">↻</button>`;
                th.querySelector('.et-sp-retry-btn').onclick = (ev) => {
                    ev.preventDefault();
                    _etProcessedGadgets.delete(gadgetId);
                    th.remove();
                    injectStoryPointsSummary();
                };
                const countH = errHeaderRow.querySelector('[id$="-stats-count"]');
                if (countH) countH.insertAdjacentElement('afterend', th);
                else errHeaderRow.appendChild(th);
            }
            // Don't add to _etProcessedGadgets → auto-retry on next DOM mutation
        }
    }
}

// ---- Feature 11: Velocity per Developer on Dashboard Gadgets ----

const ET_VELOCITY_SPRINT_COUNT = 3; // Number of closed sprints to average
const _etProcessedVelocityGadgets = new Set();
const _etBoardIdCache = {}; // projectKey → boardId

/**
 * Returns the first Scrum board ID for the given project key.
 * Caches the result in-memory.
 */
async function _etGetBoardIdForProject(projectKey) {
    if (_etBoardIdCache[projectKey] !== undefined) return _etBoardIdCache[projectKey];

    try {
        const res = await fetch(
            `${window.location.origin}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum&maxResults=1`,
            { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }
        );
        if (!res.ok) {
            console.warn(`PMsToolKit Velocity: Board lookup failed (${res.status}) for project ${projectKey}`);
            _etBoardIdCache[projectKey] = null;
            return null;
        }
        const data = await res.json();
        const boardId = data.values?.[0]?.id || null;
        _etBoardIdCache[projectKey] = boardId;
        console.debug(`PMsToolKit Velocity: Board ID = ${boardId} for project ${projectKey}`);
        return boardId;
    } catch (e) {
        console.warn('PMsToolKit Velocity: Error fetching board', e);
        _etBoardIdCache[projectKey] = null;
        return null;
    }
}

/**
 * Returns the last `count` closed sprints for a board (most recent first).
 */
async function _etGetLastClosedSprints(boardId, count = ET_VELOCITY_SPRINT_COUNT) {
    try {
        const res = await fetch(
            `${window.location.origin}/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=50`,
            { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }
        );
        if (!res.ok) {
            console.warn(`PMsToolKit Velocity: Sprint lookup failed (${res.status})`);
            return [];
        }
        const data = await res.json();
        const sprints = data.values || [];
        // API returns in chronological order — take the last N
        const recent = sprints.slice(-count);
        console.debug(`PMsToolKit Velocity: Found ${recent.length} closed sprints out of ${sprints.length} total`);
        return recent;
    } catch (e) {
        console.warn('PMsToolKit Velocity: Error fetching sprints', e);
        return [];
    }
}

/**
 * Fetches completed issues for a sprint and returns an array of
 * { assigneeName, sp } objects.
 */
async function _etFetchCompletedIssuesForSprint(sprintId, storyPointsFieldId) {
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
                jql: `sprint = ${sprintId} AND statusCategory = Done`,
                fields: [storyPointsFieldId, 'assignee'],
                maxResults: 200
            })
        });
        if (!res.ok) {
            console.warn(`PMsToolKit Velocity: Issue fetch failed for sprint ${sprintId} (${res.status})`);
            return [];
        }
        const data = await res.json();
        return (data.issues || []).map(issue => ({
            assigneeName: issue.fields?.assignee?.displayName || 'Unassigned',
            sp: (issue.fields?.[storyPointsFieldId] != null && !isNaN(issue.fields[storyPointsFieldId]))
                ? Number(issue.fields[storyPointsFieldId])
                : 0
        }));
    } catch (e) {
        console.warn(`PMsToolKit Velocity: Error fetching issues for sprint ${sprintId}`, e);
        return [];
    }
}

/**
 * Main injection function: finds "Velocity" gadgets on the dashboard
 * and adds a V-Avg column showing average velocity per developer.
 * API calls bypass the shared concurrency queue for speed.
 */
async function injectVelocityPerDeveloper() {
    const gadgetTables = document.querySelectorAll('table.stats-gadget-table');
    if (gadgetTables.length === 0) return;

    const fieldId = await _etEnsureStoryPointsField();
    if (!fieldId) return;

    for (const table of gadgetTables) {
        // Identify the gadget container
        const gadgetContainer = table.closest('[id^="gadget-content-"]') || table.closest('[id^="gadget-"]');
        const gadgetId = gadgetContainer?.id || '';

        // Only process gadgets whose title contains "Velocity" (case-insensitive)
        const gadgetTitle = _etGetGadgetTitle(gadgetContainer);
        if (!gadgetTitle.toLowerCase().includes('velocity')) continue;

        // Use a separate processed-set so we don't clash with Feature #9
        const velGadgetKey = `vel-${gadgetId}`;
        if (_etProcessedVelocityGadgets.has(velGadgetKey)) continue;

        // Idempotency: if column already injected, skip
        if (table.querySelector('.et-velocity-header')) {
            _etProcessedVelocityGadgets.add(velGadgetKey);
            continue;
        }

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

        // Extract project key from JQL (e.g. "project = XYZ" or "project = \"XYZ\"")
        const projectMatch = jql.match(/project\s*=\s*"?([A-Z0-9]+)"?/i);
        if (!projectMatch) {
            console.warn('PMsToolKit Velocity: Could not extract project key from JQL:', jql);
            continue;
        }
        const projectKey = projectMatch[1];

        try {
            // Step A: Get board ID (direct call — bypass concurrency queue for speed)
            const boardId = await _etGetBoardIdForProject(projectKey);
            if (!boardId) {
                console.warn(`PMsToolKit Velocity: No Scrum board found for project ${projectKey}`);
                continue;
            }

            // Step B: Get last closed sprints (direct call)
            const sprints = await _etGetLastClosedSprints(boardId);
            if (sprints.length === 0) {
                console.warn('PMsToolKit Velocity: No closed sprints found');
                continue;
            }

            // Step C: Fetch completed issues for ALL sprints in parallel
            const sprintResults = await Promise.all(
                sprints.map(async (sprint) => ({
                    sprintName: sprint.name || `Sprint ${sprint.id}`,
                    issues: await _etFetchCompletedIssuesForSprint(sprint.id, fieldId)
                }))
            );

            // Aggregate: per-assignee, per-sprint SP breakdown
            // spByAssignee = { displayName: { perSprint: [{name, sp}], totalSp } }
            const spByAssignee = {};
            let grandTotalSp = 0;
            const sprintCount = sprintResults.length;

            for (const { sprintName, issues } of sprintResults) {
                // Track per-sprint totals per assignee
                const sprintTotals = {}; // assignee → SP in this sprint
                issues.forEach(({ assigneeName, sp }) => {
                    if (!sprintTotals[assigneeName]) sprintTotals[assigneeName] = 0;
                    sprintTotals[assigneeName] += sp;
                });

                for (const [name, sp] of Object.entries(sprintTotals)) {
                    if (!spByAssignee[name]) {
                        spByAssignee[name] = { totalSp: 0, perSprint: [] };
                    }
                    spByAssignee[name].perSprint.push({ name: sprintName, sp });
                    spByAssignee[name].totalSp += sp;
                    grandTotalSp += sp;
                }
            }

            // Calculate averages & build tooltips
            const avgByAssignee = {};    // name → avg
            const tooltipByAssignee = {}; // name → "Sprint A (14 SP) + Sprint B (16 SP)"
            for (const [name, data] of Object.entries(spByAssignee)) {
                avgByAssignee[name] = Math.round((data.totalSp / sprintCount) * 10) / 10;
                tooltipByAssignee[name] = data.perSprint
                    .map(s => `${s.name} (${s.sp} SP)`)
                    .join(' + ');
            }
            const grandAvg = Math.round((grandTotalSp / sprintCount) * 10) / 10;
            const grandTooltip = sprintResults
                .map(sr => {
                    const total = sr.issues.reduce((sum, i) => sum + i.sp, 0);
                    return `${sr.sprintName} (${total} SP)`;
                })
                .join(' + ');

            // --- Modify the table ---

            // 1. Hide progress bar columns
            table.querySelectorAll('.stats-gadget-progress-indicator, [headers$="-stats-percentage"]').forEach(cell => {
                cell.style.display = 'none';
            });
            const percentHeader = table.querySelector('[id$="-stats-percentage"]');
            if (percentHeader) percentHeader.style.display = 'none';

            // 2. Hide the Count column
            const countHeader = table.querySelector('[id$="-stats-count"]');
            if (countHeader) countHeader.style.display = 'none';
            table.querySelectorAll('[headers$="-stats-count"]').forEach(cell => {
                cell.style.display = 'none';
            });
            // Also hide the count cell in the final row
            totalRow.querySelectorAll('[headers$="-stats-count"]').forEach(cell => {
                cell.style.display = 'none';
            });

            // 3. Add "V-Avg" header
            const headerRow = table.querySelector('tr.stats-gadget-table-header');
            if (headerRow && !headerRow.querySelector('.et-velocity-header')) {
                const th = document.createElement('th');
                th.className = 'stats-gadget-numeric et-velocity-header';
                th.textContent = 'V-Avg';
                th.title = `Average velocity over the last ${sprintCount} sprint(s)`;
                headerRow.appendChild(th);
            }

            // 4. Add V-Avg to each data row
            const dataRows = table.querySelectorAll('tbody tr:not(.stats-gadget-final-row)');
            dataRows.forEach(row => {
                if (row.querySelector('.et-velocity-cell')) return;

                const nameLink = row.querySelector('[headers$="-stats-category"] a');
                const assigneeName = nameLink?.textContent?.trim() || '';
                const avg = avgByAssignee[assigneeName] || 0;
                const tooltip = tooltipByAssignee[assigneeName] || '';

                const td = document.createElement('td');
                td.className = 'cell-type-collapsed stats-gadget-numeric et-velocity-cell';
                const badge = document.createElement('span');
                badge.className = 'et-velocity-badge et-age-badge';
                badge.textContent = avg;
                badge.setAttribute('data-tooltip', tooltip);
                td.appendChild(badge);
                row.appendChild(td);
            });

            // 5. Add total V-Avg to the final row
            if (totalRow && !totalRow.querySelector('.et-velocity-cell')) {
                const finalCell = totalRow.querySelector('.final-table-cell');
                if (finalCell) finalCell.style.display = 'none';

                const td = document.createElement('td');
                td.className = 'stats-gadget-numeric stats-gadget-final-row-cell et-velocity-cell';
                const strong = document.createElement('strong');
                strong.className = 'et-velocity-total et-age-badge';
                strong.textContent = grandAvg;
                strong.setAttribute('data-tooltip', grandTooltip);
                td.appendChild(strong);
                totalRow.appendChild(td);
            }

            _etProcessedVelocityGadgets.add(velGadgetKey);
            console.debug(`PMsToolKit Velocity: Injected V-Avg for gadget "${gadgetTitle}" (${sprintCount} sprints)`);

        } catch (e) {
            console.warn('PMsToolKit Velocity: Error processing gadget', e);

            // Show error with retry button
            const errHeaderRow = table.querySelector('tr.stats-gadget-table-header');
            if (errHeaderRow && !errHeaderRow.querySelector('.et-velocity-header')) {
                const th = document.createElement('th');
                th.className = 'stats-gadget-numeric et-velocity-header et-sp-error-header';
                th.innerHTML = `<span class="et-sp-error">⚠️ V-Avg</span><button class="et-sp-retry-btn" title="Retry loading Velocity">↻</button>`;
                th.querySelector('.et-sp-retry-btn').onclick = (ev) => {
                    ev.preventDefault();
                    _etProcessedVelocityGadgets.delete(velGadgetKey);
                    th.remove();
                    injectVelocityPerDeveloper();
                };
                errHeaderRow.appendChild(th);
            }
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


// ---- Feature 12: Jira Dashboard Customization (Header & Sidebar) ----

let _etSidebarCollapsedOnLoad = false;

function hideJiraHeaderElements() {
    // Hide search bar
    const searchContainer = document.querySelector('[data-testid="search-input-container"]');
    if (searchContainer && searchContainer.style.display !== 'none') {
        searchContainer.style.display = 'none';
        console.debug('PMsToolKit: Search bar hidden');
    }

    // Hide Create button
    const createButton = document.querySelector('[data-testid="atlassian-navigation--create-button"]');
    if (createButton) {
        const parent = createButton.closest('[data-testid="ak-spotlight-target-global-create-spotlight"]') || createButton;
        if (parent.style.display !== 'none') {
            parent.style.display = 'none';
            console.debug('PMsToolKit: Create button hidden');
        }
    }

    // Hide Ask Rovo
    const askRovo = Array.from(document.querySelectorAll('button')).find(btn =>
        btn.textContent.includes('Ask Rovo') ||
        btn.getAttribute('data-testid')?.includes('ask-rovo') ||
        btn.getAttribute('aria-label')?.includes('Ask Rovo')
    );
    if (askRovo && askRovo.style.display !== 'none') {
        askRovo.style.display = 'none';
        console.debug('PMsToolKit: Ask Rovo hidden');
    }
}

function collapseJiraSidebarOnLoad() {
    if (_etSidebarCollapsedOnLoad) return;

    const sidebar = document.querySelector('[data-testid="page-layout.sidebar"]');
    if (!sidebar) return;

    const width = sidebar.offsetWidth;
    if (width > 100) {
        const collapseBtn = Array.from(document.querySelectorAll('button')).find(btn =>
            btn.textContent.includes('Collapse sidebar') ||
            btn.getAttribute('aria-label')?.includes('Collapse sidebar')
        );

        if (collapseBtn) {
            collapseBtn.click();
            _etSidebarCollapsedOnLoad = true;
            console.debug('PMsToolKit: Sidebar collapsed on load');
        }
    } else if (width > 0) {
        _etSidebarCollapsedOnLoad = true;
    }
}

let _etCachedStarredItems = null;


function renderStarredItemsMenu(items) {
    const topNav = document.querySelector('[data-testid="page-layout.top-nav"]');
    if (!topNav) return;

    let menuWrapper = document.querySelector('.et-header-menu-wrapper');
    if (!menuWrapper) {
        menuWrapper = document.createElement('div');
        menuWrapper.className = 'et-header-menu-wrapper';
        menuWrapper.style.display = 'flex';
        menuWrapper.style.alignItems = 'center';
        menuWrapper.style.position = 'relative';

        const productHome = topNav.querySelector('[data-testid="atlassian-navigation--product-home--container"]');
        if (productHome) {
            productHome.parentNode.insertBefore(menuWrapper, productHome.nextSibling);
        } else {
            topNav.prepend(menuWrapper);
        }
    }

    const linksHash = (items || []).map(i => i.href + i.title).join('|');
    let menu = menuWrapper.querySelector('.et-header-starred-menu');

    if (!menu) {
        menu = document.createElement('div');
        menu.className = 'et-header-starred-menu';
        menuWrapper.appendChild(menu);
    }

    if (menu.getAttribute('data-links-hash') !== linksHash) {
        menu.innerHTML = '';
        (items || []).forEach(item => {
            const a = document.createElement('a');
            a.className = 'et-header-starred-item';
            a.href = item.href;
            a.textContent = item.title;
            menu.appendChild(a);
        });
        menu.setAttribute('data-links-hash', linksHash);
    }

    // Edit Button (Pen)
    let editBtn = menuWrapper.querySelector('.et-menu-edit-btn');
    if (!editBtn) {
        editBtn = document.createElement('button');
        editBtn.className = 'et-menu-edit-btn';
        editBtn.innerHTML = '⋮';
        editBtn.title = 'PMsToolKit: Edit Menu';
        menuWrapper.appendChild(editBtn);

        // Menu Manager Popup
        const popup = document.createElement('div');
        popup.className = 'et-menu-manager-popup';
        popup.innerHTML = `
            <h4>Manage Jira Menu</h4>
            <div class="et-menu-manager-add-section">
                <input type="text" id="et-menu-new-title" placeholder="Title">
                <input type="text" id="et-menu-new-url" placeholder="URL">
                <button class="et-notes-save-btn" id="et-menu-add-save">Add Current Page</button>
            </div>
            <div class="et-menu-manager-list"></div>
        `;
        menuWrapper.appendChild(popup);

        editBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isVisible = popup.classList.toggle('visible');
            if (isVisible) {
                const titleInput = popup.querySelector('#et-menu-new-title');
                const urlInput = popup.querySelector('#et-menu-new-url');
                titleInput.value = document.title.replace(' - Jira', '');
                urlInput.value = window.location.pathname + window.location.search;
                renderManagerList(popup, items);
            }
        };

        const saveBtn = popup.querySelector('#et-menu-add-save');
        saveBtn.onclick = () => {
            const title = popup.querySelector('#et-menu-new-title').value.trim();
            const url = popup.querySelector('#et-menu-new-url').value.trim();
            if (title && url) {
                const newItems = [...(items || []), { title, href: url }];
                saveMenuItems(newItems);
                popup.classList.remove('visible');
            }
        };

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!menuWrapper.contains(e.target)) {
                popup.classList.remove('visible');
            }
        });
    }
}

function renderManagerList(popup, items) {
    const list = popup.querySelector('.et-menu-manager-list');
    list.innerHTML = '';

    (items || []).forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'et-menu-manager-item';
        div.draggable = true;
        div.dataset.index = index;

        div.innerHTML = `
            <div class="et-menu-drag-handle" title="Drag to reorder">⋮⋮</div>
            <span title="${item.href}">${item.title}</span>
            <button class="et-menu-manager-delete" data-index="${index}">🗑️</button>
        `;

        // Delete functionality
        div.querySelector('.et-menu-manager-delete').onclick = (e) => {
            e.stopPropagation();
            const newItems = items.filter((_, i) => i !== index);
            saveMenuItems(newItems);
            renderManagerList(popup, newItems);
        };

        // Drag and Drop Events
        div.addEventListener('dragstart', (e) => {
            div.classList.add('dragging');
            e.dataTransfer.setData('text/plain', index);
            e.dataTransfer.effectAllowed = 'move';
        });

        div.addEventListener('dragend', () => {
            div.classList.remove('dragging');
            popup.querySelectorAll('.et-menu-manager-item').forEach(el => el.classList.remove('drag-over'));
        });

        div.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            return false;
        });

        div.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (!div.classList.contains('dragging')) {
                div.classList.add('drag-over');
            }
        });

        div.addEventListener('dragleave', () => {
            div.classList.remove('drag-over');
        });

        div.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const toIndex = index;

            if (fromIndex !== toIndex) {
                const newItems = [...items];
                const [movedItem] = newItems.splice(fromIndex, 1);
                newItems.splice(toIndex, 0, movedItem);

                saveMenuItems(newItems);
                renderManagerList(popup, newItems);
            }

            return false;
        });

        list.appendChild(div);
    });
}

function saveMenuItems(items) {
    _etCachedStarredItems = items;
    safeStorage.set({ et_manual_menu_items: items });
    renderStarredItemsMenu(items);
}

function injectStarredItemsMenu() {
    if (_etCachedStarredItems) {
        renderStarredItemsMenu(_etCachedStarredItems);
        return;
    }

    // Try to load manual items first
    safeStorage.get(['et_manual_menu_items', 'et_starred_items'], (res) => {
        if (res.et_manual_menu_items) {
            _etCachedStarredItems = res.et_manual_menu_items;
        } else if (res.et_starred_items) {
            // Migration
            _etCachedStarredItems = res.et_starred_items;
            safeStorage.set({ et_manual_menu_items: res.et_starred_items });
        } else {
            _etCachedStarredItems = [];
        }
        renderStarredItemsMenu(_etCachedStarredItems);
    });
}


// ---- Main execution ----

let _etRunAllTimeout = null;
let _etIsRunning = false;

function etRunAll() {
    if (_etIsRunning) return;
    _etIsRunning = true;

    try {
        hideJiraHeaderElements();     // Feature 12: hide search/create
        collapseJiraSidebarOnLoad();  // Feature 12: auto collapse
        injectStarredItemsMenu();     // Feature 12: starred menu in header
        injectPMsToolKitJira();     // Original: copy button in list views
        injectQuickNotesListView();  // Feature 5: notes in list views
        injectQuickNotesTicketView(); // Feature 5: notes in ticket view
        injectBreadcrumbCopyButton(); // Feature 7: copy in breadcrumbs
        injectAgeIndicators();        // Feature 8: age indicator
        injectBoardCardAgeIndicators(); // Feature 8b: age on board cards
        injectStoryPointsSummary();   // Feature 9: SP summary
        injectVelocityPerDeveloper(); // Feature 11: Velocity per Dev
        injectNativeTableIcons();     // Feature 10: icons in native issue table
    } finally {
        _etIsRunning = false;
    }
}

function etRunAllDebounced() {
    if (_etRunAllTimeout) clearTimeout(_etRunAllTimeout);
    _etRunAllTimeout = setTimeout(etRunAll, 300);
}

// Run when Jira loads dynamic content
// Use a more specific observer if possible, but Jira is very dynamic
const observer = new MutationObserver((mutations) => {
    // Optimization: ignore mutations inside our own injected elements if possible
    const meaningfulMutation = mutations.some(m => {
        const target = m.target;
        if (target.closest?.('.et-header-starred-menu')) return false;
        if (target.closest?.('.et-notes-container')) return false;
        return true;
    });

    if (meaningfulMutation) {
        etRunAllDebounced();
    }
});

observer.observe(document.body, { childList: true, subtree: true });
etRunAllDebounced();
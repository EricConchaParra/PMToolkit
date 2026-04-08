import { etCopyTicketLink, etGetRowIconTarget, etGetIconContainer, formatAge, getColorClass, invokeBackgroundFetch } from '../utils';
import { storage } from '../../../common/storage';
import {
    extractTicketKeyFromSnapshotStorageKey,
    isPrSnapshotStorageKey,
    makePrSnapshotStorageKey,
    normalizeTicketKey,
} from '../../../common/githubPrStorage.js';
import { NoteDrawer } from '../ui/NoteDrawer';
import { jiraClient } from '../api-client';

let boardCardGithubListenerBound = false;

function githubButtonSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg>';
}

function buildGithubPrTitle(snapshot) {
    if (!snapshot) return 'GitHub PR';
    if (snapshot.draft) return 'GitHub PR · Draft';
    if (snapshot.state === 'merged') return 'GitHub PR · Merged';
    if (snapshot.state === 'closed') return 'GitHub PR · Closed';
    return 'GitHub PR · Open';
}

function createGithubPrButton(snapshot, isPlatformCard) {
    const button = document.createElement('a');
    button.className = 'et-notes-btn et-gh-pr-btn';
    button.href = snapshot.url;
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    button.title = buildGithubPrTitle(snapshot);
    button.innerHTML = githubButtonSvg();
    button.style.cssText = `background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:3; color:#42526e; display:inline-flex; align-items:center; margin-right:0; flex:0 0 auto;${isPlatformCard ? ' position:relative; z-index:100; pointer-events:auto;' : ''}`;

    button.onmousedown = (event) => event.stopPropagation();
    button.onmouseup = (event) => event.stopPropagation();
    button.onclick = (event) => event.stopPropagation();

    return button;
}

async function syncBoardCardGithubButton(row, issueKey, options = {}) {
    if (!row || !issueKey) return;

    const normalizedTicketKey = normalizeTicketKey(issueKey);
    row.dataset.issueKey = normalizedTicketKey;

    const items = await storage.get([makePrSnapshotStorageKey(normalizedTicketKey)]);
    const snapshot = items[makePrSnapshotStorageKey(normalizedTicketKey)] || null;
    const existingButton = row.querySelector('.et-gh-pr-btn');

    if (!snapshot?.url) {
        existingButton?.remove();
        return;
    }

    if (existingButton) {
        existingButton.href = snapshot.url;
        existingButton.title = buildGithubPrTitle(snapshot);
        return;
    }

    row.appendChild(createGithubPrButton(snapshot, options.isPlatformCard === true));
}

function bindBoardCardGithubStorageListener() {
    if (boardCardGithubListenerBound || typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        const ticketKeys = Object.keys(changes)
            .filter(key => isPrSnapshotStorageKey(key))
            .map(key => extractTicketKeyFromSnapshotStorageKey(key))
            .filter(Boolean);

        if (ticketKeys.length === 0) return;

        ticketKeys.forEach(ticketKey => {
            document
                .querySelectorAll(`.et-board-shared-row[data-issue-key="${ticketKey}"]`)
                .forEach(row => {
                    void syncBoardCardGithubButton(row, ticketKey, {
                        isPlatformCard: row.dataset.platformCard === 'true',
                    });
                });
        });
    });

    boardCardGithubListenerBound = true;
}

export const InjectionFeature = {
    injectCopyForSlack() {
        const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-added), .issuerow:not(.et-added), tr[data-testid="native-issue-table.ui.issue-row"]:not(.et-added)');
        rows.forEach(row => {
            let issueKey = row.getAttribute('data-issuekey') || row.querySelector('.key')?.innerText.trim();
            if (!issueKey) {
                const link = row.querySelector('a[href*="/browse/"]');
                if (link) {
                    const match = link.href.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i);
                    if (match) issueKey = match[1];
                }
            }
            const summaryElement = row.querySelector('.summary a, [data-field-id="summary"] a') || row.querySelector('td:nth-child(2) span'); // fallback for native table

            if (issueKey && summaryElement) {
                row.classList.add('et-added');
                const btn = document.createElement('button');
                btn.innerHTML = '🔗';
                btn.title = 'PMsToolKit: Copy for Slack';
                btn.className = 'et-notes-btn';

                btn.onclick = (e) => {
                    e.preventDefault();
                    const summaryText = summaryElement.innerText.trim();
                    const url = `https://${window.location.hostname}/browse/${issueKey}`;
                    etCopyTicketLink(issueKey, summaryText, url, btn);
                };

                const container = etGetIconContainer(row);
                btn.style.order = '2';
                container.appendChild(btn);
            }
        });
    },

    injectQuickNotes(enableList, enableTicket) {
        // List View and Native Tables
        if (enableList) {
            const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-notes-added), .issuerow:not(.et-notes-added), tr[data-testid="native-issue-table.ui.issue-row"]:not(.et-notes-added)');
            rows.forEach(row => {
                let issueKey = row.getAttribute('data-issuekey') || row.querySelector('.key')?.innerText.trim();
                if (!issueKey) {
                    const link = row.querySelector('a[href*="/browse/"]');
                    if (link) {
                        const match = link.href.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i);
                        if (match) issueKey = match[1];
                    }
                }
                if (!issueKey) return;
                row.classList.add('et-notes-added');

                const btn = document.createElement('button');
                btn.className = 'et-notes-btn';
                btn.innerHTML = '📝';
                btn.setAttribute('data-issue-key', issueKey);

                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const summaryEl = row.querySelector('.summary a, [data-field-id="summary"] a, .summary, [data-field-id="summary"]');
                    NoteDrawer.open(issueKey, summaryEl?.innerText?.trim() || '');
                };

                const container = etGetIconContainer(row);
                btn.style.order = '1';
                container.appendChild(btn);
            });
        }

        // Ticket View
        if (enableTicket) {
            const match = window.location.pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i);
            if (match) {
                const issueKey = match[1];
                const headerArea = document.querySelector('#jira-issue-header, [data-testid="issue.views.issue-details.issue-layout.container-left"]');
                if (headerArea && !headerArea.querySelector('.et-ticket-notes-panel')) {
                    const panel = document.createElement('div');
                    panel.className = 'et-ticket-notes-panel';
                    const toggle = document.createElement('button');
                    toggle.className = 'et-ticket-notes-toggle';
                    toggle.setAttribute('data-issue-key', issueKey);
                    toggle.innerHTML = '📝 <span>Personal notes</span> <span class="et-notes-save-indicator" style="margin-left:auto">✓ Saved</span>';

                    toggle.onclick = () => {
                        const summaryEl = document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"] h1, #summary-val');
                        NoteDrawer.open(issueKey, summaryEl?.innerText?.trim() || '');
                    };
                    panel.appendChild(toggle);
                    headerArea.appendChild(panel);
                }
            }
        }
    },

    injectBreadcrumbCopyButton() {
        const match = window.location.pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i);
        if (!match) return;

        const issueKey = match[1];
        const existingActions = document.querySelector('.et-breadcrumb-actions');
        if (existingActions) {
            if (existingActions.getAttribute('data-issue-key') === issueKey) return;
            existingActions.remove();
        }

        const breadcrumbItem = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.item"]');
        const breadcrumbNav = breadcrumbItem?.closest('ol');
        if (!breadcrumbNav) return;

        const url = `https://${window.location.hostname}/browse/${issueKey}`;

        const wrapper = document.createElement('div');
        wrapper.className = 'et-breadcrumb-actions';
        wrapper.setAttribute('role', 'listitem');
        wrapper.setAttribute('data-issue-key', issueKey);

        const getReliableSummary = async () => {
            console.log(`PMsToolKit: Breadcrumb clicked. document.title: "${document.title}"`);

            // 1. Try high-confidence DOM selectors
            const selectors = [
                '[data-testid="issue.views.issue-base.foundation.summary.heading"] h1',
                '#summary-val',
                '[data-testid="issue.views.issue.summary.summary-content"]',
                'h1[data-test-id="issue.views.issue-base.foundation.summary.heading"]'
            ];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                const text = el?.innerText?.trim();
                if (text) {
                    console.log(`PMsToolKit: Summary found via DOM selector: ${selector}`);
                    return text;
                }
            }

            // 2. Primary Fallback: document title (User suggested)
            const title = document.title;
            // Strategy: Strip Issue Key from start, then strip common Jira suffixes from end
            let titleSummary = title.replace(new RegExp(`^\\[?${issueKey}\\]?\\s*[:\\-\\s]*`, 'i'), '');
            titleSummary = titleSummary.replace(/\s*-\s*[^-|]*JIRA$/i, '') // Strips " - Jira" or " - Project Name - Jira"
                .replace(/\s*[\-\|]\s*JIRA$/i, '') // Strips " | Jira" or " - Jira"
                .trim();

            if (titleSummary && titleSummary !== title) {
                console.log(`PMsToolKit: Summary extracted from title: "${titleSummary}"`);
                return titleSummary;
            }

            // Super Fallback: If title manipulation didn't work but we have a title, 
            // just return the part after the first space/hyphen if it contains the key
            if (title.toLowerCase().includes(issueKey.toLowerCase())) {
                const parts = title.split(new RegExp(`\\]?\\s*[:\\-]\\s*`, 'i'));
                if (parts.length > 1) {
                    const fallback = parts[1].replace(/\s*-\s*JIRA$/i, '').trim();
                    if (fallback) return fallback;
                }
            }

            // 3. Final API Fallback
            try {
                const res = await invokeBackgroundFetch(`/rest/api/2/issue/${issueKey}?fields=summary`, {
                    headers: { 'Accept': 'application/json', 'X-Atlassian-Token': 'no-check' }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.fields?.summary) {
                        console.log(`PMsToolKit: Summary for ${issueKey} retrieved via API v2.`);
                        return data.fields.summary.trim();
                    }
                }
            } catch (e) {
                console.warn(`PMsToolKit: API fallback failed for ${issueKey}`, e);
            }

            console.error(`PMsToolKit: Could not find summary for ${issueKey} (DOM, Title, and API failed)`);
            return '';
        };

        const copyBtn = document.createElement('button');
        copyBtn.className = 'et-breadcrumb-copy';
        copyBtn.innerHTML = '🔗';
        copyBtn.onclick = async (e) => {
            e.preventDefault();
            const summary = await getReliableSummary();
            etCopyTicketLink(issueKey, summary, url, copyBtn);
        };

        const notesBtn = document.createElement('button');
        notesBtn.className = 'et-breadcrumb-copy et-notes-btn';
        notesBtn.innerHTML = '📝';
        notesBtn.setAttribute('data-issue-key', issueKey);
        notesBtn.onclick = async (e) => {
            e.preventDefault();
            const summary = await getReliableSummary();
            NoteDrawer.open(issueKey, summary);
        };

        wrapper.appendChild(copyBtn);
        wrapper.appendChild(notesBtn);
        breadcrumbNav.appendChild(wrapper);
    },

    injectBoardCardIcons() {
        bindBoardCardGithubStorageListener();

        // Classic Boards
        const cards = document.querySelectorAll('.ghx-issue:not(.et-icons-added)');
        cards.forEach(card => {
            const issueKey = card.getAttribute('data-issue-key');
            if (!issueKey) return;

            const targetContainer = card.querySelector('.ghx-card-footer') || card.querySelector('.ghx-highlighted-fields');
            if (!targetContainer) return;

            card.classList.add('et-icons-added');

            let row = targetContainer.querySelector('.et-board-shared-row');
            if (!row) {
                row = document.createElement('div');
                row.className = 'et-board-shared-row';
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '4px';
                row.style.marginTop = '4px';
                row.style.width = '100%';
                row.style.flexBasis = '100%';
                row.style.flexWrap = 'nowrap';
                row.style.justifyContent = 'flex-start';
                row.style.clear = 'both';
                targetContainer.appendChild(row);
            }
            row.dataset.issueKey = normalizeTicketKey(issueKey);
            row.dataset.platformCard = 'false';

            // Note button
            const noteBtn = document.createElement('button');
            noteBtn.className = 'et-notes-btn';
            noteBtn.innerHTML = '📝';
            noteBtn.setAttribute('data-issue-key', issueKey);
            noteBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:1; margin-right:0; flex:0 0 auto;';
            noteBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const summaryEl = card.querySelector('.ghx-summary');
                NoteDrawer.open(issueKey, summaryEl?.innerText?.trim() || '');
            };

            // Link button
            const linkBtn = document.createElement('button');
            linkBtn.innerHTML = '🔗';
            linkBtn.title = 'PMsToolKit: Copy for Slack';
            linkBtn.className = 'et-notes-btn';
            linkBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:2; margin-right:0; flex:0 0 auto;';
            linkBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const summaryEl = card.querySelector('.ghx-summary');
                const summaryText = summaryEl?.innerText?.trim() || '';
                const url = `https://${window.location.hostname}/browse/${issueKey}`;
                etCopyTicketLink(issueKey, summaryText, url, linkBtn);
            };

            row.appendChild(noteBtn);
            row.appendChild(linkBtn);
            void syncBoardCardGithubButton(row, issueKey, { isPlatformCard: false });
        });

        // Next-Gen Platform Cards
        const platformCards = document.querySelectorAll('button[data-testid="platform-card.ui.card.focus-container"]');
        platformCards.forEach(btn => {
            const card = btn.closest('div[draggable]') || btn.parentElement;
            if (!card || card.classList.contains('et-icons-added')) return;

            const ariaLabel = btn.getAttribute('aria-label') || '';
            const match = ariaLabel.match(/^([A-Z][A-Z0-9]*-\d+)\s+(.+?)(?:\.\s*Use the enter key|$)/i);
            let issueKey = match ? match[1] : null;
            let summaryText = match ? match[2] : '';

            if (!issueKey) {
                const keyEl = card.querySelector('[data-testid="platform-card.common.ui.key.key"]');
                if (keyEl) issueKey = keyEl.textContent.trim();
                const summaryEl = card.querySelector('[data-testid="platform-card.ui.card.card-content.card-summary"], .yse7za_summary');
                if (summaryEl) summaryText = summaryEl.textContent.trim();
            }

            if (!issueKey) return;

            const targetContainer = card.querySelector('[data-testid="platform-card.ui.card.card-content.footer"], .yse7za_content');
            if (!targetContainer) return;

            card.classList.add('et-icons-added');

            let row = targetContainer.querySelector('.et-board-shared-row');
            if (!row) {
                row = document.createElement('div');
                row.className = 'et-board-shared-row';
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '4px';
                row.style.marginTop = '8px';
                row.style.paddingTop = '8px';
                row.style.borderTop = '1px solid var(--ds-border, #DFE1E6)';
                row.style.position = 'relative';
                row.style.zIndex = '100';
                row.style.pointerEvents = 'auto';
                row.style.width = '100%';
                row.style.flexBasis = '100%';
                row.style.flexWrap = 'nowrap';
                row.style.justifyContent = 'flex-start';
                if (targetContainer.classList.contains('yse7za_content')) {
                    row.style.margin = '8px 12px 12px 12px';
                    row.style.borderTop = 'none';
                    row.style.paddingTop = '0';
                }
                targetContainer.appendChild(row);
            }
            row.dataset.issueKey = normalizeTicketKey(issueKey);
            row.dataset.platformCard = 'true';

            // Note button
            const noteBtn = document.createElement('button');
            noteBtn.className = 'et-notes-btn';
            noteBtn.innerHTML = '📝';
            noteBtn.setAttribute('data-issue-key', issueKey);
            noteBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:1; position:relative; z-index:100; pointer-events:auto; margin-right:0; flex:0 0 auto;';
            noteBtn.onmousedown = (e) => e.stopPropagation();
            noteBtn.onmouseup = (e) => e.stopPropagation();
            noteBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                NoteDrawer.open(issueKey, summaryText);
            };

            // Link button
            const linkBtn = document.createElement('button');
            linkBtn.innerHTML = '🔗';
            linkBtn.title = 'PMsToolKit: Copy for Slack';
            linkBtn.className = 'et-notes-btn';
            linkBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:2; position:relative; z-index:100; pointer-events:auto; margin-right:0; flex:0 0 auto;';
            linkBtn.onmousedown = (e) => e.stopPropagation();
            linkBtn.onmouseup = (e) => e.stopPropagation();
            linkBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = `https://${window.location.hostname}/browse/${issueKey}`;
                etCopyTicketLink(issueKey, summaryText, url, linkBtn);
            };

            row.appendChild(noteBtn);
            row.appendChild(linkBtn);
            void syncBoardCardGithubButton(row, issueKey, { isPlatformCard: true });
        });
    }
};

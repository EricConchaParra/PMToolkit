import { etCopyTicketLink, etGetRowIconTarget, etGetIconContainer, formatAge, getColorClass } from '../utils';
import { NoteDrawer } from '../ui/NoteDrawer';
import { jiraClient } from '../api-client';

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

    injectQuickNotes() {
        // List View and Native Tables
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

        // Ticket View
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
    },

    injectBreadcrumbCopyButton() {
        const match = window.location.pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/i);
        if (!match || document.querySelector('.et-breadcrumb-copy')) return;

        const issueKey = match[1];
        const breadcrumbItem = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.item"]');
        const breadcrumbNav = breadcrumbItem?.closest('ol');
        if (!breadcrumbNav) return;

        const summaryEl = document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"] h1, #summary-val');
        const url = `https://${window.location.hostname}/browse/${issueKey}`;

        const wrapper = document.createElement('div');
        wrapper.className = 'et-breadcrumb-actions';
        wrapper.setAttribute('role', 'listitem');

        const copyBtn = document.createElement('button');
        copyBtn.className = 'et-breadcrumb-copy';
        copyBtn.innerHTML = '🔗';
        copyBtn.onclick = (e) => {
            e.preventDefault();
            etCopyTicketLink(issueKey, summaryEl?.innerText?.trim() || '', url, copyBtn);
        };

        const notesBtn = document.createElement('button');
        notesBtn.className = 'et-breadcrumb-copy et-notes-btn';
        notesBtn.innerHTML = '📝';
        notesBtn.setAttribute('data-issue-key', issueKey);
        notesBtn.onclick = (e) => {
            e.preventDefault();
            NoteDrawer.open(issueKey, summaryEl?.innerText?.trim() || '');
        };

        wrapper.appendChild(copyBtn);
        wrapper.appendChild(notesBtn);
        breadcrumbNav.appendChild(wrapper);
    },

    injectBoardCardIcons() {
        // Classic Boards
        const cards = document.querySelectorAll('.ghx-issue:not(.et-icons-added)');
        cards.forEach(card => {
            const issueKey = card.getAttribute('data-issue-key');
            if (!issueKey) return;

            const targetContainer = card.querySelector('.ghx-highlighted-fields, .ghx-card-footer');
            if (!targetContainer) return;

            card.classList.add('et-icons-added');

            let row = targetContainer.querySelector('.et-board-shared-row');
            if (!row) {
                row = document.createElement('div');
                row.className = 'et-board-shared-row';
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '8px';
                row.style.marginTop = '4px';
                targetContainer.appendChild(row);
            }

            // Note button
            const noteBtn = document.createElement('button');
            noteBtn.className = 'et-notes-btn';
            noteBtn.innerHTML = '📝';
            noteBtn.setAttribute('data-issue-key', issueKey);
            noteBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:1;';
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
            linkBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:2;';
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
                row.style.gap = '8px';
                row.style.marginTop = '8px';
                row.style.paddingTop = '8px';
                row.style.borderTop = '1px solid var(--ds-border, #DFE1E6)';
                row.style.position = 'relative';
                row.style.zIndex = '100';
                row.style.pointerEvents = 'auto';
                if (targetContainer.classList.contains('yse7za_content')) {
                    row.style.margin = '8px 12px 12px 12px';
                    row.style.borderTop = 'none';
                    row.style.paddingTop = '0';
                }
                targetContainer.appendChild(row);
            }

            // Note button
            const noteBtn = document.createElement('button');
            noteBtn.className = 'et-notes-btn';
            noteBtn.innerHTML = '📝';
            noteBtn.setAttribute('data-issue-key', issueKey);
            noteBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:1; position:relative; z-index:100; pointer-events:auto;';
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
            linkBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:0; font-size:12px; order:2; position:relative; z-index:100; pointer-events:auto;';
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
        });
    }
};

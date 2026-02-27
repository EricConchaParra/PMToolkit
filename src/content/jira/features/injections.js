import { etCopyTicketLink } from '../utils';
import { NoteDrawer } from '../ui/NoteDrawer';
import { jiraClient } from '../api-client';
import { formatAge, getColorClass } from '../utils';

export const InjectionFeature = {
    injectCopyForSlack() {
        const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-added), .issuerow:not(.et-added)');
        rows.forEach(row => {
            const issueKey = row.getAttribute('data-issuekey') || row.querySelector('.key')?.innerText.trim();
            const summaryElement = row.querySelector('.summary a, [data-field-id="summary"] a');

            if (issueKey && summaryElement) {
                row.classList.add('et-added');
                const btn = document.createElement('button');
                btn.innerHTML = '🔗';
                btn.title = 'PMsToolKit: Copy for Slack';
                btn.className = 'et-copy-slack-btn';

                btn.onclick = (e) => {
                    e.preventDefault();
                    const summaryText = summaryElement.innerText.trim();
                    const url = `https://${window.location.hostname}/browse/${issueKey}`;
                    etCopyTicketLink(issueKey, summaryText, url, btn);
                };

                const target = row.querySelector('.key, .issuetype') || row.querySelector('td') || row;
                if (target.prepend) target.prepend(btn);
                else target.parentNode.insertBefore(btn, target);
            }
        });
    },

    injectQuickNotes() {
        // List View
        const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-notes-added), .issuerow:not(.et-notes-added)');
        rows.forEach(row => {
            const issueKey = row.getAttribute('data-issuekey') || row.querySelector('.key')?.innerText.trim();
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

            const target = row.querySelector('.key, .issuetype') || row.querySelector('td') || row;
            if (target.prepend) target.prepend(btn);
            else target.parentNode.insertBefore(btn, target);
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
    }
};

import { jiraClient } from '../api-client';
import { etEnsureCustomFields, formatAge, getColorClass, getGadgetTitle, getJiraHost, etGetRowIconTarget, etGetIconContainer, invokeBackgroundFetch, formatTooltipDate } from '../utils';

const PROCESSED_BADGES = new Set();
const PROCESSED_GADGETS = new Set();

function injectSpColumn(table, totalRow, spByGroup = {}, grandTotal = 0, warning = '') {
    const headerRow = table.querySelector('tr.stats-gadget-table-header');
    if (headerRow && !headerRow.querySelector('.et-sp-header')) {
        const th = document.createElement('th');
        th.className = 'stats-gadget-numeric et-sp-header';
        th.textContent = 'SP';
        if (warning) th.title = warning;
        headerRow.querySelector('[id$="-stats-count"]')?.insertAdjacentElement('afterend', th);
    }

    table.querySelectorAll('tbody tr:not(.stats-gadget-final-row)').forEach(row => {
        if (row.querySelector('.et-sp-cell')) return;
        const groupValue = row.querySelector('[headers$="-stats-category"]')?.textContent?.trim() || '';
        const td = document.createElement('td');
        td.className = 'stats-gadget-numeric et-sp-cell';
        if (warning) td.title = warning;
        td.innerHTML = `<strong class="et-sp-value">${spByGroup[groupValue] || 0}</strong>`;
        row.querySelector('[headers$="-stats-count"]')?.insertAdjacentElement('afterend', td);
    });

    if (totalRow && !totalRow.querySelector('.et-sp-cell')) {
        const td = document.createElement('td');
        td.className = 'stats-gadget-numeric stats-gadget-final-row-cell et-sp-cell';
        if (warning) td.title = warning;
        td.innerHTML = `<strong class="et-sp-total">${grandTotal}</strong>`;
        totalRow.querySelector('[headers$="-stats-count"]')?.insertAdjacentElement('afterend', td);
    }
}

export const MetricsFeature = {
    async injectAgeIndicators() {
        // List view rows
        const rows = document.querySelectorAll('.issuerow:not(.et-badge-added), tr[data-issuekey]:not(.et-badge-added), tr[data-testid="native-issue-table.ui.issue-row"]:not(.et-badge-added)');
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

            row.classList.add('et-badge-added');

            const container = etGetIconContainer(row);
            if (!container) return;

            const badge = document.createElement('span');
            badge.className = 'et-age-badge et-age-loading';
            badge.textContent = '...';
            badge.style.order = '3';

            container.appendChild(badge);

            jiraClient.getLastStatusChangeDate(issueKey).then(data => {
                if (data) {
                    const diff = Date.now() - new Date(data.changedDate);
                    badge.textContent = formatAge(diff);
                    badge.className = `et-age-badge ${getColorClass(diff)}`;
                    const dateStr = formatTooltipDate(data.changedDate);
                    const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                    badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} ${dateStr}`);
                } else {
                    badge.remove();
                }
            });
        });

        // Breadcrumbs age
        const breadcrumbIssue = document.querySelector('#key-val, [data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]');
        if (breadcrumbIssue && !breadcrumbIssue.querySelector('.et-badge-added-crumb')) {
            const issueKey = breadcrumbIssue.textContent.trim();
            if (issueKey) {
                const marker = document.createElement('span');
                marker.className = 'et-badge-added-crumb';
                marker.style.display = 'none';
                breadcrumbIssue.appendChild(marker);
                const badge = document.createElement('span');
                badge.className = 'et-age-badge et-age-loading';
                badge.style.marginLeft = '10px';
                breadcrumbIssue.appendChild(badge);

                jiraClient.getLastStatusChangeDate(issueKey).then(data => {
                    if (data) {
                        const diff = Date.now() - new Date(data.changedDate);
                        badge.textContent = formatAge(diff);
                        badge.className = `et-age-badge ${getColorClass(diff)}`;
                        const dateStr = formatTooltipDate(data.changedDate);
                        const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                        badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} ${dateStr}`);
                    }
                });
            }
        }
    },

    async injectBoardCardAgeIndicators() {
        const cards = document.querySelectorAll('.ghx-issue:not(.et-badge-added)');
        cards.forEach(card => {
            const issueKey = card.getAttribute('data-issue-key');
            if (!issueKey) return;

            card.classList.add('et-badge-added');

            const targetContainer = card.querySelector('.ghx-highlighted-fields, .ghx-card-footer');
            if (!targetContainer) return;

            const badge = document.createElement('span');
            badge.className = 'et-age-badge et-board-age et-age-loading';
            badge.textContent = '...';
            badge.style.order = '3';

            let badgeRow = targetContainer.querySelector('.et-board-shared-row');
            if (!badgeRow) {
                badgeRow = document.createElement('div');
                badgeRow.className = 'et-board-shared-row';
                badgeRow.style.display = 'flex';
                badgeRow.style.alignItems = 'center';
                badgeRow.style.gap = '8px';
                badgeRow.style.marginTop = '4px';
                targetContainer.appendChild(badgeRow);
            }
            badgeRow.prepend(badge);

            jiraClient.getLastStatusChangeDate(issueKey).then(data => {
                if (data) {
                    const diff = Date.now() - new Date(data.changedDate);
                    badge.textContent = formatAge(diff);
                    badge.className = `et-age-badge ${getColorClass(diff)} et-board-age`;
                    const dateStr = formatTooltipDate(data.changedDate);
                    const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                    badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} ${dateStr}`);
                }
            });
        });

        // Next-Gen Platform Cards
        const platformCards = document.querySelectorAll('button[data-testid="platform-card.ui.card.focus-container"]');
        platformCards.forEach(btn => {
            const card = btn.closest('div[draggable]') || btn.parentElement;
            if (!card || card.classList.contains('et-badge-added')) return;

            const ariaLabel = btn.getAttribute('aria-label') || '';
            const match = ariaLabel.match(/^([A-Z][A-Z0-9]*-\d+)\s+(.+?)(?:\.\s*Use the enter key|$)/i);
            let issueKey = match ? match[1] : null;

            if (!issueKey) {
                const keyEl = card.querySelector('[data-testid="platform-card.common.ui.key.key"]');
                if (keyEl) issueKey = keyEl.textContent.trim();
            }

            if (!issueKey) return;

            const targetContainer = card.querySelector('[data-testid="platform-card.ui.card.card-content.footer"], .yse7za_content');
            if (!targetContainer) return;

            card.classList.add('et-badge-added');

            const badge = document.createElement('span');
            badge.className = 'et-age-badge et-board-age et-age-loading';
            badge.textContent = '...';
            badge.style.order = '3';

            let badgeRow = targetContainer.querySelector('.et-board-shared-row');
            if (!badgeRow) {
                badgeRow = document.createElement('div');
                badgeRow.className = 'et-board-shared-row';
                badgeRow.style.display = 'flex';
                badgeRow.style.alignItems = 'center';
                badgeRow.style.gap = '8px';
                badgeRow.style.marginTop = '8px';
                badgeRow.style.paddingTop = '8px';
                badgeRow.style.borderTop = '1px solid var(--ds-border, #DFE1E6)';
                badgeRow.style.position = 'relative';
                badgeRow.style.zIndex = '2';
                if (targetContainer.classList.contains('yse7za_content')) {
                    badgeRow.style.margin = '8px 12px 12px 12px';
                    badgeRow.style.borderTop = 'none';
                    badgeRow.style.paddingTop = '0';
                }
                targetContainer.appendChild(badgeRow);
            }
            badgeRow.prepend(badge);

            jiraClient.getLastStatusChangeDate(issueKey).then(data => {
                if (data) {
                    const diff = Date.now() - new Date(data.changedDate);
                    badge.textContent = formatAge(diff);
                    badge.className = `et-age-badge ${getColorClass(diff)} et-board-age`;
                    const dateStr = formatTooltipDate(data.changedDate);
                    const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                    badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} ${dateStr}`);
                }
            });
        });
    },

    async injectStoryPointsSummary() {
        console.log('PMsToolKit: Checking for SP Summary gadgets...');
        const tables = document.querySelectorAll('table.stats-gadget-table');
        if (tables.length === 0) return;

        const { sp: fieldId, spResolution } = await etEnsureCustomFields();
        const fallbackWarning = spResolution?.warning || 'Story Points could not be resolved for this Jira site. Showing 0 SP.';
        if (!fieldId) {
            console.warn('PMsToolKit: Story Points field not resolved. Falling back to 0 SP.', spResolution);
        } else {
            console.log(`PMsToolKit: Found ${tables.length} tables, using SP Field: ${fieldId}`);
        }

        for (const table of tables) {
            const container = table.closest('[id^="gadget-content-"]') || table.closest('[id^="gadget-"]');
            const gadgetId = container?.id || '';
            const title = getGadgetTitle(container);

            if (PROCESSED_GADGETS.has(gadgetId) || title.toLowerCase().includes('velocity')) continue;
            if (table.querySelector('.et-sp-header')) continue;

            const totalRow = table.querySelector('tr.stats-gadget-final-row');
            const totalLink = totalRow?.querySelector('a[href*="jql="], a[href*="filter="]');
            if (!totalLink) continue;

            let jql;
            try {
                const url = new URL(totalLink.href);
                jql = url.searchParams.get('jql');
                if (!jql) {
                    const filterId = url.searchParams.get('filter');
                    if (filterId) jql = `filter=${filterId}`;
                }
            } catch (e) {
                jql = totalLink.href.match(/[?&]jql=([^&]+)/)?.[1];
                if (jql) jql = decodeURIComponent(jql);
                else {
                    const filterMatch = totalLink.href.match(/[?&]filter=([^&]+)/)?.[1];
                    if (filterMatch) jql = `filter=${filterMatch}`;
                }
            }
            if (!jql) continue;

            const jqlClean = jql.replace(/\s+ORDER\s+BY\s+.*/i, '');

            // Synchronous check to prevent race conditions from MutationObserver
            if (table.classList.contains('et-sp-processing')) continue;
            table.classList.add('et-sp-processing');

            try {
                // Detect grouping field
                const groupHeader = table.querySelector('th[id$="-stats-category"], th[headers$="-stats-category"]');
                const groupName = groupHeader?.textContent?.trim() || 'Assignee';
                const isStatusGroup = groupName.toLowerCase() === 'status';

                const spByGroup = {};
                let grandTotal = 0;
                let warning = '';

                if (fieldId) {
                    const res = await invokeBackgroundFetch(`/rest/api/3/search/jql`, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
                        body: JSON.stringify({ jql: jqlClean, fields: [fieldId, 'assignee', 'status'], maxResults: 200 })
                    });
                    if (!res.ok) continue;
                    const data = await res.json();

                    (data.issues || []).forEach(issue => {
                        const sp = Number(issue.fields?.[fieldId] || 0);
                        let groupValue;

                        if (isStatusGroup) {
                            groupValue = issue.fields?.status?.name || 'Unknown';
                        } else {
                            groupValue = issue.fields?.assignee?.displayName || 'Unassigned';
                        }

                        spByGroup[groupValue] = (spByGroup[groupValue] || 0) + sp;
                        grandTotal += sp;
                    });
                } else {
                    warning = fallbackWarning;
                }

                injectSpColumn(table, totalRow, spByGroup, grandTotal, warning);

                PROCESSED_GADGETS.add(gadgetId);
            } catch (e) {
                console.warn('PMsToolKit: SP error', e);
            } finally {
                table.classList.remove('et-sp-processing');
            }
        }
    },

};

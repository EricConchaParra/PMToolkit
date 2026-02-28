import { jiraClient } from '../api-client';
import { etEnsureCustomFields, formatAge, getColorClass, getGadgetTitle, getJiraHost, etGetRowIconTarget, etGetIconContainer } from '../utils';

const PROCESSED_BADGES = new Set();
const PROCESSED_GADGETS = new Set();
const BOARD_ID_CACHE = {};

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
                    const changedDate = new Date(data.changedDate);
                    const month = changedDate.toLocaleString('en-US', { month: 'short' });
                    const day = changedDate.getDate();
                    const time = changedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    const dateStr = `${month} ${day}, ${time}`;
                    const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                    badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} on ${dateStr}`);
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
                        const changedDate = new Date(data.changedDate);
                        const month = changedDate.toLocaleString('en-US', { month: 'short' });
                        const day = changedDate.getDate();
                        const time = changedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                        const dateStr = `${month} ${day}, ${time}`;
                        const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                        badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} on ${dateStr}`);
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
                    const changedDate = new Date(data.changedDate);
                    const month = changedDate.toLocaleString('en-US', { month: 'short' });
                    const day = changedDate.getDate();
                    const time = changedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    const dateStr = `${month} ${day}, ${time}`;
                    const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                    badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} on ${dateStr}`);
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
                    const changedDate = new Date(data.changedDate);
                    const month = changedDate.toLocaleString('en-US', { month: 'short' });
                    const day = changedDate.getDate();
                    const time = changedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    const dateStr = `${month} ${day}, ${time}`;
                    const byText = data.changedBy ? ` by ${data.changedBy}` : '';
                    badge.setAttribute('data-tooltip', `Moved to: ${data.statusName}${byText} on ${dateStr}`);
                }
            });
        });
    },

    async injectStoryPointsSummary() {
        console.log('PMsToolKit: Checking for SP Summary gadgets...');
        const tables = document.querySelectorAll('table.stats-gadget-table');
        if (tables.length === 0) return;

        const { sp: fieldId } = await etEnsureCustomFields();
        if (!fieldId) {
            console.warn('PMsToolKit: Story Points field not found. Analytics disabled.');
            return;
        }
        console.log(`PMsToolKit: Found ${tables.length} tables, using SP Field: ${fieldId}`);

        for (const table of tables) {
            const container = table.closest('[id^="gadget-content-"]') || table.closest('[id^="gadget-"]');
            const gadgetId = container?.id || '';
            const title = getGadgetTitle(container);

            if (PROCESSED_GADGETS.has(gadgetId) || title.toLowerCase().includes('velocity')) continue;
            if (table.querySelector('.et-sp-header')) continue;

            const totalRow = table.querySelector('tr.stats-gadget-final-row');
            const totalLink = totalRow?.querySelector('a[href*="jql="]');
            if (!totalLink) continue;

            let jql;
            try {
                jql = new URL(totalLink.href).searchParams.get('jql');
            } catch (e) {
                jql = totalLink.href.match(/jql=([^&]+)/)?.[1];
                if (jql) jql = decodeURIComponent(jql);
            }
            if (!jql) continue;

            const jqlClean = jql.replace(/\s+ORDER\s+BY\s+.*/i, '');

            // Synchronous check to prevent race conditions from MutationObserver
            if (table.classList.contains('et-sp-processing')) continue;
            table.classList.add('et-sp-processing');

            try {
                const res = await fetch(`/rest/api/3/search/jql`, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
                    body: JSON.stringify({ jql: jqlClean, fields: [fieldId, 'assignee'], maxResults: 200 })
                });
                if (!res.ok) continue;
                const data = await res.json();

                const spByAssignee = {};
                let grandTotal = 0;

                (data.issues || []).forEach(issue => {
                    const sp = Number(issue.fields?.[fieldId] || 0);
                    const name = issue.fields?.assignee?.displayName || 'Unassigned';
                    spByAssignee[name] = (spByAssignee[name] || 0) + sp;
                    grandTotal += sp;
                });

                // Modify UI
                // Kept percentage bars as requested by user

                const headerRow = table.querySelector('tr.stats-gadget-table-header');
                const th = document.createElement('th');
                th.className = 'stats-gadget-numeric et-sp-header';
                th.textContent = 'SP';
                headerRow?.querySelector('[id$="-stats-count"]')?.insertAdjacentElement('afterend', th);

                table.querySelectorAll('tbody tr:not(.stats-gadget-final-row)').forEach(row => {
                    const name = row.querySelector('[headers$="-stats-category"] a')?.textContent?.trim() || '';
                    const td = document.createElement('td');
                    td.className = 'stats-gadget-numeric et-sp-cell';
                    td.innerHTML = `<strong class="et-sp-value">${spByAssignee[name] || 0}</strong>`;
                    row.querySelector('[headers$="-stats-count"]')?.insertAdjacentElement('afterend', td);
                });

                if (totalRow) {
                    const td = document.createElement('td');
                    td.className = 'stats-gadget-numeric stats-gadget-final-row-cell et-sp-cell';
                    td.innerHTML = `<strong class="et-sp-total">${grandTotal}</strong>`;
                    totalRow.querySelector('[headers$="-stats-count"]')?.insertAdjacentElement('afterend', td);
                }

                PROCESSED_GADGETS.add(gadgetId);
            } catch (e) {
                console.warn('PMsToolKit: SP error', e);
            } finally {
                table.classList.remove('et-sp-processing');
            }
        }
    },

    async injectVelocityPerDeveloper() {
        console.log('PMsToolKit: Checking for Velocity gadgets...');
        const tables = document.querySelectorAll('table.stats-gadget-table');
        if (tables.length === 0) return;

        const { sp: fieldId } = await etEnsureCustomFields();
        if (!fieldId) return;

        for (const table of tables) {
            const container = table.closest('[id^="gadget-content-"]') || table.closest('[id^="gadget-"]');
            const title = getGadgetTitle(container);
            if (!title.toLowerCase().includes('velocity') || PROCESSED_GADGETS.has(`vel-${container?.id}`)) continue;

            const totalRow = table.querySelector('tr.stats-gadget-final-row');
            const jqlLink = totalRow?.querySelector('a[href*="jql="]');
            if (!jqlLink) continue;

            let jql;
            try { jql = new URL(jqlLink.href).searchParams.get('jql'); } catch (e) { jql = jqlLink.href.match(/jql=([^&]+)/)?.[1]; if (jql) jql = decodeURIComponent(jql); }
            const projectKey = jql?.match(/project\s*=\s*"?([A-Z0-9]+)"?/i)?.[1];
            if (!projectKey) continue;

            // Synchronous check to prevent race conditions from MutationObserver
            if (table.querySelector('.et-velocity-header') || table.classList.contains('et-velocity-processing')) continue;
            table.classList.add('et-velocity-processing');

            try {
                // Get board
                if (BOARD_ID_CACHE[projectKey] === undefined) {
                    const res = await fetch(`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&type=scrum&maxResults=1`);
                    BOARD_ID_CACHE[projectKey] = (await res.json()).values?.[0]?.id || null;
                }
                const boardId = BOARD_ID_CACHE[projectKey];
                if (!boardId) continue;

                // Get last 3 closed sprints
                const sprintRes = await fetch(`/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=50`);
                const sprints = (await sprintRes.json()).values?.slice(-3) || [];
                if (sprints.length === 0) continue;

                // Fetch issues for each sprint
                const sprintResults = await Promise.all(sprints.map(async s => {
                    const res = await fetch(`/rest/api/3/search/jql`, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
                        body: JSON.stringify({ jql: `sprint = ${s.id} AND statusCategory = Done`, fields: [fieldId, 'assignee'], maxResults: 200 })
                    });
                    return { name: s.name, issues: (await res.json()).issues || [] };
                }));

                const spByAssignee = {};
                let grandTotal = 0;
                sprintResults.forEach(sr => {
                    const sprintTotals = {};
                    sr.issues.forEach(issue => {
                        const name = issue.fields?.assignee?.displayName || 'Unassigned';
                        const sp = Number(issue.fields?.[fieldId] || 0);
                        sprintTotals[name] = (sprintTotals[name] || 0) + sp;
                    });
                    Object.entries(sprintTotals).forEach(([name, sp]) => {
                        if (!spByAssignee[name]) spByAssignee[name] = { total: 0, details: [] };
                        spByAssignee[name].total += sp;
                        const cleanName = sr.name.replace(/^Sprint\s+/i, '');
                        spByAssignee[name].details.push(`Sprint ${cleanName} (${sp}SP)`);
                        grandTotal += sp;
                    });
                });

                // UI injection
                table.querySelectorAll('[id$="-stats-count"], [headers$="-stats-count"]').forEach(c => c.style.display = 'none');

                const hr = table.querySelector('tr.stats-gadget-table-header');
                const th = document.createElement('th');
                th.className = 'stats-gadget-numeric et-velocity-header';
                th.textContent = 'V-Avg';

                const countHeader = hr?.querySelector('[id$="-stats-count"]');
                if (countHeader) countHeader.insertAdjacentElement('afterend', th);
                else hr?.appendChild(th);

                table.querySelectorAll('tbody tr:not(.stats-gadget-final-row)').forEach(row => {
                    const name = row.querySelector('[headers$="-stats-category"] a')?.textContent?.trim() || '';
                    const data = spByAssignee[name] || { total: 0, details: [] };
                    const avg = Math.round((data.total / sprints.length) * 10) / 10;
                    const td = document.createElement('td');
                    td.className = 'stats-gadget-numeric et-velocity-cell';
                    td.innerHTML = `<span class="et-velocity-badge" data-tooltip="${data.details.join(' + ')}">${avg}</span>`;

                    const countCell = row.querySelector('[headers$="-stats-count"]');
                    if (countCell) countCell.insertAdjacentElement('afterend', td);
                    else row.appendChild(td);
                });

                if (totalRow) {
                    const avg = Math.round((grandTotal / sprints.length) * 10) / 10;
                    const td = document.createElement('td');
                    td.className = 'stats-gadget-numeric et-velocity-cell';
                    td.innerHTML = `<strong class="et-velocity-total">${avg}</strong>`;

                    const totalCountCell = totalRow.querySelector('[headers$="-stats-count"]');
                    if (totalCountCell) totalCountCell.insertAdjacentElement('afterend', td);
                    else totalRow.appendChild(td);
                }

                PROCESSED_GADGETS.add(`vel-${container.id}`);
            } catch (e) {
                console.warn('PMsToolKit: Velocity error', e);
            } finally {
                table.classList.remove('et-velocity-processing');
            }
        }
    }
};

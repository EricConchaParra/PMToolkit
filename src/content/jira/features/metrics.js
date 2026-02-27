import { jiraApi } from '../../../common/jira-api';
import { jiraClient } from '../api-client';
import { formatAge, getColorClass, getGadgetTitle, etEnqueue } from '../utils';

export const MetricsFeature = {
    async injectAgeIndicators() {
        const rows = document.querySelectorAll('tr[data-issuekey]:not(.et-age-added), .issuerow:not(.et-age-added)');
        rows.forEach(async row => {
            const issueKey = row.getAttribute('data-issuekey') || row.querySelector('.key')?.innerText.trim();
            if (!issueKey) return;
            row.classList.add('et-age-added');

            const ageBadge = document.createElement('span');
            ageBadge.className = 'et-age-badge et-age-loading';
            ageBadge.textContent = '⏳';

            const target = row.querySelector('.key, .issuetype') || row.querySelector('td') || row;
            target.appendChild(ageBadge);

            const result = await jiraClient.getLastStatusChangeDate(issueKey);
            if (!result) {
                ageBadge.textContent = '⚠️';
                ageBadge.className = 'et-age-badge';
                return;
            }

            const diffMs = Date.now() - new Date(result.changedDate);
            ageBadge.textContent = formatAge(diffMs);
            ageBadge.className = `et-age-badge ${getColorClass(diffMs)}`;
            ageBadge.setAttribute('data-tooltip', `In "${result.statusName}" since ${new Date(result.changedDate).toLocaleString()}`);
        });
    },

    async injectBoardCardAgeIndicators() {
        const cards = document.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-node-index"]:not(.et-board-age-added)');
        cards.forEach(async card => {
            const issueKey = card.querySelector('[data-testid*="issue-key"]')?.textContent?.trim();
            if (!issueKey) return;
            card.classList.add('et-board-age-added');

            const container = document.createElement('div');
            container.className = 'et-board-age-container';

            const ageBadge = document.createElement('span');
            ageBadge.className = 'et-age-badge et-age-loading';
            ageBadge.textContent = '⏳';
            container.appendChild(ageBadge);

            card.appendChild(container);

            const result = await jiraClient.getLastStatusChangeDate(issueKey);
            if (result) {
                const diffMs = Date.now() - new Date(result.changedDate);
                ageBadge.textContent = formatAge(diffMs);
                ageBadge.className = `et-age-badge ${getColorClass(diffMs)}`;
            }
        });
    },

    async injectVelocity(table, gadgetId) {
        // Logic from injectVelocityPerDeveloper...
    },

    async injectStoryPoints(table, gadgetId) {
        // Logic from injectStoryPointsSummary...
    }
};

/**
 * PMsToolKit — Analytics Hub
 * Developer card renderer — one card per assignee in the sprint dashboard
 */

import { getTagInlineStyle, getTagObjects } from '../../../../common/tagging.js';
import { buildBoardColumnBuckets, resolveIssueBoardColumn, summarizeBoardBuckets } from '../boardFlow.js';
import { escapeHtml, formatDate, formatHours, calculateETA, spToHours, truncate, workingHoursElapsed, workingHoursBetween } from '../utils.js';

export function getInitialsOrImg(assignee) {
    if (!assignee) return { initials: '?', imgUrl: null };
    const avatarUrls = assignee.avatarUrls;
    const imgUrl = avatarUrls?.['48x48'] || avatarUrls?.['32x32'] || null;
    const name = assignee.displayName || '';
    const parts = name.split(' ').filter(Boolean);
    const initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    return { initials, imgUrl };
}

function getIssueToneClass(issue, boardFlow) {
    const column = resolveIssueBoardColumn(issue, boardFlow);
    return column ? `board-tone-${column.tone}` : 'board-tone-todo';
}

export function renderDevCard(devData, sprintEndDate, settings, jiraHost, tracking = {}, boardFlow) {
    const { assignee, issues, velocity } = devData;
    const { hoursPerDay, spHours } = settings;
    const notesMap = tracking.notesMap || {};
    const tagsMap = tracking.tagsMap || {};
    const tagDefs = tracking.tagDefs || {};

    const now = new Date();
    const sprintEnd = sprintEndDate ? new Date(sprintEndDate) : null;
    const sprintHoursLeft = sprintEnd ? workingHoursBetween(now, sprintEnd, hoursPerDay) : null;
    const buckets = buildBoardColumnBuckets(issues, boardFlow, spHours);
    const summary = summarizeBoardBuckets(buckets);

    const eta = calculateETA(summary.pendingHours, hoursPerDay);
    const isLate = sprintEnd && eta > sprintEnd;
    const isOverloaded = sprintHoursLeft !== null && summary.pendingHours > sprintHoursLeft;

    let capacityPct = 0;
    if (sprintHoursLeft !== null) {
        if (sprintHoursLeft > 0) capacityPct = Math.round((summary.pendingHours / sprintHoursLeft) * 100);
        else if (summary.pendingHours > 0) capacityPct = 150;
    }

    const overdueCounts = new Map();
    issues.forEach(issue => {
        const column = resolveIssueBoardColumn(issue, boardFlow);
        if (!column || column.isDone || column.isTodoLike || !issue._currentBoardColumnSince) return;
        const ageHours = workingHoursElapsed(issue._currentBoardColumnSince, hoursPerDay, now);
        const allowed = issue._sp ? Math.max(spToHours(issue._sp, spHours), 0) : 8;
        if (ageHours > Math.max(allowed, 8)) {
            overdueCounts.set(issue.key, ageHours);
        }
    });

    const visibleBuckets = buckets.filter(bucket => bucket.count > 0 || bucket.column.isDone);

    function issueChip(issue) {
        const noteText = String(notesMap[issue.key] || '').trim();
        const notePreview = noteText ? truncate(noteText.replace(/\s+/g, ' '), 120) : '';
        const tagHtml = renderReadOnlyTags(tagsMap[issue.key] || [], tagDefs);
        const overdueAge = overdueCounts.get(issue.key);
        return `
            <div class="issue-chip ${getIssueToneClass(issue, boardFlow)}${overdueAge ? ' issue-chip-overdue' : ''}" data-gh-key="${issue.key}" data-status="${escapeHtml(issue.fields?.status?.name || '?')}">
                <div class="issue-chip-main">
                    <div class="issue-chip-top">
                        <a class="issue-chip-key" href="https://${jiraHost}/browse/${issue.key}" target="_blank">${issue.key}</a>
                        <span class="issue-chip-status">${escapeHtml(issue.fields?.status?.name || '?')}</span>
                        <span class="issue-chip-sp">${issue._sp ?? '?'} SP</span>
                        ${overdueAge ? `<span class="overdue-time-badge">⏰ ${escapeHtml(formatHours(overdueAge))} in column</span>` : ''}
                    </div>
                    <div class="issue-chip-summary" title="${escapeHtml(issue.fields?.summary || '')}">${escapeHtml(issue.fields?.summary || '')}</div>
                    ${notePreview ? `<div class="sprint-note-preview" title="${escapeHtml(noteText)}">${escapeHtml(notePreview)}</div>` : ''}
                    ${tagHtml ? `<div class="sprint-tag-row"><div class="et-tag-read-list sprint-tag-list">${tagHtml}</div></div>` : ''}
                </div>
                <div class="issue-chip-actions">
                    <button class="et-notes-btn" data-issue-key="${issue.key}" data-summary="${escapeHtml(issue.fields?.summary || '')}" title="Notes">📝</button>
                    <button class="overdue-copy-btn" title="Copy for Slack" data-key="${issue.key}" data-summary="${escapeHtml(issue.fields?.summary || '')}" data-url="https://${jiraHost}/browse/${issue.key}">🔗</button>
                </div>
            </div>
        `;
    }

    const { initials, imgUrl } = getInitialsOrImg(assignee);
    const avatarHtml = imgUrl ? `<img src="${imgUrl}" alt="${assignee?.displayName || '?'}">` : initials;
    const trendEmoji = velocity.trend === 'up' ? '↑' : velocity.trend === 'down' ? '↓' : '→';
    const trendClass = velocity.trend === 'up' ? 'up' : velocity.trend === 'down' ? 'down' : 'flat';
    const barClass = capacityPct > 110 ? 'danger' : capacityPct > 85 ? 'warning' : 'safe';
    const barWidth = Math.min(capacityPct, 100);

    let velocityHtml = '';
    if (velocity.sprints.length === 0) {
        velocityHtml = '<p class="no-velocity">No closed sprint data available</p>';
    } else {
        velocityHtml = `
            <div class="velocity-row">
                <div>
                    <div class="velocity-avg">${velocity.avg}</div>
                    <div class="velocity-label">avg SP / sprint</div>
                </div>
                <div class="velocity-trend ${trendClass}">${trendEmoji}</div>
            </div>
            <div class="velocity-sprints">
                ${velocity.sprints.map(sprint => `<span class="sprint-pill" title="${escapeHtml(sprint.name)}"><span class="sprint-pill-name">${escapeHtml(sprint.name)}</span><span class="sprint-pill-sp">${sprint.sp} SP</span></span>`).join('')}
            </div>
        `;
    }

    const card = document.createElement('div');
    const accountId = assignee?.accountId || 'unassigned';
    card.className = `dev-card${isOverloaded ? ' overloaded' : ''}`;
    card.dataset.accountId = accountId;
    card.innerHTML = `
        <div class="dev-card-header">
            <div class="dev-avatar">${avatarHtml}</div>
            <div class="dev-name-wrap">
                <div class="dev-name">${escapeHtml(assignee?.displayName || 'Unassigned')}</div>
                <div class="dev-issues-count">${issues.length} issue${issues.length !== 1 ? 's' : ''} · ${summary.doneIssues} done · ${summary.pendingIssues} pending</div>
            </div>
            ${isOverloaded ? '<div class="overload-badge">⚠️ Overloaded</div>' : ''}
        </div>
        <div class="dev-card-body">
            <div class="dev-section">
                <div class="dev-section-title">📊 Committed Work <span class="section-note">(All non-done columns)</span></div>
                <div class="remaining-summary">
                    <span class="remaining-sp">${summary.pendingSp}</span>
                    <span class="remaining-sp-label">SP remaining</span>
                    <span class="remaining-hours">${escapeHtml(formatHours(summary.pendingHours || 0))}</span>
                </div>
                ${sprintHoursLeft !== null ? `
                <div class="capacity-bar-track">
                    <div class="capacity-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                </div>
                <div class="eta-row">
                    <span class="capacity-tooltip" data-tooltip="${escapeHtml(formatHours(summary.pendingHours || 0))} needed / ${escapeHtml(formatHours(sprintHoursLeft))} capacity">
                        ${capacityPct}% of sprint capacity
                    </span>
                    ${sprintEnd ? `<span class="eta-value ${isLate ? 'eta-late' : 'eta-ok'}">ETA: ${escapeHtml(formatDate(eta))}</span>` : ''}
                </div>
                ` : `<div class="eta-row"><span class="eta-value">ETA: ${escapeHtml(formatDate(eta))}</span></div>`}
                ${summary.doneSp > 0 ? `<div class="done-summary"><span class="done-sp">${summary.doneSp} SP</span> done (${summary.totalSp} total in sprint)</div>` : ''}
            </div>
            ${visibleBuckets.map(bucket => `
                <div class="dev-section">
                    <div class="dev-section-title">
                        ${bucket.column.icon} ${escapeHtml(bucket.column.name)}
                        <span class="section-count">(${bucket.count})</span>
                        ${bucket.column.isDone ? '' : Array.from(bucket.issues).filter(issue => overdueCounts.has(issue.key)).length > 0 ? `<span class="overdue-count-badge">${Array.from(bucket.issues).filter(issue => overdueCounts.has(issue.key)).length} overdue</span>` : ''}
                    </div>
                    <div class="issue-list">
                        ${bucket.count === 0 ? `<div class="no-issues">No tickets in ${escapeHtml(bucket.column.name)}</div>` : bucket.issues.map(issueChip).join('')}
                    </div>
                </div>
            `).join('')}
            <div class="dev-section">
                <div class="dev-section-title">⚡ Velocity — Last ${velocity.sprints.length} Sprint${velocity.sprints.length !== 1 ? 's' : ''}</div>
                ${velocityHtml}
            </div>
        </div>
    `;

    return card;
}

export function renderReadOnlyTags(tagLabels = [], tagDefs = {}) {
    const tags = getTagObjects(tagLabels, tagDefs);
    if (!tags.length) return '';

    return tags.map(tag => `
        <span class="et-tag-chip sprint-real-tag" style="${getTagInlineStyle(tag.color)}">
            <span class="et-tag-chip-dot"></span>
            <span class="et-tag-chip-label">${escapeHtml(tag.label)}</span>
        </span>
    `).join('');
}

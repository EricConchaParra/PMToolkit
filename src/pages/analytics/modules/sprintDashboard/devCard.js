/**
 * PMsToolKit — Analytics Hub
 * Developer card renderer — one card per assignee in the sprint dashboard
 */

import { escapeHtml, spToHours, workingHoursBetween, calculateETA, formatDate, formatHours, timeSince } from '../utils.js';

// ============================================================
// AVATAR HELPER
// ============================================================

export function getInitialsOrImg(assignee) {
    if (!assignee) return { initials: '?', imgUrl: null };
    const avatarUrls = assignee.avatarUrls;
    const imgUrl = avatarUrls?.['48x48'] || avatarUrls?.['32x32'] || null;
    const name = assignee.displayName || '';
    const parts = name.split(' ').filter(Boolean);
    const initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    return { initials, imgUrl };
}

// ============================================================
// SECTION CLASSIFIER (local to this module)
// ============================================================

function sectionOf(issue, settings) {
    const name = issue.fields?.status?.name || '';
    if (settings.statusMap && settings.statusMap[name]) return settings.statusMap[name];
    const n = name.toLowerCase();
    const cat = issue.fields?.status?.statusCategory?.key || '';
    if (n.includes('blocked') || n.includes('hold')) return 'blocked';
    if (n.includes('in review') || n.includes('reviewing')) return 'inReview';
    if (n.includes('in progress') || n.includes('progress')) return 'inProgress';
    if (n.includes('qa') || n.includes('test')) return 'qa';
    if (cat === 'done' || n === 'done') return 'done';
    return 'todo';
}

// ============================================================
// DEV CARD RENDERER
// ============================================================

export function renderDevCard(devData, sprintEndDate, settings, jiraHost) {
    const { assignee, issues, velocity } = devData;
    const { hoursPerDay, spHours } = settings;

    const now = new Date();
    const sprintEnd = sprintEndDate ? new Date(sprintEndDate) : null;
    const sprintHoursLeft = sprintEnd ? workingHoursBetween(now, sprintEnd, hoursPerDay) : null;

    // ---- Categorize issues ----
    const inReviewIssues = issues.filter(i => sectionOf(i, settings) === 'inReview');
    const blockedIssues = issues.filter(i => sectionOf(i, settings) === 'blocked');
    const inProgressIssues = issues.filter(i => {
        const sec = sectionOf(i, settings);
        return sec === 'inProgress' || sec === 'inReview' || sec === 'blocked';
    });
    const qaIssues = issues.filter(i => sectionOf(i, settings) === 'qa');
    const doneIssues = issues.filter(i => sectionOf(i, settings) === 'done');
    const todoIssues = issues.filter(i => sectionOf(i, settings) === 'todo');

    // ---- SP remaining ----
    const remainingSP = inProgressIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const remainingHours = inProgressIssues.reduce((acc, i) => acc + spToHours(i._sp, spHours), 0);
    const doneSP = doneIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const qaSP = qaIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const todoSP = todoIssues.reduce((acc, i) => acc + (i._sp || 0), 0);
    const todoHours = todoIssues.reduce((acc, i) => acc + spToHours(i._sp, spHours), 0);
    const totalCommittedSP = remainingSP + todoSP;
    const totalCommittedHours = remainingHours + todoHours;
    const grandTotalSP = totalCommittedSP + qaSP + doneSP;

    // ETA
    const eta = calculateETA(totalCommittedHours, hoursPerDay);
    const isLate = sprintEnd && eta > sprintEnd;

    // Capacity
    const isOverloaded = sprintHoursLeft !== null && (totalCommittedHours > sprintHoursLeft);
    let capacityPct = 0;
    if (sprintHoursLeft !== null) {
        if (sprintHoursLeft > 0) {
            capacityPct = Math.round((totalCommittedHours / sprintHoursLeft) * 100);
        } else if (totalCommittedHours > 0) {
            capacityPct = 150;
        }
    }

    // Overdue In Progress
    const overdueIssues = inProgressIssues.filter(i => {
        const since = i._inProgressSince;
        if (!since) return false;
        const elapsedHours = (Date.now() - new Date(since).getTime()) / (1000 * 60 * 60);
        const allowed = spToHours(i._sp, spHours);
        return elapsedHours > allowed;
    });

    // Velocity
    const velAvg = velocity.avg;
    const velSprints = velocity.sprints;
    const velTrend = velocity.trend;
    const trendEmoji = velTrend === 'up' ? '↑' : velTrend === 'down' ? '↓' : '→';
    const trendClass = velTrend === 'up' ? 'up' : velTrend === 'down' ? 'down' : 'flat';

    // Avatar
    const { initials, imgUrl } = getInitialsOrImg(assignee);
    const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${assignee?.displayName || '?'}">`
        : initials;

    // Capacity bar color
    const barClass = capacityPct > 110 ? 'danger' : capacityPct > 85 ? 'warning' : 'safe';
    const barWidth = Math.min(capacityPct, 100);

    // ---- Issue chip helper ----
    function issueChip(i, opts = {}) {
        const isOverdue = opts.isOverdue;
        const section = sectionOf(i, settings);
        
        const isDone = section === 'done';
        const isBlocked = section === 'blocked';
        const isInReview = section === 'inReview';
        const isInProgress = section === 'inProgress';

        return `
            <div class="issue-chip${isOverdue ? ' issue-chip-overdue' : ''}${isInProgress ? ' in-progress-chip' : ''}${isDone ? ' done-chip' : ''}${isBlocked ? ' blocked-chip' : ''}${isInReview ? ' in-review-chip' : ''}" data-gh-key="${i.key}" data-status="${escapeHtml(i.fields?.status?.name || '?')}">
                <div class="issue-chip-main">
                    <div class="issue-chip-top">
                        <a class="issue-chip-key" href="https://${jiraHost}/browse/${i.key}" target="_blank">${i.key}</a>
                        <span class="issue-chip-status">${escapeHtml(i.fields?.status?.name || '?')}</span>
                        <span class="issue-chip-sp">${i._sp ?? '?'} SP</span>
                        ${isOverdue ? `<span class="overdue-time-badge">⏰ ${timeSince(i._inProgressSince)}</span>` : ''}
                    </div>
                    <div class="issue-chip-summary" title="${escapeHtml(i.fields?.summary || '')}">${escapeHtml(i.fields?.summary || '')}</div>
                </div>
                <div class="issue-chip-actions">
                    <button class="et-notes-btn" data-issue-key="${i.key}" data-summary="${escapeHtml(i.fields?.summary || '')}" title="Notes">📝</button>
                    <button class="overdue-copy-btn" title="Copy for Slack" data-key="${i.key}" data-summary="${escapeHtml(i.fields?.summary || '')}" data-url="https://${jiraHost}/browse/${i.key}">🔗</button>
                </div>
            </div>
        `;
    }

    const overdueSet = new Set(overdueIssues.map(i => i.key));

    const inProgressHtml = inProgressIssues.length === 0
        ? `<div class="no-issues">No tickets in progress</div>`
        : inProgressIssues.map(i => {
            return issueChip(i, { 
                isOverdue: overdueSet.has(i.key)
            });
        }).join('');

    const qaHtml = qaIssues.length === 0
        ? `<div class="no-issues">No tickets in QA</div>`
        : qaIssues.map(i => issueChip(i)).join('');

    const doneHtml = doneIssues.length === 0
        ? `<div class="no-issues">No tickets done yet</div>`
        : doneIssues.map(i => issueChip(i, { isDone: true })).join('');

    const todoHtml = todoIssues.map(i => issueChip(i)).join('');

    // Velocity HTML
    let velocityHtml = '';
    if (velSprints.length === 0) {
        velocityHtml = `<p class="no-velocity">No closed sprint data available</p>`;
    } else {
        velocityHtml = `
            <div class="velocity-row">
                <div>
                    <div class="velocity-avg">${velAvg}</div>
                    <div class="velocity-label">avg SP / sprint</div>
                </div>
                <div class="velocity-trend ${trendClass}">${trendEmoji}</div>
            </div>
            <div class="velocity-sprints">
                ${velSprints.map(s => `<span class="sprint-pill" title="${escapeHtml(s.name)}"><span class="sprint-pill-name">${escapeHtml(s.name)}</span><span class="sprint-pill-sp">${s.sp} SP</span></span>`).join('')}
            </div>
        `;
    }

    const etaClass = isLate ? 'eta-late' : 'eta-ok';

    const card = document.createElement('div');
    const accountId = assignee?.accountId || 'unassigned';
    card.className = `dev-card${isOverloaded ? ' overloaded' : ''}`;
    card.dataset.accountId = accountId;
    card.innerHTML = `
        <div class="dev-card-header">
            <div class="dev-avatar">${avatarHtml}</div>
            <div class="dev-name-wrap">
                <div class="dev-name">${escapeHtml(assignee?.displayName || 'Unassigned')}</div>
                <div class="dev-issues-count">${issues.length} issue${issues.length !== 1 ? 's' : ''} · ${doneIssues.length} done · ${inProgressIssues.length + qaIssues.length + todoIssues.length} pending</div>
            </div>
            ${isOverloaded ? `<div class="overload-badge">⚠️ Overloaded</div>` : ''}
        </div>
        <div class="dev-card-body">

            <!-- Remaining Work -->
            <div class="dev-section">
                <div class="dev-section-title">📊 Committed Work <span class="section-note">(To Do + In Progress)</span></div>
                <div class="remaining-summary">
                    <span class="remaining-sp">${remainingSP + todoIssues.reduce((a, i) => a + (i._sp || 0), 0)}</span>
                    <span class="remaining-sp-label">SP remaining</span>
                    <span class="remaining-hours">${formatHours(remainingHours + todoIssues.reduce((a, i) => a + spToHours(i._sp, spHours), 0))}</span>
                </div>
                ${sprintHoursLeft !== null ? `
                <div class="capacity-bar-track">
                    <div class="capacity-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                </div>
                <div class="eta-row">
                    <span class="capacity-tooltip" data-tooltip="${formatHours(totalCommittedHours)} needed / ${formatHours(sprintHoursLeft)} capacity">
                        ${capacityPct}% of sprint capacity
                    </span>
                    ${sprintEnd ? `<span class="eta-value ${etaClass}">ETA: ${formatDate(eta)}</span>` : ''}
                </div>
                ` : `<div class="eta-row"><span class="eta-value">ETA: ${formatDate(eta)}</span></div>`}
                ${qaSP > 0 || doneSP > 0 ? `<div class="done-summary">${qaSP > 0 ? `<span class="qa-sp">${qaSP} SP</span> in QA` : ''}${qaSP > 0 && doneSP > 0 ? ' · ' : ''}${doneSP > 0 ? `<span class="done-sp">${doneSP} SP</span> Done (${grandTotalSP} in total)` : ''}</div>` : ''}
            </div>

            <!-- In Progress -->
            <div class="dev-section">
                <div class="dev-section-title">
                    🔵 In Progress (${inProgressIssues.length})
                    ${overdueIssues.length > 0 ? `<span class="overdue-count-badge">${overdueIssues.length} overdue</span>` : ''}
                </div>
                <div class="issue-list">${inProgressHtml}</div>
            </div>

            <!-- QA -->
            <div class="dev-section">
                <div class="dev-section-title">🟣 QA <span class="section-count">(${qaIssues.length})</span></div>
                <div class="issue-list">${qaHtml}</div>
            </div>

            ${todoIssues.length > 0 ? `
            <!-- To Do -->
            <div class="dev-section">
                <div class="dev-section-title">⬜ To Do <span class="section-count">(${todoIssues.length})</span></div>
                <div class="issue-list">${todoHtml}</div>
            </div>
            ` : ''}

            <!-- Done -->
            <div class="dev-section">
                <div class="dev-section-title">✅ Done <span class="section-count">(${doneIssues.length})</span></div>
                <div class="issue-list">${doneHtml}</div>
            </div>


            <!-- Velocity -->
            <div class="dev-section">
                <div class="dev-section-title">⚡ Velocity — Last ${velSprints.length} Sprint${velSprints.length !== 1 ? 's' : ''}</div>
                ${velocityHtml}
            </div>

        </div>
    `;
    return card;
}

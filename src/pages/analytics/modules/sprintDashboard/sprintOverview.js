/**
 * PMsToolKit — Analytics Hub
 * Sprint Overview panel — team-level summary rendered at the top of the dash
 */

import { escapeHtml, spToHours, workingHoursBetween, formatHours } from '../utils.js';

// ============================================================
// SECTION CLASSIFIER (local to this module)
// ============================================================

function sectionOf(issue, settings) {
    const name = (issue.fields?.status?.name || '').toLowerCase();
    if (settings.statusMap && settings.statusMap[issue.fields?.status?.name]) return settings.statusMap[issue.fields?.status?.name];
    const cat = issue.fields?.status?.statusCategory?.key || '';
    
    if (name.includes('blocked') || name.includes('hold') || name.includes('impediment')) return 'blocked';
    if (name.includes('in review') || name.includes('reviewing') || name.includes('peer review')) return 'inReview';
    if (name.includes('in progress') || name.includes('progress')) return 'inProgress';
    if (name.includes('qa') || name.includes('test')) return 'qa';
    if (cat === 'done' || name === 'done') return 'done';
    return 'todo';
}

// ============================================================
// SPRINT OVERVIEW
// ============================================================

/**
 * Renders the team-level sprint overview panel.
 * @param {Array}  issues              - All sprint issues (with ._sp attached)
 * @param {Object} sprint              - Active sprint object (startDate, endDate, name)
 * @param {Object} settings            - Project settings {hoursPerDay, spHours, statusMap}
 * @param {number} devCount            - Number of unique assignees in this sprint
 * @param {number} teamVelAvg          - Average SP completed per sprint across all devs
 * @param {number} totalCommittedSP    - Total SP committed to the sprint
 */
export function renderSprintOverview(issues, sprint, settings, devCount, teamVelAvg, totalCommittedSP) {
    const { hoursPerDay, spHours } = settings;

    const buckets = { todo: [], inProgress: [], inReview: [], blocked: [], qa: [], done: [] };
    issues.forEach(i => { const s = sectionOf(i, settings); if (buckets[s]) buckets[s].push(i); });

    // ---- SP per bucket ----
    const spFor = list => list.reduce((a, i) => a + (i._sp || 0), 0);
    const spTodo = spFor(buckets.todo);
    const spInProgress = spFor(buckets.inProgress);
    const spInReview = spFor(buckets.inReview);
    const spBlocked = spFor(buckets.blocked);
    const spQA = spFor(buckets.qa);
    const spDone = spFor(buckets.done);
    const spTotal = spTodo + spInProgress + spInReview + spBlocked + spQA + spDone;

    // ---- Progress bar ----
    const getPct = sp => spTotal > 0 ? Math.round((sp / spTotal) * 100) : 0;
    const donePct = getPct(spDone);
    const qaPct = getPct(spQA);
    const inReviewPct = getPct(spInReview);
    const inProgPct = getPct(spInProgress);
    const blockedPct = getPct(spBlocked);

    // ---- Capacity model ----
    const now = new Date();
    const sprintEnd = sprint.endDate ? new Date(sprint.endDate) : null;
    const sprintCapacityHoursPerDev = sprintEnd ? workingHoursBetween(now, sprintEnd, hoursPerDay) : null;
    const teamCapacityHours = (sprintCapacityHoursPerDev !== null && devCount > 0)
        ? sprintCapacityHoursPerDev * devCount
        : null;

    const hoursFor = list => list.reduce((a, i) => a + spToHours(i._sp, spHours), 0);
    const remainingHours = hoursFor(buckets.todo) + hoursFor(buckets.inProgress) + hoursFor(buckets.blocked) + hoursFor(buckets.inReview) + (hoursFor(buckets.qa) * 0.5);

    // ---- Prediction ----
    let predIcon, predLabel, predDetail, predClass;

    let usagePct = null;
    if (teamCapacityHours !== null) {
        if (teamCapacityHours > 0) {
            usagePct = Math.round((remainingHours / teamCapacityHours) * 100);
        } else if (remainingHours > 0) {
            usagePct = Infinity;
        } else {
            usagePct = 0;
        }
    }

    if (spDone === spTotal && spTotal > 0) {
        predIcon = '🎉'; predLabel = 'Sprint Complete!'; predClass = 'on-track';
        predDetail = `All ${spTotal} SP delivered.`;
    } else if (teamCapacityHours === null) {
        predIcon = '❓'; predLabel = 'No sprint end date'; predClass = 'unknown';
        predDetail = 'Cannot predict completion without a sprint end date.';
    } else if (teamCapacityHours === 0 && remainingHours > 0) {
        predIcon = '🔴'; predLabel = 'Overloaded — Sprint at Risk'; predClass = 'overloaded';
        predDetail = `Sprint ends today! Team still needs ${formatHours(remainingHours)}, but remaining capacity is 0h.`;
    } else if (usagePct <= 75) {
        predIcon = '🟢'; predLabel = 'On Track'; predClass = 'on-track';
        predDetail = `Team is using ${usagePct}% of remaining capacity (${formatHours(remainingHours)} needed / ${formatHours(teamCapacityHours)} available).`;
    } else if (usagePct <= 100) {
        predIcon = '🟡'; predLabel = 'At Risk'; predClass = 'at-risk';
        predDetail = `Team is using ${usagePct}% of remaining capacity — tight but possible. ${formatHours(remainingHours)} needed vs. ${formatHours(teamCapacityHours)} available.`;
    } else {
        predIcon = '🔴'; predLabel = 'Overloaded — Sprint at Risk'; predClass = 'overloaded';
        predDetail = `Team needs ${formatHours(remainingHours)} but only has ${formatHours(teamCapacityHours)} remaining (${usagePct}% load). Consider re-scoping.`;
    }

    // Overcommitment signal vs. team historical velocity
    let velocityHint = '';
    let velocityClass = 'aligned';
    if (teamVelAvg > 0 && totalCommittedSP > 0) {
        const ratio = Math.round((totalCommittedSP / teamVelAvg) * 100);
        if (ratio > 115) {
            velocityHint = `⚠️ Overcommitted (${ratio}%): ${totalCommittedSP} SP planned vs. ${teamVelAvg} SP avg historical velocity.`;
            velocityClass = 'overcommitted';
        } else if (ratio < 75) {
            velocityHint = `ℹ️ Under-committed (${ratio}%): ${totalCommittedSP} SP planned vs. ${teamVelAvg} SP avg historical velocity.`;
            velocityClass = 'undercommitted';
        } else {
            velocityHint = `⚡ Healthy: Commitment aligns with historical capacity (${totalCommittedSP} SP vs. ${teamVelAvg} avg).`;
            velocityClass = 'aligned';
        }
    }

    // ---- Update DOM ----
    document.getElementById('overview-subtitle').textContent =
        `${issues.length} issues · ${spTotal} SP total · ${devCount} developer${devCount !== 1 ? 's' : ''}`;

    document.getElementById('overview-done-count').textContent = buckets.done.length;
    document.getElementById('overview-done-sp').textContent = `${spDone} SP`;
    document.getElementById('overview-qa-count').textContent = buckets.qa.length;
    document.getElementById('overview-qa-sp').textContent = `${spQA} SP`;
    document.getElementById('overview-inreview-count').textContent = buckets.inReview.length;
    document.getElementById('overview-inreview-sp').textContent = `${spInReview} SP`;
    document.getElementById('overview-inprogress-count').textContent = buckets.inProgress.length;
    document.getElementById('overview-inprogress-sp').textContent = `${spInProgress} SP`;
    document.getElementById('overview-blocked-count').textContent = buckets.blocked.length;
    document.getElementById('overview-blocked-sp').textContent = `${spBlocked} SP`;
    document.getElementById('overview-todo-count').textContent = buckets.todo.length;
    document.getElementById('overview-todo-sp').textContent = `${spTodo} SP`;

    document.getElementById('overview-bar-done').style.width = `${donePct}%`;
    document.getElementById('overview-bar-qa').style.width = `${qaPct}%`;
    if (document.getElementById('overview-bar-inreview')) document.getElementById('overview-bar-inreview').style.width = `${inReviewPct}%`;
    if (document.getElementById('overview-bar-inprogress')) document.getElementById('overview-bar-inprogress').style.width = `${inProgPct}%`;
    if (document.getElementById('overview-bar-blocked')) document.getElementById('overview-bar-blocked').style.width = `${blockedPct}%`;

    document.getElementById('overview-progress-pct').textContent = `${donePct}% complete`;
    document.getElementById('overview-progress-label').textContent =
        `${spDone} SP done · ${spQA} SP in QA · ${spInReview} SP in review · ${spInProgress} SP in prog · ${spBlocked} SP blocked · ${spTodo} SP todo`;


    const pred = document.getElementById('overview-prediction');
    pred.className = `overview-prediction ${predClass}`;
    document.getElementById('prediction-icon').textContent = predIcon;
    document.getElementById('prediction-label').textContent = predLabel;
    const detailEl = document.getElementById('prediction-detail');
    detailEl.textContent = predDetail;
    if (velocityHint) {
        const hint = document.createElement('div');
        hint.className = `prediction-velocity-hint ${velocityClass}`;
        hint.innerHTML = `<span class="velocity-pill">Team Velocity: ${teamVelAvg} SP</span> ${velocityHint}`;
        detailEl.after(hint);
    }
}

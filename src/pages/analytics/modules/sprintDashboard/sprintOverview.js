/**
 * PMsToolKit — Analytics Hub
 * Sprint Overview panel — team-level summary rendered at the top of the dash
 */

import { buildBoardColumnBuckets, summarizeBoardBuckets } from '../boardFlow.js';
import { escapeHtml, formatHours, workingHoursBetween } from '../utils.js';

function getPct(value, total) {
    return total > 0 ? Math.round((value / total) * 100) : 0;
}

export function buildSprintOverviewModel(issues, sprint, settings, devCount, teamVelAvg, totalCommittedSP, boardFlow) {
    const { hoursPerDay, spHours } = settings;
    const buckets = buildBoardColumnBuckets(issues, boardFlow, spHours);
    const summary = summarizeBoardBuckets(buckets);
    const totalSp = summary.totalSp;
    const donePct = getPct(summary.doneSp, totalSp);

    const now = new Date();
    const sprintEnd = sprint?.endDate ? new Date(sprint.endDate) : null;
    const sprintCapacityHoursPerDev = sprintEnd ? workingHoursBetween(now, sprintEnd, hoursPerDay) : null;
    const teamCapacityHours = (sprintCapacityHoursPerDev !== null && devCount > 0)
        ? sprintCapacityHoursPerDev * devCount
        : null;

    let usagePct = null;
    if (teamCapacityHours !== null) {
        if (teamCapacityHours > 0) usagePct = Math.round((summary.pendingHours / teamCapacityHours) * 100);
        else usagePct = summary.pendingHours > 0 ? Infinity : 0;
    }

    let predIcon;
    let predLabel;
    let predDetail;
    let predClass;

    if (summary.doneSp === totalSp && totalSp > 0) {
        predIcon = '🎉';
        predLabel = 'Sprint Complete!';
        predClass = 'on-track';
        predDetail = `All ${totalSp} SP delivered.`;
    } else if (teamCapacityHours === null) {
        predIcon = '❓';
        predLabel = 'No sprint end date';
        predClass = 'unknown';
        predDetail = 'Cannot predict completion without a sprint end date.';
    } else if (teamCapacityHours === 0 && summary.pendingHours > 0) {
        predIcon = '🔴';
        predLabel = 'Overloaded — Sprint at Risk';
        predClass = 'overloaded';
        predDetail = `Sprint ends today. Team still needs ${formatHours(summary.pendingHours)}, but remaining capacity is 0h.`;
    } else if (usagePct <= 75) {
        predIcon = '🟢';
        predLabel = 'On Track';
        predClass = 'on-track';
        predDetail = `Team is using ${usagePct}% of remaining capacity (${formatHours(summary.pendingHours)} needed / ${formatHours(teamCapacityHours)} available).`;
    } else if (usagePct <= 100) {
        predIcon = '🟡';
        predLabel = 'At Risk';
        predClass = 'at-risk';
        predDetail = `Team is using ${usagePct}% of remaining capacity — tight but possible. ${formatHours(summary.pendingHours)} needed vs. ${formatHours(teamCapacityHours)} available.`;
    } else {
        predIcon = '🔴';
        predLabel = 'Overloaded — Sprint at Risk';
        predClass = 'overloaded';
        predDetail = `Team needs ${formatHours(summary.pendingHours)} but only has ${formatHours(teamCapacityHours)} remaining (${usagePct}% load). Consider re-scoping.`;
    }

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

    return {
        buckets,
        totalSp,
        donePct,
        summary,
        prediction: { icon: predIcon, label: predLabel, detail: predDetail, className: predClass },
        velocity: { hint: velocityHint, className: velocityClass },
    };
}

export function renderSprintOverview(issues, sprint, settings, devCount, teamVelAvg, totalCommittedSP, boardFlow) {
    const model = buildSprintOverviewModel(issues, sprint, settings, devCount, teamVelAvg, totalCommittedSP, boardFlow);
    const { buckets, totalSp, donePct, summary, prediction, velocity } = model;

    const stats = document.getElementById('overview-stats');
    const track = document.getElementById('overview-progress-track');
    const legend = document.getElementById('overview-progress-legend');

    document.getElementById('overview-subtitle').textContent =
        `${issues.length} issues · ${totalSp} SP total · ${devCount} developer${devCount !== 1 ? 's' : ''}`;

    if (stats) {
        stats.innerHTML = buckets.map(bucket => `
            <div class="stat-pill board-tone-${bucket.column.tone}">
                <span class="stat-pill-icon">${bucket.column.icon}</span>
                <div class="stat-pill-body">
                    <span class="stat-pill-label">${escapeHtml(bucket.column.name)}</span>
                    <span class="stat-pill-value">${bucket.count}</span>
                    <span class="stat-pill-sp">${bucket.sp} SP · ${bucket.hours === 0 ? '0h' : escapeHtml(formatHours(bucket.hours))}</span>
                </div>
            </div>
        `).join('');
    }

    if (track) {
        const segments = buckets
            .filter(bucket => bucket.sp > 0)
            .map(bucket => `
                <div class="overview-progress-segment board-tone-${bucket.column.tone}" style="width:${getPct(bucket.sp, totalSp)}%" title="${escapeHtml(bucket.column.name)} · ${bucket.sp} SP"></div>
            `)
            .join('');
        track.innerHTML = segments || '<div class="overview-progress-segment board-tone-todo" style="width:100%"></div>';
    }

    if (legend) {
        legend.innerHTML = buckets.map(bucket => `
            <span class="overview-legend-item">
                <span class="legend-dot board-tone-${bucket.column.tone}"></span>
                <span>${escapeHtml(bucket.column.name)}</span>
            </span>
        `).join('');
    }

    document.getElementById('overview-progress-pct').textContent = `${donePct}% complete`;
    document.getElementById('overview-progress-label').textContent = buckets
        .filter(bucket => bucket.count > 0)
        .map(bucket => `${bucket.sp} SP in ${bucket.column.name}`)
        .join(' · ') || 'No sprint work found';

    const pred = document.getElementById('overview-prediction');
    pred.className = `overview-prediction ${prediction.className}`;
    document.getElementById('prediction-icon').textContent = prediction.icon;
    document.getElementById('prediction-label').textContent = prediction.label;
    const detailEl = document.getElementById('prediction-detail');
    detailEl.textContent = prediction.detail;

    document.querySelectorAll('.prediction-velocity-hint').forEach(el => el.remove());
    if (velocity.hint) {
        const hint = document.createElement('div');
        hint.className = `prediction-velocity-hint ${velocity.className}`;
        hint.innerHTML = `<span class="velocity-pill">Team Velocity: ${teamVelAvg} SP</span> ${escapeHtml(velocity.hint)}`;
        detailEl.after(hint);
    }

    return model;
}

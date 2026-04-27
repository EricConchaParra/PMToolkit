/**
 * PMsToolKit — Analytics Hub
 * Pure utility functions: date/time calculations, formatting, HTML helpers
 */

import { DEFAULT_SP_HOURS } from './constants.js';

// ============================================================
// SP → HOURS
// ============================================================

// SP to hours — for any SP not in default table, interpolate via nearest
export function spToHours(sp, scale) {
    const key = sp == null || sp === 0 ? 0 : sp;
    if (scale[key] !== undefined) return scale[key];
    // For unusual SP values, use a rough linear interpolation vs 13 SP
    const ref = scale[13] || 45;
    return (key / 13) * ref;
}

// ============================================================
// WORKING HOURS UTILS
// ============================================================

// Count working hours between now and a future date (Mon-Fri only)
// Assumes sprint ends at 20:00 (8 PM) on the end date
export function workingHoursBetween(fromDate, toDate, hoursPerDay) {
    let hours = 0;

    const cursor = new Date(fromDate);
    cursor.setHours(0, 0, 0, 0);

    // End date is considered to be at 20:00
    const end = new Date(toDate);
    end.setHours(20, 0, 0, 0);

    // If we're already past the end date + 20:00, return 0
    if (cursor > end) return 0;

    // Special case: if today is the end date, calculate hours remaining today up to 20:00
    const now = new Date();
    if (now.toDateString() === end.toDateString() && now < end) {
        if (now.getDay() !== 0 && now.getDay() !== 6) {
            const hoursRemainingToday = (end.getTime() - Math.max(now.getTime(), now.setHours(20 - hoursPerDay, 0, 0, 0))) / (1000 * 60 * 60);
            return Math.max(0, Math.min(hoursRemainingToday, hoursPerDay));
        }
    }

    // Step day by day
    while (cursor < end) {
        const day = cursor.getDay();

        if (day !== 0 && day !== 6) {
            if (cursor.toDateString() === now.toDateString()) {
                const eod = new Date(now);
                eod.setHours(20, 0, 0, 0);
                if (now < eod) {
                    const startOfWorkday = new Date(now);
                    startOfWorkday.setHours(20 - hoursPerDay, 0, 0, 0);
                    const msLeft = eod.getTime() - Math.max(now.getTime(), startOfWorkday.getTime());
                    hours += Math.max(0, Math.min(msLeft / (1000 * 60 * 60), hoursPerDay));
                }
            } else if (cursor.toDateString() === end.toDateString()) {
                hours += hoursPerDay;
            } else {
                hours += hoursPerDay;
            }
        }
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
    }

    return Math.round(hours * 10) / 10;
}

// Count working hours inside an arbitrary date range (Mon-Fri only).
// Assumes the working day ends at 20:00 and starts `hoursPerDay` hours earlier.
export function workingHoursInRange(startDate, endDate, hoursPerDay = DEFAULT_HOURS_PER_DAY) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;

    const workdayEndHour = 20;
    const workdayStartHour = workdayEndHour - hoursPerDay;
    let totalMs = 0;

    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);

    while (cursor < end) {
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) {
            const dayStart = new Date(cursor);
            dayStart.setHours(workdayStartHour, 0, 0, 0);

            const dayEnd = new Date(cursor);
            dayEnd.setHours(workdayEndHour, 0, 0, 0);

            const overlapStart = Math.max(start.getTime(), dayStart.getTime());
            const overlapEnd = Math.min(end.getTime(), dayEnd.getTime());
            if (overlapEnd > overlapStart) {
                totalMs += overlapEnd - overlapStart;
            }
        }

        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
    }

    return Math.round((totalMs / (1000 * 60 * 60)) * 10) / 10;
}

export function workingHoursElapsed(startDate, hoursPerDay = DEFAULT_HOURS_PER_DAY, endDate = new Date()) {
    return workingHoursInRange(startDate, endDate, hoursPerDay);
}

// Given remaining hours and start date, compute ETA (skip weekends)
export function calculateETA(remainingHours, hoursPerDay) {
    if (remainingHours <= 0) return new Date();
    let hrs = remainingHours;
    const cursor = new Date();
    cursor.setSeconds(0, 0);
    while (hrs > 0) {
        cursor.setDate(cursor.getDate() + 1);
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) {
            hrs -= hoursPerDay;
        }
    }
    return cursor;
}

// ============================================================
// FORMATTING
// ============================================================

export function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatHours(h) {
    if (h < 1) return `${Math.round(h * 60)}m`;
    return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

export function formatAge(diffMs) {
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffDays === 0) return '<1d';
    if (diffDays === 1) return '1d';
    if (diffDays < 7) return `${diffDays}d`;
    if (diffWeeks < 4) return `${diffWeeks}w`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}m`;
}

export function formatTooltipDate(date) {
    const then = new Date(date);
    const now = new Date();
    const diffMs = now - then;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const timeStr = then.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });

    if (diffDays < 7) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const thenStart = new Date(then.getFullYear(), then.getMonth(), then.getDate());
        const dayDiff = Math.round((todayStart - thenStart) / (1000 * 60 * 60 * 24));

        if (dayDiff === 0) return `Today, ${timeStr}`;
        if (dayDiff === 1) return `Yesterday, ${timeStr}`;
        return `last ${dayNames[then.getDay()]}, ${timeStr}`;
    }

    const month = then.toLocaleString('en-US', { month: 'short' });
    const day = then.getDate();
    return `on ${month} ${day}, ${timeStr}`;
}

export function getColorClass(diffMs) {
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 2) return 'et-age-green';
    if (diffDays <= 4) return 'et-age-yellow';
    return 'et-age-red';
}

// Time since a past date in a human-readable string
export function timeSince(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = diff / (1000 * 60 * 60);
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${Math.round(h)}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
}

// ============================================================
// HTML HELPERS
// ============================================================

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

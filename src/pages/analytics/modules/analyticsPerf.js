const DEBUG_FLAG = '__PMTK_ANALYTICS_PERF__';

function canMeasure() {
    return typeof performance !== 'undefined'
        && typeof performance.mark === 'function'
        && typeof performance.measure === 'function';
}

function getDebugFlag() {
    try {
        if (typeof window !== 'undefined' && DEBUG_FLAG in window) return window[DEBUG_FLAG] === true;
        if (typeof localStorage !== 'undefined') return localStorage.getItem('pmtk:analytics:perf') === '1';
    } catch {
        return false;
    }
    return false;
}

export function analyticsPerfEnabled() {
    return getDebugFlag();
}

export function markAnalyticsPerf(name) {
    if (!canMeasure()) return;
    performance.mark(`pmtk:${name}`);
}

export function measureAnalyticsPerf(name, startMark, endMark, detail = {}) {
    if (!canMeasure()) return null;

    const start = `pmtk:${startMark}`;
    const end = `pmtk:${endMark}`;

    try {
        performance.measure(`pmtk:${name}`, { start, end });
        const entries = performance.getEntriesByName(`pmtk:${name}`, 'measure');
        const entry = entries[entries.length - 1] || null;
        if (entry && analyticsPerfEnabled()) {
            console.info(`[PMTK][perf] ${name}`, {
                durationMs: Math.round(entry.duration),
                ...detail,
            });
        }
        return entry;
    } catch {
        return null;
    }
}

export function logAnalyticsPerf(name, detail = {}) {
    if (!analyticsPerfEnabled()) return;
    console.info(`[PMTK][perf] ${name}`, detail);
}

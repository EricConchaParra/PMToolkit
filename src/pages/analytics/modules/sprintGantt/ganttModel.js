/**
 * PMsToolKit — Sprint Timeline (Gantt) pure model.
 *
 * Ported from the standalone "Excel to Gantt Chart" dashboard engine, adapted
 * to Jira data: tasks come from sprint issues, dependencies from "Blocks"
 * issue links, sprint date ranges from the Jira sprint objects themselves.
 *
 * Everything here is DOM-free and unit-tested in ganttModel.test.js.
 */

export const DEFAULT_GANTT_SP_TABLE = {
    1: 2.25,
    2: 4.5,
    3: 9,
    5: 18,
    8: 27,
    13: 45,
};

/* =========================================================================
 * Issue link parsing
 * ========================================================================= */

/**
 * Returns the keys this issue depends on: "Blocks"-type links where the other
 * issue blocks this one. Only the inward side is read — the outward side of
 * every Blocks link shows up as the inward side on the other issue, so
 * reading both would double every edge.
 */
export function parseBlockingLinks(issue) {
    const links = issue?.fields?.issuelinks;
    if (!Array.isArray(links)) return [];
    const deps = [];
    for (const link of links) {
        if (link?.type?.name !== 'Blocks') continue;
        const blocker = link.inwardIssue?.key;
        if (blocker && !deps.includes(blocker)) deps.push(blocker);
    }
    return deps;
}

/* =========================================================================
 * Jira issue -> task mapping
 * ========================================================================= */

function issuePoints(issue, spFieldId) {
    if (!spFieldId) return null;
    const raw = issue?.fields?.[spFieldId];
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/**
 * Maps Jira issues (already deduped across the selected sprints) into the
 * scheduler's task shape and resolves dependencies against the selection.
 *
 * `sprintNameByIssueKey` says which selected sprint each issue belongs to.
 * Dependencies pointing at issues outside the selection are dropped with a
 * warning — the schedule can only reason about what was fetched.
 */
export function mapIssuesToTasks(issues, { spFieldId = null, sprintNameByIssueKey = {} } = {}) {
    const warnings = [];
    const tasksById = {};
    const order = [];

    issues.forEach((issue, index) => {
        const key = issue?.key;
        if (!key || tasksById[key]) return;
        const fields = issue.fields || {};
        const statusCategory = fields.status?.statusCategory?.key || '';
        tasksById[key] = {
            id: key,
            displayId: key,
            name: fields.summary || key,
            status: fields.status?.name || '',
            statusCategory,
            points: issuePoints(issue, spFieldId),
            rawNeeds: parseBlockingLinks(issue),
            needs: [],
            assignee: fields.assignee?.displayName || '',
            done: statusCategory === 'done',
            sprint: sprintNameByIssueKey[key] || '',
            rowIndex: index,
        };
        order.push(key);
    });

    for (const id of order) {
        const task = tasksById[id];
        for (const dep of task.rawNeeds) {
            if (dep === id) {
                warnings.push({ type: 'self-dep', taskId: id, message: `${id} — ${task.name} is linked as blocked by itself; that link is ignored.` });
                continue;
            }
            if (!tasksById[dep]) {
                warnings.push({ type: 'external-dep', taskId: id, message: `${id} — ${task.name} is blocked by ${dep}, which is not in the selected sprints; that dependency is ignored for scheduling.` });
                continue;
            }
            if (!task.needs.includes(dep)) task.needs.push(dep);
        }
        delete task.rawNeeds;
    }

    warnings.push(...breakCycles(tasksById, order));

    // Direct forward links ("this task blocks..."), the inverse of `needs`.
    // Built after breakCycles so both directions describe the same graph.
    for (const id of order) tasksById[id].blocks = [];
    for (const id of order) {
        for (const dep of tasksById[id].needs) tasksById[dep].blocks.push(id);
    }

    for (const id of order) {
        const task = tasksById[id];
        if (task.points == null && !task.done) {
            warnings.push({ type: 'unestimated', taskId: id, message: `${id} — ${task.name} has no Story Points; treated as 0h until estimated.` });
        }
    }

    return { tasksById, order, warnings };
}

/* =========================================================================
 * Dependency graph utilities
 * ========================================================================= */

export function breakCycles(tasksById, order) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    const warnings = [];
    for (const id of order) color[id] = WHITE;

    function dfs(id, stack) {
        color[id] = GRAY;
        stack.push(id);
        const task = tasksById[id];
        for (const dep of [...task.needs]) {
            if (!tasksById[dep]) continue;
            if (color[dep] === GRAY) {
                task.needs = task.needs.filter(d => d !== dep);
                const cyclePath = [...stack.slice(stack.indexOf(dep)), dep];
                warnings.push({ type: 'cycle', taskId: id, message: `Circular dependency detected and removed: ${cyclePath.join(' → ')}` });
                continue;
            }
            if (color[dep] === WHITE) dfs(dep, stack);
        }
        stack.pop();
        color[id] = BLACK;
    }

    for (const id of order) {
        if (color[id] === WHITE) dfs(id, []);
    }
    return warnings;
}

export function topoOrder(needsMap, order) {
    const succ = {};
    const indeg = {};
    for (const id of order) { succ[id] = []; indeg[id] = 0; }
    for (const id of order) {
        for (const dep of needsMap[id]) {
            if (succ[dep]) succ[dep].push(id);
            indeg[id]++;
        }
    }
    const queue = order.filter(id => indeg[id] === 0);
    const result = [];
    while (queue.length) {
        const id = queue.shift();
        result.push(id);
        for (const s of succ[id]) {
            indeg[s]--;
            if (indeg[s] === 0) queue.push(s);
        }
    }
    for (const id of order) if (!result.includes(id)) result.push(id);
    return result;
}

export function ancestorsOf(id, tasksById) {
    const seen = new Set();
    const stack = [id];
    while (stack.length) {
        const cur = stack.pop();
        for (const dep of (tasksById[cur] ? tasksById[cur].needs : [])) {
            if (!seen.has(dep)) { seen.add(dep); stack.push(dep); }
        }
    }
    return seen;
}

export function descendantsOf(id, tasksById, order) {
    const succ = {};
    for (const tid of order) succ[tid] = [];
    for (const tid of order) for (const dep of tasksById[tid].needs) {
        if (succ[dep]) succ[dep].push(tid);
    }
    const seen = new Set();
    const stack = [id];
    while (stack.length) {
        const cur = stack.pop();
        for (const s of (succ[cur] || [])) if (!seen.has(s)) { seen.add(s); stack.push(s); }
    }
    return seen;
}

/* =========================================================================
 * SP -> hours
 * ========================================================================= */

export function spToHours(points, table) {
    if (points == null) return 0;
    if (Object.prototype.hasOwnProperty.call(table, points)) return table[points];
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    if (!keys.length) return 0;
    if (points <= keys[0]) return table[keys[0]] * (points / keys[0]);
    if (points >= keys[keys.length - 1]) {
        const last = keys[keys.length - 1], prev = keys[keys.length - 2];
        const rate = prev != null ? (table[last] - table[prev]) / (last - prev) : table[last] / last;
        return table[last] + (points - last) * rate;
    }
    for (let i = 0; i < keys.length - 1; i++) {
        if (points > keys[i] && points < keys[i + 1]) {
            const t = (points - keys[i]) / (keys[i + 1] - keys[i]);
            return table[keys[i]] + t * (table[keys[i + 1]] - table[keys[i]]);
        }
    }
    return 0;
}

/* =========================================================================
 * Date utilities (working-day calendar, Mon-Fri unless workWeekends)
 * ========================================================================= */

export function parseISODateLocal(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function formatISODateLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function isWeekend(d) { const w = d.getDay(); return w === 0 || w === 6; }

export function addCalendarDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

export function snapToNextWorkingDay(d, workWeekends) {
    let r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    while (!workWeekends && isWeekend(r)) r = addCalendarDays(r, 1);
    return r;
}

function addFractionOfDay(d, frac) { return new Date(d.getTime() + frac * 86400000); }

export function addWorkingDuration(start, hours, hoursPerDay, workWeekends) {
    let cur = snapToNextWorkingDay(start, workWeekends);
    let remaining = Math.max(0, hours);
    if (remaining === 0) return cur;
    const hpd = hoursPerDay > 0 ? hoursPerDay : 8;
    while (true) {
        if (workWeekends || !isWeekend(cur)) {
            if (remaining <= hpd) {
                return addFractionOfDay(cur, remaining / hpd);
            }
            remaining -= hpd;
        }
        cur = addCalendarDays(cur, 1);
    }
}

// Backward mirror of addWorkingDuration: steps a Date backward by N working
// hours. Unlike addWorkingDuration, it never re-snaps `end` to a working-day
// boundary — every value it *returns* already lands on one, so a chain of
// backward calls (each feeding the previous result in as the next `end`)
// never drifts.
export function subtractWorkingDuration(end, hours, hoursPerDay, workWeekends) {
    const hpd = hoursPerDay > 0 ? hoursPerDay : 8;
    let remaining = Math.max(0, hours);
    if (remaining === 0) return end;
    let cur = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    let available = ((end.getTime() - cur.getTime()) / 86400000) * hpd;
    while (true) {
        if (workWeekends || !isWeekend(cur)) {
            if (remaining <= available) {
                return addFractionOfDay(cur, (available - remaining) / hpd);
            }
            remaining -= available;
        }
        cur = addCalendarDays(cur, -1);
        available = hpd;
    }
}

// Inverse of addWorkingDuration: CPM-hours from startDate needed to reach
// targetDate. Used to express a sprint's start date as a lower bound on the
// same hours timeline as ES/EF.
export function workingHoursUntil(targetDate, startDate, hoursPerDay, workWeekends) {
    let cur = snapToNextWorkingDay(startDate, workWeekends);
    let hours = 0;
    const hpd = hoursPerDay > 0 ? hoursPerDay : 8;
    while (cur.getTime() < targetDate.getTime()) {
        if (workWeekends || !isWeekend(cur)) hours += hpd;
        cur = addCalendarDays(cur, 1);
    }
    return hours;
}

/* =========================================================================
 * Assignee-constrained forward simulation
 * ========================================================================= */

// When "1 parallel work per assignee" is on, decide the order each assignee
// runs their tasks in with a forward simulation (parallel schedule-generation
// scheme), then express that order as synthetic "needs" edges so the CPM pass
// works unchanged on top. The original needs list (for tooltips/table) is
// left untouched. At every step the simulation starts, among the tasks whose
// real dependencies have all finished, the one that can start soonest given
// when its assignee frees up — ties go to the task with the most dependent
// work after it, then row order.
export function buildEffectiveNeeds(tasksById, order, config, dur) {
    const rawNeeds = {};
    for (const id of order) rawNeeds[id] = tasksById[id].needs;
    const needsMap = {};
    for (const id of order) needsMap[id] = [...rawNeeds[id]];
    if (!config.oneParallelPerAssignee) return needsMap;

    const baseTopo = topoOrder(rawNeeds, order);
    const succ = {};
    for (const id of order) succ[id] = [];
    for (const id of order) for (const dep of rawNeeds[id]) if (succ[dep]) succ[dep].push(id);
    const downstream = {};
    for (let i = baseTopo.length - 1; i >= 0; i--) {
        const id = baseTopo[i];
        let tail = 0;
        for (const s of succ[id]) tail = Math.max(tail, downstream[s] != null ? downstream[s] : 0);
        downstream[id] = dur[id] + tail;
    }

    const EPS = 1e-9;
    const finish = {};
    const scheduled = new Set();
    const freeAt = {};
    const runOrder = {};

    while (scheduled.size < order.length) {
        let best = null, bestStart = 0;
        for (const id of order) {
            if (scheduled.has(id)) continue;
            let ready = 0, blocked = false;
            for (const dep of rawNeeds[id]) {
                if (!scheduled.has(dep)) { blocked = true; break; }
                ready = Math.max(ready, finish[dep]);
            }
            if (blocked) continue;
            const a = (tasksById[id].assignee || '').trim();
            const start = Math.max(ready, a && freeAt[a] != null ? freeAt[a] : 0);
            if (best === null
                || start < bestStart - EPS
                || (start < bestStart + EPS
                    && (downstream[id] > downstream[best] + EPS
                        || (downstream[id] > downstream[best] - EPS
                            && tasksById[id].rowIndex < tasksById[best].rowIndex)))) {
                best = id; bestStart = start;
            }
        }
        if (best === null) break; // defensive: unreachable after breakCycles
        scheduled.add(best);
        finish[best] = bestStart + dur[best];
        const a = (tasksById[best].assignee || '').trim();
        if (a) {
            freeAt[a] = finish[best];
            (runOrder[a] = runOrder[a] || []).push(best);
        }
    }

    for (const a in runOrder) {
        const ids = runOrder[a];
        for (let i = 1; i < ids.length; i++) {
            const prev = ids[i - 1], cur = ids[i];
            if (!needsMap[cur].includes(prev)) needsMap[cur].push(prev);
        }
    }
    return needsMap;
}

/* =========================================================================
 * CPM scheduling
 * ========================================================================= */

/**
 * config: {
 *   startDate: 'YYYY-MM-DD',
 *   hoursPerDay, spTable, workWeekends, oneParallelPerAssignee,
 *   includeSprints,                          // schedule each sprint as its own block
 *   sprintOrder: ['Sprint 12', ...],         // chronological
 *   sprintDates: { [name]: { start: 'YYYY-MM-DD'|'', end: 'YYYY-MM-DD'|'' } },
 * }
 */
export function computeSchedule(tasksById, order, config) {
    const dur = {};
    // Done tasks are already complete: 0h regardless of their SP estimate.
    for (const id of order) dur[id] = tasksById[id].done ? 0 : spToHours(tasksById[id].points, config.spTable);

    const workWeekends = !!config.workWeekends;
    const startDate = snapToNextWorkingDay(parseISODateLocal(config.startDate), workWeekends);

    const sprintOrder = Array.isArray(config.sprintOrder) ? config.sprintOrder : [];
    const sprintDates = config.sprintDates || {};

    // Sprint floor: a task cannot start before its sprint's start date,
    // expressed in the same CPM-hours timeline as ES/EF so the delay
    // cascades to dependents automatically.
    const sprintFloorHours = {};
    if (config.includeSprints) {
        for (const name of sprintOrder) {
            const sd = sprintDates[name];
            if (sd && sd.start) {
                sprintFloorHours[name] = workingHoursUntil(parseISODateLocal(sd.start), startDate, config.hoursPerDay, workWeekends);
            }
        }
    }

    const ES = {}, EF = {};
    let needsMapCombined = {};
    const scheduleWarnings = [];

    if (!config.includeSprints) {
        needsMapCombined = buildEffectiveNeeds(tasksById, order, config, dur);
        const topo = topoOrder(needsMapCombined, order);
        for (const id of topo) {
            let es = 0;
            for (const dep of needsMapCombined[id]) es = Math.max(es, EF[dep] != null ? EF[dep] : 0);
            ES[id] = es;
            EF[id] = es + dur[id];
        }
    } else {
        // Independent per-sprint CPM blocks, processed chronologically, with
        // tasks that have no sprint scheduled last. Each block gets its own
        // per-assignee simulation, so a delay in one sprint doesn't chain
        // into the next sprint's queue — only real cross-block dependencies
        // and the sprint floor carry forward.
        const present = new Set();
        for (const id of order) present.add(tasksById[id].sprint || '');
        const blockKeys = sprintOrder.filter(name => present.has(name));
        if (present.has('')) blockKeys.push('');

        for (const bk of blockKeys) {
            const blockIds = order.filter(id => (tasksById[id].sprint || '') === bk);
            if (!blockIds.length) continue;
            const blockIdSet = new Set(blockIds);

            // Scope .needs to in-block deps only so the per-assignee
            // simulation and topoOrder only ever see this block; cross-block
            // deps are applied below via already-resolved EF values.
            const blockTasksById = {};
            for (const id of blockIds) {
                blockTasksById[id] = Object.assign({}, tasksById[id], {
                    needs: tasksById[id].needs.filter(d => blockIdSet.has(d)),
                });
            }
            const blockNeeds = buildEffectiveNeeds(blockTasksById, blockIds, config, dur);
            const blockTopo = topoOrder(blockNeeds, blockIds);
            const floor = bk !== '' ? sprintFloorHours[bk] : null;

            for (const id of blockTopo) {
                let es = 0;
                for (const dep of blockNeeds[id]) es = Math.max(es, EF[dep] != null ? EF[dep] : 0);
                for (const dep of tasksById[id].needs) {
                    if (blockIdSet.has(dep)) continue;
                    if (EF[dep] != null) { es = Math.max(es, EF[dep]); continue; }
                    scheduleWarnings.push({ type: 'cross-block', taskId: id, message: `${id} — ${tasksById[id].name} is blocked by a task in a sprint scheduled later; that dependency is ignored for date calculation.` });
                }
                if (floor != null) es = Math.max(es, floor);
                ES[id] = es;
                EF[id] = es + dur[id];
            }
            for (const id of blockIds) needsMapCombined[id] = blockNeeds[id];
        }
    }

    let projectDurationHours = 0;
    for (const id of order) projectDurationHours = Math.max(projectDurationHours, EF[id] || 0);

    // Slack / critical path over one project-wide graph: union of the true
    // real needs (including cross-block edges) and the synthetic
    // per-assignee edges from whichever blocks ran.
    const needsMapForSlack = {};
    for (const id of order) {
        needsMapForSlack[id] = Array.from(new Set([...tasksById[id].needs, ...(needsMapCombined[id] || [])]));
    }
    const fullTopo = topoOrder(needsMapForSlack, order);

    const succ = {};
    for (const id of order) succ[id] = [];
    for (const id of order) for (const dep of needsMapForSlack[id]) succ[dep].push(id);

    const LF = {}, LS = {};
    for (let i = fullTopo.length - 1; i >= 0; i--) {
        const id = fullTopo[i];
        const lf = succ[id].length ? Math.min(...succ[id].map(s => LS[s])) : projectDurationHours;
        LF[id] = lf;
        LS[id] = lf - dur[id];
    }

    const schedule = {};
    for (const id of order) {
        const slack = LS[id] - ES[id];
        schedule[id] = {
            durationHours: dur[id],
            esHours: ES[id], efHours: EF[id], lsHours: LS[id], lfHours: LF[id],
            slack,
            critical: slack <= 0.01,
            start: addWorkingDuration(startDate, ES[id], config.hoursPerDay, workWeekends),
            end: addWorkingDuration(startDate, EF[id], config.hoursPerDay, workWeekends),
        };
    }

    // Done tasks carry 0 duration, so their CPM position is just "whenever
    // their dependencies clear" — for a task in a sprint that already ended,
    // that floor is today (the CPM clock can't run backward), stranding an
    // already-finished item way outside its own sprint's column. Re-anchor
    // those to their sprint's end date so completed work stays visible where
    // it actually happened instead of collapsing onto "today".
    if (config.includeSprints) {
        for (const id of order) {
            const t = tasksById[id];
            if (!t.done) continue;
            const sd = sprintDates[t.sprint];
            if (!t.sprint || !sd || !sd.end) continue;
            const endLimit = snapToNextWorkingDay(parseISODateLocal(sd.end), workWeekends);
            if (schedule[id].end > endLimit) {
                schedule[id].start = endLimit;
                schedule[id].end = endLimit;
            }
        }
    }

    if (config.includeSprints) {
        for (const id of order) {
            const t = tasksById[id];
            const sd = sprintDates[t.sprint];
            if (!t.sprint || !sd || !sd.end) continue;
            const endLimit = parseISODateLocal(sd.end);
            if (schedule[id].end > endLimit) {
                scheduleWarnings.push({ type: 'sprint-overflow', taskId: id, message: `${id} — ${t.name} is scheduled to finish ${formatISODateLocal(schedule[id].end)}, after ${t.sprint}'s end date (${sd.end}).` });
            }
        }
    }

    return {
        schedule,
        projectDurationHours,
        projectStart: startDate,
        projectEnd: addWorkingDuration(startDate, projectDurationHours, config.hoursPerDay, workWeekends),
        scheduleWarnings,
    };
}

/* =========================================================================
 * Workload (per-assignee utilization + idle audit)
 * ========================================================================= */

// Greedy interval-graph coloring: each task gets the first lane whose
// previous occupant already finished. laneCount > 1 = double-booked (only
// possible with the per-assignee constraint off).
function assignLanes(tasks) {
    const laneEnds = [];
    for (const t of tasks) {
        let lane = laneEnds.findIndex(end => t.esHours >= end - 0.01);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(t.efHours); }
        else laneEnds[lane] = Math.max(laneEnds[lane], t.efHours);
        t.lane = lane;
    }
    return laneEnds.length;
}

function fallbackDoneHours(spTable) {
    const keys = Object.keys(spTable || {}).map(Number);
    if (!keys.length) return 0;
    return spToHours(Math.min(...keys), spTable);
}

// Lays out one assignee's Done tasks as a contiguous, non-overlapping chain
// of {start, end} ranges sized by their Story Points — "what this person
// finished," positioned right before whatever they still have pending.
//
// Done tasks carry 0h in the forward CPM (computeSchedule) by design, so
// they don't delay real work — but that also collapses them to a single
// point in time, which is useless for a proportional Workload bar. This
// reconstructs a plausible width/position independently, without touching
// the shared schedule the Timeline view depends on.
//
// Grouped per sprint and packed backward from that sprint's end date — but
// only for sprints that have actually ended (end date before "today"/
// projectStart). A sprint still in progress, one with no end date, or a task
// with no sprint at all all fall back to packing backward from "today"
// instead, so a Done chain can never land in the future or collide with the
// real (always today-or-later) task bars.
function packDoneTasks(doneIds, tasksById, scheduleResult, config) {
    const workWeekends = !!config.workWeekends;
    const hoursPerDay = config.hoursPerDay;
    const projectStart = scheduleResult.projectStart;
    const sprintDates = config.sprintDates || {};

    const buckets = new Map();
    const bucketFor = (key, anchor) => {
        if (!buckets.has(key)) buckets.set(key, { anchor, ids: [] });
        return buckets.get(key);
    };
    for (const id of doneIds) {
        const t = tasksById[id];
        let key = '__today__';
        let anchor = projectStart;
        if (config.includeSprints && t.sprint) {
            const sd = sprintDates[t.sprint];
            if (sd && sd.end) {
                const endLimit = snapToNextWorkingDay(parseISODateLocal(sd.end), workWeekends);
                if (endLimit < projectStart) { key = t.sprint; anchor = endLimit; }
            }
        }
        bucketFor(key, anchor).ids.push(id);
    }

    let results = [];
    for (const { anchor, ids } of buckets.values()) {
        const idSet = new Set(ids);
        const sortedIds = [...ids].sort((a, b) => tasksById[a].rowIndex - tasksById[b].rowIndex);
        const needsMap = {};
        for (const id of sortedIds) needsMap[id] = tasksById[id].needs.filter(d => idSet.has(d));
        const ordered = topoOrder(needsMap, sortedIds);

        let cursor = anchor;
        for (let i = ordered.length - 1; i >= 0; i--) {
            const id = ordered[i];
            const raw = spToHours(tasksById[id].points, config.spTable);
            const hours = raw > 0 ? raw : fallbackDoneHours(config.spTable);
            const end = cursor;
            const start = subtractWorkingDuration(end, hours, hoursPerDay, workWeekends);
            results.push({ id, start, end, hours });
            cursor = start;
        }
    }

    results.sort((a, b) => a.start - b.start || a.end - b.end);
    const proxies = results.map(r => ({ esHours: r.start.getTime(), efHours: r.end.getTime() }));
    const laneCount = proxies.length ? assignLanes(proxies) : 0;
    results.forEach((r, i) => { r.lane = proxies[i].lane; });

    return { doneTasks: results, laneCount };
}

export function computeWorkload(tasksById, order, scheduleResult, config) {
    const schedule = scheduleResult.schedule;
    const byAssignee = {};
    const doneByAssignee = {};
    const milestoneByAssignee = {};
    let unassignedCount = 0;
    for (const id of order) {
        const t = tasksById[id];
        const a = (t.assignee || '').trim();
        if (!a) { unassignedCount++; continue; }
        const sc = schedule[id];
        if (!sc) continue;
        if (t.done) {
            (doneByAssignee[a] = doneByAssignee[a] || []).push(id);
            continue;
        }
        if (sc.durationHours <= 0) {
            // Unestimated but still pending — its forward CPM position could
            // land anywhere, so it doesn't get the Done treatment below (that
            // relies on always sitting at/before "today"). Kept as the
            // existing small marker.
            (milestoneByAssignee[a] = milestoneByAssignee[a] || []).push({ id, esHours: sc.esHours, efHours: sc.efHours });
            continue;
        }
        (byAssignee[a] = byAssignee[a] || []).push({ id, esHours: sc.esHours, efHours: sc.efHours, hours: sc.durationHours });
    }

    const assignees = [];
    const names = new Set([...Object.keys(byAssignee), ...Object.keys(doneByAssignee), ...Object.keys(milestoneByAssignee)]);
    for (const name of names) {
        const tasks = (byAssignee[name] || []).sort((x, y) => x.esHours - y.esHours || x.efHours - y.efHours);
        const laneCount = tasks.length ? assignLanes(tasks) : 0;

        // Union of busy intervals — what "idle" is measured against. Real
        // (not-done) work only — Done tasks never affect these stats.
        const merged = [];
        for (const t of tasks) {
            if (merged.length && t.esHours <= merged[merged.length - 1].end + 0.01) {
                merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, t.efHours);
            } else {
                merged.push({ start: t.esHours, end: t.efHours });
            }
        }
        const spanStart = merged.length ? merged[0].start : 0;
        const spanEnd = merged.length ? merged[merged.length - 1].end : 0;
        const busyHours = merged.reduce((s, m) => s + (m.end - m.start), 0);
        const spanHours = spanEnd - spanStart;
        const idleHours = Math.max(0, spanHours - busyHours);
        const gaps = [];
        for (let i = 1; i < merged.length; i++) gaps.push({ start: merged[i - 1].end, end: merged[i].start });

        // Done tasks share lane space with the real work — a Done chain
        // always ends at/before "today" and real tasks always start at/after
        // it, so they never overlap in time and can sit side by side instead
        // of needing a separate stacked track.
        const { doneTasks, laneCount: doneLaneCount } = packDoneTasks(doneByAssignee[name] || [], tasksById, scheduleResult, config);
        const sharedLaneCount = Math.max(laneCount, doneLaneCount);

        // Unestimated-but-pending markers keep their own padded lane track,
        // stacked below everything else.
        const hpd = config.hoursPerDay > 0 ? config.hoursPerDay : 8;
        const milestones = (milestoneByAssignee[name] || []).sort((x, y) => x.esHours - y.esHours);
        const donePad = hpd * 0.5;
        const milestonePadded = milestones.map(t => ({ esHours: t.esHours, efHours: t.esHours + donePad }));
        const milestoneLaneCount = milestonePadded.length ? assignLanes(milestonePadded) : 0;
        milestonePadded.forEach((p, i) => { milestones[i].lane = sharedLaneCount + p.lane; });

        assignees.push({
            name, tasks, doneTasks, milestones, laneCount: sharedLaneCount + milestoneLaneCount,
            gaps, spanStart, spanEnd, idleHours,
            utilization: spanHours > 0 ? busyHours / spanHours : 1,
            totalHours: tasks.reduce((s, t) => s + t.hours, 0),
            taskCount: tasks.length,
            overbooked: laneCount > 1,
        });
    }
    assignees.sort((a, b) => b.totalHours - a.totalHours);
    return { assignees, unassignedCount };
}

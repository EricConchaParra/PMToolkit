import { spToHours } from './utils.js';

function slugify(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'column';
}

function normalizeStatusName(name = '') {
    return String(name || '').trim().toLowerCase();
}

function getColumnTone(column = {}) {
    if (column.isDone) return 'done';
    if (column.isBlocked) return 'blocked';
    if (column.isReviewLike) return 'review';

    const normalized = normalizeStatusName(column.name);
    if (normalized.includes('todo') || normalized.includes('to do') || normalized.includes('backlog')) return 'todo';
    if (normalized.includes('progress') || normalized.includes('build') || normalized.includes('develop')) return 'progress';
    return 'default';
}

function getColumnIcon(column = {}) {
    const tone = getColumnTone(column);
    if (tone === 'done') return '✅';
    if (tone === 'blocked') return '🚫';
    if (tone === 'review') return '🔎';
    if (tone === 'todo') return '⬜';
    if (tone === 'progress') return '🔵';
    return '🧩';
}

function buildColumnMeta(rawColumn = {}, index = 0, isDone = false) {
    const name = String(rawColumn?.name || `Column ${index + 1}`);
    const normalized = normalizeStatusName(name);
    const isTodoLike = normalized.includes('todo') || normalized.includes('to do') || normalized.includes('backlog');

    return {
        id: rawColumn?.id != null && rawColumn.id !== ''
            ? String(rawColumn.id)
            : `board-column-${index}-${slugify(name)}`,
        name,
        order: index,
        statuses: Array.isArray(rawColumn?.statuses)
            ? rawColumn.statuses.map(status => ({
                id: status?.id != null && status.id !== '' ? String(status.id) : null,
                name: String(status?.name || ''),
            }))
            : [],
        isDone: rawColumn?.isDone === true || isDone,
        isTodoLike,
        isBlocked: /blocked|hold|imped/.test(normalized),
        isReviewLike: /review|qa|test|approve/.test(normalized),
    };
}

export function createBoardFlow(boardConfig = {}) {
    const rawColumns = Array.isArray(boardConfig?.columnConfig?.columns) ? boardConfig.columnConfig.columns : [];
    const lastMappedIndex = rawColumns.reduce((lastIndex, column, index) =>
        Array.isArray(column?.statuses) && column.statuses.length ? index : lastIndex, -1);

    const columns = rawColumns.map((column, index) => {
        const meta = buildColumnMeta(column, index, index === lastMappedIndex && lastMappedIndex >= 0);
        return {
            ...meta,
            tone: getColumnTone(meta),
            icon: getColumnIcon(meta),
        };
    });

    const statusToColumn = new Map();
    const columnsById = new Map();
    const columnByName = new Map();
    const fallbackColumnId = columns[0]?.id || null;

    columns.forEach(column => {
        columnsById.set(column.id, column);
        columnByName.set(normalizeStatusName(column.name), column.id);
        column.statuses.forEach(status => {
            if (status.id) statusToColumn.set(`id:${status.id}`, column.id);
            if (status.name) statusToColumn.set(`name:${normalizeStatusName(status.name)}`, column.id);
        });
    });

    return {
        columns,
        doneColumnId: columns.find(column => column.isDone)?.id || null,
        fallbackColumnId,
        statusToColumn,
        columnsById,
        columnByName,
    };
}

function getFallbackStatusGroup(status = {}) {
    const normalized = normalizeStatusName(status?.name);
    const categoryKey = String(status?.categoryKey || '').toLowerCase();

    if (categoryKey === 'done') {
        return { id: 'done', order: 40, name: 'Done', isDone: true };
    }
    if (normalized.includes('blocked') || normalized.includes('hold') || normalized.includes('imped') || normalized.includes('fix')) {
        return { id: 'blocked', order: 30, name: 'Need Fixes', isDone: false };
    }
    if (normalized.includes('review') || normalized.includes('qa') || normalized.includes('test') || normalized.includes('approve')) {
        return { id: 'review', order: 20, name: 'In Review', isDone: false };
    }
    if (normalized.includes('progress') || normalized.includes('build') || normalized.includes('develop') || normalized.includes('doing')) {
        return { id: 'progress', order: 10, name: 'In Progress', isDone: false };
    }
    if (categoryKey === 'new' || normalized.includes('todo') || normalized.includes('to do') || normalized.includes('backlog')) {
        return { id: 'todo', order: 0, name: 'To Do', isDone: false };
    }

    return {
        id: `status-${slugify(status?.name || 'status')}`,
        order: categoryKey === 'done' ? 40 : 15,
        name: String(status?.name || 'In Progress'),
        isDone: categoryKey === 'done',
    };
}

export function buildFallbackBoardConfig(statuses = []) {
    const groups = new Map();

    (Array.isArray(statuses) ? statuses : []).forEach(status => {
        const group = getFallbackStatusGroup(status);
        if (!groups.has(group.id)) {
            groups.set(group.id, {
                id: `fallback-${group.id}`,
                name: group.name,
                isDone: group.isDone,
                order: group.order,
                statuses: [],
            });
        }

        groups.get(group.id).statuses.push({
            id: status?.id != null && status.id !== '' ? String(status.id) : null,
            name: String(status?.name || ''),
        });
    });

    const columns = Array.from(groups.values())
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
        .map(({ order, ...column }) => column);

    return {
        columnConfig: {
            columns,
        },
    };
}

export function resolveBoardColumnByStatus(status = {}, boardFlow) {
    if (!boardFlow) return null;

    const statusId = status?.id != null && status.id !== '' ? String(status.id) : '';
    const normalizedName = normalizeStatusName(status?.name);
    const resolvedId = (statusId && boardFlow.statusToColumn.get(`id:${statusId}`))
        || (normalizedName && boardFlow.statusToColumn.get(`name:${normalizedName}`))
        || null;

    return boardFlow.columnsById.get(resolvedId || boardFlow.fallbackColumnId) || null;
}

export function resolveIssueBoardColumn(issue, boardFlow) {
    return resolveBoardColumnByStatus(issue?.fields?.status || {}, boardFlow);
}

export function resolveBoardColumnFromHistoryChange(change = {}, boardFlow) {
    return resolveBoardColumnByStatus({
        id: change?.toId ?? change?.toStatusId ?? '',
        name: change?.to || change?.toName || '',
    }, boardFlow);
}

export function resolveCurrentBoardColumnSince(issue, statusChanges = [], boardFlow) {
    const currentColumn = resolveIssueBoardColumn(issue, boardFlow);
    if (!currentColumn) return issue?.fields?.updated || null;

    const orderedChanges = Array.isArray(statusChanges)
        ? [...statusChanges].sort((left, right) => new Date(left.created) - new Date(right.created))
        : [];

    let previousColumnId = null;
    let currentColumnSince = null;

    orderedChanges.forEach(change => {
        const nextColumn = resolveBoardColumnFromHistoryChange(change, boardFlow);
        if (!nextColumn) return;
        if (nextColumn.id !== previousColumnId && nextColumn.id === currentColumn.id) {
            currentColumnSince = change.created;
        }
        previousColumnId = nextColumn.id;
    });

    return currentColumnSince || issue?.fields?.updated || null;
}

export function buildBoardColumnBuckets(issues = [], boardFlow, spHours = {}) {
    const bucketMap = new Map();

    (boardFlow?.columns || []).forEach(column => {
        bucketMap.set(column.id, {
            column,
            issues: [],
            count: 0,
            sp: 0,
            hours: 0,
        });
    });

    issues.forEach(issue => {
        const column = resolveIssueBoardColumn(issue, boardFlow);
        if (!column || !bucketMap.has(column.id)) return;

        const bucket = bucketMap.get(column.id);
        bucket.issues.push(issue);
        bucket.count += 1;
        bucket.sp += Number(issue?._sp || 0);
        bucket.hours += spToHours(issue?._sp || 0, spHours);
    });

    return Array.from(bucketMap.values()).sort((left, right) => left.column.order - right.column.order);
}

export function getPendingBoardBuckets(buckets = []) {
    return buckets.filter(bucket => bucket.column?.isDone !== true);
}

export function summarizeBoardBuckets(buckets = []) {
    const totalIssues = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    const totalSp = buckets.reduce((sum, bucket) => sum + bucket.sp, 0);
    const doneBucket = buckets.find(bucket => bucket.column?.isDone) || null;
    const pendingBuckets = getPendingBoardBuckets(buckets);

    return {
        totalIssues,
        totalSp,
        doneIssues: doneBucket?.count || 0,
        doneSp: doneBucket?.sp || 0,
        pendingIssues: pendingBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
        pendingSp: pendingBuckets.reduce((sum, bucket) => sum + bucket.sp, 0),
        pendingHours: pendingBuckets.reduce((sum, bucket) => sum + bucket.hours, 0),
    };
}

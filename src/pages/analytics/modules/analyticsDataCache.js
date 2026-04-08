const analyticsCache = {
    projectsByHost: new Map(),
    boardIdByHostProject: new Map(),
    boardConfigByHostBoard: new Map(),
    spFieldIdByHost: new Map(),
    sprintFieldIdByHost: new Map(),
    projectStatusesByHostProject: new Map(),
};

function getOrCreatePendingEntry(store, key, loader) {
    const cached = store.get(key);
    if (cached) return cached;

    const pending = Promise.resolve()
        .then(loader)
        .then(value => {
            store.set(key, { value, pending: null });
            return value;
        })
        .catch(error => {
            store.delete(key);
            throw error;
        });

    store.set(key, { value: undefined, pending });
    return { value: undefined, pending };
}

async function withCache(store, key, loader) {
    const cached = store.get(key);
    if (cached?.pending) return cached.pending;
    if (cached && Object.prototype.hasOwnProperty.call(cached, 'value')) return cached.value;

    const entry = getOrCreatePendingEntry(store, key, loader);
    return entry.pending || entry.value;
}

export function clearAnalyticsDataCache(scope = {}) {
    if (scope.host && scope.projectKey) {
        analyticsCache.boardIdByHostProject.delete(`${scope.host}:${scope.projectKey}`);
        analyticsCache.projectStatusesByHostProject.delete(`${scope.host}:${scope.projectKey}`);
    } else if (scope.host) {
        analyticsCache.projectsByHost.delete(scope.host);
        analyticsCache.spFieldIdByHost.delete(scope.host);
        analyticsCache.sprintFieldIdByHost.delete(scope.host);

        Array.from(analyticsCache.boardIdByHostProject.keys())
            .filter(key => key.startsWith(`${scope.host}:`))
            .forEach(key => analyticsCache.boardIdByHostProject.delete(key));

        Array.from(analyticsCache.boardConfigByHostBoard.keys())
            .filter(key => key.startsWith(`${scope.host}:`))
            .forEach(key => analyticsCache.boardConfigByHostBoard.delete(key));

        Array.from(analyticsCache.projectStatusesByHostProject.keys())
            .filter(key => key.startsWith(`${scope.host}:`))
            .forEach(key => analyticsCache.projectStatusesByHostProject.delete(key));
    } else {
        analyticsCache.projectsByHost.clear();
        analyticsCache.boardIdByHostProject.clear();
        analyticsCache.boardConfigByHostBoard.clear();
        analyticsCache.spFieldIdByHost.clear();
        analyticsCache.sprintFieldIdByHost.clear();
        analyticsCache.projectStatusesByHostProject.clear();
    }
}

export function getCachedProjects(host, loader) {
    return withCache(analyticsCache.projectsByHost, host, loader);
}

export function getCachedBoardId(host, projectKey, loader) {
    return withCache(analyticsCache.boardIdByHostProject, `${host}:${projectKey}`, loader);
}

export function getCachedBoardConfig(host, boardId, loader) {
    return withCache(analyticsCache.boardConfigByHostBoard, `${host}:${boardId}`, loader);
}

export function getCachedSpFieldId(host, loader) {
    return withCache(analyticsCache.spFieldIdByHost, host, loader);
}

export function getCachedSprintFieldId(host, loader) {
    return withCache(analyticsCache.sprintFieldIdByHost, host, loader);
}

export function getCachedProjectStatuses(host, projectKey, loader) {
    return withCache(analyticsCache.projectStatusesByHostProject, `${host}:${projectKey}`, loader);
}

/**
 * Checks if the extension context is still valid.
 */
export const isContextValid = () => {
    return !!chrome.runtime?.id;
};

/**
 * Modular wrapper for chrome.storage.local with error handling.
 */
export const storage = {
    get(keys) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (storage.get).');
                return resolve({});
            }
            try {
                chrome.storage.local.get(keys, (items) => {
                    if (chrome.runtime?.lastError) {
                        console.warn('PMsToolKit: Storage fetch error', chrome.runtime.lastError);
                        resolve({});
                    } else {
                        resolve(items);
                    }
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated during storage.get.');
                resolve({});
            }
        });
    },

    set(data) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (storage.set).');
                return resolve();
            }
            try {
                chrome.storage.local.set(data, () => {
                    if (chrome.runtime?.lastError) {
                        console.warn('PMsToolKit: Storage set error', chrome.runtime.lastError);
                    }
                    resolve();
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated during storage.set.');
                resolve();
            }
        });
    },

    remove(keys) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (storage.remove).');
                return resolve();
            }
            try {
                chrome.storage.local.remove(keys, () => {
                    if (chrome.runtime?.lastError) {
                        console.warn('PMsToolKit: Storage remove error', chrome.runtime.lastError);
                    }
                    resolve();
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated during storage.remove.');
                resolve();
            }
        });
    },

    getAll() {
        return this.get(null);
    }
};

export const syncStorage = {
    get(keys) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (syncStorage.get).');
                return resolve({});
            }
            try {
                chrome.storage.sync.get(keys, (items) => {
                    if (chrome.runtime?.lastError) {
                        resolve({});
                    } else {
                        resolve(items);
                    }
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated (sync), please refresh.');
                resolve({});
            }
        });
    },
    set(data) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (syncStorage.set).');
                return resolve();
            }
            try {
                chrome.storage.sync.set(data, () => {
                    resolve();
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated (sync), please refresh.');
                resolve();
            }
        });
    }
};

export const sessionStorage = {
    get(keys) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (sessionStorage.get).');
                return resolve({});
            }
            if (!chrome.storage?.session) {
                resolve({});
                return;
            }
            try {
                chrome.storage.session.get(keys, (items) => {
                    if (chrome.runtime?.lastError) {
                        console.warn('PMsToolKit: Session storage fetch error', chrome.runtime.lastError);
                        resolve({});
                    } else {
                        resolve(items);
                    }
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated during sessionStorage.get.');
                resolve({});
            }
        });
    },
    set(data) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (sessionStorage.set).');
                return resolve();
            }
            if (!chrome.storage?.session) {
                resolve();
                return;
            }
            try {
                chrome.storage.session.set(data, () => {
                    if (chrome.runtime?.lastError) {
                        console.warn('PMsToolKit: Session storage set error', chrome.runtime.lastError);
                    }
                    resolve();
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated during sessionStorage.set.');
                resolve();
            }
        });
    },
    remove(keys) {
        return new Promise((resolve) => {
            if (!isContextValid()) {
                console.warn('PMsToolKit: Context invalidated (sessionStorage.remove).');
                return resolve();
            }
            if (!chrome.storage?.session) {
                resolve();
                return;
            }
            try {
                chrome.storage.session.remove(keys, () => {
                    if (chrome.runtime?.lastError) {
                        console.warn('PMsToolKit: Session storage remove error', chrome.runtime.lastError);
                    }
                    resolve();
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated during sessionStorage.remove.');
                resolve();
            }
        });
    }
};

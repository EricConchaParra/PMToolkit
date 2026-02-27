/**
 * Modular wrapper for chrome.storage.local with error handling.
 */
export const storage = {
    get(keys) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.get(keys, (items) => {
                    if (chrome.runtime.lastError) {
                        console.warn('PMsToolKit: Storage fetch error', chrome.runtime.lastError);
                        resolve({});
                    } else {
                        resolve(items);
                    }
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated, please refresh the page.');
                resolve({});
            }
        });
    },

    set(data) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.set(data, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('PMsToolKit: Storage set error', chrome.runtime.lastError);
                    }
                    resolve();
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated, please refresh the page.');
                resolve();
            }
        });
    },

    remove(keys) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.remove(keys, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('PMsToolKit: Storage remove error', chrome.runtime.lastError);
                    }
                    resolve();
                });
            } catch (e) {
                console.warn('PMsToolKit: Context invalidated, please refresh the page.');
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
            chrome.storage.sync.get(keys, resolve);
        });
    },
    set(data) {
        return new Promise((resolve) => {
            chrome.storage.sync.set(data, resolve);
        });
    }
};

(async () => {
    const src = chrome.runtime.getURL('zoom-content.js');
    await import(src);
})();

export function getDashVisibilityState(state, { hasVisibleData = false } = {}) {
    const visibility = {
        showError: false,
        showEmpty: false,
        showPlaceholder: false,
        showData: false,
        showSkeleton: false,
        showReloadOverlay: false,
        isBusy: false,
    };

    if (state === 'loading') {
        visibility.isBusy = true;
        if (hasVisibleData) {
            visibility.showData = true;
            visibility.showReloadOverlay = true;
        } else {
            visibility.showSkeleton = true;
        }
        return visibility;
    }

    if (state === 'error') {
        visibility.showError = true;
        return visibility;
    }

    if (state === 'empty') {
        visibility.showEmpty = true;
        return visibility;
    }

    if (state === 'placeholder') {
        visibility.showPlaceholder = true;
        return visibility;
    }

    if (state === 'data') {
        visibility.showData = true;
    }

    return visibility;
}

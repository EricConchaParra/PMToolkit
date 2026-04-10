import { describe, expect, it } from 'vitest';

import { getDashVisibilityState } from './dashVisibility.js';

describe('getDashVisibilityState', () => {
    it('shows the standalone skeleton when loading without visible dashboard data', () => {
        expect(getDashVisibilityState('loading', { hasVisibleData: false })).toEqual({
            showError: false,
            showEmpty: false,
            showPlaceholder: false,
            showData: false,
            showSkeleton: true,
            showReloadOverlay: false,
            isBusy: true,
        });
    });

    it('keeps dashboard data visible and adds the reload overlay when loading over existing content', () => {
        expect(getDashVisibilityState('loading', { hasVisibleData: true })).toEqual({
            showError: false,
            showEmpty: false,
            showPlaceholder: false,
            showData: true,
            showSkeleton: false,
            showReloadOverlay: true,
            isBusy: true,
        });
    });

    it('clears all loading chrome when data is ready', () => {
        expect(getDashVisibilityState('data', { hasVisibleData: true })).toEqual({
            showError: false,
            showEmpty: false,
            showPlaceholder: false,
            showData: true,
            showSkeleton: false,
            showReloadOverlay: false,
            isBusy: false,
        });
    });

    it('shows the terminal placeholder state without stale content or loading overlays', () => {
        expect(getDashVisibilityState('placeholder', { hasVisibleData: true })).toEqual({
            showError: false,
            showEmpty: false,
            showPlaceholder: true,
            showData: false,
            showSkeleton: false,
            showReloadOverlay: false,
            isBusy: false,
        });
    });

    it('shows the terminal empty state without stale content or loading overlays', () => {
        expect(getDashVisibilityState('empty', { hasVisibleData: true })).toEqual({
            showError: false,
            showEmpty: true,
            showPlaceholder: false,
            showData: false,
            showSkeleton: false,
            showReloadOverlay: false,
            isBusy: false,
        });
    });

    it('shows the terminal error state without stale content or loading overlays', () => {
        expect(getDashVisibilityState('error', { hasVisibleData: true })).toEqual({
            showError: true,
            showEmpty: false,
            showPlaceholder: false,
            showData: false,
            showSkeleton: false,
            showReloadOverlay: false,
            isBusy: false,
        });
    });
});

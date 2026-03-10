# Version Update Guide

When updating the version of the PMToolkit Extension (e.g., from v0.3.0 to v0.4.0), ensure that it is updated in the following locations to maintain consistency across the UI, manifest, and package metadata.

## Required Locations

1.  **`package.json`**
    - Update the `"version"` field.
    - Example: `"version": "0.4.0"`

2.  **`package-lock.json`**
    - Ensure it matches `package.json` (usually updated automatically by npm, but verify if editing manually).

3.  **`public/manifest.json`**
    - Update the `"version"` field.
    - Update the `"description"` if it contains a version suffix (e.g., `(Beta v0.4.0)`).

4.  **`README.md`**
    - Update the version in the **Installation** section header.
    - Update the version in the **footer** note.

5.  **Extension Popup (`index.html` at root)**
    - Update the version in the `.about-footer` section.
    - Example: `<strong>PMsToolKit v0.4.0</strong>`

6.  **Analytics Hub (`src/pages/analytics/index.html`)**
    - Update the version in the `.sidebar-footer` section.
    - Example: `<span>v0.4.0 · PMsToolKit</span>`

7.  **History Exporter (`src/pages/exporter/index.html`)**
    - Update the version in the `<header>` description.
    - Example: `<p>PMsToolKit v0.4.0 · Export issue field changes to CSV</p>`

## Post-Update Steps

- Run `npm run build` to ensure the changes are reflected in the `dist/` directory.
- Verify the version in the loaded extension's popup and dashboards.

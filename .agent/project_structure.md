# PMToolkit Extension - Project Architecture

This document describes the structure and architecture of the PMToolkit Chrome Extension, which has recently been migrated to a Vite-based build setup.

## High-Level Architecture
- **Framework:** Vanilla JavaScript with Vite as the bundler.
- **Environment:** Chrome Extension Manifest V3.
- **Entry Points:** Managed via `vite.config.js` to build the background script, content scripts, and popup UI.

## Directory Structure

\`\`\`
/ (Root)
├── .agent/             # AI Assistant instructions and workflows (like this file)
├── dist/               # Production build output (loaded into Chrome)
├── public/             # Static assets (icons, etc.) copied directly to dist/
├── src/                # Source code
│   ├── assets/         # Shared static assets (CSS, images)
│   ├── background/     # Background service worker (`background.js`)
│   ├── common/         # Shared utilities and helpers across the extension
│   ├── content/        # Content scripts injected into web pages (e.g., Jira)
│   │   └── jira/       # Jira-specific content script modules
│   └── popup/          # Extension popup UI (`popup.html`, `popup.css`, `popup.js`)
├── index.html          # Entry point for development / Vite
├── package.json        # NPM dependencies and scripts (e.g., `npm run build`)
└── vite.config.js      # Vite configuration for building the Chrome Extension
\`\`\`

## Key Files and Their Roles
- `src/background/background.js`: Handles extension-level events (installation, background fetching if needed).
- `src/content/jira/main.js` (or similar entering point in `src/content`): The main content script injected into Jira pages to interact with the DOM and add PMToolkit features (e.g., badges, buttons).
- `src/popup/popup.html` & `src/popup/popup.js`: The UI that appears when clicking the extension icon.
- `vite.config.js`: Contains the Rollup configuration to correctly output the multiple entry points (`background`, `content`, `popup`) required by Manifest V3.

## Workflow Notes
- Run `npm install` to install dependencies.
- Run `npm run dev` for development (Vite dev server) or `npm run build` to generate the `dist/` folder.
- **CRITICAL AGENT INSTRUCTION:** After implementing any code changes, you MUST run `npm run build` to compile the changes into the `dist/` directory before asking the user to verify.
- Load the unpacked extension in Chrome from the `dist/` directory.

## Maintenance Tasks
- **Updating Version:** When bumping the extension version, refer to [.agent/version_update.md](file:///Users/ericconcha/desarrollo/PMToolkit%20Extension/.agent/version_update.md) for a full checklist of locations to update.

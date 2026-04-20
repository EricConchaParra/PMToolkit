# PMsToolKit

Chrome extension focused on improving day-to-day work in Jira Cloud. It adds lightweight workflow tools directly into Jira, keeps personal follow-up data in browser storage, and includes an internal analytics workspace for sprint and performance reporting.

## What The Extension Does Today

### Jira productivity layer

- Adds copy-link actions to issue rows, native issue tables, board cards, and issue breadcrumbs.
- Opens a shared note drawer for any issue with personal notes, reminders, and tags.
- Shows tracking indicators when an issue already has notes, reminders, or tags.
- Displays time-in-status badges in list views, native tables, board cards, and issue headers.
- Injects Story Point summaries into Jira dashboard stats gadgets.
- Adds a custom manual menu in Jira's top navigation based on saved shortcuts.
- Optionally hides selected Jira header elements and auto-collapses the sidebar.

### Personal tracking

- Stores notes, reminders, tags, and cached issue metadata in `chrome.storage`.
- Schedules reminders through `chrome.alarms` and shows browser notifications.
- Queues missed reminders and re-surfaces them when Jira is opened again.
- Lets you review, search, edit, copy, and delete tracked issues from the popup.
- Supports reusable colored tags shared across the extension.

### Analytics Hub

The popup opens a dedicated analytics page with four working areas:

- `Sprint Dashboard`: active sprint view by developer, sprint selection, tag filtering, capacity settings, and optional GitHub PR enrichment.
- `Team Performance`: throughput, velocity, contributor summaries, and CSV export.
- `Sprint Closure Report`: closed sprint summary with carryover and capture-oriented output.
- `History Exporter`: JQL-driven CSV export of issue change history.

### Optional integrations

- `GitHub`: optional PAT-based PR lookup. When enabled, the extension can surface PR status in analytics and add PR buttons on Jira board cards when snapshot data exists.
- `Zoom`: adds a `Copy Transcript` button on supported Zoom recording transcript pages.

## Popup Settings

The popup currently exposes toggles for:

- Jira UI cleanup
- Sidebar auto-collapse
- Manual Jira menu
- Copy-for-Slack actions
- Quick notes on lists and ticket pages
- Breadcrumb copy action
- Time-in-status indicators
- Board age indicators
- Story Point dashboard summaries
- Native table icons
- Zoom transcript copy
- GitHub PR linking

When GitHub linking is enabled, the popup also stores a Personal Access Token in sync storage.

## Data And Permissions

- Jira pages: `https://*.atlassian.net/*`
- Zoom recording pages: `https://*.zoom.us/rec/play/*`, `https://*.zoom.us/rec/share/*`
- GitHub API: `https://api.github.com/*`

Main Chrome permissions used by the extension:

- `storage`
- `alarms`
- `notifications`
- `tabs`
- `clipboardWrite`

Personal notes, reminders, tags, and cached issue metadata stay in browser storage. The extension uses Jira REST APIs from the logged-in browser session and GitHub API requests only when GitHub support is enabled.

## Project Structure

```text
public/
  manifest.json
  content-loader.js
  zoom-loader.js

src/
  background/           Service worker for reminders, notifications, and PR snapshot messages
  common/               Shared storage, Jira/GitHub helpers, tagging, issue metadata
  content/jira/         Jira content scripts, UI injections, drawer, reminder modal
  content/zoom/         Zoom transcript copy feature
  popup/                Extension popup
  pages/analytics/      Analytics Hub
  pages/exporter/       Standalone Jira history exporter page
```

## Development

### Requirements

- Node.js
- npm
- Google Chrome or another Chromium browser with extension developer mode

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

### Production build

```bash
npm run build
```

This generates the extension bundle in `dist/`.

### Load in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the project `dist/` directory after building.

## Tests

```bash
npm test
```

The repository currently includes Vitest coverage for core tracking, board flow, GitHub PR cache/snapshot logic, sprint dashboard helpers, and performance dashboard behavior.

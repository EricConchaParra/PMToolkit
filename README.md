# PMsToolKit

Chrome extension focused on improving day-to-day work in Jira Cloud. It adds lightweight workflow tools directly into Jira, keeps personal follow-up data in browser storage, and includes an internal analytics workspace for sprint and performance reporting.

## Visual Overview

### Popup and personal tracking

### Jira productivity layer

- Adds copy-link actions to issue rows, native issue tables, board cards, and issue breadcrumbs.
- Opens a shared note drawer for any issue with personal notes, reminders, and tags.
- Shows tracking indicators when an issue already has notes, reminders, or tags.
- Displays time-in-status badges in list views, native tables, board cards, and issue headers.
- Injects Story Point summaries into Jira dashboard stats gadgets.
- Adds a custom manual menu in Jira's top navigation based on saved shortcuts.
- Optionally hides selected Jira header elements and auto-collapses the sidebar.

![Jira note drawer used to capture notes, reminders, and tags for an issue](assets/Internal%20Notes%20-%20Include%20Tags%20and%20Reminder.png)

### Personal tracking

- Stores notes, reminders, tags, and cached issue metadata in `chrome.storage`.
- Schedules reminders through `chrome.alarms` and shows browser notifications.
- Queues missed reminders and re-surfaces them when Jira is opened again.
- Lets you review, search, edit, copy, and delete tracked issues from the popup.
- Supports reusable colored tags shared across the extension.
- Reuses the same note drawer inside Analytics so sprint chips and Jira pages edit the same tracking data.

![Popup view for browsing tracked issues and reminders](assets/PopUp%20with%20Notes.png)

### Analytics Hub

The popup opens a dedicated analytics page with four working areas:

- `Sprint Dashboard`: active, closed, or future sprint view by developer, sprint selection, tag filtering, capacity settings, inline notes/reminders/tags, and optional GitHub PR enrichment.
- `Team Performance`: throughput, velocity, contributor summaries, and CSV export.
- `Sprint Closure Report`: closed sprint summary with carryover and capture-oriented output.
- `History Exporter`: JQL-driven CSV export of issue change history.

### Sprint Dashboard

![Sprint Dashboard overview with sprint summary and team status](assets/Sprint%20Dashboard%20-%20General%20Status.png)

![Sprint Dashboard developer card with GitHub PR enrichment and tracking actions](assets/Sprint%20Dashboard%20-%201%20Dev%20Status%20with%20GH%20PRs.png)

![Sprint Dashboard with multiple developers and issue distributions](assets/Sprint%20Dashboard%20-%203%20perople%20Status.png)

![Sprint Dashboard time-in-status visualization](assets/Sprint%20Dashboard%20-%20Time%20In%20Status.png)

### Team Performance

![Team Performance analytics with throughput and velocity trends](assets/Team%20Performance%20Tab.png)

### Sprint Closure Report

![Sprint Closure Report with carryover, scope changes, and capture-ready summary](assets/Sprint%20Closure%20Report.png)

### Demo mode

- Analytics supports a dedicated demo mode with mock Jira data only; it does not touch your real Jira tracking data.
- Demo sprints use dynamic dates so the active sprint always stays a few days away from completion.
- Demo issues include richer tracking examples: notes, reminders, tags, carryover work, and larger developer/task coverage.
- Demo GitHub enrichment includes mock PR states and labels such as `Draft`, `Merged`, and `QA Pass`.

### Optional integrations

- `GitHub`: optional PAT-based PR lookup. When enabled, the extension can surface PR status, labels, and draft/merged state in analytics and add PR buttons on Jira board cards when snapshot data exists.
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

Personal notes, reminders, tags, and cached issue metadata stay in browser storage. The extension uses Jira REST APIs from the logged-in browser session and GitHub API requests only when GitHub support is enabled. Demo mode keeps its mock tracking state separate from real Jira tracking data.

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

The repository currently includes Vitest coverage for core tracking, board flow, demo data generation, GitHub PR cache/snapshot logic, sprint dashboard helpers, and performance dashboard behavior.

# PMsToolKit — Chrome Extension for Jira

> **The professional productivity layer for Jira Cloud.**
> Created by **EricConcha**.

PMsToolKit is a personal productivity powerhouse designed for Project Managers, Team Leads, and developers who live in Jira but need a faster, more streamlined workflow. It acts as a lightweight enhancement layer that injects professional tools directly into your existing Jira interface—helping you communicate more effectively and manage your time without ever leaving your browser tab.

---

## 💡 What is PMsToolKit?

Jira is powerful, but it can be slow and overwhelming. **PMsToolKit** fills the gaps in your daily workflow by adding the "missing" features that make project management fluid:

*   **Seamless Communication:** Copy perfectly formatted ticket links for Slack or Notion with one click. No more messy URLs.
*   **Context at a Glance:** Instantly see how long a ticket has been in its current state with color-coded badges, helping you spot bottlenecks before they become blockers.
*   **Personal Knowledge Base:** Maintain private, Notion-like notes for any ticket. Keep your thoughts organized without cluttering the official Jira comments.
*   **Intelligent Reminders:** Set follow-up alerts for yourself. The toolkit ensures you never miss a deadline by surfacing missed notifications the moment you log in.
*   **Data-Driven Decisions:** View Story Point summaries directly on your dashboards, and track developer velocity through the dedicated Sprint Dashboard.

**Built for speed, privacy, and simplicity.** PMsToolKit requires zero Jira admin configuration and stores all your personal data locally in your browser.

---

- [Table of Contents](#table-of-contents)
- [Features Overview](#features-overview)
- [Feature Details](#feature-details)
  - [🔗 Copy Link for Slack — List View](#-copy-link-for-slack--list-view)
  - [🔗 Copy Link for Slack — Native Issue Table](#-copy-link-for-slack--native-issue-table)
  - [🔗 Copy Link in Breadcrumbs — Ticket View](#-copy-link-in-breadcrumbs--ticket-view)
  - [📝 Note Drawer & Reminders (Global)](#-note-drawer--reminders-global)
  - [🔔 Persistent & Missed Alerts](#-persistent--missed-alerts)
  - [🌐 Multi-Source Logic (Prefixing)](#-multi-source-logic-prefixing)
  - [📋 View, Edit & Sync Notes — Extension Popup](#-view-edit--sync-notes--extension-popup)
  - [⏱️ Time in State — List View](#%EF%B8%8F-time-in-state--list-view)
  - [⏱️ Time in State — Native Issue Table](#%EF%B8%8F-time-in-state--native-issue-table)
  - [⏱️ Time in State — Board Cards](#%EF%B8%8F-time-in-state--board-cards)
  - [⏱️ Time in State — Breadcrumb Navigation](#%EF%B8%8F-time-in-state--breadcrumb-navigation)
  - [📊 Story Points in Dashboard Gadgets](#-story-points-in-dashboard-gadgets)
  - [📹 Zoom Copy Transcript](#-zoom-copy-transcript)
- [Architecture & Technical Details](#architecture--technical-details)
  - [Build System (Vite)](#build-system-vite)
  - [Modular File Structure](#modular-file-structure)
  - [Content Script Lifecycle](#content-script-lifecycle)
  - [safeStorage Wrapper](#safestorage-wrapper)
  - [Jira REST API Usage](#jira-rest-api-usage)
  - [Concurrency Queue](#concurrency-queue)
  - [In-Memory Cache](#in-memory-cache)
  - [Global Tooltip System](#global-tooltip-system)
  - [Clipboard API (Rich Text)](#clipboard-api-rich-text)
- [Installation](#installation)

---

## Features Overview

| # | Feature | Where it appears | Trigger |
|---|---------|-----------------|---------|
| 1 | Copy Link for Slack | Legacy list views | 🔗 button per row |
| 2 | Copy Link for Slack | Native issue table | 🔗 button per row |
| 3 | Copy Link in Breadcrumbs | Ticket detail pages | 🔗 button in breadcrumb nav |
| 4 | Note Drawer & Reminders | All views (List, Board, Ticket) | 📝 button or "Personal notes" panel |
| 5 | Missed Alerts Queue | Global (on Jira Load) | Automatically shows missed reminders |
| 6 | Multi-Source Prefixes | Storage/Logic | Auto-migrates `notes_` keys to `notes_jira:` |
| 7 | Notification Diagnostics | Extension Popup | "Test System Notification" button in settings |
| 8 | View, Edit & Sync Notes | Extension Popup | Click extension icon |
| 9 | Time in State | Legacy list views | Auto-injected badge per row |
| 10 | Time in State | Native issue table | Auto-injected badge per row |
| 11 | Time in State | Board cards (Kanban/Scrum) | Auto-injected badge per card |
| 12 | Time in State | Breadcrumb navigation | Auto-injected badge |
| 13 | Story Points Summary | Dashboard gadgets | Auto-injected SP column (by Assignee/Status) |
| 15 | Zoom Copy Transcript | Zoom recording pages | 📋 "Copy Transcript" button |
| 16 | Jira History Exporter | Dedicated Page (from Popup) | "Export History to CSV" button |
| 18 | GitHub PR Link | Sprint Dashboard | Direct link in ticket chips (In Review) |
| 19 | Follow-up Work Dashboard | Dedicated Page (from Popup) | 🔔 "Follow-up Work" tab |
| 20 | Jira Tagging System | All views / Note Drawer | Use Tag Editor to label tickets |

---

## Feature Details

### 🔗 Copy Link for Slack — List View

**Function:** `injectPMsToolKitJira()`

Adds a **🔗** button to each ticket row in Jira's legacy list views (`tr[data-issuekey]` and `.issuerow` rows).

**Behavior:**
- Extracts the **issue key** (`data-issuekey` attribute or `.key` element) and the **summary** text from each row.
- On click, copies the ticket to the clipboard in **two formats simultaneously**:
  - `text/plain` → `"KEY-123 Summary text"`
  - `text/html` → `<a href="https://your-instance.atlassian.net/browse/KEY-123">KEY-123 Summary text</a>`
- This means pasting into Slack, Notion, or any rich-text editor produces a **clickable hyperlink**, while pasting into plain-text fields gives a readable fallback.
- Visual feedback: the button briefly changes to ✅ with a green background for 1.5 seconds.

**Selectors used:**
- Rows: `tr[data-issuekey]:not(.et-added)`, `.issuerow:not(.et-added)`
- Summary: `.summary a`, `[data-field-id="summary"] a`
- Insertion target: `.key`, `.issuetype`, or first `<td>`

---

### 🔗 Copy Link for Slack — Native Issue Table

**Function:** `injectNativeTableIcons()`

Same copy-to-Slack behavior as above but targeting Jira Cloud's **native issue table** (the newer React-based table with `data-testid` attributes).

**Selectors used:**
- Rows: `tr[data-testid="native-issue-table.ui.issue-row"]`
- Issue key: `[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]`
- Summary: `[data-testid="native-issue-table.common.ui.issue-cells.issue-summary.issue-summary-cell"]`
- Insertion target: Merged cell `[data-testid="native-issue-table.ui.row.issue-row.merged-cell"]`, placed before the issue key element.

---

### 🔗 Copy Link in Breadcrumbs — Ticket View

**Function:** `injectBreadcrumbCopyButton()`

On individual ticket pages (`/browse/XXX-NNN`), injects a **🔗** copy button directly into the breadcrumb navigation bar.

**Breadcrumb detection strategy** (multi-fallback):
1. `#jira-issue-header nav ol`
2. `[data-testid="issue.views.issue-base.foundation.breadcrumbs.item"]` → traverses up to closest `<ol>`
3. Any `nav ol` element whose text content contains the issue key

**Summary detection** for clipboard content:
- `[data-testid="issue.views.issue-base.foundation.summary.heading"] h1`
- `#summary-val`
- `#jira-issue-header + * h1`

The button is wrapped in a `div[role="listitem"]` with `display: flex` to match Jira's breadcrumb structure.

---

### 📝 Note Drawer & Reminders (Global)

**Singleton:** `NoteDrawer`

Replaces the legacy localized popups with a modern, **right-side Drawer UI** (similar to Notion's database item view). This centralized component handles all personal notes and follow-up reminders across Jira.

**Key Features:**
- **Spacious Environment:** A large side drawer provides ample space for long-form notes and complex reminder scheduling.
- **Quick Reminder Shortcuts:** Fast-action buttons to schedule follow-ups:
  - **1 Hr / 2 Hrs:** For same-day follow-ups.
  - **Tomorrow 9am / 2 Days 9am:** For standard morning reminders.
- **Global Synchronization:** Saving a note in the drawer for a specific ticket immediately updates the **blue dot indicator** (the "has-note" status) on every instance of that ticket across the current page (e.g., if you have the same ticket visible in a list and a sidebar).
- **Auto-save:** Triggers 500ms after the last keystroke or immediately upon clicking a shortcut.
- **Clean Layout:** Features a glassmorphism backdrop, smooth slide-in animations, and a responsive design that stays out of the way of Jira's main content.
- **Keyboard Shortcuts:** Press `Escape` to close the drawer instantly.

**Entry Points:**
1. **List View:** 📝 button next to the ticket key.
2. **Native Issue Table:** 📝 button in the merged icon group.
3. **Ticket Detail Page:** "Personal notes" panel in the sidebar/detail area.
4. **Breadcrumbs:** 📝 button in the ticket header navigation.
5. **Scrum Board:** 📝 button on board cards.

**Storage Keys:**
```
Notes:    "notes_KEY-123"
Reminder: "reminder_KEY-123" (Unix timestamp)
```

---

### 🔔 Persistent & Missed Alerts

**Files:** `background.js`, `jira-tools.js`

Ensures you never miss a follow-up reminder, even if Chrome or your Jira tabs were closed when the alarm fired.

**Key Features:**
- **Pending Alerts Queue:** When an alarm triggers, it's added to a `pending_alerts` list in `chrome.storage.local`.
- **Automatic Retrieval:** Upon opening any Jira page, the extension checks for pending alerts and displays them using the `ReminderModal`.
- **Queue Indicator:** If multiple alerts are waiting, the modal shows a **"+ N more"** counter. Dismissing or snoozing an alert automatically pulls the next one from the queue.
- **System Notifications:** Reminders still fire native macOS/Windows notifications via the background script.
- **Diagnostics Tool:** Includes a **"Test System Notification"** button in the popup settings to verify that OS-level notification permissions are correctly configured.

---

### 🌐 Multi-Source Logic (Prefixing)

**Infrastructure Change**

To prepare for future integrations (GitHub, Slack, generic URLs), the storage schema now uses **source prefixes**.

**Schema:**
- **Legacy:** `notes_PROJ-123`
- **Modern:** `notes_jira:PROJ-123`

**Migration:**
The extension automatically migrates all legacy `notes_` and `reminder_` keys to the `jira:` prefix on startup. The UI gracefully handles both reading and writing with these prefixes.

---

### 📋 View, Edit & Sync Notes — Extension Popup

**Files:** `popup.html`, `popup.js`

Clicking the extension icon opens a popup that lists **all saved notes** across all tickets.

**Features:**
- **Notes list:** Shows every `notes_*` entry from `chrome.storage.local`, sorted alphabetically by ticket key.
- **Inline Editing:** Directly edit note text and adjust reminder dates/times from within the popup, without having to navigate to Jira.
- **Sync Statuses:** A dedicated "Sync notes" button manually fetches the latest system data (summary, status, assignee) for all your saved tickets using the Jira REST API, refreshing the list immediately.
- **Summary, Assignee & Status enrichment:** The popup displays rich metadata for each ticket, showing the summary (truncated with ellipsis), the assignee, and a color-coded status badge.
- **Search:** Real-time filtering by ticket key or note content (case-insensitive `input` listener).
- **Clickable links:** Each ticket key is a hyperlink that opens the ticket in a new tab. The Jira hostname is auto-detected from the active tab and cached in `localStorage`.
- **Copy button:** Copies `"KEY-123: note text"` to clipboard per note.
- **Delete button:** Removes the note from storage after a `confirm()` dialog.
- **Empty state:** Shows a 📋 emoji with "You have no saved notes" or "No results" when searching.
- **Count badge:** Header shows total note count (e.g., "3 notes").
- **About footer:** "PMsToolKit — Created by EricConcha".
- **UI:** 380px wide, max 500px tall, with Jira-inspired styling (blue header gradient, Atlassian font stack, hover states).
- **Diagnostics:** Integrated troubleshooting for system notifications and permission level checks.
- **XSS protection:** Notes are HTML-escaped via `escapeHtml()` before rendering.

---

### ⏱️ Time in State — List View

**Function:** `injectAgeIndicators()`

Injects a **color-coded badge** next to each ticket's key in legacy list views, showing how long the ticket has been in its current status.

**Color coding:**
| Badge | Duration | CSS Class |
|-------|----------|-----------|
| 🟢 Green | 0–2 days | `et-age-green` |
| 🟡 Yellow | 3–4 days | `et-age-yellow` |
| 🔴 Red | 5+ days | `et-age-red` |
| ⏳ Loading | Fetching… | `et-age-loading` (pulse animation) |
| ⚠️ Error | Failed | No color class |

**Age format:**
| Duration | Label |
|----------|-------|
| Less than 1 day | `<1d` |
| 1 day | `1d` |
| 2–6 days | `Xd` |
| 1–3 weeks | `Xw` |
| 4+ weeks | `Xm` (months) |

**Tooltip (on hover):** Shows detailed information including:
- Current status name (e.g., `In "In Progress" since 02/25/2026 10:30 AM`)
- Who moved it (e.g., `Moved by: John Doe`)

**API calls:** Uses the concurrency queue and in-memory cache (see [Architecture](#concurrency-queue)).

---

### ⏱️ Time in State — Native Issue Table

**Function:** `injectNativeTableIcons()`

Same time-in-state badge behavior, injected into the native issue table rows inside the `.et-native-icons` wrapper. The badge, tooltip, color coding, and age format are identical to the list view.

---

### ⏱️ Time in State — Board Cards

**Function:** `injectBoardCardAgeIndicators()`

Adds a time-in-state badge to each card on **Kanban and Scrum board views**.

**Card detection:**
- Key container: `[data-testid="platform-card.common.ui.key.key"]`
- Card root: Closest `[draggable="true"]` ancestor
- Content target: `[class*="content"]` or `[data-component-selector="platform-card.ui.card.card-content.content-section"]` parent

**Placement:** Creates a new row (`div.et-board-age-row`) at the bottom of the card with `justify-content: flex-end` to right-align the badge.

**Styling:** Uses the `.et-board-age` class with slightly larger font (`10px`) and `border-radius: 3px` for a card-appropriate appearance.

---

### ⏱️ Time in State — Breadcrumb Navigation

**Function:** `injectBreadcrumbCopyButton()` (combined with copy and notes)

A time-in-state badge is also injected into the breadcrumb navigation alongside the copy and notes buttons, using the `.et-breadcrumb-age` class.

---

### 📊 Story Points in Dashboard Gadgets

**Functions:** `injectStoryPointsSummary()`, `_etEnsureStoryPointsField()`

Enhances **stats gadgets** on Jira dashboards by adding a **Story Points (SP) column**.

**Workflow:**

1. **Auto-detect the Story Points field ID:**
   - Makes a single `GET /rest/api/2/field` call.
   - Searches for a field named `"Story Points"` or `"Story points"` (case-sensitive match).
   - Caches the result for the page session (`_etStoryPointsFieldId`).

2. **Extract JQL from each gadget:**
   - Finds `table.stats-gadget-table` elements.
   - Locates the "Total" row (`tr.stats-gadget-final-row`).
   - Extracts the `jql=` parameter from the total link's `href`.
   - Strips any `ORDER BY` clause before sending to the API.

3. **Fetch all issues via a single API call:**
   - `POST /rest/api/3/search/jql` with:
     ```json
     {
       "jql": "<extracted JQL>",
       "fields": ["<storyPointsFieldId>", "assignee"],
       "maxResults": 200
     }
     ```
   - Includes `X-Atlassian-Token: no-check` header for CSRF bypass.

4. **Aggregate story points dynamically:**
   - Detects the gadget's grouping category (e.g., automatically handles "Assignee" or "Status").
   - Groups issues according to the gadget's configuration and aggregates Story Points per group.
   - Calculates per-group and grand totals.

5. **Modify the gadget table:**
   - **Hides** the percentage/progress bar column (`.stats-gadget-progress-indicator`).
   - **Adds** an "SP" header column after "Count".
   - **Inserts** an SP value cell per data row, matching assignees by name.
   - **Adds** the grand total SP in the footer row.

**Guard:** Each gadget is tracked by its DOM ID (`gadget-content-*` or `gadget-*`) in a `Set` to prevent reprocessing.

**Styling:** SP values use Atlassian blue (`#0052cc`) with bold weight for visual distinction.

---


### 📊 Jira History Exporter (CSV)

**Entry Point:** Extension Popup → "Export History to CSV" button.

A specialized audit tool that allows Project Managers to reconstruct the "life" of Jira tasks by exporting their change history into a clean, queryable CSV format.

**Key Features:**
- **Two-Phase Extraction:**
  1. **Phase 1 (Search):** Uses JQL to identify issues and fetch metadata including Epic Links and Epic Names.
  2. **Phase 2 (History Audit):** Performs a deep dive into each issue's changelog to extract specific modifications.
- **Smart Epic Resolution:** Automatically supports both **Classic** (custom fields) and **Next-Gen** (parent hierarchy) Jira projects to resolve Epic names and links.
- **Tracked Fields:** Specifically audits changes in:
    - Story Points
    - Description
    - Acceptance Criteria
    - Epic Link
    - Sprint (History of move events)
- **Flattened Data Format:** Converts complex Jira history objects into a readable 10-column CSV:
    - `Issue Key`, `Issue Summary`, `Issue Link` (Direct URL)
    - `Epic Name`, `Epic Link` (Link to Epic)
    - `Timestamp`, `Changed By`
    - `Field`, `From Value`, `To Value`

**Technical Logic:**
- **Endpoints:** Uses `POST /rest/api/3/search/jql` for discovery and `GET /rest/api/3/issue/{key}/changelog` for auditing.
- **Concurrency:** Processes changelogs in parallel batches (concurrency of 5) to optimize performance while respecting Jira API limits.
- **Case-Insensitive Tracking:** Field matching is case-insensitive to handle various Jira configurations.

---

### 🚀 Analytics Hub — Sprint Dashboard

**Entry Point:** Extension Popup → 📊 Button (opens Analytics Hub in a new tab).

A dedicated, real-time control center for Project Managers to monitor active sprints, analyze developer workload, and predict ETAs based on remaining Story Points.

**Key Features:**
- **Per-Project Configuration:**
  - Settings are saved per Jira project (`sdk_settings_<projectKey>`).
  - **Dynamic Status Mapping:** Automatically fetches all project-specific workflow statuses. Allows you to map any custom Jira status to one of four analytical buckets: `To Do`, `In Progress`, `QA`, and `Done`.
  - **Custom Working Hours:** Configure the standard working hours per day (default 9h) to calibrate the ETA engine.
  - **SP to Hours Scale:** Fully customizable conversion scale (e.g., 1 SP = 2.25h, 13 SP = 45h).
- **Auto-Restore Memory:** The dashboard automatically remembers and loads the last selected project to save time on startup.
- **Developer Cards:**
  - Visually distinct cards per developer summarizing their workload in the active sprint.
  - **Remaining Work:** Shows remaining SP (only counting `In Progress` statuses), estimated hours remaining, and a color-coded capacity bar.
  - **Smart ETA:** Predicts the completion date by dividing remaining work hours by the daily working hours (ignoring weekends).
  - **Overload Warning:** Highlights the developer card in red if their remaining work hours exceed the time left in the sprint.
- **Issue Tracking by Stage:**
  - Categorizes and displays issues into collapsible chips for `In Progress`, `QA`, and `Done`.
  - **Overdue Detection:** Flags `In Progress` issues that have exceeded their designated SP time allowance.
  - **1-Click Slack Share:** Each issue has a 🔗 button that copies the `Issue Key + Summary` and `URL` in both plain and rich text for immediate sharing.
- **Velocity Tracking:**
  - Automatically fetches the last 3 closed sprints.
  - Calculates and displays the historical average velocity (Story Points per sprint) per developer.

**Technical Logic:**
- Uses the `fetchProjects`, `fetchBoardId`, and `fetchActiveSprint` Jira APIs to automatically discover the current active sprint for the selected project.
- Relies on caching and decoupled fetching to ensure the UI remains responsive while pulling down full issue details and changelogs.
- Uses the Chrome Extension Storage API to persist status mappings and working hour configurations securely within the browser.

---

### 🐙 GitHub PR Link

**Feature:** Integration with GitHub API.

When enabled in **Settings**, the toolkit automatically identifies Jira tickets in the **In Progress** or **In Review** stages on the **Sprint Dashboard** and searches for matching Pull Requests in GitHub.

**Key Features:**
- **Automated Search:** Scans GitHub PR titles and branch names for the Jira issue key (e.g., `MMZ-423`).
- **Classic PAT Support:** Securely uses your GitHub **Personal Access Token (Classic)** with `repo` permissions to access private repositories.
- **Smart Staggering:** Requests are staggered (500ms delay) to stay within GitHub API search rate limits.
- **Loading Indicators:** Displays a subtle, pulsing GitHub logo icon while searching, transforming into a clickable link once a PR is found.
- **Developer Workflow:** Streamlines the Tech Lead's review process by providing direct links from the planning hub to the code.

**Technical Logic:**
- Uses `GET https://api.github.com/search/issues?q={ticketId}+type:pr`.
- Filters results based on ticket key matching in title, branch name, or body.
- Stores the PAT locally in `chrome.storage.sync` for cross-device availability (if enabled).

---

### 🔔 Follow-up Work Dashboard

**Entry Point:** Extension Popup → 🔔 Button (opens Analytics Hub in a new tab).

A consolidated view of all actionable items and potential bottlenecks across a selected project. It helps PMs stay on top of miscellaneous tasks that don't always fit into a standard board view.

**Key Sections:**
- **🗒️ Notes & Reminders:** Surfaces every ticket where you've left a personal note (📝) or scheduled a future reminder (🔔). Displays a subtle yellow note preview inline so you don't even have to open the drawer.
- **🔎 In Review:** A dedicated list of all tickets currently in the "In Review" status (mapped via your project settings). Ensures no PR or code review gets ghosted.
- **⏰ Overdue Tickets:** Highlights tasks that have been "In Progress" for longer than their assigned Story Points allow (using the SP-to-Hours scale).
- **🔴 High Capacity Engineers:** A sorted list of team members who are at 75% or more of their total sprint capacity. Shows the "busiest" engineers first with color-coded progress bars.

**Common Features:**
- Every ticket chip includes the **📝 Notes**, **🔗 Link**, and **GitHub** action buttons for immediate follow-up.

---

### 📹 Zoom Copy Transcript

**Function:** `zoom/main.js`

Injects a **Copy Transcript** button into Zoom cloud recording pages to easily extract the entire meeting transcript.

**Features:**
- **Automatic Injection:** Automatically detects the transcript container on any Zoom recording share page.
- **Clean Formatting:** Parses the DOM to copy the transcript in a highly readable format: `[Timestamp] Speaker: Text`.
- **One-Click Copy:** Copies the fully formatted text directly to the clipboard, perfect for pasting into Jira tickets, Slack, or Notion.

---

## Architecture & Technical Details

### Build System (Vite)
The extension now uses **Vite** as its build engine. This allows for:
- **ES Modules**: Native `import/export` support.
- **Optimized Bundling**: Faster load times and smaller footprint.
- **Production Build**: Run `npm run build` to generate the `dist/` folder for distribution.

### Modular File Structure
The project has been refactored from a monolithic `jira-tools.js` into a modularized structure:

```text
src/
  ├── common/          # Shared utilities
  │   ├── storage.js   # Robust chrome.storage wrapper
  │   └── jira-api.js  # Jira REST API interaction layer
  ├── content/         # Site-specific logic
  │   └── jira/
  │       ├── ui/      # UI Components (NoteDrawer, ReminderModal)
  │       ├── features/# Modular features (metrics, injections, customization)
  │       ├── main.js  # Entry point
  │       └── utils.js # Jira-specific utilities
  ├── background/      # Service worker core logic
  ├── popup/           # Popup UI and logic
  └── assets/          # Icons and global styles
public/                # Static assets and manifest.json
dist/                  # Final production build (Load this in Chrome)
```

### Content Script Lifecycle

The content script uses a **`MutationObserver`** on `document.body` to detect when Jira dynamically loads or re-renders content (Jira Cloud is a SPA):

```javascript
const observer = new MutationObserver(() => etRunAll());
observer.observe(document.body, { childList: true, subtree: true });
etRunAll(); // Initial run
```

**`etRunAll()`** calls all feature injection functions on every DOM mutation. Each function uses **"already processed" guard classes** (e.g., `.et-added`, `.et-notes-added`, `.et-age-added`, `.et-native-added`, `.et-board-age-added`) to avoid re-injecting into the same elements.

### safeStorage Wrapper

A wrapper around `chrome.storage.local` that catches `"Extension context invalidated"` errors:

```javascript
const safeStorage = {
    get(key, cb) {
        try { chrome.storage.local.get(key, cb); }
        catch (e) { console.warn('PMsToolKit: context invalidated, please refresh.'); }
    },
    set(data) { /* same pattern */ },
    remove(key) { /* same pattern */ }
};
```

This prevents errors when the extension is updated/reloaded while a Jira tab is still open. Instead of crashing, it logs a warning.

### Jira REST API Usage

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/api/2/issue/{key}?fields=status,created` | GET | Get current status and creation date |
| `/rest/api/2/issue/{key}?fields=summary,assignee,status` | GET | Enrichment for popup and background notifications |
| `/rest/api/2/issue/{key}/changelog` | GET | Detailed status transition history |
| `/rest/api/2/field` | GET | Resolve custom field IDs (Story Points) |
| `/rest/api/3/search/jql` | POST | Bulk issue fetching for dashboards |
| `/rest/agile/1.0/board` | GET | Resolve Scrum boards for Velocity mapping |

All requests use `credentials: 'include'` to leverage the user's existing Jira session — **no API tokens or authentication setup required**.

### Concurrency Queue

To avoid overwhelming the Jira API (which can throttle or 429), API requests are managed by a concurrency-limited queue:

```
Max concurrent requests: 3 (ET_MAX_CONCURRENT)
Queue type: FIFO
Implementation: Promise-based processor
```

### In-Memory Cache

Status data is cached in a plain object (`_etStatusCache`) to avoid redundant API calls:

```
TTL: 5 minutes (ET_CACHE_TTL = 300,000ms)
Key: issueKey (e.g., "PROJ-123")
Value: { statusName, changedDate, changedBy, fetchedAt }
```

### Global Tooltip System

Instead of using native `title` attributes (which conflict with Jira's own tooltip system), the extension uses a **custom tooltip** appended to `document.body`:

- A single `div.et-tooltip` element is created once and reused.
- `mouseover` reads the `data-tooltip` attribute.
- Supports multi-line content via `\n` → `<br>` splitting.
- Uses `z-index: 2147483647` to ensure it's always on top.

### Clipboard API (Rich Text)

The copy feature uses the modern **Clipboard API** (`navigator.clipboard.write()`) with `ClipboardItem` to write both `text/plain` and `text/html` MIME types simultaneously. This ensures that pasting into rich-text editors (Slack, Confluence, etc.) creates a hyperlink, while pasting into plain-text editors preserves the key and summary.

---

## Installation (Beta v0.8.0)

1. Clone or download this repository.
2. Run `npm install` followed by `npm run build`.
3. Open `chrome://extensions/` in Chrome.
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the `dist/` directory.
6. Navigate to Jira — the extension activates automatically.

---

*PMsToolKit v0.8.0 (Beta) — Created by EricConcha*

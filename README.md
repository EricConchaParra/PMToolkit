# PMsToolKit — Chrome Extension for Jira

> **Custom toolkit to enhance project management workflows on Jira Cloud.**
> Created by **EricConcha**.

A Manifest V3 Chrome extension that injects productivity tools directly into the Jira Cloud UI. It enhances list views, ticket detail pages, board views, and dashboard gadgets with copy-to-Slack links, personal notes (via a Notion-like drawer), reminder notifications, time-in-state indicators, and story point summaries — all without requiring any Jira admin configuration.

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
  - [📋 View All Notes — Extension Popup](#-view-all-notes--extension-popup)
  - [⏱️ Time in State — List View](#%EF%B8%8F-time-in-state--list-view)
  - [⏱️ Time in State — Native Issue Table](#%EF%B8%8F-time-in-state--native-issue-table)
  - [⏱️ Time in State — Board Cards](#%EF%B8%8F-time-in-state--board-cards)
  - [⏱️ Time in State — Breadcrumb Navigation](#%EF%B8%8F-time-in-state--breadcrumb-navigation)
  - [📊 Story Points in Dashboard Gadgets](#-story-points-in-dashboard-gadgets)
  - [🚀 Velocity per Developer in Dashboard Gadgets](#-velocity-per-developer-in-dashboard-gadgets)
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
| 8 | View All Notes | Extension Popup | Click extension icon |
| 9 | Time in State | Legacy list views | Auto-injected badge per row |
| 10 | Time in State | Native issue table | Auto-injected badge per row |
| 11 | Time in State | Board cards (Kanban/Scrum) | Auto-injected badge per card |
| 12 | Time in State | Breadcrumb navigation | Auto-injected badge |
| 13 | Story Points Summary | Dashboard gadgets | Auto-injected SP column |
| 14 | Velocity per Developer | Dashboard gadgets ("Velocity" title) | Auto-injected V-Avg column |

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

### 📋 View All Notes — Extension Popup

**Files:** `popup.html`, `popup.js`

Clicking the extension icon opens a popup that lists **all saved notes** across all tickets.

**Features:**
- **Notes list:** Shows every `notes_*` entry from `chrome.storage.local`, sorted alphabetically by ticket key.
- **Summary & Assignee enrichment:** After the initial render, the popup fetches each ticket's **summary** and **assignee** from the Jira REST API (`/rest/api/2/issue/{key}?fields=summary,assignee`) in parallel. A metadata line is displayed below the ticket key showing the summary (truncated with ellipsis) and assignee separated by a `·` dot. If the API call fails, the card gracefully falls back to showing just the key.
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

4. **Aggregate story points by assignee:**
   - Groups issues by `assignee.displayName` (or `"Unassigned"`).
   - Calculates per-assignee and grand totals.

5. **Modify the gadget table:**
   - **Hides** the percentage/progress bar column (`.stats-gadget-progress-indicator`).
   - **Adds** an "SP" header column after "Count".
   - **Inserts** an SP value cell per data row, matching assignees by name.
   - **Adds** the grand total SP in the footer row.

**Guard:** Each gadget is tracked by its DOM ID (`gadget-content-*` or `gadget-*`) in a `Set` to prevent reprocessing.

**Styling:** SP values use Atlassian blue (`#0052cc`) with bold weight for visual distinction.

---

### 🚀 Velocity per Developer in Dashboard Gadgets

**Functions:** `injectVelocityPerDeveloper()`, `_etGetBoardIdForProject()`, `_etGetLastClosedSprints()`, `_etFetchCompletedIssuesForSprint()`

Automatically detects dashboard gadgets whose title contains **"Velocity"** (case-insensitive) and adds a **V-Avg column** showing each developer's average velocity across the last N closed sprints.

**Workflow:**

1. **Detect Velocity gadgets:**
   - Scans all `table.stats-gadget-table` elements on the dashboard.
   - Uses `_etGetGadgetTitle()` to read the gadget's header title.
   - Only processes gadgets whose title includes "Velocity" — all other gadgets are left for the Story Points feature.

2. **Extract project key from JQL:**
   - Parses the `jql=` parameter from the gadget's "Total" row link.
   - Extracts the project key via regex (`project = XYZ`).

3. **Resolve the Scrum board:**
   - Calls `GET /rest/agile/1.0/board?projectKeyOrId={key}&type=scrum&maxResults=1`.
   - Caches the board ID per project key in-memory (`_etBoardIdCache`).

4. **Fetch the last closed sprints:**
   - Calls `GET /rest/agile/1.0/board/{boardId}/sprint?state=closed&maxResults=50`.
   - Takes the last `ET_VELOCITY_SPRINT_COUNT` sprints (default: **2**).

5. **Fetch completed issues per sprint (in parallel):**
   - For each sprint: `POST /rest/api/3/search/jql` with `sprint = {id} AND statusCategory = Done`.
   - Returns `[{ assigneeName, sp }]` per sprint.

6. **Aggregate and calculate averages:**
   - Groups story points by `assignee.displayName` across all sprints.
   - Computes per-developer average: `totalSP / sprintCount`.
   - Builds per-developer tooltip showing the breakdown (e.g., `Sprint 12 (14 SP) + Sprint 13 (16 SP)`).

7. **Modify the gadget table:**
   - **Hides** the percentage/progress bar column and the Count column.
   - **Adds** a "V-Avg" header column.
   - **Inserts** a velocity badge (`et-velocity-badge`) per data row, matching assignees by name.
   - **Adds** the grand average in the footer row.
   - Each badge uses the **global tooltip system** to show the sprint-by-sprint breakdown on hover.

**Configuration:**
| Constant | Default | Description |
|----------|---------|-------------|
| `ET_VELOCITY_SPRINT_COUNT` | `2` | Number of closed sprints to average |

**Guard:** Each gadget is tracked by a `vel-{gadgetId}` key in `_etProcessedVelocityGadgets` (separate from the Story Points set) to prevent reprocessing.

**Error handling:** On failure, an error indicator with a **↻ Retry** button is shown in the header row. The gadget is not marked as processed, allowing auto-retry on the next DOM mutation.

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

## Installation

1. Clone or download this repository.
2. Run `npm install` followed by `npm run build`.
3. Open `chrome://extensions/` in Chrome.
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the `dist/` directory.
6. Navigate to Jira — the extension activates automatically.

---

*PMsToolKit v3.0 — Created by EricConcha*

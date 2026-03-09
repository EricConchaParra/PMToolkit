/**
 * PMsToolKit — Jira History Exporter
 *
 * Fetches issues via JQL (with pagination) and exports changelog entries
 * for the following fields to a downloadable CSV:
 *   - Story Points
 *   - Description
 *   - Acceptance Criteria
 *   - Epic Link
 *   - Sprint
 */

// Fields we care about (Jira internal field names can vary — we match case-insensitively)
const TRACKED_FIELDS = [
    'story points',
    'story point estimate',
    'description',
    'acceptance criteria',
    'epic link',
    'epic name',
    'sprint',
];

function isTrackedField(fieldName) {
    const lower = (fieldName || '').toLowerCase();
    return TRACKED_FIELDS.some(f => lower.includes(f));
}

// ---- UI Helpers ----
const progressSection = document.getElementById('progress-section');
const progressText = document.getElementById('progress-text');
const progressPct = document.getElementById('progress-pct');
const progressBar = document.getElementById('progress-bar');
const successMsg = document.getElementById('success-msg');
const successText = document.getElementById('success-text');
const errorMsg = document.getElementById('error-msg');
const errorText = document.getElementById('error-text');
const exportBtn = document.getElementById('export-btn');

function showProgress(text, pct) {
    progressSection.classList.add('visible');
    progressText.textContent = text;
    progressPct.textContent = `${Math.round(pct)}%`;
    progressBar.style.width = `${pct}%`;
    successMsg.classList.remove('visible');
    errorMsg.classList.remove('visible');
}

function showSuccess(msg) {
    progressSection.classList.remove('visible');
    successText.textContent = msg;
    successMsg.classList.add('visible');
    errorMsg.classList.remove('visible');
}

function showError(msg) {
    progressSection.classList.remove('visible');
    errorText.textContent = msg;
    errorMsg.classList.add('visible');
    successMsg.classList.remove('visible');
}

// ---- Jira API ----
function getJiraHost() {
    // In a new tab the hostname won't be Jira, so we need another way.
    // Try to read from chrome.storage (set by content script on Jira pages).
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get(['et_jira_host'], result => {
                resolve(result.et_jira_host || null);
            });
        } else {
            resolve(null);
        }
    });
}

// ---- Phase 1: Search for issue keys using new /search/jql endpoint ----
// We request epic fields: customfield_10014 (Epic Link - classic), customfield_10011 (Epic Name),
// and parent (next-gen epic). Jira ignores unknown custom fields safely.
async function searchIssueKeys(host, jql, onProgress) {
    const url = `https://${host}/rest/api/3/search/jql`;
    let nextPageToken = undefined;
    const allKeys = [];

    while (true) {
        const body = {
            jql,
            maxResults: 100,
            fields: ['summary', 'parent', 'customfield_10014', 'customfield_10011'],
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;

        const resp = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.error('PMsToolKit Exporter: searchIssueKeys failed', text);
            throw new Error(`Jira API error ${resp.status}: ${text}`);
        }

        const data = await resp.json();
        const issues = data.issues || [];
        for (const issue of issues) {
            const f = issue.fields || {};
            // Epic Link: classic projects use customfield_10014 (key string)
            // Next-gen projects store epic as parent issue
            const epicKey = f.customfield_10014 || f.parent?.key || '';
            const epicName = f.customfield_10011 || f.parent?.fields?.summary || '';
            allKeys.push({
                key: issue.key,
                summary: f.summary || '',
                issueUrl: `https://${host}/browse/${issue.key}`,
                epicKey,
                epicUrl: epicKey ? `https://${host}/browse/${epicKey}` : '',
                epicName,
            });
        }

        onProgress(`Found ${allKeys.length} issues so far...`, 10);

        // The new API uses nextPageToken — if absent, we're done
        if (!data.nextPageToken || issues.length === 0) break;
        nextPageToken = data.nextPageToken;

        await new Promise(r => setTimeout(r, 100));
    }

    return allKeys;
}

// ---- Phase 2: Fetch changelog per issue ----
async function fetchIssueChangelog(host, issueKey) {
    const allHistories = [];
    let startAt = 0;
    const maxResults = 100;

    while (true) {
        const url = `https://${host}/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=${maxResults}`;
        const resp = await fetch(url, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
        });

        if (!resp.ok) {
            console.warn(`PMsToolKit: Failed to fetch changelog for ${issueKey}:`, resp.status);
            break;
        }

        const data = await resp.json();
        const values = data.values || [];
        allHistories.push(...values);

        if (allHistories.length >= data.total || values.length === 0) break;
        startAt += values.length;
    }

    return allHistories;
}

async function fetchAllIssues(host, jql, onProgress) {
    // Phase 1: get all issue keys + epic metadata
    const issueList = await searchIssueKeys(host, jql, onProgress);
    const total = issueList.length;

    if (total === 0) return [];

    // Phase 2: fetch changelogs in parallel (with concurrency limit)
    const CONCURRENCY = 5;
    const results = [];

    for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = issueList.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map(async ({ key, summary, issueUrl, epicKey, epicUrl, epicName }) => {
                const histories = await fetchIssueChangelog(host, key);
                return { key, fields: { summary }, issueUrl, epicKey, epicUrl, epicName, changelog: { histories } };
            })
        );
        results.push(...batchResults);

        const done = Math.min(i + CONCURRENCY, total);
        const pct = 10 + ((done / total) * 85);
        onProgress(`Fetching changelogs: ${done} / ${total} issues...`, pct);
    }

    return results;
}


// ---- CSV Processing ----
function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/"/g, '""');
    // Wrap in quotes if it contains commas, quotes, or newlines
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str}"`;
    }
    return str;
}

function processIssuesToCSV(issues) {
    const headers = [
        'Issue Key', 'Issue Summary', 'Issue Link',
        'Epic Name', 'Epic Link',
        'Timestamp', 'Changed By', 'Field', 'From Value', 'To Value',
    ];
    const rows = [headers.map(escapeCSV).join(',')];

    for (const issue of issues) {
        const issueKey = issue.key;
        const summary = issue.fields?.summary || '';
        const issueUrl = issue.issueUrl || '';
        const epicName = issue.epicName || '';
        const epicUrl = issue.epicUrl || '';
        const histories = issue.changelog?.histories || [];

        for (const history of histories) {
            const timestamp = history.created || '';
            const changedBy = history.author?.displayName || history.author?.name || 'Unknown';

            for (const item of (history.items || [])) {
                if (!isTrackedField(item.field)) continue;

                rows.push([
                    issueKey,
                    summary,
                    issueUrl,
                    epicName,
                    epicUrl,
                    timestamp,
                    changedBy,
                    item.field,
                    item.fromString ?? item.from ?? '',
                    item.toString ?? item.to ?? '',
                ].map(escapeCSV).join(','));
            }
        }
    }

    return rows.join('\n');
}

// ---- Download ----
function downloadCSV(csvString, filename) {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ---- Main Export Logic ----
async function runExport() {
    const jql = document.getElementById('jql-input').value.trim();

    if (!jql) {
        showError('Please enter a JQL query before exporting.');
        return;
    }

    exportBtn.disabled = true;
    showProgress('Connecting to Jira...', 2);

    try {
        const host = await getJiraHost();
        if (!host) {
            throw new Error('Could not detect your Jira host. Please open a Jira page in another tab first so the extension can detect it, then try again.');
        }

        const issues = await fetchAllIssues(host, jql, (text, pct) => {
            showProgress(text, pct);
        });

        if (issues.length === 0) {
            showError('No issues found for the given JQL. Check the query and try again.');
            exportBtn.disabled = false;
            return;
        }

        showProgress('Building CSV...', 95);
        await new Promise(r => setTimeout(r, 100)); // let UI update

        const csv = processIssuesToCSV(issues);

        if (csv.split('\n').length <= 1) {
            showSuccess(`✅ Fetched ${issues.length} issues but found 0 changes for the tracked fields. No CSV downloaded.`);
            exportBtn.disabled = false;
            return;
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        downloadCSV(csv, `jira_history_export_${dateStr}.csv`);

        const rowCount = csv.split('\n').length - 1;
        showSuccess(`✅ Done! Exported ${rowCount} change entries from ${issues.length} issues. Check your Downloads folder.`);
    } catch (err) {
        console.error('PMsToolKit Exporter:', err);
        showError(err.message || 'An unexpected error occurred.');
    } finally {
        exportBtn.disabled = false;
        progressSection.classList.remove('visible');
    }
}

// ---- Event Listeners ----
exportBtn.addEventListener('click', runExport);

// Click example chips to prefill textarea
document.querySelectorAll('.jql-example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.getElementById('jql-input').value = chip.dataset.jql;
        document.getElementById('jql-input').focus();
    });
});

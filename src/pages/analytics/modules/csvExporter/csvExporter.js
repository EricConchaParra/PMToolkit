/**
 * PMsToolKit — Analytics Hub
 * CSV Exporter — fetch issue changelogs and export to CSV
 */

import { getJiraHost } from '../jiraApi.js';

// ============================================================
// TRACKED FIELDS
// ============================================================

const TRACKED_FIELDS = ['story points', 'story point estimate', 'description', 'acceptance criteria', 'epic link', 'epic name', 'sprint'];

export function isTrackedField(fieldName) {
    const lower = (fieldName || '').toLowerCase();
    return TRACKED_FIELDS.some(f => lower.includes(f));
}

// ============================================================
// DATA FETCH
// ============================================================

export async function csvSearchIssues(host, jql, onProgress) {
    const url = `https://${host}/rest/api/3/search/jql`;
    let nextPageToken;
    const all = [];
    while (true) {
        const body = { jql, maxResults: 100, fields: ['summary', 'parent', 'customfield_10014', 'customfield_10011'] };
        if (nextPageToken) body.nextPageToken = nextPageToken;
        const resp = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Jira API ${resp.status}`);
        const data = await resp.json();
        for (const issue of (data.issues || [])) {
            const f = issue.fields || {};
            const epicKey = f.customfield_10014 || f.parent?.key || '';
            all.push({
                key: issue.key, summary: f.summary || '',
                issueUrl: `https://${host}/browse/${issue.key}`,
                epicKey, epicUrl: epicKey ? `https://${host}/browse/${epicKey}` : '',
                epicName: f.customfield_10011 || f.parent?.fields?.summary || '',
            });
        }
        onProgress(`Found ${all.length} issues...`, 10);
        if (!data.nextPageToken || (data.issues || []).length === 0) break;
        nextPageToken = data.nextPageToken;
        await new Promise(r => setTimeout(r, 80));
    }
    return all;
}

export async function csvFetchChangelog(host, issueKey) {
    const all = [];
    let startAt = 0;
    while (true) {
        const resp = await fetch(`https://${host}/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=100`, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
        });
        if (!resp.ok) break;
        const data = await resp.json();
        all.push(...(data.values || []));
        if (all.length >= data.total || (data.values || []).length === 0) break;
        startAt += data.values.length;
    }
    return all;
}

// ============================================================
// CSV BUILD & DOWNLOAD
// ============================================================

export function escapeCSV(v) {
    const str = String(v ?? '').replace(/"/g, '""');
    return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str}"` : str;
}

export function buildCSV(issues) {
    const headers = ['Issue Key', 'Issue Summary', 'Issue Link', 'Epic Name', 'Epic Link', 'Timestamp', 'Changed By', 'Field', 'From Value', 'To Value'];
    const rows = [headers.map(escapeCSV).join(',')];
    for (const issue of issues) {
        for (const h of (issue.changelog?.histories || [])) {
            const by = h.author?.displayName || h.author?.name || 'Unknown';
            for (const item of (h.items || [])) {
                if (!isTrackedField(item.field)) continue;
                rows.push([issue.key, issue.fields?.summary || '', issue.issueUrl, issue.epicName, issue.epicUrl, h.created || '', by, item.field, item.fromString ?? item.from ?? '', item.toString ?? item.to ?? ''].map(escapeCSV).join(','));
            }
        }
    }
    return rows.join('\n');
}

export function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================
// INIT — wires up export button and JQL chips
// ============================================================

export function initCsvExporter() {
    const exportBtn = document.getElementById('export-btn');
    const expProgress = document.getElementById('exp-progress');
    const expProgressBar = document.getElementById('exp-progress-bar');
    const expProgressText = document.getElementById('exp-progress-text');
    const expProgressPct = document.getElementById('exp-progress-pct');
    const expSuccess = document.getElementById('exp-success');
    const expSuccessText = document.getElementById('exp-success-text');
    const expError = document.getElementById('exp-error');
    const expErrorText = document.getElementById('exp-error-text');

    function showExpProgress(text, pct) {
        expProgress.classList.remove('hidden');
        expProgressText.textContent = text;
        expProgressPct.textContent = `${Math.round(pct)}%`;
        expProgressBar.style.width = `${pct}%`;
        expSuccess.classList.add('hidden');
        expError.classList.add('hidden');
    }

    function showExpSuccess(msg) {
        expProgress.classList.add('hidden');
        expSuccessText.textContent = msg;
        expSuccess.classList.remove('hidden');
        expError.classList.add('hidden');
    }

    function showExpError(msg) {
        expProgress.classList.add('hidden');
        expErrorText.textContent = msg;
        expError.classList.remove('hidden');
        expSuccess.classList.add('hidden');
    }

    exportBtn.addEventListener('click', async () => {
        const jql = document.getElementById('jql-input').value.trim();
        if (!jql) { showExpError('Please enter a JQL query.'); return; }

        const host = await getJiraHost();
        if (!host) { showExpError('Could not detect Jira host. Open a Jira tab first.'); return; }

        exportBtn.disabled = true;
        showExpProgress('Searching issues...', 2);

        try {
            const issueList = await csvSearchIssues(host, jql, (text, pct) => showExpProgress(text, pct));
            if (issueList.length === 0) {
                showExpError('No issues found for that JQL query.');
                return;
            }

            const CONCURRENCY = 5;
            const results = [];
            for (let i = 0; i < issueList.length; i += CONCURRENCY) {
                const batch = issueList.slice(i, i + CONCURRENCY);
                const batchResults = await Promise.all(batch.map(async item => {
                    const histories = await csvFetchChangelog(host, item.key);
                    return { ...item, fields: { summary: item.summary }, changelog: { histories } };
                }));
                results.push(...batchResults);
                showExpProgress(`Fetching changelogs: ${Math.min(i + CONCURRENCY, issueList.length)} / ${issueList.length}...`, 10 + ((Math.min(i + CONCURRENCY, issueList.length) / issueList.length) * 85));
            }

            showExpProgress('Building CSV...', 97);
            await new Promise(r => setTimeout(r, 80));
            const csv = buildCSV(results);

            if (csv.split('\n').length <= 1) {
                showExpSuccess(`Fetched ${results.length} issues but found 0 tracked field changes. No file downloaded.`);
                return;
            }

            const dateStr = new Date().toISOString().slice(0, 10);
            downloadFile(csv, `jira_history_${dateStr}.csv`, 'text/csv;charset=utf-8;');
            showExpSuccess(`Done! Exported ${csv.split('\n').length - 1} changes from ${results.length} issues.`);
        } catch (err) {
            showExpError(err.message || 'Unexpected error.');
        } finally {
            exportBtn.disabled = false;
        }
    });

    // JQL chips
    document.querySelectorAll('.jql-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.getElementById('jql-input').value = chip.dataset.jql;
        });
    });
}

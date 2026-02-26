// PMsToolKit — Popup: List all notes

const notesListEl = document.getElementById('notes-list');
const notesCountEl = document.getElementById('notes-count');
const searchInput = document.getElementById('search');

let allNotes = [];

async function fetchTicketDetails(ticketKey) {
    const host = getJiraHost();
    try {
        const resp = await fetch(
            `https://${host}/rest/api/2/issue/${ticketKey}?fields=summary,assignee`,
            { credentials: 'include' }
        );
        if (!resp.ok) return { summary: '', assignee: '' };
        const data = await resp.json();
        return {
            summary: data.fields?.summary || '',
            assignee: data.fields?.assignee?.displayName || 'Unassigned'
        };
    } catch {
        return { summary: '', assignee: '' };
    }
}

function loadNotes() {
    chrome.storage.local.get(null, async (items) => {
        allNotes = [];
        for (const [key, value] of Object.entries(items)) {
            if (key.startsWith('notes_')) {
                const ticketKey = key.replace('notes_', '');
                allNotes.push({ ticketKey, text: value, summary: '', assignee: '' });
            }
        }
        // Sort alphabetically by ticket key
        allNotes.sort((a, b) => a.ticketKey.localeCompare(b.ticketKey));
        // Render immediately, then enrich with Jira details
        renderNotes(allNotes);

        // Fetch details in parallel
        const promises = allNotes.map(async (note) => {
            const details = await fetchTicketDetails(note.ticketKey);
            note.summary = details.summary;
            note.assignee = details.assignee;
        });
        await Promise.all(promises);
        renderNotes(allNotes);
    });
}

function renderNotes(notes) {
    notesCountEl.textContent = `${notes.length} note${notes.length !== 1 ? 's' : ''}`;

    if (notes.length === 0) {
        notesListEl.innerHTML = `
            <div class="empty-state">
                <div class="emoji">📋</div>
                <div>${searchInput.value ? 'No results' : 'You have no saved notes'}</div>
            </div>
        `;
        return;
    }

    notesListEl.innerHTML = notes.map(note => {
        const summaryHtml = note.summary
            ? `<span class="note-summary" title="${escapeHtml(note.summary)}">${escapeHtml(note.summary)}</span>`
            : '';
        const assigneeHtml = note.assignee
            ? `<span class="note-assignee">${escapeHtml(note.assignee)}</span>`
            : '';
        const metaLine = (summaryHtml || assigneeHtml)
            ? `<div class="note-meta">${summaryHtml}${assigneeHtml ? (summaryHtml ? ' · ' : '') + assigneeHtml : ''}</div>`
            : '';
        return `
        <div class="note-item" data-key="${note.ticketKey}">
            <a class="note-key" href="https://${getJiraHost()}/browse/${note.ticketKey}" target="_blank">
                ${note.ticketKey}
            </a>
            ${metaLine}
            <div class="note-text">${escapeHtml(note.text)}</div>
            <div class="note-actions">
                <button class="copy-btn" data-key="${note.ticketKey}" title="Copy note">📋 Copy</button>
                <button class="delete-btn" data-key="${note.ticketKey}" title="Delete note">🗑️ Delete</button>
            </div>
        </div>
    `;
    }).join('');

    // Event listeners
    notesListEl.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.key;
            const note = notes.find(n => n.ticketKey === key);
            if (note) {
                navigator.clipboard.writeText(`${key}: ${note.text}`).then(() => {
                    btn.textContent = '✅ Copied';
                    setTimeout(() => btn.textContent = '📋 Copy', 1200);
                });
            }
        });
    });

    notesListEl.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.key;
            if (confirm(`Delete note for ${key}?`)) {
                chrome.storage.local.remove(`notes_${key}`, () => loadNotes());
            }
        });
    });
}

function getJiraHost() {
    // Try to get the host from the active tab, generic fallback
    return localStorage.getItem('et_jira_host') || 'jira.atlassian.net';
}

// Get the real host from the active Jira tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) {
        try {
            const host = new URL(tabs[0].url).hostname;
            if (host.includes('atlassian.net')) {
                localStorage.setItem('et_jira_host', host);
            }
        } catch (e) { /* ignore */ }
    }
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Real-time search
searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
        renderNotes(allNotes);
        return;
    }
    const filtered = allNotes.filter(n =>
        n.ticketKey.toLowerCase().includes(query) ||
        n.text.toLowerCase().includes(query)
    );
    renderNotes(filtered);
});

// Load on open
loadNotes();

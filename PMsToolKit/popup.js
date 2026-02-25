// PMsToolKit — Popup: List all notes

const notesListEl = document.getElementById('notes-list');
const notesCountEl = document.getElementById('notes-count');
const searchInput = document.getElementById('search');

let allNotes = [];

function loadNotes() {
    chrome.storage.local.get(null, (items) => {
        allNotes = [];
        for (const [key, value] of Object.entries(items)) {
            if (key.startsWith('notes_')) {
                const ticketKey = key.replace('notes_', '');
                allNotes.push({ ticketKey, text: value });
            }
        }
        // Sort alphabetically by ticket key
        allNotes.sort((a, b) => a.ticketKey.localeCompare(b.ticketKey));
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

    notesListEl.innerHTML = notes.map(note => `
        <div class="note-item" data-key="${note.ticketKey}">
            <a class="note-key" href="https://${getJiraHost()}/browse/${note.ticketKey}" target="_blank">
                ${note.ticketKey}
            </a>
            <div class="note-text">${escapeHtml(note.text)}</div>
            <div class="note-actions">
                <button class="copy-btn" data-key="${note.ticketKey}" title="Copy note">📋 Copy</button>
                <button class="delete-btn" data-key="${note.ticketKey}" title="Delete note">🗑️ Delete</button>
            </div>
        </div>
    `).join('');

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

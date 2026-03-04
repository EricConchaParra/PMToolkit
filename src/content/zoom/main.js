import { syncStorage } from '../../common/storage';
import '../../assets/zoom-styles.css';

const DEFAULT_SETTINGS = {
    zoom_copy_transcript: true
};

async function init() {
    console.log('PMsToolKit: Zoom Transcript script initializing...');

    try {
        const settings = await syncStorage.get(DEFAULT_SETTINGS);
        console.log('PMsToolKit: settings', settings);

        // Fallback for settings if they come back empty
        const isEnabled = settings.zoom_copy_transcript !== undefined ? settings.zoom_copy_transcript : DEFAULT_SETTINGS.zoom_copy_transcript;

        if (!isEnabled) {
            console.log('PMsToolKit: Zoom Copy Transcript feature is disabled.');
            return;
        }

        const inject = () => {
            // Try different selectors just in case
            const containers = [
                document.querySelector('.search-wrapper'),
                document.querySelector('.audio-transcript .search-wrapper'),
                document.querySelector('.transcript-wrapper .search-wrapper'),
                document.querySelector('#transcript-search-container'),
                document.querySelector('.transcript-search-box'),
                document.querySelector('.audio-transcript-header')
            ];

            const container = containers.find(c => !!c);

            if (container && !document.querySelector('.et-zoom-copy-btn')) {
                console.log('PMsToolKit: Container found, injecting button.');
                injectButton(container);
            }
        };

        // Run immediately
        inject();

        // And on mutations
        const observer = new MutationObserver((mutations) => {
            inject();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('PMsToolKit: Zoom observer started.');
    } catch (e) {
        console.error('PMsToolKit: Failed to initialize Zoom features', e);
    }
}

function injectButton(container) {
    const btn = document.createElement('button');
    btn.className = 'et-zoom-copy-btn';
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy Transcript
    `;

    btn.onclick = copyTranscript;
    container.appendChild(btn);
}

function copyTranscript() {
    const items = document.querySelectorAll('li.transcript-list-item, .transcript-item, [role="listitem"].transcript-list-item');
    let transcriptText = '';
    let lastSpeaker = '';

    items.forEach(item => {
        const speakerEl = item.querySelector('.user-name-span, .speaker-name, .transcript-item-user');
        const timeEl = item.querySelector('.time, .timestamp, .transcript-item-time');
        const textEl = item.querySelector('.text, .transcript-item-content, .transcript-item-text');

        if (!textEl) return;

        const time = timeEl ? timeEl.textContent.trim() : '';
        const speaker = speakerEl ? speakerEl.textContent.trim() : lastSpeaker;
        const text = textEl.textContent.trim();

        if (speaker) lastSpeaker = speaker;

        transcriptText += `[${time}] ${speaker}: ${text}\n`;
    });

    if (!transcriptText) {
        alert('No transcript items found to copy.');
        return;
    }

    navigator.clipboard.writeText(transcriptText).then(() => {
        const btn = document.querySelector('.et-zoom-copy-btn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '✅ Copied!';
        btn.classList.add('success');
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('success');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy transcript: ', err);
        alert('Failed to copy transcript to clipboard.');
    });
}

init();

import {
    TAG_COLOR_OPTIONS,
    cleanTagLabel,
    escapeHtml,
    getAllTagObjects,
    getTagInlineStyle,
    normalizeTagDefs,
    normalizeTagLabel,
    normalizeTagList,
} from './tagging.js';

export function createTagEditor(container, options = {}) {
    const state = {
        tags: normalizeTagList(options.value || [], options.tagDefs || {}),
        tagDefs: normalizeTagDefs(options.tagDefs || {}),
        query: '',
        highlightedIndex: 0,
        focused: false,
    };

    container.innerHTML = `
        <div class="et-tag-editor ${options.compact ? 'compact' : ''}">
            <div class="et-tag-editor-shell">
                <div class="et-tag-chip-list"></div>
                <input type="text" class="et-tag-editor-input" placeholder="${escapeHtml(options.placeholder || 'Add a tag...')}">
            </div>
            <div class="et-tag-editor-dropdown hidden"></div>
        </div>
    `;

    const root = container.querySelector('.et-tag-editor');
    const shell = root.querySelector('.et-tag-editor-shell');
    const chipsEl = root.querySelector('.et-tag-chip-list');
    const input = root.querySelector('.et-tag-editor-input');
    const dropdown = root.querySelector('.et-tag-editor-dropdown');

    function getSelectedSet() {
        return new Set(state.tags.map(normalizeTagLabel));
    }

    function getSuggestions() {
        const selected = getSelectedSet();
        const query = normalizeTagLabel(state.query);
        const allTags = getAllTagObjects(state.tagDefs);
        return allTags.filter(tag => {
            if (selected.has(tag.normalized)) return false;
            if (!query) return true;
            return tag.label.toLocaleLowerCase().includes(query);
        });
    }

    function syncInputWidth() {
        input.style.minWidth = state.tags.length ? '120px' : '180px';
    }

    function renderChips() {
        chipsEl.innerHTML = state.tags.map(label => {
            const normalized = normalizeTagLabel(label);
            const tagDef = state.tagDefs[normalized];
            return `
                <span class="et-tag-chip" style="${getTagInlineStyle(tagDef?.color)}">
                    <span class="et-tag-chip-dot"></span>
                    <span class="et-tag-chip-label">${escapeHtml(tagDef?.label || label)}</span>
                    <button type="button" class="et-tag-chip-remove" data-tag="${escapeHtml(label)}" aria-label="Remove ${escapeHtml(label)}">×</button>
                </span>
            `;
        }).join('');
        syncInputWidth();
    }

    function closeDropdown() {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        state.highlightedIndex = 0;
    }

    function renderDropdown() {
        const suggestions = getSuggestions();
        const queryLabel = cleanTagLabel(state.query);
        const queryNormalized = normalizeTagLabel(queryLabel);
        const canCreate = Boolean(options.allowCreate !== false && queryLabel && !state.tagDefs[queryNormalized]);

        if (!state.focused || (!suggestions.length && !canCreate)) {
            closeDropdown();
            return;
        }

        const safeIndex = Math.min(state.highlightedIndex, Math.max(suggestions.length - 1, 0));
        state.highlightedIndex = safeIndex;

        dropdown.innerHTML = `
            ${suggestions.length ? `
                <div class="et-tag-dropdown-section">
                    <div class="et-tag-dropdown-label">Suggestions</div>
                    ${suggestions.map((tag, index) => `
                        <button type="button" class="et-tag-suggestion ${index === safeIndex ? 'active' : ''}" data-tag="${escapeHtml(tag.label)}">
                            <span class="et-tag-chip suggestion-chip" style="${getTagInlineStyle(tag.color)}">
                                <span class="et-tag-chip-dot"></span>
                                <span class="et-tag-chip-label">${escapeHtml(tag.label)}</span>
                            </span>
                        </button>
                    `).join('')}
                </div>
            ` : ''}
            ${canCreate ? `
                <div class="et-tag-dropdown-section">
                    <div class="et-tag-dropdown-label">Create "${escapeHtml(queryLabel)}"</div>
                    <div class="et-tag-color-grid">
                        ${Object.values(TAG_COLOR_OPTIONS).map(color => `
                            <button type="button" class="et-tag-color-btn" data-create-color="${color.id}">
                                <span class="et-tag-color-swatch" style="${getTagInlineStyle(color.id)}"></span>
                                <span>${color.label}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;

        dropdown.classList.remove('hidden');
    }

    function emitChange() {
        options.onChange?.(state.tags.slice());
    }

    function addTag(label) {
        const normalized = normalizeTagLabel(label);
        if (!normalized) return;
        if (getSelectedSet().has(normalized)) {
            state.query = '';
            input.value = '';
            renderDropdown();
            return;
        }

        const nextLabel = state.tagDefs[normalized]?.label || cleanTagLabel(label);
        state.tags = normalizeTagList([...state.tags, nextLabel], state.tagDefs);
        state.query = '';
        input.value = '';
        renderChips();
        renderDropdown();
        emitChange();
    }

    async function createTag(label, color) {
        const created = await options.onCreateTag?.(cleanTagLabel(label), color);
        if (created === false) return;

        const normalized = normalizeTagLabel(label);
        state.tagDefs = {
            ...state.tagDefs,
            [normalized]: {
                label: cleanTagLabel(created?.label || label),
                color: created?.color || color,
            },
        };
        addTag(state.tagDefs[normalized].label);
    }

    chipsEl.addEventListener('click', e => {
        const btn = e.target.closest('.et-tag-chip-remove');
        if (!btn) return;
        const label = btn.dataset.tag;
        state.tags = state.tags.filter(tag => normalizeTagLabel(tag) !== normalizeTagLabel(label));
        renderChips();
        renderDropdown();
        emitChange();
        input.focus();
    });

    shell.addEventListener('click', () => input.focus());

    input.addEventListener('focus', () => {
        state.focused = true;
        renderDropdown();
    });

    input.addEventListener('input', e => {
        state.query = e.target.value;
        state.highlightedIndex = 0;
        renderDropdown();
    });

    input.addEventListener('keydown', async e => {
        const suggestions = getSuggestions();
        const exactMatch = suggestions.find(tag => normalizeTagLabel(tag.label) === normalizeTagLabel(state.query));

        if (e.key === 'Backspace' && !input.value && state.tags.length) {
            e.preventDefault();
            state.tags = state.tags.slice(0, -1);
            renderChips();
            renderDropdown();
            emitChange();
            return;
        }

        if (e.key === 'ArrowDown' && suggestions.length) {
            e.preventDefault();
            state.highlightedIndex = Math.min(state.highlightedIndex + 1, suggestions.length - 1);
            renderDropdown();
            return;
        }

        if (e.key === 'ArrowUp' && suggestions.length) {
            e.preventDefault();
            state.highlightedIndex = Math.max(state.highlightedIndex - 1, 0);
            renderDropdown();
            return;
        }

        if (['Enter', 'Tab', ','].includes(e.key)) {
            if (!state.query.trim()) return;
            if (exactMatch) {
                e.preventDefault();
                addTag(exactMatch.label);
                return;
            }

            if (suggestions.length && e.key !== ',') {
                e.preventDefault();
                addTag(suggestions[state.highlightedIndex]?.label || suggestions[0].label);
            }
        }

        if (e.key === 'Escape') {
            closeDropdown();
            input.blur();
        }
    });

    dropdown.addEventListener('mousedown', e => e.preventDefault());

    dropdown.addEventListener('click', async e => {
        const suggestion = e.target.closest('.et-tag-suggestion');
        if (suggestion) {
            addTag(suggestion.dataset.tag);
            input.focus();
            return;
        }

        const createBtn = e.target.closest('[data-create-color]');
        if (createBtn) {
            await createTag(state.query, createBtn.dataset.createColor);
            input.focus();
        }
    });

    const outsideHandler = e => {
        if (!document.body.contains(container)) {
            document.removeEventListener('click', outsideHandler);
            return;
        }
        if (!container.contains(e.target)) {
            state.focused = false;
            closeDropdown();
        }
    };
    document.addEventListener('click', outsideHandler);

    renderChips();
    renderDropdown();

    return {
        getValue() {
            return state.tags.slice();
        },
        setValue(nextValue) {
            state.tags = normalizeTagList(nextValue, state.tagDefs);
            renderChips();
            renderDropdown();
        },
        setTagDefs(nextDefs) {
            state.tagDefs = normalizeTagDefs(nextDefs || {});
            state.tags = normalizeTagList(state.tags, state.tagDefs);
            renderChips();
            renderDropdown();
        },
        destroy() {
            document.removeEventListener('click', outsideHandler);
            container.innerHTML = '';
        },
    };
}

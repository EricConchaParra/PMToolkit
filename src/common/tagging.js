import { storage } from './storage.js';
import { getTrackingItems, setTrackingItems } from './trackingRepository.js';
import { DEMO_HOST } from './demoData.js';
import {
    LEGACY_TAG_DEFS_STORAGE_KEY,
    getTagDefsStorageKey,
    getTagsStorageKey,
    getNotesStorageKey,
    getReminderStorageKey,
    getMetaStorageKey,
    parseJiraTrackingStorageKey,
} from './jiraStorageKeys.js';

export const TRACKING_UPDATED_EVENT = 'pmtoolkit:tracking-updated';

export const TAG_COLOR_OPTIONS = {
    red: {
        id: 'red',
        label: 'Red',
        background: '#ffebe6',
        border: '#ffbdad',
        text: '#bf2600',
        dot: '#de350b',
    },
    green: {
        id: 'green',
        label: 'Green',
        background: '#e3fcef',
        border: '#abf5d1',
        text: '#006644',
        dot: '#36b37e',
    },
    blue: {
        id: 'blue',
        label: 'Blue',
        background: '#deebff',
        border: '#b3d4ff',
        text: '#0747a6',
        dot: '#0052cc',
    },
    gray: {
        id: 'gray',
        label: 'Gray',
        background: '#f4f5f7',
        border: '#dfe1e6',
        text: '#42526e',
        dot: '#6b778c',
    },
    black: {
        id: 'black',
        label: 'Black',
        background: '#253858',
        border: '#172b4d',
        text: '#ffffff',
        dot: '#091e42',
    },
    yellow: {
        id: 'yellow',
        label: 'Yellow',
        background: '#fff7d6',
        border: '#f5cd47',
        text: '#7a5d00',
        dot: '#ffab00',
    },
    orange: {
        id: 'orange',
        label: 'Orange',
        background: '#ffead8',
        border: '#fec195',
        text: '#a54800',
        dot: '#ff8b00',
    },
};

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function cleanTagLabel(label) {
    return String(label ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizeTagLabel(label) {
    return cleanTagLabel(label).toLocaleLowerCase();
}

export function getTagColorMeta(colorId) {
    return TAG_COLOR_OPTIONS[colorId] || TAG_COLOR_OPTIONS.gray;
}

export function getTagInlineStyle(colorId) {
    const color = getTagColorMeta(colorId);
    return [
        `--et-tag-bg:${color.background}`,
        `--et-tag-border:${color.border}`,
        `--et-tag-color:${color.text}`,
        `--et-tag-dot:${color.dot}`,
    ].join(';');
}

export function normalizeTagDefs(rawDefs = {}) {
    const defs = {};
    Object.entries(rawDefs || {}).forEach(([key, value]) => {
        const label = cleanTagLabel(value?.label || key);
        const normalized = normalizeTagLabel(label);
        if (!normalized) return;

        defs[normalized] = {
            label,
            color: getTagColorMeta(value?.color).id,
        };
    });
    return defs;
}

export function normalizeTagList(tagLabels = [], tagDefs = {}) {
    const defs = normalizeTagDefs(tagDefs);
    const seen = new Set();
    const tags = [];

    (Array.isArray(tagLabels) ? tagLabels : []).forEach(rawLabel => {
        const clean = cleanTagLabel(rawLabel);
        const normalized = normalizeTagLabel(clean);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        tags.push(defs[normalized]?.label || clean);
    });

    return tags.sort((a, b) => a.localeCompare(b));
}

export function getTagObjects(tagLabels = [], tagDefs = {}) {
    const defs = normalizeTagDefs(tagDefs);
    return normalizeTagList(tagLabels, defs).map(label => {
        const normalized = normalizeTagLabel(label);
        return {
            normalized,
            label: defs[normalized]?.label || label,
            color: defs[normalized]?.color || 'gray',
        };
    });
}

export function getAllTagObjects(tagDefs = {}) {
    return Object.entries(normalizeTagDefs(tagDefs))
        .map(([normalized, def]) => ({
            normalized,
            label: def.label,
            color: def.color,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function hasTrackedContent(noteText, reminderTs, tagLabels = []) {
    return Boolean((noteText || '').trim() || reminderTs || (tagLabels || []).length);
}

export function parseTrackingStorage(items = {}, opts = {}) {
    const {
        activeRemindersOnly = false,
        now = Date.now(),
        host = '',
    } = opts;

    const notesMap = {};
    const remindersMap = {};
    const metaMap = {};
    const tagsMap = {};
    const tagDefsKey = getTagDefsStorageKey(host);
    const tagDefs = normalizeTagDefs(
        items[tagDefsKey]
        || items[LEGACY_TAG_DEFS_STORAGE_KEY]
        || {}
    );
    const allKeys = new Set();

    Object.entries(items).forEach(([key, value]) => {
        const parsedKey = parseJiraTrackingStorageKey(key, host);
        if (!parsedKey?.issueKey) return;
        if (host && parsedKey.host && parsedKey.host !== host) return;

        if (parsedKey.prefix === 'notes') {
            if (!value) return;
            notesMap[parsedKey.issueKey] = value;
            allKeys.add(parsedKey.issueKey);
            return;
        }

        if (parsedKey.prefix === 'reminder') {
            if (!value) return;
            if (activeRemindersOnly && value <= now) return;
            remindersMap[parsedKey.issueKey] = value;
            allKeys.add(parsedKey.issueKey);
            return;
        }

        if (parsedKey.prefix === 'meta') {
            metaMap[parsedKey.issueKey] = value;
            return;
        }

        if (parsedKey.prefix === 'tags') {
            const normalizedTags = normalizeTagList(value, tagDefs);
            if (normalizedTags.length === 0) return;
            tagsMap[parsedKey.issueKey] = normalizedTags;
            allKeys.add(parsedKey.issueKey);
        }
    });

    return {
        notesMap,
        remindersMap,
        metaMap,
        tagsMap,
        tagDefs,
        allKeys: Array.from(allKeys).sort((a, b) => b.localeCompare(a)),
    };
}

export function matchesTagFilter(tagLabels = [], selectedTags = []) {
    if (!selectedTags.length) return true;
    const selected = new Set(selectedTags.map(normalizeTagLabel));
    return tagLabels.some(label => selected.has(normalizeTagLabel(label)));
}

export function matchesSearchTerm(item, term) {
    const search = String(term || '').trim().toLocaleLowerCase();
    if (!search) return true;

    return [
        item.key,
        item.text,
        item.meta?.summary,
        item.meta?.assignee,
        ...(item.tags || []),
    ].some(value => String(value || '').toLocaleLowerCase().includes(search));
}

export function hasTrackingStorageChange(changes = {}, opts = {}) {
    const { includeMeta = false } = opts;
    return Object.keys(changes).some(key => {
        if (key === LEGACY_TAG_DEFS_STORAGE_KEY || key.startsWith('tag_defs_jira@')) return true;
        const parsedKey = parseJiraTrackingStorageKey(key);
        if (!parsedKey) return false;
        if (parsedKey.prefix === 'meta') return includeMeta;
        return parsedKey.prefix === 'notes'
            || parsedKey.prefix === 'reminder'
            || parsedKey.prefix === 'tags';
    });
}

export async function loadTagDefs(host = '') {
    const storageKey = getTagDefsStorageKey(host);
    const result = await storage.get(storageKey);
    return normalizeTagDefs(result[storageKey] || {});
}

export async function ensureTagDefinition(label, color, opts = {}) {
    const cleanLabel = cleanTagLabel(label);
    const normalized = normalizeTagLabel(cleanLabel);
    if (!normalized) return null;

    const demoMode = opts.demoMode === true;
    const host = demoMode ? DEMO_HOST : String(opts.host || '').trim();
    const storageKey = getTagDefsStorageKey(host);
    const currentDefs = demoMode
        ? normalizeTagDefs((await getTrackingItems({ [storageKey]: {} }, { demoMode: true }))[storageKey] || {})
        : await loadTagDefs(host);
    if (currentDefs[normalized]) {
        return {
            normalized,
            ...currentDefs[normalized],
        };
    }

    const nextDefs = {
        ...currentDefs,
        [normalized]: {
            label: cleanLabel,
            color: getTagColorMeta(color).id,
        },
    };
    if (demoMode) {
        await setTrackingItems({ [storageKey]: nextDefs }, { demoMode: true });
    } else {
        await storage.set({ [storageKey]: nextDefs });
    }

    return {
        normalized,
        ...nextDefs[normalized],
    };
}

export async function saveIssueTags(issueKey, tagLabels, host = '') {
    const normalizedTags = normalizeTagList(tagLabels);
    const storageKey = getTagsStorageKey(issueKey, host);

    if (normalizedTags.length) {
        await storage.set({ [storageKey]: normalizedTags });
    } else {
        await storage.remove(storageKey);
    }

    return normalizedTags;
}

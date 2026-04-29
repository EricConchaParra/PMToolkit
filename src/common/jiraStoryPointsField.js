import { normalizeJiraHost } from './jiraIdentity.js';
import { getJiraFieldOverridesStorageKey } from './jiraStorageKeys.js';
import { storage } from './storage.js';

const EXACT_STORY_POINT_ALIASES = new Set([
    'story points',
    'story point estimate',
    'story points estimated',
].map(normalizeFieldLabel));

const resolutionCache = new Map();

function normalizeFieldLabel(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isNumberField(field = {}) {
    return String(field?.schema?.type || '').toLowerCase() === 'number';
}

function isCustomField(field = {}) {
    return String(field?.custom || field?.schema?.custom || '').trim() !== ''
        || String(field?.id || '').startsWith('customfield_');
}

function isExactStoryPointAlias(field = {}) {
    return EXACT_STORY_POINT_ALIASES.has(normalizeFieldLabel(field?.name));
}

function getHeuristicScore(field = {}) {
    const normalizedName = normalizeFieldLabel(field?.name);
    const hasStory = normalizedName.includes('story');
    const hasPoint = normalizedName.includes('point');
    if (!hasStory || !hasPoint) return -1;

    let score = 30;
    if (normalizedName.includes('estimate')) score += 8;
    if (normalizedName.includes('estimated')) score += 8;
    if (isNumberField(field)) score += 25;
    if (isCustomField(field)) score += 15;
    return score;
}

function buildResolution({ fieldId = null, fieldName = '', source = 'unresolved', warning = '' } = {}) {
    return { fieldId, fieldName, source, warning };
}

async function fetchFields(opts = {}) {
    if (Array.isArray(opts.fields)) return opts.fields;
    if (typeof opts.fetchFields === 'function') {
        const fields = await opts.fetchFields();
        return Array.isArray(fields) ? fields : [];
    }
    return [];
}

function resolveAutoField(fields = []) {
    const exactMatches = fields.filter(isExactStoryPointAlias);
    if (exactMatches.length === 1) {
        return buildResolution({
            fieldId: exactMatches[0].id || null,
            fieldName: exactMatches[0].name || '',
            source: 'auto',
        });
    }

    if (exactMatches.length > 1) {
        return buildResolution({
            source: 'ambiguous',
            warning: `Multiple Story Points fields were found: ${exactMatches.map(field => `${field.name} (${field.id})`).join(', ')}. Set a site override to choose the right field.`,
        });
    }

    const heuristicMatches = fields
        .map(field => ({ field, score: getHeuristicScore(field) }))
        .filter(candidate => candidate.score >= 0)
        .sort((left, right) => right.score - left.score || String(left.field?.name || '').localeCompare(String(right.field?.name || '')));

    if (heuristicMatches.length === 0) {
        return buildResolution({
            source: 'unresolved',
            warning: 'No Story Points field was detected for this Jira site. Configure a field override to use SP metrics.',
        });
    }

    const [winner, runnerUp] = heuristicMatches;
    const isClearWinner = !runnerUp || winner.score >= runnerUp.score + 15;
    if (isClearWinner) {
        return buildResolution({
            fieldId: winner.field.id || null,
            fieldName: winner.field.name || '',
            source: 'auto',
        });
    }

    return buildResolution({
        source: 'ambiguous',
        warning: `Multiple Story Points-like fields were found: ${heuristicMatches.map(candidate => `${candidate.field.name} (${candidate.field.id})`).join(', ')}. Set a site override to choose the right field.`,
    });
}

export async function loadJiraFieldOverrides(host) {
    const normalizedHost = normalizeJiraHost(host);
    const storageKey = getJiraFieldOverridesStorageKey(normalizedHost);
    if (!storageKey) return { storyPointsFieldId: '' };

    const stored = await storage.get([storageKey]);
    const value = stored[storageKey] || {};
    return {
        storyPointsFieldId: String(value.storyPointsFieldId || '').trim(),
    };
}

export async function saveJiraFieldOverride(host, fieldId) {
    const normalizedHost = normalizeJiraHost(host);
    const storageKey = getJiraFieldOverridesStorageKey(normalizedHost);
    if (!storageKey) return;

    const normalizedFieldId = String(fieldId || '').trim();
    if (normalizedFieldId) {
        await storage.set({
            [storageKey]: { storyPointsFieldId: normalizedFieldId },
        });
    } else {
        await storage.remove(storageKey);
    }
    clearStoryPointsFieldCache(normalizedHost);
}

export function clearStoryPointsFieldCache(host = '') {
    const normalizedHost = normalizeJiraHost(host);
    if (normalizedHost) {
        resolutionCache.delete(normalizedHost);
        return;
    }
    resolutionCache.clear();
}

export async function resolveStoryPointsField(host, opts = {}) {
    const normalizedHost = normalizeJiraHost(host);
    if (!normalizedHost) {
        return buildResolution({
            source: 'unresolved',
            warning: 'No Jira site is active, so Story Points could not be resolved.',
        });
    }

    if (!opts.forceRefresh && resolutionCache.has(normalizedHost)) {
        return resolutionCache.get(normalizedHost);
    }

    const overrides = await loadJiraFieldOverrides(normalizedHost);
    const overrideFieldId = String(overrides.storyPointsFieldId || '').trim();

    try {
        const fields = await fetchFields(opts);
        if (!Array.isArray(fields) || fields.length === 0) {
            if (overrideFieldId) {
                const overrideResolution = buildResolution({
                    fieldId: overrideFieldId,
                    fieldName: '',
                    source: 'override',
                    warning: 'Using the configured Story Points override, but Jira field metadata could not be verified right now.',
                });
                resolutionCache.set(normalizedHost, overrideResolution);
                return overrideResolution;
            }

            const unresolved = buildResolution({
                source: 'unresolved',
                warning: 'Jira field metadata could not be loaded, so Story Points could not be detected.',
            });
            resolutionCache.set(normalizedHost, unresolved);
            return unresolved;
        }

        if (overrideFieldId) {
            const matchedOverride = fields.find(field => String(field?.id || '').trim() === overrideFieldId);
            const overrideResolution = matchedOverride
                ? buildResolution({
                    fieldId: overrideFieldId,
                    fieldName: matchedOverride.name || '',
                    source: 'override',
                })
                : buildResolution({
                    source: 'unresolved',
                    warning: `The configured Story Points override (${overrideFieldId}) was not found on this Jira site. Update or clear the override.`,
                });
            resolutionCache.set(normalizedHost, overrideResolution);
            return overrideResolution;
        }

        const autoResolution = resolveAutoField(fields);
        resolutionCache.set(normalizedHost, autoResolution);
        return autoResolution;
    } catch (error) {
        const fallback = overrideFieldId
            ? buildResolution({
                fieldId: overrideFieldId,
                fieldName: '',
                source: 'override',
                warning: 'Using the configured Story Points override, but Jira field metadata could not be loaded right now.',
            })
            : buildResolution({
                source: 'unresolved',
                warning: 'Jira field metadata could not be loaded, so Story Points could not be detected.',
            });
        resolutionCache.set(normalizedHost, fallback);
        return fallback;
    }
}

export const STORY_POINTS_FIELD_ALIASES = Array.from(EXACT_STORY_POINT_ALIASES.values());

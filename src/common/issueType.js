export function getIssueTypeMeta(source = {}) {
    const issueType = source?.fields?.issuetype
        || source?.issueType
        || source?.issuetype
        || null;

    return {
        name: String(issueType?.name || '').trim(),
        iconUrl: String(issueType?.iconUrl || '').trim(),
    };
}

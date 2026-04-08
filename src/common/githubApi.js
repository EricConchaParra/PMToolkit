export async function githubFetch(path, token) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const resp = await fetch(url, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });

    if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '');
        const error = new Error(`GitHub API ${resp.status}`);
        error.status = resp.status;
        error.responseText = bodyText;
        error.headers = {
            reset: resp.headers.get('x-ratelimit-reset'),
            remaining: resp.headers.get('x-ratelimit-remaining'),
            limit: resp.headers.get('x-ratelimit-limit'),
            retryAfter: resp.headers.get('retry-after'),
        };
        throw error;
    }

    return resp.json();
}

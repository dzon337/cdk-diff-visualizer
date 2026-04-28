export interface GitHubEnv {
    prNumber: string;
    owner: string;
    repo: string;
    token: string;
    apiUrl: string;
}

export function resolveGitHubEnv(): GitHubEnv {
    const prNumber = extractPrFromRef(process.env['GITHUB_REF'] ?? '')
        || process.env['GITHUB_PR_NUMBER']
        || '';

    const owner = process.env['GITHUB_REPOSITORY_OWNER'] ?? '';
    const fullRepo = process.env['GITHUB_REPOSITORY'] ?? '';
    const repo = fullRepo.split('/')[1] ?? '';
    const token = process.env['GITHUB_TOKEN'] ?? '';
    const apiUrl = process.env['GITHUB_API_URL'] ?? 'https://api.github.com';

    const missing: string[] = [];
    if (!prNumber) missing.push('GITHUB_PR_NUMBER (or GITHUB_REF=refs/pull/N/merge)');
    if (!owner) missing.push('GITHUB_REPOSITORY_OWNER');
    if (!repo) missing.push('GITHUB_REPOSITORY');
    if (!token) missing.push('GITHUB_TOKEN');

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}\n` +
            `These are set automatically by GitHub Actions.`
        );
    }

    return { prNumber, owner, repo, token, apiUrl };
}

export function buildGitHubPrUrl(env: GitHubEnv): string {
    return `https://github.com/${env.owner}/${env.repo}/pull/${env.prNumber}`;
}

// ─── Comment marker for upsert ─────────────────────────────────────────────────
const COMMENT_MARKER = '<!-- cdk-diff-report -->';

/** Wrap markdown with the hidden marker used for upsert detection. */
export function withMarker(markdown: string): string {
    return `${COMMENT_MARKER}\n${markdown}`;
}

// ─── GitHub API types (minimal) ─────────────────────────────────────────────────

interface GitHubComment {
    id: number;
    body: string;
}

// ─── API helpers ────────────────────────────────────────────────────────────────

function authHeaders(env: GitHubEnv): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

function commentsBaseUrl(env: GitHubEnv): string {
    return `${env.apiUrl}/repos/${env.owner}/${env.repo}/issues/${env.prNumber}/comments`;
}

/**
 * List all comments on a pull request (handles GitHub pagination).
 */
export async function listPrComments(env: GitHubEnv): Promise<GitHubComment[]> {
    const all: GitHubComment[] = [];
    let url: string | undefined = `${commentsBaseUrl(env)}?per_page=100`;

    while (url) {
        const response = await fetch(url, {
            method: 'GET',
            headers: authHeaders(env),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`GitHub API error ${response.status} ${response.statusText}: ${body}`);
        }

        const data = (await response.json()) as GitHubComment[];
        all.push(...data);

        // Parse Link header for next page
        const linkHeader = response.headers.get('link') ?? '';
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : undefined;
    }

    return all;
}

/**
 * Find a previous cdk-diff-report comment by looking for the hidden marker.
 */
export async function findExistingComment(env: GitHubEnv): Promise<number | null> {
    const comments = await listPrComments(env);
    const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    return existing ? existing.id : null;
}

/**
 * Create a new PR comment.
 */
export async function postGitHubPrComment(env: GitHubEnv, markdown: string): Promise<void> {
    const url = commentsBaseUrl(env);

    const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders(env),
        body: JSON.stringify({ body: markdown }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API error ${response.status} ${response.statusText}: ${body}`);
    }
}

/**
 * Update an existing PR comment by ID.
 */
export async function updateGitHubPrComment(
    env: GitHubEnv,
    commentId: number,
    markdown: string
): Promise<void> {
    const url = `${env.apiUrl}/repos/${env.owner}/${env.repo}/issues/comments/${commentId}`;

    const response = await fetch(url, {
        method: 'PATCH',
        headers: authHeaders(env),
        body: JSON.stringify({ body: markdown }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API error ${response.status} ${response.statusText}: ${body}`);
    }
}

/**
 * Upsert a PR comment: update the existing cdk-diff-report comment if one
 * exists, otherwise create a new one. The comment body is wrapped with a
 * hidden marker so it can be found on subsequent runs.
 */
export async function upsertGitHubPrComment(env: GitHubEnv, markdown: string): Promise<void> {
    const markedBody = withMarker(markdown);

    const existingId = await findExistingComment(env);

    if (existingId !== null) {
        await updateGitHubPrComment(env, existingId, markedBody);
    } else {
        await postGitHubPrComment(env, markedBody);
    }
}

function extractPrFromRef(ref: string): string {
    const match = ref.match(/refs\/pull\/(\d+)\//);
    return match?.[1] ?? '';
}
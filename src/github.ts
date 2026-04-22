export interface GitHubEnv {
    prNumber: string;
    owner: string;
    repo: string;
    token: string;
    apiUrl: string;
}

export function resolveGitHubEnv(): GitHubEnv {
    console.log('[github] GITHUB_REF:', process.env['GITHUB_REF']);
    console.log('[github] GITHUB_REPOSITORY:', process.env['GITHUB_REPOSITORY']);
    console.log('[github] GITHUB_REPOSITORY_OWNER:', process.env['GITHUB_REPOSITORY_OWNER']);
    console.log('[github] GITHUB_TOKEN set:', !!process.env['GITHUB_TOKEN']);
    console.log('[github] GITHUB_PR_NUMBER:', process.env['GITHUB_PR_NUMBER']);
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

    console.log('[github] resolved prNumber:', prNumber);

    return { prNumber, owner, repo, token, apiUrl };
}

export function buildGitHubPrUrl(env: GitHubEnv): string {
    return `https://github.com/${env.owner}/${env.repo}/pull/${env.prNumber}`;
}

export async function postGitHubPrComment(env: GitHubEnv, markdown: string): Promise<void> {
    const url = `${env.apiUrl}/repos/${env.owner}/${env.repo}/issues/${env.prNumber}/comments`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: markdown }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API error ${response.status} ${response.statusText}: ${body}`);
    }
}

function extractPrFromRef(ref: string): string {
    const match = ref.match(/refs\/pull\/(\d+)\//);
    return match?.[1] ?? '';
}
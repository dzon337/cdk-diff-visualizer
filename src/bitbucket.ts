export interface BitbucketEnv {
  prId: string;
  workspace: string;
  repoSlug: string;
  accessToken: string;
  apiUrl: string;
}

export function resolveBitbucketEnv(overrides: Partial<BitbucketEnv> = {}): BitbucketEnv {
  const prId = overrides.prId ?? process.env['BITBUCKET_PR_ID'] ?? '';
  const workspace = overrides.workspace ?? process.env['BITBUCKET_WORKSPACE'] ?? '';
  const repoSlug = overrides.repoSlug ?? process.env['BITBUCKET_REPO_SLUG'] ?? '';
  const accessToken = process.env['BITBUCKET_ACCESS_TOKEN'] ?? '';
  const apiUrl = overrides.apiUrl ?? 'https://api.bitbucket.org/2.0';

  const missing: string[] = [];
  if (!prId) missing.push('BITBUCKET_PR_ID');
  if (!workspace) missing.push('BITBUCKET_WORKSPACE');
  if (!repoSlug) missing.push('BITBUCKET_REPO_SLUG');
  if (!accessToken) missing.push('BITBUCKET_ACCESS_TOKEN');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `These are set automatically by Bitbucket Pipelines. ` +
        `For local runs, set them manually or use --dry-run.`
    );
  }

  return { prId, workspace, repoSlug, accessToken, apiUrl };
}

export function buildPrUrl(env: BitbucketEnv): string {
  return `https://bitbucket.org/${env.workspace}/${env.repoSlug}/pull-requests/${env.prId}`;
}

export async function postPrComment(env: BitbucketEnv, markdown: string): Promise<void> {
  const url = `${env.apiUrl}/repositories/${env.workspace}/${env.repoSlug}/pullrequests/${env.prId}/comments`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.accessToken}`,
    },
    body: JSON.stringify({
      content: { raw: markdown },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bitbucket API error ${response.status} ${response.statusText}: ${body}`
    );
  }
}

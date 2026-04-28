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

// ─── Comment marker for upsert ─────────────────────────────────────────────────
// We embed a hidden HTML comment in the Markdown body so we can find and update
// our own previous comment instead of creating a new one every pipeline run.
const COMMENT_MARKER = '<!-- cdk-diff-report -->';

/** Wrap markdown with the hidden marker used for upsert detection. */
export function withMarker(markdown: string): string {
  return `${COMMENT_MARKER}\n${markdown}`;
}

// ─── Bitbucket API types (minimal) ──────────────────────────────────────────────

interface BitbucketComment {
  id: number;
  content: { raw: string };
}

interface BitbucketPaginatedResponse<T> {
  values: T[];
  next?: string;
}

// ─── API helpers ────────────────────────────────────────────────────────────────

function authHeaders(env: BitbucketEnv): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.accessToken}`,
  };
}

function commentsBaseUrl(env: BitbucketEnv): string {
  return `${env.apiUrl}/repositories/${env.workspace}/${env.repoSlug}/pullrequests/${env.prId}/comments`;
}

/**
 * List all comments on a pull request (handles pagination).
 */
export async function listPrComments(env: BitbucketEnv): Promise<BitbucketComment[]> {
  const all: BitbucketComment[] = [];
  let url: string | undefined = commentsBaseUrl(env);

  while (url) {
    const response = await fetch(url, {
      method: 'GET',
      headers: authHeaders(env),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Bitbucket API error ${response.status} ${response.statusText}: ${body}`
      );
    }

    const data = (await response.json()) as BitbucketPaginatedResponse<BitbucketComment>;
    all.push(...data.values);
    url = data.next;
  }

  return all;
}

/**
 * Find a previous cdk-diff-report comment by looking for the hidden marker.
 */
export async function findExistingComment(env: BitbucketEnv): Promise<number | null> {
  const comments = await listPrComments(env);
  const existing = comments.find((c) => c.content?.raw?.includes(COMMENT_MARKER));
  return existing ? existing.id : null;
}

/**
 * Create a new PR comment.
 */
export async function postPrComment(env: BitbucketEnv, markdown: string): Promise<void> {
  const url = commentsBaseUrl(env);

  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(env),
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

/**
 * Update an existing PR comment by ID.
 */
export async function updatePrComment(
  env: BitbucketEnv,
  commentId: number,
  markdown: string
): Promise<void> {
  const url = `${commentsBaseUrl(env)}/${commentId}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: authHeaders(env),
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

/**
 * Delete an existing PR comment by ID.
 */
export async function deletePrComment(
  env: BitbucketEnv,
  commentId: number
): Promise<void> {
  const url = `${commentsBaseUrl(env)}/${commentId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(env),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bitbucket API error ${response.status} ${response.statusText}: ${body}`
    );
  }
}

/**
 * Upsert a PR comment: update the existing cdk-diff-report comment if one
 * exists, otherwise create a new one. The comment body is wrapped with a
 * hidden marker so it can be found on subsequent runs.
 */
export async function upsertPrComment(env: BitbucketEnv, markdown: string): Promise<void> {
  const markedBody = withMarker(markdown);

  const existingId = await findExistingComment(env);

  if (existingId !== null) {
    await updatePrComment(env, existingId, markedBody);
  } else {
    await postPrComment(env, markedBody);
  }
}

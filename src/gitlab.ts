export interface GitLabEnv {
  projectId: string;
  mrIid: string;
  token: string;
  apiUrl: string;
}

export function resolveGitLabEnv(overrides: Partial<GitLabEnv> = {}): GitLabEnv {
  const projectId = overrides.projectId ?? process.env['CI_PROJECT_ID'] ?? '';
  const mrIid = overrides.mrIid ?? process.env['CI_MERGE_REQUEST_IID'] ?? '';
  // Prefer GITLAB_TOKEN (personal/project token), fall back to CI_JOB_TOKEN
  const token = process.env['GITLAB_TOKEN'] ?? process.env['CI_JOB_TOKEN'] ?? '';
  const apiUrl = overrides.apiUrl ?? process.env['CI_API_V4_URL'] ?? 'https://gitlab.com/api/v4';

  const missing: string[] = [];
  if (!projectId) missing.push('CI_PROJECT_ID');
  if (!mrIid) missing.push('CI_MERGE_REQUEST_IID');
  if (!token) missing.push('GITLAB_TOKEN (or CI_JOB_TOKEN)');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `These are set automatically by GitLab CI/CD (use merge request pipelines). ` +
        `For local runs, set them manually or use --dry-run.`
    );
  }

  return { projectId, mrIid, token, apiUrl };
}

export function buildGitLabMrUrl(env: GitLabEnv): string {
  // CI_PROJECT_URL is not stored in env — derive from apiUrl
  // apiUrl is typically https://gitlab.com/api/v4 → base is https://gitlab.com
  const base = env.apiUrl.replace(/\/api\/v4\/?$/, '');
  // For gitlab.com, the MR URL needs the project path, but we only have the ID.
  // Use the API URL to build a redirect-friendly link.
  // GitLab supports /projects/:id redirects, but the canonical MR URL uses the path.
  // Best-effort: use the /-/merge_requests/:iid route via project ID.
  return `${base}/projects/${encodeURIComponent(env.projectId)}/merge_requests/${env.mrIid}`;
}

// ─── Comment marker for upsert ─────────────────────────────────────────────────
const COMMENT_MARKER = '<!-- cdk-diff-report -->';

/** Wrap markdown with the hidden marker used for upsert detection. */
export function withMarker(markdown: string): string {
  return `${COMMENT_MARKER}\n${markdown}`;
}

// ─── GitLab API types (minimal) ─────────────────────────────────────────────────

interface GitLabNote {
  id: number;
  body: string;
  system: boolean;
}

// ─── API helpers ────────────────────────────────────────────────────────────────

function authHeaders(env: GitLabEnv): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'PRIVATE-TOKEN': env.token,
  };
}

function notesBaseUrl(env: GitLabEnv): string {
  return `${env.apiUrl}/projects/${encodeURIComponent(env.projectId)}/merge_requests/${env.mrIid}/notes`;
}

/**
 * List all notes (comments) on a merge request (handles pagination).
 */
export async function listMrNotes(env: GitLabEnv): Promise<GitLabNote[]> {
  const all: GitLabNote[] = [];
  let url: string | undefined = `${notesBaseUrl(env)}?per_page=100`;

  while (url) {
    const response = await fetch(url, {
      method: 'GET',
      headers: authHeaders(env),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitLab API error ${response.status} ${response.statusText}: ${body}`
      );
    }

    const data = (await response.json()) as GitLabNote[];
    all.push(...data);

    // Parse Link header for next page
    const linkHeader = response.headers.get('link') ?? '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : undefined;
  }

  return all;
}

/**
 * Find a previous cdk-diff-report note by looking for the hidden marker.
 * Ignores system-generated notes.
 */
export async function findExistingNote(env: GitLabEnv): Promise<number | null> {
  const notes = await listMrNotes(env);
  const existing = notes.find((n) => !n.system && n.body?.includes(COMMENT_MARKER));
  return existing ? existing.id : null;
}

/**
 * Create a new MR note (comment).
 */
export async function postMrNote(env: GitLabEnv, markdown: string): Promise<void> {
  const url = notesBaseUrl(env);

  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ body: markdown }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitLab API error ${response.status} ${response.statusText}: ${body}`
    );
  }
}

/**
 * Update an existing MR note by ID.
 */
export async function updateMrNote(
  env: GitLabEnv,
  noteId: number,
  markdown: string
): Promise<void> {
  const url = `${notesBaseUrl(env)}/${noteId}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: authHeaders(env),
    body: JSON.stringify({ body: markdown }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitLab API error ${response.status} ${response.statusText}: ${body}`
    );
  }
}

/**
 * Delete an existing MR note by ID.
 */
export async function deleteMrNote(
  env: GitLabEnv,
  noteId: number
): Promise<void> {
  const url = `${notesBaseUrl(env)}/${noteId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(env),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitLab API error ${response.status} ${response.statusText}: ${body}`
    );
  }
}

/**
 * Upsert an MR note: update the existing cdk-diff-report note if one exists,
 * otherwise create a new one. The body is wrapped with a hidden marker so it
 * can be found on subsequent runs.
 */
export async function upsertMrNote(env: GitLabEnv, markdown: string): Promise<void> {
  const markedBody = withMarker(markdown);

  const existingId = await findExistingNote(env);

  if (existingId !== null) {
    await updateMrNote(env, existingId, markedBody);
  } else {
    await postMrNote(env, markedBody);
  }
}

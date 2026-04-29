/**
 * GitLab API v4 integration — list, post, update, delete, and upsert
 * MR notes (comments) with hidden-marker-based deduplication.
 * @module gitlab
 */

export interface GitLabEnv { projectId: string; mrIid: string; token: string; apiUrl: string }

export function resolveGitLabEnv(overrides: Partial<GitLabEnv> = {}): GitLabEnv {
  const projectId = overrides.projectId ?? process.env['CI_PROJECT_ID'] ?? '';
  const mrIid = overrides.mrIid ?? process.env['CI_MERGE_REQUEST_IID'] ?? '';
  const token = process.env['GITLAB_TOKEN'] ?? process.env['CI_JOB_TOKEN'] ?? '';
  const apiUrl = overrides.apiUrl ?? process.env['CI_API_V4_URL'] ?? 'https://gitlab.com/api/v4';
  const missing = [!projectId && 'CI_PROJECT_ID', !mrIid && 'CI_MERGE_REQUEST_IID', !token && 'GITLAB_TOKEN'].filter(Boolean);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}\nSet automatically by GitLab CI/CD merge request pipelines, or use --dry-run.`);
  return { projectId, mrIid, token, apiUrl };
}

export function buildGitLabMrUrl(env: GitLabEnv): string {
  const base = env.apiUrl.replace(/\/api\/v4\/?$/, '');
  return `${base}/projects/${encodeURIComponent(env.projectId)}/merge_requests/${env.mrIid}`;
}

const COMMENT_MARKER = '<!-- cdk-diff-report -->';
export function withMarker(md: string): string { return `${COMMENT_MARKER}\n${md}`; }

interface GLNote { id: number; body: string; system: boolean }

function headers(env: GitLabEnv): Record<string, string> {
  return { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': env.token };
}
function baseUrl(env: GitLabEnv): string {
  return `${env.apiUrl}/projects/${encodeURIComponent(env.projectId)}/merge_requests/${env.mrIid}/notes`;
}

export async function listMrNotes(env: GitLabEnv): Promise<GLNote[]> {
  const all: GLNote[] = [];
  let url: string | undefined = `${baseUrl(env)}?per_page=100`;
  while (url) {
    const r = await fetch(url, { method: 'GET', headers: headers(env) });
    if (!r.ok) throw new Error(`GitLab API ${r.status}: ${await r.text()}`);
    all.push(...(await r.json()) as GLNote[]);
    const link = r.headers.get('link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : undefined;
  }
  return all;
}

export async function findExistingNote(env: GitLabEnv): Promise<number | null> {
  const n = (await listMrNotes(env)).find((n) => !n.system && n.body?.includes(COMMENT_MARKER));
  return n ? n.id : null;
}

export async function postMrNote(env: GitLabEnv, md: string): Promise<void> {
  const r = await fetch(baseUrl(env), { method: 'POST', headers: headers(env), body: JSON.stringify({ body: md }) });
  if (!r.ok) throw new Error(`GitLab API ${r.status}: ${await r.text()}`);
}

export async function updateMrNote(env: GitLabEnv, id: number, md: string): Promise<void> {
  const r = await fetch(`${baseUrl(env)}/${id}`, { method: 'PUT', headers: headers(env), body: JSON.stringify({ body: md }) });
  if (!r.ok) throw new Error(`GitLab API ${r.status}: ${await r.text()}`);
}

export async function deleteMrNote(env: GitLabEnv, id: number): Promise<void> {
  const r = await fetch(`${baseUrl(env)}/${id}`, { method: 'DELETE', headers: headers(env) });
  if (!r.ok) throw new Error(`GitLab API ${r.status}: ${await r.text()}`);
}

/** Upsert an MR note — update existing or create new. */
export async function upsertMrNote(env: GitLabEnv, md: string): Promise<void> {
  const marked = withMarker(md);
  const existing = await findExistingNote(env);
  existing !== null ? await updateMrNote(env, existing, marked) : await postMrNote(env, marked);
}

/**
 * Minimal GitHub client used by the admin sign-in and "Publish" flow.
 *
 * The target is fixed at build time: the admin can only ever read and write
 * data/cards.json on this repo's main branch, so a tampered browser setting
 * cannot redirect a commit (or the token) elsewhere.
 */

export interface RepoTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export const DEFAULT_TARGET: Readonly<RepoTarget> = Object.freeze({
  owner: "nikhil914",
  repo: "Kredit",
  branch: "main",
  path: "data/cards.json",
});

/** Fine-grained (github_pat_) or classic (ghp_) personal access token. */
export const TOKEN_PATTERN = /^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{36})$/;

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function b64encodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decodeUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function gh(token: string, url: string, init?: RequestInit) {
  if (!TOKEN_PATTERN.test(token)) throw new Error("That does not look like a GitHub token (github_pat_… or ghp_…).");
  const res = await fetch(`https://api.github.com${url}`, {
    ...init,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const hint =
      res.status === 401
        ? "Token is invalid or expired."
        : res.status === 403 || res.status === 404
          ? "Token cannot write to this repo. It needs Contents: Read and write on it."
          : res.status === 409
            ? "The file changed on GitHub since you loaded it. Reload from GitHub and re-apply your edits."
            : "";
    throw new Error(`GitHub ${res.status}: ${body.message ?? res.statusText}. ${hint}`.trim());
  }
  return res.json();
}

const repoPath = (t: RepoTarget) => `/repos/${enc(t.owner)}/${enc(t.repo)}`;

/**
 * Admin sign-in check: the token must belong to a GitHub account that has
 * write (push) access to the site's repo. Returns the account's login.
 */
export async function verifyAccess(token: string, t: RepoTarget = DEFAULT_TARGET): Promise<{ login: string }> {
  const user = await gh(token, "/user");
  const repo = await gh(token, repoPath(t));
  if (!repo?.permissions?.push) {
    throw new Error(`@${user.login} does not have write access to ${t.owner}/${t.repo}.`);
  }
  return { login: String(user.login) };
}

export async function fetchRemoteFile(t: RepoTarget, token: string) {
  const data = await gh(token, `${repoPath(t)}/contents/${enc(t.path)}?ref=${encodeURIComponent(t.branch)}`);
  return { sha: data.sha as string, text: b64decodeUtf8(data.content as string) };
}

/**
 * Commits `text` to the target path. `sha` must be the blob sha you loaded;
 * GitHub rejects the write (409) if the file changed since, so concurrent
 * edits are never silently overwritten.
 */
export async function commitFile(t: RepoTarget, token: string, text: string, sha: string, message: string) {
  const data = await gh(token, `${repoPath(t)}/contents/${enc(t.path)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64encodeUtf8(text), sha, branch: t.branch }),
  });
  return {
    sha: data.content.sha as string,
    commitUrl: `https://github.com/${enc(t.owner)}/${enc(t.repo)}/commit/${encodeURIComponent(String(data.commit.sha))}`,
    actionsUrl: `https://github.com/${enc(t.owner)}/${enc(t.repo)}/actions`,
  };
}

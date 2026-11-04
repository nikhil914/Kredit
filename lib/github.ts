/** Minimal GitHub Contents API client used by the admin "Publish" flow. */

export interface RepoTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export const DEFAULT_TARGET: RepoTarget = {
  owner: "nikhil914",
  repo: "Kredit",
  branch: "main",
  path: "data/cards.json",
};

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

async function gh(token: string | null, url: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com${url}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export async function fetchRemoteFile(t: RepoTarget, token: string | null) {
  const data = await gh(
    token,
    `/repos/${t.owner}/${t.repo}/contents/${t.path}?ref=${encodeURIComponent(t.branch)}`,
  );
  return { sha: data.sha as string, text: b64decodeUtf8(data.content as string) };
}

/**
 * Commits `text` to the target path. `sha` must be the blob sha you loaded;
 * GitHub rejects the write (409) if the file changed since, so concurrent
 * edits are never silently overwritten.
 */
export async function commitFile(t: RepoTarget, token: string, text: string, sha: string, message: string) {
  const data = await gh(token, `/repos/${t.owner}/${t.repo}/contents/${t.path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64encodeUtf8(text), sha, branch: t.branch }),
  });
  return {
    sha: data.content.sha as string,
    commitUrl: data.commit.html_url as string,
    actionsUrl: `https://github.com/${t.owner}/${t.repo}/actions`,
  };
}

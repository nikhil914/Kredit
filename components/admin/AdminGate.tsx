"use client";

import { CreditCard, ExternalLink, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { DEFAULT_TARGET, TOKEN_PATTERN, verifyAccess } from "@/lib/github";

/** Signed-in admin session. The token lives only in memory (never in storage). */
interface AdminSession {
  token: string;
  login: string;
  signOut: () => void;
}

const SessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useAdminSession must be used inside <AdminGate>");
  return s;
}

/** Sign the admin out after this long without keyboard or pointer activity. */
const IDLE_MS = 30 * 60 * 1000;
/** Keys older builds used to persist the token; wiped on every visit. */
const LEGACY_KEYS = ["kredit-admin-token", "kredit-admin-target"];

/**
 * Blocks the whole admin UI until the visitor proves, with a GitHub token,
 * that their GitHub account can push to the site's repo.
 *
 * This is a static site: the admin's JavaScript is public and anyone can
 * download it. What the gate protects is the ability to change the live site,
 * which is enforced by GitHub itself (only a token with write access can
 * commit). The gate makes sure nobody without that access ever sees the tools.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<{ token: string; login: string } | null>(null);
  const [framed, setFramed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Refuse to run inside a frame (clickjacking); GitHub Pages cannot send
    // frame-ancestors / X-Frame-Options headers.
    try {
      setFramed(window.top !== window.self);
    } catch {
      setFramed(true);
    }
    for (const k of LEGACY_KEYS) {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      } catch {}
    }
    setReady(true);
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  // Idle timeout.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!session) return;
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSession(null), IDLE_MS);
    };
    const events = ["pointerdown", "keydown", "scroll", "visibilitychange"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [session]);

  if (!ready) return <div className="min-h-dvh bg-canvas" />;
  if (framed)
    return <p className="p-6 text-sm text-rose-700">The admin cannot be opened inside a frame. Open it directly.</p>;
  if (!session) return <SignIn onSignedIn={setSession} />;

  return (
    <SessionContext.Provider value={{ ...session, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (s: { token: string; login: string }) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { owner, repo } = DEFAULT_TARGET;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const t = token.trim();
    if (!TOKEN_PATTERN.test(t)) {
      setError("Paste a GitHub personal access token (starts with github_pat_ or ghp_).");
      return;
    }
    setBusy(true);
    try {
      const { login } = await verifyAccess(t);
      setToken("");
      onSignedIn({ token: t, login });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-navy-900 text-white">
            <CreditCard className="size-4" aria-hidden />
          </span>
          <span className="font-display text-lg font-bold text-navy-900">Bitaqa admin</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Sign in with a GitHub token from an account that can push to{" "}
          <code className="rounded bg-slate-100 px-1">
            {owner}/{repo}
          </code>
          . Nothing is shown until GitHub confirms that access.
        </p>

        <label className="mt-5 block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <KeyRound className="size-3.5" aria-hidden />
            GitHub token
          </span>
          <input
            className="input font-mono"
            type="password"
            name="github-token"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_..."
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
            autoFocus
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary mt-4 w-full justify-center" disabled={busy || !token}>
          <ShieldCheck className="size-4" aria-hidden />
          {busy ? "Checking with GitHub…" : "Sign in"}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Use a fine-grained token limited to <b>only this repository</b> with <b>Contents: Read and write</b> and a
          short expiry.{" "}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-navy-700 hover:underline"
          >
            Create one <ExternalLink className="size-3" aria-hidden />
          </a>
          <br />
          The token is kept in this tab&apos;s memory only and sent only to api.github.com. Closing or reloading the tab,
          or 30 minutes without activity, signs you out.
        </p>
      </form>
    </div>
  );
}

export function SignedInBadge() {
  const { login, signOut } = useAdminSession();
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="hidden sm:inline">@{login}</span>
      <button type="button" className="btn-secondary !py-1.5" onClick={signOut} title="Sign out">
        <LogOut className="size-3.5" aria-hidden /> Sign out
      </button>
    </span>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Bitaqa",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * GitHub Pages cannot send security headers, so the admin sets a CSP with a
 * <meta> tag. The key line is connect-src: the page may only talk to itself
 * and api.github.com, so even injected script could not post the token to
 * another server. Next's static export needs inline scripts and styles.
 * Dev mode (hot reload) needs eval and websockets, so the CSP is build-only.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {process.env.NODE_ENV === "production" && <meta httpEquiv="Content-Security-Policy" content={CSP} />}
      {children}
    </>
  );
}

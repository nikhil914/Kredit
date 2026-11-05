"""Polite HTTP fetcher.

* robots.txt checked for every URL (Protego = Google-style longest-match rules, which
  matters for kredit.ae: it disallows `/*?*` but allows `/credit-cards?page=`).
* One request at a time per host, `min_delay` seconds apart (+ jitter), raised to the
  host's Crawl-delay when it sets one.
* 429/503 back off and honour Retry-After; other 4xx are not retried.
* On-disk cache so re-runs and parser iterations do not re-hit the sites.
* Optional Playwright rendering for pages whose content is client-side only.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import httpx
from protego import Protego

log = logging.getLogger(__name__)

DEFAULT_UA = "UAECardResearchBot/0.1 (+mailto:change-me@example.com)"


def _ssl_context():
    """Verify TLS against the OS trust store (needed behind AV/proxy TLS inspection)."""
    try:
        import ssl

        import truststore
    except ImportError:
        return True
    return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)


class RobotsDisallowed(Exception):
    pass


@dataclass
class FetchResult:
    url: str
    status: int
    text: str
    from_cache: bool = False
    rendered: bool = False


@dataclass
class FetcherConfig:
    user_agent: str = DEFAULT_UA
    min_delay: float = 4.0          # seconds between requests to the same host
    jitter: float = 1.5
    timeout: float = 30.0
    max_retries: int = 3
    cache_dir: Optional[Path] = Path(".cache/html")
    cache_ttl_hours: float = 24.0
    respect_robots: bool = True     # never turn this off for third-party sites
    render_js: bool = False         # use Playwright when static HTML lacks the content
    max_requests_per_host: int = 400


@dataclass
class _HostState:
    robots: Optional[Protego] = None
    robots_status: str = "unknown"
    last_request: float = 0.0
    crawl_delay: Optional[float] = None
    count: int = 0


class PoliteFetcher:
    def __init__(self, config: FetcherConfig | None = None, client: httpx.Client | None = None):
        self.cfg = config or FetcherConfig()
        self.client = client or httpx.Client(
            headers={
                "User-Agent": self.cfg.user_agent,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                "Accept-Language": "en-AE,en;q=0.9",
            },
            timeout=self.cfg.timeout,
            follow_redirects=True,
            verify=_ssl_context(),
        )
        self._hosts: dict[str, _HostState] = {}
        self._browser = None
        self._pw = None
        if self.cfg.cache_dir:
            Path(self.cfg.cache_dir).mkdir(parents=True, exist_ok=True)

    # -- robots ---------------------------------------------------------------

    def _host(self, url: str) -> tuple[str, _HostState]:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        st = self._hosts.setdefault(origin, _HostState())
        if st.robots is None and st.robots_status == "unknown":
            self._load_robots(origin, st)
        return origin, st

    def _load_robots(self, origin: str, st: _HostState) -> None:
        try:
            r = self.client.get(f"{origin}/robots.txt")
            if r.status_code >= 500:
                st.robots_status = "error"  # treat as full disallow (RFC 9309 §2.3.1.4)
                return
            if r.status_code >= 400:
                st.robots_status = "absent"  # 4xx => no restrictions
                return
            st.robots = Protego.parse(r.text)
            st.robots_status = "ok"
            cd = st.robots.crawl_delay(self.cfg.user_agent)
            if cd:
                st.crawl_delay = float(cd)
        except httpx.HTTPError as e:
            log.warning("robots.txt fetch failed for %s: %s", origin, e)
            st.robots_status = "error"

    def allowed(self, url: str) -> bool:
        if not self.cfg.respect_robots:
            return True
        _, st = self._host(url)
        if st.robots_status == "absent":
            return True
        if st.robots_status == "error" or st.robots is None:
            return False
        return st.robots.can_fetch(url, self.cfg.user_agent)

    # -- cache ----------------------------------------------------------------

    def _cache_path(self, url: str, rendered: bool) -> Optional[Path]:
        if not self.cfg.cache_dir:
            return None
        h = hashlib.sha256(f"{url}|{int(rendered)}".encode()).hexdigest()[:32]
        return Path(self.cfg.cache_dir) / f"{h}.json"

    def _cache_get(self, url: str, rendered: bool) -> Optional[FetchResult]:
        p = self._cache_path(url, rendered)
        if not p or not p.exists():
            return None
        data = json.loads(p.read_text())
        if time.time() - data["ts"] > self.cfg.cache_ttl_hours * 3600:
            return None
        return FetchResult(url=data["url"], status=data["status"], text=data["text"],
                           from_cache=True, rendered=rendered)

    def _cache_put(self, res: FetchResult) -> None:
        p = self._cache_path(res.url, res.rendered)
        if p and res.status == 200:
            p.write_text(json.dumps({"url": res.url, "status": res.status, "text": res.text,
                                     "ts": time.time()}))

    # -- throttle -------------------------------------------------------------

    def _wait_turn(self, st: _HostState) -> None:
        delay = max(self.cfg.min_delay, st.crawl_delay or 0)
        delay += random.uniform(0, self.cfg.jitter)
        wait = st.last_request + delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        st.last_request = time.monotonic()

    # -- public ---------------------------------------------------------------

    def get(self, url: str, *, render: Optional[bool] = None) -> FetchResult:
        render = self.cfg.render_js if render is None else render
        cached = self._cache_get(url, render)
        if cached:
            return cached
        if not self.allowed(url):
            raise RobotsDisallowed(url)
        _, st = self._host(url)
        if st.count >= self.cfg.max_requests_per_host:
            raise RuntimeError(f"request budget exhausted for {url}")

        attempt = 0
        while True:
            self._wait_turn(st)
            st.count += 1
            retry_after: Optional[str] = None
            try:
                if render:
                    res = self._render(url)
                else:
                    r = self.client.get(url)
                    retry_after = r.headers.get("Retry-After")
                    res = FetchResult(url=str(r.url), status=r.status_code, text=r.text)
            except httpx.HTTPError as e:
                res = FetchResult(url=url, status=0, text=str(e))

            if res.status in (429, 503) or res.status == 0 or res.status >= 500:
                attempt += 1
                if attempt > self.cfg.max_retries:
                    return res
                backoff = min(120.0, (2 ** attempt) * self.cfg.min_delay)
                if res.status in (429, 503):
                    if retry_after and retry_after.isdigit():
                        backoff = max(backoff, float(retry_after))
                    # The site asked us to slow down: double the per-host delay for the rest of the run.
                    st.crawl_delay = max(st.crawl_delay or 0, self.cfg.min_delay * 2)
                log.info("retry %s in %.0fs (status %s)", url, backoff, res.status)
                time.sleep(backoff)
                continue
            self._cache_put(res)
            return res

    def _render(self, url: str) -> FetchResult:
        if self._browser is None:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError as e:  # pragma: no cover
                raise RuntimeError("pip install 'uae-cards[render]' && playwright install chromium") from e
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch()
        page = self._browser.new_page(user_agent=self.cfg.user_agent)
        try:
            resp = page.goto(url, wait_until="networkidle", timeout=self.cfg.timeout * 1000)
            html = page.content()
            return FetchResult(url=page.url, status=resp.status if resp else 0, text=html, rendered=True)
        finally:
            page.close()

    def close(self) -> None:
        self.client.close()
        if self._browser:
            self._browser.close()
        if self._pw:
            self._pw.stop()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

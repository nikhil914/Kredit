"""Markup-agnostic HTML helpers.

Aggregator markup changes often (and kredit.ae is a JS framework site with hashed class
names), so extraction keys on *visible label text*, not CSS classes:

* `html_to_lines` flattens the visible page into ordered text lines.
* `label_pairs` collects (label, value) pairs from <table>, <dl>, "Label: value" lines
  and label-line/value-line sequences.
* `section_lines` slices the line list between headings.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

from bs4 import BeautifulSoup, NavigableString, Tag

DROP_TAGS = ("script", "style", "noscript", "svg", "template", "iframe", "form", "button")
CHROME_TAGS = ("nav", "footer", "header")


def soupify(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def _norm(s: str) -> str:
    return " ".join(s.split())


def norm_label(s: str) -> str:
    return re.sub(r"[^a-z0-9%()+&/ -]", "", _norm(s).lower()).strip(" :-")


def html_to_lines(html_or_soup, *, drop_chrome: bool = True) -> list[str]:
    soup = html_or_soup if isinstance(html_or_soup, BeautifulSoup) else soupify(html_or_soup)
    soup = BeautifulSoup(str(soup), "lxml")  # work on a copy
    for t in soup(DROP_TAGS):
        t.decompose()
    if drop_chrome:
        for t in soup(CHROME_TAGS):
            t.decompose()
    root = soup.find("main") or soup.body or soup
    text = root.get_text("\n")
    lines = []
    for raw in text.split("\n"):
        line = _norm(raw)
        if line:
            lines.append(line)
    return lines


def page_title(soup: BeautifulSoup) -> Optional[str]:
    h1 = soup.find("h1")
    if h1 and _norm(h1.get_text(" ")):
        return _norm(h1.get_text(" "))
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return _norm(og["content"])
    return _norm(soup.title.get_text()) if soup.title else None


def _cell_text(el: Tag) -> str:
    return _norm(el.get_text(" "))


def label_pairs(soup: BeautifulSoup, lines: list[str], known_labels: Iterable[str]) -> list[tuple[str, str]]:
    """Collect (label, value) pairs. Order: tables, definition lists, inline 'A: B', and
    'label line followed by value line' for labels we know about."""
    pairs: list[tuple[str, str]] = []

    for tr in soup.find_all("tr"):
        cells = tr.find_all(["th", "td"], recursive=False)
        if len(cells) >= 2:
            k, v = _cell_text(cells[0]), " ".join(_cell_text(c) for c in cells[1:])
            if k and v:
                pairs.append((k, v))

    for dl in soup.find_all("dl"):
        for dt in dl.find_all("dt"):
            dd = dt.find_next_sibling("dd")
            if dd:
                pairs.append((_cell_text(dt), _cell_text(dd)))

    for line in lines:
        m = re.match(r"^([A-Za-z][A-Za-z0-9 ()/&+'.-]{2,60}):\s+(.{1,200})$", line)
        if m:
            pairs.append((m.group(1), m.group(2)))

    known = {norm_label(k) for k in known_labels}
    for i, line in enumerate(lines[:-1]):
        if norm_label(line) in known:
            pairs.append((line, lines[i + 1]))
    return pairs


def lookup(pairs: list[tuple[str, str]], aliases: Iterable[str], *, prefix: bool = True) -> Optional[str]:
    """Value for the highest-priority alias: aliases are tried in order (exact normalized
    label match), then, if nothing matched exactly, by label prefix."""
    al = [norm_label(a) for a in aliases]
    norm_pairs = [(norm_label(k), v) for k, v in pairs]
    for a in al:
        for nk, v in norm_pairs:
            if nk == a:
                return v
    if prefix:
        for a in al:
            if len(a) < 6:  # "rate", "golf": too generic for prefix matching
                continue
            for nk, v in norm_pairs:
                if nk.startswith(a):
                    return v
    return None


def section_lines(lines: list[str], heading: str, stop_headings: Iterable[str]) -> list[str]:
    """Lines after the first line equal to `heading` up to the next stop heading."""
    h = norm_label(heading)
    stops = {norm_label(s) for s in stop_headings} - {h}
    out: list[str] = []
    started = False
    for line in lines:
        nl = norm_label(line)
        if not started:
            if nl == h:
                started = True
            continue
        if nl in stops:
            break
        out.append(line)
    return out


def section_lines_all(lines: list[str], heading: str, stop_headings: Iterable[str]) -> list[str]:
    """Like section_lines but concatenates every occurrence of the heading (pages often
    repeat a heading in a summary block and again in the full section)."""
    h = norm_label(heading)
    stops = {norm_label(s) for s in stop_headings} - {h}
    out: list[str] = []
    inside = False
    for line in lines:
        nl = norm_label(line)
        if nl == h:
            inside = True
            continue
        if inside and nl in stops:
            inside = False
            continue
        if inside:
            out.append(line)
    return out


def links(soup: BeautifulSoup, base: str) -> list[tuple[str, str]]:
    from urllib.parse import urljoin

    out = []
    for a in soup.find_all("a", href=True):
        out.append((urljoin(base, a["href"]), _norm(a.get_text(" "))))
    return out


def to_markdown(html: str, *, max_chars: int = 60_000) -> str:
    """Compact markdown-ish rendering for the LLM prompt: headings, list items, table rows."""
    soup = soupify(html)
    for t in soup(DROP_TAGS):
        t.decompose()
    for t in soup(CHROME_TAGS):
        t.decompose()
    root = soup.find("main") or soup.body or soup
    out: list[str] = []

    def walk(node):
        for child in node.children:
            if isinstance(child, NavigableString):
                s = _norm(str(child))
                if s:
                    out.append(s)
                continue
            if not isinstance(child, Tag):
                continue
            name = child.name
            if name in ("h1", "h2", "h3", "h4"):
                out.append("\n" + "#" * int(name[1]) + " " + _cell_text(child) + "\n")
            elif name == "tr":
                cells = [_cell_text(c) for c in child.find_all(["th", "td"], recursive=False)]
                out.append("| " + " | ".join(cells) + " |")
            elif name == "li":
                out.append("- " + _cell_text(child))
            elif name in ("p", "dt", "dd"):
                out.append(_cell_text(child))
            elif name == "br":
                out.append("\n")
            else:
                walk(child)

    walk(root)
    md = "\n".join(out)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md[:max_chars]

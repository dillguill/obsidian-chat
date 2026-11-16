#!/usr/bin/env python3
"""File every open `- [ ]` item in docs/TODO.md as a Gitea issue.

Idempotent: an issue whose title already exists (open or closed) is skipped,
so run it whenever TODO.md gains items.

    GITEA_TOKEN=<token with issue: read and write> python3 scripts/file-todo-issues.py [--dry-run]

Optional env: GITEA_URL (default https://gitea.example), GITEA_REPO
(default dillguill/obsidian-chat), GITEA_CA (CA bundle for Caddy's internal TLS).
The token is read from the environment only; it is never printed or stored.
"""
import json, os, re, ssl, sys, urllib.request

BASE = os.environ.get("GITEA_URL", "https://gitea.example").rstrip("/") + "/api/v1"
REPO = os.environ.get("GITEA_REPO", "dillguill/obsidian-chat")
TOKEN = os.environ.get("GITEA_TOKEN", "")
DRY = "--dry-run" in sys.argv
CTX = ssl.create_default_context(cafile=os.environ.get("GITEA_CA") or None)
TODO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "TODO.md")


def open_items(text):
    """Yield (section, item text) for each unchecked item, continuation lines included."""
    section, item = None, None
    for line in text.splitlines():
        heading = re.match(r"^## (\d+)\. (.+)", line)
        if heading:
            if item:
                yield section, item
            section, item = (heading.group(1), heading.group(2).strip()), None
            continue
        start = re.match(r"^- \[ \] (.+)", line)
        if start:
            if item:
                yield section, item
            item = start.group(1).strip()
        elif item is not None and re.match(r"^\s{2,}\S", line):
            item += " " + line.strip()
        elif item is not None:
            yield section, item
            item = None
    if item:
        yield section, item


def title_for(section, item):
    first = re.split(r"(?<=[.;])\s", item, maxsplit=1)[0].rstrip(".;:")
    first = re.sub(r"\s+", " ", first)
    if len(first) > 90:
        first = first[:87].rstrip() + "…"
    return f"TODO §{section[0]}: {first}" if section else f"TODO: {first}"


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"token {TOKEN}", "Content-Type": "application/json",
                                          "Accept": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=20) as r:
        return json.loads(r.read() or b"null")


def existing_titles():
    titles, page = set(), 1
    while True:
        batch = call("GET", f"/repos/{REPO}/issues?state=all&type=issues&limit=50&page={page}")
        titles |= {i["title"] for i in batch}
        if len(batch) < 50:
            return titles
        page += 1


def main():
    items = list(open_items(open(TODO, encoding="utf-8").read()))
    if not TOKEN and not DRY:
        sys.exit("set GITEA_TOKEN (a token with issue: read and write), or use --dry-run")
    titles = existing_titles() if TOKEN else set()
    for section, item in items:
        title = title_for(section, item)
        if title in titles:
            print(f"skip   {title}")
            continue
        body = f"{item}\n\nFrom `docs/TODO.md` §{section[0]} ({section[1]})." if section else item
        if DRY:
            print(f"would  {title}")
            continue
        issue = call("POST", f"/repos/{REPO}/issues", {"title": title, "body": body})
        print(f"filed  #{issue['number']}: {title}")


if __name__ == "__main__":
    main()

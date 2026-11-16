#!/usr/bin/env python3
"""File the 2026-11 redesign issues in Gitea (obsidian-chat + dsh).

Idempotent: an issue whose title already exists (open or closed) is skipped.

    GITEA_TOKEN=<token with write:issue> python3 scripts/file-redesign-issues.py [--dry-run]

Optional env:
    GITEA_URL   base URL (default: the host of `git remote get-url origin`)
    GITEA_CA    CA bundle for Caddy's internal TLS, if the system store
                doesn't trust it
The token is read from the environment only; it is never printed or stored.
"""
import json, os, ssl, sys, urllib.error, urllib.request

def _origin_base():
    import subprocess, urllib.parse
    try:
        url = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return ""
    u = urllib.parse.urlparse(url)
    return f"{u.scheme}://{u.netloc.split('@')[-1]}" if u.scheme.startswith("http") else ""


BASE = (os.environ.get("GITEA_URL") or _origin_base()).rstrip("/") + "/api/v1"
TOKEN = os.environ.get("GITEA_TOKEN", "")
DRY = "--dry-run" in sys.argv
CTX = ssl.create_default_context(cafile=os.environ.get("GITEA_CA") or None)

DOC = "docs/REDESIGN.md"
OC = "dillguill/obsidian-chat"
DSH = "dsh/dsh"

ISSUES = [
    (OC, "Redesign 1: split settings by device; reload on external change", ["agent-ok"],
     f"""Synced `data.json` keeps shared preferences only. Role (host/remote) and host name go to
`app.saveLocalStorage`; any token goes to `app.secretStorage` (per device, never synced).
Handle `onExternalSettingsChange`; never write keys this device didn't change.

Fixes: devices overwriting each other's bind address / paired devices through iCloud.

Details: `{DOC}` §1."""),
    (OC, "Redesign 2: start the host listener on plugin load", ["agent-ok"],
     f"""On the host device, start the listener at `onLayoutReady` instead of when the chat view
connects. The harness still spawns lazily.

Fixes: remote devices get connection refused until the chat pane is opened on the Mac.

Details: `{DOC}` §2."""),
    (OC, "Redesign 3: loopback listener behind Tailscale Serve; drop bind/port and device codes", ["both"],
     f"""- Listener binds loopback only; remove bind address, port and wider-bind settings.
- `tailscale serve` on the Mac publishes it by tailnet name; remotes store the name, never an IP.
- Authenticate with Serve identity headers (`Tailscale-User-Login`) instead of paired-device codes.
- Remove the pairing UI; rotate/retire the existing device codes.

`[you]`: enable Serve on the Mac. `[claude]`: plugin side.

Details: `{DOC}` §3."""),
    (OC, "Redesign 4: remote liveness check and reconnect on resume/online", ["agent-ok"],
     f"""- Client-side application ping so a dead socket is detected.
- Reconnect on `visibilitychange`/resume and `online`.
- No permanent give-up after 8 attempts: back off to a ceiling, keep trying while visible.
- Show "reconnecting", never "connected", for a dead link.

Details: `{DOC}` §4."""),
    (OC, "Redesign 5: move conversation records out of the vault", ["agent-ok"],
     f"""Store records in the host's app-data folder, derived from the OS home directory:
`~/Library/Application Support/obsidian-chat/sessions/` (macOS),
`$XDG_DATA_HOME/obsidian-chat/sessions` (Linux). Host-local override allowed; nothing in synced config.

- Only the host reads/writes it; remotes keep using `session/list` / `session/load`.
- One-time, idempotent move of `.chat/sessions/` (+ `registry.json`); originals kept until confirmed.
- Backed up by Time Machine; optional NAS copy later.
- Update README, ARCHITECTURE.md and the History/diagnostics text.

Why: appends inside the iCloud vault re-upload growing JSONL on every streamed update.

Details: `{DOC}` §5."""),
    (OC, "Redesign 6: approved write tools in the vault tool server", ["agent-ok"],
     f"""Add write tools (create/modify/append/rename) to the vault MCP server. Every write goes
through an approval card and VaultService (blacklist, `.obsidian/` protection, editor refresh, undo).

Then dsh's own fs tools are turned off in the `obsidian` profile (dsh/dsh, plan 08), so the plugin
is the only path into the vault. Order matters: this lands first.

Details: `{DOC}` §6."""),
    (OC, "Redesign 7: harness setting accepts a command or a ws(s):// URL", ["agent-ok"],
     f"""One field. `ws://`/`wss://` connects with the existing remote WebSocket transport;
anything else is spawned. Examples: `~/bin/dsh-acp`, `opencode acp`,
`npx @zed-industries/claude-code-acp`, `wss://harness.example/acp`.

Details: `{DOC}` §7."""),
    (OC, "Redesign 8: wait ~10 s before SIGKILL when stopping the harness", ["agent-ok"],
     f"""`LocalTransport.close()` SIGKILLs 2 s after SIGTERM, too soon for `dsh-acp` to revoke its
Agent Vault session. Wait ~10 s (configurable). dsh side: dsh/dsh plan 08.

Details: `{DOC}` §8."""),
    (DSH, "dsh-acp: don't SIGHUP the supervisor when the proxy is healthy", [],
     """`cmd_acp` → `ensure_proxy` → `ensure_job` SIGHUPs the supervisor job on every Obsidian
harness start; reconcile can `container rm -f` the proxy under live sessions. Skip `ensure_job`
when the proxy and relays answer; otherwise start once; on failure one clear error, exit 1.

Plan: `plans/08-obsidian-acp.md` §1."""),
    (DSH, "dsh-acp: revoke the Agent Vault session within ~8 s of SIGTERM", [],
     """The plugin SIGKILLs 2 s after SIGTERM (raising to ~10 s), so the revoke never finishes and
sessions live to the 7-day backstop. Forward SIGTERM, then revoke with a short timeout.

Plan: `plans/08-obsidian-acp.md` §2."""),
    (DSH, "down --all: keep proxy and relays while an Obsidian ACP session is alive", [],
     """Quitting DeepSeek.app removes the proxy under a running Obsidian harness. Track live ACP
sessions (pid files under `run/acp/`) and keep the proxy + relays while any is alive.

Plan: `plans/08-obsidian-acp.md` §3."""),
    (DSH, "Move machine-specific addresses out of dsh.toml", [],
     """NAS relay targets and the DNS address are IPs in tracked config. Move them to a gitignored
`dsh.local.toml` (or names resolved at start); `dsh.toml` keeps defaults and names.

Plan: `plans/08-obsidian-acp.md` §4."""),
    (DSH, "Obsidian profile: disable dsh fs tools after the plugin's write tools land", [],
     """Once obsidian-chat "Redesign 6" ships, disable dsh's filesystem tools in
`vault-data/profiles/obsidian/cordis.patch.yml` so the plugin's tools are the only vault path.
Blocked by obsidian-chat Redesign 6.

Plan: `plans/08-obsidian-acp.md` §5."""),
]


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"token {TOKEN}",
                                          "Content-Type": "application/json",
                                          "Accept": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=20) as r:
        return json.loads(r.read() or b"null")


def existing_titles(repo):
    titles, page = set(), 1
    while True:
        batch = call("GET", f"/repos/{repo}/issues?state=all&type=issues&limit=50&page={page}")
        titles |= {i["title"] for i in batch}
        if len(batch) < 50:
            return titles
        page += 1


def label_ids(repo):
    try:
        return {l["name"]: l["id"] for l in call("GET", f"/repos/{repo}/labels?limit=100")}
    except urllib.error.HTTPError:
        return {}


def main():
    if not TOKEN:
        sys.exit("set GITEA_TOKEN (a token with write:issue)")
    cache = {}
    for repo, title, labels, body in ISSUES:
        if repo not in cache:
            cache[repo] = (existing_titles(repo), label_ids(repo))
        titles, ids = cache[repo]
        if title in titles:
            print(f"skip   {repo}: {title}")
            continue
        payload = {"title": title, "body": body,
                   "labels": [ids[l] for l in labels if l in ids]}
        if DRY:
            print(f"would  {repo}: {title}")
            continue
        issue = call("POST", f"/repos/{repo}/issues", payload)
        print(f"filed  {repo}#{issue['number']}: {title}")


if __name__ == "__main__":
    main()

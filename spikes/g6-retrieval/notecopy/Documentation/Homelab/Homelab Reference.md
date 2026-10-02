# Homelab

Operational reference for `Dillons-Mac-mini` (`ssh macmini`, Tailscale `device-01.example.ts.net`).

**Private.** The public `homelab` repo README is a portfolio piece with deliberately obfuscated details. Nothing here belongs there.

## Docker services

`docker` lives at `/usr/local/bin/docker` — not on the default SSH `PATH`.

**All Docker stacks are managed via Portainer** (`https://portainer.example`, or `device-01.example.ts.net:9443` over Tailscale). Stacks were created in Portainer's web editor from the compose previously living in `/Volumes/External/Docker/<service>/`; the folder copies are now stale records. Data lives in the original bind mounts and named volumes — Portainer only stores the stack definitions. API access: personal access token on the Lenovo at `~/.config/portainer/token`, sent as `X-API-Key` header.

| Service | Containers | Host port | Notes |
|---|---|---|---|
| immich-app | `immich_server`, `immich_machine_learning`, `immich_postgres`, `immich_redis` | 12283 | env via `stack.env`; pg/valkey sha-pinned upstream |
| karakeep | `karakeep-web-1`, `karakeep-meilisearch-1`, `karakeep-chrome-1` | 14001 | env via `stack.env` |
| gitea | `gitea`, `gitea-runner` | 14000, 222 | compose `.yaml`; runner kept for career-ops/comfyui scheduled syncs |
| homepage | `homepage` | 13000 | config in `homepage/config/*.yaml` |
| whisper | `whisper` | 18080 | built locally from `Dockerfile` |
| syncthing | `syncthing` | 8384, 22000 | |
| openwebui | `open-webui`, `kokoro-fastapi` | — | both **stopped** (OOMs on start; kept down) |
| portainer | `portainer` | 19000 | Docker Desktop extension; the manager |
| vane | `vane` | 13002 | **stopped**; compose reconstructed from `docker inspect` |

## Not in Docker

| Thing | Location |
|---|---|
| Caddy | `/opt/homebrew/etc/Caddyfile` — root LaunchDaemon; admin API **loopback only** (unauthenticated) |
| ComfyUI | `/Volumes/External/diffusion/ComfyUI/` |
| Draw Things | `/Volumes/External/diffusion/Draw Things/` (native app) |
| gallery-dl | `/Users/you/.config/gallery-dl/` |
| Jellyfin | `~/Library/Application Support/jellyfin` (native app) |
| Stash | native app; `/Volumes/External/Stash` is media |

## Updating

Nothing auto-deploys and nothing auto-detects — updates are fully manual in Portainer.

To update a service: open Portainer → the stack → edit the compose (bump the image tag) → deploy. For undo, the **Version dropdown** in the stack editor restores a previous compose file; redeploy to apply it. (`docker compose` equivalent is `docker compose pull && docker compose up -d` from the stack's folder if you ever operate outside Portainer.)

| What | How |
|---|---|
| Service images | manually bump tag in Portainer stack editor → deploy |
| career-ops | sync PR when upstream moves, 05:00 → merge in Gitea |
| ComfyUI | sync PR when upstream moves, 06:00 → **review-only** — running install is not yet connected |
| Mirrors (32) | Gitea re-fetches every 8h | nothing; update GitHub instead |
| Config repos | none | edit in place, commit, push |

Formerly automated bits that are now removed:
- **Renovate** (nightly image-bump PRs) — cron deleted 2026-08-12; was failing ENOSPC.
- **Gitea Actions deploy workflows** (`.gitea/workflows/deploy.yml` + the runner config's `container.options` stack mount) — removed 2026-08-12; deploys are Portainer-only now.
- The `Makefile`s in the service folders (removed earlier); `make` is no longer the update path.

**Future option (not implemented):** Portainer **git-stacks + webhook** — point stacks at the Gitea repos and wire a push webhook so `git push` triggers a Portainer redeploy. Chosen against for now (git isn't a priority for the stacks; web-editor + Version dropdown covers the need).

## Image version policy

Tags are **pinned to specific versions**, never `latest` — a floating tag never changes name, so nothing can detect it moved.

Deliberate exceptions:
- **Immich's `postgres`/`valkey`** are sha256-pinned by Immich upstream
- **Whisper** is built locally from its `Dockerfile`

(**Kavita** was removed 2026-08-12 — it was deprecated and only confused agents scanning running containers. Its folder/data remains at `/Volumes/External/Docker/kavita`.)

(The `renovate.json` files still exist in the service repos but no longer run anything.)

Tag conventions vary — Gitea `1.27.1`, Immich `v3.0.3`, Syncthing/Karakeep no `v` prefix. Verify with `docker manifest inspect` before hand-editing a tag.

## Backups

| Repo | Root |
|---|---|
| `docker-services` | `/Volumes/External/Docker/` — docs only; compose files live in per-service repos |
| `caddy-config` | `/opt/homebrew/etc/` |
| `comfyui-config` | `/Volumes/External/diffusion/ComfyUI/` — `user/` layer + local patches |
| `gallery-dl-config` | `/Users/you/.config/gallery-dl/` |
| `vane` | `/Volumes/External/Docker/vane/` |
| `drawthings-config` | `~/Library/Containers/com.liuliu.draw-things/Data/Documents/` |
| `stash-config` | `~/.stash/` |
| `comfyui` | fork of `comfyanonymous/ComfyUI`; sync PRs via Gitea Actions |

`.gitignore` is deny-by-default (`*` then `!/`-anchored allowlist). **A new file is not tracked until you add it to `.gitignore`.**

32 GitHub repos are pull-mirrored into Gitea; `~/.config/gitea-mirror/sync.py` (cron 04:00) discovers new ones. `career-ops` is in its `PROTECTED` set and must stay there.

See [[Runbook]] for recovery procedures.

## AI image tooling

`/Volumes/External/diffusion/` holds ComfyUI, Draw Things, `lora-training`, `templates`
and a shared `models/` store (~290GB: checkpoints 115G, text_encoders 85G, lora 76G).

ComfyUI symlinks 13 directories into that store rather than holding models itself, so
models survive a reinstall. The full map, with recreate commands, is in
`comfyui-config/local-patches/SYMLINKS.md` - reinstalling ComfyUI does **not** restore
those symlinks.

**2026-07-28:** stable-diffusion-webui, forge and kohya_ss were removed (unused for ~a
year; ComfyUI and Draw Things are the only consumers now). SeedVR2, an 8.9GB SD2.1
ControlNet checkpoint and a duplicate upscaler were also cleared. `controlnet`,
`diffusers` and `embeddings` were orphaned by the removal and are now symlinked into
ComfyUI. Path was also normalised: `Diffusion/Models` -> `diffusion/models`, with every
symlink repointed rather than relying on the case-insensitive volume.

The ComfyUI fork lives in the `comfyui` Gitea repo; upstream changes arrive as PRs.
Merging one updates the repo, **not** the running install at
`/Volumes/External/diffusion/ComfyUI` - those are not yet connected.


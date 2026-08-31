---
name: Post-merge pnpm lockfile
description: Why frozen post-merge installs can fail after workspace packageExtensions changes
---

The post-merge dependency install must use a lockfile generated with the current pnpm workspace configuration, including the packageExtensions checksum and injected extension dependencies.

**Why:** `pnpm install --frozen-lockfile` fails before migrations when `pnpm-workspace.yaml` has packageExtensions that are absent or stale in `pnpm-lock.yaml`; post-merge setup receives closed stdin and cannot repair this interactively.

**How to apply:** When packageExtensions change, regenerate and commit the lockfile metadata with the repository’s pnpm version before relying on the frozen `scripts/post-merge.sh` install. Keep the setup script non-interactive and idempotent.
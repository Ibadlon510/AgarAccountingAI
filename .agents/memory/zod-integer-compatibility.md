---
name: Generated Zod integer compatibility
description: Compatibility constraint between the OpenAPI generator and the workspace's Zod version.
---

Use OpenAPI `number` types instead of `integer` types, and compatible string patterns instead of URI formats, until the workspace's Zod dependency supports the generator's newer `zod.int()` and `zod.url()` output.

**Why:** The current generator emits `zod.int()` for OpenAPI integers and `zod.url()` for URI strings, but the installed Zod runtime exposes neither API, causing generated shared libraries and runtime imports to fail.

**How to apply:** Model numeric identifiers/counts as `number` and enforce integer semantics in route logic. For HTTPS-only URLs, use a string pattern plus full server-side URL validation. Revisit after the shared Zod package changes.
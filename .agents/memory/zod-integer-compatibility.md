---
name: Generated Zod integer compatibility
description: Compatibility constraint between the OpenAPI generator and the workspace's Zod version.
---

Use OpenAPI `number` types instead of `integer` types in generated API contracts until the workspace's Zod dependency is upgraded to a version that supports the generator's `zod.int()` output.

**Why:** The current generator emits `zod.int()` for OpenAPI integers, but the installed Zod runtime does not expose that API, causing the shared library typecheck to fail after code generation.

**How to apply:** When adding numeric identifiers or counts to `lib/api-spec/openapi.yaml`, model them as `number` and enforce integer semantics in route logic if needed. Revisit this rule if the shared Zod package changes.
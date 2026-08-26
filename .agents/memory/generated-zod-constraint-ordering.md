---
name: Generated Zod constraint ordering
description: Orval can emit shared scalar constraint constants after schemas that reference them.
---

When the same constrained shape is reused across CRUD and import operations, generated Zod output can reference min/max or exclusive-min constants before those constants are initialized. Avoid those redundant OpenAPI scalar constraints for the affected shape and keep the equivalent validation in the server normalization boundary.

**Why:** The generated TypeScript typechecked successfully but threw a temporal-dead-zone `ReferenceError` when imported in a clean validation process, causing every API test to fail before routes loaded.

**How to apply:** After codegen for reused constrained request/response shapes, import `@workspace/api-zod` in a fresh process before relying on typecheck results. If declaration ordering fails, remove only the triggering constraints and verify equivalent server validation remains explicit.
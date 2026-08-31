---
name: Stale generated declarations
description: Shared-library declaration output can remain stale after generated source changes or merges.
---

When generated source types contain fields that downstream TypeScript cannot see, inspect the library's emitted declaration output and force a project rebuild before changing application code.

**Why:** Composite TypeScript projects can consider declaration output current based on build metadata even when a merge leaves the generated source and emitted declarations out of sync, producing misleading missing-property errors.

**How to apply:** Run a forced workspace build, then rerun the dependent package typecheck; only adjust source or generated schemas if the error remains.
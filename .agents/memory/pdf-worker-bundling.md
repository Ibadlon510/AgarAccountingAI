---
name: PDF worker bundling
description: pdf-parse needs its worker emitted beside the bundled API server.
---

When the API server is bundled with esbuild, the pdf-parse worker must be copied into the runtime output directory beside the main bundle.

**Why:** pdf-parse dynamically imports its worker relative to the bundled server. Without the worker, PDF imports fail with a fake-worker module resolution error even though CSV and Excel imports work.

**How to apply:** Preserve the build step that copies `pdf.worker.mjs` after rebuilding the API bundle whenever changing the server bundler or the pdf-parse dependency.
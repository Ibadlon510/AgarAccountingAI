---
name: Web React type resolution
description: Prevent React 18 mobile declarations from leaking into React 19 web typechecks in the shared pnpm workspace.
---

React 19 web projects in this workspace must explicitly resolve `react`, `react/jsx-runtime`, and `react/jsx-dev-runtime` to their own installed React 19 declarations when strict typechecking third-party UI packages.

**Why:** The workspace also contains a React 18 mobile app. pnpm can hoist its React 18 declarations as the fallback for packages whose runtime React package has no bundled declaration files, producing incompatible React node, context, and portal types inside an otherwise React 19 web project.

**How to apply:** When a React 19 web typecheck reports types from the hoisted React 18 declaration path, add project-local TypeScript path mappings for all three React type entry points instead of casting individual components or changing the mobile app's React version.
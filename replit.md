# AgarAccounting AI System

AgarAccounting AI System is an AI-assisted bookkeeping workspace that takes multi-currency bank activity through journal-entry review to core financial statements.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec, then rebuild library declarations
- `pnpm --filter @workspace/api-server run typecheck` — rebuild library declarations, then typecheck the API server and its tests
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string; Clerk keys are provisioned as environment secrets.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Authentication: Replit-managed Clerk with cookie-based web sessions and local-user JIT provisioning

## Where things live

- `lib/api-spec/openapi.yaml` — API contract and generated client source.
- `lib/db/src/schema/` — PostgreSQL schema for statement lines and journal entries.
- `artifacts/api-server/src/routes/ledgerflow.ts` — workflow API, seeded demo data, and report outputs.
- `artifacts/ledgerflow/src/App.tsx` — AgarAccounting AI System user interface and route shell.
- `artifacts/ledgerflow/src/index.css` — product theme and visual tokens.

## Architecture decisions

- Every suggested entry remains linked to its statement line and needs explicit approval before it is treated as posted.
- The first release uses a small seed dataset so the complete close workflow is visible on first launch.
- Financial reports are read-only workflow outputs; source correction happens at statement-line and journal-entry stages.

## Product

- Review bank statement lines by currency, create manual lines, and track AI account suggestions with confidence.
- Review and approve double-entry journal suggestions.
- Inspect a trial balance, income statement, balance sheet, and indirect cash-flow statement for the selected period.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- AgarAccounting AI System keeps compatibility-sensitive technical identifiers such as `/api/ledgerflow`, `@workspace/ledgerflow`, and `LEDGERFLOW_*`; do not rename them for cosmetic reasons.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

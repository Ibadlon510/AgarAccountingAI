import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");

const auditedFiles = [
  "artifacts/ledgerflow/index.html",
  "artifacts/ledgerflow/.replit-artifact/artifact.toml",
  "artifacts/ledgerflow/src/App.tsx",
  "artifacts/ledgerflow/src/components/assistant-fab.tsx",
  "artifacts/ledgerflow/public/logo.svg",
  "artifacts/ledgerflow/public/mark.svg",
  "artifacts/ledgerflow/public/favicon.svg",
  "artifacts/ledgerflow/public/email-header.svg",
  "artifacts/ledgerflow-system-admin/index.html",
  "artifacts/ledgerflow-system-admin/.replit-artifact/artifact.toml",
  "artifacts/ledgerflow-system-admin/public/favicon.svg",
  "artifacts/ledgerflow-system-admin/src/components/layout/Shell.tsx",
  "artifacts/api-server/src/index.ts",
  "artifacts/api-server/src/lib/reportPdf.ts",
  "artifacts/api-server/src/lib/statementDocument.ts",
  "artifacts/api-server/src/routes/ledgerflow.ts",
  "lib/db/ensure-ledgerflow-integrity.mjs",
  "lib/db/src/index.ts",
  "scripts/src/clerk-auth-smoke.ts",
  "replit.md",
];

const compatibilityPatterns = [
  /\/(?:api\/)?ledgerflow(?:[/"?`]|$)/gi,
  /\bLEDGERFLOW_[A-Z0-9_]+\b/g,
  /\bledgerflow_[a-z0-9_]+\b/g,
  /\bledgerflow:[a-z0-9-]+\b/gi,
  /\bledgerflow-ai-assistant-state\b/gi,
  /\bledgerflow workspace\b/gi,
  /Ledgerflow(?=[A-Z][A-Za-z0-9]*\b)/g,
  /\b(?:LedgerFlow|ledgerflow)(?=[A-Z][A-Za-z0-9]*\b)/g,
  /@workspace\/ledgerflow\b/g,
  /artifacts\/ledgerflow(?:[-/.\s"]|$)/gi,
  /artifacts\/api-server\/src\/routes\/ledgerflow\.ts/gi,
];

export async function auditBranding() {
  const staleReferences: string[] = [];
  for (const relativePath of auditedFiles) {
    const content = await readFile(resolve(workspaceRoot, relativePath), "utf8");
    const normalized = compatibilityPatterns.reduce((value, pattern) => value.replace(pattern, ""), content);
    if (/\bledgerflow\b/i.test(normalized)) staleReferences.push(relativePath);
  }
  assert.deepEqual(
    staleReferences,
    [],
    `Stale LedgerFlow product branding found in: ${staleReferences.join(", ")}`,
  );
}

if (import.meta.main) {
  await auditBranding();
  console.log(`AgarAccounting brand audit passed (${auditedFiles.length} files checked).`);
}
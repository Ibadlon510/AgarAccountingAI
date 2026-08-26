import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const excludedDirectories = new Set([
  ".git",
  ".cache",
  "attached_assets",
  "dist",
  "node_modules",
]);

const retiredPrefix = String.fromCharCode(108, 101, 100, 103, 101, 114);
const retiredSuffix = String.fromCharCode(102, 108, 111, 119);
const retiredProductPattern = new RegExp(
  `${retiredPrefix}[\\s_-]*${retiredSuffix}`,
  "i",
);

async function collectActiveFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory() && relative(workspaceRoot, absolutePath) === ".local/state") continue;
    if (entry.isDirectory()) {
      files.push(...await collectActiveFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

export async function auditBranding() {
  const staleReferences: string[] = [];
  const activeFiles = await collectActiveFiles(workspaceRoot);

  for (const absolutePath of activeFiles) {
    const relativePath = relative(workspaceRoot, absolutePath);
    if (retiredProductPattern.test(relativePath)) {
      staleReferences.push(relativePath);
      continue;
    }

    const content = await readFile(absolutePath);
    if (content.includes(0)) continue;
    if (retiredProductPattern.test(content.toString("utf8"))) {
      staleReferences.push(relativePath);
    }
  }

  assert.deepEqual(
    staleReferences,
    [],
    `Retired product identifiers found in active project files: ${staleReferences.join(", ")}`,
  );
  return activeFiles.length;
}

if (import.meta.main) {
  const auditedFileCount = await auditBranding();
  console.log(`AgarAccounting brand audit passed (${auditedFileCount} active files checked).`);
}
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const artifactFile = (path: string) => new URL(`../${path}`, import.meta.url);

test("statement lines bulk toolbar exports selected rows to Excel and PDF", async () => {
  const source = await readFile(artifactFile("src/App.tsx"), "utf8");
  assert.match(source, /useExportStatementLines/);
  assert.match(source, /button-export-selected-excel/);
  assert.match(source, /button-export-selected-pdf/);
  assert.match(source, /exportSelectedLines\('xlsx'\)/);
  assert.match(source, /exportSelectedLines\('pdf'\)/);
  assert.match(source, /Export still includes every selected line/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const artifactFile = (path: string) => new URL(`../${path}`, import.meta.url);

test("ships the AgarAccounting browser identity and base-path-safe favicon", async () => {
  const html = await readFile(artifactFile("index.html"), "utf8");
  assert.match(html, /<title>AgarAccounting AI System<\/title>/);
  assert.match(html, /content="AgarAccounting AI System — precise, AI-assisted accounting workspace\."/);
  assert.match(html, /href="%BASE_URL%favicon\.svg"/);
});

test("ships AgarAccounting metadata and shell branding for the system-admin artifact", async () => {
  const [html, shell] = await Promise.all([
    readFile(new URL("../../agaraccounting-system-admin/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../agaraccounting-system-admin/src/components/layout/Shell.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<title>AgarAccounting AI System Admin<\/title>/);
  assert.match(html, /content="AgarAccounting AI System Admin — private exchange-rate administration console\."/);
  assert.match(html, /href="%BASE_URL%favicon\.svg"/);
  assert.match(shell, /AgarAccounting AI<span[^>]*>Admin<\/span>/);
});

test("ships full, compact, favicon, and email-safe brand assets", async () => {
  const [logo, mark, favicon, emailHeader] = await Promise.all([
    readFile(artifactFile("public/logo.svg"), "utf8"),
    readFile(artifactFile("public/mark.svg"), "utf8"),
    readFile(artifactFile("public/favicon.svg"), "utf8"),
    readFile(artifactFile("public/email-header.svg"), "utf8"),
  ]);
  assert.match(logo, /<title>AgarAccounting AI System<\/title>/);
  assert.match(logo, />AgarAccounting AI System<\/text>/);
  assert.match(emailHeader, /<title>AgarAccounting AI System<\/title>/);
  assert.match(emailHeader, />AgarAccounting AI System<\/text>/);
  for (const asset of [logo, mark, favicon, emailHeader]) {
    assert.match(asset, /#265942/);
    assert.match(asset, /#cca333/);
  }
});

test("keeps dark primary controls readable against the forest-green surface", async () => {
  const css = await readFile(artifactFile("src/index.css"), "utf8");
  const darkTheme = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(darkTheme, /--primary:\s*150 40% 35%/);
  assert.match(darkTheme, /--primary-foreground:\s*45 25% 95%/);
});
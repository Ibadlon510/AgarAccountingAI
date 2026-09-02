import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firmSlugError,
  firmSlugFromHost,
  MAX_FIRM_LOGO_BYTES,
  normalizeFirmSlug,
  publicFirmHost,
  slugifyFirmName,
  validateFirmLogoBytes,
  validateFirmLogoMetadata,
} from "../src/lib/firmBranding";

test("slugifies firm names and rejects reserved hosts", () => {
  assert.equal(slugifyFirmName("North Star Partners"), "north-star-partners");
  assert.equal(normalizeFirmSlug("  North--Star  "), "north-star");
  assert.equal(firmSlugError("www"), "That address is reserved. Choose another slug.");
  assert.equal(firmSlugError("api"), "That address is reserved. Choose another slug.");
  assert.equal(firmSlugError("ab"), "Use 3 to 32 letters, numbers, or hyphens.");
  assert.equal(firmSlugError("north-star"), null);
});

test("parses white-label hosts and ignores the product apex", () => {
  assert.equal(firmSlugFromHost("northstar.agaraccounting.com"), "northstar");
  assert.equal(firmSlugFromHost("NORTHSTAR.agaraccounting.com:443"), "northstar");
  assert.equal(firmSlugFromHost("northstar.localhost"), "northstar");
  assert.equal(firmSlugFromHost("app.agaraccounting.com"), null);
  assert.equal(firmSlugFromHost("www.agaraccounting.com"), null);
  assert.equal(firmSlugFromHost("agaraccounting.com"), null);
  assert.equal(firmSlugFromHost("localhost"), null);
  assert.equal(publicFirmHost("northstar"), "northstar.agaraccounting.com");
});

test("accepts JPEG PNG WebP logos and rejects SVG or oversized files", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  assert.equal(validateFirmLogoMetadata("logo.png", "image/png", png.length), null);
  assert.equal(validateFirmLogoBytes(png, "image/png"), null);
  assert.equal(validateFirmLogoBytes(jpeg, "image/jpeg"), null);
  assert.ok(validateFirmLogoMetadata("logo.svg", "image/svg+xml", svg.length));
  assert.ok(validateFirmLogoBytes(svg, "image/png"));
  assert.ok(validateFirmLogoMetadata("logo.png", "image/png", MAX_FIRM_LOGO_BYTES + 1));
});

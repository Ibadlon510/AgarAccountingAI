import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFeedbackObjectPath,
  normalizeFeedbackObjectPath,
  validateFeedbackImageBytes,
  validateFeedbackImageContent,
  validateFeedbackImageMetadata,
} from "../src/lib/feedbackImage";

test("accepts supported feedback image metadata and rejects unsafe files", () => {
  assert.equal(validateFeedbackImageMetadata("shot.png", "image/png", 1024), null);
  assert.match(validateFeedbackImageMetadata("notes.pdf", "application/pdf", 1024) ?? "", /MIME|JPEG|PNG/i);
  assert.match(validateFeedbackImageMetadata("shot.png", "image/png", 6 * 1024 * 1024) ?? "", /5 MB/);
  assert.match(validateFeedbackImageMetadata("shot.png", "image/jpeg", 1024) ?? "", /extension/);
  assert.equal(validateFeedbackImageContent("image/webp", 2048), null);
});

test("normalizes and validates feedback object paths", () => {
  assert.equal(normalizeFeedbackObjectPath("feedback/user-1/abc"), "/objects/feedback/user-1/abc");
  assert.equal(isFeedbackObjectPath("/objects/feedback/user-1/abc"), true);
  assert.equal(isFeedbackObjectPath("/objects/feedback/user-1/abc", "user-1"), true);
  assert.equal(isFeedbackObjectPath("/objects/feedback/user-2/abc", "user-1"), false);
  assert.equal(isFeedbackObjectPath("/objects/uploads/user-1/abc"), false);
  assert.equal(isFeedbackObjectPath("/objects/feedback/../secret"), false);
});

test("rejects image MIME spoofing by checking file signatures", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  assert.equal(validateFeedbackImageBytes(png, "image/png"), null);
  assert.match(
    validateFeedbackImageBytes(Buffer.from("<script>alert(1)</script>"), "image/png") ?? "",
    /does not match/i,
  );
  assert.match(validateFeedbackImageBytes(png, "image/jpeg") ?? "", /does not match/i);
});

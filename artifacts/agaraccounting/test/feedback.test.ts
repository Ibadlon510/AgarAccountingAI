import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const artifactFile = (path: string) => new URL(`../${path}`, import.meta.url);

test("registers a public /feedback route outside the auth catch-all", async () => {
  const app = await readFile(artifactFile("src/App.tsx"), "utf8");
  assert.match(app, /path="\/feedback"/);
  assert.match(app, /PublicFeedbackEntry/);
  assert.match(app, /<Route path="\/sign-in\/\*\?" component=\{SignInPage\} \/>[\s\S]*<Route path="\/feedback">[\s\S]*<Route component=\{AuthBoundary\} \/>/);
  assert.match(app, /link-feedback-account-menu/);
  assert.match(app, /Feedback & reviews/);
  assert.match(app, /link-feedback-access-screen/);
  assert.match(app, /See what others are saying/);
  assert.match(app, /forceRedirectUrl=\{redirectTarget\}/);
  assert.match(app, /safePostAuthRedirect/);
  assert.match(app, /redirect_url/);
});

test("assistant send-feedback action carries only a non-sensitive source marker", async () => {
  const fab = await readFile(artifactFile("src/components/assistant-fab.tsx"), "utf8");
  assert.match(fab, /Send feedback/);
  assert.match(fab, /href="\/feedback\?from=assistant"/);
  assert.match(fab, /data-testid="link-assistant-send-feedback"/);
  assert.doesNotMatch(fab, /href=\{`\/feedback\?from=assistant&[\s\S]*\$\{/);
  assert.doesNotMatch(fab, /\/feedback\?from=assistant.*displayTurns/);
  assert.doesNotMatch(fab, /\/feedback\?from=assistant.*activeThreadId/);
  assert.doesNotMatch(fab, /\/feedback\?from=assistant.*chatMutation/);
});

test("feedback page shows assistant entry hint without prefilling private content", async () => {
  const page = await readFile(artifactFile("src/pages/feedback.tsx"), "utf8");
  assert.match(page, /get\("from"\) === "assistant"/);
  assert.match(page, /Opened from AI assistant/);
  assert.doesNotMatch(page, /prefill|chatHistory|conversationText|assistantTurns/i);
});

test("feedback UX covers sign-in return, optimistic reactions, and image guardrails", async () => {
  const page = await readFile(artifactFile("src/pages/feedback.tsx"), "utf8");
  assert.match(page, /feedback-signin-prompt/);
  assert.match(page, /Continue to sign in/);
  assert.match(page, /applyOptimisticReaction/);
  assert.match(page, /validateLocalImage/);
  assert.match(page, /onDrop/);
  assert.match(page, /setReplyCount\(\(count\) => count \+ 1\)/);
  assert.match(page, /feedback-composer-success/);
});

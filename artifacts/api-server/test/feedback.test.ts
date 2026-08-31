import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { inArray, like } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
const userIds = [
  `feedback-author-${randomUUID()}`,
  `feedback-replier-${randomUUID()}`,
];
const postIds: number[] = [];

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for AgarAccounting AI System integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The AgarAccounting AI System integration test database name must contain 'test'.");
  }
  return value;
}

async function request<T>(path: string, init?: RequestInit & { userId?: string | null }) {
  const { userId, ...rest } = init ?? {};
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(rest.headers as Record<string, string> | undefined),
  };
  if (userId) headers["x-test-user-id"] = userId;
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers,
  });
  const text = await response.text();
  let body: T | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = text as T;
    }
  }
  return { response, body };
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.LOCAL_OBJECT_STORAGE = "1";
  const { createApp } = await import("../src/app");
  const { createOptionalAuth, createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  const readAuth = (req: { headers: Record<string, unknown> }) => ({
    sessionClaims: { userId: req.headers["x-test-user-id"] },
  });
  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth(readAuth as never),
    optionalAuthMiddleware: createOptionalAuth(readAuth as never),
  });
  for (const id of userIds) {
    await database.db.insert(database.usersTable).values({
      id,
      email: `${id}@example.test`,
      firstName: id.startsWith("feedback-author") ? "Ada" : "Ben",
      lastName: id.startsWith("feedback-author") ? "Author" : "Replier",
    }).onConflictDoNothing();
  }
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;
});

after(async () => {
  try {
    if (database) {
      await database.db.delete(database.feedbackReactionsTable).where(
        inArray(database.feedbackReactionsTable.userId, userIds),
      );
      if (postIds.length) {
        await database.db.delete(database.feedbackRepliesTable).where(
          inArray(database.feedbackRepliesTable.postId, postIds),
        );
        await database.db.delete(database.feedbackPostLinksTable).where(
          inArray(database.feedbackPostLinksTable.postId, postIds),
        );
        await database.db.delete(database.feedbackPostsTable).where(
          inArray(database.feedbackPostsTable.id, postIds),
        );
      }
      await database.db.delete(database.feedbackPostsTable).where(
        like(database.feedbackPostsTable.body, "feedback-test-%"),
      );
      // Authentication provisioning also creates each user's starter workspace.
      // Leave those isolated test identities for the disposable CI database
      // rather than coupling feedback teardown to unrelated workspace tables.
    }
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

test("anonymous visitors can read the feedback feed and detail", async () => {
  const created = await request<{ id: number; author: { displayName: string; email?: string } }>(
    "/feedback/posts",
    {
      method: "POST",
      userId: userIds[0],
      body: JSON.stringify({ body: "feedback-test-public-read" }),
    },
  );
  assert.equal(created.response.status, 201);
  assert.ok(created.body);
  postIds.push(created.body.id);
  assert.equal(created.body.author.displayName, "Ada Author");
  assert.equal("email" in created.body.author, false);

  const feed = await request<{ items: Array<{ id: number; author: Record<string, unknown> }> }>("/feedback/posts");
  assert.equal(feed.response.status, 200);
  assert.ok(feed.body?.items.some((item) => item.id === created.body!.id));
  const author = feed.body?.items.find((item) => item.id === created.body!.id)?.author ?? {};
  assert.equal("email" in author, false);

  const detail = await request<{ post: { id: number }; replies: unknown[] }>(`/feedback/posts/${created.body!.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body?.post.id, created.body!.id);
});

test("anonymous writes are rejected", async () => {
  const create = await request("/feedback/posts", {
    method: "POST",
    body: JSON.stringify({ body: "feedback-test-anon" }),
  });
  assert.equal(create.response.status, 401);

  const seeded = await request<{ id: number }>("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({ body: "feedback-test-for-anon-writes" }),
  });
  assert.equal(seeded.response.status, 201);
  postIds.push(seeded.body!.id);

  const reply = await request(`/feedback/posts/${seeded.body!.id}/replies`, {
    method: "POST",
    body: JSON.stringify({ body: "nope" }),
  });
  assert.equal(reply.response.status, 401);

  const react = await request(`/feedback/posts/${seeded.body!.id}/reactions/thumbs_up`, {
    method: "PUT",
  });
  assert.equal(react.response.status, 401);
});

test("cross-user replies and reaction toggle uniqueness", async () => {
  const post = await request<{ id: number }>("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({ body: "feedback-test-cross-user" }),
  });
  assert.equal(post.response.status, 201);
  postIds.push(post.body!.id);

  const reply = await request<{ id: number; postId: number }>(`/feedback/posts/${post.body!.id}/replies`, {
    method: "POST",
    userId: userIds[1],
    body: JSON.stringify({ body: "helpful suggestion" }),
  });
  assert.equal(reply.response.status, 201);
  assert.equal(reply.body?.postId, post.body!.id);

  const first = await request<Array<{ emoji: string; count: number; viewerReacted: boolean }>>(
    `/feedback/posts/${post.body!.id}/reactions/heart`,
    { method: "PUT", userId: userIds[1] },
  );
  assert.equal(first.response.status, 200);
  assert.equal(first.body?.find((item) => item.emoji === "heart")?.count, 1);
  assert.equal(first.body?.find((item) => item.emoji === "heart")?.viewerReacted, true);

  const duplicate = await request<Array<{ emoji: string; count: number }>>(
    `/feedback/posts/${post.body!.id}/reactions/heart`,
    { method: "PUT", userId: userIds[1] },
  );
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body?.find((item) => item.emoji === "heart")?.count, 1);

  const removed = await request<Array<{ emoji: string; count: number; viewerReacted: boolean }>>(
    `/feedback/posts/${post.body!.id}/reactions/heart`,
    { method: "DELETE", userId: userIds[1] },
  );
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body?.find((item) => item.emoji === "heart")?.count, 0);
  assert.equal(removed.body?.find((item) => item.emoji === "heart")?.viewerReacted, false);
});

test("feed pagination walks without duplicates", async () => {
  const createdIds: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const created = await request<{ id: number }>("/feedback/posts", {
      method: "POST",
      userId: userIds[0],
      body: JSON.stringify({ body: `feedback-test-page-${index}-${randomUUID()}` }),
    });
    assert.equal(created.response.status, 201);
    createdIds.push(created.body!.id);
    postIds.push(created.body!.id);
  }

  const firstPage = await request<{ items: Array<{ id: number }>; nextCursor: string | null }>(
    "/feedback/posts?limit=2",
  );
  assert.equal(firstPage.response.status, 200);
  assert.equal(firstPage.body?.items.length, 2);
  assert.ok(firstPage.body?.nextCursor);

  const secondPage = await request<{ items: Array<{ id: number }>; nextCursor: string | null }>(
    `/feedback/posts?limit=2&cursor=${encodeURIComponent(firstPage.body!.nextCursor!)}`,
  );
  assert.equal(secondPage.response.status, 200);
  assert.ok(secondPage.body?.items.length);
  const seen = new Set([
    ...firstPage.body!.items.map((item) => item.id),
    ...secondPage.body!.items.map((item) => item.id),
  ]);
  assert.equal(seen.size, firstPage.body!.items.length + secondPage.body!.items.length);
});

test("validates post body, links, and image references", async () => {
  const tooLong = await request("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({ body: "x".repeat(2001) }),
  });
  assert.equal(tooLong.response.status, 400);

  const badLink = await request("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({ body: "feedback-test-bad-link", links: ["http://insecure.example"] }),
  });
  assert.equal(badLink.response.status, 400);

  const tooManyLinks = await request("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({
      body: "feedback-test-too-many-links",
      links: [
        "https://a.example",
        "https://b.example",
        "https://c.example",
        "https://d.example",
        "https://e.example",
        "https://f.example",
      ],
    }),
  });
  assert.equal(tooManyLinks.response.status, 400);

  const missingImage = await request("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({
      body: "feedback-test-missing-image",
      imageObjectPath: `/objects/feedback/${userIds[0]}/${randomUUID()}`,
    }),
  });
  assert.equal(missingImage.response.status, 400);

  const foreignImage = await request("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({
      body: "feedback-test-foreign-image",
      imageObjectPath: `/objects/feedback/${userIds[1]}/${randomUUID()}`,
    }),
  });
  assert.equal(foreignImage.response.status, 400);
});

test("feedback image upload and public serving require a published post", async () => {
  const badMeta = await request("/feedback/images/upload-url", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({ name: "notes.pdf", size: 100, contentType: "application/pdf" }),
  });
  assert.equal(badMeta.response.status, 400);

  const uploadUrl = await request<{ uploadURL: string; objectPath: string }>("/feedback/images/upload-url", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({ name: "shot.png", size: 12, contentType: "image/png" }),
  });
  assert.equal(uploadUrl.response.status, 200);
  assert.ok(uploadUrl.body?.uploadURL);
  assert.ok(uploadUrl.body?.objectPath.includes(`/objects/feedback/`));

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const put = await fetch(uploadUrl.body!.uploadURL.startsWith("http")
    ? uploadUrl.body!.uploadURL
    : `${baseUrl.replace(/\/api$/, "")}${uploadUrl.body!.uploadURL}`, {
    method: "PUT",
    headers: {
      "content-type": "image/png",
      "x-test-user-id": userIds[0],
    },
    body: png,
  });
  assert.equal(put.status, 200);

  const relative = uploadUrl.body!.objectPath.replace(/^\/objects\//, "");
  const beforePublish = await fetch(`${baseUrl}/feedback/images/${relative}`);
  assert.equal(beforePublish.status, 404);

  const post = await request<{ id: number; imageUrl: string | null }>("/feedback/posts", {
    method: "POST",
    userId: userIds[0],
    body: JSON.stringify({
      body: "feedback-test-with-image",
      imageObjectPath: uploadUrl.body!.objectPath,
    }),
  });
  assert.equal(post.response.status, 201);
  postIds.push(post.body!.id);
  assert.ok(post.body?.imageUrl);

  const afterPublish = await fetch(`${baseUrl}/feedback/images/${relative}`);
  assert.equal(afterPublish.status, 200);

  const privateObject = await fetch(`${baseUrl}/storage/objects/${relative}`);
  assert.equal(privateObject.status, 401);
});

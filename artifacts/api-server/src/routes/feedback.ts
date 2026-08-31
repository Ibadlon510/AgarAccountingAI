import { Readable } from "node:stream";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  feedbackPostLinksTable,
  feedbackPostsTable,
  feedbackReactionsTable,
  feedbackRepliesTable,
  usersTable,
} from "@workspace/db";
import { and, asc, count, desc, eq, inArray, lt, or } from "drizzle-orm";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { getObjectAclPolicy, ObjectPermission } from "../lib/objectAcl";
import {
  feedbackImagePublicUrl,
  isFeedbackObjectPath,
  MAX_FEEDBACK_IMAGE_SIZE,
  normalizeFeedbackObjectPath,
  validateFeedbackImageContent,
  validateFeedbackImageMetadata,
} from "../lib/feedbackImage";

const FEEDBACK_EMOJIS = ["thumbs_up", "heart", "celebrate", "eyes", "rocket", "laugh"] as const;
type FeedbackEmoji = (typeof FEEDBACK_EMOJIS)[number];

const objectStorageService = new ObjectStorageService();

export const feedbackPublicRouter: IRouter = Router();
export const feedbackAuthRouter: IRouter = Router();

function isFeedbackEmoji(value: string): value is FeedbackEmoji {
  return (FEEDBACK_EMOJIS as readonly string[]).includes(value);
}

function authorSummary(user: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
} | null | undefined) {
  if (!user) {
    return {
      id: "unknown",
      displayName: "Former user",
      initials: "?",
      profileImageUrl: null as string | null,
    };
  }
  const first = user.firstName?.trim() ?? "";
  const last = user.lastName?.trim() ?? "";
  const displayName = [first, last].filter(Boolean).join(" ")
    || (user.email ? user.email.split("@")[0] : null)
    || "AgarAccounting user";
  const initials = [first[0], last[0]].filter(Boolean).join("").toUpperCase()
    || displayName.slice(0, 2).toUpperCase();
  return {
    id: user.id,
    displayName,
    initials,
    profileImageUrl: user.profileImageUrl,
  };
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: string;
      id?: number;
    };
    if (!parsed.createdAt || typeof parsed.id !== "number") return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: number) {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), "utf8").toString("base64url");
}

function parseLimit(raw: unknown) {
  const value = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : 20;
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

function validateHttpsLinks(links: unknown): string[] | { error: string } {
  if (links == null) return [];
  if (!Array.isArray(links)) return { error: "Links must be an array of HTTPS URLs." };
  if (links.length > 5) return { error: "A feedback post can include at most 5 links." };
  const normalized: string[] = [];
  for (const link of links) {
    if (typeof link !== "string") return { error: "Each link must be a string URL." };
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return { error: "Each link must be a valid URL." };
    }
    if (url.protocol !== "https:") return { error: "Links must use HTTPS." };
    normalized.push(url.toString());
  }
  return normalized;
}

async function loadUsersByIds(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map<string, typeof usersTable.$inferSelect>();
  const rows = await db.select().from(usersTable).where(inArray(usersTable.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

async function reactionSummaries(
  targetType: "post" | "reply",
  targetIds: number[],
  viewerUserId?: string,
) {
  const empty = new Map<number, Array<{ emoji: FeedbackEmoji; count: number; viewerReacted: boolean }>>();
  for (const id of targetIds) {
    empty.set(id, FEEDBACK_EMOJIS.map((emoji) => ({ emoji, count: 0, viewerReacted: false })));
  }
  if (!targetIds.length) return empty;

  const aggregates = await db
    .select({
      targetId: feedbackReactionsTable.targetId,
      emoji: feedbackReactionsTable.emoji,
      count: count(),
    })
    .from(feedbackReactionsTable)
    .where(and(
      eq(feedbackReactionsTable.targetType, targetType),
      inArray(feedbackReactionsTable.targetId, targetIds),
    ))
    .groupBy(feedbackReactionsTable.targetId, feedbackReactionsTable.emoji);

  const viewerRows = viewerUserId
    ? await db
      .select({
        targetId: feedbackReactionsTable.targetId,
        emoji: feedbackReactionsTable.emoji,
      })
      .from(feedbackReactionsTable)
      .where(and(
        eq(feedbackReactionsTable.targetType, targetType),
        eq(feedbackReactionsTable.userId, viewerUserId),
        inArray(feedbackReactionsTable.targetId, targetIds),
      ))
    : [];

  const viewerSet = new Set(viewerRows.map((row) => `${row.targetId}:${row.emoji}`));

  for (const row of aggregates) {
    const list = empty.get(row.targetId);
    if (!list) continue;
    const emoji = row.emoji as FeedbackEmoji;
    const entry = list.find((item) => item.emoji === emoji);
    if (entry) {
      entry.count = Number(row.count);
      entry.viewerReacted = viewerSet.has(`${row.targetId}:${emoji}`);
    }
  }
  return empty;
}

async function replyCounts(postIds: number[]) {
  const map = new Map<number, number>();
  for (const id of postIds) map.set(id, 0);
  if (!postIds.length) return map;
  const rows = await db
    .select({
      postId: feedbackRepliesTable.postId,
      count: count(),
    })
    .from(feedbackRepliesTable)
    .where(inArray(feedbackRepliesTable.postId, postIds))
    .groupBy(feedbackRepliesTable.postId);
  for (const row of rows) map.set(row.postId, Number(row.count));
  return map;
}

async function linksByPostIds(postIds: number[]) {
  const map = new Map<number, string[]>();
  for (const id of postIds) map.set(id, []);
  if (!postIds.length) return map;
  const rows = await db
    .select()
    .from(feedbackPostLinksTable)
    .where(inArray(feedbackPostLinksTable.postId, postIds))
    .orderBy(asc(feedbackPostLinksTable.position));
  for (const row of rows) {
    const list = map.get(row.postId) ?? [];
    list.push(row.url);
    map.set(row.postId, list);
  }
  return map;
}

async function serializePosts(
  posts: Array<typeof feedbackPostsTable.$inferSelect>,
  viewerUserId?: string,
) {
  const users = await loadUsersByIds(posts.map((post) => post.authorId));
  const postIds = posts.map((post) => post.id);
  const [reactions, replies, links] = await Promise.all([
    reactionSummaries("post", postIds, viewerUserId),
    replyCounts(postIds),
    linksByPostIds(postIds),
  ]);
  return posts.map((post) => ({
    id: post.id,
    author: authorSummary(post.authorId ? users.get(post.authorId) : null),
    body: post.body,
    imageUrl: post.imageObjectPath ? feedbackImagePublicUrl(post.imageObjectPath) : null,
    links: links.get(post.id) ?? [],
    createdAt: post.createdAt.toISOString(),
    reactions: reactions.get(post.id) ?? FEEDBACK_EMOJIS.map((emoji) => ({ emoji, count: 0, viewerReacted: false })),
    replyCount: replies.get(post.id) ?? 0,
  }));
}

async function serializeReplies(
  replies: Array<typeof feedbackRepliesTable.$inferSelect>,
  viewerUserId?: string,
) {
  const users = await loadUsersByIds(replies.map((reply) => reply.authorId));
  const reactions = await reactionSummaries("reply", replies.map((reply) => reply.id), viewerUserId);
  return replies.map((reply) => ({
    id: reply.id,
    postId: reply.postId,
    author: authorSummary(reply.authorId ? users.get(reply.authorId) : null),
    body: reply.body,
    createdAt: reply.createdAt.toISOString(),
    reactions: reactions.get(reply.id) ?? FEEDBACK_EMOJIS.map((emoji) => ({ emoji, count: 0, viewerReacted: false })),
  }));
}

feedbackPublicRouter.get("/feedback/posts", async (req: Request, res: Response) => {
  const limit = parseLimit(req.query.limit);
  const cursor = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);
  const conditions = cursor
    ? or(
      lt(feedbackPostsTable.createdAt, cursor.createdAt),
      and(eq(feedbackPostsTable.createdAt, cursor.createdAt), lt(feedbackPostsTable.id, cursor.id)),
    )
    : undefined;

  const rows = await db
    .select()
    .from(feedbackPostsTable)
    .where(conditions)
    .orderBy(desc(feedbackPostsTable.createdAt), desc(feedbackPostsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = await serializePosts(page, req.dbUser?.id);
  const last = page[page.length - 1];
  res.json({
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});

feedbackPublicRouter.get("/feedback/posts/:postId", async (req: Request, res: Response) => {
  const postId = Number(req.params.postId);
  if (!Number.isInteger(postId) || postId <= 0) {
    res.status(404).json({ error: "Feedback post not found" });
    return;
  }
  const [post] = await db.select().from(feedbackPostsTable).where(eq(feedbackPostsTable.id, postId)).limit(1);
  if (!post) {
    res.status(404).json({ error: "Feedback post not found" });
    return;
  }
  const replies = await db
    .select()
    .from(feedbackRepliesTable)
    .where(eq(feedbackRepliesTable.postId, postId))
    .orderBy(asc(feedbackRepliesTable.createdAt), asc(feedbackRepliesTable.id));
  const [serializedPost] = await serializePosts([post], req.dbUser?.id);
  const serializedReplies = await serializeReplies(replies, req.dbUser?.id);
  res.json({ post: serializedPost, replies: serializedReplies });
});

feedbackPublicRouter.get("/feedback/images/*objectPath", async (req: Request, res: Response) => {
  const raw = req.params.objectPath;
  const relative = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
  if (!isFeedbackObjectPath(relative)) {
    res.status(404).json({ error: "Feedback image not found" });
    return;
  }
  const objectPath = normalizeFeedbackObjectPath(relative);
  const [published] = await db
    .select({ id: feedbackPostsTable.id })
    .from(feedbackPostsTable)
    .where(eq(feedbackPostsTable.imageObjectPath, objectPath))
    .limit(1);
  if (!published) {
    res.status(404).json({ error: "Feedback image not found" });
    return;
  }
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const aclPolicy = await getObjectAclPolicy(objectFile);
    if (aclPolicy?.visibility !== "public") {
      res.status(404).json({ error: "Feedback image not found" });
      return;
    }
    const canAccess = await objectStorageService.canAccessObjectEntity({
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(404).json({ error: "Feedback image not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Feedback image not found" });
      return;
    }
    req.log?.error({ err: error }, "Error serving feedback image");
    res.status(500).json({ error: "Failed to serve feedback image" });
  }
});

feedbackAuthRouter.post("/feedback/images/upload-url", async (req: Request, res: Response) => {
  if (!req.dbUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const body = req.body as { name?: unknown; size?: unknown; contentType?: unknown };
  if (typeof body.name !== "string" || typeof body.size !== "number" || typeof body.contentType !== "string") {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  const validationError = validateFeedbackImageMetadata(body.name, body.contentType, body.size);
  if (validationError) {
    res.status(400).json({ error: validationError, maxSize: MAX_FEEDBACK_IMAGE_SIZE });
    return;
  }
  try {
    const prefix = `feedback/${encodeURIComponent(req.dbUser.id)}`;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(prefix, { visibility: "public" });
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({
      uploadURL,
      objectPath,
      metadata: { name: body.name, size: body.size, contentType: body.contentType },
    });
  } catch (error) {
    req.log?.error({ err: error }, "Error generating feedback image upload URL");
    res.status(500).json({ error: "Could not prepare the feedback image upload. Try again." });
  }
});

feedbackAuthRouter.post("/feedback/posts", async (req: Request, res: Response) => {
  if (!req.dbUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const body = req.body as { body?: unknown; links?: unknown; imageObjectPath?: unknown };
  if (typeof body.body !== "string") {
    res.status(400).json({ error: "Feedback body is required." });
    return;
  }
  const text = body.body.trim();
  if (!text) {
    res.status(400).json({ error: "Feedback body is required." });
    return;
  }
  if (text.length > 2000) {
    res.status(400).json({ error: "Feedback posts are limited to 2000 characters." });
    return;
  }
  const links = validateHttpsLinks(body.links);
  if (!Array.isArray(links)) {
    res.status(400).json({ error: links.error });
    return;
  }

  let imageObjectPath: string | null = null;
  if (body.imageObjectPath != null) {
    if (typeof body.imageObjectPath !== "string") {
      res.status(400).json({ error: "imageObjectPath must be a string." });
      return;
    }
    imageObjectPath = normalizeFeedbackObjectPath(body.imageObjectPath);
    if (!isFeedbackObjectPath(imageObjectPath, req.dbUser.id)) {
      res.status(400).json({ error: "Invalid feedback image reference." });
      return;
    }
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(imageObjectPath);
      const aclPolicy = await getObjectAclPolicy(objectFile);
      if (!aclPolicy || aclPolicy.owner !== req.dbUser.id) {
        res.status(400).json({ error: "Invalid feedback image reference." });
        return;
      }
      const [metadata] = await objectFile.getMetadata();
      const size = Number(metadata.size ?? 0);
      const contentType = String(metadata.contentType ?? "application/octet-stream");
      const validationError = validateFeedbackImageContent(contentType, size);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
      if (aclPolicy.visibility !== "public") {
        await objectStorageService.trySetObjectEntityAclPolicy(imageObjectPath, {
          owner: req.dbUser.id,
          visibility: "public",
        });
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "The feedback image upload was not found. Upload again." });
        return;
      }
      throw error;
    }
    const [existing] = await db
      .select({ id: feedbackPostsTable.id })
      .from(feedbackPostsTable)
      .where(eq(feedbackPostsTable.imageObjectPath, imageObjectPath))
      .limit(1);
    if (existing) {
      res.status(400).json({ error: "That feedback image is already attached to another post." });
      return;
    }
  }

  const [post] = await db.insert(feedbackPostsTable).values({
    authorId: req.dbUser.id,
    body: text,
    imageObjectPath,
  }).returning();

  if (links.length) {
    await db.insert(feedbackPostLinksTable).values(links.map((url, position) => ({
      postId: post.id,
      url,
      position,
    })));
  }

  const [serialized] = await serializePosts([post], req.dbUser.id);
  res.status(201).json(serialized);
});

feedbackAuthRouter.post("/feedback/posts/:postId/replies", async (req: Request, res: Response) => {
  if (!req.dbUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const postId = Number(req.params.postId);
  if (!Number.isInteger(postId) || postId <= 0) {
    res.status(404).json({ error: "Feedback post not found" });
    return;
  }
  const bodyText = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!bodyText) {
    res.status(400).json({ error: "Reply body is required." });
    return;
  }
  if (bodyText.length > 1000) {
    res.status(400).json({ error: "Replies are limited to 1000 characters." });
    return;
  }
  const [post] = await db.select({ id: feedbackPostsTable.id }).from(feedbackPostsTable).where(eq(feedbackPostsTable.id, postId)).limit(1);
  if (!post) {
    res.status(404).json({ error: "Feedback post not found" });
    return;
  }
  const [reply] = await db.insert(feedbackRepliesTable).values({
    postId,
    authorId: req.dbUser.id,
    body: bodyText,
  }).returning();
  const [serialized] = await serializeReplies([reply], req.dbUser.id);
  res.status(201).json(serialized);
});

async function mutateReaction(
  req: Request,
  res: Response,
  targetType: "post" | "reply",
  targetId: number,
  emojiRaw: string,
  mode: "add" | "remove",
) {
  if (!req.dbUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!isFeedbackEmoji(emojiRaw)) {
    res.status(400).json({ error: "Unsupported reaction." });
    return;
  }
  if (!Number.isInteger(targetId) || targetId <= 0) {
    res.status(404).json({ error: targetType === "post" ? "Feedback post not found" : "Feedback reply not found" });
    return;
  }
  if (targetType === "post") {
    const [post] = await db.select({ id: feedbackPostsTable.id }).from(feedbackPostsTable).where(eq(feedbackPostsTable.id, targetId)).limit(1);
    if (!post) {
      res.status(404).json({ error: "Feedback post not found" });
      return;
    }
  } else {
    const [reply] = await db.select({ id: feedbackRepliesTable.id }).from(feedbackRepliesTable).where(eq(feedbackRepliesTable.id, targetId)).limit(1);
    if (!reply) {
      res.status(404).json({ error: "Feedback reply not found" });
      return;
    }
  }

  if (mode === "add") {
    await db.insert(feedbackReactionsTable).values({
      userId: req.dbUser.id,
      targetType,
      targetId,
      emoji: emojiRaw,
    }).onConflictDoNothing();
  } else {
    await db.delete(feedbackReactionsTable).where(and(
      eq(feedbackReactionsTable.userId, req.dbUser.id),
      eq(feedbackReactionsTable.targetType, targetType),
      eq(feedbackReactionsTable.targetId, targetId),
      eq(feedbackReactionsTable.emoji, emojiRaw),
    ));
  }

  const summaries = await reactionSummaries(targetType, [targetId], req.dbUser.id);
  res.json(summaries.get(targetId) ?? FEEDBACK_EMOJIS.map((emoji) => ({ emoji, count: 0, viewerReacted: false })));
}

feedbackAuthRouter.put("/feedback/posts/:postId/reactions/:emoji", async (req, res) => {
  await mutateReaction(req, res, "post", Number(req.params.postId), String(req.params.emoji), "add");
});

feedbackAuthRouter.delete("/feedback/posts/:postId/reactions/:emoji", async (req, res) => {
  await mutateReaction(req, res, "post", Number(req.params.postId), String(req.params.emoji), "remove");
});

feedbackAuthRouter.put("/feedback/replies/:replyId/reactions/:emoji", async (req, res) => {
  await mutateReaction(req, res, "reply", Number(req.params.replyId), String(req.params.emoji), "add");
});

feedbackAuthRouter.delete("/feedback/replies/:replyId/reactions/:emoji", async (req, res) => {
  await mutateReaction(req, res, "reply", Number(req.params.replyId), String(req.params.emoji), "remove");
});

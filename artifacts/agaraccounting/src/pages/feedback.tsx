import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  CircleAlert,
  ImagePlus,
  Link2,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import {
  requestFeedbackImageUploadUrl,
  useCreateFeedbackPost,
  useCreateFeedbackReply,
  useGetFeedbackPost,
  type FeedbackEmoji,
  type FeedbackPost,
  type FeedbackReactionSummary,
  type FeedbackReply,
} from "@workspace/api-client-react";
import {
  FEEDBACK_EMOJI_LABELS,
  FEEDBACK_EMOJI_ORDER,
  useListFeedbackPostsInfinite,
  useToggleFeedbackPostReaction,
  useToggleFeedbackReplyReaction,
} from "@workspace/api-client-react/feedback";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const brandMarkUrl = `${basePath}/mark.svg`;

const MAX_LINKS = 5;
const MAX_POST_CHARS = 2000;
const MAX_REPLY_CHARS = 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function feedbackSignInHref(returnPath = "/feedback") {
  return `/sign-in?redirect_url=${encodeURIComponent(returnPath)}`;
}

function currentFeedbackReturnPath() {
  const path = `${window.location.pathname.replace(basePath, "") || "/feedback"}${window.location.search}`;
  return path.startsWith("/feedback") ? path : "/feedback";
}

function formatTimestamp(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function applyOptimisticReaction(
  reactions: FeedbackReactionSummary[],
  emoji: FeedbackEmoji,
  currentlyReacted: boolean,
): FeedbackReactionSummary[] {
  return FEEDBACK_EMOJI_ORDER.map((key) => {
    const current = reactions.find((reaction) => reaction.emoji === key) ?? {
      emoji: key,
      count: 0,
      viewerReacted: false,
    };
    if (key !== emoji) return current;
    if (currentlyReacted) {
      return {
        ...current,
        count: Math.max(0, current.count - 1),
        viewerReacted: false,
      };
    }
    return {
      ...current,
      count: current.count + 1,
      viewerReacted: true,
    };
  });
}

function validateLocalImage(file: File) {
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    return "Images must be JPEG, PNG, WebP, or GIF.";
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return "Feedback images must be 5 MB or smaller.";
  }
  return null;
}

function SignInPrompt({
  action,
  returnPath,
}: {
  action: string;
  returnPath?: string;
}) {
  const href = feedbackSignInHref(returnPath ?? currentFeedbackReturnPath());
  return (
    <div
      data-testid="feedback-signin-prompt"
      className="mt-2 rounded-md border border-primary/20 bg-secondary/70 px-3 py-2 text-[11px] leading-5 text-foreground"
      role="status"
    >
      Sign in to {action}.{" "}
      <Link href={href} className="font-semibold text-primary underline-offset-2 hover:underline">
        Continue to sign in
      </Link>
      {" "}— you&apos;ll return here afterward.
    </div>
  );
}

function ReactionBar({
  reactions,
  signedIn,
  pending,
  onToggle,
  onRequireSignIn,
}: {
  reactions: FeedbackReactionSummary[];
  signedIn: boolean;
  pending?: boolean;
  onToggle: (emoji: FeedbackEmoji, currentlyReacted: boolean) => void;
  onRequireSignIn: () => void;
}) {
  const byEmoji = useMemo(() => {
    const map = new Map(reactions.map((reaction) => [reaction.emoji, reaction]));
    return FEEDBACK_EMOJI_ORDER.map((emoji) => map.get(emoji) ?? {
      emoji,
      count: 0,
      viewerReacted: false,
    });
  }, [reactions]);

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reactions">
      {byEmoji.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          data-testid={`button-reaction-${reaction.emoji}`}
          disabled={pending}
          aria-pressed={reaction.viewerReacted}
          aria-label={`${FEEDBACK_EMOJI_LABELS[reaction.emoji]} ${reaction.count}`}
          onClick={() => {
            if (!signedIn) {
              onRequireSignIn();
              return;
            }
            onToggle(reaction.emoji, reaction.viewerReacted);
          }}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors ${
            reaction.viewerReacted
              ? "border-primary/40 bg-secondary text-foreground"
              : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
          } disabled:opacity-60`}
        >
          <span aria-hidden="true">{FEEDBACK_EMOJI_LABELS[reaction.emoji]}</span>
          <span className="font-mono">{reaction.count}</span>
        </button>
      ))}
    </div>
  );
}

function FeedbackComposer({
  signedIn,
  onCreated,
}: {
  signedIn: boolean;
  onCreated: () => void;
}) {
  const [body, setBody] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageObjectPath, setImageObjectPath] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const createPost = useCreateFeedbackPost();

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const requestAuth = () => setShowSignInPrompt(true);

  const addLink = () => {
    if (!signedIn) {
      requestAuth();
      return;
    }
    const value = linkDraft.trim();
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") {
        setLinkError("Links must use HTTPS.");
        return;
      }
      if (links.length >= MAX_LINKS) {
        setLinkError(`You can attach up to ${MAX_LINKS} links.`);
        return;
      }
      setLinks((current) => [...current, url.toString()]);
      setLinkDraft("");
      setLinkError(null);
    } catch {
      setLinkError("Enter a valid HTTPS URL.");
    }
  };

  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageObjectPath(null);
    setUploadProgress(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadImage = async (file: File) => {
    const localError = validateLocalImage(file);
    if (localError) {
      setUploadError(localError);
      return;
    }
    setUploadError(null);
    setStatusMessage(null);
    setUploadProgress(10);
    try {
      const prepared = await requestFeedbackImageUploadUrl({
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      });
      setUploadProgress(40);
      const put = await fetch(prepared.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!put.ok) throw new Error("Could not upload the image.");
      setUploadProgress(100);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImageObjectPath(prepared.objectPath);
      setImagePreview(URL.createObjectURL(file));
    } catch (error) {
      clearImage();
      setUploadError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploadProgress(null);
    }
  };

  const submit = async () => {
    if (!signedIn) {
      requestAuth();
      return;
    }
    const trimmed = body.trim();
    if (!trimmed || createPost.isPending || uploadProgress != null) return;
    try {
      await createPost.mutateAsync({
        data: {
          body: trimmed,
          links: links.length ? links : undefined,
          imageObjectPath: imageObjectPath ?? undefined,
        },
      });
      setBody("");
      setLinks([]);
      clearImage();
      setStatusMessage("Feedback posted.");
      onCreated();
      queueMicrotask(() => statusRef.current?.focus());
    } catch {
      // surfaced via createPost.error
    }
  };

  return (
    <section
      data-testid="feedback-composer"
      className="rounded-lg border border-card-border bg-card p-4 shadow-sm md:p-5"
      onDragOver={(event) => {
        if (!signedIn) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (!signedIn) {
          requestAuth();
          return;
        }
        const file = event.dataTransfer.files?.[0];
        if (file) void uploadImage(file);
      }}
    >
      <div className="flex items-center gap-2">
        <MessageSquarePlus size={16} className="text-primary" />
        <h2 className="text-sm font-semibold">Share feedback</h2>
      </div>
      {!signedIn && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Anyone can browse this board. Sign in to post, reply, or react — you&apos;ll return here after authentication.
        </p>
      )}
      {showSignInPrompt && !signedIn && <SignInPrompt action="post feedback" />}
      <label className="sr-only" htmlFor="feedback-body">Feedback</label>
      <textarea
        id="feedback-body"
        data-testid="input-feedback-body"
        value={body}
        maxLength={MAX_POST_CHARS}
        disabled={!signedIn || createPost.isPending}
        onFocus={() => {
          if (!signedIn) requestAuth();
        }}
        onChange={(event) => setBody(event.target.value)}
        placeholder={signedIn ? "What should we improve or keep celebrating?" : "Sign in to share feedback"}
        className={`mt-3 min-h-[110px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20 disabled:opacity-60 ${
          dragOver ? "border-primary" : "border-input"
        }`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (!signedIn) {
              requestAuth();
              return;
            }
            void uploadImage(file);
          }}
        />
        <button
          type="button"
          data-testid="button-feedback-attach-image"
          disabled={uploadProgress != null || createPost.isPending}
          onClick={() => {
            if (!signedIn) {
              requestAuth();
              return;
            }
            fileInputRef.current?.click();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <ImagePlus size={14} /> {signedIn ? "Add image" : "Sign in to add image"}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Link2 size={14} className="shrink-0 text-muted-foreground" />
          <input
            data-testid="input-feedback-link"
            value={linkDraft}
            disabled={!signedIn || links.length >= MAX_LINKS || createPost.isPending}
            onFocus={() => {
              if (!signedIn) requestAuth();
            }}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addLink();
              }
            }}
            placeholder="https://example.com"
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus-visible:border-primary disabled:opacity-60"
          />
          <button
            type="button"
            data-testid="button-feedback-add-link"
            disabled={createPost.isPending}
            onClick={addLink}
            className="rounded-md border border-border px-2 py-1.5 text-[11px] font-semibold disabled:opacity-50"
          >
            Add link
          </button>
        </div>
        <button
          type="button"
          data-testid="button-feedback-submit"
          disabled={signedIn ? (!body.trim() || createPost.isPending || uploadProgress != null) : false}
          onClick={() => void submit()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {createPost.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {signedIn ? "Post" : "Sign in to post"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted-foreground">
        <span>{body.length}/{MAX_POST_CHARS} · Drag an image here or choose a file (max 5 MB)</span>
        {uploadProgress != null && (
          <span data-testid="feedback-upload-progress" aria-live="polite">
            Uploading… {uploadProgress}%
          </span>
        )}
      </div>
      {statusMessage && (
        <p
          ref={statusRef}
          tabIndex={-1}
          data-testid="feedback-composer-success"
          className="mt-2 text-xs text-primary"
          role="status"
        >
          {statusMessage}
        </p>
      )}
      {(linkError || uploadError || createPost.isError) && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {linkError || uploadError || (createPost.error instanceof Error ? createPost.error.message : "Could not publish feedback.")}
        </p>
      )}
      {imagePreview && (
        <div className="relative mt-3 inline-block" data-testid="feedback-image-preview">
          <img src={imagePreview} alt="Feedback attachment preview" className="max-h-40 rounded-md border border-border object-cover" />
          <button
            type="button"
            aria-label="Remove image"
            onClick={clearImage}
            className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-background/90 text-muted-foreground shadow"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {links.length > 0 && (
        <ul className="mt-3 space-y-1">
          {links.map((link) => (
            <li key={link} className="flex items-center gap-2 text-[11px]">
              <a href={link} target="_blank" rel="noreferrer" className="truncate text-primary underline-offset-2 hover:underline">{link}</a>
              <button type="button" aria-label="Remove link" onClick={() => setLinks((current) => current.filter((item) => item !== link))} className="text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReplyComposer({
  postId,
  signedIn,
  onCreated,
}: {
  postId: number;
  signedIn: boolean;
  onCreated: () => void;
}) {
  const [body, setBody] = useState("");
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const createReply = useCreateFeedbackReply();

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          data-testid={`input-feedback-reply-${postId}`}
          value={body}
          maxLength={MAX_REPLY_CHARS}
          disabled={!signedIn || createReply.isPending}
          onFocus={() => {
            if (!signedIn) setShowSignInPrompt(true);
          }}
          onChange={(event) => setBody(event.target.value)}
          placeholder={signedIn ? "Write a reply…" : "Sign in to reply"}
          className="min-h-[64px] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus-visible:border-primary disabled:opacity-60"
        />
        <button
          type="button"
          data-testid={`button-feedback-reply-${postId}`}
          disabled={signedIn ? (!body.trim() || createReply.isPending) : false}
          onClick={async () => {
            if (!signedIn) {
              setShowSignInPrompt(true);
              return;
            }
            await createReply.mutateAsync({ postId, data: { body: body.trim() } });
            setBody("");
            setStatusMessage("Reply posted.");
            onCreated();
          }}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold disabled:opacity-50"
        >
          {createReply.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
          {signedIn ? "Reply" : "Sign in to reply"}
        </button>
      </div>
      {showSignInPrompt && !signedIn && <SignInPrompt action="reply" />}
      {statusMessage && <p className="text-[11px] text-primary" role="status">{statusMessage}</p>}
      {createReply.isError && (
        <p className="text-[11px] text-destructive" role="alert">
          {createReply.error instanceof Error ? createReply.error.message : "Could not post reply."}
        </p>
      )}
    </div>
  );
}

function ReplyList({
  postId,
  signedIn,
  onReplyCreated,
}: {
  postId: number;
  signedIn: boolean;
  onReplyCreated: () => void;
}) {
  const detail = useGetFeedbackPost(postId);
  const [promptSignIn, setPromptSignIn] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [localReactions, setLocalReactions] = useState<Record<number, FeedbackReactionSummary[]>>({});
  const toggleReplyReaction = useToggleFeedbackReplyReaction();

  useEffect(() => {
    if (!detail.data) return;
    setLocalReactions(Object.fromEntries(detail.data.replies.map((reply) => [reply.id, reply.reactions])));
  }, [detail.data]);

  if (detail.isLoading) {
    return <div className="mt-3 space-y-2" data-testid={`feedback-replies-loading-${postId}`}>{[0, 1].map((row) => <div key={row} className="skeleton h-12 rounded-md" />)}</div>;
  }
  if (detail.isError) {
    return (
      <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        Could not load replies.{" "}
        <button type="button" className="font-semibold underline" onClick={() => void detail.refetch()}>Retry</button>
      </div>
    );
  }
  const replies = detail.data?.replies ?? [];
  return (
    <div className="mt-3 space-y-3" data-testid={`feedback-replies-${postId}`}>
      {replies.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No replies yet.</p>
      ) : (
        replies.map((reply: FeedbackReply) => (
          <div key={reply.id} className="rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary/90 font-mono text-[9px] text-primary-foreground">{reply.author.initials}</span>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold">{reply.author.displayName}</div>
                <div className="font-mono text-[9px] text-muted-foreground">{formatTimestamp(reply.createdAt)}</div>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-foreground/90">{reply.body}</p>
            <div className="mt-2">
              <ReactionBar
                reactions={localReactions[reply.id] ?? reply.reactions}
                signedIn={signedIn}
                pending={toggleReplyReaction.isPending}
                onRequireSignIn={() => setPromptSignIn(true)}
                onToggle={(emoji, currentlyReacted) => {
                  const previous = localReactions[reply.id] ?? reply.reactions;
                  setLocalReactions((current) => ({
                    ...current,
                    [reply.id]: applyOptimisticReaction(previous, emoji, currentlyReacted),
                  }));
                  setReactionError(null);
                  toggleReplyReaction.mutate(
                    { replyId: reply.id, emoji, currentlyReacted },
                    {
                      onSuccess: (next) => {
                        setLocalReactions((current) => ({ ...current, [reply.id]: next }));
                      },
                      onError: (error) => {
                        setLocalReactions((current) => ({ ...current, [reply.id]: previous }));
                        setReactionError(error instanceof Error ? error.message : "Could not update reaction.");
                      },
                    },
                  );
                }}
              />
            </div>
          </div>
        ))
      )}
      {promptSignIn && !signedIn && <SignInPrompt action="react to replies" />}
      {reactionError && <p className="text-[11px] text-destructive" role="alert">{reactionError}</p>}
      <ReplyComposer
        postId={postId}
        signedIn={signedIn}
        onCreated={() => {
          onReplyCreated();
          void detail.refetch();
        }}
      />
    </div>
  );
}

function FeedbackPostCard({
  post,
  signedIn,
}: {
  post: FeedbackPost;
  signedIn: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reactions, setReactions] = useState(post.reactions);
  const [replyCount, setReplyCount] = useState(post.replyCount);
  const [promptSignIn, setPromptSignIn] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const togglePostReaction = useToggleFeedbackPostReaction();

  useEffect(() => {
    setReactions(post.reactions);
    setReplyCount(post.replyCount);
  }, [post.id, post.reactions, post.replyCount]);

  return (
    <article data-testid={`feedback-post-${post.id}`} className="rounded-lg border border-card-border bg-card p-4 shadow-sm md:p-5">
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-mono text-[10px] font-medium text-primary-foreground">
          {post.author.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-sm font-semibold">{post.author.displayName}</h3>
            <time className="font-mono text-[10px] text-muted-foreground" dateTime={post.createdAt}>
              {formatTimestamp(post.createdAt)}
            </time>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-foreground/90">{post.body}</p>
          {post.imageUrl && (
            <a href={post.imageUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-md border border-border">
              <img src={post.imageUrl} alt="Feedback attachment" className="max-h-72 w-full object-cover" />
            </a>
          )}
          {post.links.length > 0 && (
            <ul className="mt-3 space-y-1">
              {post.links.map((link) => (
                <li key={link}>
                  <a href={link} target="_blank" rel="noreferrer" className="break-all text-[12px] text-primary underline-offset-2 hover:underline">{link}</a>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <ReactionBar
              reactions={reactions}
              signedIn={signedIn}
              pending={togglePostReaction.isPending}
              onRequireSignIn={() => setPromptSignIn(true)}
              onToggle={(emoji, currentlyReacted) => {
                const previous = reactions;
                setReactions(applyOptimisticReaction(previous, emoji, currentlyReacted));
                setReactionError(null);
                togglePostReaction.mutate(
                  { postId: post.id, emoji, currentlyReacted },
                  {
                    onSuccess: (next) => setReactions(next),
                    onError: (error) => {
                      setReactions(previous);
                      setReactionError(error instanceof Error ? error.message : "Could not update reaction.");
                    },
                  },
                );
              }}
            />
          </div>
          {promptSignIn && !signedIn && <SignInPrompt action="react" />}
          {reactionError && <p className="mt-2 text-[11px] text-destructive" role="alert">{reactionError}</p>}
          <button
            type="button"
            data-testid={`button-toggle-replies-${post.id}`}
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? "Hide replies" : `Replies (${replyCount})`}
          </button>
          {expanded && (
            <ReplyList
              postId={post.id}
              signedIn={signedIn}
              onReplyCreated={() => setReplyCount((count) => count + 1)}
            />
          )}
        </div>
      </header>
    </article>
  );
}

export default function FeedbackPage({ signedIn }: { signedIn: boolean }) {
  const search = useSearch();
  const fromAssistant = new URLSearchParams(search).get("from") === "assistant";
  const feed = useListFeedbackPostsInfinite({ limit: 20 });
  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="feedback-board">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Shared board</div>
        <h1 className="mt-2 font-display text-[34px] leading-none tracking-tight">Feedback & reviews</h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">
          Browse product feedback from the AgarAccounting community. Posts, replies, and reactions require a signed-in account.
        </p>
        {fromAssistant && (
          <p
            data-testid="feedback-from-assistant-hint"
            className="mt-3 rounded-md border border-primary/20 bg-secondary/60 px-3 py-2 text-[11px] text-foreground"
          >
            Opened from AI assistant — nothing from your private chat or accounting data was copied. Add only what you choose to share.
          </p>
        )}
      </div>

      <FeedbackComposer signedIn={signedIn} onCreated={() => void feed.refetch()} />

      {feed.isLoading && (
        <div className="space-y-3" data-testid="feedback-feed-loading">
          {[0, 1, 2].map((row) => <div key={row} className="skeleton h-28 rounded-lg" />)}
        </div>
      )}

      {feed.isError && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center" data-testid="feedback-feed-error" role="alert">
          <CircleAlert className="mb-3 text-destructive" size={22} />
          <h3 className="mt-0 text-sm font-semibold">We couldn&apos;t load feedback</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">The feedback service did not return a usable response.</p>
          <button type="button" onClick={() => void feed.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      )}

      {!feed.isLoading && !feed.isError && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="feedback-feed-empty">
          <MessageSquarePlus className="mb-3 text-primary" size={22} />
          <h3 className="text-sm font-semibold">Be the first to share feedback</h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Ideas, screenshots, and reviews help shape AgarAccounting AI System.</p>
        </div>
      )}

      <div className="space-y-4">
        {posts.map((post) => (
          <FeedbackPostCard key={post.id} post={post} signedIn={signedIn} />
        ))}
      </div>

      {feed.hasNextPage && (
        <div className="flex justify-center pb-6">
          <button
            type="button"
            data-testid="button-feedback-load-more"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            {feed.isFetchingNextPage ? <Loader2 size={14} className="animate-spin" /> : null}
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

export function FeedbackPublicShell({
  children,
  signedIn = false,
  onLogout,
}: {
  children: React.ReactNode;
  signedIn?: boolean;
  onLogout?: () => void;
}) {
  return (
    <div className="min-h-[100dvh] bg-background" data-testid="feedback-public-shell">
      <header className="sticky top-0 z-30 flex h-[78px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md md:px-8">
        <div className="flex items-center gap-3">
          <img src={brandMarkUrl} alt="" className="size-9 rounded-lg" />
          <div>
            <div className="font-display text-[18px] leading-none tracking-tight">AgarAccounting AI</div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Feedback board</div>
          </div>
        </div>
        {signedIn ? (
          <div className="flex items-center gap-2">
            <Link
              data-testid="link-feedback-back-to-workspace"
              href="/user-portal"
              className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Back to workspace
            </Link>
            {onLogout && (
              <button
                type="button"
                data-testid="button-feedback-signout"
                onClick={onLogout}
                className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
              >
                Sign out
              </button>
            )}
          </div>
        ) : (
          <Link
            data-testid="link-feedback-signin"
            href={feedbackSignInHref("/feedback")}
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          >
            Sign in
          </Link>
        )}
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-7 md:px-8 lg:px-10">{children}</main>
    </div>
  );
}

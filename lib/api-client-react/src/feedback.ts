import {
  useInfiniteQuery,
  useMutation,
  type InfiniteData,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import {
  addFeedbackPostReaction,
  addFeedbackReplyReaction,
  listFeedbackPosts,
  removeFeedbackPostReaction,
  removeFeedbackReplyReaction,
} from "./generated/api";
import type {
  FeedbackEmoji,
  FeedbackFeedPage,
  FeedbackReactionSummary,
  ListFeedbackPostsParams,
} from "./generated/api.schemas";
import type { ErrorType } from "./custom-fetch";

export const getListFeedbackPostsInfiniteQueryKey = (
  params?: Omit<ListFeedbackPostsParams, "cursor">,
) => ["/api/feedback/posts", "infinite", ...(params ? [params] : [])] as const;

export function useListFeedbackPostsInfinite(
  params?: Omit<ListFeedbackPostsParams, "cursor">,
  options?: {
    query?: Omit<
      UseQueryOptions<FeedbackFeedPage, ErrorType<unknown>>,
      "queryKey" | "queryFn"
    >;
  },
) {
  return useInfiniteQuery<
    FeedbackFeedPage,
    ErrorType<unknown>,
    InfiniteData<FeedbackFeedPage, string | null>,
    ReturnType<typeof getListFeedbackPostsInfiniteQueryKey>,
    string | null
  >({
    queryKey: getListFeedbackPostsInfiniteQueryKey(params),
    queryFn: ({ pageParam }) =>
      listFeedbackPosts({
        ...params,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    ...(options?.query as object | undefined),
  });
}

export function useToggleFeedbackPostReaction<
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      FeedbackReactionSummary[],
      TError,
      { postId: number; emoji: FeedbackEmoji; currentlyReacted: boolean },
      TContext
    >;
  },
) {
  return useMutation({
    mutationKey: ["toggleFeedbackPostReaction"],
    mutationFn: ({ postId, emoji, currentlyReacted }) =>
      currentlyReacted
        ? removeFeedbackPostReaction(postId, emoji)
        : addFeedbackPostReaction(postId, emoji),
    ...options?.mutation,
  });
}

export function useToggleFeedbackReplyReaction<
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      FeedbackReactionSummary[],
      TError,
      { replyId: number; emoji: FeedbackEmoji; currentlyReacted: boolean },
      TContext
    >;
  },
) {
  return useMutation({
    mutationKey: ["toggleFeedbackReplyReaction"],
    mutationFn: ({ replyId, emoji, currentlyReacted }) =>
      currentlyReacted
        ? removeFeedbackReplyReaction(replyId, emoji)
        : addFeedbackReplyReaction(replyId, emoji),
    ...options?.mutation,
  });
}

export const FEEDBACK_EMOJI_LABELS: Record<FeedbackEmoji, string> = {
  thumbs_up: "👍",
  heart: "❤️",
  celebrate: "🎉",
  eyes: "👀",
  rocket: "🚀",
  laugh: "😄",
};

export const FEEDBACK_EMOJI_ORDER: FeedbackEmoji[] = [
  "thumbs_up",
  "heart",
  "celebrate",
  "eyes",
  "rocket",
  "laugh",
];
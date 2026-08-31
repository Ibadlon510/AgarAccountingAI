/**
 * Feedback board API client.
 * Hand-written to match the Orval React Query pattern while OpenAPI codegen
 * is blocked by local pnpm junction issues. Keep in sync with openapi.yaml
 * `feedback` paths; regenerate into generated/ when orval is healthy.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { customFetch, type BodyType, type ErrorType } from "./custom-fetch";

export type FeedbackEmoji =
  | "thumbs_up"
  | "heart"
  | "celebrate"
  | "eyes"
  | "rocket"
  | "laugh";

export interface FeedbackAuthor {
  id: string;
  displayName: string;
  initials: string;
  profileImageUrl?: string | null;
}

export interface FeedbackReactionSummary {
  emoji: FeedbackEmoji;
  count: number;
  viewerReacted: boolean;
}

export interface FeedbackPost {
  id: number;
  author: FeedbackAuthor;
  body: string;
  imageUrl?: string | null;
  links: string[];
  createdAt: string;
  reactions: FeedbackReactionSummary[];
  replyCount: number;
}

export interface FeedbackReply {
  id: number;
  postId: number;
  author: FeedbackAuthor;
  body: string;
  createdAt: string;
  reactions: FeedbackReactionSummary[];
}

export interface FeedbackPostDetail {
  post: FeedbackPost;
  replies: FeedbackReply[];
}

export interface FeedbackFeedPage {
  items: FeedbackPost[];
  nextCursor?: string | null;
}

export interface FeedbackPostInput {
  body: string;
  links?: string[];
  imageObjectPath?: string | null;
}

export interface FeedbackReplyInput {
  body: string;
}

export interface FeedbackImageUploadRequest {
  name: string;
  size: number;
  contentType: string;
}

export interface FeedbackImageUploadResponse {
  uploadURL: string;
  objectPath: string;
  metadata: {
    name: string;
    size: number;
    contentType: string;
  };
}

export type ListFeedbackPostsParams = {
  limit?: number;
  cursor?: string;
};

export const getListFeedbackPostsUrl = (params?: ListFeedbackPostsParams) => {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  const query = search.toString();
  return query ? `/api/feedback/posts?${query}` : `/api/feedback/posts`;
};

export const listFeedbackPosts = async (
  params?: ListFeedbackPostsParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackFeedPage> => {
  return customFetch<FeedbackFeedPage>(getListFeedbackPostsUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getListFeedbackPostsQueryKey = (params?: ListFeedbackPostsParams) =>
  [`/api/feedback/posts`, ...(params ? [params] : [])] as const;

export const getListFeedbackPostsInfiniteQueryKey = (params?: Omit<ListFeedbackPostsParams, "cursor">) =>
  [`/api/feedback/posts`, "infinite", ...(params ? [params] : [])] as const;

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

export const getGetFeedbackPostUrl = (postId: number) => `/api/feedback/posts/${postId}`;

export const getFeedbackPost = async (
  postId: number,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackPostDetail> => {
  return customFetch<FeedbackPostDetail>(getGetFeedbackPostUrl(postId), {
    ...options,
    method: "GET",
  });
};

export const getGetFeedbackPostQueryKey = (postId: number) =>
  [`/api/feedback/posts/${postId}`] as const;

export function useGetFeedbackPost<TData = FeedbackPostDetail, TError = ErrorType<unknown>>(
  postId: number,
  options?: {
    query?: UseQueryOptions<FeedbackPostDetail, TError, TData>;
    request?: Parameters<typeof customFetch>[1];
  },
) {
  return useQuery({
    queryKey: getGetFeedbackPostQueryKey(postId),
    queryFn: ({ signal }) => getFeedbackPost(postId, { signal, ...options?.request }),
    enabled: Number.isFinite(postId) && postId > 0,
    ...options?.query,
  });
}

export const createFeedbackPost = async (
  data: BodyType<FeedbackPostInput>,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackPost> => {
  return customFetch<FeedbackPost>(`/api/feedback/posts`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(data),
  });
};

export function useCreateFeedbackPost<TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<FeedbackPost, TError, { data: BodyType<FeedbackPostInput> }, TContext>;
  },
) {
  const queryClient = useQueryClient();
  const { onSuccess, ...mutationRest } = options?.mutation ?? {};
  return useMutation({
    mutationKey: ["createFeedbackPost"],
    ...mutationRest,
    mutationFn: ({ data }) => createFeedbackPost(data),
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/feedback/posts"] });
      await onSuccess?.(...args);
    },
  });
}

export const createFeedbackReply = async (
  postId: number,
  data: BodyType<FeedbackReplyInput>,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackReply> => {
  return customFetch<FeedbackReply>(`/api/feedback/posts/${postId}/replies`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(data),
  });
};

export function useCreateFeedbackReply<TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      FeedbackReply,
      TError,
      { postId: number; data: BodyType<FeedbackReplyInput> },
      TContext
    >;
  },
) {
  const queryClient = useQueryClient();
  const { onSuccess, ...mutationRest } = options?.mutation ?? {};
  return useMutation({
    mutationKey: ["createFeedbackReply"],
    ...mutationRest,
    mutationFn: ({ postId, data }) => createFeedbackReply(postId, data),
    onSuccess: async (reply, variables, ...rest) => {
      await queryClient.invalidateQueries({ queryKey: getGetFeedbackPostQueryKey(variables.postId) });
      await queryClient.invalidateQueries({ queryKey: ["/api/feedback/posts"] });
      await onSuccess?.(reply, variables, ...rest);
    },
  });
}

export const addFeedbackPostReaction = async (
  postId: number,
  emoji: FeedbackEmoji,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackReactionSummary[]> => {
  return customFetch<FeedbackReactionSummary[]>(
    `/api/feedback/posts/${postId}/reactions/${emoji}`,
    { ...options, method: "PUT" },
  );
};

export const removeFeedbackPostReaction = async (
  postId: number,
  emoji: FeedbackEmoji,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackReactionSummary[]> => {
  return customFetch<FeedbackReactionSummary[]>(
    `/api/feedback/posts/${postId}/reactions/${emoji}`,
    { ...options, method: "DELETE" },
  );
};

export const addFeedbackReplyReaction = async (
  replyId: number,
  emoji: FeedbackEmoji,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackReactionSummary[]> => {
  return customFetch<FeedbackReactionSummary[]>(
    `/api/feedback/replies/${replyId}/reactions/${emoji}`,
    { ...options, method: "PUT" },
  );
};

export const removeFeedbackReplyReaction = async (
  replyId: number,
  emoji: FeedbackEmoji,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackReactionSummary[]> => {
  return customFetch<FeedbackReactionSummary[]>(
    `/api/feedback/replies/${replyId}/reactions/${emoji}`,
    { ...options, method: "DELETE" },
  );
};

export function useToggleFeedbackPostReaction<TError = ErrorType<unknown>, TContext = unknown>(
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

export function useToggleFeedbackReplyReaction<TError = ErrorType<unknown>, TContext = unknown>(
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

export const requestFeedbackImageUploadUrl = async (
  data: BodyType<FeedbackImageUploadRequest>,
  options?: Parameters<typeof customFetch>[1],
): Promise<FeedbackImageUploadResponse> => {
  return customFetch<FeedbackImageUploadResponse>(`/api/feedback/images/upload-url`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(data),
  });
};

export function useRequestFeedbackImageUploadUrl<TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      FeedbackImageUploadResponse,
      TError,
      { data: BodyType<FeedbackImageUploadRequest> },
      TContext
    >;
  },
) {
  return useMutation({
    mutationKey: ["requestFeedbackImageUploadUrl"],
    mutationFn: ({ data }) => requestFeedbackImageUploadUrl(data),
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

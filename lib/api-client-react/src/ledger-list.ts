import { useQuery, type QueryFunction, type QueryKey, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { customFetch, type ErrorType } from "./custom-fetch";
import type { GetJournalEntriesParams, GetStatementLinesParams } from "./generated/api.schemas";

export type StatementLinesSummaryBankAccount = {
  bankAccountId: number;
  lineCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  sourceLabels: string[];
};

export type StatementLinesSummary = {
  totalCount: number;
  currencies: string[];
  unassignedCount: number;
  bankAccounts: StatementLinesSummaryBankAccount[];
};

export type JournalEntriesSummary = {
  totalCount: number;
  currencies: string[];
};

type StatementLinesSummaryParams = Omit<GetStatementLinesParams, "sort" | "sortDirection" | "limit" | "offset">;
type JournalEntriesSummaryParams = Omit<GetJournalEntriesParams, "sort" | "sortDirection" | "limit" | "offset">;

function withQueryKey<T extends object, K>(query: T, queryKey: K): T & { queryKey: K } {
  return Object.assign(query, { queryKey });
}

function searchParams(params?: object) {
  const normalizedParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) normalizedParams.append(key, String(value));
  });
  const stringifiedParams = normalizedParams.toString();
  return stringifiedParams.length > 0 ? `?${stringifiedParams}` : "";
}

export const getGetStatementLinesSummaryUrl = (params?: StatementLinesSummaryParams) =>
  `/api/agaraccounting/statement-lines/summary${searchParams(params)}`;

export const getStatementLinesSummary = async (
  params?: StatementLinesSummaryParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<StatementLinesSummary> =>
  customFetch<StatementLinesSummary>(getGetStatementLinesSummaryUrl(params), { ...options, method: "GET" });

export const getGetStatementLinesSummaryQueryKey = (params?: StatementLinesSummaryParams) =>
  [`/api/agaraccounting/statement-lines/summary`, ...(params ? [params] : [])] as const;

export function useGetStatementLinesSummary<TData = StatementLinesSummary, TError = ErrorType<unknown>>(
  params?: StatementLinesSummaryParams,
  options?: { query?: UseQueryOptions<StatementLinesSummary, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryKey = options?.query?.queryKey ?? getGetStatementLinesSummaryQueryKey(params);
  const queryFn: QueryFunction<StatementLinesSummary> = ({ signal }) => getStatementLinesSummary(params, { signal });
  const queryOptions = { queryKey, queryFn, ...options?.query } as UseQueryOptions<StatementLinesSummary, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

export const getGetJournalEntriesSummaryUrl = (params?: JournalEntriesSummaryParams) =>
  `/api/agaraccounting/journal-entries/summary${searchParams(params)}`;

export const getJournalEntriesSummary = async (
  params?: JournalEntriesSummaryParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<JournalEntriesSummary> =>
  customFetch<JournalEntriesSummary>(getGetJournalEntriesSummaryUrl(params), { ...options, method: "GET" });

export const getGetJournalEntriesSummaryQueryKey = (params?: JournalEntriesSummaryParams) =>
  [`/api/agaraccounting/journal-entries/summary`, ...(params ? [params] : [])] as const;

export function useGetJournalEntriesSummary<TData = JournalEntriesSummary, TError = ErrorType<unknown>>(
  params?: JournalEntriesSummaryParams,
  options?: { query?: UseQueryOptions<JournalEntriesSummary, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryKey = options?.query?.queryKey ?? getGetJournalEntriesSummaryQueryKey(params);
  const queryFn: QueryFunction<JournalEntriesSummary> = ({ signal }) => getJournalEntriesSummary(params, { signal });
  const queryOptions = { queryKey, queryFn, ...options?.query } as UseQueryOptions<JournalEntriesSummary, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MutationFunction,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { BodyType, ErrorType } from "./custom-fetch";
import type {
  StatementLineDetailRequest,
  StatementLineDetailRequestInput,
  StatementLineNotes,
} from "./generated/api.schemas";

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

export const getRequestStatementLineDetailsUrl = () =>
  `/api/agaraccounting/statement-lines/request-details`;

export const requestStatementLineDetails = async (
  body: StatementLineDetailRequestInput,
  options?: SecondParameter<typeof customFetch>,
): Promise<StatementLineDetailRequest> => {
  return customFetch<StatementLineDetailRequest>(getRequestStatementLineDetailsUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useRequestStatementLineDetails = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof requestStatementLineDetails>>,
      TError,
      { data: BodyType<StatementLineDetailRequestInput> },
      TContext
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof requestStatementLineDetails>>,
  TError,
  { data: BodyType<StatementLineDetailRequestInput> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof requestStatementLineDetails>>,
    { data: BodyType<StatementLineDetailRequestInput> }
  > = ({ data }) => requestStatementLineDetails(data, options?.request);
  return useMutation({
    mutationKey: ["requestStatementLineDetails"],
    mutationFn,
    ...options?.mutation,
  });
};

export const getGetStatementLineNotesUrl = (id: number, clientId: number) =>
  `/api/agaraccounting/statement-lines/${id}/notes?clientId=${clientId}`;

export const getGetStatementLineNotesQueryKey = (id: number, clientId: number) =>
  [`/api/agaraccounting/statement-lines/${id}/notes`, { clientId }] as const;

export const getStatementLineNotes = async (
  id: number,
  clientId: number,
  options?: SecondParameter<typeof customFetch>,
): Promise<StatementLineNotes> => {
  return customFetch<StatementLineNotes>(getGetStatementLineNotesUrl(id, clientId), {
    ...options,
    method: "GET",
  });
};

export const useGetStatementLineNotes = <
  TData = Awaited<ReturnType<typeof getStatementLineNotes>>,
  TError = ErrorType<unknown>,
>(
  id: number,
  clientId: number,
  options?: {
    query?: Partial<
      UseQueryOptions<Awaited<ReturnType<typeof getStatementLineNotes>>, TError, TData>
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> => {
  return useQuery({
    queryKey: getGetStatementLineNotesQueryKey(id, clientId),
    queryFn: () => getStatementLineNotes(id, clientId, options?.request),
    enabled: Number.isFinite(id) && Number.isFinite(clientId) && id > 0 && clientId > 0,
    ...options?.query,
  });
};

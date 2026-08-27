import { useGetClients } from '@workspace/api-client-react';

// The web app has a full client switcher (useClientWorkspace). This is the
// minimal version for the first mobile pass: the first client in the list.
// A real switcher is tracked as a follow-up, not deferred by accident.
export function useActiveClient() {
  const query = useGetClients();
  const activeClient = query.data?.[0];
  return { activeClient, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

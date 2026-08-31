import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGetClients, type Client } from '@workspace/api-client-react';
import { ACTIVE_CLIENT_KEY, readPref, writePref } from './prefs';

// The web app keeps the selected workspace in useClientWorkspace. This is the
// mobile equivalent: one source of truth for "which client am I looking at",
// persisted so the app reopens where you left it rather than snapping back to
// whichever client happens to sort first.
type ClientContextValue = {
  clients: Client[];
  activeClient: Client | undefined;
  selectClient: (id: number) => void;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

const ClientContext = createContext<ClientContextValue | null>(null);

export function ClientProvider({ children }: { children: ReactNode }) {
  const query = useGetClients();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);

  // Restore the previous choice once, before falling back to the first client.
  useEffect(() => {
    let cancelled = false;
    readPref(ACTIVE_CLIENT_KEY).then((stored) => {
      if (cancelled) return;
      const parsed = stored === null ? Number.NaN : Number(stored);
      if (Number.isFinite(parsed)) setSelectedId(parsed);
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clients = useMemo(() => query.data ?? [], [query.data]);

  // A stored id can point at a workspace the user no longer has access to, so
  // it is only honoured when it still matches something in the list.
  const activeClient = useMemo(
    () => clients.find((client) => client.id === selectedId) ?? clients[0],
    [clients, selectedId],
  );

  const selectClient = useCallback((id: number) => {
    setSelectedId(id);
    void writePref(ACTIVE_CLIENT_KEY, String(id));
  }, []);

  const { refetch: refetchClients } = query;
  const refetch = useCallback(() => {
    void refetchClients();
  }, [refetchClients]);

  const value = useMemo<ClientContextValue>(
    () => ({
      clients,
      activeClient,
      selectClient,
      // Keep showing the loading state until the stored choice is known,
      // otherwise the first client flashes up before being replaced.
      isLoading: query.isLoading || !restored,
      isError: query.isError,
      refetch,
    }),
    [clients, activeClient, selectClient, query.isLoading, query.isError, refetch, restored],
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClientWorkspace(): ClientContextValue {
  const context = useContext(ClientContext);
  if (!context) throw new Error('useClientWorkspace must be used inside a ClientProvider');
  return context;
}

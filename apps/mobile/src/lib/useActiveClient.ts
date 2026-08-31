import { useClientWorkspace } from './ClientContext';

// Thin alias over the workspace context. Screens only ever need the selected
// client, so they read this rather than the full switcher surface.
export function useActiveClient() {
  const { activeClient, isLoading, isError, refetch } = useClientWorkspace();
  return { activeClient, isLoading, isError, refetch };
}

export const getActiveWorkspaceStorageKey = (userId: string) =>
  `ledgerflow-active-client-id:${userId}`;

export interface UserStateStorage {
  removeItem: (key: string) => void;
}

export interface UserStateCache {
  clear: () => void;
}

export type WorkspaceSelection = {
  id: number;
  legacyDemo: boolean;
};

export type WorkspaceState = 'starter' | 'configured' | 'legacy_demo';

export function selectWorkspaceForSession<T extends WorkspaceSelection>(
  workspaces: T[],
  savedWorkspaceId: number | null,
  allowLegacyDemoSelection: boolean,
) {
  const defaultWorkspace = workspaces.find((workspace) => !workspace.legacyDemo) ?? workspaces[0];
  const savedWorkspace = workspaces.find((workspace) => workspace.id === savedWorkspaceId);
  if (!savedWorkspace) return defaultWorkspace;
  if (savedWorkspace.legacyDemo && !allowLegacyDemoSelection && defaultWorkspace) return defaultWorkspace;
  return savedWorkspace;
}

export function clearUserScopedState(
  cache: UserStateCache,
  previousUserId: string | null,
  storage: UserStateStorage,
) {
  cache.clear();
  if (previousUserId) {
    storage.removeItem(getActiveWorkspaceStorageKey(previousUserId));
  }
}

export function requiresWorkspaceOnboarding<T extends WorkspaceSelection & { workspaceState: WorkspaceState }>(
  workspaces: T[],
) {
  const hasConfiguredWorkspace = workspaces.some((workspace) =>
    workspace.workspaceState === 'configured'
    || workspace.workspaceState === 'legacy_demo'
    || workspace.legacyDemo,
  );
  return !hasConfiguredWorkspace && workspaces.some((workspace) => workspace.workspaceState === 'starter');
}

export type WorkspaceLoadState = 'loading' | 'failed' | 'missing' | 'ready';

export function getWorkspaceLoadState(
  isLoading: boolean,
  isError: boolean,
  workspaces: readonly unknown[] | undefined,
): WorkspaceLoadState {
  if (isLoading) return 'loading';
  if (isError) return 'failed';
  if (!workspaces) return 'missing';
  return 'ready';
}

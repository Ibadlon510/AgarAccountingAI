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
export const getActiveWorkspaceStorageKey = (userId: string) =>
  `ledgerflow-active-client-id:${userId}`;

export interface UserStateStorage {
  removeItem: (key: string) => void;
}

export interface UserStateCache {
  clear: () => void;
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  getGetClientsQueryKey,
  getGetJournalEntriesQueryKey,
  getGetUploadedFilesQueryKey,
} from '@workspace/api-client-react';
import {
  clearUserScopedState,
  getActiveWorkspaceStorageKey,
  getWorkspaceLoadState,
  requiresWorkspaceOnboarding,
  selectWorkspaceForSession,
} from '../src/lib/user-state';
class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test('clears client and journal data when identities switch in one runtime', () => {
  const queryClient = new QueryClient();
  const storage = new MemoryStorage();
  const firstUserId = 'bookkeeper-a';
  const secondUserId = 'bookkeeper-b';
  const firstClientId = 101;
  const secondClientId = 202;
  const firstClients = [{ id: firstClientId, name: 'First client' }];
  const firstJournal = [{ id: 1, description: 'First client journal' }];
  const secondClients = [{ id: secondClientId, name: 'Second client' }];
  const secondJournal = [{ id: 2, description: 'Second client journal' }];

  storage.setItem(getActiveWorkspaceStorageKey(firstUserId), String(firstClientId));
  storage.setItem(getActiveWorkspaceStorageKey(secondUserId), String(secondClientId));
  queryClient.setQueryData(getGetClientsQueryKey(), firstClients);
  queryClient.setQueryData(
    getGetJournalEntriesQueryKey({ clientId: firstClientId }),
    firstJournal,
  );

  clearUserScopedState(queryClient, firstUserId, storage);

  assert.notEqual(
    getActiveWorkspaceStorageKey(firstUserId),
    getActiveWorkspaceStorageKey(secondUserId),
  );
  assert.equal(storage.getItem(getActiveWorkspaceStorageKey(firstUserId)), null);
  assert.equal(
    storage.getItem(getActiveWorkspaceStorageKey(secondUserId)),
    String(secondClientId),
  );
  assert.equal(queryClient.getQueryData(getGetClientsQueryKey()), undefined);
  assert.equal(
    queryClient.getQueryData(
      getGetJournalEntriesQueryKey({ clientId: firstClientId }),
    ),
    undefined,
  );

  queryClient.setQueryData(getGetClientsQueryKey(), secondClients);
  queryClient.setQueryData(
    getGetJournalEntriesQueryKey({ clientId: secondClientId }),
    secondJournal,
  );

  assert.deepEqual(queryClient.getQueryData(getGetClientsQueryKey()), secondClients);
  assert.deepEqual(
    queryClient.getQueryData(
      getGetJournalEntriesQueryKey({ clientId: secondClientId }),
    ),
    secondJournal,
  );
  assert.equal(
    (queryClient.getQueryData(getGetClientsQueryKey()) as typeof firstClients)[0]
      .name,
    'Second client',
  );
  assert.equal(
    (
      queryClient.getQueryData(
        getGetJournalEntriesQueryKey({ clientId: secondClientId }),
      ) as typeof firstJournal
    )[0].description,
    'Second client journal',
  );
});

test('defaults a remediated account away from saved demo data but allows an explicit return', () => {
  const workspaces = [
    { id: 10, legacyDemo: true },
    { id: 20, legacyDemo: false },
  ];
  assert.equal(selectWorkspaceForSession(workspaces, 10, false)?.id, 20);
  assert.equal(selectWorkspaceForSession(workspaces, 10, true)?.id, 10);
  assert.equal(selectWorkspaceForSession(workspaces, 20, false)?.id, 20);
});

test('keeps missing, failed, and ready workspace states distinct', () => {
  assert.equal(getWorkspaceLoadState(true, false, undefined), 'loading');
  assert.equal(getWorkspaceLoadState(false, true, undefined), 'failed');
  assert.equal(getWorkspaceLoadState(false, false, []), 'ready');
  assert.equal(getWorkspaceLoadState(false, false, [{ id: 1 }]), 'ready');
});

test('keeps uploaded-file history isolated by the active client query key', () => {
  const queryClient = new QueryClient();
  const firstClientId = 101;
  const secondClientId = 202;
  const firstFiles = [{ id: 1, fileName: 'first-client.csv' }];
  const secondFiles = [{ id: 2, fileName: 'second-client.pdf' }];

  const firstKey = getGetUploadedFilesQueryKey({ clientId: firstClientId });
  const secondKey = getGetUploadedFilesQueryKey({ clientId: secondClientId });
  assert.notDeepEqual(firstKey, secondKey);

  queryClient.setQueryData(firstKey, firstFiles);
  assert.deepEqual(queryClient.getQueryData(firstKey), firstFiles);
  assert.equal(queryClient.getQueryData(secondKey), undefined);

  queryClient.setQueryData(secondKey, secondFiles);
  assert.deepEqual(queryClient.getQueryData(firstKey), firstFiles);
  assert.deepEqual(queryClient.getQueryData(secondKey), secondFiles);
});

test('requires setup only when no configured or preserved workspace is available', () => {
  assert.equal(requiresWorkspaceOnboarding([
    { id: 1, legacyDemo: false, workspaceState: 'starter' },
  ]), true);
  assert.equal(requiresWorkspaceOnboarding([
    { id: 1, legacyDemo: false, workspaceState: 'configured' },
  ]), false);
  assert.equal(requiresWorkspaceOnboarding([
    { id: 1, legacyDemo: true, workspaceState: 'legacy_demo' },
    { id: 2, legacyDemo: false, workspaceState: 'starter' },
  ]), false);
});

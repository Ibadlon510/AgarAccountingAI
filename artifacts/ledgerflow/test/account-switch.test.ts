import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  getGetClientsQueryKey,
  getGetJournalEntriesQueryKey,
} from '@workspace/api-client-react';
import {
  clearUserScopedState,
  getActiveWorkspaceStorageKey,
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

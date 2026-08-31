import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePostJournalEntry,
  useUnpostJournalEntry,
  getGetJournalEntriesQueryKey,
  getGetStatementLinesQueryKey,
  getGetTrialBalanceQueryKey,
  getGetFinancialStatementsQueryKey,
  getGetLedgerOverviewQueryKey,
  type PostJournalEntryInput,
} from '@workspace/api-client-react';

// Posting rewrites the ledger, so it touches nearly every read on the app:
// the line list, the entry list, the trial balance, the statements and the
// overview totals all go stale at once.
function useInvalidateLedger(clientId: number) {
  const queryClient = useQueryClient();
  const params = { clientId };
  return useCallback(() => {
    const keys = [
      getGetJournalEntriesQueryKey(params),
      getGetStatementLinesQueryKey(params),
      getGetTrialBalanceQueryKey(params),
      getGetFinancialStatementsQueryKey(params),
      getGetLedgerOverviewQueryKey(params),
    ];
    for (const queryKey of keys) {
      void queryClient.invalidateQueries({ queryKey });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, clientId]);
}

// The API returns a 409 with a machine-readable reason when an entry cannot be
// posted as-is (a contact that no longer exists, an account that was renamed).
// Those are expected outcomes to explain, not crashes.
function describeError(error: unknown): string {
  const body = (error as { response?: { data?: unknown } } | null)?.response?.data;
  const kind = (body as { kind?: string } | undefined)?.kind;
  switch (kind) {
    case 'contact_not_found':
      return 'That contact no longer exists. Review the line on the web app and try again.';
    case 'account_not_found':
      return 'That account no longer exists. Pick a different account on the web app first.';
    case 'unbalanced':
      return "This entry doesn't balance, so it can't be posted.";
    default: {
      const message = (body as { message?: string } | undefined)?.message;
      if (typeof message === 'string' && message.length > 0) return message;
      return 'Something went wrong. Please try again.';
    }
  }
}

export function useEntryActions(clientId: number) {
  const invalidate = useInvalidateLedger(clientId);
  const [busyId, setBusyId] = useState<number | null>(null);

  const postMutation = usePostJournalEntry();
  const unpostMutation = useUnpostJournalEntry();

  const post = useCallback(
    (entryId: number, overrides?: Omit<PostJournalEntryInput, 'clientId'>, label = 'this entry') => {
      Alert.alert('Post to the ledger?', `Posting ${label} updates the trial balance and reports.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Post',
          style: 'default',
          onPress: () => {
            setBusyId(entryId);
            postMutation.mutate(
              { id: entryId, data: { clientId, ...overrides } },
              {
                onSuccess: () => invalidate(),
                onError: (error) => Alert.alert("Couldn't post", describeError(error)),
                onSettled: () => setBusyId(null),
              },
            );
          },
        },
      ]);
    },
    [clientId, invalidate, postMutation],
  );

  const unpost = useCallback(
    (entryId: number) => {
      Alert.alert('Unpost this entry?', 'It goes back to draft and stops counting toward your reports.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpost',
          style: 'destructive',
          onPress: () => {
            setBusyId(entryId);
            unpostMutation.mutate(
              { id: entryId, data: { clientId } },
              {
                onSuccess: () => invalidate(),
                onError: (error) => Alert.alert("Couldn't unpost", describeError(error)),
                onSettled: () => setBusyId(null),
              },
            );
          },
        },
      ]);
    },
    [clientId, invalidate, unpostMutation],
  );

  return { post, unpost, busyId };
}

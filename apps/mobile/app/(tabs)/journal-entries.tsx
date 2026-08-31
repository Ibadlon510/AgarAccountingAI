import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import {
  useGetJournalEntries,
  getGetJournalEntriesQueryKey,
  type JournalEntry,
} from '@workspace/api-client-react';
import { Screen } from '../../src/components/Screen';
import { Chips, StatusPill, type ChipOption } from '../../src/components/Chips';
import { LoadingState, ErrorState, EmptyState, NoClientState } from '../../src/components/StateViews';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { ActionButton } from '../../src/components/ActionButton';
import { useTheme } from '../../src/theme/useTheme';
import { fonts, spacing, radius } from '../../src/theme/tokens';
import { money, shortDate } from '../../src/lib/format';
import { useActiveClient } from '../../src/lib/useActiveClient';
import { useEntryActions } from '../../src/lib/useEntryActions';

type StatusFilter = 'all' | 'draft' | 'posted';

const FILTERS: ChipOption<StatusFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
];

function EntryRow({
  entry,
  onPost,
  onUnpost,
  busy,
}: {
  entry: JournalEntry;
  onPost: () => void;
  onUnpost: () => void;
  busy: boolean;
}) {
  const { colors } = useTheme();

  // A balanced entry has equal totals, so either side states its size.
  const total = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const debits = entry.lines.filter((line) => line.debit > 0);
  const credits = entry.lines.filter((line) => line.credit > 0);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <Text style={[styles.date, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
          {shortDate(entry.date)}
        </Text>
        <Text style={[styles.amount, { color: colors.foreground, fontFamily: fonts.monoMedium }]}>
          {money(total, entry.currency)}
        </Text>
      </View>

      <Text style={[styles.memo, { color: colors.foreground, fontFamily: fonts.sansMedium }]} numberOfLines={2}>
        {entry.memo}
      </Text>

      {entry.contactName && (
        <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: fonts.sans }]} numberOfLines={1}>
          {entry.contactName}
        </Text>
      )}

      <View style={[styles.postings, { borderTopColor: colors.border }]}>
        {debits.map((line, index) => (
          <View key={`dr-${index}`} style={styles.posting}>
            <Text style={[styles.side, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>DR</Text>
            <Text style={[styles.account, { color: colors.foreground, fontFamily: fonts.sans }]} numberOfLines={1}>
              {line.account}
            </Text>
            <Text style={[styles.postingAmount, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
              {money(line.debit, entry.currency)}
            </Text>
          </View>
        ))}
        {credits.map((line, index) => (
          <View key={`cr-${index}`} style={styles.posting}>
            <Text style={[styles.side, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>CR</Text>
            <Text style={[styles.account, { color: colors.foreground, fontFamily: fonts.sans }]} numberOfLines={1}>
              {line.account}
            </Text>
            <Text style={[styles.postingAmount, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
              {money(line.credit, entry.currency)}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.cardBottom}>
        <StatusPill status={entry.status} />
        {entry.source === 'manual' && (
          <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
            Manual
          </Text>
        )}
        {entry.functionalCurrency && entry.functionalCurrency !== entry.currency && entry.functionalAmount != null && (
          <Text style={[styles.functional, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
            ≈ {money(entry.functionalAmount, entry.functionalCurrency)}
          </Text>
        )}
        <View style={styles.actions}>
          {entry.status === 'draft' ? (
            <ActionButton label="Post" onPress={onPost} busy={busy} />
          ) : (
            <ActionButton label="Unpost" variant="quiet" onPress={onUnpost} busy={busy} />
          )}
        </View>
      </View>
    </View>
  );
}

export default function JournalEntriesScreen() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<StatusFilter>('all');
  const { activeClient, isLoading: clientLoading, isError: clientError, refetch: refetchClient } = useActiveClient();

  const params = { clientId: activeClient?.id ?? 0 };
  const entriesQuery = useGetJournalEntries(params, {
    query: { queryKey: getGetJournalEntriesQueryKey(params), enabled: Boolean(activeClient) },
  });
  const { post, unpost, busyId } = useEntryActions(activeClient?.id ?? 0);

  const all = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const visible = useMemo(
    () => (status === 'all' ? all : all.filter((entry) => entry.status === status)),
    [all, status],
  );

  const filters = useMemo<ChipOption<StatusFilter>[]>(
    () =>
      FILTERS.map((filter) => ({
        ...filter,
        count: filter.value === 'all' ? all.length : all.filter((entry) => entry.status === filter.value).length,
      })),
    [all],
  );

  if (clientLoading || (activeClient && entriesQuery.isLoading)) {
    return (
      <Screen scroll={false}>
        <LoadingState />
      </Screen>
    );
  }

  if (clientError || entriesQuery.isError) {
    return (
      <Screen scroll={false}>
        <ErrorState onRetry={() => (activeClient ? entriesQuery.refetch() : refetchClient())} />
      </Screen>
    );
  }

  if (!activeClient) {
    return (
      <Screen scroll={false}>
        <NoClientState />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FlatList
        data={visible}
        keyExtractor={(entry) => String(entry.id)}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            busy={busyId === item.id}
            onPost={() => post(item.id, undefined, `“${item.memo}”`)}
            onUnpost={() => unpost(item.id)}
          />
        )}
        contentContainerStyle={[styles.list, visible.length === 0 && styles.listEmpty]}
        refreshControl={
          <RefreshControl
            refreshing={entriesQuery.isFetching}
            onRefresh={() => entriesQuery.refetch()}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title="Journal" />
            <Chips<StatusFilter> options={filters} value={status} onChange={setStatus} />
          </View>
        }
        ListEmptyComponent={
          all.length === 0 ? (
            <EmptyState
              icon="check-square"
              title="No journal entries yet"
              body="Bank-line drafts and posted manuals appear here. Add a manual journal from the web workspace."
            />
          ) : (
            <EmptyState
              icon="filter"
              title="Nothing matches this filter"
              body={`No ${status} entries in this workspace.`}
              onClear={() => setStatus('all')}
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  listEmpty: { flexGrow: 1 },
  header: { marginBottom: spacing.xs },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 11 },
  amount: { fontSize: 15 },
  memo: { fontSize: 14, lineHeight: 19 },
  meta: { fontSize: 12 },
  postings: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, marginTop: spacing.xs, gap: spacing.xs },
  posting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  side: { fontSize: 9, width: 18 },
  account: { fontSize: 12, flex: 1 },
  postingAmount: { fontSize: 11 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  functional: { fontSize: 10 },
  actions: { marginLeft: 'auto' },
});

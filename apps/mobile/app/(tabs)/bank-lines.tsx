import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import {
  useGetStatementLines,
  getGetStatementLinesQueryKey,
  useGetJournalEntries,
  getGetJournalEntriesQueryKey,
  type StatementLine,
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

function LineRow({
  line,
  onPost,
  busy,
}: {
  line: StatementLine;
  onPost: (() => void) | null;
  busy: boolean;
}) {
  const { colors } = useTheme();
  const inflow = line.direction === 'inflow';

  // The account the line will hit once posted: the confirmed journal account
  // if there is one, otherwise whatever the AI proposed.
  const account = line.journalAccount ?? line.accountSuggestion;
  const counterparty = line.contactName ?? line.proposedContactName;

  // Mirrors the web app's "Post & create": posting an unlinked line that still
  // carries a proposed name is what turns that proposal into a real contact.
  const willCreateContact = !line.contactId && Boolean(line.proposedContactName?.trim());

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <Text style={[styles.date, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
          {shortDate(line.date)}
        </Text>
        <Text
          style={[styles.amount, { color: inflow ? colors.primary : colors.foreground, fontFamily: fonts.monoMedium }]}
        >
          {inflow ? '+' : '−'}
          {money(line.amount, line.currency)}
        </Text>
      </View>

      <Text
        style={[styles.description, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
        numberOfLines={2}
      >
        {line.description}
      </Text>

      {counterparty && (
        <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: fonts.sans }]} numberOfLines={1}>
          {counterparty}
          {line.contactId ? '' : ' · proposed'}
        </Text>
      )}

      <View style={styles.cardBottom}>
        <StatusPill status={line.status} />
        {account && (
          <Text style={[styles.account, { color: colors.mutedForeground, fontFamily: fonts.mono }]} numberOfLines={1}>
            {account}
          </Text>
        )}
        {onPost && (
          <View style={styles.actions}>
            <ActionButton
              label={willCreateContact ? 'Post & link' : 'Post'}
              onPress={onPost}
              busy={busy}
            />
          </View>
        )}
      </View>

      {line.exchangeRateStatus === 'missing' && (
        <Text style={[styles.warning, { color: colors.accent, fontFamily: fonts.sans }]}>
          Needs an exchange rate before it counts toward reporting.
        </Text>
      )}
    </View>
  );
}

export default function BankLinesScreen() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<StatusFilter>('all');
  const { activeClient, isLoading: clientLoading, isError: clientError, refetch: refetchClient } = useActiveClient();

  const params = { clientId: activeClient?.id ?? 0 };
  const enabled = Boolean(activeClient);
  const linesQuery = useGetStatementLines(params, {
    query: { queryKey: getGetStatementLinesQueryKey(params), enabled },
  });
  // A statement line is posted through its journal entry, and the line itself
  // doesn't carry that id — so the entries are needed to map one to the other.
  const entriesQuery = useGetJournalEntries(params, {
    query: { queryKey: getGetJournalEntriesQueryKey(params), enabled },
  });
  const { post, busyId } = useEntryActions(activeClient?.id ?? 0);

  const entryByLineId = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of entriesQuery.data ?? []) {
      if (entry.status === 'draft') map.set(entry.statementLineId, entry.id);
    }
    return map;
  }, [entriesQuery.data]);

  // Post applies whatever the line currently shows — the account it would hit
  // and the contact treatment as proposed. An empty proposal posts unlinked.
  const postLine = (line: StatementLine) => {
    const entryId = entryByLineId.get(line.id);
    if (entryId === undefined) return;
    post(
      entryId,
      {
        accountSuggestion: line.journalAccount ?? line.accountSuggestion ?? undefined,
        contactId: line.contactId ?? undefined,
        proposedContactName: line.contactId ? undefined : line.proposedContactName ?? undefined,
        proposedContactType: line.contactId ? undefined : line.proposedContactType ?? undefined,
        proposedContactAlias: line.contactId ? undefined : line.proposedContactAlias ?? undefined,
      },
      `“${line.description}”`,
    );
  };

  const all = useMemo(() => linesQuery.data ?? [], [linesQuery.data]);
  const visible = useMemo(
    () => (status === 'all' ? all : all.filter((line) => line.status === status)),
    [all, status],
  );

  const filters = useMemo<ChipOption<StatusFilter>[]>(
    () =>
      FILTERS.map((filter) => ({
        ...filter,
        count: filter.value === 'all' ? all.length : all.filter((line) => line.status === filter.value).length,
      })),
    [all],
  );

  if (clientLoading || (activeClient && linesQuery.isLoading)) {
    return (
      <Screen scroll={false}>
        <LoadingState />
      </Screen>
    );
  }

  if (clientError || linesQuery.isError) {
    return (
      <Screen scroll={false}>
        <ErrorState onRetry={() => (activeClient ? linesQuery.refetch() : refetchClient())} />
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
        keyExtractor={(line) => String(line.id)}
        renderItem={({ item }) => {
          const entryId = entryByLineId.get(item.id);
          return (
            <LineRow
              line={item}
              busy={entryId !== undefined && busyId === entryId}
              onPost={entryId === undefined ? null : () => postLine(item)}
            />
          );
        }}
        contentContainerStyle={[styles.list, visible.length === 0 && styles.listEmpty]}
        refreshControl={
          <RefreshControl
            refreshing={linesQuery.isFetching}
            onRefresh={() => linesQuery.refetch()}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title="Bank lines" />
            <Chips<StatusFilter> options={filters} value={status} onChange={setStatus} />
          </View>
        }
        ListEmptyComponent={
          all.length === 0 ? (
            <EmptyState
              icon="credit-card"
              title="No bank lines yet"
              body="Import a statement on the web app and the lines will show up here."
            />
          ) : (
            <EmptyState
              icon="filter"
              title="Nothing matches this filter"
              body={`No ${status} lines in this workspace.`}
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
  description: { fontSize: 14, lineHeight: 19 },
  meta: { fontSize: 12 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  account: { fontSize: 10, flexShrink: 1 },
  actions: { marginLeft: 'auto' },
  warning: { fontSize: 11, lineHeight: 16, marginTop: spacing.xs },
});

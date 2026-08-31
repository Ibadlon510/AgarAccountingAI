import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import {
  useGetTrialBalance,
  getGetTrialBalanceQueryKey,
  useGetFinancialStatements,
  getGetFinancialStatementsQueryKey,
  type StatementSection,
  type TrialBalanceRow,
} from '@workspace/api-client-react';
import { Screen } from '../../src/components/Screen';
import { Chips, type ChipOption } from '../../src/components/Chips';
import { LoadingState, ErrorState, EmptyState, NoClientState } from '../../src/components/StateViews';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useTheme } from '../../src/theme/useTheme';
import { fonts, spacing, radius } from '../../src/theme/tokens';
import { money } from '../../src/lib/format';
import { useActiveClient } from '../../src/lib/useActiveClient';

type ReportTab = 'trial-balance' | 'income' | 'balance-sheet';

const TABS: ChipOption<ReportTab>[] = [
  { value: 'trial-balance', label: 'Trial balance' },
  { value: 'income', label: 'Income' },
  { value: 'balance-sheet', label: 'Balance sheet' },
];

function TrialBalanceList({ rows, currency }: { rows: TrialBalanceRow[]; currency: string }) {
  const { colors } = useTheme();

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({ debit: acc.debit + row.debit, credit: acc.credit + row.credit }),
        { debit: 0, credit: 0 },
      ),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="bar-chart-2"
        title="Nothing to report yet"
        body="Post some journal entries and the trial balance will build itself."
      />
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((row) => (
        <View key={row.account} style={styles.tbRow}>
          <View style={styles.tbLabel}>
            <Text style={[styles.tbAccount, { color: colors.foreground, fontFamily: fonts.sans }]} numberOfLines={1}>
              {row.account}
            </Text>
            <Text style={[styles.tbCategory, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
              {row.category.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.tbAmount, { color: colors.foreground, fontFamily: fonts.mono }]}>
            {money(row.balance, row.functionalCurrency || currency)}
          </Text>
        </View>
      ))}

      <View style={[styles.tbTotal, { borderTopColor: colors.border }]}>
        <Text style={[styles.tbTotalLabel, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
          DR {money(totals.debit, currency)}
        </Text>
        <Text style={[styles.tbTotalLabel, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
          CR {money(totals.credit, currency)}
        </Text>
      </View>
    </View>
  );
}

function SectionRows({ sections, currency, depth = 0 }: { sections: StatementSection[]; currency: string; depth?: number }) {
  const { colors } = useTheme();
  return (
    <>
      {sections.map((section, index) => (
        <View key={`${depth}-${section.label}-${index}`}>
          <View style={[styles.sectionRow, { paddingLeft: depth * spacing.md }]}>
            <Text
              style={[
                styles.sectionLabel,
                {
                  color: depth === 0 ? colors.foreground : colors.mutedForeground,
                  fontFamily: depth === 0 ? fonts.sansMedium : fonts.sans,
                },
              ]}
              numberOfLines={2}
            >
              {section.label}
            </Text>
            <Text
              style={[
                styles.sectionAmount,
                {
                  color: depth === 0 ? colors.foreground : colors.mutedForeground,
                  fontFamily: depth === 0 ? fonts.monoMedium : fonts.mono,
                },
              ]}
            >
              {money(section.amount, currency)}
            </Text>
          </View>
          {section.children && section.children.length > 0 && (
            <SectionRows sections={section.children} currency={currency} depth={depth + 1} />
          )}
        </View>
      ))}
    </>
  );
}

export default function ReportsScreen() {
  const { colors } = useTheme();
  const [tab, setTab] = useState<ReportTab>('trial-balance');
  const { activeClient, isLoading: clientLoading, isError: clientError, refetch: refetchClient } = useActiveClient();

  const params = { clientId: activeClient?.id ?? 0 };
  const enabled = Boolean(activeClient);
  const trialBalanceQuery = useGetTrialBalance(params, {
    query: { queryKey: getGetTrialBalanceQueryKey(params), enabled },
  });
  const statementsQuery = useGetFinancialStatements(params, {
    query: { queryKey: getGetFinancialStatementsQueryKey(params), enabled },
  });

  const isLoading = trialBalanceQuery.isLoading || statementsQuery.isLoading;
  const isError = trialBalanceQuery.isError || statementsQuery.isError;
  const isFetching = trialBalanceQuery.isFetching || statementsQuery.isFetching;

  if (clientLoading || (activeClient && isLoading)) {
    return (
      <Screen scroll={false}>
        <LoadingState />
      </Screen>
    );
  }

  if (clientError || isError) {
    return (
      <Screen scroll={false}>
        <ErrorState
          onRetry={() => {
            if (!activeClient) {
              refetchClient();
              return;
            }
            trialBalanceQuery.refetch();
            statementsQuery.refetch();
          }}
        />
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

  const statements = statementsQuery.data;
  const rows = trialBalanceQuery.data ?? [];
  const currency = statements?.functionalCurrency ?? rows[0]?.functionalCurrency ?? 'AED';

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={() => {
              trialBalanceQuery.refetch();
              statementsQuery.refetch();
            }}
            tintColor={colors.primary}
          />
        }
      >
        <ScreenHeader title="Reports" suffix={statements?.period} />

        <Chips<ReportTab> options={TABS} value={tab} onChange={setTab} />

        {statements && statements.missingRateCount > 0 && (
          <View style={[styles.warningCard, { backgroundColor: colors.muted, borderColor: colors.accent }]}>
            <Text style={[styles.warningText, { color: colors.accentForeground, fontFamily: fonts.sans }]}>
              {statements.missingRateCount} transaction{statements.missingRateCount === 1 ? '' : 's'} still need an
              exchange rate ({statements.missingRateCurrencies.join(', ')}), so these figures are incomplete.
            </Text>
          </View>
        )}

        {statements && statements.excludedUnpostedCount > 0 && (
          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
            Excludes {statements.excludedUnpostedCount} unposted entr
            {statements.excludedUnpostedCount === 1 ? 'y' : 'ies'}.
          </Text>
        )}

        <View style={styles.tabBody}>
          {tab === 'trial-balance' && <TrialBalanceList rows={rows} currency={currency} />}

          {tab === 'income' &&
            (statements && statements.incomeStatement.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <SectionRows sections={statements.incomeStatement} currency={currency} />
              </View>
            ) : (
              <EmptyState
                icon="trending-up"
                title="No income statement yet"
                body="Post entries with revenue or expense accounts to build this report."
              />
            ))}

          {tab === 'balance-sheet' &&
            (statements && statements.balanceSheet.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <SectionRows sections={statements.balanceSheet} currency={currency} />
              </View>
            ) : (
              <EmptyState
                icon="layers"
                title="No balance sheet yet"
                body="Post entries with asset, liability or equity accounts to build this report."
              />
            ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, marginBottom: spacing.xs },
  title: { fontSize: 26, marginBottom: spacing.sm },
  tabBody: { marginTop: spacing.md },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md },
  tbRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  tbLabel: { flex: 1, gap: 2 },
  tbAccount: { fontSize: 13 },
  tbCategory: { fontSize: 9, letterSpacing: 0.6 },
  tbAmount: { fontSize: 12 },
  tbTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  tbTotalLabel: { fontSize: 11 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  sectionLabel: { fontSize: 13, flex: 1 },
  sectionAmount: { fontSize: 12 },
  warningCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  warningText: { fontSize: 12, lineHeight: 17 },
  note: { fontSize: 12, marginTop: spacing.sm },
});

import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useGetLedgerOverview, getGetLedgerOverviewQueryKey } from '@workspace/api-client-react';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useTheme } from '../../src/theme/useTheme';
import { fonts, spacing, radius } from '../../src/theme/tokens';
import { money } from '../../src/lib/format';
import { useActiveClient } from '../../src/lib/useActiveClient';

export default function OverviewScreen() {
  const { colors } = useTheme();
  const { activeClient, isLoading: clientLoading, isError: clientError, refetch: refetchClient } = useActiveClient();
  const params = { clientId: activeClient?.id ?? 0 };
  const overviewQuery = useGetLedgerOverview(params, {
    query: { queryKey: getGetLedgerOverviewQueryKey(params), enabled: Boolean(activeClient) },
  });

  if (clientLoading || (activeClient && overviewQuery.isLoading)) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (clientError || overviewQuery.isError) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <Text style={[styles.errorTitle, { color: colors.foreground, fontFamily: fonts.sansSemibold }]}>
            Couldn't load your workspace
          </Text>
          <Pressable onPress={() => (activeClient ? overviewQuery.refetch() : refetchClient())}>
            <Text style={[styles.retry, { color: colors.primary, fontFamily: fonts.sansMedium }]}>Try again</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (!activeClient) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <Text style={[styles.errorTitle, { color: colors.foreground, fontFamily: fonts.sansSemibold }]}>
            No client workspace yet
          </Text>
          <Text style={[styles.errorBody, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
            Set up a client on the web app first, then come back here.
          </Text>
        </View>
      </Screen>
    );
  }

  const overview = overviewQuery.data;

  return (
    <Screen>
      <ScreenHeader title="Overview" />

      {overview && (
        <>
          <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.heroLabel, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
              POSTED · {overview.period}
            </Text>
            <Text style={[styles.heroValue, { color: colors.foreground, fontFamily: fonts.display }]}>
              {money(overview.postedAmountFunctional, overview.functionalCurrency)}
            </Text>
            <Text style={[styles.heroSub, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
              {overview.completionPercent}% of {overview.totalLines} lines reviewed
            </Text>
          </View>

          <View style={styles.row}>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: overview.pendingReview > 0 ? colors.accent : colors.foreground, fontFamily: fonts.display }]}>
                {overview.pendingReview}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
                Pending review
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: fonts.display }]}>
                {overview.currencies.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
                {overview.currencies.length === 1 ? 'Currency' : 'Currencies'} · {overview.currencies.join(', ')}
              </Text>
            </View>
          </View>

          {overview.missingRateCount > 0 && (
            <View style={[styles.warningCard, { backgroundColor: colors.muted, borderColor: colors.accent }]}>
              <Text style={[styles.warningText, { color: colors.accentForeground, fontFamily: fonts.sans }]}>
                {overview.missingRateCount} transaction{overview.missingRateCount === 1 ? '' : 's'} need an exchange
                rate ({overview.missingRateCurrencies.join(', ')}) before they count toward reporting.
              </Text>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  errorTitle: { fontSize: 15 },
  errorBody: { fontSize: 13, textAlign: 'center' },
  retry: { fontSize: 13 },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, marginBottom: spacing.xs },
  title: { fontSize: 26, marginBottom: spacing.lg },
  heroCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  heroLabel: { fontSize: 10, letterSpacing: 1 },
  heroValue: { fontSize: 34, marginTop: spacing.sm },
  heroSub: { fontSize: 13, marginTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg },
  statValue: { fontSize: 24 },
  statLabel: { fontSize: 12, marginTop: spacing.xs },
  warningCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  warningText: { fontSize: 12, lineHeight: 17 },
});

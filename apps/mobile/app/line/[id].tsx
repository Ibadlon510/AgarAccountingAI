import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useGetStatementLines,
  getGetStatementLinesQueryKey,
  useGetJournalEntries,
  getGetJournalEntriesQueryKey,
  useGetLedgerflowAccounts,
  getGetLedgerflowAccountsQueryKey,
  useGetContacts,
  getGetContactsQueryKey,
} from '@workspace/api-client-react';
import { StatusPill } from '../../src/components/Chips';
import { LoadingState, ErrorState } from '../../src/components/StateViews';
import { ActionButton } from '../../src/components/ActionButton';
import { SearchablePicker, type PickerOption } from '../../src/components/SearchablePicker';
import { useTheme } from '../../src/theme/useTheme';
import { fonts, spacing, radius } from '../../src/theme/tokens';
import { money, shortDate } from '../../src/lib/format';
import { useActiveClient } from '../../src/lib/useActiveClient';
import { useEntryActions } from '../../src/lib/useEntryActions';

// How the contact on this line should be treated when it posts. Mirrors the
// web app's simplified workflow: link a real contact, turn the AI's proposal
// into one, or post with no contact at all.
type ContactChoice = { kind: 'existing'; id: number } | { kind: 'proposed' } | { kind: 'unlinked' };

type Editing = 'none' | 'account' | 'contact';

export default function LineDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lineId = Number(id);
  const { activeClient } = useActiveClient();
  const clientId = activeClient?.id ?? 0;
  const enabled = Boolean(activeClient);
  const params = { clientId };

  const linesQuery = useGetStatementLines(params, {
    query: { queryKey: getGetStatementLinesQueryKey(params), enabled },
  });
  const entriesQuery = useGetJournalEntries(params, {
    query: { queryKey: getGetJournalEntriesQueryKey(params), enabled },
  });
  const accountsQuery = useGetLedgerflowAccounts(params, {
    query: { queryKey: getGetLedgerflowAccountsQueryKey(params), enabled },
  });
  const contactsQuery = useGetContacts(params, {
    query: { queryKey: getGetContactsQueryKey(params), enabled },
  });
  const { post, busyId } = useEntryActions(clientId);

  const line = useMemo(
    () => (linesQuery.data ?? []).find((candidate) => candidate.id === lineId),
    [linesQuery.data, lineId],
  );
  const entry = useMemo(
    () => (entriesQuery.data ?? []).find((candidate) => candidate.statementLineId === lineId),
    [entriesQuery.data, lineId],
  );

  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => account.isActive),
    [accountsQuery.data],
  );
  const contacts = useMemo(
    () => (contactsQuery.data ?? []).filter((contact) => contact.status === 'active'),
    [contactsQuery.data],
  );

  // The account the draft entry actually classifies to: for money in it's the
  // credit side, for money out the debit side.
  const journalAccount = useMemo(() => {
    if (!entry || !line) return undefined;
    return line.direction === 'inflow'
      ? entry.lines.find((item) => item.credit > 0)?.account
      : entry.lines.find((item) => item.debit > 0)?.account;
  }, [entry, line]);

  const [accountOverride, setAccountOverride] = useState<string | null>(null);
  const [contactOverride, setContactOverride] = useState<ContactChoice | null>(null);
  const [editing, setEditing] = useState<Editing>('none');

  if (linesQuery.isLoading || entriesQuery.isLoading) {
    return (
      <Shell onBack={() => router.back()}>
        <LoadingState />
      </Shell>
    );
  }

  if (linesQuery.isError || !line) {
    return (
      <Shell onBack={() => router.back()}>
        <ErrorState
          title={line ? "Couldn't load this line" : 'That line is no longer here'}
          onRetry={linesQuery.isError ? () => linesQuery.refetch() : undefined}
        />
      </Shell>
    );
  }

  const inflow = line.direction === 'inflow';
  const posted = line.status === 'posted';

  const account = accountOverride ?? journalAccount ?? line.accountSuggestion ?? null;

  const contactChoice: ContactChoice =
    contactOverride ??
    (line.contactId
      ? { kind: 'existing', id: line.contactId }
      : line.proposedContactName?.trim()
        ? { kind: 'proposed' }
        : { kind: 'unlinked' });

  const contactLabel =
    contactChoice.kind === 'existing'
      ? contacts.find((contact) => contact.id === contactChoice.id)?.displayName ??
        line.contactName ??
        `Contact #${contactChoice.id}`
      : contactChoice.kind === 'proposed'
        ? `${line.proposedContactName} · will be created`
        : 'No contact';

  const accountOptions: PickerOption[] = accounts.map((item) => ({
    key: item.accountName,
    label: item.displayName || item.accountName,
    sublabel: item.accountCode,
  }));

  const contactOptions: PickerOption[] = [
    { key: 'unlinked', label: 'No contact', sublabel: 'Post without linking anyone' },
    ...(line.proposedContactName?.trim()
      ? [{ key: 'proposed', label: line.proposedContactName, sublabel: 'Create from the AI proposal' }]
      : []),
    ...contacts.map((contact) => ({
      key: `contact:${contact.id}`,
      label: contact.displayName,
      sublabel: contact.contactType,
    })),
  ];

  const contactOptionKey =
    contactChoice.kind === 'existing'
      ? `contact:${contactChoice.id}`
      : contactChoice.kind === 'proposed'
        ? 'proposed'
        : 'unlinked';

  const chooseContact = (key: string) => {
    if (key === 'unlinked') setContactOverride({ kind: 'unlinked' });
    else if (key === 'proposed') setContactOverride({ kind: 'proposed' });
    else setContactOverride({ kind: 'existing', id: Number(key.replace('contact:', '')) });
    setEditing('none');
  };

  const submit = () => {
    if (!entry) return;
    post(
      entry.id,
      {
        // Only send an account the workspace actually knows; otherwise leave it
        // for the server to keep whatever the draft already had.
        accountSuggestion: account && accounts.some((item) => item.accountName === account) ? account : undefined,
        contactId: contactChoice.kind === 'existing' ? contactChoice.id : undefined,
        proposedContactName: contactChoice.kind === 'proposed' ? line.proposedContactName ?? undefined : undefined,
        proposedContactType: contactChoice.kind === 'proposed' ? line.proposedContactType ?? undefined : undefined,
        proposedContactAlias: contactChoice.kind === 'proposed' ? line.proposedContactAlias ?? undefined : undefined,
      },
      `“${line.description}”`,
    );
  };

  return (
    <Shell onBack={() => router.back()}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.date, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
          {shortDate(line.date)} · {line.source}
        </Text>
        <Text style={[styles.description, { color: colors.foreground, fontFamily: fonts.display }]}>
          {line.description}
        </Text>
        <Text style={[styles.amount, { color: inflow ? colors.primary : colors.foreground, fontFamily: fonts.monoMedium }]}>
          {inflow ? '+' : '−'}
          {money(line.amount, line.currency)}
        </Text>
        <View style={styles.pillRow}>
          <StatusPill status={line.status} />
          {line.exchangeRateStatus === 'missing' && (
            <Text style={[styles.warn, { color: colors.accent, fontFamily: fonts.sans }]}>Needs an exchange rate</Text>
          )}
        </View>

        <Field
          label="ACCOUNT"
          value={account ?? 'Needs an account'}
          editable={!posted && accounts.length > 0}
          onEdit={() => setEditing(editing === 'account' ? 'none' : 'account')}
        />
        {editing === 'account' && (
          <SearchablePicker
            options={accountOptions}
            selectedKey={account}
            placeholder="Search accounts"
            onSelect={(key) => {
              setAccountOverride(key);
              setEditing('none');
            }}
            onCancel={() => setEditing('none')}
          />
        )}

        <Field
          label="CONTACT"
          value={contactLabel}
          editable={!posted}
          onEdit={() => setEditing(editing === 'contact' ? 'none' : 'contact')}
        />
        {editing === 'contact' && (
          <SearchablePicker
            options={contactOptions}
            selectedKey={contactOptionKey}
            placeholder="Search contacts"
            onSelect={chooseContact}
            onCancel={() => setEditing('none')}
          />
        )}

        {!posted && entry && (
          <View style={styles.submit}>
            <ActionButton label="Post to the ledger" onPress={submit} busy={busyId === entry.id} />
          </View>
        )}

        {!posted && !entry && (
          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
            This line has no draft entry yet, so there's nothing to post.
          </Text>
        )}
      </ScrollView>
    </Shell>
  );
}

function Field({
  label,
  value,
  editable,
  onEdit,
}: {
  label: string;
  value: string;
  editable: boolean;
  onEdit: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.field, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.fieldText}>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>{label}</Text>
        <Text style={[styles.fieldValue, { color: colors.foreground, fontFamily: fonts.sansMedium }]}>{value}</Text>
      </View>
      {editable && (
        <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Change ${label}`}>
          <Text style={[styles.change, { color: colors.primary, fontFamily: fonts.sansMedium }]}>Change</Text>
        </Pressable>
      )}
    </View>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
      </View>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  date: { fontSize: 11 },
  description: { fontSize: 22, marginTop: spacing.xs, lineHeight: 28 },
  amount: { fontSize: 26, marginTop: spacing.sm },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.lg },
  warn: { fontSize: 11 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  fieldText: { flex: 1, gap: 2 },
  fieldLabel: { fontSize: 9, letterSpacing: 1 },
  fieldValue: { fontSize: 14 },
  change: { fontSize: 12 },
  submit: { marginTop: spacing.xl, alignItems: 'flex-start' },
  note: { fontSize: 12, marginTop: spacing.lg, lineHeight: 17 },
});

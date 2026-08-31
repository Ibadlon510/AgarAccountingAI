import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { useTheme } from '../../src/theme/useTheme';
import { fonts, spacing, radius } from '../../src/theme/tokens';
import { useClientWorkspace } from '../../src/lib/ClientContext';

export default function MoreScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const { signOut } = useAuth();
  const router = useRouter();
  const { activeClient, clients } = useClientWorkspace();
  const canSwitch = clients.length > 1;

  return (
    <Screen>
      <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.display }]}>More</Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>ACCOUNT</Text>
        <Text style={[styles.cardValue, { color: colors.foreground, fontFamily: fonts.sansMedium }]}>
          {user?.primaryEmailAddress?.emailAddress ?? 'Signed in'}
        </Text>
      </View>

      {activeClient && (
        <Pressable
          onPress={() => (canSwitch ? router.push('/switch-client') : undefined)}
          disabled={!canSwitch}
          accessibilityRole={canSwitch ? 'button' : undefined}
          style={({ pressed }) => [
            styles.card,
            styles.workspaceCard,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed && canSwitch ? 0.7 : 1 },
          ]}
        >
          <View style={styles.workspaceText}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>WORKSPACE</Text>
            <Text style={[styles.cardValue, { color: colors.foreground, fontFamily: fonts.sansMedium }]}>
              {activeClient.name}
            </Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
              {activeClient.functionalCurrency} · {activeClient.basis}
              {canSwitch ? ` · ${clients.length} workspaces` : ''}
            </Text>
          </View>
          {canSwitch && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
        </Pressable>
      )}

      <Pressable
        onPress={() => signOut()}
        style={({ pressed }) => [
          styles.signOut,
          { borderColor: colors.destructive, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name="log-out" size={16} color={colors.destructive} />
        <Text style={[styles.signOutLabel, { color: colors.destructive, fontFamily: fonts.sansSemibold }]}>
          Sign out
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, marginBottom: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  workspaceCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  workspaceText: { flex: 1 },
  cardLabel: { fontSize: 10, letterSpacing: 1 },
  cardValue: { fontSize: 15, marginTop: spacing.xs },
  cardSub: { fontSize: 12, marginTop: 2 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  signOutLabel: { fontSize: 14 },
});

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme/useTheme';
import { useClientWorkspace } from '../lib/ClientContext';
import { fonts, spacing } from '../theme/tokens';

// Every data screen is scoped to one workspace, so the workspace name doubles
// as the switcher control — tapping the eyebrow opens the picker. With a
// single client there is nothing to switch to, so it stays plain text.
export function ScreenHeader({ title, suffix }: { title: string; suffix?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { activeClient, clients } = useClientWorkspace();
  const canSwitch = clients.length > 1;

  const label = `${activeClient?.name.toUpperCase() ?? ''}${suffix ? ` · ${suffix}` : ''}`;

  return (
    <View style={styles.header}>
      {canSwitch ? (
        <Pressable
          onPress={() => router.push('/switch-client')}
          accessibilityRole="button"
          accessibilityLabel={`Switch workspace. Currently ${activeClient?.name ?? 'none'}`}
          hitSlop={8}
          style={styles.eyebrowRow}
        >
          <Text style={[styles.eyebrow, { color: colors.accent, fontFamily: fonts.mono }]} numberOfLines={1}>
            {label}
          </Text>
          <Feather name="chevron-down" size={12} color={colors.accent} />
        </Pressable>
      ) : (
        <Text style={[styles.eyebrow, { color: colors.accent, fontFamily: fonts.mono }]} numberOfLines={1}>
          {label}
        </Text>
      )}
      <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.display }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.sm },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, marginBottom: spacing.xs, flexShrink: 1 },
  title: { fontSize: 26, marginBottom: spacing.sm },
});

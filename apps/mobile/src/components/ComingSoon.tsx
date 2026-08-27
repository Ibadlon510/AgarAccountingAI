import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Screen } from './Screen';
import { useTheme } from '../theme/useTheme';
import { fonts, spacing, radius } from '../theme/tokens';

export function ComingSoon({
  icon,
  eyebrow,
  title,
  body,
}: {
  icon: keyof typeof Feather.glyphMap;
  eyebrow: string;
  title: string;
  body: string;
}) {
  const { colors } = useTheme();
  return (
    <Screen scroll={false}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
          <Feather name={icon} size={22} color={colors.primary} />
        </View>
        <Text style={[styles.eyebrow, { color: colors.accent, fontFamily: fonts.mono }]}>{eyebrow}</Text>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.display }]}>{title}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>{body}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.xs },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  eyebrow: { fontSize: 10, letterSpacing: 1.5 },
  title: { fontSize: 22, marginTop: spacing.xs, textAlign: 'center' },
  body: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: spacing.xs, maxWidth: 280 },
});

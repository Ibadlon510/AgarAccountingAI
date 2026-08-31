// Shared loading / error / empty states. The web app centralises this in
// QueryState (artifacts/agaraccounting/src/App.tsx); these are the mobile
// equivalents so every screen fails and empties the same way.
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { fonts, spacing, radius } from '../theme/tokens';

export function LoadingState() {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function ErrorState({ onRetry, title = "Couldn't load this" }: { onRetry?: () => void; title?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.sansSemibold }]}>{title}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={[styles.action, { color: colors.primary, fontFamily: fonts.sansMedium }]}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  onClear,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  onClear?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={20} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.sansSemibold }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>{body}</Text>
      {onClear && (
        <Pressable onPress={onClear} hitSlop={8}>
          <Text style={[styles.action, { color: colors.primary, fontFamily: fonts.sansMedium }]}>Clear filters</Text>
        </Pressable>
      )}
    </View>
  );
}

export function NoClientState() {
  return (
    <EmptyState
      icon="briefcase"
      title="No client workspace yet"
      body="Set up a client on the web app first, then come back here."
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xl },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 15, textAlign: 'center' },
  body: { fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 280 },
  action: { fontSize: 13, marginTop: spacing.sm },
});

import { Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { fonts, spacing, radius } from '../theme/tokens';

export function ActionButton({
  label,
  onPress,
  busy = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  variant?: 'primary' | 'quiet';
}) {
  const { colors } = useTheme();
  const primary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.primary : 'transparent',
          borderColor: primary ? colors.primary : colors.border,
          opacity: busy ? 0.6 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={primary ? colors.primaryForeground : colors.mutedForeground} />
      ) : (
        <Text
          style={[
            styles.label,
            { color: primary ? colors.primaryForeground : colors.mutedForeground, fontFamily: fonts.sansMedium },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 84,
    minHeight: 34,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 12 },
});

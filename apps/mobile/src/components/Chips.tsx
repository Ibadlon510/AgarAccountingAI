// A single row of filter chips. Deliberately the only filter affordance on
// mobile: the web app's multi-select filter bar is too much for a phone, so
// each list screen exposes one axis (status) and relies on search-free
// scanning for the rest.
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { fonts, spacing, radius } from '../theme/tokens';

export type ChipOption<T extends string> = { value: T; label: string; count?: number };

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.primary : colors.card,
                borderColor: active ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color: active ? colors.primaryForeground : colors.mutedForeground,
                  fontFamily: active ? fonts.sansMedium : fonts.sans,
                },
              ]}
            >
              {option.label}
              {option.count === undefined ? '' : ` ${option.count}`}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function StatusPill({ status }: { status: string }) {
  const { colors } = useTheme();
  const posted = status === 'posted';
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: posted ? colors.muted : colors.secondary, borderColor: colors.border },
      ]}
    >
      <Text
        style={[styles.pillText, { color: posted ? colors.primary : colors.mutedForeground, fontFamily: fonts.mono }]}
      >
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12 },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 9, letterSpacing: 0.8 },
});

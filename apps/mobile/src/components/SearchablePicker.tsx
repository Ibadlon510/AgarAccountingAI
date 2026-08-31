import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { fonts, spacing, radius } from '../theme/tokens';

export type PickerOption = { key: string; label: string; sublabel?: string };

// Chart-of-accounts and contact lists get long, so picking one on a phone
// needs filtering rather than a scroll to the bottom. Rendered inline inside
// the line detail rather than as its own route, so the choice stays visible
// next to the line it applies to.
export function SearchablePicker({
  options,
  selectedKey,
  onSelect,
  onCancel,
  placeholder,
}: {
  options: PickerOption[];
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  onCancel: () => void;
  placeholder: string;
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.sublabel ?? ''}`.toLowerCase().includes(needle),
    );
  }, [options, search]);

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Feather name="search" size={14} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.searchInput, { color: colors.foreground, fontFamily: fonts.sans }]}
        />
        <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.cancel, { color: colors.primary, fontFamily: fonts.sansMedium }]}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <Text style={[styles.none, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
            Nothing matches “{search.trim()}”.
          </Text>
        ) : (
          filtered.map((option) => {
            const active = option.key === selectedKey;
            return (
              <Pressable
                key={option.key}
                onPress={() => onSelect(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.option, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={styles.optionText}>
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: colors.foreground, fontFamily: active ? fonts.sansMedium : fonts.sans },
                    ]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {option.sublabel && (
                    <Text
                      style={[styles.optionSub, { color: colors.mutedForeground, fontFamily: fonts.mono }]}
                      numberOfLines={1}
                    >
                      {option.sublabel}
                    </Text>
                  )}
                </View>
                {active && <Feather name="check" size={15} color={colors.primary} />}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 2 },
  cancel: { fontSize: 12 },
  list: { maxHeight: 260 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md - 2 },
  optionText: { flex: 1, gap: 1 },
  optionLabel: { fontSize: 13 },
  optionSub: { fontSize: 10 },
  none: { fontSize: 12, padding: spacing.md },
});

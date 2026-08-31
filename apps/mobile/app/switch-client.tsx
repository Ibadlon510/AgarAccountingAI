import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/useTheme';
import { useClientWorkspace } from '../src/lib/ClientContext';
import { fonts, spacing, radius } from '../src/theme/tokens';

export default function SwitchClientScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { clients, activeClient, selectClient } = useClientWorkspace();

  const choose = (id: number) => {
    selectClient(id);
    router.back();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.display }]}>Workspace</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Feather name="x" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <FlatList
        data={clients}
        keyExtractor={(client) => String(client.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const active = item.id === activeClient?.id;
          return (
            <Pressable
              onPress={() => choose(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: colors.card,
                  borderColor: active ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: colors.foreground, fontFamily: fonts.sansMedium }]}>
                  {item.name}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
                  {item.functionalCurrency} · {item.basis} · {item.period}
                </Text>
              </View>
              {active && <Feather name="check" size={16} color={colors.primary} />}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  title: { fontSize: 24 },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15 },
  meta: { fontSize: 12 },
});

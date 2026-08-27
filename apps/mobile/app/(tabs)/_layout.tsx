import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/useTheme';
import { fonts } from '../../src/theme/tokens';

export default function TabsLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const { colors } = useTheme();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="bank-lines"
        options={{ title: 'Bank Lines', tabBarIcon: ({ color, size }) => <Feather name="credit-card" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="journal-entries"
        options={{ title: 'Journal', tabBarIcon: ({ color, size }) => <Feather name="check-square" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <Feather name="more-horizontal" color={color} size={size} /> }}
      />
    </Tabs>
  );
}

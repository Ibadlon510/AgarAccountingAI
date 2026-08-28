import type { ComponentProps } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/useTheme';
import { fonts } from '../../src/theme/tokens';

function tabIcon(name: ComponentProps<typeof Feather>['name']) {
  return ({ color, size }: { color: string; size: number }) => (
    <Feather name={name} color={color} size={size} />
  );
}

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
      <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="bank-lines" options={{ title: 'Bank Lines', tabBarIcon: tabIcon('credit-card') }} />
      <Tabs.Screen name="journal-entries" options={{ title: 'Journal', tabBarIcon: tabIcon('check-square') }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: tabIcon('bar-chart-2') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more-horizontal') }} />
    </Tabs>
  );
}

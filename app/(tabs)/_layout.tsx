import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { C } from '../../src/theme';

/**
 * Withering and fermentation are separate destinations, as specified.
 *
 * The bottom inset matters: with three-button navigation the system bar sits
 * over the bottom of the screen, and a fixed-height tab bar puts our targets
 * underneath Android's. insets.bottom is 0 on gesture navigation and around
 * 48dp with buttons, so this adapts per phone rather than guessing.
 */
export default function TabsLayout() {
  const unread = useStore((s) => s.alerts.length);
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.shell,
          borderTopColor: C.line,
          height: 62 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 6,
        },
        tabBarActiveTintColor: C.hot,
        tabBarInactiveTintColor: C.ink3,
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '500' },
        sceneStyle: { backgroundColor: C.shell },
      }}
    >
      <Tabs.Screen
        name="withering"
        options={{
          title: 'Withering',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>≈</Text>,
        }}
      />
      <Tabs.Screen
        name="fermentation"
        options={{
          title: 'Fermentation',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◍</Text>,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: C.warm, color: C.shell, fontSize: 10 },
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◔</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚙</Text>,
        }}
      />
    </Tabs>
  );
}

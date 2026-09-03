import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { useStore } from '../../src/store';
import { C } from '../../src/theme';

/** Withering and fermentation are separate destinations, as specified. */
export default function TabsLayout() {
  const unread = useStore((s) => s.alerts.length);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.shell, borderTopColor: C.line, height: 62, paddingTop: 6 },
        tabBarActiveTintColor: C.hot,
        tabBarInactiveTintColor: C.ink3,
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '500' },
        sceneStyle: { backgroundColor: C.shell },
      }}
    >
      <Tabs.Screen
        name="withering"
        options={{ title: 'Withering', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>≈</Text> }}
      />
      <Tabs.Screen
        name="fermentation"
        options={{ title: 'Fermentation', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>◍</Text> }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: C.warm, color: C.shell, fontSize: 10 },
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>◔</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>⚙</Text> }}
      />
    </Tabs>
  );
}

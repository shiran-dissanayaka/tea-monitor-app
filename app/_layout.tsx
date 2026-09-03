import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useStore } from '../src/store';
import { C } from '../src/theme';

export default function RootLayout() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: C.shell, justifyContent: 'center' }}>
        <ActivityIndicator color={C.hot} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.shell } }} />
    </>
  );
}

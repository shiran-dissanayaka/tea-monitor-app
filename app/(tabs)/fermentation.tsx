import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import ProcessScreen from '../../src/components/ProcessScreen';
import { C } from '../../src/theme';

export default function Fermentation() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.shell }} edges={['top']}>
      <ProcessScreen process="fermentation" />
    </SafeAreaView>
  );
}

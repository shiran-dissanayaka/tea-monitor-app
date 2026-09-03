import React, { useMemo } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fmtClock } from '../../src/alerts/engine';
import { AlertKind, ThermalAlert } from '../../src/data/types';
import { useStore } from '../../src/store';
import { C } from '../../src/theme';

/** The pip colour encodes the kind of event, so the list is scannable. */
const PIP: Record<AlertKind, string> = {
  started: C.hot,
  ended: C.coolSoft,
  out_of_band: C.warm,
  data_stopped: C.ink3,
  data_resumed: C.ink3,
};

const dayLabel = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const yday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
};

export default function Alerts() {
  const alerts = useStore((s) => s.alerts);

  const sections = useMemo(() => {
    const groups: Record<string, ThermalAlert[]> = {};
    for (const a of alerts) (groups[dayLabel(a.at)] ??= []).push(a);
    return Object.entries(groups).map(([title, data]) => ({ title, data }));
  }, [alerts]);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.head}>
        <Text style={s.title}>Alerts</Text>
        <Text style={s.sub}>Both processes, newest first</Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(a) => a.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <Text style={s.empty}>
            Nothing yet. Alerts appear here as runs start and finish.
          </Text>
        }
        renderSectionHeader={({ section }) => <Text style={s.day}>{section.title}</Text>}
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={[s.pip, { backgroundColor: PIP[item.kind] }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{item.title}</Text>
              <Text style={s.rowBody}>{item.body}</Text>
            </View>
            <Text style={s.time}>{fmtClock(item.at)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.shell, paddingHorizontal: 18 },
  head: { marginTop: 8, marginBottom: 6 },
  title: { color: C.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  sub: { color: C.ink2, fontSize: 13.5, marginTop: 2 },
  day: { color: C.ink3, fontSize: 12.5, paddingTop: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line },
  pip: { width: 10, height: 10, borderRadius: 3, marginTop: 6 },
  rowTitle: { color: C.ink, fontSize: 14.5, fontWeight: '600', marginBottom: 2 },
  rowBody: { color: C.ink2, fontSize: 13, lineHeight: 19 },
  time: { color: C.ink3, fontSize: 12, paddingTop: 2 },
  empty: { color: C.ink2, fontSize: 14, lineHeight: 21, paddingTop: 40, textAlign: 'center' },
});

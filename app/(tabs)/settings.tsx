import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { dataSource } from '../../src/data';
import { Process } from '../../src/data/types';
import { useStore } from '../../src/store';
import { C, RADIUS } from '../../src/theme';

function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {note ? <Text style={s.rowNote}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: C.panel2, true: C.hot }}
      thumbColor={value ? C.panel2 : C.ink3}
    />
  );
}

function Stepper({
  value, onChange, step = 0.5, unit = '°C', dp = 1,
}: { value: number; onChange: (v: number) => void; step?: number; unit?: string; dp?: number }) {
  return (
    <View style={s.stepper}>
      <Pressable style={s.stepBtn} onPress={() => onChange(+(value - step).toFixed(2))}>
        <Text style={s.stepGlyph}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{value.toFixed(dp)} {unit}</Text>
      <Pressable style={s.stepBtn} onPress={() => onChange(+(value + step).toFixed(2))}>
        <Text style={s.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

export default function Settings() {
  const settings = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const allowed = useStore((st) => st.notificationsAllowed);

  const setBand = (p: Process, key: 'low' | 'high', v: number) =>
    set({ band: { ...settings.band, [p]: { ...settings.band[p], [key]: v } } });

  const setOverride = (p: Process, v: boolean) =>
    set({ manualOverride: { ...settings.manualOverride, [p]: v } });

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <Text style={s.title}>Settings</Text>

        {!allowed && (
          <View style={s.warn}>
            <Text style={s.warnText}>
              Notifications are turned off for this app, so alerts will not reach you. Turn them on
              in the phone's app settings.
            </Text>
          </View>
        )}

        <Text style={s.group}>Tell me when</Text>
        <View style={s.card}>
          <Row title="A profile starts">
            <Toggle value={settings.onStart} onChange={(v) => set({ onStart: v })} />
          </Row>
          <Row title="A profile ends">
            <Toggle value={settings.onEnd} onChange={(v) => set({ onEnd: v })} />
          </Row>
          <Row title="Temperature leaves the band" note="Alerts once, then every 30 minutes">
            <Toggle value={settings.onOutOfBand} onChange={(v) => set({ onOutOfBand: v })} />
          </Row>
          <Row title="Readings stop arriving" note="After 10 minutes of silence">
            <Toggle value={settings.onDataStopped} onChange={(v) => set({ onDataStopped: v })} />
          </Row>
        </View>

        <Text style={s.group}>Detecting a fermentation run</Text>
        <View style={s.card}>
          <Row
            title="Start above ambient"
            note="The bed must sit this far above the measured ambient temperature."
          >
            <Stepper
              value={settings.fermentStartGap}
              onChange={(v) => set({ fermentStartGap: Math.max(0.2, v) })}
            />
          </Row>
          <Row title="Finish within" note="Run ends when the gap closes back to this.">
            <Stepper
              value={settings.fermentEndGap}
              onChange={(v) => set({ fermentEndGap: Math.max(0.1, v) })}
            />
          </Row>
          <Row title="Hold for" note="Stops a brief spike raising a false alert.">
            <Stepper
              value={settings.fermentHoldMinutes}
              onChange={(v) => set({ fermentHoldMinutes: Math.max(1, v) })}
              step={1}
              unit="min"
              dp={0}
            />
          </Row>
        </View>

        <Text style={s.group}>Fermentation band</Text>
        <View style={s.card}>
          <Row title="Lower limit">
            <Stepper value={settings.band.fermentation.low} onChange={(v) => setBand('fermentation', 'low', v)} />
          </Row>
          <Row title="Upper limit">
            <Stepper value={settings.band.fermentation.high} onChange={(v) => setBand('fermentation', 'high', v)} />
          </Row>
        </View>

        <Text style={s.group}>Withering band</Text>
        <View style={s.card}>
          <Row title="Lower limit">
            <Stepper value={settings.band.withering.low} onChange={(v) => setBand('withering', 'low', v)} />
          </Row>
          <Row title="Upper limit">
            <Stepper value={settings.band.withering.high} onChange={(v) => setBand('withering', 'high', v)} />
          </Row>
        </View>

        <Text style={s.group}>Deciding when a run starts</Text>
        <View style={s.card}>
          <Row
            title="Mark withering runs myself"
            note="Normally taken from the trough's own session flag. Turn this on to control it by hand."
          >
            <Toggle
              value={settings.manualOverride.withering}
              onChange={(v) => setOverride('withering', v)}
            />
          </Row>
          <Row title="Mark fermentation runs myself">
            <Toggle
              value={settings.manualOverride.fermentation}
              onChange={(v) => setOverride('fermentation', v)}
            />
          </Row>
        </View>

        <Text style={s.group}>Alert style</Text>
        <View style={s.card}>
          <Row title="Vibrate" note="Two long pulses">
            <Toggle value={settings.vibrate} onChange={(v) => set({ vibrate: v })} />
          </Row>
          <Row title="Sound">
            <Toggle value={settings.sound} onChange={(v) => set({ sound: v })} />
          </Row>
        </View>

        <Text style={s.group}>Data</Text>
        <View style={s.card}>
          <Row title="Source" note="Switch to the factory feed once the link is ready.">
            <Text style={{ color: C.hot, fontSize: 13.5, fontWeight: '500' }}>{dataSource.name}</Text>
          </Row>
          <Row title="Keep history for" note="Older runs are removed from this phone">
            <Text style={{ color: C.ink2, fontSize: 13.5 }}>30 days</Text>
          </Row>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.shell, paddingHorizontal: 18 },
  title: { color: C.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginTop: 8, marginBottom: 10 },
  group: { color: C.ink3, fontSize: 13, paddingLeft: 4, paddingTop: 8, paddingBottom: 8 },
  card: {
    backgroundColor: C.panel, borderColor: C.line, borderWidth: 1,
    borderRadius: RADIUS.card, marginBottom: 6, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  rowTitle: { color: C.ink, fontSize: 14.5, fontWeight: '500' },
  rowNote: { color: C.ink3, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 30, height: 30, borderRadius: RADIUS.small,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
  },
  stepGlyph: { color: C.ink2, fontSize: 16, lineHeight: 18 },
  stepValue: { color: C.ink, fontSize: 15, fontWeight: '600', minWidth: 68, textAlign: 'right' },
  warn: {
    backgroundColor: C.warm + '1A', borderColor: C.warm + '47', borderWidth: 1,
    borderRadius: RADIUS.chip, padding: 12, marginBottom: 8,
  },
  warnText: { color: C.peak, fontSize: 13, lineHeight: 19 },
});

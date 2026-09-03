import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { fmtClock, fmtDuration } from '../alerts/engine';
import { METRICS } from '../data/metrics';
import { Process, PROCESS_LABEL } from '../data/types';
import { useStore } from '../store';
import { C, RADIUS } from '../theme';
import ProfileChart from './ProfileChart';

export default function ProcessScreen({ process }: { process: Process }) {
  const { width } = useWindowDimensions();
  const state = useStore((s) => s[process]);
  const freshness = useStore((s) => s.freshnessOf(process));
  const settings = useStore((s) => s.settings);
  const markStart = useStore((s) => s.markStart);
  const markEnd = useStore((s) => s.markEnd);
  useStore((s) => s.tick); // re-render the "N seconds ago" line

  const live = freshness !== 'last_recorded';
  const profile = state.active ?? state.lastRecorded;
  const accent = live ? C.hot : C.coolSoft;
  const chartWidth = width - 36 - 30;

  if (!profile) {
    return (
      <View style={[s.screen, s.center]}>
        <Text style={s.emptyTitle}>No readings yet</Text>
        <Text style={s.emptyBody}>
          The first {PROCESS_LABEL[process].toLowerCase()} run will appear here as soon as the
          sensors report.
        </Text>
      </View>
    );
  }

  const pts = profile.points;
  const latest = pts[pts.length - 1];
  const coolest = Math.min(...pts.map((p) => p.min));
  const hottest = Math.max(...pts.map((p) => p.max));
  const elapsed = (profile.endedAt ?? Date.now()) - profile.startedAt;
  const secondsAgo = Math.round((Date.now() - (state.lastPointAt ?? Date.now())) / 1000);
  const manual = settings.manualOverride[process];

  const statusText =
    freshness === 'live'
      ? `Live, updated ${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`
      : freshness === 'stale'
        ? `Waiting for readings, none for ${fmtDuration(Date.now() - (state.lastPointAt ?? 0))}`
        : 'Nothing running. Showing the last recorded profile.';

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 28 }}>
      <View style={s.head}>
        <View>
          <Text style={s.title}>{PROCESS_LABEL[process]}</Text>
          <Text style={s.sub}>{profile.location}</Text>
        </View>
      </View>

      <View style={[s.status, { backgroundColor: accent + '1A', borderColor: accent + '47' }]}>
        <View style={[s.dot, { backgroundColor: accent }]} />
        <Text style={[s.statusText, { color: live ? C.peak : '#B6C7D4' }]}>{statusText}</Text>
      </View>

      {/* Readings, in the order Dr. Namal specified for this process. */}
      <View style={s.metrics}>
        {METRICS[process].map((m) => {
          const value = m.read(latest);
          const isState = m.tone === 'state';
          const on = isState && m.active?.(latest);
          const valueColour = !live
            ? C.ink
            : isState
              ? on ? C.hot : C.ink3
              : C.ink;
          return (
            <View key={m.key} style={s.metricRow}>
              <Text style={s.metricLabel}>{m.label}</Text>
              <View
                style={[
                  s.metricBox,
                  isState && on && live && { borderColor: C.hot + '66', backgroundColor: C.hot + '14' },
                ]}
              >
                <Text style={[s.metricValue, { color: value == null ? C.ink3 : valueColour }]}>
                  {value ?? 'not reported'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>{live ? 'Profile' : 'Last recorded'}</Text>
          <Text style={s.cardMeta}>
            {fmtClock(profile.startedAt)}
            {profile.endedAt ? ` to ${fmtClock(profile.endedAt)}` : ' to now'}
          </Text>
        </View>
        <Text style={s.chartNote}>Shaded band shows coolest to hottest pixel</Text>
        <ProfileChart points={pts} width={chartWidth} live={live} />

        <View style={s.runStrip}>
          <View>
            <Text style={s.mmLabel}>coolest</Text>
            <Text style={[s.mmValue, { color: C.coolSoft }]}>{coolest.toFixed(1)} °C</Text>
          </View>
          <View>
            <Text style={s.mmLabel}>{live ? 'hottest' : 'peak'}</Text>
            <Text style={[s.mmValue, { color: C.warm }]}>{hottest.toFixed(1)} °C</Text>
          </View>
          <View>
            <Text style={s.mmLabel}>{live ? 'running' : 'lasted'}</Text>
            <Text style={[s.mmValue, { color: C.ink }]}>{fmtDuration(elapsed)}</Text>
          </View>
        </View>
      </View>

      {!live && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Why you are seeing this</Text>
          <Text style={s.explain}>
            The last reading arrived {fmtDuration(Date.now() - (profile.endedAt ?? 0))} ago and no
            run is loaded. The app will switch back to live on its own once readings resume.
          </Text>
        </View>
      )}

      {manual && (
        <Pressable
          style={[s.manual, { borderColor: accent }]}
          onPress={() => (state.active ? markEnd(process) : markStart(process))}
        >
          <Text style={[s.manualText, { color: accent }]}>
            {state.active ? 'Mark run finished' : 'Mark run started'}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.shell, paddingHorizontal: 18 },
  center: { justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { color: C.ink, fontSize: 19, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: C.ink2, fontSize: 14, textAlign: 'center', lineHeight: 21 },

  head: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 14 },
  title: { color: C.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  sub: { color: C.ink2, fontSize: 13.5, marginTop: 2 },

  status: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 9, paddingHorizontal: 13,
    borderRadius: RADIUS.chip, borderWidth: 1, marginBottom: 16,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13.5, flex: 1 },

  metrics: { gap: 10, marginBottom: 18 },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  metricLabel: { color: C.ink, fontSize: 15.5, fontWeight: '500' },
  metricBox: {
    minWidth: 118,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: RADIUS.chip,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'flex-end',
  },
  metricValue: { fontSize: 20, fontWeight: '600', letterSpacing: -0.4 },

  card: {
    backgroundColor: C.panel, borderColor: C.line, borderWidth: 1,
    borderRadius: RADIUS.card, padding: 15, marginBottom: 14,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { color: C.ink, fontSize: 14.5, fontWeight: '600' },
  cardMeta: { color: C.ink3, fontSize: 12.5 },
  chartNote: { color: C.ink3, fontSize: 12.5, marginTop: 2, marginBottom: 10 },
  explain: { color: C.ink2, fontSize: 13, lineHeight: 20, marginTop: 6 },

  runStrip: {
    flexDirection: 'row', gap: 24,
    marginTop: 14, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  mmLabel: { color: C.ink2, fontSize: 12.5 },
  mmValue: { fontSize: 18, fontWeight: '600', letterSpacing: -0.3, marginTop: 1 },

  manual: { borderWidth: 1, borderRadius: RADIUS.chip, paddingVertical: 13, alignItems: 'center' },
  manualText: { fontSize: 14.5, fontWeight: '600' },
});

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtClock, fmtDuration } from '../alerts/engine';
import { METRICS } from '../data/metrics';
import { hasBand, Process, PROCESS_LABEL, ThermalPoint } from '../data/types';
import { useStore } from '../store';
import { C, RADIUS } from '../theme';
import ProfileChart from './ProfileChart';
import { Screen, useLayout } from './Screen';

type Window = 'today' | 'full';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export default function ProcessScreen({ process }: { process: Process }) {
  const { contentWidth, wide } = useLayout();
  const state = useStore((s) => s[process]);
  const freshness = useStore((s) => s.freshnessOf(process));
  const settings = useStore((s) => s.settings);
  const markStart = useStore((s) => s.markStart);
  const markEnd = useStore((s) => s.markEnd);
  useStore((s) => s.tick);

  const [window, setWindow] = useState<Window>('today');

  const chartWidth = Math.max(200, contentWidth - 30);

  const running = freshness !== 'last_recorded';
  const profile = state.active ?? state.lastRecorded;
  const latest = state.latest ?? profile?.points[profile.points.length - 1] ?? null;
  const accent = running ? C.hot : C.coolSoft;

  /**
   * A run that carries over midnight — or one that has not ended when it should
   * have — makes the whole-run chart unreadable. Today's readings are the
   * default view; the full run stays one tap away.
   */
  const { shown, spansEarlierDay } = useMemo(() => {
    const all: ThermalPoint[] = profile?.points ?? [];
    const cutoff = startOfToday();
    const earlier = all.length > 0 && all[0].t < cutoff;
    if (window === 'full' || !earlier) return { shown: all, spansEarlierDay: earlier };
    const today = all.filter((p) => p.t >= cutoff);
    // Fall back to the full run rather than draw a chart from one or two points.
    return { shown: today.length >= 2 ? today : all, spansEarlierDay: earlier };
  }, [profile, window]);

  const secondsAgo = Math.round((Date.now() - (state.lastPointAt ?? Date.now())) / 1000);
  const reporting = state.lastPointAt != null && Date.now() - state.lastPointAt < 5 * 60_000;

  const statusText = running
    ? freshness === 'live'
      ? `Run in progress, updated ${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`
      : `Run in progress, no readings for ${fmtDuration(Date.now() - (state.lastPointAt ?? 0))}`
    : reporting
      ? 'Sensors reporting, no run in progress'
      : profile
        ? 'Nothing running. Showing the last recorded profile.'
        : 'No readings.';

  const band = shown.length > 0 ? hasBand(shown) : false;
  const showsAmbient = shown.length > 0 && shown.every((p) => p.ambient != null);
  const chartNote = band
    ? 'Shaded band shows coolest to hottest pixel'
    : showsAmbient
      ? 'Dashed line is ambient temperature'
      : null;

  const showingToday = window === 'today' && spansEarlierDay;

  return (
    <Screen>
      <View style={s.head}>
        <Text style={[s.title, wide && s.titleWide]}>{PROCESS_LABEL[process]}</Text>
        <Text style={s.sub}>{profile?.location ?? PROCESS_LABEL[process]}</Text>
      </View>

      {state.error && (
        <View style={s.error}>
          <Text style={s.errorTitle}>Feed problem</Text>
          <Text style={s.errorBody}>{state.error}</Text>
        </View>
      )}

      <View style={[s.status, { backgroundColor: accent + '1A', borderColor: accent + '47' }]}>
        <View style={[s.dot, { backgroundColor: accent }]} />
        <Text style={[s.statusText, { color: running ? C.peak : '#B6C7D4' }]}>{statusText}</Text>
      </View>

      {latest ? (
        <View style={s.metrics}>
          {METRICS[process].map((m) => {
            const value = m.read(latest);
            const isState = m.tone === 'state';
            const on = isState && m.active?.(latest);
            const valueColour = isState ? (on ? C.hot : C.ink3) : C.ink;
            return (
              <View key={m.key} style={s.metricRow}>
                <Text style={[s.metricLabel, wide && s.metricLabelWide]}>{m.label}</Text>
                <View
                  style={[
                    s.metricBox,
                    wide && s.metricBoxWide,
                    isState && on && { borderColor: C.hot + '66', backgroundColor: C.hot + '14' },
                  ]}
                >
                  <Text
                    style={[
                      s.metricValue,
                      wide && s.metricValueWide,
                      { color: value == null ? C.ink3 : valueColour },
                    ]}
                  >
                    {value ?? 'not reported'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={s.waiting}>Waiting for the first reading.</Text>
      )}

      {profile && shown.length >= 2 ? (
        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>{state.active ? 'Profile' : 'Last recorded run'}</Text>
            <Text style={s.cardMeta}>
              {fmtClock(shown[0].t)}
              {state.active && window !== 'today' ? ' to now' : ` to ${fmtClock(shown[shown.length - 1].t)}`}
            </Text>
          </View>

          {spansEarlierDay && (
            <View style={s.range}>
              {(['today', 'full'] as Window[]).map((w) => (
                <Pressable
                  key={w}
                  style={[s.rangeBtn, window === w && s.rangeBtnOn]}
                  onPress={() => setWindow(w)}
                >
                  <Text style={[s.rangeText, window === w && s.rangeTextOn]}>
                    {w === 'today' ? 'Today' : 'Full run'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {chartNote ? <Text style={s.chartNote}>{chartNote}</Text> : <View style={{ height: 10 }} />}
          <ProfileChart points={shown} width={chartWidth} live={!!state.active} />

          <View style={s.runStrip}>
            <View>
              <Text style={s.mmLabel}>lowest</Text>
              <Text style={[s.mmValue, { color: C.coolSoft }]}>
                {Math.min(...shown.map((p) => p.min)).toFixed(1)} °C
              </Text>
            </View>
            <View>
              <Text style={s.mmLabel}>highest</Text>
              <Text style={[s.mmValue, { color: C.warm }]}>
                {Math.max(...shown.map((p) => p.max)).toFixed(1)} °C
              </Text>
            </View>
            <View>
              <Text style={s.mmLabel}>{showingToday ? 'today' : state.active ? 'running' : 'lasted'}</Text>
              <Text style={[s.mmValue, { color: C.ink }]}>
                {fmtDuration(shown[shown.length - 1].t - shown[0].t)}
              </Text>
            </View>
          </View>

          {showingToday && (
            <Text style={s.windowNote}>
              This run began {fmtClock(profile.startedAt)} on an earlier day. Tap Full run to see all
              of it.
            </Text>
          )}
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>No completed run yet</Text>
          <Text style={s.explain}>
            {reporting
              ? 'The sensors are reporting but no run has been recorded. The profile will appear here once one starts.'
              : 'Nothing has been recorded on this phone yet.'}
          </Text>
        </View>
      )}

      {settings.manualOverride[process] && (
        <Pressable
          style={[s.manual, { borderColor: accent }]}
          onPress={() => (state.active ? markEnd(process) : markStart(process))}
        >
          <Text style={[s.manualText, { color: accent }]}>
            {state.active ? 'Mark run finished' : 'Mark run started'}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { marginBottom: 14 },
  title: { color: C.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  titleWide: { fontSize: 32 },
  sub: { color: C.ink2, fontSize: 13.5, marginTop: 2 },

  error: {
    backgroundColor: C.warm + '1A', borderColor: C.warm + '55', borderWidth: 1,
    borderRadius: RADIUS.chip, padding: 12, marginBottom: 12,
  },
  errorTitle: { color: C.warm, fontSize: 13.5, fontWeight: '600', marginBottom: 3 },
  errorBody: { color: C.peak, fontSize: 13, lineHeight: 19 },

  status: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 9, paddingHorizontal: 13,
    borderRadius: RADIUS.chip, borderWidth: 1, marginBottom: 16,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13.5, flex: 1 },

  metrics: { gap: 10, marginBottom: 18 },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  metricLabel: { color: C.ink, fontSize: 15.5, fontWeight: '500', flexShrink: 1 },
  metricLabelWide: { fontSize: 18 },
  metricBox: {
    minWidth: 118, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1,
    borderRadius: RADIUS.chip, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'flex-end',
  },
  metricBoxWide: { minWidth: 150, paddingVertical: 14 },
  metricValue: { fontSize: 20, fontWeight: '600', letterSpacing: -0.4 },
  metricValueWide: { fontSize: 24 },
  waiting: { color: C.ink2, fontSize: 14, marginBottom: 18 },

  card: {
    backgroundColor: C.panel, borderColor: C.line, borderWidth: 1,
    borderRadius: RADIUS.card, padding: 15, marginBottom: 14,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { color: C.ink, fontSize: 14.5, fontWeight: '600' },
  cardMeta: { color: C.ink3, fontSize: 12.5 },
  chartNote: { color: C.ink3, fontSize: 12.5, marginTop: 2, marginBottom: 10 },
  explain: { color: C.ink2, fontSize: 13, lineHeight: 20, marginTop: 6 },
  windowNote: { color: C.ink3, fontSize: 12, lineHeight: 17, marginTop: 10 },

  range: {
    flexDirection: 'row', gap: 6, backgroundColor: C.panel2,
    borderRadius: 11, padding: 4, marginTop: 10, marginBottom: 4,
  },
  rangeBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  rangeBtnOn: { backgroundColor: C.panel },
  rangeText: { color: C.ink2, fontSize: 13, fontWeight: '500' },
  rangeTextOn: { color: C.ink },

  runStrip: {
    flexDirection: 'row', gap: 24, marginTop: 14, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  mmLabel: { color: C.ink2, fontSize: 12.5 },
  mmValue: { fontSize: 18, fontWeight: '600', letterSpacing: -0.3, marginTop: 1 },

  manual: { borderWidth: 1, borderRadius: RADIUS.chip, paddingVertical: 13, alignItems: 'center' },
  manualText: { fontSize: 14.5, fontWeight: '600' },
});

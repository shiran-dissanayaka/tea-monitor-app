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

/** Readings older than this mean the node has gone quiet. */
const REPORTING_WINDOW_MS = 5 * 60_000;

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

  const { shown, spansEarlierDay } = useMemo(() => {
    const all: ThermalPoint[] = profile?.points ?? [];
    const cutoff = startOfToday();
    const earlier = all.length > 0 && all[0].t < cutoff;
    if (window === 'full' || !earlier) return { shown: all, spansEarlierDay: earlier };
    const today = all.filter((p) => p.t >= cutoff);
    return { shown: today.length >= 2 ? today : all, spansEarlierDay: earlier };
  }, [profile, window]);

  // The newest reading, whichever route it arrived by. Without this the screen
  // could show live values and still claim there were no readings.
  const lastReadingAt = Math.max(state.lastPointAt ?? 0, latest?.t ?? 0) || null;
  const reporting = lastReadingAt != null && Date.now() - lastReadingAt < REPORTING_WINDOW_MS;
  const secondsAgo = Math.round((Date.now() - (lastReadingAt ?? Date.now())) / 1000);

  const status = running
    ? {
        text: 'Running',
        detail:
          freshness === 'live'
            ? `updated ${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`
            : `no readings for ${fmtDuration(Date.now() - (lastReadingAt ?? 0))}`,
        colour: C.ok,
      }
    : {
        text: 'Not running',
        detail: reporting
          ? 'sensors reporting normally'
          : lastReadingAt
            ? `last reading ${fmtClock(lastReadingAt)}`
            : 'no readings yet',
        colour: C.stop,
      };

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
      {/* Centred and in the app's accent, so the tab you are on is obvious. */}
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

      <View style={[s.status, { backgroundColor: status.colour + '1A', borderColor: status.colour + '55' }]}>
        <Text style={[s.statusText, wide && s.statusTextWide, { color: status.colour }]}>
          {status.text}
        </Text>
        <Text style={s.statusDetail}>{status.detail}</Text>
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
        <View style={[s.card, s.cardHighlight]}>
          {/* The run heading carries the same weight as the page title, since
              it is the thing a supervisor came to the screen to read. */}
          <Text style={[s.runTitle, wide && s.runTitleWide]}>
            {state.active ? 'Current run' : 'Last recorded run'}
          </Text>
          <Text style={s.runRange}>
            {fmtClock(shown[0].t)}
            {state.active && window !== 'today' ? ' to now' : ` to ${fmtClock(shown[shown.length - 1].t)}`}
          </Text>

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
          <Text style={[s.runTitle, wide && s.runTitleWide]}>No completed run yet</Text>
          <Text style={s.explain}>
            {reporting
              ? 'The sensors are reporting but no run has been recorded. The profile will appear here once one starts.'
              : 'Nothing has been recorded on this phone yet.'}
          </Text>
        </View>
      )}

      {settings.manualOverride[process] && (
        <Pressable
          style={[s.manual, { borderColor: status.colour }]}
          onPress={() => (state.active ? markEnd(process) : markStart(process))}
        >
          <Text style={[s.manualText, { color: status.colour }]}>
            {state.active ? 'Mark run finished' : 'Mark run started'}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { marginBottom: 16, alignItems: 'center' },
  title: { color: C.hot, fontSize: 34, fontWeight: '700', letterSpacing: -0.6, textAlign: 'center' },
  titleWide: { fontSize: 42 },
  sub: { color: C.ink2, fontSize: 13.5, marginTop: 2, textAlign: 'center' },

  error: {
    backgroundColor: C.warm + '1A', borderColor: C.warm + '55', borderWidth: 1,
    borderRadius: RADIUS.chip, padding: 12, marginBottom: 12,
  },
  errorTitle: { color: C.warm, fontSize: 13.5, fontWeight: '600', marginBottom: 3 },
  errorBody: { color: C.peak, fontSize: 13, lineHeight: 19 },

  status: {
    alignItems: 'center',
    paddingVertical: 13, paddingHorizontal: 14,
    borderRadius: RADIUS.chip, borderWidth: 1, marginBottom: 18,
  },
  statusText: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  statusTextWide: { fontSize: 26 },
  statusDetail: { color: C.ink2, fontSize: 13, marginTop: 3, textAlign: 'center' },

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
  cardHighlight: { borderColor: C.hot + '4D', backgroundColor: C.hot + '0D' },

  runTitle: { color: C.hot, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  runTitleWide: { fontSize: 24 },
  runRange: { color: C.ink2, fontSize: 13.5, marginTop: 2 },

  chartNote: { color: C.ink3, fontSize: 12.5, marginTop: 8, marginBottom: 10 },
  explain: { color: C.ink2, fontSize: 13, lineHeight: 20, marginTop: 6 },
  windowNote: { color: C.ink3, fontSize: 12, lineHeight: 17, marginTop: 10 },

  range: {
    flexDirection: 'row', gap: 6, backgroundColor: C.panel2,
    borderRadius: 11, padding: 4, marginTop: 12, marginBottom: 2,
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

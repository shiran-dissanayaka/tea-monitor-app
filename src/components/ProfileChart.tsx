import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { ThermalPoint } from '../data/types';
import { C } from '../theme';

const H = 150;
const PAD_T = 8;
const PAD_B = 18;
/** A full withering run is ~1,700 points; downsample for drawing, keep all in the db. */
const MAX_DRAWN = 240;

function downsample(points: ThermalPoint[]): ThermalPoint[] {
  if (points.length <= MAX_DRAWN) return points;
  const step = points.length / MAX_DRAWN;
  const out: ThermalPoint[] = [];
  for (let i = 0; i < MAX_DRAWN; i++) out.push(points[Math.floor(i * step)]);
  out[out.length - 1] = points[points.length - 1];
  return out;
}

export default function ProfileChart({
  points,
  width,
  live,
}: {
  points: ThermalPoint[];
  width: number;
  live: boolean;
}) {
  const accent = live ? C.hot : C.coolSoft;

  const geom = useMemo(() => {
    const pts = downsample(points);
    if (pts.length < 2) return null;

    const lo = Math.min(...pts.map((p) => p.min)) - 0.8;
    const hi = Math.max(...pts.map((p) => p.max)) + 0.8;
    const x = (i: number) => (i / (pts.length - 1)) * width;
    const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

    const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.avg)}`).join(' ');
    const band =
      pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.max)}`).join(' ') +
      ' ' +
      [...pts].reverse().map((p, i) => `L ${x(pts.length - 1 - i)} ${y(p.min)}`).join(' ') +
      ' Z';

    const head = { x: x(pts.length - 1), y: y(pts[pts.length - 1].avg) };
    const labels = [0.15, 0.4, 0.65, 0.9].map((f) => ({
      v: (lo + (hi - lo) * (1 - f)).toFixed(1),
      y: PAD_T + f * (H - PAD_T - PAD_B) + 4,
    }));

    return { line, band, head, labels };
  }, [points, width]);

  if (!geom) {
    return <View style={{ height: H }} />;
  }

  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="band" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity={live ? 0.34 : 0.24} />
          <Stop offset="1" stopColor={C.cool} stopOpacity={live ? 0.22 : 0.14} />
        </LinearGradient>
      </Defs>

      <G stroke={C.line} strokeWidth={1}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const gy = PAD_T + f * (H - PAD_T - PAD_B);
          return <Line key={f} x1={0} y1={gy} x2={width} y2={gy} />;
        })}
      </G>

      {geom.labels.map((l) => (
        <SvgText key={l.v} x={2} y={l.y} fontSize={11} fill={C.ink3}>
          {l.v}
        </SvgText>
      ))}

      <Path d={geom.band} fill="url(#band)" />
      <Path d={geom.line} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" />

      {live && (
        <>
          <Line
            x1={geom.head.x} y1={PAD_T} x2={geom.head.x} y2={H - PAD_B}
            stroke={accent} strokeWidth={1} strokeDasharray="2 3" opacity={0.45}
          />
          <Circle cx={geom.head.x} cy={geom.head.y} r={7} fill={accent} opacity={0.18} />
          <Circle cx={geom.head.x} cy={geom.head.y} r={3.4} fill={accent} />
        </>
      )}
    </Svg>
  );
}

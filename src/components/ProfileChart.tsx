import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { hasBand, ThermalPoint } from '../data/types';
import { C } from '../theme';

const H = 150;
const PAD_T = 8;
const PAD_B = 18;
const MAX_DRAWN = 240;

function downsample(points: ThermalPoint[]): ThermalPoint[] {
  if (points.length <= MAX_DRAWN) return points;
  const step = points.length / MAX_DRAWN;
  const out: ThermalPoint[] = [];
  for (let i = 0; i < MAX_DRAWN; i++) out.push(points[Math.floor(i * step)]);
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/**
 * Vertical scale from the 2nd to 98th percentile rather than absolute min and
 * max. A single dropout reading — an ambient sensor briefly reporting 3 °C —
 * would otherwise stretch the axis across thirty degrees and flatten the real
 * variation into a straight line. Values outside the range are clamped to the
 * edge, so nothing is hidden, it just stops distorting everything else.
 */
function scaleFrom(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
  let lo = at(0.02);
  let hi = at(0.98);
  if (hi - lo < 1.5) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.75;
    hi = mid + 0.75;
  }
  return { lo: lo - 0.8, hi: hi + 0.8 };
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

    const band = hasBand(pts);
    const ambient = pts.every((p) => p.ambient != null);

    const { lo, hi } = scaleFrom([
      ...pts.map((p) => p.min),
      ...pts.map((p) => p.max),
      ...(ambient ? pts.map((p) => p.ambient!) : []),
    ]);

    const top = PAD_T;
    const bottom = H - PAD_B;
    const x = (i: number) => (i / (pts.length - 1)) * width;
    const y = (v: number) => {
      const raw = top + (1 - (v - lo) / (hi - lo)) * (bottom - top);
      return Math.min(bottom, Math.max(top, raw)); // clamp outliers to the edge
    };

    const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.avg)}`).join(' ');

    const bandPath = band
      ? pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.max)}`).join(' ') +
        ' ' +
        [...pts].reverse().map((p, i) => `L ${x(pts.length - 1 - i)} ${y(p.min)}`).join(' ') +
        ' Z'
      : null;

    const ambientPath = ambient
      ? pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.ambient!)}`).join(' ')
      : null;

    const fillPath = band ? null : line + ` L ${x(pts.length - 1)} ${bottom} L ${x(0)} ${bottom} Z`;

    const head = { x: x(pts.length - 1), y: y(pts[pts.length - 1].avg) };
    const labels = [0.12, 0.38, 0.64, 0.9].map((f) => ({
      key: f,
      v: (lo + (hi - lo) * (1 - f)).toFixed(1),
      y: top + f * (bottom - top) + 4,
    }));

    return { line, bandPath, ambientPath, fillPath, head, labels };
  }, [points, width]);

  if (!geom) return <View style={{ height: H }} />;

  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="band" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity={live ? 0.34 : 0.24} />
          <Stop offset="1" stopColor={C.cool} stopOpacity={live ? 0.18 : 0.12} />
        </LinearGradient>
      </Defs>

      <G stroke={C.line} strokeWidth={1}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const gy = PAD_T + f * (H - PAD_T - PAD_B);
          return <Line key={f} x1={0} y1={gy} x2={width} y2={gy} />;
        })}
      </G>

      {geom.labels.map((l) => (
        <SvgText key={l.key} x={2} y={l.y} fontSize={11} fill={C.ink3}>
          {l.v}
        </SvgText>
      ))}

      {geom.bandPath && <Path d={geom.bandPath} fill="url(#band)" />}
      {geom.fillPath && <Path d={geom.fillPath} fill="url(#band)" />}

      {geom.ambientPath && (
        <Path
          d={geom.ambientPath}
          fill="none"
          stroke={C.coolSoft}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          opacity={0.75}
        />
      )}

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

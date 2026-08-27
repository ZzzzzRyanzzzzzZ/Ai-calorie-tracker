import type { TrendPoint } from '../core/adaptive.ts';
import { svg } from './dom.ts';

/**
 * Charts, drawn as plain SVG.
 *
 * Two of them: scale weight against its smoothed trend, and daily intake
 * against the target. Both exist to make one point visible — that the noisy
 * series and the real signal are different things.
 */

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 26, left: 44 };

function scale(value: number, min: number, max: number, from: number, to: number): number {
  if (max === min) return (from + to) / 2;
  return from + ((value - min) / (max - min)) * (to - from);
}

export function weightChart(points: TrendPoint[]): SVGElement {
  const root = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: 'img',
    'aria-label': 'Scale weight and its smoothed trend over time',
  });
  if (points.length < 2) {
    root.appendChild(svg('text', { x: WIDTH / 2, y: HEIGHT / 2, 'text-anchor': 'middle' }, 'Log a few morning weights to see a trend.'));
    return root;
  }

  const weights = points.flatMap((p) => [p.weightKg, p.trendKg]);
  const min = Math.min(...weights) - 0.4;
  const max = Math.max(...weights) + 0.4;
  const firstIndex = points[0]?.dayIndex ?? 0;
  const lastIndex = points[points.length - 1]?.dayIndex ?? 1;

  const x = (index: number): number => scale(index, firstIndex, lastIndex, PAD.left, WIDTH - PAD.right);
  const y = (kg: number): number => scale(kg, min, max, HEIGHT - PAD.bottom, PAD.top);

  for (let i = 0; i <= 3; i += 1) {
    const value = min + ((max - min) * i) / 3;
    const yy = y(value);
    root.appendChild(svg('line', { class: 'grid', x1: PAD.left, x2: WIDTH - PAD.right, y1: yy, y2: yy }));
    root.appendChild(svg('text', { x: PAD.left - 8, y: yy + 4, 'text-anchor': 'end' }, value.toFixed(1)));
  }

  for (const point of points) {
    root.appendChild(svg('circle', { class: 'raw', cx: x(point.dayIndex), cy: y(point.weightKg), r: 2.5, opacity: 0.7 }));
  }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.dayIndex).toFixed(1)},${y(p.trendKg).toFixed(1)}`).join(' ');
  root.appendChild(svg('path', { class: 'trend', d: path }));

  const first = points[0] as TrendPoint;
  const last = points[points.length - 1] as TrendPoint;
  root.appendChild(svg('text', { x: PAD.left, y: HEIGHT - 6 }, first.date.slice(5)));
  root.appendChild(svg('text', { x: WIDTH - PAD.right, y: HEIGHT - 6, 'text-anchor': 'end' }, last.date.slice(5)));

  return root;
}

export interface IntakeBar {
  date: string;
  kcal: number;
}

export function intakeChart(bars: IntakeBar[], target: number): SVGElement {
  const root = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: 'img',
    'aria-label': 'Calories eaten each day against the daily target',
  });
  if (bars.length === 0) {
    root.appendChild(svg('text', { x: WIDTH / 2, y: HEIGHT / 2, 'text-anchor': 'middle' }, 'Nothing logged yet.'));
    return root;
  }

  const max = Math.max(target * 1.25, ...bars.map((b) => b.kcal)) * 1.05;
  const y = (kcal: number): number => scale(kcal, 0, max, HEIGHT - PAD.bottom, PAD.top);
  const slot = (WIDTH - PAD.left - PAD.right) / bars.length;
  const barWidth = Math.max(4, Math.min(34, slot * 0.62));

  for (let i = 0; i <= 2; i += 1) {
    const value = (max / 2) * i;
    const yy = y(value);
    root.appendChild(svg('line', { class: 'grid', x1: PAD.left, x2: WIDTH - PAD.right, y1: yy, y2: yy }));
    root.appendChild(svg('text', { x: PAD.left - 8, y: yy + 4, 'text-anchor': 'end' }, String(Math.round(value))));
  }

  // A day is only flagged as over when it is meaningfully over. Being forty
  // calories above a target is inside the error of the food table itself, and
  // colouring it red would make an accurate log look like a failure.
  const overLine = target * 1.05;

  bars.forEach((bar, index) => {
    const cx = PAD.left + slot * (index + 0.5);
    const top = y(bar.kcal);
    root.appendChild(svg('rect', {
      class: bar.kcal > overLine ? 'bar over' : 'bar',
      x: cx - barWidth / 2,
      y: top,
      width: barWidth,
      height: Math.max(0, HEIGHT - PAD.bottom - top),
      rx: 3,
    }));
    if (bars.length <= 16 || index % 2 === 0) {
      root.appendChild(svg('text', { x: cx, y: HEIGHT - 8, 'text-anchor': 'middle' }, bar.date.slice(8)));
    }
  });

  const targetY = y(target);
  root.appendChild(svg('line', { class: 'target-line', x1: PAD.left, x2: WIDTH - PAD.right, y1: targetY, y2: targetY }));
  root.appendChild(svg('text', { x: WIDTH - PAD.right, y: targetY - 6, 'text-anchor': 'end' }, `target ${target}`));

  return root;
}

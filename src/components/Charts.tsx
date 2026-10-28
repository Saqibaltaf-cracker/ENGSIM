import { useEffect, useId, useMemo, useRef, useState } from 'react';

const colors = {
  text: '#a4abae',
  faint: '#687074',
  grid: '#2a3033',
  orange: '#f58a52',
  mint: '#7dc8a3',
  background: '#161a1c',
};
const polar = (cx: number, cy: number, radius: number, angle: number) => ({
  x: cx + radius * Math.cos((angle * Math.PI) / 180),
  y: cy + radius * Math.sin((angle * Math.PI) / 180),
});
function arc(cx: number, cy: number, radius: number, start: number, end: number) {
  const a = polar(cx, cy, radius, start),
    b = polar(cx, cy, radius, end);
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}
function compact(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 10) return value.toFixed(0);
  if (value !== 0 && Math.abs(value) < 0.1) return Number(value.toPrecision(2)).toString();
  return value.toFixed(1).replace(/\.0$/, '');
}

export interface TachometerProps {
  rpm: number;
  redline: number;
  maxRpm?: number;
  running: boolean;
  imperial?: boolean;
}
export function Tachometer({ rpm, redline, maxRpm, running }: TachometerProps) {
  const id = useId().replace(/:/g, '');
  const maximum = maxRpm ?? Math.ceil((redline + 1000) / 1000) * 1000;
  const value = Math.max(0, Math.min(maximum, Number.isFinite(rpm) ? rpm : 0));
  const angle = 145 + (value / maximum) * 250;
  const needleEnd = polar(200, 177, 116, angle);
  const tail = polar(200, 177, 17, angle + 180);
  const minorTicks = Array.from(
    { length: Math.ceil(maximum / 250) + 1 },
    (_, index) => index * 250,
  ).filter((t) => t <= maximum);
  return (
    <svg
      className="tachometer"
      viewBox="0 0 400 315"
      role="img"
      aria-label={`${Math.round(value)} RPM. Redline ${redline} RPM.`}
      style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={`${id}-face`}>
          <stop offset="0%" stopColor="#22282b" />
          <stop offset="100%" stopColor="#15191b" />
        </radialGradient>
        <filter id={`${id}-glow`}>
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <circle cx="200" cy="177" r="141" fill={`url(#${id}-face)`} opacity=".6" />
      <path d={arc(200, 177, 136, 145, 395)} fill="none" stroke="#303638" strokeWidth="5" />
      <path
        d={arc(200, 177, 136, 145 + (Math.min(redline, maximum) / maximum) * 250, 395)}
        fill="none"
        stroke="#a84a40"
        strokeWidth="5"
      />
      {value > 0 && (
        <path
          d={arc(200, 177, 136, 145, Math.max(145.01, angle))}
          fill="none"
          stroke={value >= redline ? '#f1796d' : colors.orange}
          strokeWidth="5"
          strokeLinecap="round"
          opacity=".95"
        />
      )}
      {minorTicks.map((tick) => {
        const tickAngle = 145 + (tick / maximum) * 250;
        const isMajor = tick % 1000 === 0;
        const a = polar(200, 177, isMajor ? 119 : 125, tickAngle),
          b = polar(200, 177, 131, tickAngle);
        const label = polar(200, 177, 102, tickAngle);
        return (
          <g key={tick}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={tick >= redline ? '#da756a' : isMajor ? '#c2c8c9' : '#596164'}
              strokeWidth={isMajor ? 2 : 1}
            />
            {isMajor && (
              <text
                x={label.x}
                y={label.y}
                fill={tick >= redline ? '#e48c82' : '#aab2b5'}
                fontSize="13"
                fontFamily="ui-monospace, monospace"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {tick / 1000}
              </text>
            )}
          </g>
        );
      })}
      <text
        x="200"
        y="101"
        fill={colors.faint}
        fontSize="10"
        fontFamily="ui-monospace, monospace"
        textAnchor="middle"
        letterSpacing="1.8"
      >
        ENGINE SPEED
      </text>
      <line
        x1={tail.x}
        y1={tail.y}
        x2={needleEnd.x}
        y2={needleEnd.y}
        stroke={colors.orange}
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".3"
        filter={`url(#${id}-glow)`}
      />
      <line
        x1={tail.x}
        y1={tail.y}
        x2={needleEnd.x}
        y2={needleEnd.y}
        stroke={colors.orange}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="200" cy="177" r="8" fill="#2a3033" stroke="#f58a52" strokeWidth="1.5" />
      <circle cx="200" cy="177" r="3" fill={colors.orange} />
      <rect x="137" y="213" width="126" height="61" rx="6" fill="#15191b" />
      <text
        x="200"
        y="244"
        fill="#edf0ef"
        fontSize="37"
        fontFamily="ui-monospace, monospace"
        textAnchor="middle"
        fontWeight="500"
        letterSpacing="-2"
      >
        {Math.round(value).toLocaleString('en-US')}
      </text>
      <text x="200" y="262" fill={colors.faint} fontSize="10" textAnchor="middle" letterSpacing="2">
        RPM
      </text>
      <circle cx="170" cy="291" r="3" fill={running ? colors.mint : '#667074'} />
      <text
        x="181"
        y="294"
        fill={running ? '#9ec3ae' : '#7a8387'}
        fontSize="10"
        fontFamily="ui-monospace, monospace"
        letterSpacing="1"
      >
        {running ? 'RUNNING' : 'STANDBY'}
      </text>
    </svg>
  );
}

export interface ChartSeries {
  name: string;
  color: string;
  values: { x: number; y: number }[];
  unit?: string;
}
export interface LineChartProps {
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  height?: number;
  width?: number;
  markPeaks?: boolean;
  xMax?: number;
  yMax?: number;
  xMin?: number;
  yMin?: number;
  redline?: number;
  interactive?: boolean;
  emptyMessage?: string;
}
export function LineChart({
  series,
  xLabel,
  yLabel,
  height = 235,
  width = 620,
  markPeaks = false,
  xMax,
  yMax,
  xMin,
  yMin,
  redline,
  interactive = true,
  emptyMessage = 'Start the engine to collect live data.',
}: LineChartProps) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const left = 49,
    right = 18,
    top = 25,
    bottom = 43;
  const plotW = width - left - right,
    plotH = Math.max(40, height - top - bottom);
  const cleanSeries = useMemo(
    () =>
      series.map((item) => ({
        ...item,
        values: item.values.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      })),
    [series],
  );
  const values = cleanSeries.flatMap((s) => s.values);
  const minX = xMin ?? (values.length ? Math.min(...values.map((p) => p.x)) : 0);
  const maxX = Math.max(
    minX + 0.001,
    xMax ?? (values.length ? Math.max(...values.map((p) => p.x)) : 10),
  );
  const minY = yMin ?? Math.min(0, ...values.map((p) => p.y));
  const rawMaxY = Math.max(
    minY + 0.01,
    yMax ?? (values.length ? Math.max(...values.map((p) => p.y)) * 1.12 : 100),
  );
  const maxY = yMax ?? niceCeiling(rawMaxY);
  const x = (val: number) => left + ((val - minX) / (maxX - minX)) * plotW;
  const y = (val: number) => top + plotH - ((val - minY) / (maxY - minY)) * plotH;
  const hoverX = hover === null ? null : minX + hover * (maxX - minX);
  const nearest =
    hoverX === null
      ? []
      : cleanSeries.map((s) => ({
          ...s,
          point: s.values.reduce<{ x: number; y: number } | null>(
            (best, p) => (!best || Math.abs(p.x - hoverX) < Math.abs(best.x - hoverX) ? p : best),
            null,
          ),
        }));
  const tooltipX =
    hover === null ? 0 : Math.min(width - 170, Math.max(left + 4, left + hover * plotW + 12));
  const baseline = y(Math.max(minY, Math.min(0, maxY)));
  return (
    <div className="line-chart" style={{ position: 'relative', width: '100%', minWidth: 0 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${yLabel} versus ${xLabel}`}
        style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
        onPointerMove={
          interactive
            ? (event) => {
                const rect = svgRef.current?.getBoundingClientRect();
                if (!rect) return;
                const localX = ((event.clientX - rect.left) / rect.width) * width;
                setHover(Math.max(0, Math.min(1, (localX - left) / plotW)));
              }
            : undefined
        }
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={left} y={top} width={plotW} height={plotH} />
          </clipPath>
          {cleanSeries.map((s, i) => (
            <linearGradient key={i} id={`${id}-area-${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity=".12" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <text
          x={left}
          y="12"
          fill={colors.faint}
          fontSize="9"
          fontFamily="ui-monospace, monospace"
          letterSpacing=".7"
        >
          {yLabel}
        </text>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={width - right}
              y1={top + t * plotH}
              y2={top + t * plotH}
              stroke={colors.grid}
              strokeWidth=".7"
              strokeDasharray="3 4"
            />
            <text
              x={left - 9}
              y={top + t * plotH + 3}
              fill={colors.faint}
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              textAnchor="end"
            >
              {compact(maxY - t * (maxY - minY))}
            </text>
            <line
              x1={left + t * plotW}
              x2={left + t * plotW}
              y1={top}
              y2={top + plotH}
              stroke={colors.grid}
              strokeWidth=".6"
            />
            <text
              x={left + t * plotW}
              y={top + plotH + 18}
              fill={colors.faint}
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              textAnchor="middle"
            >
              {compact(minX + t * (maxX - minX))}
            </text>
          </g>
        ))}
        <text
          x={left + plotW / 2}
          y={height - 4}
          fill={colors.faint}
          fontSize="9"
          fontFamily="ui-monospace, monospace"
          textAnchor="middle"
          letterSpacing=".7"
        >
          {xLabel}
        </text>
        {redline !== undefined && redline >= minX && redline <= maxX && (
          <g>
            <line
              x1={x(redline)}
              x2={x(redline)}
              y1={top}
              y2={top + plotH}
              stroke="#c46961"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            <text
              x={x(redline) - 5}
              y={top + 10}
              fill="#c46961"
              textAnchor="end"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              REDLINE
            </text>
          </g>
        )}
        <g clipPath={`url(#${id}-clip)`}>
          {cleanSeries.map((s, i) => {
            if (!s.values.length) return null;
            const d = s.values
              .map((p, k) => `${k === 0 ? 'M' : 'L'} ${x(p.x).toFixed(2)} ${y(p.y).toFixed(2)}`)
              .join(' ');
            const first = s.values[0],
              last = s.values[s.values.length - 1];
            return (
              <g key={`${s.name}-${i}`}>
                {s.values.length > 1 && (
                  <path
                    d={`${d} L ${x(last.x)} ${baseline} L ${x(first.x)} ${baseline} Z`}
                    fill={`url(#${id}-area-${i})`}
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {s.values.length === 1 && (
                  <circle cx={x(first.x)} cy={y(first.y)} r="3" fill={s.color} />
                )}
              </g>
            );
          })}
        </g>
        {markPeaks &&
          cleanSeries.map((s, i) => {
            if (!s.values.length) return null;
            const peak = s.values.reduce((a, b) => (a.y > b.y ? a : b));
            if (peak.x < minX || peak.x > maxX) return null;
            const labelX = Math.min(width - right - 65, Math.max(left + 65, x(peak.x)));
            const labelY = Math.max(top + 13, y(peak.y) - 14 - (i % 2) * 16);
            return (
              <g key={`peak-${i}`} pointerEvents="none">
                <circle
                  cx={x(peak.x)}
                  cy={y(peak.y)}
                  r="4"
                  fill={colors.background}
                  stroke={s.color}
                  strokeWidth="2"
                />
                <line
                  x1={x(peak.x)}
                  x2={labelX}
                  y1={y(peak.y) - 5}
                  y2={labelY + 4}
                  stroke={s.color}
                  strokeWidth=".7"
                  opacity=".6"
                />
                <text
                  x={labelX}
                  y={labelY}
                  fill={s.color}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                  textAnchor="middle"
                  paintOrder="stroke"
                  stroke={colors.background}
                  strokeWidth="3"
                >
                  {compact(peak.y)} {s.unit ?? ''} @ {compact(peak.x)}
                </text>
              </g>
            );
          })}
        {!values.length && (
          <text
            x={left + plotW / 2}
            y={top + plotH / 2}
            fill="#889296"
            fontSize="12"
            textAnchor="middle"
          >
            {emptyMessage}
          </text>
        )}
        {hoverX !== null && values.length > 0 && (
          <g pointerEvents="none">
            <line
              x1={x(hoverX)}
              x2={x(hoverX)}
              y1={top}
              y2={top + plotH}
              stroke="#9ca5a9"
              strokeWidth=".8"
              strokeDasharray="2 3"
            />
            {nearest.map(
              (s, i) =>
                s.point && (
                  <circle
                    key={i}
                    cx={x(s.point.x)}
                    cy={y(s.point.y)}
                    r="3.5"
                    fill={colors.background}
                    stroke={s.color}
                    strokeWidth="2"
                  />
                ),
            )}
            <rect
              x={tooltipX}
              y={top + 8}
              width="156"
              height={28 + nearest.length * 20}
              rx="4"
              fill="#101416"
              stroke="#3c4548"
            />
            <text
              x={tooltipX + 10}
              y={top + 26}
              fill="#c7cecf"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              {compact(hoverX)} {xLabel}
            </text>
            {nearest.map((s, i) => (
              <text
                key={i}
                x={tooltipX + 10}
                y={top + 46 + i * 20}
                fill={s.color}
                fontSize="10"
                fontFamily="ui-monospace, monospace"
              >
                {s.name}: {s.point ? compact(s.point.y) : '—'} {s.unit ?? ''}
              </text>
            ))}
          </g>
        )}
      </svg>
      {cleanSeries.length > 0 && (
        <div
          className="chart-legend"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 18px',
            padding: '7px 10px 0 49px',
            fontSize: 10,
            color: colors.text,
          }}
        >
          {cleanSeries.map((s, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{ width: 13, height: 2, background: s.color, display: 'inline-block' }}
              />
              {s.name}
              {s.unit ? ` (${s.unit})` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function niceCeiling(value: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(0.001, value)));
  return (Math.ceil((value / power) * 2) / 2) * power;
}

export function Waveform({
  analyser,
  kind,
  active,
}: {
  analyser: AnalyserNode | null;
  kind: 'waveform' | 'spectrum';
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const context = canvas.getContext('2d');
    if (!context) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width),
        height = Math.max(1, bounds.height);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = '#293033';
      context.lineWidth = 0.7;
      for (let i = 1; i < 4; i++) {
        context.beginPath();
        context.moveTo(0, (i * height) / 4);
        context.lineTo(width, (i * height) / 4);
        context.stroke();
      }
      for (let i = 0; i <= 8; i++) {
        context.beginPath();
        context.moveTo((i * width) / 8, 0);
        context.lineTo((i * width) / 8, height);
        context.stroke();
      }
      if (analyser && active) {
        const data = new Uint8Array(
          kind === 'waveform' ? analyser.fftSize : analyser.frequencyBinCount,
        );
        if (kind === 'waveform') {
          analyser.getByteTimeDomainData(data);
          context.strokeStyle = colors.mint;
          context.lineWidth = 1.3;
          context.beginPath();
          const stride = Math.max(1, Math.floor(data.length / width));
          for (let i = 0; i < data.length; i += stride) {
            const x = (i / (data.length - 1)) * width,
              y = (data[i] / 255) * (height - 12) + 6;
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.stroke();
        } else {
          analyser.getByteFrequencyData(data);
          const count = Math.max(30, Math.min(100, Math.floor(width / 5))),
            nyquist = analyser.context.sampleRate / 2;
          for (let i = 0; i < count; i++) {
            const start = Math.max(
              1,
              Math.floor(
                ((20 * (Math.min(20000, nyquist) / 20) ** (i / count)) / nyquist) * data.length,
              ),
            );
            const end = Math.max(
              start + 1,
              Math.floor(
                ((20 * (Math.min(20000, nyquist) / 20) ** ((i + 1) / count)) / nyquist) *
                  data.length,
              ),
            );
            let peak = 0;
            for (let j = start; j < Math.min(end, data.length); j++) peak = Math.max(peak, data[j]);
            const h = (peak / 255) * (height - 8);
            context.fillStyle = `rgba(245,138,82,${0.35 + (peak / 255) * 0.55})`;
            context.fillRect((i / count) * width, height - h, Math.max(1, width / count - 2), h);
          }
        }
      } else {
        context.strokeStyle = '#566267';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();
        context.fillStyle = '#909a9e';
        context.font = '11px ui-monospace, monospace';
        context.textAlign = 'center';
        context.fillText(
          analyser ? 'Audio output paused' : 'Enable audio to inspect the signal',
          width / 2,
          height / 2 - 13,
        );
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser, kind, active]);
  return (
    <div className={`audio-plot ${kind}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          kind === 'waveform'
            ? 'Live synthesized audio waveform'
            : 'Live synthesized audio frequency spectrum'
        }
        style={{ width: '100%', height: 130, display: 'block' }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: 8,
          color: colors.faint,
          font: '9px ui-monospace, monospace',
        }}
      >
        {kind === 'waveform' ? (
          <>
            <span>−1.0</span>
            <span>
              TIME DOMAIN · {analyser ? `${analyser.context.sampleRate / 1000} kHz` : 'NO SIGNAL'}
            </span>
            <span>+1.0</span>
          </>
        ) : (
          <>
            <span>20 Hz</span>
            <span>LOG FREQUENCY · dBFS</span>
            <span>20 kHz</span>
          </>
        )}
      </div>
    </div>
  );
}

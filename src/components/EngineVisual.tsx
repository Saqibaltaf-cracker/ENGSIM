import { useRef } from 'react';
import type { EngineConfig, SimState } from '../sim/types';
export default function EngineVisual({
  config: c,
  state: s,
  phases,
}: {
  config: EngineConfig;
  state: SimState;
  phases: boolean;
}) {
  const recent = useRef<Record<number, number>>({});
  const previous = useRef({ time: s.time, id: c.id });
  if (s.time < previous.current.time || c.id !== previous.current.id) recent.current = {};
  previous.current = { time: s.time, id: c.id };
  for (const e of s.firingEvents) recent.current[e.cylinder] = e.time;
  const n = c.cylinders,
    split = (c.layout === 'v' || c.layout === 'boxer') && n > 1,
    perBank = Math.ceil(n / 2);
  const columns = split ? perBank : Math.min(n, 8),
    rows = split ? 2 : Math.ceil(n / 8),
    w = 600,
    h = rows > 1 ? 238 : 192;
  const pitch = Math.min(75, 460 / columns),
    left = 300 - ((columns - 1) * pitch) / 2;
  const getPos = (i: number) => {
    if (split) {
      const bank = i % 2,
        index = Math.floor(i / 2);
      return { x: left + index * pitch, y: bank ? 163 : 67 };
    }
    return { x: left + (i % 8) * pitch, y: rows > 1 ? 65 + Math.floor(i / 8) * 96 : 95 };
  };
  return (
    <div className="engine-visual">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${c.layout} ${n}-cylinder top-down engine, firing order ${c.firingOrder.join(', ')}`}
      >
        <defs>
          <pattern id="engine-grid" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".7" fill="#303537" />
          </pattern>
          <filter id="fire-glow">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <linearGradient id="block-fill" x2="0" y2="1">
            <stop stopColor="#272b2d" />
            <stop offset="1" stopColor="#1c2022" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={w} height={h} fill="url(#engine-grid)" />
        <rect
          x={left - 39}
          y={split ? 26 : rows > 1 ? 25 : 48}
          width={(columns - 1) * pitch + 78}
          height={split ? 179 : rows > 1 ? 174 : 94}
          rx="15"
          fill="url(#block-fill)"
          stroke="#3d4245"
        />
        {split && (
          <>
            <path
              d={`M ${left - 24} 115 H ${left + (columns - 1) * pitch + 24}`}
              stroke="#454b4f"
              strokeWidth="13"
            />
            <path
              d={`M ${left - 24} 115 H ${left + (columns - 1) * pitch + 24}`}
              stroke="#747b7e"
              strokeWidth="1"
              strokeDasharray="4 8"
            />
            <text x={left - 53} y="72" fill="#717b80" fontSize="8" textAnchor="end">
              BANK 1
            </text>
            <text x={left - 53} y="169" fill="#717b80" fontSize="8" textAnchor="end">
              BANK 2
            </text>
          </>
        )}
        {Array.from({ length: n }, (_, i) => {
          const { x, y } = getPos(i);
          const cycle = (s.crankAngle - c.firingAngles[i] + 720) % 720;
          const firing =
            s.status !== 'off' &&
            s.status !== 'stalled' &&
            s.status !== 'failed' &&
            s.time - (recent.current[i + 1] ?? -100) >= 0 &&
            s.time - (recent.current[i + 1] ?? -100) < 0.048;
          const color = firing ? '#ef8d55' : '#606b71';
          const phase =
            cycle < 180 ? 'POWER' : cycle < 360 ? 'EXHAUST' : cycle < 540 ? 'INTAKE' : 'COMPRESS';
          return (
            <g key={i}>
              {firing && (
                <circle
                  cx={x}
                  cy={y}
                  r="28"
                  fill="#ed8343"
                  opacity=".22"
                  filter="url(#fire-glow)"
                />
              )}
              <rect
                x={x - 25}
                y={y - 34}
                width="50"
                height="68"
                rx="7"
                fill="#14181a"
                stroke={firing ? '#c87948' : '#454d51'}
                strokeWidth="1.3"
              />
              {[-1, 1].map((d) => (
                <path
                  key={d}
                  d={`M ${x - 30} ${y + d * 22} h 4 m 52 0 h 4`}
                  stroke="#6b7478"
                  strokeWidth="2"
                />
              ))}
              <circle cx={x} cy={y} r="20" fill={firing ? '#3c2b22' : '#202527'} stroke={color} />
              <circle cx={x} cy={y} r="15" fill="none" stroke={color} strokeOpacity=".45" />
              <path
                d={`M ${x - 10} ${y - 7} h 20 M ${x - 10} ${y + 7} h 20`}
                stroke={color}
                strokeWidth="2"
                opacity=".3"
              />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fontSize="12"
                fontFamily="monospace"
                fill={firing ? '#ffba86' : '#bac3c7'}
              >
                {i + 1}
              </text>
              {phases && (
                <text
                  x={x}
                  y={y + 46}
                  textAnchor="middle"
                  fill={firing ? '#eaae83' : '#899499'}
                  fontSize="7"
                >
                  {phase}
                </text>
              )}
            </g>
          );
        })}
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([x, y], i) => (
          <circle
            key={i}
            cx={x === -1 ? left - 30 : left + (columns - 1) * pitch + 30}
            cy={y === -1 ? (split ? 35 : rows > 1 ? 34 : 57) : split ? 196 : rows > 1 ? 190 : 133}
            r="2.5"
            fill="#16191b"
            stroke="#62696c"
          />
        ))}
        <text x="300" y={h - 8} textAnchor="middle" fill="#737d82" fontSize="8" letterSpacing="1.5">
          {c.layout === 'v' ? `${c.bankAngle}° V` : c.layout.toUpperCase()} · {c.cylinders}{' '}
          CYLINDERS · FOUR-STROKE
        </text>
      </svg>
      <div className="firing-sequence">
        <span>FIRING ORDER</span>
        {c.firingOrder.map((n, i) => (
          <span
            className={
              s.time - (recent.current[n] ?? -100) >= 0 &&
              s.time - (recent.current[n] ?? -100) < 0.048 &&
              s.rpm > 100
                ? 'fired'
                : ''
            }
            key={n}
          >
            <b>{n}</b>
            {i < c.firingOrder.length - 1 && <i>–</i>}
          </span>
        ))}
        <span className="cycle-tag">720° CYCLE</span>
      </div>
    </div>
  );
}

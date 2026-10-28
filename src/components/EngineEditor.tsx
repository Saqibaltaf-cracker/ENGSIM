import { useEffect, useState } from 'react';
import type { EngineConfig } from '../sim/types';
import { Field, Range, Section, SelectField } from './Controls';
import { displacement, validateConfig } from '../sim';
import { AlertTriangle, ExternalLink } from 'lucide-react';
export default function EngineEditor({
  config: c,
  onChange,
  imperial,
  advanced = false,
}: {
  config: EngineConfig;
  onChange: (c: EngineConfig) => void;
  imperial: boolean;
  advanced?: boolean;
}) {
  const set = (key: keyof EngineConfig, value: unknown) => onChange({ ...c, [key]: value });
  const [order, setOrder] = useState(c.firingOrder.join('–')),
    [angles, setAngles] = useState(c.firingAngles.join(', ')),
    [orderError, setOrderError] = useState('');
  useEffect(() => {
    setOrder(c.firingOrder.join('–'));
    setAngles(c.firingAngles.join(', '));
    setOrderError('');
  }, [c.firingOrder, c.firingAngles]);
  const problems = validateConfig(c);
  const lengthFactor = imperial ? 1 / 25.4 : 1;
  const num = (
    key: keyof EngineConfig,
    label: string,
    unit: string,
    min: number,
    max: number,
    step = 1,
    hint = '',
  ) => (
    <Field
      key={key}
      label={label}
      value={c[key] as number}
      onChange={(v) => set(key, v)}
      unit={unit}
      min={min}
      max={max}
      step={step}
      hint={hint}
    />
  );
  const length = (key: keyof EngineConfig, label: string, min: number, max: number, hint = '') => (
    <Field
      key={key}
      label={label}
      value={(c[key] as number) * lengthFactor}
      onChange={(v) => set(key, v / lengthFactor)}
      unit={imperial ? 'in' : 'mm'}
      min={min * lengthFactor}
      max={max * lengthFactor}
      step={imperial ? 0.01 : 0.1}
      hint={hint}
    />
  );
  const select = (key: keyof EngineConfig, label: string, opts: string[], names?: string[]) => (
    <SelectField
      label={label}
      value={c[key] as string}
      onChange={(v) => set(key, v)}
      options={opts.map((v, i) => ({ value: v, label: names?.[i] ?? v }))}
    />
  );
  function changeCylinders(v: number) {
    const n = Math.round(v),
      fo = Array.from({ length: n }, (_, i) => i + 1);
    onChange({
      ...c,
      cylinders: n,
      firingOrder: fo,
      firingAngles: fo.map((_, i) => (720 * i) / n),
    });
  }
  function applyOrder() {
    const ns = order
      .split(/[^\d]+/)
      .filter(Boolean)
      .map(Number);
    if (
      ns.length !== c.cylinders ||
      new Set(ns).size !== ns.length ||
      ns.some((n) => n < 1 || n > c.cylinders)
    ) {
      setOrderError(`Use each cylinder 1–${c.cylinders} once.`);
      return;
    }
    const fa = Array(c.cylinders).fill(0);
    ns.forEach((n, i) => (fa[n - 1] = (720 * i) / c.cylinders));
    onChange({ ...c, firingOrder: ns, firingAngles: fa });
    setOrderError('');
  }
  return (
    <div className="engine-editor">
      <Section title="Architecture" open badge="4-stroke">
        <div className="field">
          <label htmlFor="engine-name">Engine name</label>
          <input
            id="engine-name"
            maxLength={64}
            value={c.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="form-grid">
          {select(
            'layout',
            'Layout',
            ['inline', 'v', 'boxer', 'single'],
            ['Inline', 'V engine', 'Flat / boxer', 'Single'],
          )}
          <Field
            label="Cylinders"
            value={c.cylinders}
            onChange={changeCylinders}
            min={1}
            max={16}
          />
          {length('bore', 'Bore', 30, 180)}
          {length('stroke', 'Stroke', 25, 200)}
          {num(
            'compression',
            'Compression',
            ': 1',
            5,
            25,
            0.1,
            'Geometric compression ratio; affects estimated thermal efficiency.',
          )}
          {num('bankAngle', 'Bank angle', '°', 0, 180)}
          {length('rodLength', 'Rod length', 40, 400)}
          {num('inertia', 'Rotating inertia', 'kg·m²', 0.03, 2, 0.01)}
        </div>
        <div className="derived-row">
          <span>Displacement</span>
          <strong>
            {imperial ? (displacement(c) * 61.0237).toFixed(0) : displacement(c).toFixed(2)}{' '}
            <small>{imperial ? 'cu in' : 'L'}</small>
          </strong>
        </div>
      </Section>
      <Section title="Combustion & timing" open={advanced}>
        <div className="form-grid">
          {select(
            'fuel',
            'Fuel',
            ['gasoline', 'ethanol', 'diesel'],
            ['Gasoline', 'Ethanol', 'Diesel (approx.)'],
          )}
          {num('afr', 'Target AFR', ': 1', 6, 25, 0.1)}
          {num('ignitionAdvance', 'Ignition advance', '° BTDC', -5, 50)}
          {num('idleRpm', 'Idle target', 'rpm', 400, 2000, 50)}
          {num('redline', 'Rev limit', 'rpm', 2000, 14000, 100)}
          {num(
            'throttleResponse',
            'Throttle response',
            's',
            0.02,
            2,
            0.01,
            'Time constant for manifold filling and throttle response.',
          )}
        </div>
        <label className="text-label" htmlFor="firing-order">
          Firing order <span>cylinder no.</span>
        </label>
        <div className="inline-input">
          <input
            id="firing-order"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            onBlur={applyOrder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <button onClick={applyOrder}>Set</button>
        </div>
        {orderError && <p className="field-error">{orderError}</p>}
        <details className="minor-details">
          <summary>Custom firing TDC angles</summary>
          <label htmlFor="crank-angles">Degrees in 720° cycle, cylinder 1 onward</label>
          <input
            id="crank-angles"
            value={angles}
            onChange={(e) => setAngles(e.target.value)}
            onBlur={() => {
              const ns = angles
                .split(/[,\s]+/)
                .filter(Boolean)
                .map(Number);
              if (
                ns.length === c.cylinders &&
                ns.every((n) => Number.isFinite(n) && n >= 0 && n < 720)
              ) {
                onChange({
                  ...c,
                  firingAngles: ns,
                  firingOrder: ns
                    .map((a, i) => ({ a, i }))
                    .sort((a, b) => a.a - b.a)
                    .map((x) => x.i + 1),
                });
                setOrderError('');
              } else setOrderError(`Enter ${c.cylinders} angles from 0 to 719.`);
            }}
          />
          <p>Defines the crankpin/firing pattern directly. Evenly spaced events are the default.</p>
        </details>
      </Section>
      <Section title="Valvetrain" open={advanced}>
        <p className="field-note">
          Equivalent cam model; timing effects are approximated through airflow efficiency.
        </p>
        <div className="form-grid">
          {num('camDuration', 'Cam duration', '°', 180, 330)}
          {num('camLift', 'Valve lift', 'mm', 3, 20, 0.1)}
          {num('valveOverlap', 'Overlap', '°', 0, 100)}
          {num('valvetrainLimit', 'Valve float limit', 'rpm', 2000, 16000, 100)}
        </div>
      </Section>
      <Section title="Intake & induction" open>
        <div className="form-grid">
          {select(
            'aspiration',
            'Aspiration',
            ['natural', 'turbo', 'supercharged'],
            ['Naturally aspirated', 'Turbocharged', 'Supercharged'],
          )}
          {num('intakeVolume', 'Manifold volume', 'L', 0.2, 30, 0.1)}
          {length('runnerLength', 'Runner length', 80, 1000)}
          {length('runnerDiameter', 'Runner diameter', 15, 100)}
          {length('throttleDiameter', 'Throttle body', 15, 160)}
        </div>
        {c.aspiration !== 'natural' && (
          <>
            <div className="subsection-label">
              {c.aspiration === 'turbo'
                ? 'Turbocharger · lumped single equivalent'
                : 'Supercharger · crank-driven approximation'}
            </div>
            <div className="form-grid">
              {num('boostTarget', 'Boost target', 'bar', 0.05, 2.5, 0.05)}
              {c.aspiration === 'turbo' &&
                num(
                  'turboInertia',
                  'Spool inertia',
                  'relative',
                  0.05,
                  4,
                  0.05,
                  'First-order spool time constant = 0.12 + 1.4 × this value, in seconds.',
                )}
              {num('intercoolerEfficiency', 'Intercooler efficiency', '0–1', 0, 1, 0.05)}
            </div>
            <p className="field-note">
              Boost target includes a modeled wastegate. Compressor maps and multi-turbo
              interactions are not resolved.
            </p>
          </>
        )}
      </Section>
      <Section title="Exhaust & acoustics" open={advanced}>
        <div className="form-grid">
          {length(
            'exhaustLength',
            'Effective pipe length',
            300,
            5000,
            'Single equivalent exhaust path; changes resonance and pumping resistance.',
          )}
          {length('exhaustDiameter', 'Pipe diameter', 20, 160)}
        </div>
        <Range
          label="Muffler damping"
          value={c.muffling}
          onChange={(v) => set('muffling', v)}
          display={`${Math.round(c.muffling * 100)}%`}
          hint="Acoustic attenuation and a small equivalent restriction."
        />
        <p className="field-note">
          Headers, collectors, catalyst and resonators use a single equivalent acoustic path.
        </p>
      </Section>
      <Section title="Thermal & mechanical limits" open={advanced}>
        <div className="form-grid">
          {num('friction', 'Friction multiplier', '×', 0.2, 3, 0.05)}
          {num('cooling', 'Cooling multiplier', '×', 0.1, 4, 0.1)}
          {num('ambientTemp', 'Ambient temperature', '°C', -20, 50)}
          {num('maxTemp', 'Thermal limit', '°C', 80, 180)}
          {num('pistonSpeedLimit', 'Piston speed limit', 'm/s', 10, 40, 0.5)}
          {num('rodForceLimit', 'Rod load limit', 'kN', 5, 150)}
          {num('reciprocatingMass', 'Reciprocating mass', 'kg/cyl', 0.1, 2, 0.05)}
        </div>
        <p className="field-note">
          Limits are user assumptions, not material certification. Damage is a simplified
          accumulated exposure estimate.
        </p>
      </Section>
      {problems.length > 0 && (
        <div className="validation-list">
          {problems.map((p, i) => (
            <div key={i} className={p.level}>
              <AlertTriangle size={13} />
              <span>{p.message}</span>
            </div>
          ))}
        </div>
      )}
      <Section title="Preset notes & sources">
        <p className="field-note">{c.notes}</p>
        {c.sources.map((s) => (
          <a className="source-link" key={s.url} href={s.url} target="_blank" rel="noreferrer">
            {s.label}
            <ExternalLink size={11} />
          </a>
        ))}
        <p className="field-note">
          All performance and acoustic outputs are simulated estimates. No recorded engine audio is
          used.
        </p>
      </Section>
    </div>
  );
}

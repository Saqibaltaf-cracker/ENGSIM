import { describe, expect, it } from 'vitest';
import { presets, defaultConfig } from './data/presets';
import {
  boostAtRpm,
  createState,
  defaultVehicle,
  displacement,
  evenFiringAngles,
  firingEventsBetween,
  generateDyno,
  stepEngine,
  stressAtRpm,
  torqueAtRpm,
  torqueToPower,
  validateConfig,
} from './sim';
import type { EngineConfig, SimControls, SimState, VehicleConfig } from './sim';

const controls = (overrides: Partial<SimControls> = {}): SimControls => ({
  throttle: 0,
  brake: 0,
  clutch: 1,
  gear: 0,
  ignition: true,
  starter: false,
  protective: true,
  vehicleMode: false,
  ...overrides,
});
function advance(
  s: SimState,
  c: EngineConfig,
  u: SimControls,
  seconds: number,
  v: VehicleConfig = defaultVehicle,
) {
  for (let t = 0; t < seconds; t += 1 / 1000) stepEngine(s, c, v, u, 1 / 1000);
  return s;
}
function started(c = defaultConfig) {
  const s = createState(c);
  advance(s, c, controls({ starter: true }), 1.2);
  return s;
}

describe('engine configuration and unit conventions', () => {
  it('calculates cylinder swept volume in liters, not cc or total swept length', () => {
    const c = { ...defaultConfig, cylinders: 4, bore: 86, stroke: 86 };
    expect(displacement(c)).toBeCloseTo(1.99823, 4);
    expect(displacement({ ...c, cylinders: 8 })).toBeCloseTo(displacement(c) * 2, 6);
  });
  it('all shipped generic presets pass structural validation', () => {
    for (const c of presets)
      expect(
        validateConfig(c).filter((i) => i.level === 'error'),
        c.name,
      ).toEqual([]);
  });
  it('rejects malformed configurations and catches physical inconsistencies', () => {
    expect(validateConfig({ ...defaultConfig, bore: NaN }).some((i) => i.level === 'error')).toBe(
      true,
    );
    expect(
      validateConfig({ ...defaultConfig, firingOrder: [1, 1] }).some((i) =>
        i.message.includes('every cylinder'),
      ),
    ).toBe(true);
    expect(
      validateConfig({ ...defaultConfig, rodLength: 35 }).some((i) =>
        i.message.includes('clearance'),
      ),
    ).toBe(true);
    expect(
      validateConfig({ ...defaultConfig, redline: 16000 }).some((i) =>
        i.message.includes('component limit'),
      ),
    ).toBe(true);
    expect(validateConfig(null as unknown as EngineConfig)[0].level).toBe('error');
  });
  it('converts N·m to kW according to rotational work', () => {
    expect(torqueToPower(100, 6000)).toBeCloseTo(62.831853, 5);
    expect(torqueToPower(0, 6000)).toBe(0);
  });
});

describe('crank-resolved firing events', () => {
  const c = {
    ...defaultConfig,
    cylinders: 4,
    firingOrder: [1, 3, 4, 2],
    firingAngles: evenFiringAngles([1, 3, 4, 2]),
  };
  it('uses firing order rather than cylinder index and does not duplicate boundaries', () => {
    const first = firingEventsBetween(c, 719, 361, 0, 1);
    expect(first.map((e) => e.cylinder)).toEqual([1, 3, 4]);
    const second = firingEventsBetween(c, 360, 180, 1, 1);
    expect(second.map((e) => e.cylinder)).toEqual([2]);
    expect(first[0].time).toBeCloseTo(1 / 361);
    expect(first[2].time).toBe(1);
  });
  it('retains every crossing even when a step spans multiple engine cycles', () => {
    const events = firingEventsBetween(c, 0, 1440, 2, 0.1);
    expect(events).toHaveLength(8);
    expect(events.map((e) => e.cylinder)).toEqual([3, 4, 2, 1, 3, 4, 2, 1]);
    expect(events.at(-1)?.time).toBeCloseTo(2.1);
  });
});

describe('live engine integration', () => {
  it('every supplied archetype can start and maintain a stable unloaded idle', () => {
    for (const c of presets) {
      const s = started(c);
      advance(s, c, controls(), 8);
      expect(s.status, c.name).toBe('running');
      expect(s.rpm, c.name).toBeGreaterThan(c.idleRpm * 0.65);
      expect(s.rpm, c.name).toBeLessThan(c.idleRpm * 1.5);
    }
  });
  it('requires a starter, starts, and sustains idle without a hidden RPM source', () => {
    const s = createState(defaultConfig);
    advance(s, defaultConfig, controls(), 1);
    expect(s.rpm).toBe(0);
    advance(s, defaultConfig, controls({ starter: true }), 1.2);
    expect(s.status).toBe('running');
    advance(s, defaultConfig, controls(), 12);
    expect(s.status).toBe('running');
    expect(s.rpm).toBeGreaterThan(defaultConfig.idleRpm * 0.75);
    expect(s.rpm).toBeLessThan(defaultConfig.idleRpm * 1.35);
  });
  it('throttle adds energy, turning ignition off stops combustion, and the flywheel coasts down', () => {
    const s = started();
    const idle = s.rpm;
    advance(s, defaultConfig, controls({ throttle: 0.6 }), 1);
    expect(s.rpm).toBeGreaterThan(idle + 1000);
    const revved = s.rpm;
    advance(s, defaultConfig, controls({ ignition: false }), 0.1);
    expect(s.firingEvents).toHaveLength(0);
    expect(s.rpm).toBeLessThan(revved);
    advance(s, defaultConfig, controls({ ignition: false }), 20);
    expect(s.rpm).toBeLessThan(5);
  });
  it('remains bounded across a delayed render step and keeps all integrated state finite', () => {
    const s = started();
    const u = controls({ throttle: 1 });
    for (let i = 0; i < 250; i++) stepEngine(s, defaultConfig, defaultVehicle, u, 0.1);
    for (const value of Object.values(s))
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    expect(s.rpm).toBeLessThan(defaultConfig.redline + 100);
    expect(s.damage).toBe(0);
    expect(s.time).toBeGreaterThan(26);
  });
  it('greater flywheel inertia reduces initial free-rev acceleration', () => {
    const light = { ...defaultConfig, inertia: 0.2 };
    const heavy = { ...defaultConfig, inertia: 0.7 };
    const a = started(light),
      b = started(heavy);
    // Match initial state so starter duration does not confound this comparison.
    b.rpm = a.rpm;
    b.throttle = a.throttle;
    b.manifoldPressure = a.manifoldPressure;
    advance(a, light, controls({ throttle: 0.8 }), 0.25);
    advance(b, heavy, controls({ throttle: 0.8 }), 0.25);
    expect(a.rpm).toBeGreaterThan(b.rpm + 300);
  });
});

describe('drivetrain and vehicle', () => {
  it('automatic shifts persist while explicit gear changes and neutral override them', () => {
    const s = started();
    s.rpm = 6500;
    const u = controls({ vehicleMode: true, gear: 1, throttle: 1, clutch: 0, gearRequest: 1 });
    advance(s, defaultConfig, u, 0.3);
    expect(s.gear).toBe(2);
    // Requested first gear is unchanged, so the automatic second gear must persist.
    stepEngine(s, defaultConfig, defaultVehicle, u, 1 / 1000);
    expect(s.gear).toBe(2);
    // A downshift to the original input value needs an explicit request sequence.
    stepEngine(s, defaultConfig, defaultVehicle, { ...u, gear: 1, gearRequest: 2 }, 1 / 1000);
    expect(s.gear).toBe(1);
    stepEngine(s, defaultConfig, defaultVehicle, { ...u, gear: 3 }, 1 / 1000);
    expect(s.gear).toBe(3);
    stepEngine(s, defaultConfig, defaultVehicle, { ...u, gear: 0 }, 1 / 1000);
    expect(s.gear).toBe(0);
  });
  it('neutral permits engine revs without wheel torque; first gear accelerates the car', () => {
    const neutral = started(),
      drive = started();
    advance(neutral, defaultConfig, controls({ throttle: 0.7, vehicleMode: true, gear: 0 }), 1);
    advance(drive, defaultConfig, controls({ throttle: 0.7, vehicleMode: true, gear: 1 }), 1);
    expect(neutral.speed).toBe(0);
    expect(drive.rpm).toBeLessThan(neutral.rpm);
    advance(drive, defaultConfig, controls({ throttle: 0.7, vehicleMode: true, gear: 1 }), 4);
    expect(drive.speed).toBeGreaterThan(5);
    expect(drive.load).toBeGreaterThan(0);
  });
  it('a shorter first ratio increases acceleration from the same starting state', () => {
    const a = started(),
      b = structuredClone(a);
    const first = { ...defaultVehicle, mode: 'manual' as const, gearRatios: [3.5] };
    const tall = { ...first, gearRatios: [1.5] };
    a.rpm = b.rpm = 3000;
    a.speed = b.speed = 3;
    const u = controls({ vehicleMode: true, gear: 1, throttle: 0.8, clutch: 0.3 });
    advance(a, defaultConfig, u, 0.25, first);
    advance(b, defaultConfig, u, 0.25, tall);
    expect(a.speed).toBeGreaterThan(b.speed);
  });
  it('braking overcomes wheel torque and a disengaged clutch disconnects drive', () => {
    const s = started();
    s.speed = 15;
    advance(
      s,
      defaultConfig,
      controls({ vehicleMode: true, gear: 1, clutch: 0, throttle: 0.8, brake: 1 }),
      1,
    );
    expect(s.speed).toBeLessThan(8);
    expect(s.load).toBe(0);
  });
  it('manual clutch engagement at standstill can stall the engine', () => {
    const s = started();
    advance(s, defaultConfig, controls({ vehicleMode: true, gear: 1, clutch: 1, brake: 1 }), 2, {
      ...defaultVehicle,
      mode: 'manual',
    });
    expect(s.status).toBe('stalled');
    expect(s.rpm).toBeLessThan(210);
  });
});

describe('induction, stress and repeatable dyno', () => {
  it('boost raises torque and its inertia causes a real transient spool delay', () => {
    const turbo = presets.find((c) => c.id === 'turbo-i4')!;
    expect(torqueAtRpm(turbo, 4500, 1)).toBeGreaterThan(
      torqueAtRpm({ ...turbo, aspiration: 'natural' }, 4500, 1) * 1.7,
    );
    const s = started(turbo);
    s.rpm = 5000;
    advance(s, turbo, controls({ throttle: 1 }), 0.1);
    expect(s.boost).toBeLessThan(boostAtRpm(turbo, 5000));
    expect(s.boost).toBeGreaterThan(0);
  });
  it('rod load follows RPM squared and piston speed follows RPM', () => {
    const a = stressAtRpm(defaultConfig, 3000),
      b = stressAtRpm(defaultConfig, 6000);
    expect(b.rodForce / a.rodForce).toBeCloseTo(4, 5);
    expect(b.pistonSpeed / a.pistonSpeed).toBeCloseTo(2, 5);
    expect(stressAtRpm(defaultConfig, 14000).stress).toBeGreaterThan(1);
  });
  it('experimental overspeed accumulates damage while protective mode cuts fuel', () => {
    const c = { ...defaultConfig, redline: 3000, pistonSpeedLimit: 10, valvetrainLimit: 3200 };
    const a = started(c),
      b = structuredClone(a);
    advance(a, c, controls({ throttle: 1, protective: false }), 8);
    advance(b, c, controls({ throttle: 1, protective: true }), 8);
    expect(a.damage).toBeGreaterThan(0);
    expect(b.damage).toBe(0);
    expect(b.rpm).toBeLessThan(3100);
    expect(b.warnings.length).toBeGreaterThan(0);
  });
  it('the dyno is reproducible and uses the live torque map and correct power formula', () => {
    const a = generateDyno(defaultConfig),
      b = generateDyno(defaultConfig);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(40);
    expect(a.at(-1)?.rpm).toBe(defaultConfig.redline);
    for (const p of a) {
      expect(p.torque).toBeCloseTo(torqueAtRpm(defaultConfig, p.rpm, 1));
      expect(p.power).toBeCloseTo(torqueToPower(p.torque, p.rpm));
    }
  });
});

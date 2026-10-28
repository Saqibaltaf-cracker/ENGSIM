import type {
  DynoPoint,
  EngineConfig,
  FiringEvent,
  SimControls,
  SimState,
  ValidationIssue,
  VehicleConfig,
} from './types';
export type * from './types';

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const TAU = Math.PI * 2;
const positiveAngle = (a: number) => ((a % 720) + 720) % 720;

export const defaultVehicle: VehicleConfig = {
  mode: 'automatic',
  mass: 1450,
  dragCoefficient: 0.31,
  frontalArea: 2.2,
  rollingResistance: 0.012,
  tireRadius: 0.325,
  finalDrive: 3.73,
  efficiency: 0.9,
  gearRatios: [3.36, 2.09, 1.48, 1.1, 0.85, 0.67],
  shiftRpm: 6200,
};

/** Swept volume: N π/4 B²S, converted from mm³ to liters. */
export function displacement(config: EngineConfig): number {
  return (((config.cylinders * Math.PI) / 4) * config.bore ** 2 * config.stroke) / 1e6;
}

/** kW from N·m and revolutions/minute; no horsepower convention ambiguity. */
export function torqueToPower(torque: number, rpm: number): number {
  return (torque * rpm * TAU) / 60 / 1000;
}

export function evenFiringAngles(order: number[]): number[] {
  const angles = new Array<number>(order.length);
  order.forEach((cylinder, i) => {
    angles[cylinder - 1] = (i * 720) / order.length;
  });
  return angles;
}

export function firingIntervals(config: EngineConfig): number[] {
  const angles = config.firingAngles.map(positiveAngle).sort((a, b) => a - b);
  return angles.map((a, i) => positiveAngle((angles[(i + 1) % angles.length] ?? 0) - a) || 720);
}

/** Enumerate actual TDC crossings, including wraps and multiple full cycles. */
export function firingEventsBetween(
  config: EngineConfig,
  start: number,
  advance: number,
  time: number,
  dt: number,
  energy = 1,
): FiringEvent[] {
  if (!(advance > 0) || energy <= 0) return [];
  const events: (FiringEvent & { distance: number })[] = [];
  config.firingAngles.forEach((angle, i) => {
    let distance = positiveAngle(angle - positiveAngle(start));
    // The start boundary belongs to the preceding step. Include the end boundary.
    if (distance < 1e-9) distance = 720;
    for (; distance <= advance + 1e-9; distance += 720) {
      events.push({
        cylinder: i + 1,
        angle: positiveAngle(angle),
        time: time + (dt * distance) / advance,
        energy,
        distance,
      });
    }
  });
  return events
    .sort((a, b) => a.distance - b.distance)
    .map(({ distance: _distance, ...event }) => event);
}

/** Estimated volumetric efficiency; tuned generic curves, not measured maps. */
export function volumetricEfficiency(c: EngineConfig, rpm: number): number {
  const displacementPerCylinder = displacement(c) / c.cylinders;
  const camPeak = 3600 + (c.camDuration - 220) * 32 + (c.camLift - 9) * 110;
  const runnerPeak = 4300 * Math.sqrt(350 / Math.max(80, c.runnerLength));
  const tunedPeak = camPeak * 0.65 + runnerPeak * 0.35;
  const breathing =
    0.59 + 0.38 * Math.exp(-(((rpm - tunedPeak) / (2600 + c.camDuration * 3)) ** 2));
  const overlapLoss = (c.valveOverlap / 180) * Math.exp(-rpm / 1900);
  const liftFactor = clamp(c.camLift / Math.max(6, c.bore * 0.11), 0.4, 1.12);
  const intakeArea = (Math.PI / 4) * (c.throttleDiameter / 1000) ** 2;
  const intakeVelocity = ((displacement(c) / 1000) * rpm) / 120 / Math.max(0.0001, intakeArea);
  const throttleRestriction = 1 / (1 + (intakeVelocity / 115) ** 2);
  const runnerVelocity =
    ((displacementPerCylinder / 1000) * rpm) /
    120 /
    ((Math.PI / 4) * (c.runnerDiameter / 1000) ** 2);
  const runnerRestriction = 1 / (1 + (runnerVelocity / 160) ** 2);
  const exhaustFlow = (displacement(c) * rpm) / Math.max(1000, c.exhaustDiameter ** 2 * 6);
  const backPressure = 1 / (1 + exhaustFlow ** 2 * (0.06 + c.muffling * 0.07));
  const headerTuning = 1 + 0.035 * Math.exp(-(((rpm - 3600000 / c.exhaustLength) / 1500) ** 2));
  const valveFloat = 1 / (1 + (Math.max(0, rpm / c.valvetrainLimit - 0.85) * 3) ** 2);
  return clamp(
    (breathing - overlapLoss) *
      liftFactor *
      throttleRestriction *
      runnerRestriction *
      backPressure *
      headerTuning *
      valveFloat,
    0.12,
    1.12,
  );
}

/** Steady-state boost available at full load. Turbo spool is integrated separately. */
export function boostAtRpm(c: EngineConfig, rpm: number, throttle = 1): number {
  if (c.aspiration === 'natural') return 0;
  if (c.aspiration === 'supercharged') return c.boostTarget * clamp(rpm / 4500, 0.08, 1) * throttle;
  return c.boostTarget * clamp((rpm - 1300) / 2300, 0, 1) * throttle ** 1.6;
}

function grossTorque(c: EngineConfig, rpm: number, throttle: number, boost: number): number {
  const stoich = c.fuel === 'ethanol' ? 9 : c.fuel === 'diesel' ? 14.5 : 14.7;
  const equivalence = stoich / c.afr;
  const mixture = clamp(1 - ((equivalence - 1.08) / 0.72) ** 2, 0.05, 1);
  const compressionEfficiency = clamp((1 - 1 / c.compression ** 0.32) / 0.53, 0.55, 1.25);
  const optimalTiming = 20 + clamp(rpm / 450, 0, 16);
  const timing = clamp(1 - ((c.ignitionAdvance - optimalTiming) / 70) ** 2, 0.4, 1);
  const densityGain =
    (1 + Math.max(0, boost)) / (1 + Math.max(0, boost) * 0.28 * (1 - c.intercoolerEfficiency));
  const bmep =
    (c.fuel === 'diesel' ? 12.2 : 13.4) *
    1e5 *
    volumetricEfficiency(c, rpm) *
    compressionEfficiency *
    mixture *
    timing;
  const flow = 0.065 + 0.935 * clamp(throttle, 0, 1);
  const blowerLoss =
    c.aspiration === 'supercharged'
      ? ((densityGain * c.boostTarget * displacement(c) * rpm) / 4500) * 4
      : 0;
  return ((bmep * displacement(c)) / 1000 / (4 * Math.PI)) * flow * densityGain - blowerLoss;
}

function parasiticTorque(c: EngineConfig, rpm: number, throttle: number): number {
  const friction = c.friction * displacement(c) * (3.6 + rpm * 0.0018 + (rpm / 6000) ** 2 * 2.5);
  const pumping = displacement(c) * 4.0 * (1 - throttle) * clamp(rpm / 1100, 0, 1);
  return friction + pumping;
}

/** Estimated brake torque in N·m. Parameters are generic approximations, not a calibration. */
export function torqueAtRpm(
  c: EngineConfig,
  rpm: number,
  throttle: number,
  boost = boostAtRpm(c, rpm, throttle),
): number {
  return grossTorque(c, rpm, throttle, boost) - parasiticTorque(c, rpm, throttle);
}

/** Peak inertial rod tensile load approximation, neglecting pressure and bending. */
export function stressAtRpm(c: EngineConfig, rpm: number, temperature = 90) {
  const radius = c.stroke / 2000;
  const omega = (rpm * TAU) / 60;
  const pistonSpeed = ((c.stroke / 1000) * rpm) / 30;
  const acceleration = radius * omega ** 2 * (1 + radius / (c.rodLength / 1000));
  const rodForce = (c.reciprocatingMass * acceleration) / 1000;
  const thermal = (temperature - c.ambientTemp) / Math.max(1, c.maxTemp - c.ambientTemp);
  const stress = Math.max(
    pistonSpeed / c.pistonSpeedLimit,
    rodForce / c.rodForceLimit,
    rpm / c.valvetrainLimit,
    thermal,
  );
  return { pistonSpeed, rodForce, stress };
}

export function createState(c: EngineConfig): SimState {
  return {
    time: 0,
    rpm: 0,
    crankAngle: 0,
    speed: 0,
    gear: 0,
    torque: 0,
    power: 0,
    boost: 0,
    manifoldPressure: 101.325,
    afr: c.afr,
    temperature: c.ambientTemp,
    stress: 0,
    damage: 0,
    status: 'off',
    load: 0,
    throttle: 0,
    pistonSpeed: 0,
    rodForce: 0,
    firingEvents: [],
    warnings: [],
    _running: false,
    _wasIgnited: false,
    _shiftTimer: 0,
  };
}

/** Integrate one bounded fixed time step. Call at >= 240 Hz. Mutates state. */
export function stepEngine(
  s: SimState,
  c: EngineConfig,
  v: VehicleConfig,
  u: SimControls,
  dt: number,
): SimState {
  if (!Number.isFinite(dt) || dt <= 0) return s;
  // Protect direct callers too: a missed render frame must not create an unbounded step.
  if (dt > 1 / 240 + 1e-9) {
    const count = Math.ceil(Math.min(dt, 0.25) * 240);
    const events: FiringEvent[] = [];
    for (let i = 0; i < count; i++) {
      stepEngine(s, c, v, u, Math.min(dt, 0.25) / count);
      events.push(...s.firingEvents);
    }
    s.firingEvents = events;
    return s;
  }
  const throttleRequest = clamp(u.throttle, 0, 1);
  s.firingEvents = [];
  s.warnings = [];
  if (!u.ignition || s.damage >= 1) s._running = false;
  if (u.ignition) s._wasIgnited = true;
  if (u.ignition && u.starter && s.damage < 1 && s.rpm > 300) s._running = true;
  if (s.rpm < 210 && !u.starter) s._running = false;

  // Idle bypass closes once driver throttle exceeds idle demand. This is a simple governor.
  const idleDemand = s._running ? clamp(0.1 + (c.idleRpm - s.rpm) * 0.00065, 0, 0.38) : 0;
  const demanded = Math.max(throttleRequest, idleDemand);
  s.throttle += (demanded - s.throttle) * (1 - Math.exp(-dt / Math.max(0.015, c.throttleResponse)));
  const targetBoost = boostAtRpm(c, s.rpm, s._running ? s.throttle : 0);
  const boostTau = c.aspiration === 'turbo' ? 0.12 + c.turboInertia * 1.4 : 0.06;
  s.boost +=
    (targetBoost - s.boost) *
    (1 - Math.exp(-dt / (targetBoost < s.boost ? boostTau * 0.35 : boostTau)));
  const targetPressure = 23 + 78.325 * s.throttle + s.boost * 100;
  const manifoldTau = clamp((c.intakeVolume / Math.max(1, displacement(c))) * 0.055, 0.015, 0.45);
  s.manifoldPressure +=
    ((s.rpm > 80 ? targetPressure : 101.325) - s.manifoldPressure) *
    (1 - Math.exp(-dt / manifoldTau));
  const mapThrottle = clamp((s.manifoldPressure - 23 - s.boost * 100) / 78.325, 0, 1);
  const limit = stressAtRpm(c, s.rpm, s.temperature);
  const protectiveLimit = u.protective && (s.rpm >= c.redline || limit.stress >= 1);
  const firing = !!(s._running && u.ignition && s.damage < 1 && !protectiveLimit);
  let shaftTorque = firing
    ? torqueAtRpm(c, s.rpm, mapThrottle, s.boost)
    : -parasiticTorque(c, s.rpm, 0);
  if (!firing && s.rpm < 5) shaftTorque = 0;

  const requestedGear = clamp(Math.round(u.gear), 0, v.gearRatios.length);
  let gear = requestedGear;
  s._shiftTimer = Math.max(0, (s._shiftTimer || 0) - dt);
  if (v.mode === 'automatic' && u.vehicleMode && gear > 0) {
    // Keep autonomous shifts between messages, but respect an explicitly changed
    // requested gear from the UI. Otherwise s.gear would swallow manual overrides.
    const changedRequest = s._requestedGear !== requestedGear || s._gearRequest !== u.gearRequest;
    gear = changedRequest ? requestedGear : clamp(s.gear || gear, 1, v.gearRatios.length);
    if (changedRequest) s._shiftTimer = 0.22;
    if (!s._shiftTimer) {
      if (s.rpm > Math.min(v.shiftRpm, c.redline * 0.95) && gear < v.gearRatios.length) {
        gear++;
        s._shiftTimer = 0.22;
      } else if (s.rpm < Math.max(1300, c.idleRpm * 1.5) && gear > 1) {
        gear--;
        s._shiftTimer = 0.22;
      }
    }
  }
  s._requestedGear = requestedGear;
  s._gearRequest = u.gearRequest;
  s.gear = gear;
  const ratio = gear > 0 && u.vehicleMode ? v.gearRatios[gear - 1] * v.finalDrive : 0;
  const wheelRpm = ((s.speed / Math.max(0.1, v.tireRadius)) * 60) / TAU;
  let clutch = ratio ? clamp(u.clutch, 0, 1) : 0;
  if (v.mode === 'automatic') {
    // A low-speed slipping converter approximation prevents abrupt automatic launches.
    clutch *= clamp((s.rpm - c.idleRpm * 0.72) / 1400, 0, 1);
    if (s._shiftTimer) clutch *= 0.08;
  }
  const clutchCapacity = (200 + displacement(c) * 90) * clutch;
  const couplingTorque = clamp(
    (((s.rpm - wheelRpm * ratio) * TAU) / 60) * 8,
    -clutchCapacity,
    clutchCapacity,
  );
  const roadForce =
    s.speed > 0.02
      ? v.mass * 9.80665 * v.rollingResistance +
        0.5 * 1.225 * v.dragCoefficient * v.frontalArea * s.speed ** 2
      : 0;
  const brakingForce = clamp(u.brake, 0, 1) * v.mass * 8;
  const tractionForce = ratio
    ? (couplingTorque * ratio * v.efficiency) / Math.max(0.1, v.tireRadius)
    : 0;
  if (u.vehicleMode)
    s.speed = clamp(
      s.speed + ((tractionForce - roadForce - brakingForce) / Math.max(100, v.mass)) * dt,
      0,
      180,
    );
  s.load = clamp(
    Math.abs(couplingTorque) / Math.max(1, Math.abs(torqueAtRpm(c, Math.max(1000, s.rpm), 1))),
    0,
    1.5,
  );

  // A mean torque envelope with a mild crank-angle ripple. Pulses, audio and drawing
  // all use the same crank integral; there is no independently running audio oscillator.
  let ripple = 1;
  if (firing) {
    const summed = c.firingAngles.reduce((sum, angle) => {
      const phase = positiveAngle(s.crankAngle - angle);
      return sum + (phase < 180 ? Math.sin((phase * Math.PI) / 180) : 0);
    }, 0);
    ripple = 0.86 + (0.14 * summed) / Math.max(0.1, c.cylinders / Math.PI);
  }
  const starterTorque =
    u.starter && u.ignition && s.damage < 1 && s.rpm < 700
      ? (65 + displacement(c) * 13) * clamp(1 - s.rpm / 800, 0.1, 1)
      : 0;
  const netTorque = shaftTorque * ripple + starterTorque - couplingTorque;
  const oldRpm = s.rpm;
  s.rpm = clamp(s.rpm + (((netTorque / Math.max(0.015, c.inertia)) * 60) / TAU) * dt, 0, 30000);
  const advance = ((oldRpm + s.rpm) / 2) * 6 * dt;
  if (firing) {
    const energy = clamp(
      (0.12 + s.throttle * 0.88) *
        (1 + s.boost * 0.45) *
        Math.sqrt(displacement(c) / c.cylinders / 0.5),
      0.03,
      2,
    );
    s.firingEvents = firingEventsBetween(c, s.crankAngle, advance, s.time, dt, energy);
  }
  s.crankAngle = positiveAngle(s.crankAngle + advance);
  s.time += dt;
  s.torque = shaftTorque;
  s.power = torqueToPower(shaftTorque, s.rpm);
  s.afr = c.afr;
  const heat = (s._running ? 35 + Math.max(0, s.power) * 0.45 : 0) + (u.starter ? 3 : 0);
  s.temperature +=
    ((heat - c.cooling * (s.temperature - c.ambientTemp) * (0.32 + s.speed * 0.005)) * dt) / 40;
  const currentStress = stressAtRpm(c, s.rpm, s.temperature);
  Object.assign(s, currentStress);
  if (!u.protective && s.stress > 1)
    s.damage = clamp(s.damage + (s.stress - 1) ** 2 * dt * 0.035, 0, 1);
  if (s.damage >= 1) {
    s.status = 'failed';
    s._running = false;
    s.warnings.push(
      'Simulated failure: accumulated mechanical or thermal damage reached its limit. Reset to rebuild.',
    );
  } else if (u.starter && u.ignition && !s._running) s.status = 'cranking';
  else if (s._running && protectiveLimit) s.status = 'limiter';
  else if (s._running) s.status = 'running';
  else if (u.ignition && s._wasIgnited) s.status = 'stalled';
  else s.status = 'off';
  if (s.pistonSpeed > c.pistonSpeedLimit * 0.9)
    s.warnings.push('Mean piston speed is approaching the configured limit.');
  if (s.rodForce > c.rodForceLimit * 0.9)
    s.warnings.push('Estimated rod tensile load is approaching the configured limit.');
  if (s.rpm > c.valvetrainLimit * 0.9)
    s.warnings.push(
      'Valvetrain speed is near the configured limit; breathing efficiency is reduced.',
    );
  if (s.temperature > c.maxTemp * 0.9)
    s.warnings.push('Coolant temperature is approaching the configured thermal limit.');
  if (s.rpm >= c.redline)
    s.warnings.push(
      u.protective
        ? 'Protective fuel cut active.'
        : 'Above redline: experimental mode permits overspeed and damage.',
    );
  return s;
}

/** Quasi-steady WOT brake-dyno sweep. Same torque/boost/stress maps as live sim.
 * Fully spooled at each point; this is not a transient accelerating inertia dyno.
 */
export function generateDyno(c: EngineConfig): DynoPoint[] {
  const points: DynoPoint[] = [];
  const start = Math.max(600, Math.round(c.idleRpm / 100) * 100);
  for (let rpm = start; rpm <= c.redline; rpm += 100) {
    const boost = boostAtRpm(c, rpm);
    const torque = torqueAtRpm(c, rpm, 1, boost);
    points.push({
      rpm,
      torque,
      power: torqueToPower(torque, rpm),
      boost,
      afr: c.afr,
      manifoldPressure: 101.325 + boost * 100,
      stress: stressAtRpm(c, rpm, 90).stress,
    });
  }
  if (points.length && points[points.length - 1].rpm !== c.redline) {
    const boost = boostAtRpm(c, c.redline);
    const torque = torqueAtRpm(c, c.redline, 1, boost);
    points.push({
      rpm: c.redline,
      torque,
      power: torqueToPower(torque, c.redline),
      boost,
      afr: c.afr,
      manifoldPressure: 101.325 + boost * 100,
      stress: stressAtRpm(c, c.redline, 90).stress,
    });
  }
  return points;
}

/** Structural validation rejects malformed input while warning about unusual physics. */
export function validateConfig(c: EngineConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });
  if (!c || typeof c !== 'object')
    return [{ level: 'error', message: 'Configuration must be a JSON object.' }];
  if (typeof c.id !== 'string' || !c.id.trim())
    error('Configuration id must be a nonempty string.');
  if (typeof c.name !== 'string' || !c.name.trim()) error('Give the engine a name.');
  if (!['inline', 'v', 'boxer', 'single'].includes(c.layout))
    error('Choose a supported cylinder layout.');
  if (!Number.isInteger(c.cylinders) || c.cylinders < 1 || c.cylinders > 16)
    error('Cylinder count must be a whole number between 1 and 16.');
  const ranges: [keyof EngineConfig, number, number][] = [
    ['bankAngle', 0, 180],
    ['bore', 20, 200],
    ['stroke', 20, 220],
    ['rodLength', 30, 400],
    ['compression', 3, 25],
    ['inertia', 0.015, 5],
    ['redline', 1000, 22000],
    ['idleRpm', 250, 3000],
    ['afr', 4, 40],
    ['ignitionAdvance', -10, 60],
    ['throttleResponse', 0.015, 3],
    ['camDuration', 120, 360],
    ['camLift', 1, 25],
    ['valveOverlap', 0, 160],
    ['intakeVolume', 0.1, 30],
    ['runnerLength', 80, 1500],
    ['runnerDiameter', 10, 100],
    ['throttleDiameter', 15, 200],
    ['exhaustLength', 300, 6000],
    ['exhaustDiameter', 15, 180],
    ['muffling', 0, 1],
    ['boostTarget', 0, 3],
    ['turboInertia', 0.02, 5],
    ['intercoolerEfficiency', 0, 1],
    ['friction', 0.1, 4],
    ['cooling', 0.1, 5],
    ['ambientTemp', -30, 60],
    ['maxTemp', 60, 250],
    ['pistonSpeedLimit', 5, 60],
    ['rodForceLimit', 1, 150],
    ['reciprocatingMass', 0.1, 3],
    ['valvetrainLimit', 1000, 25000],
  ];
  ranges.forEach(([key, min, max]) => {
    const value = c[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      error(`${key} must be between ${min} and ${max}.`);
  });
  if (!['gasoline', 'ethanol', 'diesel'].includes(c.fuel))
    error('Choose gasoline, ethanol, or diesel fuel.');
  if (!['natural', 'turbo', 'supercharged'].includes(c.aspiration))
    error('Choose natural, turbo, or supercharged aspiration.');
  if (
    !Array.isArray(c.firingOrder) ||
    c.firingOrder.length !== c.cylinders ||
    new Set(c.firingOrder).size !== c.cylinders ||
    c.firingOrder.some((n) => !Number.isInteger(n) || n < 1 || n > c.cylinders)
  )
    error('Firing order must list every cylinder exactly once, numbered from 1.');
  if (
    !Array.isArray(c.firingAngles) ||
    c.firingAngles.length !== c.cylinders ||
    c.firingAngles.some((n) => !Number.isFinite(n) || n < 0 || n >= 720)
  )
    error('Provide one crank angle from 0 to below 720° for each cylinder.');
  else if (Array.isArray(c.firingOrder) && c.firingOrder.length === c.cylinders) {
    const actual = c.firingAngles
      .map((angle, i) => ({ angle, number: i + 1 }))
      .sort((a, b) => a.angle - b.angle)
      .map((x) => x.number);
    const offset = actual.indexOf(c.firingOrder[0]);
    if (actual.some((_, i) => actual[(i + offset) % actual.length] !== c.firingOrder[i]))
      warn(
        'Firing order differs from crank-angle order. Simulation uses the crank angles; align them to match the displayed order.',
      );
  }
  if (c.rodLength <= c.stroke / 2 + 5)
    error('Connecting rod must be longer than the crank radius plus 5 mm clearance.');
  if (c.idleRpm >= c.redline) error('Idle target must be below redline.');
  if (c.layout === 'single' && c.cylinders !== 1)
    error('Single-cylinder layout requires exactly one cylinder.');
  if ((c.layout === 'v' || c.layout === 'boxer') && c.cylinders % 2 !== 0)
    warn('Unequal bank counts are experimental; this model does not resolve crankshaft imbalance.');
  if (c.layout === 'boxer' && c.bankAngle !== 180)
    warn(
      'A boxer normally has a 180° bank angle; bank angle affects visualization and audio grouping, not crank dynamics.',
    );
  if (
    c.compression > 12 &&
    c.fuel === 'gasoline' &&
    c.boostTarget > 0.5 &&
    c.aspiration !== 'natural'
  )
    warn(
      'High gasoline compression with boost may knock. This model does not calculate knock or octane limits.',
    );
  if (c.rodLength / c.stroke < 1.4)
    warn('Low rod-to-stroke ratio increases peak piston acceleration and estimated rod load.');
  if (c.camDuration > 290 && c.idleRpm < 900)
    warn('Long-duration cams may not sustain this idle target; low-speed airflow is estimated.');
  if (stressAtRpm(c, c.redline).stress > 1)
    warn(
      'Configured redline exceeds at least one component limit. Protection may intervene before redline.',
    );
  if (
    !Array.isArray(c.sources) ||
    c.sources.some(
      (source) =>
        !source ||
        typeof source.label !== 'string' ||
        typeof source.url !== 'string' ||
        !/^https?:\/\//i.test(source.url),
    )
  )
    error('Sources must be a list of labels and HTTP(S) source URLs.');
  if (typeof c.notes !== 'string') error('Configuration notes must be text.');
  return issues;
}

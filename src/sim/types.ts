/** All lengths are mm unless noted. Angles are crank degrees over a 720° cycle. */
export interface EngineConfig {
  id: string;
  name: string;
  layout: 'inline' | 'v' | 'boxer' | 'single';
  cylinders: number;
  bankAngle: number;
  bore: number;
  stroke: number;
  rodLength: number;
  compression: number;
  inertia: number;
  redline: number;
  idleRpm: number;
  /** Cylinder labels in firing order. Cylinder numbering starts at 1. */
  firingOrder: number[];
  /** Firing TDC of each cylinder, indexed by cylinder number minus one. */
  firingAngles: number[];
  fuel: 'gasoline' | 'ethanol' | 'diesel';
  afr: number;
  ignitionAdvance: number;
  throttleResponse: number;
  camDuration: number;
  camLift: number;
  valveOverlap: number;
  intakeVolume: number;
  runnerLength: number;
  runnerDiameter: number;
  throttleDiameter: number;
  exhaustLength: number;
  exhaustDiameter: number;
  muffling: number;
  aspiration: 'natural' | 'turbo' | 'supercharged';
  boostTarget: number;
  turboInertia: number;
  intercoolerEfficiency: number;
  friction: number;
  cooling: number;
  ambientTemp: number;
  maxTemp: number;
  pistonSpeedLimit: number;
  rodForceLimit: number;
  reciprocatingMass: number;
  valvetrainLimit: number;
  sources: { label: string; url: string }[];
  notes: string;
}

export interface VehicleConfig {
  mode: 'manual' | 'automatic';
  mass: number;
  dragCoefficient: number;
  frontalArea: number;
  rollingResistance: number;
  /** Loaded tire radius in meters. */
  tireRadius: number;
  finalDrive: number;
  efficiency: number;
  gearRatios: number[];
  shiftRpm: number;
}

export interface SimControls {
  throttle: number;
  brake: number;
  /** 0 = disconnected, 1 = fully engaged. */
  clutch: number;
  gear: number;
  /** Increment for an explicit shift, including requesting an unchanged input gear. */
  gearRequest?: number;
  ignition: boolean;
  starter: boolean;
  protective: boolean;
  vehicleMode: boolean;
}

export interface FiringEvent {
  cylinder: number;
  angle: number;
  time: number;
  /** Relative acoustic excitation energy, not calibrated joules. */
  energy: number;
}

export interface SimState {
  time: number;
  rpm: number;
  crankAngle: number;
  speed: number;
  gear: number;
  /** Estimated brake torque in N·m, before drivetrain load. */
  torque: number;
  /** Estimated brake power in kW. */
  power: number;
  boost: number;
  manifoldPressure: number;
  afr: number;
  temperature: number;
  stress: number;
  damage: number;
  status: 'off' | 'cranking' | 'running' | 'stalled' | 'failed' | 'limiter';
  load: number;
  throttle: number;
  pistonSpeed: number;
  rodForce: number;
  firingEvents: FiringEvent[];
  warnings: string[];
  _running?: boolean;
  _wasIgnited?: boolean;
  _shiftTimer?: number;
  _requestedGear?: number;
  _gearRequest?: number;
}

export interface DynoPoint {
  rpm: number;
  torque: number;
  power: number;
  boost: number;
  afr: number;
  manifoldPressure: number;
  stress: number;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

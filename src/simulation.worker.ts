import { createState, stepEngine } from './sim';
import type { EngineConfig, VehicleConfig, SimControls, SimState } from './sim/types';
let config: EngineConfig, vehicle: VehicleConfig, controls: SimControls, state: SimState;
let hz = 1000,
  speed = 1,
  paused = false,
  accumulator = 0,
  last = performance.now();
let reportAt = last,
  steps = 0,
  busy = 0,
  dropped = 0;
let events: SimState['firingEvents'] = [];
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    config = data.config;
    vehicle = data.vehicle;
    controls = data.controls;
    state = createState(config);
    last = performance.now();
  }
  if (data.type === 'config') {
    config = data.config;
    vehicle = data.vehicle;
  }
  if (data.type === 'controls') controls = data.controls;
  if (data.type === 'settings') {
    hz = data.hz;
    speed = data.speed;
    paused = data.paused;
    accumulator = 0;
    last = performance.now();
  }
  if (data.type === 'reset') {
    state = createState(config);
    events = [];
    accumulator = 0;
  }
};
setInterval(() => {
  const now = performance.now();
  const elapsed = Math.max(0, (now - last) / 1000);
  last = now;
  if (!state) return;
  const begin = performance.now();
  if (!paused) {
    // Bounded catch-up: discard long background-tab gaps instead of a spiral of death.
    const accepted = Math.min(elapsed, 0.1);
    dropped += Math.max(0, elapsed - accepted);
    accumulator += accepted * speed;
    const dt = 1 / hz;
    while (accumulator >= dt) {
      state = stepEngine(state, config, vehicle, controls, dt);
      events.push(...state.firingEvents);
      accumulator -= dt;
      steps++;
    }
  }
  busy += performance.now() - begin;
  if (now - reportAt >= 1000 / 30) {
    self.postMessage({
      type: 'state',
      state: { ...state, firingEvents: events },
      metrics: {
        hz: Math.round(steps / ((now - reportAt) / 1000)),
        cpu: (busy / (now - reportAt)) * 100,
        dropped,
      },
    });
    events = [];
    steps = 0;
    busy = 0;
    reportAt = now;
  }
}, 4);

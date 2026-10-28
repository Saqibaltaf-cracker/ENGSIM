import { useEffect, useRef, useState } from 'react';
import { createState, validateConfig } from '../sim';
import type { EngineConfig, VehicleConfig, SimControls, SimState } from '../sim/types';
export function useSimulation(
  config: EngineConfig,
  vehicle: VehicleConfig,
  controls: SimControls,
  hz: number,
  speed: number,
  paused: boolean,
  onState: (s: SimState) => void,
) {
  const worker = useRef<Worker | null>(null);
  const validConfig = useRef(config);
  const callback = useRef(onState);
  callback.current = onState;
  const [state, setState] = useState(() => createState(config));
  const [metrics, setMetrics] = useState({ hz: 0, cpu: 0, dropped: 0 });
  const [error, setError] = useState('');
  useEffect(() => {
    const w = new Worker(new URL('../simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === 'state') {
        setState(data.state);
        setMetrics(data.metrics);
        callback.current(data.state);
      }
    };
    w.onerror = () => setError('Simulation worker stopped. Reload the workspace to restart it.');
    w.postMessage({ type: 'init', config, vehicle, controls });
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    if (!validateConfig(config).some((p) => p.level === 'error')) validConfig.current = config;
    worker.current?.postMessage({ type: 'config', config: validConfig.current, vehicle });
  }, [config, vehicle]);
  useEffect(() => worker.current?.postMessage({ type: 'controls', controls }), [controls]);
  useEffect(
    () => worker.current?.postMessage({ type: 'settings', hz, speed, paused }),
    [hz, speed, paused],
  );
  return { state, metrics, error, reset: () => worker.current?.postMessage({ type: 'reset' }) };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from './data/presets';
import { evenFiringAngles } from './sim';
import { importConfig, readLocal, writeLocal } from './storage';
import type { EngineConfig } from './sim/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

const serialized = (engine: unknown, version: unknown = 1) =>
  JSON.stringify({ schemaVersion: version, engine });

describe('configuration import/export contract', () => {
  const customEngine: EngineConfig = {
    ...structuredClone(defaultConfig),
    id: 'saved-custom-engine',
    name: 'Research V6',
    layout: 'v',
    cylinders: 6,
    bankAngle: 60,
    bore: 88.4,
    stroke: 82.5,
    rodLength: 145,
    compression: 10.2,
    inertia: 0.285,
    redline: 7600,
    idleRpm: 925,
    firingOrder: [1, 4, 2, 5, 3, 6],
    firingAngles: evenFiringAngles([1, 4, 2, 5, 3, 6]),
    fuel: 'ethanol',
    afr: 8.4,
    ignitionAdvance: 27,
    throttleResponse: 0.18,
    camDuration: 254,
    camLift: 11.7,
    valveOverlap: 38,
    intakeVolume: 4.7,
    runnerLength: 355,
    runnerDiameter: 42.5,
    throttleDiameter: 78,
    exhaustLength: 1835,
    exhaustDiameter: 71,
    muffling: 0.43,
    aspiration: 'turbo',
    boostTarget: 0.9,
    turboInertia: 0.62,
    intercoolerEfficiency: 0.79,
    friction: 1.15,
    cooling: 3.2,
    ambientTemp: 28,
    maxTemp: 132,
    pistonSpeedLimit: 27.5,
    rodForceLimit: 42,
    reciprocatingMass: 0.49,
    valvetrainLimit: 8350,
    sources: [
      { label: 'Documented model assumptions', url: 'https://example.com/model?version=1#limits' },
    ],
    notes: 'Custom experimental configuration. Every field should survive a JSON export/import.',
  };

  it('roundtrips every custom engine field through the exported versioned envelope', () => {
    const imported = importConfig(serialized(customEngine));
    expect(imported.id).toMatch(/^custom-/);
    expect({ ...imported, id: customEngine.id }).toEqual(customEngine);
    expect(imported.firingAngles).not.toBe(customEngine.firingAngles);
    expect(imported.sources).not.toBe(customEngine.sources);
  });

  it('preserves ids during trusted local hydration and supports legacy raw engine JSON', () => {
    expect(importConfig(serialized(customEngine), true)).toEqual(customEngine);
    expect(importConfig(JSON.stringify(defaultConfig), true)).toEqual(defaultConfig);
  });

  it.each([0, 2, -1, '1', false, null])(
    'rejects unsupported or malformed declared schema version %j',
    (schemaVersion) => {
      expect(() => importConfig(serialized(customEngine, schemaVersion))).toThrow();
    },
  );

  it.each(['{', 'null', 'false', '42', '"engine"', '[]', '{"engine":[]}'])(
    'rejects non-configuration JSON: %s',
    (input) => {
      expect(() => importConfig(input)).toThrow();
    },
  );

  it.each([
    ['numeric strings', { bore: '88.4' }],
    ['null numeric value', { compression: null }],
    ['out-of-range dimensions', { stroke: -10 }],
    ['impossible connecting rod geometry', { stroke: 200, rodLength: 90 }],
    ['idle above limiter', { idleRpm: 2000, redline: 1500 }],
    ['unsupported layout', { layout: 'radial' }],
    ['unsupported fuel', { fuel: 'hydrogen' }],
    ['unsupported aspiration', { aspiration: 'electric' }],
    ['fractional cylinder count', { cylinders: 6.5 }],
    ['duplicate cylinders in firing order', { firingOrder: [1, 4, 2, 5, 3, 3] }],
    ['out-of-range cylinder label', { firingOrder: [1, 4, 2, 5, 3, 7] }],
    ['wrong firing order length', { firingOrder: [1, 4, 2] }],
    ['non-numeric firing angles', { firingAngles: [0, 120, 240, 360, '480', 600] }],
    ['out-of-cycle firing angle', { firingAngles: [0, 120, 240, 360, 480, 720] }],
    ['wrong angle list length', { firingAngles: [0, 120] }],
  ])('rejects %s instead of starting an invalid simulation', (_description, changes) => {
    expect(() => importConfig(serialized({ ...customEngine, ...changes }))).toThrow();
  });

  it('rejects parsed numeric overflow', () => {
    expect(() => importConfig('{"bore":1e999}')).toThrow(/finite/);
  });

  it.each([
    null,
    'not a list',
    [null],
    [{ label: 'Missing URL' }],
    [{ label: 42, url: 'https://example.com' }],
    [{ label: 'Unsafe scheme', url: 'javascript:alert(1)' }],
    [{ label: 'Missing host', url: 'https://' }],
    [{ label: 'Malformed hostname', url: 'https://exa mple.com/data' }],
  ])('rejects malformed source data %j', (sources) => {
    expect(() => importConfig(serialized({ ...customEngine, sources }))).toThrow();
  });

  it('ignores unknown properties without modifying Object.prototype or importing prototype keys', () => {
    const attack = JSON.parse(
      '{"__proto__":{"engineLabPolluted":true},"constructor":{"prototype":{"engineLabPolluted":true}},"prototype":{"engineLabPolluted":true},"unknown":"discard me"}',
    );
    const imported = importConfig(serialized({ ...customEngine, ...attack }), true);
    expect(Object.getPrototypeOf(imported)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(imported, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(imported, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(imported, 'prototype')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(imported, 'unknown')).toBe(false);
    expect(({} as Record<string, unknown>).engineLabPolluted).toBeUndefined();
    expect(imported).toEqual(customEngine);
  });
});

describe('local persistence failure handling', () => {
  it('saves and restores a complete engine as JSON', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    expect(writeLocal('engine-test', defaultConfig)).toBe(true);
    expect(readLocal('engine-test', null)).toEqual(defaultConfig);
    expect(readLocal('unknown-key', 'fallback')).toBe('fallback');
  });

  it('uses the fallback when saved JSON is corrupt or storage access is denied', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{corrupt JSON' });
    expect(readLocal('engine-test', defaultConfig)).toBe(defaultConfig);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Access denied');
      },
    });
    expect(readLocal('engine-test', defaultConfig)).toBe(defaultConfig);
  });

  it('reports a failed save when local storage is full', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    });
    expect(writeLocal('engine-test', defaultConfig)).toBe(false);
  });
});

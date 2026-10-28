import { describe, expect, it } from 'vitest';
import processorSource from '../../public/engine-processor.js?raw';

interface Processor {
  message(data: unknown): void;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
  queue: unknown[];
  voices: unknown[];
}

function createHarness(rate = 48000) {
  const clock = { time: 0 };
  let Constructor: (new () => Processor) | undefined;
  const register = (_name: string, implementation: new () => Processor) => {
    Constructor = implementation;
  };
  class WorkletBase {
    port = { onmessage: null };
  }
  // Run the actual browser worklet with a deterministic, sample-accurate clock.
  new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    'clock',
    processorSource.replace(/\bcurrentTime\b/g, 'clock.time'),
  )(WorkletBase, register, rate, clock);
  const processor = new Constructor!();
  let frame = 0;
  const block = () => {
    clock.time = frame / rate;
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    processor.process([], [[left, right]]);
    frame += 128;
    return left;
  };
  const update = (
    active: boolean,
    events: { time: number; cylinder: number; energy: number }[] = [],
    configPatch: Record<string, string | number> = {},
  ) => {
    processor.message({
      type: 'state',
      active,
      audioTime: clock.time + 0.05,
      rpm: 3000,
      throttle: 0.7,
      load: 0.6,
      boost: 0.5,
      crankAngle: (clock.time * 18000) % 720,
      speed: 1,
      events,
      config: {
        cylinders: 8,
        layout: 'v',
        bankAngle: 90,
        bore: 86,
        exhaustLength: 1800,
        exhaustDiameter: 65,
        muffling: 0.6,
        runnerLength: 300,
        aspiration: 'turbo',
        boostTarget: 0.8,
        ...configPatch,
      },
    });
  };
  return { processor, clock, block, update };
}

describe('event-driven AudioWorklet', () => {
  it('is silent before simulation is active', () => {
    const harness = createHarness();
    for (let block = 0; block < 20; block++)
      expect([...harness.block()].every((value) => value === 0)).toBe(true);
  });

  it('actual firing events excite exhaust energy above the mechanical-only layer', () => {
    const render = (withEvents: boolean) => {
      const harness = createHarness();
      let energy = 0;
      for (let block = 0; block < 90; block++) {
        if (block % 6 === 0)
          harness.update(
            true,
            withEvents
              ? [0, 1, 2].map((_, j) => ({
                  time: harness.clock.time + 0.002 + j * 0.005,
                  cylinder: j + 1,
                  energy: 0.8,
                }))
              : [],
          );
        for (const sample of harness.block()) energy += sample * sample;
      }
      return energy;
    };
    expect(render(true)).toBeGreaterThan(render(false) * 5);
  });

  it('firing order changes split-bank acoustics, while symmetric inline routing stays symmetric', () => {
    const alternating = [1, 2, 3, 4, 5, 6, 7, 8];
    const grouped = [1, 3, 5, 7, 2, 4, 6, 8];
    const render = (order: number[], layout: string) => {
      const harness = createHarness();
      const samples: number[] = [];
      for (let block = 0; block < 150; block++) {
        if (block % 6 === 0)
          harness.update(
            true,
            block === 0
              ? Array.from({ length: 80 }, (_, i) => ({
                  time: 0.01 + i * 0.005,
                  cylinder: order[i % 8],
                  energy: 0.8,
                }))
              : [],
            { layout },
          );
        samples.push(...harness.block());
      }
      return samples;
    };
    const difference = (a: number[], b: number[]) =>
      a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
    expect(difference(render(alternating, 'v'), render(grouped, 'v'))).toBeGreaterThan(0.005);
    expect(difference(render(alternating, 'inline'), render(grouped, 'inline'))).toBe(0);
  });

  it.each([44100, 48000])('stays finite and bounded, then silences after stop at %i Hz', (rate) => {
    const harness = createHarness(rate);
    let peak = 0;
    let stoppedTail = 0;
    for (let block = 0; block < 450; block++) {
      if (block % 6 === 0)
        harness.update(
          block < 200,
          block < 200 ? [{ time: harness.clock.time + 0.002, cylinder: 2, energy: 2 }] : [],
        );
      for (const sample of harness.block()) {
        expect(Number.isFinite(sample)).toBe(true);
        peak = Math.max(peak, Math.abs(sample));
        if (block > 420) stoppedTail = Math.max(stoppedTail, Math.abs(sample));
      }
    }
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThan(0.81);
    expect(stoppedTail).toBeLessThan(0.0001);
    expect(harness.processor.queue).toHaveLength(0);
    expect(harness.processor.voices).toHaveLength(0);
  });
});

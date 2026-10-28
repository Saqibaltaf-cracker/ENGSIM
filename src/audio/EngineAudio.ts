import type { EngineConfig, SimState } from '../sim/types';

/** Browser audio is explicitly enabled from a user gesture. No recordings are used. */
export class EngineAudio {
  private context: AudioContext | null = null;
  private processor: AudioWorkletNode | null = null;
  private output: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private volume = 0.35;
  private muted = false;
  private quality: 'economy' | 'high' = 'high';
  private enabling: Promise<void> | null = null;
  private lastSimTime = -1;
  private lastWallTime = 0;
  private speed = 1;
  private eventKeys = new Map<string, number>();

  async enable(): Promise<void> {
    if (this.context && this.processor) {
      await this.context.resume();
      return;
    }
    if (this.enabling) return this.enabling;
    this.enabling = this.initialize();
    try {
      await this.enabling;
    } finally {
      this.enabling = null;
    }
  }

  private async initialize(): Promise<void> {
    const Audio =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) throw new Error('Web Audio is unavailable in this browser.');
    const context = new Audio({ latencyHint: 'interactive' });
    this.context = context;
    // Resume before the first await so mobile browsers retain the user gesture.
    const resumed = context.resume();
    try {
      if (!context.audioWorklet)
        throw new Error('AudioWorklet requires a current browser and HTTPS (or localhost).');
      await Promise.all([
        resumed,
        context.audioWorklet.addModule(`${import.meta.env.BASE_URL}engine-processor.js`),
      ]);
      const processor = new AudioWorkletNode(context, 'engine-lab-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 24;
      highpass.Q.value = 0.6;
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = this.quality === 'high' ? 10500 : 6000;
      lowpass.Q.value = 0.55;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 12;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      const output = context.createGain();
      output.gain.value = this.muted ? 0 : this.volume;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      processor
        .connect(highpass)
        .connect(lowpass)
        .connect(limiter)
        .connect(output)
        .connect(analyser)
        .connect(context.destination);
      this.processor = processor;
      this.lowpass = lowpass;
      this.output = output;
      this.analyser = analyser;
      processor.port.postMessage({ type: 'quality', quality: this.quality });
    } catch (error) {
      await context.close();
      this.context = null;
      throw error;
    }
  }

  update(state: SimState, config: EngineConfig): void {
    if (!this.processor || !this.context) return;
    const wallTime = performance.now() / 1000;
    const simDelta = state.time - this.lastSimTime;
    const wallDelta = wallTime - this.lastWallTime;
    if (this.lastSimTime >= 0 && simDelta < 0) {
      this.eventKeys.clear();
      this.processor.port.postMessage({ type: 'clear' });
    }
    if (this.lastSimTime >= 0 && simDelta > 0 && wallDelta > 0.004 && wallDelta < 0.2) {
      const observed = Math.max(0.05, Math.min(2, simDelta / wallDelta));
      this.speed += (observed - this.speed) * 0.1;
    }
    this.lastSimTime = state.time;
    this.lastWallTime = wallTime;
    const active =
      state.rpm > 10 &&
      (state.status === 'running' || state.status === 'limiter' || state.status === 'cranking');
    const audioTime = this.context.currentTime + 0.05;
    const events: { time: number; cylinder: number; energy: number }[] = [];
    if (active)
      for (const event of state.firingEvents) {
        const key = `${event.cylinder}:${event.time.toFixed(7)}`;
        if (this.eventKeys.has(key)) continue;
        this.eventKeys.set(key, state.time);
        const offset = (event.time - state.time) / this.speed;
        // Do not turn a long main-thread pause into a burst of old combustion.
        if (offset < -0.15 || offset > 0.1) continue;
        events.push({
          time: Math.max(this.context.currentTime + 0.002, audioTime + offset),
          cylinder: event.cylinder,
          energy: event.energy,
        });
      }
    for (const [key, time] of this.eventKeys)
      if (state.time - time > 0.5) this.eventKeys.delete(key);
    this.processor.port.postMessage({
      type: 'state',
      audioTime,
      active,
      events,
      rpm: state.rpm,
      throttle: state.throttle,
      load: state.load,
      boost: state.boost,
      crankAngle: state.crankAngle,
      speed: this.speed,
      config: {
        cylinders: config.cylinders,
        layout: config.layout,
        bore: config.bore,
        bankAngle: config.bankAngle,
        exhaustLength: config.exhaustLength,
        exhaustDiameter: config.exhaustDiameter,
        muffling: config.muffling,
        runnerLength: config.runnerLength,
        aspiration: config.aspiration,
        boostTarget: config.boostTarget,
      },
    });
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  private applyGain(): void {
    if (this.output && this.context)
      this.output.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.context.currentTime,
        0.035,
      );
  }

  setQuality(quality: 'economy' | 'high'): void {
    this.quality = quality;
    this.processor?.port.postMessage({ type: 'quality', quality });
    if (this.context && this.lowpass)
      this.lowpass.frequency.setTargetAtTime(
        quality === 'high' ? 10500 : 6000,
        this.context.currentTime,
        0.1,
      );
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  dispose(): void {
    this.processor?.disconnect();
    this.processor?.port.close();
    void this.context?.close();
    this.context = null;
    this.processor = null;
    this.output = null;
    this.analyser = null;
    this.lowpass = null;
    this.eventKeys.clear();
  }
}

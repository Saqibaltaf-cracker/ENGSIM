/* Engine Lab: actual-event excitation; no engine recordings or free-running firing oscillator. */
class Resonator {
  constructor() {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
    this.tune(100, 1);
  }
  tune(frequency, q) {
    const w = (2 * Math.PI * Math.min(sampleRate * 0.4, Math.max(30, frequency))) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  next(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class EngineLabProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.voices = [];
    this.active = false;
    this.lastMessage = -1;
    this.rpm = 0;
    this.throttle = 0;
    this.load = 0;
    this.boost = 0;
    this.gate = 0;
    this.state = { rpm: 0, throttle: 0, load: 0, boost: 0, crankAngle: 0, audioTime: 0, speed: 1 };
    this.config = {
      cylinders: 8,
      layout: 'v',
      muffling: 0.5,
      aspiration: 'natural',
      boostTarget: 0.7,
    };
    this.delay = new Float32Array(Math.ceil(sampleRate * 0.12));
    this.delayRight = new Float32Array(this.delay.length);
    this.write = 0;
    this.delayLength = 400;
    this.delayLengthRight = 400;
    this.propagationLeft = 0.003;
    this.propagationRight = 0.003;
    this.delayLow = 0;
    this.delayLowRight = 0;
    this.exhaustLow = 0;
    this.exhaustLowRight = 0;
    this.noiseLow = 0;
    this.seed = 0x5ab2781;
    this.modes = [new Resonator(), new Resonator(), new Resonator()];
    this.modesRight = [new Resonator(), new Resonator(), new Resonator()];
    this.intake = new Resonator();
    this.mechanical = new Resonator();
    this.mechanical.tune(1900, 0.75);
    this.quality = 'high';
    this.blowoff = 0;
    this.turboPhase = 0;
    this.port.onmessage = ({ data }) => this.message(data);
  }
  message(data) {
    if (data.type === 'quality') {
      this.quality = data.quality;
      return;
    }
    if (data.type === 'clear') {
      this.queue.length = 0;
      this.voices.length = 0;
      this.delay.fill(0);
      this.delayRight.fill(0);
      return;
    }
    if (data.type !== 'state') return;
    if (
      this.state.throttle - data.throttle > 0.18 &&
      this.state.boost > 0.12 &&
      data.config.aspiration === 'turbo'
    )
      this.blowoff = Math.min(1, this.state.boost);
    this.state = data;
    this.config = data.config;
    this.active = data.active;
    this.lastMessage = currentTime;
    if (!data.active) {
      this.queue.length = 0;
      this.voices.length = 0;
    } else {
      for (const event of data.events) if (this.queue.length < 256) this.queue.push(event);
      this.queue.sort((a, b) => a.time - b.time);
    }
    const length = Math.max(0.2, data.config.exhaustLength / 1000);
    const splitBanks = data.config.layout === 'v' || data.config.layout === 'boxer';
    // Approximate lateral bank spacing and an off-axis collector/observer. This is a
    // documented acoustic routing assumption, not measured header geometry.
    const bankSpread = splitBanks
      ? ((data.config.bore || 86) / 1000 + 0.04) *
        Math.sin(((data.config.bankAngle || 90) * Math.PI) / 360)
      : 0;
    const pathLeft = length + bankSpread * 0.5;
    const pathRight = Math.max(0.2, length - bankSpread * 0.5);
    this.propagationLeft = pathLeft / 430;
    this.propagationRight = pathRight / 430;
    this.delayLength = Math.max(
      30,
      Math.min(this.delay.length - 1, Math.round((2 * pathLeft * sampleRate) / 430)),
    );
    this.delayLengthRight = Math.max(
      30,
      Math.min(this.delay.length - 1, Math.round((2 * pathRight * sampleRate) / 430)),
    );
    for (const [modes, path] of [
      [this.modes, pathLeft],
      [this.modesRight, pathRight],
    ]) {
      const fundamental = Math.max(40, Math.min(550, 430 / (4 * path)));
      modes[0].tune(fundamental, 1.8);
      modes[1].tune(fundamental * 3, 2.2);
      modes[2].tune(fundamental * 5, 1.7);
    }
    this.intake.tune(
      Math.min(2400, 343 / (4 * Math.max(0.06, data.config.runnerLength / 1000))),
      1.15,
    );
  }
  noise() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 2147483648 - 1;
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || left;
    const dt = 1 / sampleRate;
    const heartbeat = currentTime - this.lastMessage < 0.25;
    const targetGate = this.active && heartbeat ? 1 : 0;
    const muffling = Math.max(0, Math.min(1, this.config.muffling));
    const feedback = 0.2 + (1 - muffling) * 0.3;
    const smoothing = 1 - Math.exp(-dt / 0.025);
    const pulseDecay = 0.0015 + muffling * 0.0013;
    const pulseFalloff = Math.exp(-dt / pulseDecay);
    const pulseRise = Math.exp(-dt / 0.00018);
    const blowoffFalloff = Math.exp(-dt / 0.12);
    const high = this.quality === 'high';
    for (let i = 0; i < left.length; i++) {
      const now = currentTime + i * dt;
      this.rpm += (this.state.rpm - this.rpm) * smoothing;
      this.throttle += (this.state.throttle - this.throttle) * smoothing;
      this.load += (this.state.load - this.load) * smoothing;
      this.boost += (this.state.boost - this.boost) * smoothing;
      this.gate += (targetGate - this.gate) * (targetGate ? 0.002 : 0.001);
      while (this.queue.length && this.queue[0].time <= now) {
        const event = this.queue.shift();
        if (targetGate && now - event.time < 0.06 && this.voices.length < (high ? 96 : 48)) {
          // Cylinder-dependent propagation in V/boxer banks makes routing/order audible.
          const bank =
            this.config.layout === 'inline' || this.config.layout === 'single'
              ? 0
              : event.cylinder % 2
                ? -1
                : 1;
          this.voices.push({
            age: -(bank > 0 ? this.propagationRight : this.propagationLeft),
            slow: 1,
            fast: 1,
            amplitude: Math.max(0.02, Math.min(2, event.energy)),
            bank,
          });
        }
      }
      let pressure = 0;
      let pressureRight = 0;
      for (let v = this.voices.length - 1; v >= 0; v--) {
        const voice = this.voices[v];
        voice.age += dt;
        if (voice.age > (high ? 0.018 : 0.012)) {
          this.voices.splice(v, 1);
          continue;
        }
        if (voice.age < 0) continue;
        // Smooth pressure rise rather than a discontinuous impulse (less high-frequency aliasing).
        const pulse = (voice.slow - voice.fast) * voice.amplitude;
        voice.slow *= pulseFalloff;
        voice.fast *= pulseRise;
        pressure += pulse * (voice.bank > 0 ? 0.15 : voice.bank < 0 ? 0.85 : 0.5);
        pressureRight += pulse * (voice.bank > 0 ? 0.85 : voice.bank < 0 ? 0.15 : 0.5);
      }
      const noise = this.noise();
      const read = (this.write - this.delayLength + this.delay.length) % this.delay.length;
      const readRight =
        (this.write - this.delayLengthRight + this.delay.length) % this.delay.length;
      const reflection = this.delay[read];
      const reflectionRight = this.delayRight[readRight];
      this.delayLow += (reflection - this.delayLow) * (0.13 + (1 - muffling) * 0.35);
      this.delayLowRight += (reflectionRight - this.delayLowRight) * (0.13 + (1 - muffling) * 0.35);
      this.delay[this.write] = pressure * 0.7 + this.delayLow * feedback;
      this.delayRight[this.write] = pressureRight * 0.7 + this.delayLowRight * feedback;
      this.write = (this.write + 1) % this.delay.length;
      const drive = pressure + this.delayLow * 0.7;
      const driveRight = pressureRight + this.delayLowRight * 0.7;
      const mode0 = this.modes[0].next(drive);
      const mode1 = this.modes[1].next(drive);
      const mode2 = high ? this.modes[2].next(drive) : 0;
      const mode0Right = this.modesRight[0].next(driveRight);
      const mode1Right = this.modesRight[1].next(driveRight);
      const mode2Right = high ? this.modesRight[2].next(driveRight) : 0;
      const diameter = Math.max(25, Math.min(180, this.config.exhaustDiameter || 65));
      const radiated =
        drive * (0.2 + diameter / 380) +
        mode0 * 1.1 +
        mode1 * (0.55 - muffling * 0.3) +
        mode2 * (0.22 - muffling * 0.16);
      const radiatedRight =
        driveRight * (0.2 + diameter / 380) +
        mode0Right * 1.1 +
        mode1Right * (0.55 - muffling * 0.3) +
        mode2Right * (0.22 - muffling * 0.16);
      this.exhaustLow += (radiated - this.exhaustLow) * (0.12 + (1 - muffling) * 0.3);
      this.exhaustLowRight +=
        (radiatedRight - this.exhaustLowRight) * (0.12 + (1 - muffling) * 0.3);
      this.noiseLow += (noise - this.noiseLow) * 0.08;
      const intake = this.intake.next(
        noise * (0.018 + this.throttle * 0.09) * Math.min(1.5, this.rpm / 3000),
      );
      const crank =
        ((this.state.crankAngle + this.rpm * 6 * (now - this.state.audioTime) * this.state.speed) *
          Math.PI) /
        180;
      const mechanical =
        this.mechanical.next(noise) * Math.min(0.026, this.rpm / 320000) +
        Math.sin(crank * 2) * 0.006;
      let induction = 0;
      this.turboPhase += (1000 + Math.sqrt(Math.max(0, this.boost)) * 4700) * dt * 2 * Math.PI;
      if (this.turboPhase > Math.PI * 2) this.turboPhase %= Math.PI * 2;
      if (this.config.aspiration === 'turbo') {
        const gate = Math.max(0, this.boost / Math.max(0.1, this.config.boostTarget) - 0.8);
        induction =
          Math.sin(this.turboPhase) * Math.min(0.025, this.boost * 0.02) +
          noise * gate * 0.009 +
          (noise - this.noiseLow) * this.blowoff * 0.07;
      } else if (this.config.aspiration === 'supercharged')
        induction = Math.sin(crank * 9) * (0.006 + this.throttle * 0.015);
      this.blowoff *= blowoffFalloff;
      const center = (intake + mechanical + induction) * this.gate;
      const sample =
        (this.exhaustLow * 0.85 + this.exhaustLowRight * 0.35) * 0.8 * this.gate + center;
      const sampleRight =
        (this.exhaustLowRight * 0.85 + this.exhaustLow * 0.35) * 0.8 * this.gate + center;
      // Soft limiting here plus a downstream compressor protects against large transients.
      left[i] = Math.tanh(sample) * 0.8;
      right[i] = Math.tanh(sampleRight) * 0.8;
    }
    return true;
  }
}
registerProcessor('engine-lab-processor', EngineLabProcessor);

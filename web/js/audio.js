/**
 * Star Invaders audio engine.
 *
 * Everything you hear is synthesised in the browser with the Web Audio API:
 * no sample files, no third party assets, nothing to download. Sound effects
 * are short oscillator/noise patches; the background music is a small
 * chiptune tracker that schedules pulse, triangle and noise voices a fraction
 * of a second ahead of the clock.
 */

const LOOKAHEAD = 0.18;   // seconds of music scheduled in advance
const TICK_MS = 25;       // scheduler wake-up interval

/* ------------------------------------------------------------------ notes */

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const freqCache = new Map();

function noteFreq(tok) {
  const hit = freqCache.get(tok);
  if (hit !== undefined) return hit;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(tok);
  if (!m) {
    freqCache.set(tok, 0);
    return 0;
  }
  const semis = NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const octave = parseInt(m[3], 10);
  const f = 440 * Math.pow(2, (semis + (octave - 4) * 12 - 9) / 12);
  freqCache.set(tok, f);
  return f;
}

/**
 * Turns "C2 . C2 - G1 ." into a per-step array where each struck note knows
 * how many steps it should ring for. "." holds, "-" rests.
 */
function parseSeq(str) {
  const toks = str.trim().split(/\s+/);
  const out = new Array(toks.length).fill(null);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-' || t === '.') continue;
    let steps = 1;
    for (let j = i + 1; j < toks.length && toks[j] === '.'; j++) steps++;
    out[i] = { tok: t, steps };
  }
  return out;
}

/* ----------------------------------------------------------------- tracks */

const RAW_TRACKS = {
  menu: {
    bpm: 94, stepsPerBeat: 2, swing: 0.04,
    channels: {
      bass: { inst: 'bass', gain: 0.42, seq: 'A2 . . . F2 . . . C3 . . . G2 . . .' },
      lead: { inst: 'pulse50', gain: 0.1, seq: 'E4 - A4 - C5 - B4 - A4 - F4 - G4 - E4 -' },
      arp: { inst: 'pulse12', gain: 0.075, seq: 'A4 C5 E5 C5 F4 A4 C5 A4 C4 E4 G4 E4 G4 B4 D5 B4' },
      drum: { inst: 'drum', gain: 0.16, seq: '- - H - - - H - - - H - - - H O' },
    },
  },
  march: {
    bpm: 126, stepsPerBeat: 2,
    channels: {
      bass: {
        inst: 'bass', gain: 0.5,
        seq: 'C2 . C2 . C2 - G1 - C2 . C2 . Bb1 - Bb1 - Ab1 . Ab1 . Ab1 - Eb2 - G1 . G1 . G1 - G1 -',
      },
      lead: {
        inst: 'pulse25', gain: 0.14,
        seq: '- - C4 - Eb4 - G4 - - - F4 - Eb4 - C4 - - - Bb3 - C4 - Eb4 - - - G4 - F4 - Eb4 -',
      },
      arp: { inst: 'pulse12', gain: 0.085, seq: 'C5 G4 Eb5 G4 C5 G4 Eb5 G4 Bb4 F4 D5 F4 Bb4 F4 D5 F4' },
      drum: { inst: 'drum', gain: 0.26, seq: 'K - H - S - H - K - H - S - H H' },
    },
  },
  tension: {
    bpm: 138, stepsPerBeat: 2,
    channels: {
      bass: {
        inst: 'bass', gain: 0.52,
        seq: 'D2 . D2 - Eb2 - D2 - A1 . A1 - Bb1 - A1 - D2 . D2 - F2 - D2 - Bb1 . Bb1 - C2 - Db2 -',
      },
      lead: {
        inst: 'pulse25', gain: 0.13,
        seq: '- D4 - F4 - Ab4 - G4 - F4 - Eb4 - D4 - - - A4 - C5 - Eb5 - D5 - C5 - Bb4 - A4 - -',
      },
      arp: { inst: 'pulse12', gain: 0.08, seq: 'D5 A4 F5 A4 Eb5 Bb4 Gb5 Bb4' },
      drum: { inst: 'drum', gain: 0.27, seq: 'K H - H S H - H K H K H S H - O' },
    },
  },
  boss: {
    bpm: 148, stepsPerBeat: 2,
    channels: {
      bass: {
        inst: 'bass', gain: 0.58,
        seq: 'E2 E2 E2 - G2 - E2 - E2 E2 E2 - A2 - B2 - E2 E2 E2 - G2 - E2 - C2 C2 C2 - B1 - B1 -',
      },
      lead: {
        inst: 'pulse25', gain: 0.16,
        seq: 'E4 - B4 - E5 - D5 - B4 - G4 - A4 - B4 - E5 - D5 - C5 - B4 - A4 - G4 - F#4 - E4 -',
      },
      arp: { inst: 'pulse12', gain: 0.095, seq: 'E5 B4 G5 B4 E5 B4 G5 B4 F#5 C#5 A5 C#5 F#5 C#5 A5 C#5' },
      drum: { inst: 'drum', gain: 0.31, seq: 'K K H S K - H S K K H S K H S O' },
    },
  },
  swarm: {
    bpm: 162, stepsPerBeat: 2,
    channels: {
      bass: { inst: 'bass', gain: 0.5, seq: 'A1 A1 A1 A1 C2 C2 C2 C2 D2 D2 D2 D2 F2 F2 E2 E2' },
      lead: { inst: 'pulse25', gain: 0.14, seq: 'A4 C5 E5 C5 A4 C5 E5 G5 F5 D5 A4 D5 E5 G5 A5 -' },
      arp: { inst: 'pulse12', gain: 0.085, seq: 'A5 E5 C6 E5 A5 E5 C6 E5' },
      drum: { inst: 'drum', gain: 0.3, seq: 'K H K H S H K H K H K H S H S H' },
    },
  },
  siege: {
    bpm: 132, stepsPerBeat: 2,
    channels: {
      bass: {
        inst: 'bass', gain: 0.55,
        seq: 'F2 . C2 . F2 . Ab2 . Bb2 . F2 . C3 . C2 . F2 . C2 . Db3 . C3 . Bb2 . Ab2 . G2 . F2 .',
      },
      lead: {
        inst: 'pulse50', gain: 0.13,
        seq: 'F4 - Ab4 - C5 - Db5 - C5 - Ab4 - F4 - G4 - Ab4 - C5 - Eb5 - Db5 - C5 - Bb4 - Ab4 - -',
      },
      arp: { inst: 'pulse12', gain: 0.08, seq: 'F5 C5 Ab5 C5 Bb4 F4 Db5 F4' },
      drum: { inst: 'drum', gain: 0.29, seq: 'K - S - K K S - K - S - K S S O' },
    },
  },
  final: {
    bpm: 154, stepsPerBeat: 2,
    channels: {
      bass: {
        inst: 'bass', gain: 0.6,
        seq: 'C2 C2 C2 - Eb2 - C2 - Ab1 Ab1 Ab1 - Bb1 - C2 - F1 F1 F1 - Ab1 - F1 - G1 G1 G1 - Bb1 - B1 -',
      },
      lead: {
        inst: 'pulse25', gain: 0.17,
        seq: 'C5 - G4 - Ab4 - C5 - Eb5 - D5 - C5 - - - Ab4 - Eb4 - F4 - Ab4 - Bb4 - G4 - F4 - - -',
      },
      arp: { inst: 'pulse12', gain: 0.1, seq: 'C6 G5 Eb6 G5 C6 G5 Eb6 G5 Bb5 F5 D6 F5 Bb5 F5 D6 F5' },
      drum: { inst: 'drum', gain: 0.32, seq: 'K K H S K - H S K K H S K H S S' },
    },
  },
};

// Pre-parse every sequence once at module load.
const TRACKS = {};
for (const [name, t] of Object.entries(RAW_TRACKS)) {
  const channels = {};
  for (const [ch, def] of Object.entries(t.channels)) {
    channels[ch] = { ...def, steps: parseSeq(def.seq) };
  }
  TRACKS[name] = { ...t, channels };
}

/* ----------------------------------------------------------------- engine */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.musicVolume = 0.55;
    this.sfxVolume = 0.85;

    this.track = null;        // current track name
    this.trackDef = null;
    this.step = 0;
    this.nextStepTime = 0;
    this.timer = null;
    this.intensity = 0.5;
    this._pulseWaves = new Map();
    this._noise = null;
    this._marchTone = 0;
  }

  /** Must be called from a user gesture before anything will be audible. */
  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return false;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      // A gentle limiter keeps a wall of simultaneous explosions from
      // clipping into distortion.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 7;
      this.limiter.attack.value = 0.004;
      this.limiter.release.value = 0.2;

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;

      this.musicBus.connect(this.limiter);
      this.sfxBus.connect(this.limiter);
      this.limiter.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.ready = true;
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignored */ }
    }
    // A track requested before the first user gesture was parked; start it
    // now that we are allowed to make noise.
    if (this.pendingTrack && !this.track) {
      const want = this.pendingTrack;
      this.pendingTrack = null;
      this.playMusic(want);
    }
    return this.ctx.state === 'running';
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.03);
    }
    return this.muted;
  }

  toggleMute() { return this.setMuted(!this.muted); }

  /** 0..1 - scales the busier music layers as the action heats up. */
  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /* ------------------------------------------------------------ voices */

  _pulse(duty) {
    let w = this._pulseWaves.get(duty);
    if (!w) {
      const n = 28;
      const real = new Float32Array(n + 1);
      const imag = new Float32Array(n + 1);
      for (let i = 1; i <= n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
      w = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      this._pulseWaves.set(duty, w);
    }
    return w;
  }

  _noiseBuffer() {
    if (!this._noise) {
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  _noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.05);
    return src;
  }

  /** Short pulse-wave blip with an exponential decay. */
  _blip(bus, { freq, to, t, dur, duty = 0.5, gain = 0.3, type = null, attack = 0.004 }) {
    const osc = this.ctx.createOscillator();
    if (type) osc.type = type;
    else osc.setPeriodicWave(this._pulse(duty));
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    return { osc, g };
  }

  _bassNote(freq, t, dur, gain) {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq / 2, t);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98);

    osc.connect(lp);
    sub.connect(lp);
    lp.connect(g).connect(this.musicBus);
    osc.start(t); osc.stop(t + dur);
    sub.start(t); sub.stop(t + dur);
  }

  _drumHit(tok, t, gain) {
    const ctx = this.ctx;
    if (tok === 'K') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(44, t + 0.13);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain * 1.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g).connect(this.musicBus);
      osc.start(t); osc.stop(t + 0.18);
      return;
    }
    const dur = tok === 'S' ? 0.14 : tok === 'O' ? 0.18 : 0.045;
    const src = this._noiseSource(t, dur);
    const f = ctx.createBiquadFilter();
    if (tok === 'S') {
      f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9;
    } else {
      f.type = 'highpass'; f.frequency.value = 7200;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * (tok === 'S' ? 1.1 : 0.6), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.musicBus);

    if (tok === 'S') { // body under the snare
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
      const og = ctx.createGain();
      og.gain.setValueAtTime(gain * 0.5, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(og).connect(this.musicBus);
      o.start(t); o.stop(t + 0.12);
    }
  }

  /* ------------------------------------------------------------- music */

  playMusic(name) {
    if (!this.ready) { this.pendingTrack = name; return; }
    if (this.track === name) return;
    const def = TRACKS[name];
    if (!def) return;
    this.track = name;
    this.trackDef = def;
    this.step = 0;
    this.stepDur = 60 / def.bpm / (def.stepsPerBeat || 2);
    this.nextStepTime = this.ctx.currentTime + 0.08;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), TICK_MS);
  }

  stopMusic() {
    this.track = null;
    this.trackDef = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _schedule() {
    if (!this.trackDef || !this.ctx) return;
    if (this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.nextStepTime < horizon && guard++ < 64) {
      this._scheduleStep(this.step, this.nextStepTime);
      this.step++;
      this.nextStepTime += this.stepDur;
    }
    // If the tab was backgrounded the clock may have run far ahead.
    if (this.nextStepTime < this.ctx.currentTime - 0.5) {
      this.nextStepTime = this.ctx.currentTime + 0.05;
    }
  }

  _scheduleStep(step, t) {
    const def = this.trackDef;
    const swing = def.swing ? (step % 2 ? def.swing * this.stepDur : 0) : 0;
    const when = t + swing;
    for (const [ch, c] of Object.entries(def.channels)) {
      const slot = c.steps[step % c.steps.length];
      if (!slot) continue;
      const hot = (ch === 'arp' || ch === 'drum') ? 0.55 + 0.45 * this.intensity : 1;
      const gain = c.gain * hot;
      if (c.inst === 'drum') {
        this._drumHit(slot.tok, when, gain);
        continue;
      }
      const f = noteFreq(slot.tok);
      if (!f) continue;
      const dur = Math.max(0.05, slot.steps * this.stepDur * 0.92);
      if (c.inst === 'bass') {
        this._bassNote(f, when, dur, gain);
      } else {
        const duty = c.inst === 'pulse12' ? 0.125 : c.inst === 'pulse25' ? 0.25 : 0.5;
        this._blip(this.musicBus, { freq: f, t: when, dur, duty, gain, attack: 0.008 });
      }
    }
  }

  /* --------------------------------------------------------------- sfx */

  _sfxReady() { return this.ready && this.ctx && this.ctx.state === 'running' && !this.muted; }

  shoot(power = 0) {
    if (!this._sfxReady()) return;
    const t = this.now;
    this._blip(this.sfxBus, {
      freq: 980 + power * 160, to: 240, t, dur: 0.1,
      duty: 0.25, gain: 0.17,
    });
    this._blip(this.sfxBus, { freq: 1960, to: 700, t, dur: 0.05, duty: 0.125, gain: 0.05 });
  }

  enemyShoot() {
    if (!this._sfxReady()) return;
    const t = this.now;
    this._blip(this.sfxBus, { freq: 340, to: 150, t, dur: 0.13, type: 'sawtooth', gain: 0.07 });
  }

  hit() {
    if (!this._sfxReady()) return;
    const t = this.now;
    this._blip(this.sfxBus, { freq: 1500, to: 900, t, dur: 0.05, duty: 0.5, gain: 0.1 });
  }

  armour() {
    if (!this._sfxReady()) return;
    const t = this.now;
    this._blip(this.sfxBus, { freq: 2400, to: 1800, t, dur: 0.07, type: 'square', gain: 0.07 });
    this._blip(this.sfxBus, { freq: 3300, to: 2600, t: t + 0.01, dur: 0.05, type: 'square', gain: 0.04 });
  }

  /** size 0 (swarmlet) .. 2 (capital ship) */
  explode(size = 1) {
    if (!this._sfxReady()) return;
    const t = this.now;
    const dur = 0.24 + size * 0.34;
    const src = this._noiseSource(t, dur);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600 + size * 1600, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 + size * 0.13, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(this.sfxBus);

    const thump = this.ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150 + size * 40, t);
    thump.frequency.exponentialRampToValueAtTime(36, t + dur * 0.7);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.1 + size * 0.14, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    thump.connect(tg).connect(this.sfxBus);
    thump.start(t); thump.stop(t + dur);
  }

  playerHit() {
    if (!this._sfxReady()) return;
    const t = this.now;
    this.explode(1.4);
    this._blip(this.sfxBus, { freq: 420, to: 42, t, dur: 0.75, type: 'sawtooth', gain: 0.16 });
    this._blip(this.sfxBus, { freq: 210, to: 30, t: t + 0.04, dur: 0.8, type: 'square', gain: 0.08 });
  }

  shieldBreak() {
    if (!this._sfxReady()) return;
    const t = this.now;
    this._blip(this.sfxBus, { freq: 1200, to: 300, t, dur: 0.3, type: 'triangle', gain: 0.14 });
    this._blip(this.sfxBus, { freq: 1800, to: 500, t: t + 0.02, dur: 0.25, duty: 0.125, gain: 0.07 });
  }

  _arp(notes, t0, step, dur, gain, duty = 0.25) {
    notes.forEach((n, i) => {
      this._blip(this.sfxBus, {
        freq: noteFreq(n), t: t0 + i * step, dur, duty, gain,
      });
    });
  }

  powerup() {
    if (!this._sfxReady()) return;
    this._arp(['C5', 'E5', 'G5', 'C6'], this.now, 0.055, 0.1, 0.13, 0.5);
  }

  extraLife() {
    if (!this._sfxReady()) return;
    this._arp(['G4', 'C5', 'E5', 'G5', 'C6', 'E6'], this.now, 0.07, 0.13, 0.12, 0.5);
  }

  pickup() {
    if (!this._sfxReady()) return;
    this._arp(['A5', 'E6'], this.now, 0.04, 0.07, 0.08, 0.25);
  }

  levelStart() {
    if (!this._sfxReady()) return;
    this._arp(['C4', 'G4', 'C5', 'E5', 'G5'], this.now, 0.085, 0.16, 0.13, 0.5);
  }

  levelClear() {
    if (!this._sfxReady()) return;
    this._arp(['C5', 'D5', 'E5', 'G5', 'A5', 'C6'], this.now, 0.09, 0.19, 0.13, 0.5);
  }

  bossWarning() {
    if (!this._sfxReady()) return;
    const t = this.now;
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.34;
      this._blip(this.sfxBus, { freq: 300, to: 760, t: at, dur: 0.16, type: 'sawtooth', gain: 0.13 });
      this._blip(this.sfxBus, { freq: 760, to: 300, t: at + 0.16, dur: 0.16, type: 'sawtooth', gain: 0.13 });
    }
  }

  bomb() {
    if (!this._sfxReady()) return;
    const t = this.now;
    const src = this._noiseSource(t, 0.9);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(180, t + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(bp).connect(g).connect(this.sfxBus);
    this.explode(1.8);
  }

  gameOver() {
    if (!this._sfxReady()) return;
    this.stopMusic();
    this._arp(['C5', 'A4', 'F4', 'D4', 'C4', 'G3', 'C3'], this.now + 0.05, 0.16, 0.3, 0.14, 0.5);
  }

  victory() {
    if (!this._sfxReady()) return;
    this.stopMusic();
    const t = this.now + 0.05;
    this._arp(['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6'], t, 0.1, 0.22, 0.14, 0.5);
    this._arp(['C3', 'C3', 'G3', 'C4'], t, 0.26, 0.4, 0.1, 0.5);
  }

  /** The four-tone descending tick that marks a formation step. */
  marchStep(urgency = 0) {
    if (!this._sfxReady()) return;
    const tones = [196, 174.6, 155.6, 146.8];
    const f = tones[this._marchTone % tones.length];
    this._marchTone++;
    this._blip(this.sfxBus, {
      freq: f * (1 + urgency * 0.12), to: f * 0.84, t: this.now,
      dur: 0.085, type: 'triangle', gain: 0.075,
    });
  }

  uiClick() {
    if (!this._sfxReady()) return;
    this._blip(this.sfxBus, { freq: 760, to: 1180, t: this.now, dur: 0.05, duty: 0.5, gain: 0.07 });
  }

  uiBack() {
    if (!this._sfxReady()) return;
    this._blip(this.sfxBus, { freq: 600, to: 300, t: this.now, dur: 0.07, duty: 0.5, gain: 0.07 });
  }

  netPing() {
    if (!this._sfxReady()) return;
    this._arp(['E6', 'B6'], this.now, 0.05, 0.06, 0.035, 0.125);
  }
}

export const audio = new AudioEngine();

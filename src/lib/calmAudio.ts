/**
 * Generated calm sounds (Phase 11, Spec §6.3 "ambient sounds"): soft
 * noise-based soundscapes synthesized with the Web Audio API — no media
 * files, no licensing, nothing to download, works offline by construction.
 * Everything stays on-device; nothing is recorded (there is no input node
 * anywhere in this graph).
 */

export type SoundscapeId = 'rain' | 'ocean';

export const SOUNDSCAPES: readonly { id: SoundscapeId; name: string }[] = [
  { id: 'rain', name: 'Soft rain' },
  { id: 'ocean', name: 'Ocean waves' },
];

type Engine = {
  context: AudioContext;
  master: GainNode;
  running: { source: AudioBufferSourceNode; lfo: OscillatorNode | null } | null;
};

let engine: Engine | null = null;

export function isAudioSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

function getEngine(): Engine {
  if (engine === null) {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);
    engine = { context, master, running: null };
  }
  return engine;
}

/** Two seconds of looping noise: white for rain, brown for ocean depth. */
function noiseBuffer(context: AudioContext, kind: SoundscapeId): AudioBuffer {
  const length = context.sampleRate * 2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    if (kind === 'rain') {
      data[i] = white * 0.6;
    } else {
      // Brown noise: integrate white noise, keep it bounded.
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

export async function startSoundscape(kind: SoundscapeId): Promise<void> {
  const eng = getEngine();
  stopSoundscape();
  if (eng.context.state === 'suspended') {
    await eng.context.resume();
  }

  const source = eng.context.createBufferSource();
  source.buffer = noiseBuffer(eng.context, kind);
  source.loop = true;

  const filter = eng.context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = kind === 'rain' ? 1400 : 600;

  let lfo: OscillatorNode | null = null;
  if (kind === 'ocean') {
    // A slow swell: the LFO breathes the volume like waves arriving.
    const swell = eng.context.createGain();
    swell.gain.value = 0.6;
    lfo = eng.context.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoDepth = eng.context.createGain();
    lfoDepth.gain.value = 0.35;
    lfo.connect(lfoDepth);
    lfoDepth.connect(swell.gain);
    source.connect(filter);
    filter.connect(swell);
    swell.connect(eng.master);
    lfo.start();
  } else {
    source.connect(filter);
    filter.connect(eng.master);
  }

  source.start();
  eng.running = { source, lfo };
}

export function stopSoundscape(): void {
  if (engine === null) {
    return;
  }
  const running = engine.running;
  if (running === null) {
    return;
  }
  running.source.stop();
  running.source.disconnect();
  running.lfo?.stop();
  running.lfo?.disconnect();
  engine.running = null;
}

export function setSoundscapeVolume(level: number): void {
  const bounded = Math.min(1, Math.max(0, level));
  if (engine !== null) {
    engine.master.gain.value = bounded * 0.7;
  }
}

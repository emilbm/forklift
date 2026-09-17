/**
 * The rest-timer bell.
 *
 * iOS will only play audio from a context created or resumed during a user
 * gesture, and the bell rings a minute later with no gesture in sight. So the
 * context is opened on the first tap of a workout and kept alive — `prime` is
 * called from the buttons you press anyway.
 *
 * Keeping it alive is the hard part. Safari parks the context whenever
 * something else takes the audio session — a phone call, another app, the
 * screen locking — and leaves it in `interrupted`, a state of its own that is
 * not `suspended` and does not come back by itself. Every path to the bell
 * therefore goes through `resumed()`, which revives whatever state it finds and
 * only then schedules the sound.
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    // A closed context can never be resumed, so it is replaced rather than revived.
    if (context === null || context.state === 'closed') context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/**
 * The context, running. Resolves to null if it can't be woken — which happens
 * outside a gesture, and is why priming matters.
 */
async function resumed(): Promise<AudioContext | null> {
  const ctx = audioContext();
  if (!ctx) return null;
  // Anything other than running — 'suspended', or Safari's own 'interrupted'.
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }
  return ctx.state === 'running' ? ctx : null;
}

/** Call from a real user gesture, so the bell can ring later without one. */
export function primeAudio(): void {
  void resumed();
}

/**
 * One strike: a struck bell is a handful of inharmonic partials that decay at
 * different rates, the high ones fastest. A plain sine just sounds like a beep.
 */
function strike(ctx: AudioContext, at: number, gain: number): void {
  const partials: Array<[frequency: number, level: number, seconds: number]> = [
    [540, 0.5, 1.6],
    [1080, 1, 1.3],
    [1620, 0.6, 0.9],
    [2700, 0.35, 0.5],
    [3240, 0.2, 0.35],
  ];

  for (const [frequency, level, seconds] of partials) {
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    // Near-instant attack, long exponential decay — the shape of a struck bell.
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain * level, at + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    osc.connect(envelope).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }
}

/**
 * Three quick rings, the way a boxing bell ends a round. Scheduled only once
 * the context is awake: `currentTime` stands still while it is parked, so
 * scheduling first and waking after plays the whole bell into the past.
 */
export function ringBell(): void {
  void resumed().then((ctx) => {
    if (!ctx) return;
    try {
      const now = ctx.currentTime + 0.02;
      strike(ctx, now, 0.3);
      strike(ctx, now + 0.34, 0.3);
      strike(ctx, now + 0.68, 0.26);
    } catch {
      // Autoplay policy, or no audio device. The visual state carries it.
    }
  });
}

/** A short buzz to go with the bell; unsupported on iOS, which is fine. */
export function buzz(): void {
  try {
    navigator.vibrate?.([140, 90, 140, 90, 180]);
  } catch {
    /* no vibration motor, or blocked */
  }
}

/**
 * Coming back to the tab is the usual moment the context needs reviving, and it
 * is the one moment we get without waiting for a tap.
 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && context !== null) primeAudio();
  });
}

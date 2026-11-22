// A gentle original waltz synthesised with WebAudio: no recording, no download, nobody's copyright.
// Off until the guest taps the button (browsers also require a tap before any sound). A soft triangle lead over
// sine-wave chords, with a quiet echo; the tune loops every 16 bars. stop() fades out in half a second.
const BPM = 76;
const BEAT = 60 / BPM;
// D major: scale degrees -> semitones from D4
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
// [degree, beats] — 16 bars of 3/4; null is a rest
const TUNE = [[4, 2], [5, 1], [4, 1.5], [3, 0.5], [2, 1], [1, 2], [2, 1], [4, 3],
  [2, 2], [3, 1], [2, 1.5], [1, 0.5], [0, 1], [1, 2], [3, 1], [2, 3],
  [4, 2], [7, 1], [6, 1.5], [5, 0.5], [4, 1], [5, 2], [3, 1], [4, 3],
  [2, 1], [3, 1], [4, 1], [3, 1.5], [2, 0.5], [1, 1], [0, 3], [null, 3]];
// one chord per bar (root degrees of a triad), 16 bars
const CHORDS = [0, 4, 3, 0, 5, 4, 3, 4, 0, 4, 3, 1, 5, 3, 4, 0];
const freq = (deg, octave = 0) => 293.66 * 2 ** ((SCALE[deg] + 12 * octave) / 12);

export function createMusic() {
  let ctx = null;
  let master = null;
  let timer = null;
  let next = 0;
  let step = 0;
  let bar = 0;
  let playing = false;

  function voice(type, f, at, dur, gain) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.08, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  function schedule() {
    while (next < ctx.currentTime + 1.2) {
      const [deg, beats] = TUNE[step];
      const dur = beats * BEAT;
      const beatInBar = TUNE.slice(0, step).reduce((acc, [, b]) => acc + b, 0) % 3;
      if (beatInBar === 0) {
        const root = CHORDS[bar % CHORDS.length];
        for (const d of [root, root + 2, root + 4]) voice('sine', freq(d % 7, -1), next, 3 * BEAT, 0.045);
        bar += 1;
      }
      if (deg !== null) voice('triangle', freq(deg), next, dur * 0.95, 0.09);
      next += dur;
      step = (step + 1) % TUNE.length;
      if (step === 0) bar = 0;
    }
  }

  async function start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    await ctx.resume();
    master = ctx.createGain();
    master.gain.value = 0.0001;
    const echo = ctx.createDelay();
    echo.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    master.connect(ctx.destination);
    master.connect(echo).connect(fb).connect(echo);
    fb.connect(ctx.destination);
    master.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 1.2);
    next = ctx.currentTime + 0.1;
    step = 0;
    bar = 0;
    schedule();
    timer = setInterval(schedule, 250);
    playing = true;
    return true;
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (ctx && master) {
      const m = master;
      m.gain.cancelScheduledValues(ctx.currentTime);
      m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), ctx.currentTime);
      m.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      setTimeout(() => m.disconnect(), 700);
    }
    playing = false;
  }

  return {
    get playing() { return playing; },
    async toggle() {
      if (playing) stop();
      else await start();
      return playing;
    },
    stop,
  };
}

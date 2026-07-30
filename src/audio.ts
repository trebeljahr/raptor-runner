/*
 * Raptor Runner — audio subsystem.
 *
 * A single long-lived object that owns:
 *   • The <audio> element for looping background music
 *   • The <audio> element for rain ambience
 *   • A Web Audio context with pre-decoded buffers for jump + thunder
 *     SFX so layered sounds don't fight the music element
 *
 * State coupling: the only thing the audio module reads from the game
 * state singleton is the "Sound of Silence" achievement streak, which
 * gets broken if the player un-mutes mid-run. To keep this module free
 * of a hard dependency on state.ts, main.ts registers an
 * `onUnmuteDuringRun` callback during init().
 */

import {
  COIN_CHAIN_END_GAIN,
  COIN_STREAK_MAX_PITCH,
  COIN_STREAK_PITCH_STEP,
  COIN_STREAK_RESET_MS,
  COINS_MUTED_KEY,
  COINS_VOLUME_KEY,
  EVENTS_MUTED_KEY,
  EVENTS_VOLUME_KEY,
  FOOTSTEPS_MUTED_KEY,
  FOOTSTEPS_VOLUME_KEY,
  JUMP_MUTED_KEY,
  JUMP_VOLUME_KEY,
  MASTER_VOLUME_KEY,
  MUSIC_MUTED_KEY,
  MUSIC_VOLUME_KEY,
  MUTED_KEY,
  RAIN_AUDIO_MAX_VOLUME,
  RAIN_MUTED_KEY,
  RAIN_VOLUME_KEY,
  THUNDER_MUTED_KEY,
  THUNDER_VOLUME_KEY,
  UI_MUTED_KEY,
  UI_VOLUME_KEY,
} from "./constants";
import { loadNumberSetting, saveBoolFlag, saveNumberSetting } from "./persistence";

// webkitAudioContext is still the only Web Audio constructor on old
// Safari — declare it so TS doesn't complain.
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/** Callback invoked when the player un-mutes while a run is in
 *  progress — used to invalidate the Sound of Silence streak. */
export type UnmuteDuringRunCallback = () => void;

// ── Volume channels ────────────────────────────────────────
//
// Every mute channel has a matching 0..1 volume. The Web-Audio-backed
// channels each own a GainNode routed through a shared master gain
// (per-shot sources connect to their channel node, so their hand-tuned
// per-shot gains become the channel's base mix level). Music and rain
// live on <audio> elements which can't route through the graph without
// a MediaElementSource — instead their effective element volume is
// computed as base × channel × master, including inside the fade
// helpers, which keeps the existing pop-free ramp machinery intact.

export const VOLUME_CHANNELS = [
  "music",
  "jump",
  "rain",
  "thunder",
  "footsteps",
  "coins",
  "ui",
  "events",
] as const;
export type VolumeChannel = (typeof VOLUME_CHANNELS)[number];

/** The channels mixed through the Web Audio gain graph. */
type SfxChannel = Exclude<VolumeChannel, "music" | "rain">;
const SFX_CHANNELS: readonly SfxChannel[] = [
  "jump",
  "thunder",
  "footsteps",
  "coins",
  "ui",
  "events",
];

const VOLUME_KEY_BY_CHANNEL: Record<VolumeChannel, string> = {
  music: MUSIC_VOLUME_KEY,
  jump: JUMP_VOLUME_KEY,
  rain: RAIN_VOLUME_KEY,
  thunder: THUNDER_VOLUME_KEY,
  footsteps: FOOTSTEPS_VOLUME_KEY,
  coins: COINS_VOLUME_KEY,
  ui: UI_VOLUME_KEY,
  events: EVENTS_VOLUME_KEY,
};

/** Historical fixed music level — now the base the music channel and
 *  master volumes scale against, so default sliders sound identical
 *  to the pre-volume-control mix. */
const MUSIC_BASE_VOLUME = 0.5;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// ── Pop-free volume ramps ──────────────────────────────────
//
// `<audio>.pause()` and `.play()` stop/start the waveform at whatever
// amplitude it was at — if that's non-zero (almost always, for music
// and rain loops), the abrupt discontinuity reads as a "plop" click.
// The fix is to ramp the element's volume to 0 before pausing, and
// ramp from 0 up to the target after starting. ~40 ms is enough to
// kill the click without being perceptible as a fade.
//
// A WeakMap-tracked token guards against overlapping fades: if the
// player taps the mute button twice quickly, the in-flight fade
// notices it's been superseded on its next rAF tick and stops
// mutating the element, leaving the new fade in control.

const FADE_MS = 40;
const _activeFade = new WeakMap<HTMLAudioElement, object>();

function rampVolume(el: HTMLAudioElement, targetVol: number, ms: number = FADE_MS): Promise<void> {
  return new Promise((resolve) => {
    const token = {};
    _activeFade.set(el, token);
    const fromVol = el.volume;
    if (ms <= 0 || fromVol === targetVol) {
      el.volume = targetVol;
      resolve();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      if (_activeFade.get(el) !== token) {
        // Superseded by a later rampVolume — stop touching the element.
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / ms);
      el.volume = fromVol + (targetVol - fromVol) * t;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        _activeFade.delete(el);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

/** Fade an <audio> element's volume down to 0 over FADE_MS, then pause.
 *  The element retains its playback position, so the next rampUpAndPlay
 *  resumes from where it was. Safe to call on a paused element. */
function rampDownAndPause(el: HTMLAudioElement): void {
  if (el.paused) return;
  rampVolume(el, 0).then(() => {
    // Guard against a rampUp starting during the fade: only pause if
    // we're still at/near zero. If another ramp already took over
    // (towards a non-zero target), the WeakMap supersede logic will
    // have stopped our fade early — el.volume may not be 0.
    if (el.volume < 0.001) el.pause();
  });
}

/** Set volume to 0, start playback, wait a short silent pre-roll so
 *  the MP3 decoder can stabilize, then fade up to target over FADE_MS.
 *
 *  The pre-roll handles the cold-decoder click: the first few
 *  milliseconds of decoded audio after a fresh play() often contain a
 *  spike (wrong sample alignment, codec priming frames, or the
 *  decoder's discontinuity with silence). Without the pre-roll, those
 *  samples play while the volume ramp is still near zero — attenuated
 *  but still audible on sensitive systems.
 *
 *  If play() rejects (browser autoplay policy, no user gesture yet),
 *  we leave the volume at 0 — the next interaction will succeed. */
const DECODER_PREROLL_MS = 60;
function rampUpAndPlay(el: HTMLAudioElement, targetVol: number): void {
  el.volume = 0;
  const p = el.play();
  const startFade = () => {
    setTimeout(() => rampVolume(el, targetVol), DECODER_PREROLL_MS);
  };
  if (p && typeof p.then === "function") {
    p.then(startFade).catch(() => {
      /* leave silent; next interaction will unblock */
    });
  } else {
    startFade();
  }
}

export const audio = {
  // Default to muted so autoplay policies don't complain; the saved
  // preference (if any) is applied later in init() once the music
  // element is in the DOM.
  muted: true as boolean,
  // True once the player has explicitly saved a mute/unmute preference
  // (either by clicking the sound toggle, or by having done so in a
  // previous session). Used to decide whether the Start Game button
  // should auto-unmute (never touched before) or honour the saved
  // value (returning visitor).
  hasSavedPreference: false as boolean,
  music: null as HTMLAudioElement | null,

  // Jump SFX uses the Web Audio API instead of a second <audio>
  // element. Mobile browsers (Chrome Android in particular) only allow
  // one HTMLAudioElement to play at a time — calling jump.play() would
  // pause the music. Web Audio runs through a separate pipeline and
  // can layer any number of sounds on top of the <audio> music
  // without interference.
  musicMuted: false as boolean,
  jumpMuted: false as boolean,
  rainMuted: false as boolean,
  // Finer SFX channels. Each defaults to OFF (not muted) so a fresh
  // install still hears everything; individual toggles let players
  // silence just the channel they find noisy. `jumpMuted` now
  // covers ONLY the player-action cues (jump + hit); the rest moved
  // to these dedicated flags.
  footstepsMuted: false as boolean,
  coinsMuted: false as boolean,
  uiMuted: false as boolean,
  eventsMuted: false as boolean,
  thunderMuted: false as boolean,
  // 0..1 linear volumes, independent of the mute flags above: muting
  // never rewrites a volume, so un-muting restores the exact level
  // the player had dialed in.
  masterVolume: 1 as number,
  channelVolumes: {
    music: 1,
    jump: 1,
    rain: 1,
    thunder: 1,
    footsteps: 1,
    coins: 1,
    ui: 1,
    events: 1,
  } as Record<VolumeChannel, number>,
  _masterGain: null as GainNode | null,
  _channelGainNodes: null as Record<SfxChannel, GainNode> | null,
  _audioCtx: null as AudioContext | null,
  _jumpBuffer: null as AudioBuffer | null,
  _jumpVolume: 0.67,

  // Main-module-provided hook for achievement invalidation. Left null
  // if the caller hasn't wired it up — audio still works.
  _onUnmuteDuringRun: null as UnmuteDuringRunCallback | null,

  /** Register the Sound-of-Silence invalidation callback. */
  setUnmuteDuringRunHandler(cb: UnmuteDuringRunCallback | null) {
    this._onUnmuteDuringRun = cb;
  },

  init() {
    this.music = document.getElementById("game-music") as HTMLAudioElement | null;
    // Load per-channel mute + volume preferences from localStorage
    // before touching element volumes, so the music element starts at
    // the player's effective level rather than flashing full volume.
    this._loadChannelPrefs();
    this.loadVolumePrefs();
    if (this.music) this.music.volume = this._musicTarget();
    // Pre-decode the jump SFX into a Web Audio buffer. The
    // AudioContext is created lazily on the first user gesture
    // (required by autoplay policy), but we fetch + decode the
    // file eagerly so the first jump has zero latency.
    this._preloadJumpBuffer();
    this._preloadThunderBuffer();
    this._preloadHitBuffer();
    this._preloadCoinBuffer();
    this._preloadCoinChainEndBuffer();
    this._preloadShopPurchaseBuffer();
    this._preloadAchievementBuffer();
    this._preloadUfoBuffer();
    this._preloadSantaBuffer();
    this._preloadMeteorBuffer();
    this._preloadCometBuffer();
    this._preloadStepBuffers();
    this.initRain();
  },

  _loadChannelPrefs() {
    try {
      const m = window.localStorage.getItem(MUSIC_MUTED_KEY);
      if (m != null) this.musicMuted = m === "1";
      const j = window.localStorage.getItem(JUMP_MUTED_KEY);
      if (j != null) this.jumpMuted = j === "1";
      const r = window.localStorage.getItem(RAIN_MUTED_KEY);
      if (r != null) this.rainMuted = r === "1";
      const fs = window.localStorage.getItem(FOOTSTEPS_MUTED_KEY);
      if (fs != null) this.footstepsMuted = fs === "1";
      const c = window.localStorage.getItem(COINS_MUTED_KEY);
      if (c != null) this.coinsMuted = c === "1";
      const u = window.localStorage.getItem(UI_MUTED_KEY);
      if (u != null) this.uiMuted = u === "1";
      const e = window.localStorage.getItem(EVENTS_MUTED_KEY);
      if (e != null) this.eventsMuted = e === "1";
      const th = window.localStorage.getItem(THUNDER_MUTED_KEY);
      if (th != null) this.thunderMuted = th === "1";
    } catch (_e) {
      /* ignored */
    }
  },

  /** Hydrate master + per-channel volumes from storage and push them
   *  into the live graph/elements. Called at init() and again after
   *  hydratePersistence() (main.ts) in case the Capacitor mirror
   *  restored keys that had been evicted from localStorage. */
  loadVolumePrefs() {
    this.masterVolume = loadNumberSetting(MASTER_VOLUME_KEY, 1, 0, 1);
    for (const ch of VOLUME_CHANNELS) {
      this.channelVolumes[ch] = loadNumberSetting(VOLUME_KEY_BY_CHANNEL[ch], 1, 0, 1);
    }
    this._applyVolumes();
  },

  /** Effective music element volume: base mix level × channel × master. */
  _musicTarget(): number {
    return MUSIC_BASE_VOLUME * this.channelVolumes.music * this.masterVolume;
  },

  /** Effective rain element volume at full intensity. The game loop
   *  scales this by the live rain intensity every frame, so it is the
   *  single source for "how loud can rain get". */
  rainTargetVolume(): number {
    return RAIN_AUDIO_MAX_VOLUME * this.channelVolumes.rain * this.masterVolume;
  },

  /** Output node for a Web-Audio-mixed channel. Falls back to the raw
   *  destination if the gain graph never got built (Web Audio missing
   *  entirely — in which case none of the callers run anyway). */
  _sfxOut(channel: SfxChannel): AudioNode {
    const node = this._channelGainNodes ? this._channelGainNodes[channel] : null;
    return node ?? (this._audioCtx as AudioContext).destination;
  },

  /** Push the current volume values into the gain graph and the two
   *  <audio> elements. Gain changes use a 30 ms ramp — an instant
   *  gain.value assignment while sources are playing produces an
   *  audible zipper/click. */
  _applyVolumes() {
    const ctx = this._audioCtx;
    if (ctx && this._masterGain) {
      const t = ctx.currentTime;
      const setSmooth = (g: GainNode, v: number) => {
        try {
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(v, t + 0.03);
        } catch {
          g.gain.value = v;
        }
      };
      setSmooth(this._masterGain, this.masterVolume);
      if (this._channelGainNodes) {
        for (const ch of SFX_CHANNELS) {
          setSmooth(this._channelGainNodes[ch], this.channelVolumes[ch]);
        }
      }
    }
    // Music/rain elements: only retarget while they're audibly
    // playing — the paused/muted paths pick up the new target the
    // next time their ramp helpers run.
    if (
      this.music &&
      !this.music.paused &&
      !this.muted &&
      !this.musicMuted &&
      this._musicShouldBePlaying
    ) {
      rampVolume(this.music, this._musicTarget(), 60);
    }
    if (this.rain && this._isRainPlaying && !this.rain.paused) {
      // The game loop rescales this by rain intensity on its next
      // frame; ramping here covers paused-game states (menu open)
      // where that loop isn't running.
      rampVolume(this.rain, this.rainTargetVolume(), 60);
    }
  },

  setMasterVolume(volume: number) {
    const n = Number(volume);
    if (!Number.isFinite(n)) return;
    this.masterVolume = clamp01(n);
    saveNumberSetting(MASTER_VOLUME_KEY, this.masterVolume);
    this._applyVolumes();
  },

  setChannelVolume(channel: VolumeChannel, volume: number) {
    const n = Number(volume);
    if (!Number.isFinite(n)) return;
    if (!(channel in this.channelVolumes)) return;
    this.channelVolumes[channel] = clamp01(n);
    saveNumberSetting(VOLUME_KEY_BY_CHANNEL[channel], this.channelVolumes[channel]);
    this._applyVolumes();
  },

  getChannelVolume(channel: VolumeChannel): number {
    const v = this.channelVolumes[channel];
    return typeof v === "number" ? v : 1;
  },

  /** Fetch jump.mp3, decode it into an AudioBuffer, and stash it
   *  for instant playback via Web Audio. Falls back gracefully if
   *  Web Audio isn't available (old browsers). */
  _preloadJumpBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/jump.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._jumpBuffer = decoded;
      })
      .catch(() => {
        /* no-op — jump SFX simply won't play */
      });
  },

  _ensureAudioCtx() {
    if (this._audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this._audioCtx = new Ctx();
    } catch (_e) {
      /* Web Audio not available */
    }
    if (this._audioCtx && !this._masterGain) {
      // Shared mixer graph: per-shot sources → channel gain → master
      // gain → destination. Built once, alongside the context, so
      // every play method can route through it unconditionally.
      try {
        const ctx = this._audioCtx;
        const master = ctx.createGain();
        master.gain.value = this.masterVolume;
        master.connect(ctx.destination);
        this._masterGain = master;
        const nodes = {} as Record<SfxChannel, GainNode>;
        for (const ch of SFX_CHANNELS) {
          const g = ctx.createGain();
          g.gain.value = this.channelVolumes[ch];
          g.connect(master);
          nodes[ch] = g;
        }
        this._channelGainNodes = nodes;
      } catch (_e) {
        // Leave the graph unbuilt — _sfxOut falls back to destination
        // and everything plays at full channel volume.
        this._masterGain = null;
        this._channelGainNodes = null;
      }
    }
  },

  /** True while the game code has explicitly asked music to be
   *  playing (setMuted(false), setMusicMuted(false), or
   *  resumeMusicOnRunStart). Flipped false by every path that
   *  explicitly pauses music (setMuted(true), setMusicMuted(true),
   *  pauseMusicForGameOver). The watchdog in ensureLiveSession
   *  uses this to distinguish "music is paused because we want it
   *  paused" from "music is paused because play() rejected or the
   *  browser auto-paused us" — only the latter should be retried. */
  _musicShouldBePlaying: false as boolean,

  setMuted(muted: boolean, persist = true) {
    this.muted = !!muted;
    // If the player unmutes during a live run, they broke the "muted
    // the whole way through" streak for Sound of Silence.
    if (!this.muted && this._onUnmuteDuringRun) {
      this._onUnmuteDuringRun();
    }
    if (persist) {
      saveBoolFlag(MUTED_KEY, this.muted);
      this.hasSavedPreference = true;
    }
    if (!this.music) return;
    if (this.muted || this.musicMuted) {
      this._musicShouldBePlaying = false;
      rampDownAndPause(this.music);
      if (this.rain && this._isRainPlaying) rampDownAndPause(this.rain);
    } else {
      this._musicShouldBePlaying = true;
      // Resume the Web Audio context on the first unmute — mobile
      // browsers suspend it until a user gesture unblocks it.
      this._ensureAudioCtx();
      if (this._audioCtx && this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
      rampUpAndPlay(this.music, this._musicTarget());
      // Resume rain if it was playing
      if (this.rain && this._isRainPlaying) {
        rampUpAndPlay(this.rain, this.rainTargetVolume());
      }
    }
  },

  /** Read the saved mute preference (true/false) from localStorage.
   *  Returns `null` if no preference has ever been saved, so callers
   *  can distinguish "never set" (stay muted for autoplay) from an
   *  explicit previous "unmute" choice (which we honour). */
  loadSavedMuted(): boolean | null {
    try {
      const raw = window.localStorage.getItem(MUTED_KEY);
      if (raw == null) return null;
      return raw === "1";
    } catch (_e) {
      return null;
    }
  },

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  },

  /** Hard cut the background music at game-over: 250 ms fade then
   *  pause. Kept short so the death screen doesn't linger over a
   *  tail of the score. No-op when already muted/paused. */
  pauseMusicForGameOver() {
    if (!this.music) return;
    if (this.muted || this.musicMuted) return;
    if (this.music.paused) return;
    this._musicShouldBePlaying = false;
    rampVolume(this.music, 0, 250).then(() => {
      if (this.music && this.music.volume < 0.01) this.music.pause();
    });
  },

  /** Re-start music when a new run begins after a game-over. Mirror
   *  of rampUpAndPlay but with a softer 400ms ramp since the death
   *  fade was also generous. */
  resumeMusicOnRunStart() {
    if (!this.music) return;
    if (this.muted || this.musicMuted) return;
    this._musicShouldBePlaying = true;
    const target = this._musicTarget();
    if (!this.music.paused && this.music.volume >= target - 0.01) return;
    this.music.volume = 0;
    const p = this.music.play();
    const fade = () => rampVolume(this.music!, target, 400);
    if (p && typeof p.then === "function") {
      p.then(fade).catch(() => {});
    } else {
      fade();
    }
  },

  /** Lightweight UI "click" feedback for start-screen button
   *  presses. Reuses the jump buffer at a higher playback rate
   *  and lower gain so it reads as a crisp button tick rather
   *  than a gameplay jump — keeps the 8-bit vibe consistent
   *  across the UI without shipping another sample. */
  playClick() {
    if (this.muted || this.uiMuted) return;
    if (!this._audioCtx || !this._jumpBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const ctx = this._audioCtx;
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this._jumpBuffer;
      src.playbackRate.value = 1.35;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.4, t0 + 0.003);
      src.connect(gain);
      gain.connect(this._sfxOut("ui"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(t0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Plays the jump.mp3 sample through Web Audio.
   *  _silenceSteps runs first so a running-step sample doesn't
   *  bleed under the jump.
   *
   *  SFX_Jump_22 begins at non-zero amplitude (−10 dB on its very
   *  first sample), which reads as a click when it hits the
   *  speaker cold. A 4 ms gain ramp smooths that transient without
   *  costing any audible attack time. */
  playJump() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._jumpBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    this._silenceSteps();
    try {
      const ctx = this._audioCtx;
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this._jumpBuffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(this._jumpVolume, t0 + 0.004);
      src.connect(gain);
      gain.connect(this._sfxOut("jump"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(t0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Unlock the Web Audio context (requires a user gesture). Called
   *  from the Start Game handler so the first jump SFX plays without
   *  delay, regardless of mute state. Also primes rain + music audio
   *  decoders and the Web Audio buffer-source pipeline — see the
   *  individual _primeX / _warmX methods for the why. */
  unlockAudio() {
    this._ensureAudioCtx();
    if (this._audioCtx && this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    this._primeRainAudio();
    this._primeMusicAudio();
    this._warmWebAudioSources();
  },

  _rainPrimed: false as boolean,
  _musicPrimed: false as boolean,
  _webAudioWarmed: false as boolean,

  /**
   * Same decoder-priming trick as _primeRainAudio, applied to the
   * music <audio> element. music2.mp3 is ~4.7MB — large enough that
   * the first play() can stall the start-game click. A silent
   * play+pause inside the user-gesture context warms the decoder.
   *
   * Runs for every session regardless of saved preference — a
   * returning player with music previously unmuted still has a
   * cold decoder on their first interaction, and the cold-start
   * click reaches the speaker before the real play()'s volume ramp
   * can attenuate it. Priming kills the click by decoding the
   * first frames at volume=0 before anything audible happens.
   */
  _primeMusicAudio() {
    if (this._musicPrimed) return;
    if (!this.music) return;
    this._musicPrimed = true;
    const targetVolume = this.music.volume;
    this.music.volume = 0;
    // If the user is (or will stay) muted, tear the silent playback
    // back down once the decoder is warm. If they're unmuted, setMuted
    // is running rampUpAndPlay in parallel on the same element —
    // pausing/rewinding here would silence the real play that's in
    // flight (on mobile the cold-decoder play() resolves after the
    // real one fires, so this restore lands AFTER the ramp has
    // started). Leaving the element playing at volume=0 lets the
    // rampUpAndPlay take over cleanly.
    const restore = () => {
      if (!this.music) return;
      this.music.volume = targetVolume;
      if (this.muted || this.musicMuted) {
        this.music.pause();
        this.music.currentTime = 0;
      }
    };
    try {
      const p = this.music.play();
      if (p && typeof p.then === "function") {
        p.then(restore).catch(() => {
          if (this.music) this.music.volume = targetVolume;
          this._musicPrimed = false;
        });
      } else {
        restore();
      }
    } catch {
      if (this.music) this.music.volume = targetVolume;
      this._musicPrimed = false;
    }
  },

  /**
   * Warm the Web Audio buffer-source pipeline by firing a silent
   * (zero-gain, 10ms) BufferSource → Gain → destination graph for
   * every pre-decoded buffer. Without this, the *first* playJump /
   * playThunder / playHit / playMeteor / etc. stalls briefly while
   * Chromium compiles the audio render graph for that specific
   * buffer's shape (sample rate, channel count, length) — visible
   * as a one-off lag spike on the first rare event.
   *
   * Every decoded buffer the audio module owns gets warmed here.
   * A buffer still being null means the fetch is racing init; the
   * _webAudioWarmed latch stays false so a follow-up unlockAudio
   * call from the Start-button gesture retries against whichever
   * buffers have landed by then. The step buffers are a flat array
   * too, spread into the list.
   *
   * Runs at most ONCE per session (the _webAudioWarmed latch).
   * Total cost: ~8 × 10ms silent buffer schedules, all offloaded to
   * the audio thread — no impact on the render loop beyond the
   * graph-compilation work that would have happened anyway.
   */
  _warmWebAudioSources() {
    if (this._webAudioWarmed) return;
    if (!this._audioCtx) return;
    const buffers = [
      this._jumpBuffer,
      this._thunderBuffer,
      this._hitBuffer,
      this._ufoBuffer,
      this._santaBuffer,
      this._meteorBuffer,
      this._cometBuffer,
      this._coinBuffer,
      this._coinChainEndBuffer,
      this._shopPurchaseBuffer,
      this._achievementBuffer,
      ...this._stepBuffers,
    ];
    // Wait until at least one buffer is ready. If none are, this
    // fires too early — leave _webAudioWarmed false so a later
    // unlockAudio gesture can retry once the fetches land.
    if (buffers.every((b) => b == null)) return;
    // Only mark warmed if we actually warmed something. If MOST
    // buffers are still loading, the later unlockAudio retries will
    // still find _webAudioWarmed true and skip — and the unwarmed
    // ones will pay the compile cost on first play. The tradeoff is
    // accepted: in practice all buffers finish loading long before
    // the Start button is tapped.
    this._webAudioWarmed = true;
    for (const buf of buffers) {
      if (!buf) continue;
      try {
        const src = this._audioCtx.createBufferSource();
        src.buffer = buf;
        const gain = this._audioCtx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        // Warm through the master gain so the graph compilation covers
        // the real playback topology.
        gain.connect(this._masterGain ?? this._audioCtx.destination);
        src.start(0);
        src.stop(this._audioCtx.currentTime + 0.01);
      } catch {
        /* ignore — warming is best-effort */
      }
    }
  },

  /**
   * Force Chromium to decode rain.mp3 *now*, during the start-screen
   * user gesture, instead of when gameplay triggers the first real
   * rain.play() mid-run.
   *
   * Why: rain.mp3 is ~3MB. Even with `preload="auto"` on the <audio>
   * element, Chromium defers the MP3 decode until the first play()
   * call if the element has never been played. That decode happens
   * on the main thread and stalls the game loop for hundreds of
   * milliseconds — long enough for the raptor to die to a cactus
   * that appeared during the hitch.
   *
   * Trick: play at volume 0 and *leave it playing*. A previous
   * version paused immediately after play() resolved, which only
   * decoded the first chunk; when the first real rain window hit
   * (often many seconds later, mid-run), the player still saw a
   * hitch as the decoder worked through the rest of the file.
   * Keeping the element looping silently in the background means
   * every frame of the MP3 gets decoded well before startRain()'s
   * volume ramp makes it audible. startRain() calls rampUpAndPlay()
   * which sets volume=0 (already 0) and ramps to target after
   * DECODER_PREROLL_MS — play() on an already-playing element is a
   * cheap no-op, and the preroll absorbs any residual cold-start
   * cost.
   *
   * Idempotent — only runs once per session. If the play() promise
   * rejects (autoplay policy still blocking, non-gesture context),
   * we reset the flag so the next gesture gets another shot.
   */
  _primeRainAudio() {
    if (this._rainPrimed) return;
    if (!this.rain) return;
    this._rainPrimed = true;
    this.rain.volume = 0;
    try {
      const p = this.rain.play();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          this._rainPrimed = false;
        });
      }
    } catch {
      this._rainPrimed = false;
    }
  },

  setMusicMuted(muted: boolean) {
    this.musicMuted = !!muted;
    saveBoolFlag(MUSIC_MUTED_KEY, this.musicMuted);
    if (!this.music || this.muted) return;
    if (this.musicMuted) {
      this._musicShouldBePlaying = false;
      rampDownAndPause(this.music);
      if (this.rain && this._isRainPlaying) rampDownAndPause(this.rain);
    } else {
      this._musicShouldBePlaying = true;
      rampUpAndPlay(this.music, this._musicTarget());
      if (this.rain && this._isRainPlaying) {
        rampUpAndPlay(this.rain, this.rainTargetVolume());
      }
    }
  },

  setJumpMuted(muted: boolean) {
    this.jumpMuted = !!muted;
    saveBoolFlag(JUMP_MUTED_KEY, this.jumpMuted);
  },

  setRainMuted(muted: boolean) {
    this.rainMuted = !!muted;
    saveBoolFlag(RAIN_MUTED_KEY, this.rainMuted);
    if (this.rainMuted && this._isRainPlaying) {
      this.stopRain();
    }
  },

  // ── Fine-grained SFX channel setters ──────────────────────
  // Each one mirrors setJumpMuted's minimal shape: update the
  // flag, persist it, and trust the per-play gating to drop any
  // sounds currently in flight. Thunder is the only one with
  // side effects — nothing is "running" for footsteps/coins/UI
  // the way music or rain have a loop to pause.

  setFootstepsMuted(muted: boolean) {
    this.footstepsMuted = !!muted;
    saveBoolFlag(FOOTSTEPS_MUTED_KEY, this.footstepsMuted);
    if (this.footstepsMuted) this._silenceSteps();
  },

  setCoinsMuted(muted: boolean) {
    this.coinsMuted = !!muted;
    saveBoolFlag(COINS_MUTED_KEY, this.coinsMuted);
  },

  setUiMuted(muted: boolean) {
    this.uiMuted = !!muted;
    saveBoolFlag(UI_MUTED_KEY, this.uiMuted);
  },

  setEventsMuted(muted: boolean) {
    this.eventsMuted = !!muted;
    saveBoolFlag(EVENTS_MUTED_KEY, this.eventsMuted);
  },

  setThunderMuted(muted: boolean) {
    this.thunderMuted = !!muted;
    saveBoolFlag(THUNDER_MUTED_KEY, this.thunderMuted);
  },

  // ── Rain ambience (file-based <audio> element) ──────────────
  rain: null as HTMLAudioElement | null,
  _isRainPlaying: false,

  initRain() {
    this.rain = document.getElementById("rain-audio") as HTMLAudioElement | null;
    if (this.rain) {
      this.rain.volume = this.rainTargetVolume();
      this.rain.loop = true;
    }
  },

  startRain() {
    if (this._isRainPlaying) return;
    if (this.muted || this.musicMuted || this.rainMuted) return;
    if (!this.rain) return;
    rampUpAndPlay(this.rain, this.rainTargetVolume());
    this._isRainPlaying = true;
  },

  stopRain() {
    if (!this._isRainPlaying) return;
    if (this.rain) rampDownAndPause(this.rain);
    this._isRainPlaying = false;
  },

  _thunderBuffer: null as AudioBuffer | null,

  _preloadThunderBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/thunder.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._thunderBuffer = decoded;
      })
      .catch(() => {
        /* thunder SFX simply won't play */
      });
  },

  playThunder() {
    if (this.muted || this.thunderMuted) return;
    if (!this._audioCtx || !this._thunderBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._thunderBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.5;
      src.connect(gain);
      gain.connect(this._sfxOut("thunder"));
      src.start(0);
    } catch (_e) {
      /* non-critical */
    }
  },

  // ── Footstep SFX (freesound_community grass-loop excerpts) ──
  // Four ~300ms samples trimmed from a public-domain "running in
  // grass" loop. playStep rotates through them with a small pitch
  // + volume jitter so the cadence doesn't loop perceptibly.
  _stepBuffers: [] as AudioBuffer[],
  _stepLastIdx: -1,
  // In-flight step sources tracked so playJump can fade them out —
  // prevents the "running" sample bleeding over the jump cue.
  _activeStepGains: new Set<GainNode>(),

  _preloadStepBuffers() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    const paths = [
      "assets/step-left.mp3",
      "assets/step-right.mp3",
      "assets/step-a.mp3",
      "assets/step-b.mp3",
    ];
    this._stepBuffers = new Array(paths.length).fill(null);
    paths.forEach((path, i) => {
      fetch(path)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          this._ensureAudioCtx();
          if (!this._audioCtx) return;
          return this._audioCtx.decodeAudioData(buf);
        })
        .then((decoded) => {
          if (decoded) this._stepBuffers[i] = decoded;
        })
        .catch(() => {
          /* individual step sample just won't play */
        });
    });
  },

  /** Footfall: plays one of the grass-step samples with a small
   *  pitch + volume jitter so repeated cycles don't sound tiled.
   *  The `foot` hint is kept for call-site readability but the
   *  sample choice is round-robin across all loaded buffers,
   *  which is what actually breaks the monotony. */
  playStep(_foot: "left" | "right" = "left") {
    if (this.muted || this.footstepsMuted) return;
    if (!this._audioCtx || this._audioCtx.state !== "running") return;
    // Pick a buffer other than the last one played — avoids the
    // same waveform back-to-back. Falls back to random on very
    // first call before any have loaded.
    const loaded = this._stepBuffers.map((b, i) => ({ b, i })).filter((x) => x.b);
    if (loaded.length === 0) return;
    let pick = loaded[Math.floor(Math.random() * loaded.length)];
    if (loaded.length > 1) {
      while (pick.i === this._stepLastIdx) {
        pick = loaded[Math.floor(Math.random() * loaded.length)];
      }
    }
    this._stepLastIdx = pick.i;
    try {
      const ctx = this._audioCtx;
      const src = ctx.createBufferSource();
      src.buffer = pick.b;
      // ±4 % playback rate → ~70-cent pitch wobble, imperceptible
      // individually but effective at hiding the tile.
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.08;
      const gain = ctx.createGain();
      // ±12 % gain jitter around a lower baseline — the previous
      // 1.8 was too loud against the music.
      gain.gain.value = 0.75 * (0.88 + Math.random() * 0.24);
      src.connect(gain);
      gain.connect(this._sfxOut("footsteps"));
      this._activeStepGains.add(gain);
      src.onended = () => {
        this._activeStepGains.delete(gain);
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Quickly fade out every in-flight step source. Called from
   *  playJump so the jump cue isn't sharing the mix with a
   *  leftover running-grass sample. */
  _silenceSteps() {
    if (!this._audioCtx) return;
    const now = this._audioCtx.currentTime;
    for (const g of this._activeStepGains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.02);
      } catch {}
    }
  },

  // ── Game-over / cactus-impact SFX (freesound_community) ───
  // Sample credit: freesound_community on Pixabay — see imprint.html
  // and the credits overlay in index.html for the full attribution.
  _hitBuffer: null as AudioBuffer | null,

  _preloadHitBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/hit.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._hitBuffer = decoded;
      })
      .catch(() => {
        /* hit SFX simply won't play */
      });
  },

  /** Cactus impact / game-over cue: plays the "error-notification
   *  banjo" sample (freesound_community, Pixabay 45430). Routed
   *  through jumpMuted so the SFX channel toggle covers it.
   *
   *  55 ms buffer offset skips the sample's silent head so the
   *  first audible sample is the banjo strike on the collision
   *  frame. */
  playHit() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._hitBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._hitBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.6;
      src.connect(gain);
      gain.connect(this._sfxOut("jump"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(0, 0.055);
    } catch {
      /* SFX is non-critical */
    }
  },

  // ── Coin pickup SFX (liecio "diamond found") ──────────────
  // Sample credit: Liecio on Pixabay (track 190255) — see the
  // credits overlay in index.html / imprint.html for the full
  // attribution block.
  _coinBuffer: null as AudioBuffer | null,
  /** Length of the current pickup chain. Each pickup within
   *  COIN_STREAK_RESET_MS of the previous one bumps this; after
   *  the reset window passes, the next pickup starts a fresh
   *  streak at 0. Drives the Mario-style pitch-rise on playback. */
  _coinStreak: 0 as number,
  /** performance.now() of the most recent coin pickup — used to
   *  decide whether to continue or reset the streak. */
  _coinStreakLastMs: 0 as number,

  _preloadCoinBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/coin-collect.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._coinBuffer = decoded;
      })
      .catch(() => {
        /* coin SFX simply won't play */
      });
  },

  /** Forget any in-progress coin streak. Called from resetGame so
   *  a new run doesn't inherit the pitch from the previous one
   *  (rare, since the reset-ms would usually have elapsed, but
   *  free to handle deterministically). */
  resetCoinStreak() {
    this._coinStreak = 0;
    this._coinStreakLastMs = 0;
  },

  // ── Coin chain-end chord (liecio "diamond found") ──────────
  // Plays on top of the last-coin pickup as a resolution cue —
  // "ding ding ding … diiing ✨". Sample credit: Liecio on Pixabay
  // (track 190255); see credits overlay / imprint.html.
  _coinChainEndBuffer: null as AudioBuffer | null,

  _preloadCoinChainEndBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/coin-chain-end.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._coinChainEndBuffer = decoded;
      })
      .catch(() => {
        /* chain-end cue simply won't play */
      });
  },

  /** Chain-end chord, layered on top of the last-coin pickup.
   *  Plays at fixed 1.0× pitch — it's the "resolution" after the
   *  rising chain, not another step in the climb. Routed through
   *  jumpMuted so the SFX mute toggle still covers it. */
  playCoinChainEnd() {
    if (this.muted || this.coinsMuted) return;
    if (!this._audioCtx || !this._coinChainEndBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._coinChainEndBuffer;
      const gain = this._audioCtx.createGain();
      const now = this._audioCtx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(COIN_CHAIN_END_GAIN, now + 0.005);
      src.connect(gain);
      gain.connect(this._sfxOut("coins"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Active tally sources — scheduled setTimeout ids + the gain
   *  nodes of currently-playing ticks. stopCoinFill() walks these
   *  to cancel future ticks and fade live ones to zero instead of
   *  letting samples finish naturally (or worse, clicking off
   *  when the game-over card unmounts mid-sample). */
  _coinFillTimers: [] as number[],
  _coinFillGains: [] as GainNode[],
  _coinFillChordTimer: 0 as number,

  /** Fire the "coins pouring into the wallet" audio sequence used
   *  by the game-over card while the balance number tweens up.
   *  Plays up to 10 rising-pitch ticks evenly spaced over
   *  durationMs, then a resolution chord at the end. Tracks
   *  timers + gains on `this` so stopCoinFill() can interrupt the
   *  whole sequence on restart without leaving half-played samples
   *  bleeding into the next run. */
  playCoinFillAnim(count: number, durationMs = 1200) {
    if (count <= 0) return;
    const ticks = Math.min(count, 10);
    const intervalMs = durationMs / ticks;
    for (let i = 0; i < ticks; i++) {
      const id = window.setTimeout(() => this._playCoinFillTick(i, ticks), i * intervalMs);
      this._coinFillTimers.push(id);
    }
    this._coinFillChordTimer = window.setTimeout(() => this.playCoinChainEnd(), durationMs);
  },

  /** Per-tick chime. Reuses the liecio diamond-found sample (same
   *  one the chain-end chord plays at base pitch) so the tally has
   *  its own "rising chain → resolution" identity that stays clear
   *  of the in-run pickup cue. `step` / `totalSteps` shape the
   *  pitch climb so the last tick lands just below the chord, and
   *  the per-tick gain is pulled down hard so a full 10-tick burst
   *  doesn't dog-pile into distortion.
   *
   *  Registers its gain node in _coinFillGains so stopCoinFill can
   *  fade it out. 5ms linear attack from 0 → target avoids the
   *  click some browsers emit when a BufferSource abruptly snaps
   *  from silence to a non-zero sample amplitude. */
  _playCoinFillTick(step: number, totalSteps: number) {
    if (this.muted || this.coinsMuted) return;
    if (!this._audioCtx || !this._coinChainEndBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._coinChainEndBuffer;
      // Climb from 1.0× to ~1.6× across the full burst, regardless of
      // how many ticks there are (3-coin run, 10-coin run, …).
      const denom = Math.max(1, totalSteps - 1);
      src.playbackRate.value = 1 + (step / denom) * 0.6;
      const gain = this._audioCtx.createGain();
      const now = this._audioCtx.currentTime;
      const target = 0.12;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(target, now + 0.005);
      src.connect(gain);
      gain.connect(this._sfxOut("coins"));
      this._coinFillGains.push(gain);
      const cleanup = () => {
        const i = this._coinFillGains.indexOf(gain);
        if (i >= 0) this._coinFillGains.splice(i, 1);
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.onended = cleanup;
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Cancel pending tally ticks and fade any live ones to zero.
   *  Called from resetGame so a new run starts in silence instead
   *  of layering the previous run's tally under the next run's
   *  gameplay audio. 80ms linear ramp — long enough to dodge the
   *  abrupt-cut click, short enough that a quick restart feels
   *  immediate. */
  stopCoinFill() {
    for (const id of this._coinFillTimers) clearTimeout(id);
    this._coinFillTimers.length = 0;
    if (this._coinFillChordTimer) {
      clearTimeout(this._coinFillChordTimer);
      this._coinFillChordTimer = 0;
    }
    if (!this._audioCtx) {
      this._coinFillGains.length = 0;
      return;
    }
    const now = this._audioCtx.currentTime;
    for (const gain of this._coinFillGains) {
      try {
        const current = gain.gain.value;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(current, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.08);
      } catch {
        /* gain graph already torn down — nothing to cancel */
      }
    }
    // Don't clear _coinFillGains here — src.onended will splice
    // each entry out as its ramp completes and the source stops.
  },

  // ── Shop purchase cue (rhodesmas "Level Up 01") ─────────────
  // Short "leveling up" chime played when a cosmetic is bought in
  // the shop. Sample credit: rhodesmas on Freesound.org
  // (sound 320655) — see credits overlay / imprint.html.
  _shopPurchaseBuffer: null as AudioBuffer | null,

  _preloadShopPurchaseBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/shop-purchase.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._shopPurchaseBuffer = decoded;
      })
      .catch(() => {
        /* purchase cue simply won't play */
      });
  },

  /** Shop-purchase chime. Celebratory and louder than the pickup
   *  cue — a purchase is a deliberate, infrequent action so the
   *  feedback can be bigger. Routed through jumpMuted so the SFX
   *  mute toggle still covers it, but NOT gated on muted-for-the-
   *  run achievement checks since the shop is outside active play. */
  playShopPurchase() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._shopPurchaseBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._shopPurchaseBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.55;
      src.connect(gain);
      gain.connect(this._sfxOut("jump"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  // ── Achievement unlock cue (freesound_community glockenspiel) ─
  // Short glockenspiel "treasure video game" stinger — fires once
  // when an achievement crosses from locked to unlocked. Sample
  // credit: freesound_community on Pixabay (sound 6346) — see the
  // credits overlay and imprint.html.
  _achievementBuffer: null as AudioBuffer | null,

  _preloadAchievementBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/achievement.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._achievementBuffer = decoded;
      })
      .catch(() => {
        /* achievement cue simply won't play */
      });
  },

  /** Achievement-unlock chime. Paired with the toast the UI shows
   *  on unlock, so we gate it on uiMuted — a player who silenced
   *  the UI clicks channel probably also wants the toast fanfare
   *  muted. Master mute still takes precedence. Never throttled /
   *  coalesced: only one unlock fires at a time and they're rare
   *  enough that stacking isn't a concern. */
  playAchievement() {
    if (this.muted || this.uiMuted) return;
    if (!this._audioCtx || !this._achievementBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._achievementBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.6;
      src.connect(gain);
      gain.connect(this._sfxOut("ui"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Coin pickup cue. Routed through the coins SFX channel so the
   *  per-channel mute toggle covers it. Lower gain than playHit
   *  because coins can fire several times per breather — a 0.6
   *  level would pile up into a loud chord when the raptor runs a
   *  full row.
   *
   *  The rising "1-up" chain (each pickup within COIN_STREAK_RESET_MS
   *  bumps playbackRate by COIN_STREAK_PITCH_STEP) is gated on
   *  `onFlowerField`: it's the flower-patch ribbon's musical cue.
   *  Any coin grabbed off the patch — one-off pickups, debug spawns,
   *  coins trailing out of a compressed field, cactus-top coins —
   *  plays at the base pitch and leaves the streak reset so
   *  re-entering the field starts the climb fresh. */
  playCoinCollect(onFlowerField = true) {
    if (this.muted || this.coinsMuted) return;
    if (!this._audioCtx || !this._coinBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    const now = performance.now();
    let pitch: number;
    if (onFlowerField) {
      if (now - this._coinStreakLastMs > COIN_STREAK_RESET_MS) {
        this._coinStreak = 0;
      }
      pitch = Math.min(COIN_STREAK_MAX_PITCH, 1 + this._coinStreak * COIN_STREAK_PITCH_STEP);
      this._coinStreak++;
      this._coinStreakLastMs = now;
    } else {
      // Off-field pickup: default pitch, and reset the streak so the
      // next field entry starts from "ding" again rather than
      // resuming mid-chain.
      pitch = 1;
      this._coinStreak = 0;
      this._coinStreakLastMs = 0;
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._coinBuffer;
      src.playbackRate.value = pitch;
      const gain = this._audioCtx.createGain();
      const startAt = this._audioCtx.currentTime;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.35, startAt + 0.005);
      src.connect(gain);
      gain.connect(this._sfxOut("coins"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  // ── UFO rare-event SFX (SoundReality ufo) ──────────────────
  _ufoBuffer: null as AudioBuffer | null,
  _ufoSource: null as AudioBufferSourceNode | null,
  _ufoGain: null as GainNode | null,

  _preloadUfoBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/ufo.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._ufoBuffer = decoded;
      })
      .catch(() => {
        /* UFO SFX simply won't play */
      });
  },

  /** Start the UFO hover/beam sample. Stored as a handle so stopUfo
   *  can cut it short when the event ends (or the player dies). */
  playUfo() {
    if (this.muted || this.eventsMuted) return;
    if (!this._audioCtx || !this._ufoBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    // Already playing? Let the existing source run.
    if (this._ufoSource) return;
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._ufoBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.28;
      src.connect(gain);
      gain.connect(this._sfxOut("events"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
        if (this._ufoSource === src) {
          this._ufoSource = null;
          this._ufoGain = null;
        }
      };
      this._ufoSource = src;
      this._ufoGain = gain;
      // Skip ~80ms of silent lead-in at the start of the sample.
      src.start(0, 0.08);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Fade out and stop the UFO sample. Called when the UFO event
   *  ends or the player dies mid-abduction. */
  stopUfo() {
    if (!this._audioCtx || !this._ufoSource || !this._ufoGain) return;
    const ctx = this._audioCtx;
    const src = this._ufoSource;
    const gain = this._ufoGain;
    const t = ctx.currentTime;
    try {
      // Brief ramp to zero, then stop — avoids a click on abrupt cut.
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.08);
      src.stop(t + 0.09);
    } catch {
      try {
        src.stop(0);
      } catch {}
    }
    this._ufoSource = null;
    this._ufoGain = null;
  },

  // ── Santa rare-event SFX (DRAGON-STUDIO jingle bells) ─────
  _santaBuffer: null as AudioBuffer | null,

  _preloadSantaBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/santa.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._santaBuffer = decoded;
      })
      .catch(() => {
        /* santa SFX simply won't play */
      });
  },

  // Santa plays as a loop that fades in when santa appears and
  // fades out when santa leaves the screen. Kept as handles so
  // stopSanta can time the fade-out from the caller.
  _santaSource: null as AudioBufferSourceNode | null,
  _santaGain: null as GainNode | null,
  _santaTargetGain: 0.4,

  /** Start the looping sleigh-bell sample with a 0.3s fade-in.
   *  stopSanta is responsible for the fade-out when the santa
   *  event reaches the far side of the screen. */
  playSanta() {
    if (this.muted || this.eventsMuted) return;
    if (!this._audioCtx || !this._santaBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    if (this._santaSource) return;
    try {
      const ctx = this._audioCtx;
      const src = ctx.createBufferSource();
      src.buffer = this._santaBuffer;
      src.loop = true;
      const gain = ctx.createGain();
      const t0 = ctx.currentTime;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(this._santaTargetGain, t0 + 0.3);
      src.connect(gain);
      gain.connect(this._sfxOut("events"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
        if (this._santaSource === src) {
          this._santaSource = null;
          this._santaGain = null;
        }
      };
      this._santaSource = src;
      this._santaGain = gain;
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Fade out and stop the looping sleigh bells. */
  stopSanta() {
    if (!this._audioCtx || !this._santaSource || !this._santaGain) return;
    const ctx = this._audioCtx;
    const src = this._santaSource;
    const gain = this._santaGain;
    const t = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.35);
      src.stop(t + 0.36);
    } catch {
      try {
        src.stop(0);
      } catch {}
    }
    this._santaSource = null;
    this._santaGain = null;
  },

  // ── Meteor-impact SFX (DRAGON-STUDIO nuclear explosion) ───
  _meteorBuffer: null as AudioBuffer | null,

  _preloadMeteorBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/meteor.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._meteorBuffer = decoded;
      })
      .catch(() => {
        /* meteor SFX simply won't play */
      });
  },

  /** Play the explosion sample at meteor impact. Sample is ~7.5s,
   *  longer than the event lifetime (~5s) — the tail rumble lingers
   *  after the visual fades, which reads as aftermath weight.
   *
   *  Scheduled ~400ms after the call to simulate sound-over-distance
   *  lag: the flash hits the retina instantly but the boom takes
   *  time to travel across the desert. */
  playMeteor() {
    if (this.muted || this.eventsMuted) return;
    if (!this._audioCtx || !this._meteorBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const ctx = this._audioCtx;
      const src = ctx.createBufferSource();
      src.buffer = this._meteorBuffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      src.connect(gain);
      gain.connect(this._sfxOut("events"));
      src.onended = () => {
        try {
          src.disconnect();
          gain.disconnect();
        } catch {}
      };
      // Schedule against the Web Audio clock so the gap tracks the
      // audio tick exactly (no setTimeout drift). First arg is
      // absolute start time, second is buffer offset (skip silent
      // lead-in).
      src.start(ctx.currentTime + 0.2, 0.05);
    } catch {
      /* SFX is non-critical */
    }
  },

  // ── Comet rare-event SFX (Alice_soundz glitter) ────────────
  _cometBuffer: null as AudioBuffer | null,

  _preloadCometBuffer() {
    if (typeof AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined")
      return;
    fetch("assets/comet.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._cometBuffer = decoded;
      })
      .catch(() => {
        /* comet SFX simply won't play */
      });
  },

  // Comet uses the same looping + fade pattern as santa/ufo, but
  // with an ~800 ms delay between spawn and audible onset so the
  // shimmer picks up after the comet has actually entered the
  // visible area instead of while it's still offscreen right.
  _cometSource: null as AudioBufferSourceNode | null,
  _cometGain: null as GainNode | null,
  _cometStartTimer: null as number | null,
  _cometTargetGain: 0.4,

  /** Schedule a delayed, fading-in looped glitter cue for a comet.
   *  Cancellable by stopComet whether or not the delayed start
   *  has fired yet. */
  playComet() {
    if (this.muted || this.eventsMuted) return;
    if (!this._audioCtx || !this._cometBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    if (this._cometSource || this._cometStartTimer !== null) return;
    const START_DELAY_MS = 800;
    this._cometStartTimer = window.setTimeout(() => {
      this._cometStartTimer = null;
      if (!this._audioCtx || !this._cometBuffer) return;
      try {
        const ctx = this._audioCtx;
        const src = ctx.createBufferSource();
        src.buffer = this._cometBuffer;
        // Loop just the active-sparkle body. The sample decays to
        // near-silence between 2.53 s and 3.95 s and previously
        // read as a dip-then-restart when wrapped back to 0.54.
        src.loop = true;
        src.loopStart = 0.6;
        src.loopEnd = 2.53;
        const gain = ctx.createGain();
        const t0 = ctx.currentTime;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(this._cometTargetGain, t0 + 0.4);
        src.connect(gain);
        gain.connect(this._sfxOut("events"));
        src.onended = () => {
          try {
            src.disconnect();
            gain.disconnect();
          } catch {}
          if (this._cometSource === src) {
            this._cometSource = null;
            this._cometGain = null;
          }
        };
        this._cometSource = src;
        this._cometGain = gain;
        src.start(0, 0.6);
      } catch {
        /* SFX is non-critical */
      }
    }, START_DELAY_MS);
  },

  /** Fade out the comet loop and stop it. Also cancels a pending
   *  delayed start if the event ends before the sound began. */
  stopComet() {
    if (this._cometStartTimer !== null) {
      window.clearTimeout(this._cometStartTimer);
      this._cometStartTimer = null;
      return;
    }
    if (!this._audioCtx || !this._cometSource || !this._cometGain) return;
    const ctx = this._audioCtx;
    const src = this._cometSource;
    const gain = this._cometGain;
    const t = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.45);
      src.stop(t + 0.46);
    } catch {
      try {
        src.stop(0);
      } catch {}
    }
    this._cometSource = null;
    this._cometGain = null;
  },

  // ── UI click feedback (synthesized, no asset) ─────────────
  //
  // Plays a short "tap" whenever the player activates a menu
  // button. Synthesized via Web Audio so it requires no MP3
  // download and can be retuned in one place.
  //
  // Construction: two overlaid sines — a short mid-band body
  // (~900 Hz) gives the click its perceived pitch, and a quick
  // high-band tick (~2 kHz, 10 ms) provides the attack
  // brightness. Both envelope through an exponential decay so
  // the whole sound is < 60 ms and never overlaps with itself
  // even on rapid taps. Routed at a modest gain (0.08 × 2)
  // so it sits under music and rain without dominating.
  //
  // Muted / jump-muted respected (jumpMuted covers the "SFX"
  // channel conceptually, same as playHit / playStep). The
  // audio context is resumed if suspended because UI clicks
  // are a guaranteed user gesture.
  playMenuTap() {
    if (this.muted || this.uiMuted) return;
    this._ensureAudioCtx();
    if (!this._audioCtx) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const ctx = this._audioCtx;
      const t0 = ctx.currentTime;
      // Body — mid sine with a quick exponential decay.
      const body = ctx.createOscillator();
      body.type = "sine";
      body.frequency.setValueAtTime(900, t0);
      body.frequency.exponentialRampToValueAtTime(620, t0 + 0.05);
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0, t0);
      bodyGain.gain.linearRampToValueAtTime(0.08, t0 + 0.004);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      body.connect(bodyGain);
      bodyGain.connect(this._sfxOut("ui"));
      body.onended = () => {
        try {
          body.disconnect();
          bodyGain.disconnect();
        } catch {}
      };
      body.start(t0);
      body.stop(t0 + 0.06);
      // Tick — short bright top for the initial attack.
      const tick = ctx.createOscillator();
      tick.type = "triangle";
      tick.frequency.setValueAtTime(2100, t0);
      const tickGain = ctx.createGain();
      tickGain.gain.setValueAtTime(0, t0);
      tickGain.gain.linearRampToValueAtTime(0.05, t0 + 0.002);
      tickGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.018);
      tick.connect(tickGain);
      tickGain.connect(this._sfxOut("ui"));
      tick.onended = () => {
        try {
          tick.disconnect();
          tickGain.disconnect();
        } catch {}
      };
      tick.start(t0);
      tick.stop(t0 + 0.02);
    } catch {
      /* SFX is non-critical */
    }
  },

  // ── Menu / pause coordination ──────────────────────────────
  // Intent: menus / pauses silence *only* the event-driven gameplay
  // SFX — the UFO hover loop, Santa bells loop, meteor / comet /
  // thunder tails, any in-flight step / jump / hit samples. The
  // ambient layer (music + rain) stays playing so the menu screen
  // doesn't feel like the game yanked its whole soundtrack out.
  //
  // When the pause menu opens (or Game.pause() fires for any other
  // reason — alt-tab, invisibility, external trigger), every sound
  // that belongs to gameplay should fall silent while the music keeps
  // playing. The user's framing: "santa, ufo and other non-music
  // sounds should stop".
  //
  // Strategy:
  //   • Web Audio context: a single suspend() call pauses every
  //     in-flight node — the UFO hover loop, the Santa bells loop,
  //     any meteor tail still rumbling, the comet glitter tail, any
  //     running-step or landing sample mid-fade. resume() picks them
  //     all back up at the exact sample they paused on.
  //   • Rain <audio>: Web Audio doesn't own it. We fade + pause the
  //     element directly on pause, and resume it on un-pause only
  //     if rain is still logically active (_isRainPlaying remains
  //     the source of truth) and no mute toggle has been flipped
  //     against it in the meantime.
  //   • Music: intentionally left alone — menu music is a UX staple.
  //
  // These methods are idempotent: calling pauseGameplaySounds twice
  // is harmless, and calling resume without a prior pause is a no-op.

  /** Suspend gameplay-layer audio (called from Game.pause).
   *  Music + rain both continue playing — they're the ambient layer,
   *  not the event SFX that a menu should silence. */
  pauseGameplaySounds() {
    if (this._audioCtx && this._audioCtx.state === "running") {
      this._audioCtx.suspend().catch(() => {});
    }
  },

  /** Resume gameplay-layer audio (called from Game.resume). */
  resumeGameplaySounds() {
    this.ensureLiveSession();
  },

  /** Nudge the audio layer back into a live state. Covers the
   *  two ways audio can orphan itself without a matching mute
   *  toggle to recover:
   *
   *    (a) Web Audio context got suspended — either by our own
   *        pauseGameplaySounds that didn't get a matching resume
   *        (e.g. game-over happened mid-menu-open, or restart
   *        skipped the normal resume path), or by the browser's
   *        own inactivity / tab-hidden throttle.
   *    (b) Rain <audio> got paused while _isRainPlaying is still
   *        true — same orphan-state root cause. The game-loop's
   *        rain-management sees "already playing" and never
   *        rehydrates the element, so rain stays silent until
   *        the player toggles the sound off and back on.
   *
   *  Safe to call frequently — no-ops when audio is already
   *  live. Hooked into resetGame(), every pointerdown / keydown
   *  / gamepad button-press so any user gesture also wakes
   *  audio back up without the toggle workaround.
   */
  ensureLiveSession() {
    if (this._audioCtx && this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    if (
      this._isRainPlaying &&
      this.rain?.paused &&
      !this.muted &&
      !this.musicMuted &&
      !this.rainMuted
    ) {
      rampUpAndPlay(this.rain, this.rainTargetVolume());
    }
    // ── Music watchdog ──────────────────────────────────────
    // If the game code has asked music to be playing but the
    // element is paused (play() rejected due to autoplay policy,
    // a browser tab-hidden auto-pause, an OS audio-focus steal,
    // …) or stuck at volume 0 (a rampVolume that got superseded
    // mid-ramp by our own fade logic), retry the play + ramp.
    // The `_musicShouldBePlaying` flag is the intent tracker —
    // only paths that explicitly pause music clear it, so this
    // watchdog never fights pauseMusicForGameOver or the
    // rampDownAndPause that setMuted(true) / setMusicMuted(true)
    // triggers.
    if (this._musicShouldBePlaying && this.music && !this.muted && !this.musicMuted) {
      const target = this._musicTarget();
      if (this.music.paused) {
        this.music.volume = 0;
        const p = this.music.play();
        const fade = () => rampVolume(this.music!, target, 400);
        if (p && typeof p.then === "function") {
          p.then(fade).catch(() => {});
        } else {
          fade();
        }
      } else if (this.music.volume < target - 0.05) {
        // Playing but noticeably under target — a prior rampVolume
        // got superseded before finishing. Nudge it back up.
        rampVolume(this.music, target, 300);
      }
    }
  },
};

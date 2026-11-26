import {
  parseNotificationSoundPreference,
  type NotificationToneKind,
} from '../shared/notificationSound';

const STORAGE_KEY = 'pulseroom_notification_sound';

type AudioContextCtor = typeof AudioContext;

let sharedCtx: AudioContext | null = null;
let unlockInstalled = false;

function getAudioContextConstructor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext || w.webkitAudioContext || null;
}

function getOrCreateContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

/**
 * Installs one-time lightweight gesture listeners so the Web Audio context
 * unlocks silently on the user's first interaction without ever throwing.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined' || unlockInstalled) return () => {};
  unlockInstalled = true;

  const unlock = () => {
    try {
      const ctx = getOrCreateContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore browser autoplay restrictions silently
    }
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };

  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });

  return () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    unlockInstalled = false;
  };
}

function scheduleSoftNote(
  ctx: AudioContext,
  dest: AudioNode,
  startTime: number,
  freqHz: number,
  peakGain: number,
  durationSec: number
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freqHz, startTime);
  // Subtle micro-pitch settle gives a warm droplet/marimba feel instead of a harsh beep
  osc.frequency.exponentialRampToValueAtTime(freqHz * 1.008, startTime + durationSec * 0.45);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.009);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

  osc.connect(gain);
  gain.connect(dest);

  osc.start(startTime);
  osc.stop(startTime + durationSec + 0.015);
}

/**
 * Plays a barely-there, warm synthetic notification cue using Web Audio API.
 * Designed to stay ultra-subtle even while listening to music.
 */
export function playSubtleNotificationSound(kind: NotificationToneKind = 'chat'): boolean {
  try {
    const ctx = getOrCreateContext();
    if (!ctx) return false;

    const trigger = () => {
      try {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1750, ctx.currentTime);
        filter.Q.setValueAtTime(0.7, ctx.currentTime);
        filter.connect(ctx.destination);

        const t0 = ctx.currentTime + 0.005;

        if (kind === 'reply') {
          // Gentle ascending soft fifth (F#5 -> C#6), ultra-quiet and brief (~175ms)
          scheduleSoftNote(ctx, filter, t0, 740, 0.045, 0.095);
          scheduleSoftNote(ctx, filter, t0 + 0.062, 1046.5, 0.04, 0.115);
        } else if (kind === 'room') {
          // Soft low-mid tap (E5), minute ~105ms presence cue
          scheduleSoftNote(ctx, filter, t0, 659.25, 0.036, 0.105);
        } else {
          // Standard chat message: single crisp, feather-light wood/glass droplet (G5, ~115ms)
          scheduleSoftNote(ctx, filter, t0, 783.99, 0.042, 0.115);
        }
      } catch {
        // Ignore audio scheduling errors
      }
    };

    if (ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(trigger)
        .catch(() => {});
      return true;
    }

    trigger();
    return true;
  } catch {
    return false;
  }
}

export function readNotificationSoundPreference(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    return parseNotificationSoundPreference(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}

export function writeNotificationSoundPreference(enabled: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export type NotificationToneKind = 'chat' | 'reply' | 'room';

export const DEFAULT_SOUND_COOLDOWN_MS = 1200;

export interface NotificationSoundGateInput {
  enabled: boolean;
  isOwnEvent: boolean;
  nowMs: number;
  lastPlayedAtMs: number | null;
  cooldownMs?: number;
}

/**
 * Pure gating decision for whether a subtle notification cue should play.
 * Suppresses self-originated actions, muted preference, and rapid burst spam.
 */
export function shouldPlayNotificationSound(input: NotificationSoundGateInput): boolean {
  if (!input.enabled || input.isOwnEvent) return false;
  const cooldown = Math.max(0, input.cooldownMs ?? DEFAULT_SOUND_COOLDOWN_MS);
  if (input.lastPlayedAtMs !== null && input.nowMs - input.lastPlayedAtMs < cooldown) {
    return false;
  }
  return true;
}

/**
 * Selects a distinct, still-minute chime variant when someone replies directly to you.
 */
export function resolveChatNotificationTone(input: {
  replyToUsername?: string | null;
  currentUsername?: string | null;
}): NotificationToneKind {
  if (
    input.replyToUsername &&
    input.currentUsername &&
    input.replyToUsername.trim().toLowerCase() === input.currentUsername.trim().toLowerCase()
  ) {
    return 'reply';
  }
  return 'chat';
}

/**
 * Parses stored sound preference from localStorage (defaults to enabled).
 */
export function parseNotificationSoundPreference(raw: string | null | undefined): boolean {
  if (raw === 'off' || raw === 'false' || raw === '0') return false;
  return true;
}

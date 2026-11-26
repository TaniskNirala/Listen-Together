export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export type UsernameValidationResult =
  | { ok: true; username: string; usernameLower: string }
  | { ok: false; error: string };

export function validateUsername(raw: string): UsernameValidationResult {
  const trimmed = raw.trim();
  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return {
      ok: false,
      error: `Username must be at least ${USERNAME_MIN_LENGTH} characters.`,
    };
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Username must be ${USERNAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: 'Username may only contain letters, numbers, dots, underscores, or hyphens.',
    };
  }
  return {
    ok: true,
    username: trimmed,
    usernameLower: trimmed.toLowerCase(),
  };
}

export const REACTION_EMOJIS = ['🔥', '❤️', '👏', '🎵', '🙌', '😮'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

const ALLOWED_REACTION_SET = new Set<string>(REACTION_EMOJIS);

/**
 * Normalizes variation selectors (e.g., plain ❤ -> ❤️) and validates against the allowed emoji set.
 */
export function normalizeReactionEmoji(raw: string): ReactionEmoji | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const canonical = trimmed === '❤' ? '❤️' : trimmed;
  return ALLOWED_REACTION_SET.has(canonical) ? (canonical as ReactionEmoji) : null;
}

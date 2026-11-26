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

export const QUICK_REACTION_EMOJIS = ['🔥', '❤️', '👏', '🎵', '🙌', '😮'] as const;

export const REACTION_GROUPS = [
  {
    id: 'hype',
    label: 'Hype',
    emojis: ['🔥', '🎉', '🚀', '⚡', '💯', '🙌'],
  },
  {
    id: 'vibe',
    label: 'Vibe',
    emojis: ['🎵', '🎧', '💃', '✨', '🌙', '👏'],
  },
  {
    id: 'feels',
    label: 'Feels',
    emojis: ['❤️', '😍', '😂', '🥹', '😭', '😮'],
  },
] as const;

export const REACTION_EMOJIS = [
  '🔥',
  '🎉',
  '🚀',
  '⚡',
  '💯',
  '🙌',
  '🎵',
  '🎧',
  '💃',
  '✨',
  '🌙',
  '👏',
  '❤️',
  '😍',
  '😂',
  '🥹',
  '😭',
  '😮',
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

const ALLOWED_REACTION_SET = new Set<string>(REACTION_EMOJIS);

const REACTION_ALIAS_MAP: Record<string, ReactionEmoji> = {
  '❤': '❤️',
  '❤️': '❤️',
  '⚡️': '⚡',
  '✨️': '✨',
};

/**
 * Normalizes variation selectors (e.g., plain ❤ -> ❤️) and validates against the allowed emoji set.
 */
export function normalizeReactionEmoji(raw: string): ReactionEmoji | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const canonical = REACTION_ALIAS_MAP[trimmed] || trimmed;
  return ALLOWED_REACTION_SET.has(canonical) ? (canonical as ReactionEmoji) : null;
}

/**
 * Collapses whitespace and truncates a replied-to chat message for compact quote previews.
 */
export function buildReplySnippet(body: string, maxLength = 120): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

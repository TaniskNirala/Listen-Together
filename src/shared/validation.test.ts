import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplySnippet,
  normalizeReactionEmoji,
  REACTION_EMOJIS,
  validateUsername,
} from './validation';

test('validateUsername accepts valid usernames and normalizes casing/whitespace', () => {
  const res = validateUsername('  Maya_01.dj-x  ');
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.username, 'Maya_01.dj-x');
    assert.equal(res.usernameLower, 'maya_01.dj-x');
  }
});

test('validateUsername rejects short, overly long, or invalid-character usernames', () => {
  assert.equal(validateUsername('a').ok, false);
  assert.equal(validateUsername('   ').ok, false);
  assert.equal(validateUsername('a'.repeat(33)).ok, false);
  assert.equal(validateUsername('bad name').ok, false);
  assert.equal(validateUsername('user@name').ok, false);
  assert.equal(validateUsername('<script>').ok, false);
});

test('normalizeReactionEmoji accepts all expanded emojis, canonicalizes aliases, and rejects unsupported inputs', () => {
  for (const emoji of REACTION_EMOJIS) {
    assert.equal(normalizeReactionEmoji(emoji), emoji);
  }
  assert.equal(normalizeReactionEmoji('❤'), '❤️');
  assert.equal(normalizeReactionEmoji('⚡️'), '⚡');
  assert.equal(normalizeReactionEmoji(' 🎧 '), '🎧');
  assert.equal(normalizeReactionEmoji('🚀'), '🚀');
  assert.equal(normalizeReactionEmoji('💩'), null);
  assert.equal(normalizeReactionEmoji(''), null);
});

test('buildReplySnippet collapses whitespace and truncates cleanly with ellipsis', () => {
  assert.equal(buildReplySnippet('  hello   world\nagain  '), 'hello world again');
  const longText = 'This song hits so hard when the bass drops at the chorus right around two minutes in';
  const snippet = buildReplySnippet(longText, 30);
  assert.equal(snippet.length <= 30, true);
  assert.equal(snippet.endsWith('…'), true);
});

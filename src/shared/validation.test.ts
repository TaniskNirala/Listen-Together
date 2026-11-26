import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReactionEmoji, validateUsername } from './validation';

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

test('normalizeReactionEmoji accepts supported emojis and canonicalizes plain heart', () => {
  assert.equal(normalizeReactionEmoji('🔥'), '🔥');
  assert.equal(normalizeReactionEmoji('❤️'), '❤️');
  assert.equal(normalizeReactionEmoji('❤'), '❤️');
  assert.equal(normalizeReactionEmoji(' 🎵 '), '🎵');
  assert.equal(normalizeReactionEmoji('🚀'), null);
  assert.equal(normalizeReactionEmoji(''), null);
});

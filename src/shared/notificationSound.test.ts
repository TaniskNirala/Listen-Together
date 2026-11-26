import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseNotificationSoundPreference,
  resolveChatNotificationTone,
  shouldPlayNotificationSound,
} from './notificationSound';

test('shouldPlayNotificationSound suppresses muted, self events, and cooldown bursts', () => {
  assert.equal(
    shouldPlayNotificationSound({
      enabled: false,
      isOwnEvent: false,
      nowMs: 5000,
      lastPlayedAtMs: null,
    }),
    false
  );

  assert.equal(
    shouldPlayNotificationSound({
      enabled: true,
      isOwnEvent: true,
      nowMs: 5000,
      lastPlayedAtMs: null,
    }),
    false
  );

  assert.equal(
    shouldPlayNotificationSound({
      enabled: true,
      isOwnEvent: false,
      nowMs: 5000,
      lastPlayedAtMs: null,
    }),
    true
  );

  // Within 1200ms cooldown window -> suppressed
  assert.equal(
    shouldPlayNotificationSound({
      enabled: true,
      isOwnEvent: false,
      nowMs: 5800,
      lastPlayedAtMs: 5000,
      cooldownMs: 1200,
    }),
    false
  );

  // At or past cooldown window -> allowed
  assert.equal(
    shouldPlayNotificationSound({
      enabled: true,
      isOwnEvent: false,
      nowMs: 6200,
      lastPlayedAtMs: 5000,
      cooldownMs: 1200,
    }),
    true
  );
});

test('resolveChatNotificationTone distinguishes replies addressed to current user', () => {
  assert.equal(
    resolveChatNotificationTone({ replyToUsername: 'Alex', currentUsername: 'alex' }),
    'reply'
  );
  assert.equal(
    resolveChatNotificationTone({ replyToUsername: 'Sam', currentUsername: 'alex' }),
    'chat'
  );
  assert.equal(
    resolveChatNotificationTone({ replyToUsername: null, currentUsername: 'alex' }),
    'chat'
  );
});

test('parseNotificationSoundPreference defaults to enabled and honors off values', () => {
  assert.equal(parseNotificationSoundPreference(null), true);
  assert.equal(parseNotificationSoundPreference('on'), true);
  assert.equal(parseNotificationSoundPreference('off'), false);
  assert.equal(parseNotificationSoundPreference('false'), false);
  assert.equal(parseNotificationSoundPreference('0'), false);
});

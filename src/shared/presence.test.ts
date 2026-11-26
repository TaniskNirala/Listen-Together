import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUserPresence, resolveClientPresence } from './presence';

test('resolveClientPresence marks tabActive and inChat only when tab is visible on screen', () => {
  assert.deepEqual(resolveClientPresence({ visibilityState: 'visible', isChatOpen: true }), {
    tabActive: true,
    inChat: true,
  });
  assert.deepEqual(resolveClientPresence({ visibilityState: 'visible', isChatOpen: false }), {
    tabActive: true,
    inChat: false,
  });
  // Even if chat tab was left open, backgrounding the browser tab clears both tabActive and inChat
  assert.deepEqual(resolveClientPresence({ visibilityState: 'hidden', isChatOpen: true }), {
    tabActive: false,
    inChat: false,
  });
});

test('aggregateUserPresence combines multiple sockets for the same user accurately', () => {
  assert.deepEqual(aggregateUserPresence([]), { tabActive: false, inChat: false });
  assert.deepEqual(
    aggregateUserPresence([
      { tabActive: false, inChat: false },
      { tabActive: false, inChat: false },
    ]),
    { tabActive: false, inChat: false }
  );
  assert.deepEqual(
    aggregateUserPresence([
      { tabActive: false, inChat: false },
      { tabActive: true, inChat: false },
    ]),
    { tabActive: true, inChat: false }
  );
  assert.deepEqual(
    aggregateUserPresence([
      { tabActive: true, inChat: false },
      { tabActive: true, inChat: true },
    ]),
    { tabActive: true, inChat: true }
  );
});

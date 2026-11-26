export interface PresenceSnapshot {
  tabActive: boolean;
  inChat: boolean;
}

/**
 * Computes whether a client tab is actively open on screen (not backgrounded)
 * and whether the user currently has the room chat open on screen.
 */
export function resolveClientPresence(params: {
  visibilityState: string;
  isChatOpen: boolean;
}): PresenceSnapshot {
  const tabActive = params.visibilityState === 'visible';
  return {
    tabActive,
    inChat: tabActive && params.isChatOpen,
  };
}

/**
 * Aggregates presence across multiple open tabs/sockets belonging to the same user in a room.
 * A user is considered active on screen if at least one tab is visible, and in chat if at least
 * one visible tab currently has chat open.
 */
export function aggregateUserPresence(sockets: PresenceSnapshot[]): PresenceSnapshot {
  let tabActive = false;
  let inChat = false;

  for (const s of sockets) {
    if (s.tabActive) {
      tabActive = true;
      if (s.inChat) {
        inChat = true;
        break;
      }
    }
  }

  return { tabActive, inChat };
}

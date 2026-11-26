export type GlobalRole = 'admin' | 'user';
export type RoomRole = 'host' | 'dj' | 'listener';
export type ControlMode = 'everyone' | 'dj_only';
export type RepeatMode = 'off' | 'one' | 'all';
export type TrackSource = 'youtube' | 'spotify';

export interface AuthUser {
  id: number;
  username: string;
  role: GlobalRole;
  disabled: boolean;
  createdAt?: string;
}

export interface AdminUserRecord extends AuthUser {
  online: boolean;
  currentRoomCode: string | null;
  currentRoomName: string | null;
}

export interface Track {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnailUrl: string;
  source: TrackSource;
  sourceUrl: string;
  matchedVia?: 'youtube';
  addedByUserId: number | null;
  addedByUsername: string;
  addedAt: string;
}

export interface HistoryItem {
  id: number;
  track: Track;
  addedByUsername: string;
  playedAt: string;
}

export interface ChatReplyReference {
  id: string;
  username: string;
  body: string;
}

export interface ChatMessage {
  id: string;
  roomId: number;
  userId: number | null;
  username: string;
  body: string;
  createdAt: string;
  replyTo?: ChatReplyReference | null;
}

export interface RoomListener {
  userId: number;
  username: string;
  role: RoomRole;
  online: boolean;
}

export interface RoomPlaybackState {
  currentTrack: Track | null;
  isPlaying: boolean;
  positionAtTimestamp: number;
  serverTimestamp: number;
  queue: Track[];
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  version: number;
}

export interface RoomFullState {
  id: number;
  code: string;
  name: string;
  hasPassword: boolean;
  hostUserId: number;
  controlMode: ControlMode;
  myRole: RoomRole;
  playback: RoomPlaybackState;
  listeners: RoomListener[];
  chat: ChatMessage[];
  history: HistoryItem[];
}

export interface RoomSummary {
  id: number;
  code: string;
  name: string;
  hasPassword: boolean;
  hostUsername: string;
  controlMode: ControlMode;
  onlineCount: number;
  currentTrackTitle: string | null;
  isPlaying: boolean;
  createdAt: string;
}

export interface ReactionEvent {
  id: string;
  emoji: string;
  username: string;
  timestamp: number;
  comboCount?: number;
}

export interface PlaylistImportProgress {
  importId: string;
  roomCode: string;
  stage: 'fetching' | 'matching' | 'done' | 'error';
  processed: number;
  total: number;
  added: number;
  failed: number;
  message: string;
}

export interface ClockSample {
  rttMs: number;
  offsetMs: number;
  measuredAt: number;
}

export interface DriftDecision {
  driftSec: number;
  action: 'none' | 'gentle' | 'seek';
  playbackRate: number;
  targetPositionSec: number;
}

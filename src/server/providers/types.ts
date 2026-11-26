import type { TrackSource } from '../../shared/types';

export interface ResolvedTrackMetadata {
  youtubeId: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnailUrl: string;
  source: TrackSource;
  sourceUrl: string;
  matchedVia?: 'youtube';
}

export interface ResolveOptions {
  maxItems: number;
  onProgress?: (update: {
    stage: 'fetching' | 'matching';
    processed: number;
    total: number;
    added: number;
    failed: number;
    message: string;
  }) => void;
}

export interface ResolveResult {
  tracks: ResolvedTrackMetadata[];
  provider: string;
  playlistTitle?: string;
  truncated?: boolean;
  failedCount?: number;
  fallbackPasteSupported?: boolean;
  warning?: string;
}

export interface MusicProvider {
  id: string;
  canHandle(input: string): boolean;
  resolve(input: string, options: ResolveOptions): Promise<ResolveResult>;
}

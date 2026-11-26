import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedSpotifyUrl,
  isAllowedYouTubeUrl,
  parseSpotifyInput,
  parseTrackListLines,
  parseYouTubeInput,
} from './parsers';

test('parseYouTubeInput extracts video and playlist IDs across youtube.com, youtu.be, and music.youtube.com', () => {
  const v1 = parseYouTubeInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(v1?.kind, 'video');
  assert.equal(v1?.videoId, 'dQw4w9WgXcQ');

  const v2 = parseYouTubeInput('https://youtu.be/dQw4w9WgXcQ?t=42');
  assert.equal(v2?.kind, 'video');
  assert.equal(v2?.videoId, 'dQw4w9WgXcQ');

  const v3 = parseYouTubeInput('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(v3?.kind, 'video');
  assert.equal(v3?.videoId, 'dQw4w9WgXcQ');

  const p1 = parseYouTubeInput('https://www.youtube.com/playlist?list=PL1234567890abcdef');
  assert.equal(p1?.kind, 'playlist');
  assert.equal(p1?.playlistId, 'PL1234567890abcdef');
});

test('parseSpotifyInput parses track, album, playlist, and localized URLs', () => {
  const t = parseSpotifyInput('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc');
  assert.equal(t?.kind, 'track');
  assert.equal(t?.id, '4cOdK2wGLETKBW3PvgPWqT');

  const p = parseSpotifyInput('https://open.spotify.com/intl-en/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(p?.kind, 'playlist');
  assert.equal(p?.id, '37i9dQZF1DXcBWIGoYBM5M');

  const a = parseSpotifyInput('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3');
  assert.equal(a?.kind, 'album');
  assert.equal(a?.id, '1DFixLWuPkv3KT3TnV35m3');
});

test('SSRF allowlist rejects loopback, metadata IPs, javascript schemes, and foreign hosts', () => {
  assert.equal(isAllowedYouTubeUrl('http://127.0.0.1:8080/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(isAllowedYouTubeUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedYouTubeUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedYouTubeUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(isAllowedSpotifyUrl('https://open.spotify.com.evil.test/track/4cOdK2wGLETKBW3PvgPWqT'), false);
  assert.equal(parseSpotifyInput('http://localhost/track/4cOdK2wGLETKBW3PvgPWqT'), null);
});

test('parseTrackListLines cleans numbered bullets and respects maxItems cap', () => {
  const input = `
    1. Daft Punk - Instant Crush
    2) Khruangbin - Time (You and I)
    - Parcels - Tieduprightnow

    x
  `;
  const lines = parseTrackListLines(input, 2);
  assert.deepEqual(lines, [
    'Daft Punk - Instant Crush',
    'Khruangbin - Time (You and I)',
  ]);
});

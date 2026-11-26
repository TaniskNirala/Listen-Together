import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractInnerTubeVideoRenderers,
  extractYtInitialDataFromHtml,
  isValidYouTubeVideoId,
  parseDurationTextToSec,
  parseInvidiousSearchResults,
  parsePipedSearchResults,
  sanitizeThumbnailUrl,
} from './youtubeSearchParsers';

test('parseDurationTextToSec parses mm:ss and hh:mm:ss and rejects non-durations', () => {
  assert.equal(parseDurationTextToSec('3:45'), 225);
  assert.equal(parseDurationTextToSec('0:09'), 9);
  assert.equal(parseDurationTextToSec('1:02:15'), 3735);
  assert.equal(parseDurationTextToSec('LIVE'), 0);
  assert.equal(parseDurationTextToSec(''), 0);
  assert.equal(parseDurationTextToSec(null), 0);
});

test('sanitizeThumbnailUrl enforces YouTube hosts and falls back safely', () => {
  assert.equal(
    sanitizeThumbnailUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'dQw4w9WgXcQ'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
  );
  assert.equal(
    sanitizeThumbnailUrl('//i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', 'dQw4w9WgXcQ'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg'
  );
  assert.equal(
    sanitizeThumbnailUrl('https://evil.example.com/pic.jpg', 'dQw4w9WgXcQ'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
  );
  assert.equal(isValidYouTubeVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isValidYouTubeVideoId('short'), false);
});

test('extractInnerTubeVideoRenderers traverses nested search payloads, deduplicates, and caps', () => {
  const payload = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: 'a5uQMwRMHcs',
                        title: { runs: [{ text: 'Daft Punk - Instant Crush' }] },
                        ownerText: { runs: [{ text: 'Daft Punk' }] },
                        lengthText: { simpleText: '5:39' },
                        thumbnail: {
                          thumbnails: [
                            { url: 'https://i.ytimg.com/vi/a5uQMwRMHcs/default.jpg' },
                            { url: 'https://i.ytimg.com/vi/a5uQMwRMHcs/hq720.jpg' },
                          ],
                        },
                      },
                    },
                    {
                      // Duplicate ID should be ignored
                      videoRenderer: {
                        videoId: 'a5uQMwRMHcs',
                        title: { simpleText: 'Duplicate' },
                      },
                    },
                    {
                      // Invalid ID should be ignored
                      videoRenderer: {
                        videoId: 'bad',
                        title: { simpleText: 'Bad ID' },
                      },
                    },
                    {
                      compactVideoRenderer: {
                        videoId: 'FGBhQbmPwH8',
                        title: { simpleText: 'Daft Punk - One More Time' },
                        longBylineText: { runs: [{ text: 'Daft Punk Official' }] },
                        thumbnailOverlays: [
                          {
                            thumbnailOverlayTimeStatusRenderer: {
                              text: { simpleText: '5:21' },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };

  const results = extractInnerTubeVideoRenderers(payload, 8);
  assert.equal(results.length, 2);
  assert.equal(results[0].youtubeId, 'a5uQMwRMHcs');
  assert.equal(results[0].title, 'Daft Punk - Instant Crush');
  assert.equal(results[0].artist, 'Daft Punk');
  assert.equal(results[0].durationSec, 339);
  assert.equal(results[0].thumbnailUrl, 'https://i.ytimg.com/vi/a5uQMwRMHcs/hq720.jpg');

  assert.equal(results[1].youtubeId, 'FGBhQbmPwH8');
  assert.equal(results[1].durationSec, 321);
  assert.equal(results[1].artist, 'Daft Punk Official');

  // Limit cap works
  assert.equal(extractInnerTubeVideoRenderers(payload, 1).length, 1);
});

test('extractYtInitialDataFromHtml parses ytInitialData even with braces inside strings', () => {
  const html = `
    <html><head></head><body>
      <script>
        var ytInitialData = {"contents":{"label":"Hello } \\" { world","videoRenderer":{"videoId":"5NV6Rdv1a3I","title":{"simpleText":"Get Lucky"}}}};
      </script>
    </body></html>
  `;
  const data = extractYtInitialDataFromHtml(html);
  assert.ok(data);
  const results = extractInnerTubeVideoRenderers(data, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].youtubeId, '5NV6Rdv1a3I');
  assert.equal(results[0].title, 'Get Lucky');
});

test('parseInvidiousSearchResults parses video items and skips channels', () => {
  const payload = [
    { type: 'channel', author: 'Daft Punk', authorId: 'UC_kRDKYrWvtnxG0fRlcitDQ' },
    {
      type: 'video',
      videoId: 'K0HSD_i2DvA',
      title: 'Around the World',
      author: 'Daft Punk',
      lengthSeconds: 241,
      videoThumbnails: [{ quality: 'high', url: 'https://i.ytimg.com/vi/K0HSD_i2DvA/hqdefault.jpg' }],
    },
  ];
  const results = parseInvidiousSearchResults(payload, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].youtubeId, 'K0HSD_i2DvA');
  assert.equal(results[0].durationSec, 241);
  assert.equal(results[0].artist, 'Daft Punk');
});

test('parsePipedSearchResults extracts stream results and ignores playlists', () => {
  const payload = {
    items: [
      { type: 'playlist', url: '/playlist?list=PL1234', name: 'Best Of' },
      {
        type: 'stream',
        url: '/watch?v=34Na4j8AVgA',
        title: 'The Weeknd - Starboy',
        uploaderName: 'The Weeknd',
        duration: 274,
        thumbnail: 'https://pipedproxy.example.com/vi/34Na4j8AVgA/hqdefault.jpg',
      },
    ],
  };
  const results = parsePipedSearchResults(payload, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].youtubeId, '34Na4j8AVgA');
  assert.equal(results[0].title, 'The Weeknd - Starboy');
  assert.equal(results[0].durationSec, 274);
  // Untrusted proxy host falls back to canonical YouTube thumbnail
  assert.equal(results[0].thumbnailUrl, 'https://i.ytimg.com/vi/34Na4j8AVgA/hqdefault.jpg');
});

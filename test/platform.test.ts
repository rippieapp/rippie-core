import { describe, expect, test } from 'bun:test';
import { detectMusicPlatform, Platform } from '../src/platform.js';

describe('detectMusicPlatform', () => {
	test('detects every supported track link shape', () => {
		const cases: [string, Platform][] = [
			['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', Platform.Spotify],
			['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123', Platform.Spotify],
			[
				'https://music.apple.com/us/album/never-gonna-give-you-up/1558533900?i=1558534271',
				Platform.AppleMusic,
			],
			['https://music.youtube.com/watch?v=dQw4w9WgXcQ', Platform.YouTubeMusic],
			['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM', Platform.YouTubeMusic],
			['https://www.deezer.com/track/3135556', Platform.Deezer],
			['https://www.deezer.com/en/track/3135556', Platform.Deezer],
			['https://link.deezer.com/s/33HJubg3npxgAGfoCij0m', Platform.Deezer],
			['https://tidal.com/browse/track/77692506', Platform.Tidal],
			['https://listen.tidal.com/track/77692506', Platform.Tidal],
		];

		for (const [url, expected] of cases) {
			expect(detectMusicPlatform(url)).toBe(expected);
		}
	});

	test('rejects links that are not individual tracks', () => {
		const rejected = [
			'https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT',
			'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
			'https://music.apple.com/us/artist/rick-astley/669771',
			'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			'https://www.deezer.com/album/302127',
			'https://tidal.com/browse/album/77692505',
			'https://example.com/track/1',
			'not a url at all',
			'',
		];

		for (const url of rejected) {
			expect(detectMusicPlatform(url)).toBeNull();
		}
	});

	test('only matches links anchored at the start of the string', () => {
		expect(detectMusicPlatform('look at https://open.spotify.com/track/abc123')).toBeNull();
	});
});

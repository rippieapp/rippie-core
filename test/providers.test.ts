import { describe, expect, test } from 'bun:test';
import { createDeezerProvider } from '../src/providers/deezer.js';
import { createSpotifyProvider } from '../src/providers/spotify.js';
import { createTidalProvider } from '../src/providers/tidal.js';
import { failingFetch, mockFetch, respondFrom } from './mockFetch.js';

const CREDENTIALS = { clientId: 'id', clientSecret: 'secret' };

describe('spotify provider', () => {
	const tokenRoute = { access_token: 'token-1', expires_in: 3600 };

	test('authenticates with basic credentials and reads a track', async () => {
		const http = mockFetch({
			'accounts.spotify.com/api/token': tokenRoute,
			'api.spotify.com/v1/tracks/': {
				id: 'abc123',
				name: 'Track',
				artists: [{ name: 'Artist' }, { name: 'Second' }],
				external_ids: { isrc: 'ISRC1' },
			},
		});
		const spotify = createSpotifyProvider({ ...CREDENTIALS, fetch: http.fetch });

		const track = await spotify.fetchTrack('https://open.spotify.com/track/abc123?si=x');

		expect(track).toEqual({
			name: 'Track',
			artists: ['Artist', 'Second'],
			isrc: 'ISRC1',
			link: 'https://open.spotify.com/track/abc123',
		});

		const [tokenRequest] = http.matching('accounts.spotify.com');
		expect(tokenRequest?.method).toBe('POST');
		expect(tokenRequest?.headers.authorization).toBe(`Basic ${btoa('id:secret')}`);
		expect(tokenRequest?.body).toBe('grant_type=client_credentials');

		const [trackRequest] = http.matching('api.spotify.com/v1/tracks');
		expect(trackRequest?.url).toBe('https://api.spotify.com/v1/tracks/abc123');
		expect(trackRequest?.headers.authorization).toBe('Bearer token-1');
	});

	test('reuses a cached token across calls', async () => {
		const http = mockFetch({
			'accounts.spotify.com/api/token': tokenRoute,
			'api.spotify.com/v1/tracks/': {
				id: 'abc123',
				name: 'Track',
				artists: [],
				external_ids: {},
			},
		});
		const spotify = createSpotifyProvider({ ...CREDENTIALS, fetch: http.fetch });

		await spotify.fetchTrack('https://open.spotify.com/track/abc123');
		await spotify.fetchTrack('https://open.spotify.com/track/abc123');

		expect(http.matching('accounts.spotify.com').length).toBe(1);
	});

	test('does not share a token between instances', async () => {
		const http = mockFetch({
			'accounts.spotify.com/api/token': tokenRoute,
			'api.spotify.com/v1/tracks/': {
				id: 'a',
				name: 'T',
				artists: [],
				external_ids: {},
			},
		});

		await createSpotifyProvider({ ...CREDENTIALS, fetch: http.fetch }).fetchTrack(
			'https://open.spotify.com/track/a',
		);
		await createSpotifyProvider({ ...CREDENTIALS, fetch: http.fetch }).fetchTrack(
			'https://open.spotify.com/track/a',
		);

		expect(http.matching('accounts.spotify.com').length).toBe(2);
	});

	test('searches by ISRC and returns the track link', async () => {
		const http = mockFetch({
			'accounts.spotify.com/api/token': tokenRoute,
			'api.spotify.com/v1/search': {
				tracks: {
					items: [
						{
							id: 'found',
							name: 'Track',
							artists: [{ name: 'Artist' }],
							external_ids: { isrc: 'ISRC1' },
						},
					],
				},
			},
		});
		const spotify = createSpotifyProvider({ ...CREDENTIALS, fetch: http.fetch });

		expect(await spotify.findByIsrc?.('ISRC1')).toBe('https://open.spotify.com/track/found');

		const [search] = http.matching('/v1/search');
		expect(search?.url).toContain('q=isrc%3AISRC1');
		expect(search?.url).toContain('type=track');
		expect(search?.url).toContain('limit=1');
	});

	test('returns null on an empty search result', async () => {
		const http = mockFetch({
			'accounts.spotify.com/api/token': tokenRoute,
			'api.spotify.com/v1/search': { tracks: { items: [] } },
		});
		const spotify = createSpotifyProvider({ ...CREDENTIALS, fetch: http.fetch });
		expect(await spotify.findByIsrc?.('ISRC1')).toBeNull();
	});

	test('returns null without credentials and never calls the network', async () => {
		const http = mockFetch({});
		const spotify = createSpotifyProvider({
			clientId: '',
			clientSecret: '',
			fetch: http.fetch,
		});

		expect(await spotify.fetchTrack('https://open.spotify.com/track/abc')).toBeNull();
		expect(http.requests.length).toBe(0);
	});

	test('returns null when the network throws', async () => {
		const spotify = createSpotifyProvider({ ...CREDENTIALS, fetch: failingFetch });
		expect(await spotify.fetchTrack('https://open.spotify.com/track/abc')).toBeNull();
	});

	test('returns null when the token endpoint fails', async () => {
		const http = mockFetch({
			'accounts.spotify.com/api/token': () => new Response('nope', { status: 401 }),
		});
		const spotify = createSpotifyProvider({ ...CREDENTIALS, fetch: http.fetch });
		expect(await spotify.fetchTrack('https://open.spotify.com/track/abc')).toBeNull();
	});

	test('does not match a non-Spotify url', async () => {
		const spotify = createSpotifyProvider(CREDENTIALS);
		expect(spotify.matches('https://www.deezer.com/track/1')).toBe(false);
		expect(spotify.matches('https://open.spotify.com/track/abc')).toBe(true);
	});
});

describe('deezer provider', () => {
	test('reads a direct track link', async () => {
		const http = mockFetch({
			'api.deezer.com/track/': {
				id: 3135556,
				title: 'Harder Better Faster Stronger',
				isrc: 'GBDUW0000059',
				link: 'https://www.deezer.com/track/3135556',
				artist: { name: 'Daft Punk' },
			},
		});
		const deezer = createDeezerProvider({ fetch: http.fetch });

		expect(await deezer.fetchTrack('https://www.deezer.com/track/3135556')).toEqual({
			name: 'Harder Better Faster Stronger',
			artists: ['Daft Punk'],
			isrc: 'GBDUW0000059',
			link: 'https://www.deezer.com/track/3135556',
		});
	});

	test('treats a 200 response carrying an error body as a miss', async () => {
		const http = mockFetch({
			'api.deezer.com/track/': {
				error: { type: 'DataException', message: 'no data', code: 800 },
			},
		});
		const deezer = createDeezerProvider({ fetch: http.fetch });
		expect(await deezer.fetchTrack('https://www.deezer.com/track/1')).toBeNull();
		expect(await deezer.findByIsrc?.('ISRC1')).toBeNull();
	});

	test('follows a short share link with a HEAD request', async () => {
		const http = mockFetch({
			// A followed redirect surfaces as a 200 whose `url` is the final destination.
			'link.deezer.com/s/': () => respondFrom('https://www.deezer.com/en/track/3135556'),
			'api.deezer.com/track/': {
				id: 3135556,
				title: 'Track',
				isrc: 'ISRC1',
				link: 'https://www.deezer.com/track/3135556',
				artist: { name: 'Artist' },
			},
		});
		const deezer = createDeezerProvider({ fetch: http.fetch });

		expect(await deezer.extractDeezerTrackId('https://link.deezer.com/s/abc')).toBe('3135556');
		expect(http.matching('link.deezer.com')[0]?.method).toBe('HEAD');
	});

	test('encodes the ISRC into the lookup path', async () => {
		const http = mockFetch({
			'api.deezer.com/track/isrc:': {
				id: 42,
				title: 'Track',
				isrc: 'GB/DUW',
				link: 'https://www.deezer.com/track/42',
				artist: { name: 'Artist' },
			},
		});
		const deezer = createDeezerProvider({ fetch: http.fetch });

		expect(await deezer.findByIsrc?.('GB/DUW')).toBe('https://www.deezer.com/en/track/42');
		expect(http.requests[0]?.url).toBe('https://api.deezer.com/track/isrc:GB%2FDUW');
	});

	test('returns null when the network throws', async () => {
		const deezer = createDeezerProvider({ fetch: failingFetch });
		expect(await deezer.fetchTrack('https://www.deezer.com/track/1')).toBeNull();
	});
});

describe('tidal provider', () => {
	const tokenRoute = { access_token: 'tidal-token', expires_in: 3600, token_type: 'Bearer' };

	const trackPayload = {
		data: {
			id: '77692506',
			type: 'tracks' as const,
			attributes: {
				title: 'Track',
				isrc: 'ISRC1',
				externalLinks: [
					{ href: 'https://tidal.com/track/77692506', meta: { type: 'TIDAL_SHARING' } },
				],
			},
			relationships: { artists: { data: [{ id: 'a1', type: 'artists' }] } },
		},
		included: [{ id: 'a1', type: 'artists', attributes: { name: 'Artist' } }],
	};

	test('reads a track and resolves artist names from the included payload', async () => {
		const http = mockFetch({
			'auth.tidal.com': tokenRoute,
			'openapi.tidal.com/v2/tracks/': trackPayload,
		});
		const tidal = createTidalProvider({ ...CREDENTIALS, fetch: http.fetch });

		expect(await tidal.fetchTrack('https://tidal.com/browse/track/77692506')).toEqual({
			name: 'Track',
			artists: ['Artist'],
			isrc: 'ISRC1',
			link: 'https://tidal.com/track/77692506',
		});

		const [request] = http.matching('/v2/tracks/');
		expect(request?.headers.accept).toBe('application/vnd.api+json');
		expect(request?.headers.authorization).toBe('Bearer tidal-token');
		expect(request?.url).toContain('include=artists');
	});

	test('picks the most popular match when an ISRC returns several versions', async () => {
		const http = mockFetch({
			'auth.tidal.com': tokenRoute,
			'openapi.tidal.com/v2/tracks': {
				data: [
					{ id: '1', type: 'tracks', attributes: { title: 'Quiet', popularity: 0.1 } },
					{ id: '2', type: 'tracks', attributes: { title: 'Loud', popularity: 0.9 } },
				],
			},
		});
		const tidal = createTidalProvider({ ...CREDENTIALS, fetch: http.fetch });

		expect(await tidal.findByIsrc?.('ISRC1')).toBe('https://tidal.com/browse/track/2');
	});

	test('applies the configured country code', async () => {
		const http = mockFetch({
			'auth.tidal.com': tokenRoute,
			'openapi.tidal.com/v2/tracks': { data: [] },
		});
		const tidal = createTidalProvider({
			...CREDENTIALS,
			countryCode: 'US',
			fetch: http.fetch,
		});

		await tidal.findByIsrc?.('ISRC1');
		expect(http.matching('/v2/tracks')[0]?.url).toContain('countryCode=US');
	});

	test('returns null without credentials and never calls the network', async () => {
		const http = mockFetch({});
		const tidal = createTidalProvider({
			clientId: '',
			clientSecret: '',
			fetch: http.fetch,
		});

		expect(await tidal.fetchTrack('https://tidal.com/browse/track/1')).toBeNull();
		expect(http.requests.length).toBe(0);
	});

	test('returns null when the network throws', async () => {
		const tidal = createTidalProvider({ ...CREDENTIALS, fetch: failingFetch });
		expect(await tidal.fetchTrack('https://tidal.com/browse/track/1')).toBeNull();
	});
});

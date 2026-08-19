import { Platform } from '../platform.js';
import type {
	ClientCredentials,
	FetchLike,
	Provider,
	ProviderOptions,
	TrackInfo,
} from '../types.js';

type SpotifyTokenResponse = {
	access_token: string;
	expires_in: number;
};

type SpotifyTrack = {
	id: string;
	name: string;
	artists: { name: string }[];
	external_ids: {
		isrc?: string;
	};
};

type SpotifySearchResponse = {
	tracks: {
		items: SpotifyTrack[];
	};
};

export type SpotifyTrackLookup = {
	id: string;
	name: string;
	artists: string[];
	isrc: string;
	link: string;
};

export type SpotifyProviderOptions = ClientCredentials & ProviderOptions;

// Spotify links always contain the track ID at the end before the query params
// (e.g., https://open.spotify.com/track/<id>?...)
const TRACK_ID_PATTERN = /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/;

/** Extracts a Spotify track ID from a URL. */
export const extractSpotifyTrackId = (url: string): string | null => {
	const match = url.match(TRACK_ID_PATTERN);
	return match?.[1] ?? null;
};

const toTrackInfo = (track: SpotifyTrack): TrackInfo => ({
	name: track.name,
	artists: track.artists.map((artist) => artist.name),
	isrc: track.external_ids.isrc ?? null,
	link: `https://open.spotify.com/track/${track.id}`,
});

/**
 * Creates a Spotify provider backed by the Web API.
 *
 * The access token is cached per instance rather than per module so two clients in one process
 * cannot invalidate each other's token.
 */
export const createSpotifyProvider = (options: SpotifyProviderOptions) => {
	const fetchImpl: FetchLike = options.fetch ?? fetch;
	let cachedToken: string | null = null;
	let tokenExpiresAt = 0;

	// Fetches or refreshes a Spotify OAuth client-credentials access token.
	const getAccessToken = async (): Promise<string | null> => {
		if (!options.clientId || !options.clientSecret) {
			return null;
		}

		if (cachedToken && Date.now() < tokenExpiresAt) {
			return cachedToken;
		}

		try {
			const credentials = btoa(`${options.clientId}:${options.clientSecret}`);

			const response = await fetchImpl('https://accounts.spotify.com/api/token', {
				method: 'POST',
				headers: {
					Authorization: `Basic ${credentials}`,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: 'grant_type=client_credentials',
			});

			if (!response.ok) {
				return null;
			}

			const data = (await response.json()) as SpotifyTokenResponse;

			cachedToken = data.access_token;
			// 60s buffer so the token cannot expire mid request
			tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000;

			return cachedToken;
		} catch {
			return null;
		}
	};

	/** Fetches track info from the Spotify Web API by track ID. */
	const fetchSpotifyTrackInfo = async (trackId: string): Promise<TrackInfo | null> => {
		try {
			const token = await getAccessToken();
			if (!token) return null;

			const response = await fetchImpl(`https://api.spotify.com/v1/tracks/${trackId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!response.ok) {
				return null;
			}

			return toTrackInfo((await response.json()) as SpotifyTrack);
		} catch {
			return null;
		}
	};

	/** Searches Spotify by ISRC to get a track link. */
	const lookupSpotifyTrackByIsrc = async (isrc: string): Promise<SpotifyTrackLookup | null> => {
		try {
			const token = await getAccessToken();
			if (!token) return null;

			const url = new URL('https://api.spotify.com/v1/search');
			url.searchParams.set('q', `isrc:${isrc}`);
			url.searchParams.set('type', 'track');
			url.searchParams.set('limit', '1');

			const response = await fetchImpl(url.toString(), {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!response.ok) {
				return null;
			}

			const data = (await response.json()) as SpotifySearchResponse;
			const track = data.tracks?.items?.[0];

			if (!track) {
				return null;
			}

			return {
				id: track.id,
				name: track.name,
				artists: track.artists.map((artist) => artist.name),
				// Fall back to the requested ISRC when the response omits it
				isrc: track.external_ids.isrc ?? isrc,
				link: `https://open.spotify.com/track/${track.id}`,
			};
		} catch {
			return null;
		}
	};

	const provider: Provider = {
		platform: Platform.Spotify,
		matches: (url) => extractSpotifyTrackId(url) !== null,
		fetchTrack: async (url) => {
			const trackId = extractSpotifyTrackId(url);
			if (!trackId) return null;
			return fetchSpotifyTrackInfo(trackId);
		},
		findByIsrc: async (isrc) => (await lookupSpotifyTrackByIsrc(isrc))?.link ?? null,
	};

	return { ...provider, fetchSpotifyTrackInfo, lookupSpotifyTrackByIsrc };
};

export type SpotifyProvider = ReturnType<typeof createSpotifyProvider>;

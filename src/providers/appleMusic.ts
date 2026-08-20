/**
 * Apple Music / iTunes provider.
 *
 * The official Apple Music API is behind a paid developer membership. This provider uses only
 * the free, public iTunes Search and Lookup APIs: Search finds candidate links by artist/title
 * text, Lookup resolves a known Apple ID to metadata, and Deezer is bridged in for the ISRC that
 * Apple never exposes.
 *
 * Apple's Search endpoint has a known bug (reported since September 2025, still open) where it
 * omits explicit-content tracks from results regardless of the `explicit` parameter. Lookup is
 * unaffected. Until Apple fixes this, `findByTrack` can return null for explicit tracks even
 * when the track exists on Apple Music. See https://developer.apple.com/forums/thread/802700.
 */

import { pickBestDeezerTrack } from '../deezerBridge.js';
import { pickBestMatch } from '../match.js';
import { Platform } from '../platform.js';
import type { FetchLike, Provider, ProviderOptions, TrackInfo } from '../types.js';

type ITunesResult = {
	trackId: number;
	artistName: string;
	collectionName: string;
	trackName?: string;
	trackViewUrl?: string;
};

type ITunesLookupResponse = {
	results: ITunesResult[];
};

const APPLE_URL_PATTERN = /music\.apple\.com\/[a-z]{2}\/album\//;

// Prefers the ?i= track parameter over the album ID in the path.
const extractAppleId = (url: string): string | null => {
	const trackMatch = url.match(/[?&]i=(\d+)/);
	if (trackMatch) return trackMatch[1] ?? null;

	const albumMatch = url.match(/\/(\d+)(?:\?|$)/);
	return albumMatch?.[1] ?? null;
};

/** Apple Music needs no credentials. */
export const createAppleMusicProvider = (options: ProviderOptions = {}) => {
	const fetchImpl: FetchLike = options.fetch ?? fetch;

	// Batch-fetches iTunes records.
	const fetchITunesRecords = async (ids: string): Promise<ITunesResult[]> => {
		try {
			const response = await fetchImpl(`https://itunes.apple.com/lookup?id=${ids}`);
			if (!response.ok) return [];
			const json = (await response.json()) as ITunesLookupResponse;
			return json.results ?? [];
		} catch {
			return [];
		}
	};

	/** Searches the iTunes Search API and picks the closest title match, then closest artist. */
	const lookupAppleTrackByInfo = async (artist: string, song: string): Promise<string | null> => {
		try {
			const searchQuery = `${artist} ${song}`;
			const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&media=music&entity=song&limit=25`;

			const response = await fetchImpl(searchUrl);
			if (!response.ok) return null;

			const json = (await response.json()) as ITunesLookupResponse;
			if (!json.results || json.results.length === 0) return null;

			const candidates = json.results.filter(
				(result): result is ITunesResult & { trackViewUrl: string; trackName: string } =>
					Boolean(result.trackViewUrl && result.trackName),
			);

			const best = pickBestMatch(
				{ artist, title: song },
				candidates,
				(c) => c.artistName,
				(c) => c.trackName,
			);

			return best?.trackViewUrl ?? null;
		} catch {
			return null;
		}
	};

	/**
	 * Resolves an Apple Music link to track info.
	 * iTunes lookup doesn't expose ISRCs, so the metadata is bridged through Deezer to retrieve one.
	 */
	const lookupAppleTrackByLink = async (url: string): Promise<TrackInfo | null> => {
		try {
			const appleId = extractAppleId(url);
			if (!appleId) return null;

			const record = (await fetchITunesRecords(appleId))[0];
			if (!record) return null;

			const artistName = record.artistName;
			const trackName = record.trackName ?? record.collectionName;
			const deezerMatch = await pickBestDeezerTrack(
				{ artist: artistName, title: trackName },
				fetchImpl,
			);

			return {
				name: trackName,
				artists: [artistName],
				isrc: deezerMatch?.isrc ?? null,
				link: url,
			};
		} catch {
			return null;
		}
	};

	const provider: Provider = {
		platform: Platform.AppleMusic,
		matches: (url) => APPLE_URL_PATTERN.test(url),
		extractId: extractAppleId,
		fetchTrack: lookupAppleTrackByLink,
		findByTrack: async (track) => {
			const artist = track.artists[0];
			if (!artist || !track.name) return null;
			return lookupAppleTrackByInfo(artist, track.name);
		},
	};

	return { ...provider, lookupAppleTrackByInfo, lookupAppleTrackByLink };
};

export type AppleMusicProvider = ReturnType<typeof createAppleMusicProvider>;

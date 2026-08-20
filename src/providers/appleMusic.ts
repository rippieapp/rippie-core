/**
 * Apple Music / iTunes provider.
 *
 * The official Apple Music API is behind a paid developer membership. The free iTunes Search API
 * is open but misses fuzzy queries and never exposes ISRCs. This provider therefore takes a hybrid
 * route: scrape the public Apple Music search page for candidate links, validate those candidates
 * against the iTunes Lookup API for accurate metadata, and bridge to Deezer for the ISRC.
 *
 * Scraping is inherently best effort. Apple can change its markup at any time, in which case
 * lookups degrade to null rather than throwing.
 */

import { distance } from 'fastest-levenshtein';
import { pickBestDeezerTrack } from '../deezerBridge.js';
import { Platform } from '../platform.js';
import { normalizeText, trackSignature } from '../text.js';
import type { FetchLike, Provider, ProviderOptions, TrackInfo } from '../types.js';

type ITunesResult = {
	trackId: number;
	artistName: string;
	collectionName: string;
	trackName?: string;
};

type ITunesLookupResponse = {
	results: ITunesResult[];
};

const SEARCH_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SONG_BLOCK_PATTERN =
	/"contentDescriptor":\s*\{\s*"kind"\s*:\s*"song"[\s\S]*?"url"\s*:\s*"(https:\/\/music\.apple\.com\/us\/album\/[^"\\?]+[^"]+\?i=\d+)"/g;

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

	/** Scrapes Apple Music search results and scores candidates using iTunes API data. */
	const lookupAppleTrackByInfo = async (artist: string, song: string): Promise<string | null> => {
		try {
			const searchQuery = `${artist} ${song}`;
			const searchUrl = `https://music.apple.com/us/search?term=${encodeURIComponent(searchQuery)}`;
			const targetSignature = normalizeText(trackSignature(artist, song));

			const response = await fetchImpl(searchUrl, {
				headers: { 'User-Agent': SEARCH_USER_AGENT },
			});
			if (!response.ok) return null;

			const html = await response.text();
			const songMatches = [...html.matchAll(SONG_BLOCK_PATTERN)];
			if (songMatches.length === 0) return null;

			const cleanUrls = songMatches.map((match) => (match[1] ?? '').replace(/\\\//g, '/'));
			const topTrackUrls = [...new Set(cleanUrls)].slice(0, 5);

			const trackItems = topTrackUrls
				.map((link) => ({ link, trackId: extractAppleId(link) }))
				.filter((item): item is { link: string; trackId: string } => item.trackId !== null);

			const trackIds = trackItems.map((item) => item.trackId).join(',');
			const itunesResults = trackIds ? await fetchITunesRecords(trackIds) : [];

			let bestLink: string | null = null;
			let lowestMatchScore = Number.POSITIVE_INFINITY;

			for (const { link, trackId } of trackItems) {
				const data = itunesResults.find((result) => result.trackId.toString() === trackId);
				if (!data) continue;

				const itunesScore = distance(
					targetSignature,
					normalizeText(`${data.artistName} - ${data.collectionName}`),
				);

				let urlScore = 0;
				const slugMatch = link.match(/\/album\/([^/]+)\/\d+/);
				if (slugMatch) {
					urlScore = distance(normalizeText(song), normalizeText(slugMatch[1] ?? ''));
				}

				const matchScore = itunesScore + urlScore;
				if (matchScore < lowestMatchScore) {
					lowestMatchScore = matchScore;
					bestLink = link;
				}
			}

			return bestLink;
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
			// iTunes artist credits can carry commas, ampersands, and stylized characters
			// ("DILEX, Nightvi$ion & NVRVYN") that return zero results from Deezer's search
			// verbatim. Normalizing first matches the signature the ytMusic bridge already sends.
			const deezerMatch = await pickBestDeezerTrack(
				normalizeText(trackSignature(artistName, trackName)),
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

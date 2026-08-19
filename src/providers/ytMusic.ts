/**
 * YouTube Music provider.
 *
 * `ytmusic-api` is retained for search because its `/search` endpoint remains unauthenticated and
 * finds YT Music track URLs from track details reliably.
 *
 * Direct link lookups deliberately bypass `ytmusic.getSong()`: YouTube's internal `/player`
 * endpoint requires bot verification (LOGIN_REQUIRED). The public oEmbed endpoint is used instead
 * to recover the title and channel name, which are then bridged through Deezer for the ISRC.
 *
 * Both routes are best effort and degrade to null rather than throwing.
 */

import { distance } from 'fastest-levenshtein';
import YTMusic from 'ytmusic-api';
import { pickBestDeezerTrack } from '../deezerBridge.js';
import { Platform } from '../platform.js';
import { normalizeText, trackSignature } from '../text.js';
import type { FetchLike, Provider, ProviderOptions, TrackInfo } from '../types.js';

type YtOEmbedResponse = {
	title?: string;
	author_name?: string;
};

const YT_MUSIC_URL_PATTERN = /music\.youtube\.com\/watch\?v=/;

/** Extracts a video ID from a YouTube or YouTube Music URL. */
export const extractYtMusicId = (url: string): string | null => {
	try {
		const parsed = new URL(url);
		if (parsed.searchParams.has('v')) {
			return parsed.searchParams.get('v');
		}
		if (parsed.hostname === 'youtu.be') {
			return parsed.pathname.slice(1);
		}
	} catch {
		// Fall through to the regex when URL parsing fails
	}
	return url.match(/(?:v=|youtu\.be\/)([\w-]+)/)?.[1] ?? null;
};

/** YouTube Music needs no credentials. */
export const createYtMusicProvider = (options: ProviderOptions = {}) => {
	const fetchImpl: FetchLike = options.fetch ?? fetch;

	// Initialization performs a network round trip, so it is deferred and kept per instance.
	let clientPromise: Promise<YTMusic> | null = null;
	const getClient = (): Promise<YTMusic> => {
		if (!clientPromise) {
			clientPromise = (async () => {
				const client = new YTMusic();
				await client.initialize();
				return client;
			})().catch((error: unknown) => {
				// Do not cache a failed initialization; the next call should retry.
				clientPromise = null;
				throw error;
			});
		}
		return clientPromise;
	};

	/** Searches YouTube Music by artist + song and returns the closest match's canonical link. */
	const lookupYtMusicTrackByInfo = async (
		artist: string,
		song: string,
	): Promise<string | null> => {
		try {
			const ytmusic = await getClient();
			const results = await ytmusic.searchSongs(`${artist} ${song}`);
			if (results.length === 0) return null;

			const targetSignature = normalizeText(trackSignature(artist, song));

			let bestCandidate: (typeof results)[number] | null = null;
			let lowestScore = Number.POSITIVE_INFINITY;

			for (const candidate of results) {
				const score = distance(
					targetSignature,
					normalizeText(`${candidate.artist.name} - ${candidate.name}`),
				);
				if (score < lowestScore) {
					lowestScore = score;
					bestCandidate = candidate;
				}
			}

			if (!bestCandidate) return null;

			return `https://music.youtube.com/watch?v=${bestCandidate.videoId}`;
		} catch {
			return null;
		}
	};

	/** Resolves a YouTube Music link via oEmbed, then bridges to Deezer for the ISRC. */
	const lookupYtMusicTrackByLink = async (url: string): Promise<TrackInfo | null> => {
		const videoId = extractYtMusicId(url);
		if (!videoId) return null;

		try {
			const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
			const response = await fetchImpl(oembedUrl);
			if (!response.ok) return null;

			const data = (await response.json()) as YtOEmbedResponse;
			if (!data.title || !data.author_name) return null;

			// YouTube Topic channels format artist names as "Artist Name - Topic"
			const artistName = data.author_name.replace(/ - Topic$/, '').trim();
			const songTitle = data.title.trim();

			const deezerTrack = await pickBestDeezerTrack(
				normalizeText(trackSignature(artistName, songTitle)),
				fetchImpl,
			);
			if (!deezerTrack) return null;

			return {
				name: deezerTrack.name,
				artists: deezerTrack.artists,
				isrc: deezerTrack.isrc,
				link: url,
			};
		} catch {
			return null;
		}
	};

	const provider: Provider = {
		platform: Platform.YouTubeMusic,
		matches: (url) => YT_MUSIC_URL_PATTERN.test(url),
		fetchTrack: lookupYtMusicTrackByLink,
		findByTrack: async (track) => {
			const artist = track.artists[0];
			if (!artist || !track.name) return null;
			return lookupYtMusicTrackByInfo(artist, track.name);
		},
	};

	return { ...provider, lookupYtMusicTrackByInfo, lookupYtMusicTrackByLink };
};

export type YtMusicProvider = ReturnType<typeof createYtMusicProvider>;

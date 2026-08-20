import { Platform } from '../platform.js';
import type { FetchLike, Provider, ProviderOptions, TrackInfo } from '../types.js';

type DeezerTrack = {
	id: number;
	title: string;
	isrc: string;
	link: string;
	artist: {
		name: string;
	};
	error?: {
		type: string;
		message: string;
		code: number;
	};
};

export type DeezerTrackLookup = {
	id: number;
	name: string;
	artists: string[];
	isrc: string;
	link: string;
};

// Direct track links embed the numeric ID after /track/ (e.g., https://www.deezer.com/track/3135556)
const DIRECT_TRACK_ID_PATTERN = /(?:www\.)?deezer\.com\/(?:\w{2}\/)?track\/([0-9]+)/;

// Short share links (e.g., https://link.deezer.com/s/33HJubg3npxgAGfoCij0m) redirect to the full URL.
const SHORT_LINK_PATTERN = /link\.deezer\.com\/s\//;

/** True when the URL is a Deezer track link, including an unresolved short share link. */
export const isDeezerTrackUrl = (url: string): boolean =>
	DIRECT_TRACK_ID_PATTERN.test(url) || SHORT_LINK_PATTERN.test(url);

/** Deezer needs no credentials, so the provider is usable with no configuration at all. */
export const createDeezerProvider = (options: ProviderOptions = {}) => {
	const fetchImpl: FetchLike = options.fetch ?? fetch;

	/** Extracts a numeric Deezer track ID. Follows HEAD redirects for short share links. */
	const extractDeezerTrackId = async (url: string): Promise<string | null> => {
		const directMatch = url.match(DIRECT_TRACK_ID_PATTERN);
		if (directMatch) {
			return directMatch[1] ?? null;
		}

		if (SHORT_LINK_PATTERN.test(url)) {
			try {
				const response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' });
				if (!response.ok) return null;
				return response.url.match(DIRECT_TRACK_ID_PATTERN)?.[1] ?? null;
			} catch {
				return null;
			}
		}

		return null;
	};

	/** Fetches Deezer track info. Checks error objects because Deezer returns HTTP 200 on failures. */
	const fetchDeezerTrackInfo = async (trackId: string): Promise<TrackInfo | null> => {
		try {
			const response = await fetchImpl(`https://api.deezer.com/track/${trackId}`);
			if (!response.ok) return null;

			const track = (await response.json()) as DeezerTrack;
			// Deezer returns a 200 with an error body when the track isn't found
			if (track.error) return null;

			return {
				name: track.title,
				artists: [track.artist.name],
				isrc: track.isrc ?? null,
				link: track.link ?? null,
			};
		} catch {
			return null;
		}
	};

	/** Looks up a track by ISRC on Deezer. */
	const lookupDeezerTrackByIsrc = async (isrc: string): Promise<DeezerTrackLookup | null> => {
		try {
			const response = await fetchImpl(
				`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`,
			);
			if (!response.ok) return null;

			const track = (await response.json()) as DeezerTrack;
			// Deezer returns a 200 with an error body when the ISRC has no match
			if (track.error) return null;

			return {
				id: track.id,
				name: track.title,
				artists: [track.artist.name],
				isrc: track.isrc,
				link: `https://www.deezer.com/en/track/${track.id}`,
			};
		} catch {
			return null;
		}
	};

	const provider: Provider = {
		platform: Platform.Deezer,
		matches: isDeezerTrackUrl,
		extractId: extractDeezerTrackId,
		fetchTrack: async (url) => {
			const trackId = await extractDeezerTrackId(url);
			if (!trackId) return null;
			return fetchDeezerTrackInfo(trackId);
		},
		findByIsrc: async (isrc) => (await lookupDeezerTrackByIsrc(isrc))?.link ?? null,
	};

	return { ...provider, extractDeezerTrackId, fetchDeezerTrackInfo, lookupDeezerTrackByIsrc };
};

export type DeezerProvider = ReturnType<typeof createDeezerProvider>;

import { pickBestMatch } from './match.js';
import { normalizeText } from './text.js';
import type { FetchLike, TrackInfo } from './types.js';

type DeezerSearchTrack = {
	title: string;
	artist: { name: string };
	isrc?: string;
	link?: string;
};

type DeezerSearchResponse = {
	data?: DeezerSearchTrack[];
};

/**
 * Searches Deezer by artist and title and picks the closest match.
 *
 * Deezer is the project's ISRC oracle: Apple Music and YouTube Music expose no ISRC of their own,
 * so their metadata is matched against Deezer to obtain one. Without an ISRC a track cannot be
 * resolved onto other platforms at all, which makes this the load-bearing fallback.
 */
export const pickBestDeezerTrack = async (
	target: { artist: string; title: string },
	fetchImpl: FetchLike = fetch,
): Promise<TrackInfo | null> => {
	try {
		// Stylized artist names (e.g. "Nightvi$ion") return zero results from Deezer's search
		// verbatim, so the query itself is normalized, not just the candidates it's scored against.
		const query = normalizeText(`${target.artist} ${target.title}`);
		const deezerUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;
		const response = await fetchImpl(deezerUrl);
		if (!response.ok) return null;
		const json = (await response.json()) as DeezerSearchResponse;

		if (!Array.isArray(json.data) || json.data.length === 0) {
			return null;
		}

		const bestTrack = pickBestMatch(
			target,
			json.data,
			(track) => track.artist.name,
			(track) => track.title,
		);
		if (!bestTrack) return null;

		return {
			name: bestTrack.title,
			artists: [bestTrack.artist.name],
			isrc: bestTrack.isrc ?? null,
			link: bestTrack.link ?? null,
		};
	} catch {
		return null;
	}
};

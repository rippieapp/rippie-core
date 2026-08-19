import { distance } from 'fastest-levenshtein';
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
 * Searches Deezer by track signature and picks the closest match using Levenshtein distance.
 *
 * Deezer is the project's ISRC oracle: Apple Music and YouTube Music expose no ISRC of their own,
 * so their metadata is matched against Deezer to obtain one. Without an ISRC a track cannot be
 * resolved onto other platforms at all, which makes this the load-bearing fallback.
 */
export const pickBestDeezerTrack = async (
	targetSignature: string,
	fetchImpl: FetchLike = fetch,
): Promise<TrackInfo | null> => {
	try {
		const deezerUrl = `https://api.deezer.com/search?q=${encodeURIComponent(targetSignature)}`;
		const response = await fetchImpl(deezerUrl);
		if (!response.ok) return null;
		const json = (await response.json()) as DeezerSearchResponse;

		if (!Array.isArray(json.data) || json.data.length === 0) {
			return null;
		}

		const normalizedTarget = normalizeText(targetSignature);
		let bestTrack: DeezerSearchTrack | null = null;
		let lowestScore = Number.POSITIVE_INFINITY;

		for (const track of json.data) {
			const deezerSignature = normalizeText(`${track.artist.name} - ${track.title}`);
			const score = distance(normalizedTarget, deezerSignature);
			if (score < lowestScore) {
				lowestScore = score;
				bestTrack = track;
			}
		}

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

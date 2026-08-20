import { distance } from 'fastest-levenshtein';
import { normalizeText } from './text.js';

/**
 * Picks the candidate whose title is the closest match, breaking ties on artist closeness.
 *
 * Scoring title and artist as one combined string lets a coincidental artist-name collision
 * (an unrelated song by "Foo Unico") outscore the real match once the real match's artist credit
 * carries extra collaborators the target didn't mention (a platform crediting "A, B & C" where
 * the source platform only credited "A"). Comparing title first means a wrong-song candidate can
 * never win purely because its artist field happens to overlap; only candidates already tied for
 * the closest title get to compete on artist.
 */
export const pickBestMatch = <T>(
	target: { artist: string; title: string },
	candidates: T[],
	getArtist: (candidate: T) => string,
	getTitle: (candidate: T) => string,
): T | null => {
	if (candidates.length === 0) return null;

	const targetArtist = normalizeText(target.artist);
	const targetTitle = normalizeText(target.title);

	const scored = candidates.map((candidate) => ({
		candidate,
		titleScore: distance(targetTitle, normalizeText(getTitle(candidate))),
		artistScore: distance(targetArtist, normalizeText(getArtist(candidate))),
	}));

	const minTitleScore = Math.min(...scored.map((s) => s.titleScore));
	const titleFinalists = scored.filter((s) => s.titleScore === minTitleScore);
	titleFinalists.sort((a, b) => a.artistScore - b.artistScore);

	return titleFinalists[0]?.candidate ?? null;
};

import type { Platform } from './platform.js';
import type { Provider, ResolvedLinks, TrackInfo } from './types.js';

/**
 * Resolves platform links in parallel for a track across the given providers.
 *
 * Providers that expose ISRC search are preferred; the rest fall back to text matching on the
 * track's artist and title. A provider that can do neither is skipped entirely rather than
 * recorded as a miss, so an unsupported platform is never cached as "no link exists".
 */
export const resolveLinksFromTrack = async (
	providers: Provider[],
	track: TrackInfo,
): Promise<ResolvedLinks> => {
	const lookups = providers.flatMap((provider) => {
		if (track.isrc && provider.findByIsrc) {
			const { isrc } = track;
			const findByIsrc = provider.findByIsrc;
			return [{ provider, run: () => findByIsrc(isrc) }];
		}
		if (provider.findByTrack) {
			const findByTrack = provider.findByTrack;
			return [{ provider, run: () => findByTrack(track) }];
		}
		return [];
	});

	const outcomes = await Promise.allSettled(
		lookups.map(
			async ({ provider, run }): Promise<[Platform, string | null]> => [
				provider.platform,
				(await run()) ?? null,
			],
		),
	);

	const resolved: ResolvedLinks = new Map();
	for (const outcome of outcomes) {
		if (outcome.status === 'fulfilled') {
			const [platform, link] = outcome.value;
			resolved.set(platform, link);
		}
	}

	return resolved;
};

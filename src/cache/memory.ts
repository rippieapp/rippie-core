import type { TrackInfo } from '../types.js';
import {
	type CachedPlatformLinks,
	type CacheTtlOptions,
	DEFAULT_NEGATIVE_TTL_MS,
	DEFAULT_TTL_MS,
	type TrackCache,
} from './types.js';

type TrackEntry = { track: TrackInfo; expiresAt: number };
type LinksEntry = { links: CachedPlatformLinks; expiresAt: number };

/**
 * Process-local cache with no dependencies, used when no adapter is supplied.
 *
 * It implements exactly the same TTL contract as the SQLite adapter, including the rule that a
 * partial result's short expiry is never extended by a later partial retry. It is not durable:
 * a restart discards every entry. Use `@rippieapp/core/cache-sqlite` when that matters.
 */
export const createMemoryTrackCache = (options: CacheTtlOptions = {}): TrackCache => {
	const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
	const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
	const now = options.now ?? ((): number => Date.now());

	const tracks = new Map<string, TrackEntry>();
	const links = new Map<string, LinksEntry>();

	return {
		getTrack: (url) => {
			const entry = tracks.get(url);
			if (!entry || now() >= entry.expiresAt) return null;
			return entry.track;
		},

		setTrack: (url, track, ttlMs) => {
			const isIncomplete = track.isrc == null || track.link == null;
			const effectiveTtl = ttlMs ?? (isIncomplete ? negativeTtlMs : defaultTtlMs);
			tracks.set(url, { track, expiresAt: now() + effectiveTtl });
		},

		getLinks: (isrc) => {
			const entry = links.get(isrc);
			if (!entry || now() >= entry.expiresAt) return null;
			return new Map(entry.links);
		},

		setLinks: (isrc, incoming, ttlMs) => {
			const timestamp = now();
			const existing = links.get(isrc);
			const isExpired = !existing || timestamp >= existing.expiresAt;

			const merged: CachedPlatformLinks = isExpired ? new Map() : new Map(existing.links);
			for (const [platform, link] of incoming) merged.set(platform, link);

			const hasNull = [...merged.values()].some((link) => link == null);
			// Do not extend a temporary negative-result window during partial retries. Once every
			// platform resolves, replace that short window with the normal long-lived cache TTL.
			const expiresAt =
				ttlMs != null
					? timestamp + ttlMs
					: hasNull && existing && !isExpired
						? existing.expiresAt
						: timestamp + (hasNull ? negativeTtlMs : defaultTtlMs);

			links.set(isrc, { links: merged, expiresAt });
		},

		prune: () => {
			const timestamp = now();
			for (const [key, entry] of tracks) {
				if (timestamp >= entry.expiresAt) tracks.delete(key);
			}
			for (const [key, entry] of links) {
				if (timestamp >= entry.expiresAt) links.delete(key);
			}
		},
	};
};

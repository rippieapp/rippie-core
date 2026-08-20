import type { TrackInfo } from '../types.js';
import {
	type CachedPlatformLinks,
	type CacheTtlOptions,
	DEFAULT_NEGATIVE_TTL_MS,
	DEFAULT_TTL_MS,
	type TrackCache,
} from './types.js';

type TrackEntry = { track: TrackInfo; expiresAt: number };
type LinksEntry = { track: TrackInfo; links: CachedPlatformLinks; expiresAt: number };

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
			return { track: entry.track, links: new Map(entry.links) };
		},

		setLinks: (isrc, track, incoming, ttlMs) => {
			const timestamp = now();
			const existing = links.get(isrc);
			const isExpired = !existing || timestamp >= existing.expiresAt;

			const merged: CachedPlatformLinks = isExpired ? new Map() : new Map(existing.links);
			for (const [platform, link] of incoming) merged.set(platform, link);

			// Whether the entry was ALREADY partial before this merge, as opposed to merely
			// having a null in the merge result. A complete entry widened with one new miss
			// (e.g. a newly-enabled provider) must get a fresh negative TTL, not inherit the
			// long expiry it earned while complete.
			const wasAlreadyPartial =
				existing && !isExpired && [...existing.links.values()].some((link) => link == null);
			const hasNull = [...merged.values()].some((link) => link == null);
			// Preserve the existing expiry only when the retry is STILL partial — that is the
			// "don't extend a negative window" case. A retry that completes a partial entry, or
			// a complete entry gaining a fresh miss, both fall through to a freshly computed TTL.
			const expiresAt =
				ttlMs != null
					? timestamp + ttlMs
					: wasAlreadyPartial && hasNull && existing
						? existing.expiresAt
						: timestamp + (hasNull ? negativeTtlMs : defaultTtlMs);

			links.set(isrc, { track, links: merged, expiresAt });
		},

		findIsrcByLink: (platform, link) => {
			const timestamp = now();
			// A process-local map is expected to stay small enough that a scan is cheap next to
			// the network call it replaces; the SQLite adapter carries the indexed version.
			for (const [isrc, entry] of links) {
				if (timestamp >= entry.expiresAt) continue;
				if (entry.links.get(platform) === link) return isrc;
			}
			return null;
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

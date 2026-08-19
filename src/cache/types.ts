import type { Platform } from '../platform.js';
import type { Awaitable, TrackInfo } from '../types.js';

/** Resolved platform links, where null represents a cacheable lookup miss. */
export type CachedPlatformLinks = Map<Platform, string | null>;

/**
 * How long cache entries live.
 *
 * A complete result — every requested platform resolved to a real link — is stable and can be kept
 * for a long time. A partial or failed result is usually a transient upstream problem, so it gets a
 * short window and is retried soon after.
 */
export type CacheTtlOptions = {
	/** Retention for fully resolved entries. Defaults to 30 days. */
	defaultTtlMs?: number;
	/** Retention for entries containing a null link. Defaults to 5 minutes. */
	negativeTtlMs?: number;
	/** Injectable clock, primarily for tests. */
	now?: () => number;
};

export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_NEGATIVE_TTL_MS = 5 * 60 * 1000;

/**
 * The two-layer cache the resolution pipeline depends on.
 *
 * Layer 1 keys source URLs to the track they describe, so a repeated link skips its origin API.
 * Layer 2 keys ISRCs to cross-platform links, so the same song posted from a different platform
 * reuses the work.
 *
 * Every method may be synchronous or asynchronous, so remote stores are implementable.
 */
export type TrackCache = {
	getTrack: (url: string) => Awaitable<TrackInfo | null>;
	setTrack: (url: string, track: TrackInfo, ttlMs?: number) => Awaitable<void>;
	getLinks: (isrc: string) => Awaitable<CachedPlatformLinks | null>;
	setLinks: (isrc: string, links: CachedPlatformLinks, ttlMs?: number) => Awaitable<void>;
	/** Removes expired entries. Called periodically by `startPruning`. */
	prune: () => Awaitable<void>;
};

/** Resolves the TTL for a set of links, applying the negative window when any link is missing. */
export const ttlForLinks = (
	links: Iterable<string | null>,
	defaultTtlMs: number,
	negativeTtlMs: number,
): number => ([...links].some((link) => link == null) ? negativeTtlMs : defaultTtlMs);

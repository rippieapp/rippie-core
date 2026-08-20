import type { Platform } from '../platform.js'
import type { Awaitable, TrackInfo } from '../types.js'

/** Resolved platform links, where null represents a cacheable lookup miss. */
export type CachedPlatformLinks = Map<Platform, string | null>

/**
 * How long cache entries live.
 *
 * A complete result (every requested platform resolved to a real link) is stable and can be kept
 * for a long time. A partial or failed result is usually a transient upstream problem, so it gets a
 * short window and is retried soon after.
 */
export type CacheTtlOptions = {
	/** Retention for fully resolved entries. Defaults to 30 days. */
	defaultTtlMs?: number
	/** Retention for entries containing a null link. Defaults to 5 minutes. */
	negativeTtlMs?: number
	/** Injectable clock, primarily for tests. */
	now?: () => number
}

export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_NEGATIVE_TTL_MS = 5 * 60 * 1000

/** A track's identity, plus every cross-platform link known for it. */
export type ResolvedTrack = {
	track: TrackInfo
	links: CachedPlatformLinks
}

/**
 * The two-layer cache the resolution pipeline depends on.
 *
 * Layer 1 keys a track's identity (its canonical id when the provider supports one, its exact
 * URL otherwise) to the track it describes, so a repeated link skips its origin API.
 *
 * Layer 2 keys an ISRC to the track's own metadata plus its cross-platform links, so the same
 * song posted from a different platform reuses the work, and `findIsrcByLink` lets that reuse
 * happen even on the very first time a given link is seen, if some other platform already
 * discovered this exact link as one of its results.
 *
 * Every method may be synchronous or asynchronous, so remote stores are implementable.
 */
export type TrackCache = {
	getTrack: (key: string) => Awaitable<TrackInfo | null>
	setTrack: (key: string, track: TrackInfo, ttlMs?: number) => Awaitable<void>
	getLinks: (isrc: string) => Awaitable<ResolvedTrack | null>
	setLinks: (
		isrc: string,
		track: TrackInfo,
		links: CachedPlatformLinks,
		ttlMs?: number,
	) => Awaitable<void>
	/** Finds the ISRC already known for a specific platform's link, if any is cached and unexpired. */
	findIsrcByLink: (platform: Platform, link: string) => Awaitable<string | null>
	/** Removes expired entries. Called periodically by `startPruning`. */
	prune: () => Awaitable<void>
}

import type { Platform } from './platform.js'

/** Values that an adapter may return either synchronously or as a promise. */
export type Awaitable<T> = T | Promise<T>

/** The subset of the global `fetch` signature every provider depends on. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Normalized track data shared across all streaming platform lookups. */
export type TrackInfo = {
	name: string
	artists: string[]
	isrc: string | null
	link: string | null
}

/** Map of platform names to resolved track URLs, where null is a completed lookup miss. */
export type ResolvedLinks = Map<Platform, string | null>

/**
 * One streaming platform's integration.
 *
 * A provider both reads its own links (`fetchTrack`) and answers lookups from other platforms.
 * Platforms that expose ISRC search implement `findByIsrc`. The rest fall back to `findByTrack`,
 * which matches on artist and title text.
 */
export type Provider = {
	platform: Platform
	/** True when this provider recognizes the URL as one of its own track links. */
	matches: (url: string) => boolean
	/** Resolves one of this provider's own links into normalized track data. */
	fetchTrack: (url: string) => Promise<TrackInfo | null>
	/** Finds this platform's link for a track identified by ISRC. */
	findByIsrc?: (isrc: string) => Promise<string | null>
	/** Finds this platform's link by matching artist and title text. */
	findByTrack?: (track: TrackInfo) => Promise<string | null>
	/**
	 * Extracts this provider's own stable per-track id from one of its links (the numeric
	 * Spotify/Tidal/Apple id, the Deezer track id, the YouTube video id). Combined with
	 * `platform` this becomes the cache key, so a link with query-string or storefront
	 * variation still hits the same cache entry, and a link already known as a resolved target
	 * on another platform is found before any provider is called at all.
	 *
	 * Optional: a provider that omits this still works, just without those two benefits. Its
	 * links are cached by their exact URL string instead.
	 */
	extractId?: (url: string) => Awaitable<string | null>
}

/** Options every provider factory accepts. */
export type ProviderOptions = {
	/** Injected for testing or for runtimes that need a custom fetch implementation. */
	fetch?: FetchLike
}

/** Client credentials for the two platforms that require them. */
export type ClientCredentials = {
	clientId: string
	clientSecret: string
}

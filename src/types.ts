import type { Platform } from './platform.js';

/** Values that an adapter may return either synchronously or as a promise. */
export type Awaitable<T> = T | Promise<T>;

/** The subset of the global `fetch` signature every provider depends on. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Normalized track data shared across all streaming platform lookups. */
export type TrackInfo = {
	name: string;
	artists: string[];
	isrc: string | null;
	link: string | null;
};

/** Map of platform names to resolved track URLs, where null is a completed lookup miss. */
export type ResolvedLinks = Map<Platform, string | null>;

/**
 * One streaming platform's integration.
 *
 * A provider both reads its own links (`fetchTrack`) and answers lookups from other platforms.
 * Platforms that expose ISRC search implement `findByIsrc`; the rest fall back to `findByTrack`,
 * which matches on artist and title text.
 */
export type Provider = {
	platform: Platform;
	/** True when this provider recognizes the URL as one of its own track links. */
	matches: (url: string) => boolean;
	/** Resolves one of this provider's own links into normalized track data. */
	fetchTrack: (url: string) => Promise<TrackInfo | null>;
	/** Finds this platform's link for a track identified by ISRC. */
	findByIsrc?: (isrc: string) => Promise<string | null>;
	/** Finds this platform's link by matching artist and title text. */
	findByTrack?: (track: TrackInfo) => Promise<string | null>;
};

/** Options every provider factory accepts. */
export type ProviderOptions = {
	/** Injected for testing or for runtimes that need a custom fetch implementation. */
	fetch?: FetchLike;
};

/** Client credentials for the two platforms that require them. */
export type ClientCredentials = {
	clientId: string;
	clientSecret: string;
};

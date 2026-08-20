import { createMemoryTrackCache } from './cache/memory.js';
import type { CachedPlatformLinks, TrackCache } from './cache/types.js';
import { detectMusicPlatform, Platform } from './platform.js';
import { createAppleMusicProvider } from './providers/appleMusic.js';
import { createDeezerProvider } from './providers/deezer.js';
import { createSpotifyProvider } from './providers/spotify.js';
import { createTidalProvider } from './providers/tidal.js';
import { createYtMusicProvider } from './providers/ytMusic.js';
import { resolveLinksFromTrack } from './resolver.js';
import type { ClientCredentials, FetchLike, Provider, ResolvedLinks, TrackInfo } from './types.js';

export type RippieOptions = {
	/** Spotify Web API client credentials. Omit to disable Spotify. */
	spotify?: ClientCredentials;
	/** Tidal open API client credentials. Omit to disable Tidal. */
	tidal?: ClientCredentials & { countryCode?: string };
	/** Where to persist lookups. Defaults to an in-memory cache. */
	cache?: TrackCache;
	/**
	 * Restricts which built-in platforms are constructed. Defaults to all that are configured.
	 * Providers passed via `providers` are always included regardless of this list.
	 */
	enabled?: Platform[];
	/** Extra or replacement providers, matched to built-ins by platform name. */
	providers?: Provider[];
	/** Injected for testing or for runtimes that need a custom fetch implementation. */
	fetch?: FetchLike;
};

export type ResolveOptions = {
	/** Platforms to resolve links for. Defaults to every configured platform. */
	platforms?: Platform[];
};

/**
 * The outcome of resolving one link.
 *
 * The three states are distinguished explicitly so callers branch on a tag rather than on which
 * fields happen to be null.
 */
export type ResolveResult =
	/** The URL was not a recognized track link, or its platform could not be read. */
	| { status: 'unresolved'; source: Platform | null }
	/** The track was identified but carries no ISRC, so no other platform can be searched. */
	| { status: 'no-isrc'; source: Platform; track: TrackInfo }
	/** The track resolved; `links` holds one entry per requested platform that answered. */
	| { status: 'ok'; source: Platform; track: TrackInfo; links: ResolvedLinks };

const PRUNE_INTERVAL_MS = 60_000;

/**
 * Builds a configured client over the provider set.
 *
 * Deezer, Apple Music, and YouTube Music are always enabled because they need no credentials.
 * Spotify and Tidal appear only when their credentials are supplied.
 */
export const createRippie = (options: RippieOptions = {}) => {
	const fetchImpl = options.fetch;
	const cache = options.cache ?? createMemoryTrackCache();

	const allowed = options.enabled ? new Set(options.enabled) : null;
	const isEnabled = (platform: Platform): boolean => allowed === null || allowed.has(platform);

	const builtIn: Provider[] = [];
	if (isEnabled(Platform.Deezer)) builtIn.push(createDeezerProvider({ fetch: fetchImpl }));
	if (isEnabled(Platform.AppleMusic)) {
		builtIn.push(createAppleMusicProvider({ fetch: fetchImpl }));
	}
	if (isEnabled(Platform.YouTubeMusic)) {
		builtIn.push(createYtMusicProvider({ fetch: fetchImpl }));
	}
	if (options.spotify && isEnabled(Platform.Spotify)) {
		builtIn.push(createSpotifyProvider({ ...options.spotify, fetch: fetchImpl }));
	}
	if (options.tidal && isEnabled(Platform.Tidal)) {
		builtIn.push(createTidalProvider({ ...options.tidal, fetch: fetchImpl }));
	}

	// A supplied provider replaces the built-in for the same platform rather than duplicating it.
	const byPlatform = new Map<Platform, Provider>(
		builtIn.map((provider) => [provider.platform, provider]),
	);
	for (const provider of options.providers ?? []) {
		byPlatform.set(provider.platform, provider);
	}

	const providers = [...byPlatform.values()];
	const availablePlatforms = [...byPlatform.keys()];

	/** Detects which platform a URL belongs to, or null when it is not a track link. */
	const detect = (url: string): Platform | null => detectMusicPlatform(url);

	/** Reads a source link into normalized track data, using layer 1 of the cache. */
	const fetchTrack = async (url: string, platform?: Platform): Promise<TrackInfo | null> => {
		const cached = await cache.getTrack(url);
		if (cached) return cached;

		const provider = platform
			? byPlatform.get(platform)
			: providers.find((candidate) => candidate.matches(url));
		if (!provider) return null;

		const track = await provider.fetchTrack(url);
		if (track) await cache.setTrack(url, track);
		return track;
	};

	/**
	 * Resolves a source link into the same track on other platforms.
	 *
	 * Layer 1 avoids re-reading the source link; layer 2 avoids re-searching platforms already
	 * known for this ISRC. Only platforms missing from the cache are queried, and the source
	 * platform's own link is folded back in so a later request from a different platform hits.
	 */
	const resolve = async (
		url: string,
		resolveOptions: ResolveOptions = {},
	): Promise<ResolveResult> => {
		const source = detect(url);
		if (!source) return { status: 'unresolved', source: null };

		const track = await fetchTrack(url, source);
		if (!track) return { status: 'unresolved', source };
		if (!track.isrc) return { status: 'no-isrc', source, track };

		const { isrc } = track;
		const requested = (resolveOptions.platforms ?? availablePlatforms).filter(
			(platform) => platform !== source && byPlatform.has(platform),
		);

		// Seed the source platform's own link so it is cached alongside the resolved ones.
		const sourceLinks: CachedPlatformLinks = new Map();
		if (track.link) sourceLinks.set(source, track.link);

		const cached = await cache.getLinks(isrc);
		const links: ResolvedLinks = new Map();
		const missing: Platform[] = [];

		for (const platform of requested) {
			if (cached?.has(platform)) {
				const link = cached.get(platform);
				if (link) links.set(platform, link);
			} else {
				missing.push(platform);
			}
		}

		if (missing.length > 0) {
			const missingProviders = missing
				.map((platform) => byPlatform.get(platform))
				.filter((provider): provider is Provider => provider !== undefined);
			const resolved = await resolveLinksFromTrack(missingProviders, track);

			const payload: CachedPlatformLinks = new Map(sourceLinks);
			for (const [platform, link] of resolved) {
				payload.set(platform, link);
				if (link) links.set(platform, link);
			}
			await cache.setLinks(isrc, payload);
		} else if (sourceLinks.size > 0) {
			await cache.setLinks(isrc, sourceLinks);
		}

		return { status: 'ok', source, track, links };
	};

	/**
	 * Starts periodic removal of expired cache entries.
	 *
	 * The timer is unreferenced so it never keeps a process alive on its own. Returns a stop
	 * function for tests and short-lived runtimes.
	 */
	const startPruning = (intervalMs: number = PRUNE_INTERVAL_MS): (() => void) => {
		const timer = setInterval(() => {
			try {
				// A user-supplied async cache adapter can reject; `Promise.resolve` normalizes
				// both that and a synchronous return so the same catch covers both. A rejection
				// or throw here must not crash the host process over a routine cleanup tick.
				Promise.resolve(cache.prune()).catch((error: unknown) => {
					console.error('rippie: cache prune failed', error);
				});
			} catch (error) {
				console.error('rippie: cache prune failed', error);
			}
		}, intervalMs);
		(timer as { unref?: () => void }).unref?.();
		return () => clearInterval(timer);
	};

	return { detect, fetchTrack, resolve, startPruning, cache, providers, availablePlatforms };
};

export type Rippie = ReturnType<typeof createRippie>;

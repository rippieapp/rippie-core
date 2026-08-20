export { createMemoryTrackCache } from './cache/memory.js'
export {
	type CachedPlatformLinks,
	type CacheTtlOptions,
	DEFAULT_NEGATIVE_TTL_MS,
	DEFAULT_TTL_MS,
	type ResolvedTrack,
	type TrackCache,
} from './cache/types.js'
export { pickBestDeezerTrack } from './deezerBridge.js'
export {
	createRippie,
	type ResolveOptions,
	type ResolveResult,
	type Rippie,
	type RippieOptions,
} from './pipeline.js'
export { detectMusicPlatform, Platform } from './platform.js'
export {
	type AppleMusicProvider,
	createAppleMusicProvider,
} from './providers/appleMusic.js'
export {
	createDeezerProvider,
	type DeezerProvider,
	type DeezerTrackLookup,
	isDeezerTrackUrl,
} from './providers/deezer.js'
export {
	createSpotifyProvider,
	extractSpotifyTrackId,
	type SpotifyProvider,
	type SpotifyProviderOptions,
	type SpotifyTrackLookup,
} from './providers/spotify.js'
export {
	createTidalProvider,
	extractTidalTrackId,
	type TidalProvider,
	type TidalProviderOptions,
	type TidalTrackLookup,
} from './providers/tidal.js'
export {
	createYtMusicProvider,
	extractYtMusicId,
	type YtMusicProvider,
} from './providers/ytMusic.js'
export { resolveLinksFromTrack } from './resolver.js'
export { normalizeText, trackSignature } from './text.js'
export type {
	Awaitable,
	ClientCredentials,
	FetchLike,
	Provider,
	ProviderOptions,
	ResolvedLinks,
	TrackInfo,
} from './types.js'

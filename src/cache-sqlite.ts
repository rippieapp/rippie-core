/**
 * Durable SQLite cache adapter.
 *
 * Split into its own entry point so `drizzle-orm` stays an optional peer dependency and the main
 * entry point remains runtime-neutral.
 */

export { CACHE_TABLES_SQL } from './cache/sqlite/ddl.js'
export {
	createSqliteTrackCache,
	type SqliteDatabase,
	type SqliteTrackCacheOptions,
} from './cache/sqlite/repository.js'
export {
	cacheSchema,
	resolvedLinkCache,
	resolvedLinkCacheLinks,
	trackCache,
} from './cache/sqlite/schema.js'
export type { CachedPlatformLinks, CacheTtlOptions, TrackCache } from './cache/types.js'

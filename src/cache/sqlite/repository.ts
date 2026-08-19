import { and, eq, gt, lte } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { Platform } from '../../platform.js';
import type { TrackInfo } from '../../types.js';
import {
	type CachedPlatformLinks,
	type CacheTtlOptions,
	DEFAULT_NEGATIVE_TTL_MS,
	DEFAULT_TTL_MS,
	type TrackCache,
} from '../types.js';
import { resolvedLinkCache, resolvedLinkCacheLinks, trackCache } from './schema.js';

/**
 * Any synchronous drizzle SQLite database.
 *
 * Typed against the shared base rather than a driver-specific alias so `drizzle-orm/bun-sqlite`,
 * `drizzle-orm/better-sqlite3`, and `drizzle-orm/libsql` (sync mode) all satisfy it. The adapter
 * never opens a connection itself, which is what keeps this package free of a runtime-specific
 * SQLite import.
 */
// biome-ignore lint/suspicious/noExplicitAny: drizzle's base type is generic over driver internals.
export type SqliteDatabase = BaseSQLiteDatabase<'sync', any, any>;

export type SqliteTrackCacheOptions = CacheTtlOptions & {
	db: SqliteDatabase;
};

const parseArtists = (artistsJson: string): string[] => {
	const artists: unknown = JSON.parse(artistsJson);
	if (!Array.isArray(artists) || !artists.every((artist) => typeof artist === 'string')) {
		throw new Error('Cached track artists are invalid.');
	}
	return artists;
};

/**
 * Creates a durable SQLite-backed cache.
 *
 * Entries survive a restart, so a process crash does not discard successful or negative lookup
 * results. The caller owns the database handle and its migrations; see the package README for the
 * three tables this adapter expects.
 */
export const createSqliteTrackCache = (options: SqliteTrackCacheOptions): TrackCache => {
	const { db } = options;
	const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
	const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
	const now = options.now ?? ((): number => Date.now());

	const getLinks = (isrc: string): CachedPlatformLinks | null => {
		const cacheEntry = db
			.select()
			.from(resolvedLinkCache)
			.where(and(eq(resolvedLinkCache.isrc, isrc), gt(resolvedLinkCache.expiresAt, now())))
			.get();
		if (!cacheEntry) return null;

		const links = db
			.select()
			.from(resolvedLinkCacheLinks)
			.where(eq(resolvedLinkCacheLinks.isrc, isrc))
			.all();
		return new Map(links.map(({ platform, link }) => [platform as Platform, link]));
	};

	return {
		getTrack: (url) => {
			const row = db
				.select()
				.from(trackCache)
				.where(and(eq(trackCache.sourceUrl, url), gt(trackCache.expiresAt, now())))
				.get();
			if (!row) return null;

			return {
				name: row.trackName,
				artists: parseArtists(row.artistsJson),
				isrc: row.isrc,
				link: row.link,
			};
		},

		setTrack: (url: string, track: TrackInfo, ttlMs?: number) => {
			const isIncomplete = track.isrc == null || track.link == null;
			const effectiveTtl = ttlMs ?? (isIncomplete ? negativeTtlMs : defaultTtlMs);
			const values = {
				sourceUrl: url,
				trackName: track.name,
				artistsJson: JSON.stringify(track.artists),
				isrc: track.isrc,
				link: track.link,
				expiresAt: now() + effectiveTtl,
			};
			db.insert(trackCache)
				.values(values)
				.onConflictDoUpdate({ target: trackCache.sourceUrl, set: values })
				.run();
		},

		getLinks,

		setLinks: (isrc: string, incoming: CachedPlatformLinks, ttlMs?: number) => {
			const timestamp = now();
			db.transaction((transaction) => {
				const existing = transaction
					.select()
					.from(resolvedLinkCache)
					.where(eq(resolvedLinkCache.isrc, isrc))
					.get();
				const isExpired = !existing || timestamp >= existing.expiresAt;
				if (isExpired && existing) {
					transaction
						.delete(resolvedLinkCache)
						.where(eq(resolvedLinkCache.isrc, isrc))
						.run();
				}

				const merged: CachedPlatformLinks = isExpired
					? new Map()
					: (getLinks(isrc) ?? new Map());
				for (const [platform, link] of incoming) merged.set(platform, link);

				const hasNull = [...merged.values()].some((link) => link == null);
				// Do not extend a temporary negative-result window during partial retries. Once
				// every platform resolves, replace that short window with the normal cache TTL.
				const expiresAt =
					ttlMs != null
						? timestamp + ttlMs
						: hasNull && existing && !isExpired
							? existing.expiresAt
							: timestamp + (hasNull ? negativeTtlMs : defaultTtlMs);

				transaction
					.insert(resolvedLinkCache)
					.values({ isrc, expiresAt })
					.onConflictDoUpdate({ target: resolvedLinkCache.isrc, set: { expiresAt } })
					.run();
				for (const [platform, link] of merged) {
					transaction
						.insert(resolvedLinkCacheLinks)
						.values({ isrc, platform, link })
						.onConflictDoUpdate({
							target: [resolvedLinkCacheLinks.isrc, resolvedLinkCacheLinks.platform],
							set: { link },
						})
						.run();
				}
			});
		},

		prune: () => {
			const timestamp = now();
			db.delete(trackCache).where(lte(trackCache.expiresAt, timestamp)).run();
			db.delete(resolvedLinkCache).where(lte(resolvedLinkCache.expiresAt, timestamp)).run();
		},
	};
};

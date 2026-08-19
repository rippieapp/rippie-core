import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Source-link metadata cache; artists are JSON because SQLite has no native string-array type. */
export const trackCache = sqliteTable('track_cache', {
	sourceUrl: text('source_url').primaryKey(),
	trackName: text('track_name').notNull(),
	artistsJson: text('artists_json').notNull(),
	isrc: text('isrc'),
	link: text('link'),
	expiresAt: integer('expires_at').notNull(),
});

/** Expiry metadata for an ISRC's complete or partial cross-platform resolution. */
export const resolvedLinkCache = sqliteTable('resolved_link_cache', {
	isrc: text('isrc').primaryKey(),
	expiresAt: integer('expires_at').notNull(),
});

/** Individual platform links belonging to a resolved ISRC cache entry. */
export const resolvedLinkCacheLinks = sqliteTable(
	'resolved_link_cache_links',
	{
		isrc: text('isrc')
			.notNull()
			.references(() => resolvedLinkCache.isrc, { onDelete: 'cascade' }),
		platform: text('platform').notNull(),
		link: text('link'),
	},
	(table) => [primaryKey({ columns: [table.isrc, table.platform] })],
);

/** Every table this adapter owns, for consumers wiring it into their own drizzle schema. */
export const cacheSchema = { trackCache, resolvedLinkCache, resolvedLinkCacheLinks };

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Cache key to track lookup.
 *
 * The key is a provider's canonical id (`platform:id`) when the provider supports one, or the
 * exact posted URL otherwise — either way it is a stable identity, not necessarily the literal
 * link text, despite the column name kept for migration compatibility.
 */
export const trackCache = sqliteTable('track_cache', {
	sourceUrl: text('source_url').primaryKey(),
	trackName: text('track_name').notNull(),
	artistsJson: text('artists_json').notNull(),
	isrc: text('isrc'),
	link: text('link'),
	expiresAt: integer('expires_at').notNull(),
});

/**
 * One row per ISRC: the track's own identity plus the expiry governing its cross-platform
 * resolution. Storing the track here too — not only in `trackCache` — is what lets a link
 * already known as one of this ISRC's resolved targets answer without calling any provider.
 */
export const resolvedLinkCache = sqliteTable('resolved_link_cache', {
	isrc: text('isrc').primaryKey(),
	trackName: text('track_name').notNull(),
	artistsJson: text('artists_json').notNull(),
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
	(table) => [
		primaryKey({ columns: [table.isrc, table.platform] }),
		// Backs the reverse lookup: given a platform and a link, which ISRC already resolved to it.
		index('resolved_link_cache_links_platform_link_idx').on(table.platform, table.link),
	],
);

/** Every table this adapter owns, for consumers wiring it into their own drizzle schema. */
export const cacheSchema = { trackCache, resolvedLinkCache, resolvedLinkCacheLinks };

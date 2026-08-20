/**
 * The tables the SQLite adapter expects, as plain DDL.
 *
 * Consumers already running drizzle should fold `cacheSchema` into their own schema and let
 * `drizzle-kit` generate migrations. This constant exists for everyone else: it is the exact
 * output `drizzle-kit` produces for `schema.ts`, so both routes converge on the same tables.
 */
export const CACHE_TABLES_SQL: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS \`resolved_link_cache\` (
	\`isrc\` text PRIMARY KEY NOT NULL,
	\`track_name\` text NOT NULL,
	\`artists_json\` text NOT NULL,
	\`expires_at\` integer NOT NULL
)`,
	`CREATE TABLE IF NOT EXISTS \`resolved_link_cache_links\` (
	\`isrc\` text NOT NULL,
	\`platform\` text NOT NULL,
	\`link\` text,
	PRIMARY KEY(\`isrc\`, \`platform\`),
	FOREIGN KEY (\`isrc\`) REFERENCES \`resolved_link_cache\`(\`isrc\`) ON UPDATE no action ON DELETE cascade
)`,
	'CREATE INDEX IF NOT EXISTS `resolved_link_cache_links_platform_link_idx` ON `resolved_link_cache_links` (`platform`,`link`)',
	`CREATE TABLE IF NOT EXISTS \`track_cache\` (
	\`source_url\` text PRIMARY KEY NOT NULL,
	\`track_name\` text NOT NULL,
	\`artists_json\` text NOT NULL,
	\`isrc\` text,
	\`link\` text,
	\`expires_at\` integer NOT NULL
)`,
];

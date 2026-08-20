/**
 * Durable caching with the SQLite adapter.
 *
 * Run it twice against the same link: the second run answers from `rippie-core-example.sqlite`
 * without touching any upstream API.
 *
 * Usage:
 *   bun run examples/sqliteCache.ts <track-url>
 */

import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { CACHE_TABLES_SQL, createSqliteTrackCache } from '../src/cache-sqlite.js'
import { createRippie } from '../src/index.js'

const url = process.argv[2]
if (!url) {
	console.error('Usage: bun run examples/sqliteCache.ts <track-url>')
	process.exit(1)
}

// The adapter never opens a connection itself, which is what keeps the package runtime-neutral.
// Swap bun:sqlite for better-sqlite3 and nothing else changes.
const database = new Database('rippie-core-example.sqlite', { create: true, strict: true })
database.run('PRAGMA foreign_keys = ON')
database.run('PRAGMA journal_mode = WAL')
for (const statement of CACHE_TABLES_SQL) database.run(statement)

const rippie = createRippie({
	cache: createSqliteTrackCache({ db: drizzle({ client: database }) }),
})

const started = performance.now()
const result = await rippie.resolve(url)
const elapsed = Math.round(performance.now() - started)

if (result.status === 'ok') {
	console.log(`${result.track.name} - ${result.track.artists.join(', ')}`)
	for (const [platform, link] of result.links) {
		console.log(`${platform.padEnd(15)} ${link}`)
	}
} else {
	console.log(result.status)
}

console.log(`\nResolved in ${elapsed}ms. Run again to see the cached path.`)
database.close()

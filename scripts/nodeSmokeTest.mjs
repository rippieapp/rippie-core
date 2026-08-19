/**
 * Off-Bun smoke test.
 *
 * Run from a directory that has the packed tarball installed as `@rippieapp/core`:
 *
 *   npm pack --pack-destination /tmp
 *   mkdir /tmp/consumer && cd /tmp/consumer
 *   echo '{ "name": "consumer", "type": "module", "private": true }' > package.json
 *   npm install /tmp/rippieapp-core-*.tgz drizzle-orm
 *   node <path-to-repo>/scripts/nodeSmokeTest.mjs
 *
 * It exercises the published entry points rather than the source tree, so it catches a broken
 * `exports` map, a missing `files` entry, or an emitted import that Node cannot resolve.
 */

import assert from 'node:assert/strict';
import {
	createMemoryTrackCache,
	createRippie,
	detectMusicPlatform,
	normalizeText,
	Platform,
} from '@rippieapp/core';

// Pure helpers.
assert.equal(detectMusicPlatform('https://open.spotify.com/track/abc123'), Platform.Spotify);
assert.equal(detectMusicPlatform('https://example.com/x'), null);
assert.equal(normalizeText('Song (Official Video)'), 'song');

// The memory cache honors its TTL contract.
let clock = 0;
const cache = createMemoryTrackCache({ now: () => clock, defaultTtlMs: 1000 });
cache.setTrack('u', { name: 'T', artists: ['A'], isrc: 'I', link: 'L' });
assert.ok(cache.getTrack('u'));
clock = 1000;
assert.equal(cache.getTrack('u'), null);

// The full pipeline runs against stub providers, so nothing here touches the network.
const rippie = createRippie({
	cache: createMemoryTrackCache(),
	enabled: [],
	providers: [
		{
			platform: Platform.Spotify,
			matches: () => true,
			fetchTrack: async () => ({
				name: 'Track',
				artists: ['Artist'],
				isrc: 'ISRC1',
				link: 'https://open.spotify.com/track/abc123',
			}),
		},
		{
			platform: Platform.Deezer,
			matches: () => false,
			fetchTrack: async () => null,
			findByIsrc: async () => 'https://www.deezer.com/en/track/1',
		},
	],
});

const result = await rippie.resolve('https://open.spotify.com/track/abc123');
assert.equal(result.status, 'ok');
assert.equal(result.links.get(Platform.Deezer), 'https://www.deezer.com/en/track/1');

// The optional subpath resolves and exposes its DDL.
const { CACHE_TABLES_SQL, createSqliteTrackCache } = await import('@rippieapp/core/cache-sqlite');
assert.equal(CACHE_TABLES_SQL.length, 3);
assert.equal(typeof createSqliteTrackCache, 'function');

console.log(`OK on Node ${process.version}`);

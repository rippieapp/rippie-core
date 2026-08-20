import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { createMemoryTrackCache } from '../src/cache/memory.js';
import { CACHE_TABLES_SQL } from '../src/cache/sqlite/ddl.js';
import { createSqliteTrackCache } from '../src/cache/sqlite/repository.js';
import type { CacheTtlOptions, TrackCache } from '../src/cache/types.js';
import { Platform } from '../src/platform.js';
import type { TrackInfo } from '../src/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL = 30 * DAY_MS;
const NEGATIVE_TTL = 5 * 60 * 1000;

const COMPLETE_TRACK: TrackInfo = {
	name: 'Track',
	artists: ['Artist', 'Other Artist'],
	isrc: 'ISRC1',
	link: 'https://example.test/link',
};

const openSqliteDatabase = () => {
	const database = new Database(':memory:', { create: true, strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const statement of CACHE_TABLES_SQL) database.run(statement);
	return database;
};

const sqliteDatabases: Database[] = [];

afterAll(() => {
	for (const database of sqliteDatabases) database.close();
});

/**
 * Both adapters must be interchangeable, so every behavioral test runs against both.
 * A clock is injected rather than waiting on real time.
 */
const adapters: { name: string; create: (options: CacheTtlOptions) => TrackCache }[] = [
	{ name: 'memory', create: (options) => createMemoryTrackCache(options) },
	{
		name: 'sqlite',
		create: (options) => {
			const database = openSqliteDatabase();
			sqliteDatabases.push(database);
			return createSqliteTrackCache({ db: drizzle({ client: database }), ...options });
		},
	},
];

for (const adapter of adapters) {
	describe(`TrackCache conformance (${adapter.name})`, () => {
		const build = (): { cache: TrackCache; setTime: (value: number) => void } => {
			let timestamp = 0;
			const cache = adapter.create({ now: () => timestamp });
			return {
				cache,
				setTime: (value) => {
					timestamp = value;
				},
			};
		};

		test('returns null for entries that were never written', async () => {
			const { cache } = build();
			expect(await cache.getTrack('https://example.test/missing')).toBeNull();
			expect(await cache.getLinks('NOPE')).toBeNull();
		});

		test('round-trips a track including its artist array', async () => {
			const { cache } = build();
			await cache.setTrack('https://example.test/track', COMPLETE_TRACK);
			expect(await cache.getTrack('https://example.test/track')).toEqual(COMPLETE_TRACK);
		});

		test('gives an incomplete track the short negative TTL', async () => {
			const { cache, setTime } = build();
			await cache.setTrack('https://example.test/partial', {
				...COMPLETE_TRACK,
				isrc: null,
			});

			setTime(NEGATIVE_TTL - 1);
			expect(await cache.getTrack('https://example.test/partial')).not.toBeNull();
			setTime(NEGATIVE_TTL);
			expect(await cache.getTrack('https://example.test/partial')).toBeNull();
		});

		test('gives a complete track the long default TTL', async () => {
			const { cache, setTime } = build();
			await cache.setTrack('https://example.test/track', COMPLETE_TRACK);

			setTime(DEFAULT_TTL - 1);
			expect(await cache.getTrack('https://example.test/track')).not.toBeNull();
			setTime(DEFAULT_TTL);
			expect(await cache.getTrack('https://example.test/track')).toBeNull();
		});

		test('expires track entries and prune removes their rows', async () => {
			const { cache } = build();
			await cache.setTrack('https://example.test/track', COMPLETE_TRACK, -1);

			expect(await cache.getTrack('https://example.test/track')).toBeNull();
			await cache.prune();
			expect(await cache.getTrack('https://example.test/track')).toBeNull();
		});

		test('merges links without extending an incomplete entry expiry', async () => {
			const { cache, setTime } = build();
			await cache.setLinks('ISRC2', new Map([[Platform.Spotify, null]]), 60_000);

			setTime(10);
			await cache.setLinks(
				'ISRC2',
				new Map([[Platform.Deezer, 'https://example.test/deezer']]),
			);

			expect(await cache.getLinks('ISRC2')).toEqual(
				new Map([
					[Platform.Spotify, null],
					[Platform.Deezer, 'https://example.test/deezer'],
				]),
			);

			// The original 60s window survives the partial retry rather than restarting.
			setTime(59_999);
			expect(await cache.getLinks('ISRC2')).not.toBeNull();
			setTime(60_000);
			expect(await cache.getLinks('ISRC2')).toBeNull();
		});

		test('upgrades a completed entry to the normal TTL', async () => {
			const { cache, setTime } = build();
			await cache.setLinks('ISRC4', new Map([[Platform.Spotify, null]]), 100);
			setTime(10);
			await cache.setLinks(
				'ISRC4',
				new Map([[Platform.Spotify, 'https://example.test/spotify']]),
			);

			setTime(10 + DEFAULT_TTL - 1);
			expect(await cache.getLinks('ISRC4')).not.toBeNull();
			setTime(10 + DEFAULT_TTL);
			expect(await cache.getLinks('ISRC4')).toBeNull();
		});

		test('gives a complete entry widened with a new miss a fresh negative TTL', async () => {
			// Regression: a complete entry retried the DEFAULT_TTL clock it earned while
			// complete, so a single transient miss on a newly-enabled platform pinned that
			// platform's "no link" answer for up to 30 days instead of 5 minutes.
			const { cache, setTime } = build();
			await cache.setLinks(
				'ISRC7',
				new Map([
					[Platform.Spotify, 'https://example.test/spotify'],
					[Platform.Deezer, 'https://example.test/deezer'],
				]),
			);

			setTime(10);
			await cache.setLinks('ISRC7', new Map([[Platform.Tidal, null]]));

			setTime(10 + NEGATIVE_TTL - 1);
			expect(await cache.getLinks('ISRC7')).not.toBeNull();
			setTime(10 + NEGATIVE_TTL);
			expect(await cache.getLinks('ISRC7')).toBeNull();
		});

		test('starts a fresh negative window at the exact expiry instant', async () => {
			const { cache, setTime } = build();
			await cache.setLinks('ISRC5', new Map([[Platform.Spotify, null]]), 100);
			setTime(100);
			await cache.setLinks('ISRC5', new Map([[Platform.Deezer, null]]));

			// The expired entry is discarded, so Spotify does not carry over.
			expect(await cache.getLinks('ISRC5')).toEqual(new Map([[Platform.Deezer, null]]));
			setTime(100 + NEGATIVE_TTL - 1);
			expect(await cache.getLinks('ISRC5')).not.toBeNull();
			setTime(100 + NEGATIVE_TTL);
			expect(await cache.getLinks('ISRC5')).toBeNull();
		});

		test('prune removes expired link entries', async () => {
			const { cache } = build();
			await cache.setLinks(
				'ISRC3',
				new Map([[Platform.Spotify, 'https://example.test/spotify']]),
				-1,
			);
			await cache.prune();
			expect(await cache.getLinks('ISRC3')).toBeNull();
		});

		test('honors custom TTL options', async () => {
			let timestamp = 0;
			const cache = adapter.create({
				now: () => timestamp,
				defaultTtlMs: 1_000,
				negativeTtlMs: 100,
			});

			await cache.setTrack('https://example.test/custom', COMPLETE_TRACK);
			timestamp = 999;
			expect(await cache.getTrack('https://example.test/custom')).not.toBeNull();
			timestamp = 1_000;
			expect(await cache.getTrack('https://example.test/custom')).toBeNull();

			timestamp = 0;
			await cache.setLinks('CUSTOM', new Map([[Platform.Spotify, null]]));
			timestamp = 99;
			expect(await cache.getLinks('CUSTOM')).not.toBeNull();
			timestamp = 100;
			expect(await cache.getLinks('CUSTOM')).toBeNull();
		});
	});
}

describe('memory cache isolation', () => {
	test('returns a copy so callers cannot mutate cached state', async () => {
		const cache = createMemoryTrackCache();
		await cache.setLinks('ISRC6', new Map([[Platform.Spotify, 'https://example.test/a']]));

		const first = await cache.getLinks('ISRC6');
		first?.set(Platform.Deezer, 'https://example.test/injected');

		expect(await cache.getLinks('ISRC6')).toEqual(
			new Map([[Platform.Spotify, 'https://example.test/a']]),
		);
	});
});

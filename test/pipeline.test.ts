import { describe, expect, test } from 'bun:test'
import { createMemoryTrackCache } from '../src/cache/memory.js'
import { createRippie } from '../src/pipeline.js'
import { Platform } from '../src/platform.js'
import type { Provider, TrackInfo } from '../src/types.js'

const SPOTIFY_URL = 'https://open.spotify.com/track/abc123'

const SOURCE_TRACK: TrackInfo = {
	name: 'Track',
	artists: ['Artist'],
	isrc: 'ISRC1',
	link: 'https://open.spotify.com/track/abc123',
}

type Counters = { fetchTrack: number; findByIsrc: number; findByTrack: number }

/**
 * A provider with no network behind it, so the pipeline's caching and fan-out can be observed
 * directly through call counts.
 */
const stubProvider = (
	platform: Platform,
	options: {
		track?: TrackInfo | null
		isrcLink?: string | null
		trackLink?: string | null
		throws?: boolean
	} = {},
): Provider & { calls: Counters } => {
	const calls: Counters = { fetchTrack: 0, findByIsrc: 0, findByTrack: 0 }

	const provider: Provider & { calls: Counters } = {
		platform,
		calls,
		matches: () => true,
		fetchTrack: async () => {
			calls.fetchTrack += 1
			if (options.throws) throw new Error('provider exploded')
			return options.track ?? null
		},
	}

	if (options.isrcLink !== undefined) {
		provider.findByIsrc = async () => {
			calls.findByIsrc += 1
			if (options.throws) throw new Error('provider exploded')
			return options.isrcLink ?? null
		}
	}
	if (options.trackLink !== undefined) {
		provider.findByTrack = async () => {
			calls.findByTrack += 1
			if (options.throws) throw new Error('provider exploded')
			return options.trackLink ?? null
		}
	}

	return provider
}

describe('createRippie configuration', () => {
	test('enables the three credential-free platforms by default', () => {
		const rippie = createRippie()
		expect(new Set(rippie.availablePlatforms)).toEqual(
			new Set([Platform.Deezer, Platform.AppleMusic, Platform.YouTubeMusic]),
		)
	})

	test('adds Spotify and Tidal only when credentials are supplied', () => {
		const rippie = createRippie({
			spotify: { clientId: 'a', clientSecret: 'b' },
			tidal: { clientId: 'c', clientSecret: 'd' },
		})
		expect(rippie.availablePlatforms).toContain(Platform.Spotify)
		expect(rippie.availablePlatforms).toContain(Platform.Tidal)
	})

	test('a supplied provider replaces the built-in for its platform', () => {
		const custom = stubProvider(Platform.Deezer)
		const rippie = createRippie({ providers: [custom] })

		expect(rippie.availablePlatforms.filter((p) => p === Platform.Deezer).length).toBe(1)
		expect(rippie.providers).toContain(custom)
	})

	test('enabled restricts the built-in set', () => {
		const rippie = createRippie({ enabled: [Platform.Deezer] })
		expect(rippie.availablePlatforms).toEqual([Platform.Deezer])
	})

	test('a custom provider survives an empty enabled list', () => {
		const custom = stubProvider(Platform.Tidal)
		const rippie = createRippie({ enabled: [], providers: [custom] })
		expect(rippie.availablePlatforms).toEqual([Platform.Tidal])
	})

	test('a platform name outside the five built-ins resolves as a target', async () => {
		// Proves Platform's widening is more than a type-level fix: a provider naming itself
		// something the package has never heard of is still a first-class resolution target,
		// found via the same findByIsrc/findByTrack fan-out as any built-in.
		//
		// It is only a target here, not a source: resolve() detects the *source* platform via
		// detectMusicPlatform's fixed regex table, which a custom provider's `matches` is never
		// consulted for. Posting a Bandcamp link would not resolve at all today.
		const spotify = stubProvider(Platform.Spotify, {
			track: { name: 'Track', artists: ['Artist'], isrc: 'ISRC1', link: 'https://x/1' },
		})
		const bandcamp = stubProvider('Bandcamp', {
			isrcLink: 'https://bandcamp.example/track/1',
		})

		const rippie = createRippie({
			enabled: [],
			providers: [spotify, bandcamp],
		})
		expect(rippie.availablePlatforms).toContain('Bandcamp')

		const result = await rippie.resolve('https://open.spotify.com/track/abc123')
		if (result.status !== 'ok') throw new Error('expected ok')
		expect(result.links.get('Bandcamp')).toBe('https://bandcamp.example/track/1')
	})
})

describe('resolve', () => {
	const buildRippie = (overrides: Provider[] = []) => {
		const spotify = stubProvider(Platform.Spotify, { track: SOURCE_TRACK, isrcLink: null })
		const deezer = stubProvider(Platform.Deezer, {
			isrcLink: 'https://www.deezer.com/en/track/1',
		})
		const apple = stubProvider(Platform.AppleMusic, {
			trackLink: 'https://music.apple.com/us/album/x/1?i=2',
		})
		const cache = createMemoryTrackCache()
		// `enabled: []` drops every built-in provider, so no test can reach the network.
		const rippie = createRippie({
			cache,
			enabled: [],
			providers: [spotify, deezer, apple, ...overrides],
		})
		return { rippie, cache, spotify, deezer, apple }
	}

	test('reports an unrecognized url as unresolved', async () => {
		const { rippie } = buildRippie()
		expect(await rippie.resolve('https://example.com/not-a-track')).toEqual({
			status: 'unresolved',
			source: null,
		})
	})

	test('reports a recognized url whose track cannot be read as unresolved', async () => {
		const cache = createMemoryTrackCache()
		const rippie = createRippie({
			cache,
			enabled: [],
			providers: [stubProvider(Platform.Spotify, { track: null })],
		})

		expect(await rippie.resolve(SPOTIFY_URL)).toEqual({
			status: 'unresolved',
			source: Platform.Spotify,
		})
	})

	test('reports a track without an ISRC separately from a failure', async () => {
		const track = { ...SOURCE_TRACK, isrc: null }
		const rippie = createRippie({
			cache: createMemoryTrackCache(),
			enabled: [],
			providers: [stubProvider(Platform.Spotify, { track })],
		})

		expect(await rippie.resolve(SPOTIFY_URL)).toEqual({
			status: 'no-isrc',
			source: Platform.Spotify,
			track,
		})
	})

	test('resolves links across the other platforms and omits misses', async () => {
		const { rippie } = buildRippie()
		const result = await rippie.resolve(SPOTIFY_URL)

		expect(result.status).toBe('ok')
		if (result.status !== 'ok') return

		expect(result.source).toBe(Platform.Spotify)
		expect(result.track).toEqual(SOURCE_TRACK)
		// YouTube Music resolves to null in this setup and is therefore absent, not present-as-null.
		expect(result.links).toEqual(
			new Map([
				[Platform.Deezer, 'https://www.deezer.com/en/track/1'],
				[Platform.AppleMusic, 'https://music.apple.com/us/album/x/1?i=2'],
			]),
		)
	})

	test('never resolves the source platform against itself', async () => {
		const { rippie, spotify } = buildRippie()
		await rippie.resolve(SPOTIFY_URL)
		expect(spotify.calls.findByIsrc).toBe(0)
	})

	test('prefers ISRC lookup and falls back to text matching', async () => {
		const { rippie, deezer, apple } = buildRippie()
		await rippie.resolve(SPOTIFY_URL)

		expect(deezer.calls.findByIsrc).toBe(1)
		expect(deezer.calls.findByTrack).toBe(0)
		expect(apple.calls.findByTrack).toBe(1)
	})

	test('restricts resolution to the requested platforms', async () => {
		const { rippie, deezer, apple } = buildRippie()
		const result = await rippie.resolve(SPOTIFY_URL, { platforms: [Platform.Deezer] })

		expect(deezer.calls.findByIsrc).toBe(1)
		expect(apple.calls.findByTrack).toBe(0)
		if (result.status !== 'ok') throw new Error('expected ok')
		expect([...result.links.keys()]).toEqual([Platform.Deezer])
	})

	test('serves a repeated link entirely from cache', async () => {
		const { rippie, spotify, deezer, apple } = buildRippie()

		await rippie.resolve(SPOTIFY_URL)
		const second = await rippie.resolve(SPOTIFY_URL)

		expect(spotify.calls.fetchTrack).toBe(1)
		expect(deezer.calls.findByIsrc).toBe(1)
		expect(apple.calls.findByTrack).toBe(1)
		if (second.status !== 'ok') throw new Error('expected ok')
		expect(second.links.get(Platform.Deezer)).toBe('https://www.deezer.com/en/track/1')
	})

	test('only queries platforms missing from the ISRC cache', async () => {
		const cache = createMemoryTrackCache()
		const spotify = stubProvider(Platform.Spotify, { track: SOURCE_TRACK, isrcLink: null })
		const deezer = stubProvider(Platform.Deezer, {
			isrcLink: 'https://www.deezer.com/en/track/1',
		})
		const apple = stubProvider(Platform.AppleMusic, { trackLink: null })

		const first = createRippie({ cache, enabled: [], providers: [spotify, deezer, apple] })
		await first.resolve(SPOTIFY_URL, { platforms: [Platform.Deezer] })

		// A second run widens the request. Deezer is already known and must not be re-queried.
		await first.resolve(SPOTIFY_URL, { platforms: [Platform.Deezer, Platform.AppleMusic] })

		expect(deezer.calls.findByIsrc).toBe(1)
		expect(apple.calls.findByTrack).toBe(1)
	})

	test('caches the source platform link so the reverse direction hits', async () => {
		const { rippie, cache } = buildRippie()
		await rippie.resolve(SPOTIFY_URL)

		expect((await cache.getLinks('ISRC1'))?.links.get(Platform.Spotify)).toBe(SOURCE_TRACK.link)
	})

	test('a throwing provider does not fail the whole resolution', async () => {
		const { rippie } = buildRippie([
			stubProvider(Platform.Tidal, { isrcLink: 'unused', throws: true }),
		])

		const result = await rippie.resolve(SPOTIFY_URL)
		if (result.status !== 'ok') throw new Error('expected ok')
		expect(result.links.get(Platform.Deezer)).toBe('https://www.deezer.com/en/track/1')
		expect(result.links.has(Platform.Tidal)).toBe(false)
	})

	test('resolving a link already discovered on another platform calls no provider', async () => {
		// This is the reported bug end to end: a Spotify link resolves and discovers an Apple
		// Music link as one of its results. Posting that exact Apple link later must answer
		// from the cache, zero calls to the Apple provider, not even one.
		const APPLE_URL = 'https://music.apple.com/us/album/x/1?i=2'
		const { rippie, spotify, apple } = buildRippie()

		const first = await rippie.resolve(SPOTIFY_URL)
		if (first.status !== 'ok') throw new Error('expected ok')
		expect(first.links.get(Platform.AppleMusic)).toBe(APPLE_URL)
		expect(apple.calls.findByTrack).toBe(1)
		expect(apple.calls.fetchTrack).toBe(0)

		const second = await rippie.resolve(APPLE_URL)

		expect(apple.calls.fetchTrack).toBe(0)
		expect(apple.calls.findByTrack).toBe(1) // unchanged, no new call at all
		expect(spotify.calls.fetchTrack).toBe(1) // unchanged, Spotify was already known too

		if (second.status !== 'ok') throw new Error('expected ok')
		expect(second.source).toBe(Platform.AppleMusic)
		expect(second.track.link).toBe(APPLE_URL)
		expect(second.track.isrc).toBe(SOURCE_TRACK.isrc)
		expect(second.links.get(Platform.Spotify)).toBe(SPOTIFY_URL)
	})
})

describe('startPruning', () => {
	test('prunes on the interval and stops when told to', async () => {
		let pruned = 0
		const rippie = createRippie({
			cache: {
				getTrack: () => null,
				setTrack: () => {},
				getLinks: () => null,
				setLinks: () => {},
				findIsrcByLink: () => null,
				prune: () => {
					pruned += 1
				},
			},
		})

		const stop = rippie.startPruning(1)
		await Bun.sleep(15)
		stop()
		const afterStop = pruned
		await Bun.sleep(10)

		expect(afterStop).toBeGreaterThan(0)
		expect(pruned).toBe(afterStop)
	})

	test('an async adapter rejecting does not crash the process', async () => {
		// Regression: `void cache.prune()` discarded the promise without a catch, so a
		// user-supplied async adapter (Redis, Postgres, both documented in the README) that
		// rejects would surface as an unhandled rejection and crash the host process.
		const originalConsoleError = console.error
		const loggedErrors: unknown[] = []
		console.error = (...args: unknown[]) => {
			loggedErrors.push(args)
		}

		try {
			const rippie = createRippie({
				cache: {
					getTrack: () => null,
					setTrack: () => {},
					getLinks: () => null,
					setLinks: () => {},
					findIsrcByLink: () => null,
					prune: () => Promise.reject(new Error('adapter unreachable')),
				},
			})

			const stop = rippie.startPruning(1)
			await Bun.sleep(15)
			stop()

			expect(loggedErrors.length).toBeGreaterThan(0)
		} finally {
			console.error = originalConsoleError
		}
	})

	test('an adapter throwing synchronously does not crash the process', async () => {
		const originalConsoleError = console.error
		const loggedErrors: unknown[] = []
		console.error = (...args: unknown[]) => {
			loggedErrors.push(args)
		}

		try {
			const rippie = createRippie({
				cache: {
					getTrack: () => null,
					setTrack: () => {},
					getLinks: () => null,
					setLinks: () => {},
					findIsrcByLink: () => null,
					prune: () => {
						throw new Error('adapter misconfigured')
					},
				},
			})

			const stop = rippie.startPruning(1)
			await Bun.sleep(15)
			stop()

			expect(loggedErrors.length).toBeGreaterThan(0)
		} finally {
			console.error = originalConsoleError
		}
	})
})

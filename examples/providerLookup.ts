/**
 * Single-provider probe, replacing the per-platform experiment scripts.
 *
 * Useful when one platform starts misbehaving and you want to see its raw answer without the
 * cache or the resolution fan-out in the way.
 *
 * Usage:
 *   bun run examples/providerLookup.ts <platform> link  <track-url>
 *   bun run examples/providerLookup.ts <platform> isrc  <isrc>
 *   bun run examples/providerLookup.ts <platform> track "<artist>" "<song>"
 *
 * Platforms: spotify | deezer | tidal | apple | ytmusic
 *
 * Examples:
 *   bun run examples/providerLookup.ts deezer link https://www.deezer.com/track/3135556
 *   bun run examples/providerLookup.ts apple track "Daft Punk" "Digital Love"
 */

import {
	createAppleMusicProvider,
	createDeezerProvider,
	createSpotifyProvider,
	createTidalProvider,
	createYtMusicProvider,
	type Provider,
} from '../src/index.js'

const credentials = (
	idKey: string,
	secretKey: string,
): { clientId: string; clientSecret: string } => {
	const clientId = process.env[idKey]
	const clientSecret = process.env[secretKey]
	if (!clientId || !clientSecret) {
		console.error(`Missing ${idKey} and/or ${secretKey} in the environment.`)
		process.exit(1)
	}
	return { clientId, clientSecret }
}

const buildProvider = (name: string): Provider => {
	switch (name) {
		case 'spotify':
			return createSpotifyProvider(credentials('SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'))
		case 'tidal':
			return createTidalProvider(credentials('TIDAL_CLIENT_ID', 'TIDAL_CLIENT_SECRET'))
		case 'deezer':
			return createDeezerProvider()
		case 'apple':
			return createAppleMusicProvider()
		case 'ytmusic':
			return createYtMusicProvider()
		default:
			console.error(`Unknown platform: ${name}`)
			console.error('Expected one of: spotify, deezer, tidal, apple, ytmusic')
			process.exit(1)
	}
}

const [platformName, mode, ...rest] = process.argv.slice(2)
if (!platformName || !mode) {
	console.error('Usage: bun run examples/providerLookup.ts <platform> <link|isrc|track> ...')
	process.exit(1)
}

const provider = buildProvider(platformName)
console.log(`Provider: ${provider.platform}\n`)

if (mode === 'link') {
	const url = rest[0]
	if (!url) {
		console.error('A track URL is required.')
		process.exit(1)
	}
	console.log(await provider.fetchTrack(url))
} else if (mode === 'isrc') {
	const isrc = rest[0]
	if (!isrc) {
		console.error('An ISRC is required.')
		process.exit(1)
	}
	if (!provider.findByIsrc) {
		console.error(`${provider.platform} does not support ISRC lookup, use "track" instead.`)
		process.exit(1)
	}
	console.log(await provider.findByIsrc(isrc))
} else if (mode === 'track') {
	const [artist, song] = rest
	if (!artist || !song) {
		console.error('Both an artist and a song title are required.')
		process.exit(1)
	}
	if (!provider.findByTrack) {
		console.error(`${provider.platform} does not support text lookup, use "isrc" instead.`)
		process.exit(1)
	}
	console.log(
		await provider.findByTrack({ name: song, artists: [artist], isrc: null, link: null }),
	)
} else {
	console.error(`Unknown mode: ${mode}. Expected link, isrc, or track.`)
	process.exit(1)
}

/**
 * End-to-end resolution.
 *
 * Takes a track link from any supported platform and prints the same track everywhere else.
 * Spotify and Tidal only appear when their credentials are exported; the other three platforms
 * work with no configuration at all.
 *
 * Usage:
 *   bun run examples/resolve.ts <track-url>
 *
 * Example:
 *   bun run examples/resolve.ts https://www.deezer.com/track/3135556
 */

import { createRippie } from '../src/index.js';

const url = process.argv[2];
if (!url) {
	console.error('Usage: bun run examples/resolve.ts <track-url>');
	process.exit(1);
}

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, TIDAL_CLIENT_ID, TIDAL_CLIENT_SECRET } =
	process.env;

const rippie = createRippie({
	...(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET
		? { spotify: { clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET } }
		: {}),
	...(TIDAL_CLIENT_ID && TIDAL_CLIENT_SECRET
		? { tidal: { clientId: TIDAL_CLIENT_ID, clientSecret: TIDAL_CLIENT_SECRET } }
		: {}),
});

console.log(`Enabled platforms: ${rippie.availablePlatforms.join(', ')}\n`);

const result = await rippie.resolve(url);

switch (result.status) {
	case 'unresolved':
		console.error(
			result.source
				? `Recognized a ${result.source} link but could not read the track.`
				: 'Not a supported track link.',
		);
		process.exit(1);
		break;

	case 'no-isrc':
		console.log(`${result.track.name} — ${result.track.artists.join(', ')}`);
		console.error('\nNo ISRC available, so other platforms cannot be searched.');
		process.exit(1);
		break;

	case 'ok': {
		console.log(`${result.track.name} — ${result.track.artists.join(', ')}`);
		console.log(`ISRC: ${result.track.isrc}`);
		console.log(`Source: ${result.source}\n`);

		if (result.links.size === 0) {
			console.log('No matches found on the other platforms.');
			break;
		}
		for (const [platform, link] of result.links) {
			console.log(`${platform.padEnd(15)} ${link}`);
		}
		break;
	}
}

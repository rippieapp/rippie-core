/**
 * Link detection only, no network, no credentials.
 *
 * Usage:
 *   bun run examples/detect.ts <url> [url...]
 */

import { detectMusicPlatform } from '../src/index.js'

const urls = process.argv.slice(2)
if (urls.length === 0) {
	console.error('Usage: bun run examples/detect.ts <url> [url...]')
	process.exit(1)
}

for (const url of urls) {
	console.log(`${detectMusicPlatform(url) ?? 'not a track link'}\t${url}`)
}

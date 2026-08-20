export const Platform = {
	Spotify: 'Spotify',
	AppleMusic: 'Apple Music',
	YouTubeMusic: 'YouTube Music',
	Deezer: 'Deezer',
	Tidal: 'Tidal',
} as const

/**
 * One of the five built-in platform names, or any other string a custom `Provider` names itself.
 *
 * `string & {}` rather than plain `string` keeps the five built-in names showing up in editor
 * autocomplete while still accepting anything else, the widening a third-party `Provider` needs
 * to type-check at all. See docs/architecture.md and the "Teaching her a new platform" section of
 * the README.
 */
export type Platform = (typeof Platform)[keyof typeof Platform] | (string & {})

const platformPatterns: { platform: Platform; pattern: RegExp }[] = [
	{
		platform: Platform.Spotify,
		pattern: /^https?:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)(?:\?|$)/,
	},
	{
		platform: Platform.AppleMusic,
		pattern:
			/^https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:album|song)\/[^/]+\/\d+(?:\?i=\d+)?(?:$|\?|&)/,
	},
	{
		platform: Platform.YouTubeMusic,
		pattern: /^https?:\/\/music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})(?:&|$)/,
	},
	{
		platform: Platform.Deezer,
		pattern:
			/^https?:\/\/(?:link\.deezer\.com\/s\/|www\.deezer\.com\/(?:\w{2}\/)?track\/)([a-zA-Z0-9]+)/,
	},
	{
		platform: Platform.Tidal,
		pattern: /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?tidal\.com\/(?:browse\/)?track\/([0-9]+)/,
	},
]

/** Detects which music platform a URL belongs to using regex matching. */
export const detectMusicPlatform = (url: string): Platform | null => {
	for (const { platform, pattern } of platformPatterns) {
		if (pattern.test(url)) {
			return platform
		}
	}
	return null
}

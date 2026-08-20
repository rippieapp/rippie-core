const NOISE_WORDS = [
	'official',
	'remastered',
	'remaster',
	'explicit',
	'audio',
	'video',
	'single',
	'album',
	'version',
]

/** Normalizes text for comparison by stripping punctuation, noise words, and feature credits. */
export const normalizeText = (text: string): string => {
	if (!text) return ''
	let cleaned = text.toLowerCase()

	// Convert URL/slug separators to spaces
	cleaned = cleaned.replace(/[-_]/g, ' ')

	// Strip punctuation elements
	cleaned = cleaned.replace(/[.,/#!$%^&*;:{}=\-_`~()[\]™]/g, '')

	// Truncate anything trailing feature artist credits
	cleaned = cleaned.replace(/\b(feat|ft|featuring)\b[\s\S]*/g, '')

	// Clean standalone noise words
	for (const word of NOISE_WORDS) {
		cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'g'), '')
	}

	return cleaned.replace(/\s+/g, ' ').trim()
}

/** Builds the "artist - title" signature used for cross-platform fuzzy matching. */
export const trackSignature = (artist: string, song: string): string => `${artist} - ${song}`

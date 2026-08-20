import { Platform } from '../platform.js'
import type {
	ClientCredentials,
	FetchLike,
	Provider,
	ProviderOptions,
	TrackInfo,
} from '../types.js'

type TidalTokenResponse = {
	access_token: string
	expires_in: number
	token_type: string
}

type TidalTrackAttributes = {
	title: string
	version?: string | null
	isrc?: string | null
	popularity?: number
	externalLinks?: Array<{
		href: string
		meta?: { type?: string }
	}>
}

type TidalTrackRelationships = {
	artists?: {
		data?: Array<{ id: string; type: string }>
	}
}

type TidalTrack = {
	id: string
	type: 'tracks'
	attributes?: TidalTrackAttributes
	relationships?: TidalTrackRelationships
}

type TidalIncludedArtist = {
	id: string
	type: 'artists'
	attributes?: { name?: string }
}

type TidalIncluded = Array<TidalIncludedArtist | { type: string; [key: string]: unknown }>

type TidalTracksResponse = {
	data?: TidalTrack[]
	included?: TidalIncluded
}

type TidalSingleTrackResponse = {
	data?: TidalTrack
	included?: TidalIncluded
}

export type TidalTrackLookup = {
	id: string
	name: string
	artists: string[]
	isrc: string
	link: string
}

export type TidalProviderOptions = ClientCredentials &
	ProviderOptions & {
		/** Optional storefront to scope lookups to, e.g. 'US'. */
		countryCode?: string
	}

const TRACK_ID_PATTERN = /tidal\.com\/(?:browse\/)?track\/([0-9]+)/

/** Extracts a numeric Tidal track ID from a URL. */
export const extractTidalTrackId = (url: string): string | null => {
	const match = url.match(TRACK_ID_PATTERN)
	return match?.[1] ?? null
}

const extractArtists = (track: TidalTrack, included?: TidalIncluded): string[] => {
	const artistNameMap = new Map<string, string>()
	if (included) {
		for (const item of included) {
			if (item.type === 'artists') {
				const artist = item as TidalIncludedArtist
				if (artist.attributes?.name) {
					artistNameMap.set(artist.id, artist.attributes.name)
				}
			}
		}
	}

	const artists: string[] = []
	const artistRefs = track.relationships?.artists?.data
	if (Array.isArray(artistRefs) && artistRefs.length > 0) {
		for (const ref of artistRefs) {
			const name = artistNameMap.get(ref.id)
			if (name && !artists.includes(name)) {
				artists.push(name)
			}
		}
	}

	if (artists.length === 0 && artistNameMap.size > 0) {
		artists.push(...new Set(artistNameMap.values()))
	}

	return artists
}

const extractSharingLink = (track: TidalTrack): string =>
	track.attributes?.externalLinks?.find((link) => link.meta?.type === 'TIDAL_SHARING')?.href ??
	`https://tidal.com/browse/track/${track.id}`

/**
 * Creates a Tidal provider backed by the v2 open API.
 *
 * As with Spotify, the access token is per instance rather than per module.
 */
export const createTidalProvider = (options: TidalProviderOptions) => {
	const fetchImpl: FetchLike = options.fetch ?? fetch
	let cachedToken: string | null = null
	let tokenExpiresAt = 0

	const getAccessToken = async (): Promise<string | null> => {
		if (!options.clientId || !options.clientSecret) {
			return null
		}

		if (cachedToken && Date.now() < tokenExpiresAt) {
			return cachedToken
		}

		try {
			const credentials = btoa(`${options.clientId}:${options.clientSecret}`)

			const response = await fetchImpl('https://auth.tidal.com/v1/oauth2/token', {
				method: 'POST',
				headers: {
					Authorization: `Basic ${credentials}`,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: 'grant_type=client_credentials',
			})

			if (!response.ok) {
				return null
			}

			const data = (await response.json()) as TidalTokenResponse

			cachedToken = data.access_token
			tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000

			return cachedToken
		} catch {
			return null
		}
	}

	const requestHeaders = (token: string): Record<string, string> => ({
		Authorization: `Bearer ${token}`,
		accept: 'application/vnd.api+json',
	})

	/** Searches Tidal by ISRC and picks the most popular match if multiple versions exist. */
	const lookupTidalTrackByIsrc = async (
		isrc: string,
		countryCode = options.countryCode,
	): Promise<TidalTrackLookup | null> => {
		try {
			const token = await getAccessToken()
			if (!token) return null

			const url = new URL('https://openapi.tidal.com/v2/tracks')
			if (countryCode) {
				url.searchParams.set('countryCode', countryCode)
			}
			url.searchParams.set('filter[isrc]', isrc)
			url.searchParams.set('include', 'artists')

			const response = await fetchImpl(url.toString(), { headers: requestHeaders(token) })
			if (!response.ok) return null

			const data = (await response.json()) as TidalTracksResponse
			if (!data.data || data.data.length === 0) return null

			const track = [...data.data].sort(
				(a, b) => (b.attributes?.popularity ?? 0) - (a.attributes?.popularity ?? 0),
			)[0]

			if (!track) return null

			return {
				id: track.id,
				name: track.attributes?.title ?? '',
				artists: extractArtists(track, data.included),
				isrc: track.attributes?.isrc ?? isrc,
				link: extractSharingLink(track),
			}
		} catch {
			return null
		}
	}

	/** Fetches track info from Tidal by track ID. */
	const fetchTidalTrackInfo = async (
		trackId: string,
		countryCode = options.countryCode,
	): Promise<TrackInfo | null> => {
		try {
			const token = await getAccessToken()
			if (!token) return null

			const url = new URL(`https://openapi.tidal.com/v2/tracks/${trackId}`)
			if (countryCode) {
				url.searchParams.set('countryCode', countryCode)
			}
			url.searchParams.set('include', 'artists')

			const response = await fetchImpl(url.toString(), { headers: requestHeaders(token) })
			if (!response.ok) return null

			const data = (await response.json()) as TidalSingleTrackResponse
			const track = data.data
			if (!track) return null

			return {
				name: track.attributes?.title ?? '',
				artists: extractArtists(track, data.included),
				isrc: track.attributes?.isrc ?? null,
				link: extractSharingLink(track),
			}
		} catch {
			return null
		}
	}

	const provider: Provider = {
		platform: Platform.Tidal,
		matches: (url) => extractTidalTrackId(url) !== null,
		extractId: extractTidalTrackId,
		fetchTrack: async (url) => {
			const trackId = extractTidalTrackId(url)
			if (!trackId) return null
			return fetchTidalTrackInfo(trackId)
		},
		findByIsrc: async (isrc) => (await lookupTidalTrackByIsrc(isrc))?.link ?? null,
	}

	return { ...provider, fetchTidalTrackInfo, lookupTidalTrackByIsrc }
}

export type TidalProvider = ReturnType<typeof createTidalProvider>

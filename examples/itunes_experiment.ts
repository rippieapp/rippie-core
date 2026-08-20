/**
 * iTunes Search API experiment, no Apple Music HTML scraping involved.
 *
 * The current Apple provider (`src/providers/appleMusic.ts`) scrapes the public
 * music.apple.com search page, which is against Apple's ToS. This script checks whether the
 * official `itunes.apple.com/search` and `/lookup` endpoints alone can even find a given track,
 * before any fuzzy matching or scoring is applied on top.
 *
 * It dumps every raw result for a spread of query shapes and storefronts, so you can eyeball
 * whether the track appears at all. No Levenshtein scoring, no sorting, no truncation. This is
 * a "does the index have it" check, not a matcher.
 *
 * Since the goal is finding a track's Apple ID in the first place (starting from another
 * provider's metadata, with no Apple ID yet), this sweeps every query shape across several
 * storefronts plus no storefront at all. Search API coverage is inconsistent per-country and
 * a track missing from one storefront's index can still show up in another's.
 *
 * It also tries a second angle: search for the artist's albums (a search entity separate from
 * songs, so it can have different coverage), then use the Lookup API to pull each album's full
 * tracklist. A song missing from Search's song index can still turn up inside an album's
 * tracklist, since Lookup reads the live catalog rather than Search's index.
 *
 * Usage:
 *   bun run examples/itunes_experiment.ts "<artist>" "<title>" [countries] [limit]
 *
 * `countries` is a comma-separated storefront list (default: a broad default set, plus no
 * country param at all). Pass "none" to search only without a storefront.
 *
 * Example:
 *   bun run examples/itunes_experiment.ts "Ella Boh" "Babydoll"
 *   bun run examples/itunes_experiment.ts "Ella Boh" "Babydoll" US,CA,GB 50
 */

type ITunesTrack = {
	trackId: number;
	artistName: string;
	trackName: string;
	collectionName: string;
	trackTimeMillis?: number;
	releaseDate?: string;
	trackViewUrl?: string;
	isStreamable?: boolean;
};

type ITunesAlbum = {
	collectionId: number;
	artistName: string;
	collectionName: string;
	releaseDate?: string;
};

type ITunesSearchResponse<T> = {
	resultCount: number;
	results: T[];
};

type Query = {
	label: string;
	url: string;
};

const DEFAULT_STOREFRONTS = ['none', 'US', 'CA', 'GB', 'AU'];

const [artist, title, countriesArg, limitArg] = process.argv.slice(2);
if (!artist || !title) {
	console.error(
		'Usage: bun run examples/itunes_experiment.ts "<artist>" "<title>" [countries] [limit]',
	);
	process.exit(1);
}

const storefronts = (countriesArg ? countriesArg.split(',') : DEFAULT_STOREFRONTS).map((s) =>
	s.trim(),
);
const limit = limitArg ? Number.parseInt(limitArg, 10) : 50;

const storefrontLabelOf = (storefront: string): string =>
	storefront === 'none' ? 'no storefront' : storefront;

const countryParamOf = (storefront: string): string =>
	storefront === 'none' ? '' : `&country=${storefront}`;

/** A storefront of "none" omits the &country= param entirely, searching Apple's default index. */
const buildSongQueries = (artist: string, title: string, storefront: string, limit: number): Query[] => {
	const base = 'https://itunes.apple.com/search';
	const combined = `${artist} ${title}`;
	const countryParam = countryParamOf(storefront);
	const storefrontLabel = storefrontLabelOf(storefront);
	return [
		{
			label: `[${storefrontLabel}] combined term`,
			url: `${base}?term=${encodeURIComponent(combined)}&media=music&entity=song&limit=${limit}${countryParam}`,
		},
		{
			label: `[${storefrontLabel}] combined term + songTerm attribute`,
			url: `${base}?term=${encodeURIComponent(combined)}&media=music&entity=song&attribute=songTerm&limit=${limit}${countryParam}`,
		},
		{
			label: `[${storefrontLabel}] artist term + artistTerm attribute`,
			url: `${base}?term=${encodeURIComponent(artist)}&media=music&entity=song&attribute=artistTerm&limit=${limit}${countryParam}`,
		},
		{
			label: `[${storefrontLabel}] title term + songTerm attribute`,
			url: `${base}?term=${encodeURIComponent(title)}&media=music&entity=song&attribute=songTerm&limit=${limit}${countryParam}`,
		},
	];
};

const buildAlbumQuery = (artist: string, storefront: string, limit: number): Query => {
	const base = 'https://itunes.apple.com/search';
	const countryParam = countryParamOf(storefront);
	return {
		label: `[${storefrontLabelOf(storefront)}] album search, artistTerm attribute`,
		url: `${base}?term=${encodeURIComponent(artist)}&media=music&entity=album&attribute=artistTerm&limit=${limit}${countryParam}`,
	};
};

const buildAlbumLookupUrl = (collectionId: number, storefront: string): string => {
	const base = 'https://itunes.apple.com/lookup';
	const countryParam = countryParamOf(storefront);
	return `${base}?id=${collectionId}&entity=song&limit=200${countryParam}`;
};

const formatDuration = (millis?: number): string => {
	if (!millis) return '?';
	const totalSeconds = Math.round(millis / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/** Loose containment check, just for the eyeball-friendly "FOUND" marker, not used to filter. */
const looksLikeTarget = (track: ITunesTrack): boolean =>
	track.trackName.toLowerCase().includes(title.toLowerCase()) &&
	track.artistName.toLowerCase().includes(artist.toLowerCase());

const fetchJson = async <T>(url: string): Promise<ITunesSearchResponse<T> | null> => {
	const response = await fetch(url);
	if (!response.ok) {
		console.log(`HTTP ${response.status}`);
		return null;
	}
	return (await response.json()) as ITunesSearchResponse<T>;
};

const runSongQuery = async (query: Query): Promise<ITunesTrack[]> => {
	console.log(`\n=== ${query.label} ===`);
	console.log(query.url);

	const json = await fetchJson<ITunesTrack>(query.url);
	if (!json || !json.results || json.results.length === 0) {
		console.log('No results.');
		return [];
	}

	console.log(`${json.resultCount} result(s):\n`);
	for (const track of json.results) {
		const marker = looksLikeTarget(track) ? '>>> FOUND <<<' : '';
		console.log(
			`  ${track.artistName} - ${track.trackName} ${marker}\n` +
				`        album: ${track.collectionName}  duration: ${formatDuration(track.trackTimeMillis)}  released: ${track.releaseDate ?? '?'}\n` +
				`        id: ${track.trackId}  url: ${track.trackViewUrl ?? '?'}`,
		);
	}

	return json.results;
};

/** Runs the album search for one storefront and returns the raw album results. */
const runAlbumQuery = async (query: Query): Promise<ITunesAlbum[]> => {
	console.log(`\n=== ${query.label} ===`);
	console.log(query.url);

	const json = await fetchJson<ITunesAlbum>(query.url);
	if (!json || !json.results || json.results.length === 0) {
		console.log('No results.');
		return [];
	}

	console.log(`${json.resultCount} album(s):\n`);
	for (const album of json.results) {
		console.log(
			`  ${album.artistName} - ${album.collectionName}  released: ${album.releaseDate ?? '?'}  id: ${album.collectionId}`,
		);
	}

	return json.results;
};

/** Pulls one album's full tracklist via Lookup and prints every track, raw. */
const runAlbumTrackLookup = async (
	album: ITunesAlbum,
	storefront: string,
): Promise<ITunesTrack[]> => {
	const url = buildAlbumLookupUrl(album.collectionId, storefront);
	console.log(`\n--- tracklist: [${storefrontLabelOf(storefront)}] ${album.collectionName} (id ${album.collectionId}) ---`);
	console.log(url);

	const json = await fetchJson<ITunesTrack | ITunesAlbum>(url);
	if (!json || !json.results || json.results.length === 0) {
		console.log('No results.');
		return [];
	}

	// Lookup with entity=song still returns the collection record itself at index 0; only
	// entries carrying a trackId are actual songs.
	const tracks = json.results.filter((r): r is ITunesTrack => 'trackId' in r);

	console.log(`${tracks.length} track(s):\n`);
	for (const track of tracks) {
		const marker = looksLikeTarget(track) ? '>>> FOUND <<<' : '';
		console.log(
			`  ${track.artistName} - ${track.trackName} ${marker}\n` +
				`        duration: ${formatDuration(track.trackTimeMillis)}  id: ${track.trackId}  url: ${track.trackViewUrl ?? '?'}`,
		);
	}

	return tracks;
};

console.log(`Target: ${artist} - ${title}`);
console.log(`Storefronts: ${storefronts.join(', ')}  limit: ${limit}`);

const allSongResults: ITunesTrack[] = [];
for (const storefront of storefronts) {
	for (const query of buildSongQueries(artist, title, storefront, limit)) {
		allSongResults.push(...(await runSongQuery(query)));
	}
}

console.log('\n\n########## Album sweep ##########');
console.log('Searching the artist\'s albums, then pulling each album\'s full tracklist via Lookup.');

const allAlbumTracks: ITunesTrack[] = [];
for (const storefront of storefronts) {
	const albums = await runAlbumQuery(buildAlbumQuery(artist, storefront, limit));

	// collectionId is shared across storefronts for the same release, so dedupe within this
	// storefront's own result set is enough; cross-storefront duplicates just get looked up
	// again under that storefront's catalog view, which is the point.
	const uniqueAlbums = [...new Map(albums.map((a) => [a.collectionId, a])).values()];

	for (const album of uniqueAlbums) {
		allAlbumTracks.push(...(await runAlbumTrackLookup(album, storefront)));
	}
}

const songMatches = allSongResults.filter(looksLikeTarget);
const albumMatches = allAlbumTracks.filter(looksLikeTarget);

console.log('\n\n=== Summary ===');
console.log(`Song search: ${allSongResults.length} raw result(s) across all queries.`);
if (songMatches.length === 0) {
	console.log(`  "${title}" by ${artist} did NOT appear in song search, any storefront.`);
} else {
	const ids = [...new Set(songMatches.map((t) => t.trackId))];
	console.log(`  Found via song search: ${songMatches.length} result(s), ${ids.length} unique id(s):`);
	for (const id of ids) {
		console.log(`    id ${id}: ${songMatches.find((t) => t.trackId === id)?.trackViewUrl ?? '?'}`);
	}
}

console.log(`Album sweep: ${allAlbumTracks.length} raw tracklist entries across all albums checked.`);
if (albumMatches.length === 0) {
	console.log(`  "${title}" by ${artist} did NOT appear inside any album's tracklist either.`);
} else {
	const ids = [...new Set(albumMatches.map((t) => t.trackId))];
	console.log(`  Found inside an album tracklist: ${albumMatches.length} result(s), ${ids.length} unique id(s):`);
	for (const id of ids) {
		console.log(`    id ${id}: ${albumMatches.find((t) => t.trackId === id)?.trackViewUrl ?? '?'}`);
	}
}

# @rippieapp/core

> Drop a stone in water, and it ripples outward in every direction. Rippie does the same for music.

Share a song from any platform and Rippie catches it, then sends it back out across every platform
you care about. No more "I don't have Spotify." No more re-searching the same song. One link
becomes many.

This package is the part of her you can build on: link detection, track identification, and
cross-platform resolution, with no interface attached. MIT licensed.

```sh
npm install @rippieapp/core
```

## Quickstart

```ts
import { createRippie } from '@rippieapp/core';

const rippie = createRippie();

const result = await rippie.resolve('https://www.deezer.com/track/3135556');

if (result.status === 'ok') {
	console.log(`${result.track.name} — ${result.track.artists.join(', ')}`);
	for (const [platform, link] of result.links) {
		console.log(platform, link);
	}
}
```

That works with no configuration at all. Three of the five platforms need no credentials:

| Platform | Credentials | How a link is found |
| --- | --- | --- |
| Deezer | none | Official API, ISRC lookup |
| Apple Music | none | iTunes Search API + Lookup API, text matching |
| YouTube Music | none | `ytmusic-api` search + oEmbed, text matching |
| Spotify | client ID + secret | Web API, ISRC search |
| Tidal | client ID + secret | Open API v2, ISRC filter |

Add the two that need keys when you have them:

```ts
const rippie = createRippie({
	spotify: { clientId: '…', clientSecret: '…' },
	tidal: { clientId: '…', clientSecret: '…' },
});
```

Credentials are passed in, never read from the environment. Nothing in this package touches
`process.env`.

## Results

`resolve` returns a tagged union, so you branch on a status rather than guessing which field is
null:

```ts
switch (result.status) {
	case 'unresolved':
		// Not a track link, or its platform could not be read.
		// `result.source` names the platform when detection succeeded but the lookup failed.
		break;
	case 'no-isrc':
		// The track was identified but carries no ISRC, so no other platform can be searched.
		// `result.track` still holds the name, artists, and source link.
		break;
	case 'ok':
		// `result.links` is a Map<Platform, string> of everything that matched.
		// A platform that returned no match is absent rather than present-as-null.
		break;
}
```

Restrict the search when you don't want every platform:

```ts
await rippie.resolve(url, { platforms: [Platform.Spotify, Platform.Deezer] });
```

## She remembers

Resolution is expensive — several API calls and, for two platforms, fuzzy text matching. So the
same song is never chased twice. There are two layers:

1. **Track identity → track.** A repeated link never re-reads its origin API. Providers that
   expose a stable id (all five built-ins do) key this by that id rather than the exact URL, so a
   link with different query-string or storefront noise still hits.
2. **ISRC → the track plus its cross-platform links.** The same recording arriving from a
   different platform reuses the work already done — and if that arriving link was itself already
   discovered as one of an earlier resolution's results, `findIsrcByLink` finds it before any
   provider is called at all, not just before the expensive ones.

Both layers use a two-speed TTL: a complete result is kept for 30 days, while a partial or failed
one gets 5 minutes and is retried soon after. A partial retry never extends that short window, so a
persistently missing platform cannot pin an entry open forever.

The default cache is in-memory and discarded on restart. For memory that survives one, the SQLite
adapter ships as a separate entry point:

```ts
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { createRippie } from '@rippieapp/core';
import { CACHE_TABLES_SQL, createSqliteTrackCache } from '@rippieapp/core/cache-sqlite';

const database = new Database('cache.sqlite', { create: true });
for (const statement of CACHE_TABLES_SQL) database.run(statement);

const rippie = createRippie({
	cache: createSqliteTrackCache({ db: drizzle({ client: database }) }),
});

rippie.startPruning(); // clears out expired rows every minute
```

The adapter never opens a connection itself — you hand it a drizzle instance. That is what keeps
the package free of a runtime-specific SQLite import, so `drizzle-orm/bun-sqlite`,
`drizzle-orm/better-sqlite3`, and any other synchronous driver all work. `drizzle-orm` is an
optional peer dependency; you only need it if you use this adapter.

Already running drizzle? Fold `cacheSchema` into your own schema and let `drizzle-kit` generate the
migrations instead of using `CACHE_TABLES_SQL`.

Any other store — Redis, Postgres, a KV namespace — is a matter of implementing six methods:

```ts
import type { TrackCache } from '@rippieapp/core';
```

`getLinks`/`setLinks` carry the track's own name and artists alongside its links, and
`findIsrcByLink` is the reverse index that makes a link already known as a resolution target
answer without a network call. Every method may return a value or a promise, so remote stores are
fine. Adjust the TTLs with `defaultTtlMs` and `negativeTtlMs`.

## Teaching her a new platform

A platform integration is a plain object. Implement `findByIsrc` when the platform can search by
ISRC and `findByTrack` when it can only match on text — the resolver prefers the former:

```ts
import type { Provider } from '@rippieapp/core';

const bandcamp: Provider = {
	platform: 'Bandcamp',
	matches: (url) => url.includes('bandcamp.com/track/'),
	fetchTrack: async (url) => { /* … */ },
	findByTrack: async (track) => { /* … */ },
};

const rippie = createRippie({ providers: [bandcamp] });
```

A supplied provider replaces the built-in for the same platform rather than duplicating it, so this
is also how you override one. `enabled` restricts which built-ins are constructed at all.

A custom provider is a full resolution **target** — `resolve()` will search it via `findByIsrc` or
`findByTrack` exactly like a built-in. It is not yet a resolution **source**: `matches` is honored
by `fetchTrack` when you call it directly, but `resolve()` currently detects the source platform of
a posted link through the five built-in URL patterns only, so a Bandcamp link posted first would
not resolve today. Bandcamp still shows up as a link for a track sourced from any built-in
platform.

Every provider factory is also exported directly, if you want one without the pipeline:

```ts
import { createDeezerProvider } from '@rippieapp/core';

const deezer = createDeezerProvider();
const track = await deezer.fetchTrack('https://www.deezer.com/track/3135556');
```

## Runtimes

Node 22+, Bun, and Deno. The main entry point uses only `fetch`, `URL`, and `btoa`, and imports
nothing runtime-specific — the SQLite adapter is isolated behind its own entry point precisely so
this stays true. Every provider accepts a `fetch` option for environments that need a custom
implementation, or for tests.

## Where the water gets shallow

Honesty before you depend on this:

- **Apple Music and YouTube Music are best effort.** Apple's official API requires a paid developer
  membership, so link discovery uses only the free, public iTunes Search and Lookup APIs — no page
  scraping. Apple's Search endpoint has had a bug since September 2025 where it omits
  explicit-content tracks from results entirely, regardless of the `explicit` parameter; Lookup is
  unaffected, so a track already known by Apple ID still resolves fine, but text search for an
  explicit track can return `null` even though the track exists on Apple Music. This is an upstream
  Apple bug, not a limitation of this package — see
  [the open Apple Developer Forums thread](https://developer.apple.com/forums/thread/802700).
  YouTube has no official Music API at all; `ytmusic-api` replays requests to YouTube's internal
  InnerTube API the same way every other YouTube Music tool does, and the `/player` endpoint used
  for reading a specific link requires bot verification, so link reading goes through the public
  oEmbed endpoint instead. Both routes can break when those internals change. They degrade to
  `null`, never an exception — but they are not contractual.
- **Neither exposes an ISRC**, so both are bridged through a Deezer search to obtain one. That makes
  Deezer the load-bearing fallback of the whole system.
- **Text matching is fuzzy.** Candidates are ranked by title closeness first, then artist closeness
  breaks ties among the closest titles — it can still pick the wrong one, a live version, or a
  re-release.
- **Every lookup swallows its errors** and returns `null`. Rippie would rather say nothing than
  crash. If you need to distinguish "no match" from "the API is down", wrap the providers.

See [docs/architecture.md](docs/architecture.md) for why it works this way.

## Examples

```sh
bun run examples/detect.ts   https://www.deezer.com/track/3135556
bun run examples/resolve.ts  https://www.deezer.com/track/3135556
bun run examples/providerLookup.ts apple track "Daft Punk" "Digital Love"
bun run examples/sqliteCache.ts https://www.deezer.com/track/3135556
```

## Rippie herself

<img alt="showcase" src="https://i.imgur.com/2FI9wNP.gif" />

<br>

This package is the current that powers **Rippie**, a private Discord bot who watches a music
channel and answers every song with buttons for the platforms that server cares about. Her Discord
layer is thin: read the guild's settings, call `resolve`, turn the map into buttons. Everything
above is the part doing the work.

### Artwork and identity

The source code in this repository is MIT-licensed. Rippie's commissioned artwork, the license
governing that artwork, and her official Discord application are private and are not shared through
this project. Platform logos appearing in any screenshot or demo belong to their respective owners
and are shown for identification only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New platform integrations are the most useful thing you can
bring: the `Provider` interface exists so another platform is one more ripple, not a rewrite.

## License

MIT. See [LICENSE](LICENSE).

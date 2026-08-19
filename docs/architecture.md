# Architecture

One link in, many links out. That sentence hides a surprising amount of trouble: two of the five
platforms refuse to tell you what song they are holding, two more need a key at the door, and every
one of them spells the same title differently.

This document covers the parts of the design that are not obvious from reading the code, and the
constraints that forced them.

## The ISRC bridge

An ISRC is the recording's identity — the one value that means "this exact master" across every
catalogue. Given an ISRC, finding a track elsewhere is a lookup. Without one, it is a search.

The five supported platforms split unevenly:

| Platform | Exposes an ISRC | Searchable by ISRC |
| --- | --- | --- |
| Spotify | yes | yes |
| Deezer | yes | yes |
| Tidal | yes | yes |
| Apple Music | **no** | no |
| YouTube Music | **no** | no |

Apple Music's free iTunes Lookup API returns artist, album, and track names but no ISRC. YouTube
Music exposes nothing resembling one at all. So a link from either of those two platforms yields
metadata with no identity attached, and metadata alone cannot address a catalogue.

The bridge closes that gap: take the artist and title read from Apple or YouTube, search Deezer for
it, and adopt the ISRC of the best match. Deezer is the right host for this because its search API
is open, unauthenticated, generous, and returns ISRCs directly.

The consequence is worth stating plainly: **Deezer is a single point of failure for two of the five
platforms.** If Deezer's search goes down, Apple Music and YouTube Music links stop resolving to
anything, even though their own APIs are fine. A second bridge candidate would be the highest-value
resilience work available.

Resolution therefore runs in two directions and `Provider` has two optional methods for it:

- `findByIsrc` — used when the track has an ISRC and the platform can search by it.
- `findByTrack` — the fallback, matching on normalized artist/title text.

`resolveLinksFromTrack` prefers the first and falls back to the second. A provider implementing
neither is skipped rather than recorded as a miss, so an unsupported platform is never cached as
"no link exists".

## Fuzzy matching

Text matching compares normalized signatures of the form `artist - title` using Levenshtein
distance, picking the lowest score.

`normalizeText` exists because the same recording is titled differently on every platform. It
lowercases, converts slug separators to spaces, strips punctuation, truncates everything from a
`feat.`/`ft.`/`featuring` credit onward, and removes standalone noise words (`official`,
`remastered`, `explicit`, `audio`, `video`, `single`, `album`, `version`). The goal is that
`Rick Astley - Never Gonna Give You Up (Official Video)` and
`rick_astley - never gonna give you up [Remastered]` reduce to the same string.

Apple Music scores twice: once against the iTunes record's `artist - collection`, and once against
the album slug in the URL, summing both. The slug carries signal the API response sometimes lacks.

This is heuristic. It can select the wrong master, a live cut, or a regional re-release. That is an
accepted cost — the alternative is no link at all.

## Why Apple Music is scraped

The official Apple Music API requires a paid developer membership and a signed token. The free
iTunes Search API is open but unreliable for fuzzy queries — the exact case that matters here.

The compromise is a hybrid: scrape the public Apple Music search page for candidate track URLs,
then validate each candidate against the free iTunes Lookup API for trustworthy metadata. The
scrape supplies recall, the API supplies precision.

This is the most fragile part of the package and the first thing to check when Apple links stop
resolving. It is isolated in one provider so replacing it means rewriting one file.

## Why YouTube Music takes two routes

`ytmusic-api` is used for search: its `/search` endpoint is unauthenticated and works well.

Reading a specific link deliberately does *not* use `ytmusic.getSong()`. YouTube's internal
`/player` endpoint requires bot verification and returns `LOGIN_REQUIRED`. The public oEmbed
endpoint returns a title and channel name without any of that, which is enough to feed the Deezer
bridge. Topic channels are named `Artist Name - Topic`, so that suffix is stripped.

## The two-layer cache

Layer 1 keys a **source URL** to the `TrackInfo` it describes. A link posted twice never re-reads
its origin API.

Layer 2 keys an **ISRC** to the cross-platform links found for it. The same recording arriving from
a different platform reuses the work — and because the source platform's own link is folded into
the payload, the reverse direction hits too.

Only platforms absent from layer 2 are queried. Widening a request later (say, a server enables a
new service) re-queries only the newly requested platform.

### The negative-TTL contract

This is the subtle part, and the behavior most worth preserving in any new adapter.

A complete result — every requested platform resolved to a real link — is stable and kept for 30
days. A result containing a `null` is usually a transient upstream failure, so it gets 5 minutes.

The rule that makes this work: **a partial retry never extends the short window.** Without it, a
platform that reliably has no match for a track would restart the 5-minute timer on every retry,
and the entry would be rewritten forever without ever aging out or settling. So when merging into
an unexpired incomplete entry, the original `expiresAt` is preserved rather than recomputed.

Once every platform resolves, the entry is upgraded to the full 30-day TTL on the spot.

The exact-expiry instant counts as expired (`now >= expiresAt`), which discards the stale entry and
starts a fresh negative window rather than merging into a dead one.

`test/cache.test.ts` runs the same suite against both adapters, so any new backend is proven to
implement this contract identically rather than approximately.

## No globals, no environment

Every provider is a factory. Access tokens for Spotify and Tidal are per instance, not per module,
so two clients in one process cannot invalidate each other's token. The `ytmusic-api` client is
created lazily per instance and a failed initialization is not cached.

Nothing reads `process.env`. Credentials arrive through `createRippie` or a provider factory.

This is not purity for its own sake. In the original bot, the providers imported a module-level
`zod.parse(process.env)` that threw without a Discord bot token — which meant importing the Spotify
client required a Discord token, and CI had to fake one to run cache tests. Configuration by
argument is what makes this package testable, embeddable, and runnable in a worker.

## Runtime neutrality

The main entry point uses only `fetch`, `URL`, and `btoa`. `Buffer` is deliberately avoided in
favor of `btoa` for base64 credentials.

The SQLite adapter is the one piece that cannot be runtime-neutral, so it lives behind its own
entry point with `drizzle-orm` as an optional peer dependency. It accepts an already-constructed
drizzle instance typed as `BaseSQLiteDatabase<'sync', …>` rather than opening a connection, which
means it works with `bun:sqlite`, `better-sqlite3`, and any other synchronous driver — and the
package itself never imports a driver.

The build is plain `tsc`, not a bundler: module structure is preserved 1:1 in `dist`, so consumers
tree-shake naturally and declaration maps point at real source files. Relative imports in `src/`
carry explicit `.js` extensions so the emitted output resolves under Node's ESM rules unchanged.

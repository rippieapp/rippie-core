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

Text matching (`pickBestMatch` in `src/match.ts`) ranks candidates by **title closeness first**,
then breaks ties among the closest-title group by **artist closeness** — two separate Levenshtein
distances, not one combined score.

Title-first exists because a single combined `artist - title` distance lets an unrelated candidate
win purely on artist coincidence. A track credited on Apple as `"DILEX, Nightvi$ion & NVRVYN -
UNICO"`, searched for as just `DILEX - UNICO`, scores worse on a combined signature than an
entirely different song by an artist whose name happens to contain the word "Unico" — the extra
collaborator names in the real match's credit outweigh the fact that its title is exactly right.
Comparing title first closes that off: a wrong-song candidate can never win purely because its
artist field happens to overlap, only candidates already tied for the closest title get to compete
on artist.

`normalizeText` exists because the same recording is titled differently on every platform. It
lowercases, converts slug separators to spaces, strips punctuation, truncates everything from a
`feat.`/`ft.`/`featuring` credit onward, and removes standalone noise words (`official`,
`remastered`, `explicit`, `audio`, `video`, `single`, `album`, `version`). The goal is that
`Rick Astley - Never Gonna Give You Up (Official Video)` and
`rick_astley - never gonna give you up [Remastered]` reduce to the same string.

This is heuristic. It can select the wrong master, a live cut, or a regional re-release. That is an
accepted cost — the alternative is no link at all.

## Why Apple Music search has a gap

The official Apple Music API requires a paid developer membership and a signed token. This package
uses only the free, public iTunes Search and Lookup APIs instead — no page scraping, so nothing here
depends on Apple's markup or is against Apple's terms.

The tradeoff: Apple's Search endpoint has had an open bug since September 2025 where it omits
explicit-content tracks from results entirely, no matter what the `explicit` parameter is set to.
Lookup is unaffected — a track already known by Apple ID (from a posted link, say) resolves
correctly regardless of its content rating. Only text search (`findByTrack`, going from another
platform's metadata to an Apple link with no ID yet) can return `null` for an explicit track that
genuinely exists on Apple Music, because Search's own index doesn't have it right now. See
[the open Apple Developer Forums thread](https://developer.apple.com/forums/thread/802700).

This is the first thing to check when an Apple Music text match unexpectedly comes back `null` —
confirm the track isn't simply explicit and therefore invisible to Search today.

## Why YouTube Music takes two routes

There is no official YouTube Music API — Google has never shipped one. `ytmusic-api` is used for
search: it replays requests to InnerTube, the private JSON API the YouTube Music web client itself
calls, the same approach every other YouTube Music tool takes (`ytmusicapi`, YouTube.js, and the
rest). Its `/search` endpoint is unauthenticated and works well, but it is inherently unofficial and
can break if YouTube changes that internal contract.

Reading a specific link deliberately does *not* use `ytmusic.getSong()`. YouTube's internal
`/player` endpoint requires bot verification and returns `LOGIN_REQUIRED`. The public oEmbed
endpoint returns a title and channel name without any of that, which is enough to feed the Deezer
bridge, and is a genuinely official, documented, unauthenticated endpoint rather than another
reverse-engineered one. Topic channels are named `Artist Name - Topic`, so that suffix is stripped.

## The two-layer cache

Layer 1 keys a **track's identity** to the `TrackInfo` it describes. When the provider that read
the link supports `extractId`, the key is `platform:id` — Spotify's, Tidal's, or Apple's numeric
id, Deezer's track id, YouTube's video id — so a link with a different query string or storefront
still hits the same entry. A provider without `extractId` falls back to the exact URL, which is how
every provider behaved before this existed.

Layer 2 keys an **ISRC** to the track's own name and artists plus the cross-platform links found
for it. The same recording arriving from a different platform reuses the work — the source
platform's own link is folded into the payload, so the reverse direction hits too — and only
platforms absent from the cached set are queried. Widening a request later (say, a server enables a
new service) re-queries only the newly requested platform.

### Reverse lookup: answering before any provider runs

Layer 2 alone has a gap: it only helps once you already have an ISRC, and getting one has always
meant reading the *source* link first. But by the time a track has been resolved once, its links on
every other platform are already sitting in layer 2 — including, often, the exact URL someone posts
next. If Spotify resolves and discovers a matching Apple Music link as one of its results, and
someone later posts that same Apple Music link, the ISRC for it was already known before that
message existed.

`findIsrcByLink(platform, link)` is the index that makes this useful: given a platform and an exact
link, it returns the ISRC already on file for it, if any. `resolve()` checks this before calling
`fetchTrack` at all. A hit reconstructs the result from the cached track and links with **zero**
provider calls — not even the cheap ones. The cached track's own `link` field is overwritten with
the URL just posted before it's returned, since that field was set by whichever platform originally
discovered the ISRC and may point elsewhere entirely.

This is an exact-string index, not a canonicalized one — a link that differs from the one a
provider originally returned (different query params, for instance) will not match. That's a
narrower guarantee than layer 1's canonical-id matching, and deliberately so: layer 1 knows how to
parse a provider's own link shape, but a link's *search-result* form isn't something the cache can
canonicalize on its own.

### The negative-TTL contract

This is the subtle part, and the behavior most worth preserving in any new adapter.

A complete result — every requested platform resolved to a real link — is stable and kept for 30
days. A result containing a `null` is usually a transient upstream failure, so it gets 5 minutes.

The rule that makes this work: **a partial retry never extends the short window** — but only when
the entry was *already* partial going in. Merging into an unexpired entry preserves its existing
`expiresAt` when, and only when, both (a) it already held a null before this merge and (b) it still
holds one after. Checking only the post-merge result was a real bug: a fully-resolved entry widened
with a single new miss — a newly-enabled provider's transient failure, say — would inherit the
30-day clock it earned while complete, pinning that miss for a month instead of retrying in five
minutes. Checking only the pre-merge state has the opposite failure: a partial entry that a retry
successfully completes needs the fresh 30-day TTL, not the short one it's about to outgrow. Both
conditions are required.

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

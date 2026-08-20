# Changelog

## 2026.08.21

A bigger ripple than usual. Rippie's Apple Music side got cleaned up, her matching got sharper,
and she got faster at remembering songs she's already met.

### Changed

- Rippie no longer scrapes the music.apple.com search page. Her Apple Music text search
  (`findByTrack`) now speaks only through the official, public iTunes Search and Lookup APIs.
  Worth knowing: Apple's Search endpoint has had an open bug since September 2025 where it omits
  explicit-content tracks from results regardless of the `explicit` parameter, so a small set of
  tracks can still come back `null` from text search until Apple fixes it on their end. Lookup
  (resolving a link she's already been handed) is unaffected.
- Rippie compares titles first now, and only breaks ties on artist closeness, instead of scoring
  one blended `artist - title` string. That closes a real mismatch: a track credited on Apple with
  extra collaborators the source platform never mentioned could previously lose to a completely
  unrelated song whose artist name just happened to overlap. The new matching logic lives in
  `src/match.ts` and is shared by the Apple Music and YouTube Music providers and the Deezer ISRC
  bridge, so the fix helps everywhere at once.

### Added

- Apple Music links in the newer `/song/<slug>/<id>` shape are recognized and resolved now, right
  alongside the familiar `/album/<slug>/<id>?i=<trackId>` one.
- Every built-in provider now exposes `extractId`, a stable per-track id (Spotify/Tidal/Apple's
  numeric id, Deezer's track id, YouTube's video id) instead of remembering by exact URL string.
  A link with different query-string or storefront noise now lands on the same cache entry.
- A reverse ISRC lookup: `resolve()` checks `findIsrcByLink` before calling any provider at all.
  If a posted link was already discovered as one of an earlier resolution's results, Rippie
  already knows its ISRC and track metadata, and answers instantly with zero provider calls.
- `Platform` widened to welcome custom platform names (`string & {}`), so a third-party `Provider`
  actually type-checks and resolves as a target, matching what the README's extensibility example
  already promised.

### Fixed

- A cache entry widened from fully-resolved to holding one new miss (say, a newly-enabled
  provider's transient hiccup) was inheriting the full 30-day TTL instead of the 5-minute retry
  window it should have gotten. Fixed in both the in-memory and SQLite adapters.
- SQLite adapter: expired resolved-link rows could leave orphaned children behind, since SQLite
  disables foreign key enforcement per connection by default and neither the adapter nor the
  README's own connection example turns it on. Both write paths now clean up children explicitly
  instead of trusting `ON DELETE CASCADE` to do it.
- `startPruning` no longer takes the host process down with it if a user-supplied async cache
  adapter's `prune()` rejects or throws synchronously. The rejection is caught and logged instead.

### Internal

- A codebase-wide tidy-up: no more em dashes, no more unnecessary semicolons (the formatter now
  uses `asNeeded` semicolons), and every remaining mention of scraping removed now that nothing
  here does it anymore.

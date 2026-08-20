# Contributing

Thanks for taking an interest. Issues and pull requests are both welcome.

The most useful thing you can bring is a **new platform**. Every one you add is somewhere else a
song can land, and the `Provider` interface exists so that stays additive rather than invasive.

Open a
[provider integration issue](https://github.com/rippieapp/rippie-core/issues/new?template=integration_proposal.md)
first if the platform needs credentials or has unusual access requirements, so the shape can be
agreed before you write it.

## Getting set up

```sh
bun install
bun run check
bun run typecheck
bun test
bun run build
```

No environment variables are needed for any of that, and none should ever be. If a change makes a
test require a secret, the change is wrong, see below.

## Ground rules

1. **Nothing reads `process.env`.** Credentials and configuration arrive as arguments. This is the
   constraint that makes the package testable and embeddable. It is not negotiable.
2. **No Discord, and no assumptions about a UI.** This package returns data. Rendering it is the
   consumer's job.
3. **Nothing runtime-specific in the main entry point.** `fetch`, `URL`, `btoa`, and the standard
   library. Anything else belongs behind its own entry point, as the SQLite cache is.
4. **Lookups return `null` rather than throwing.** Rippie would rather say nothing than crash, so
   every provider swallows its own errors.
5. Follow [docs/best-practices.md](docs/best-practices.md) for TypeScript style and
   [docs/commit-conventions.md](docs/commit-conventions.md) for commit messages.
6. Read [docs/architecture.md](docs/architecture.md) before changing the cache or the resolver.
   The negative-TTL contract in particular is load-bearing and easy to break by accident.

## Adding a provider

A provider is a plain object, see `src/providers/` for five worked examples.

```ts
export const createExampleProvider = (options: ProviderOptions = {}) => {
	const fetchImpl = options.fetch ?? fetch
	// …
	return {
		platform: 'Example',
		matches: (url) => /* is this one of ours? */,
		fetchTrack: async (url) => /* our link -> TrackInfo */,
		findByIsrc: async (isrc) => /* our link for this ISRC, if we can search by ISRC */,
		findByTrack: async (track) => /* our link by text match, if we cannot */,
	}
}
```

Implement `findByIsrc` when the platform can search by ISRC, `findByTrack` when it can only match on
text, and both when either is possible, the resolver prefers ISRC. Always accept an injectable
`fetch`, the tests depend on it.

To be a fully supported built-in it also needs a URL pattern in `src/platform.ts`, an export from
`src/index.ts`, and tests. A provider that only ships in a consumer's own code needs none of that.

## Tests

`bun test`. Tests must not touch the network:

- Pure logic is tested directly.
- Providers are tested with the `mockFetch` helper in `test/mockFetch.ts`, which records requests
  and answers from a routing table.
- The pipeline is tested with stub providers and `enabled: []`, which drops every built-in so
  nothing can reach out by accident.
- Cache backends are tested by the shared conformance suite in `test/cache.test.ts`, a new adapter
  should be added to the `adapters` array there rather than tested separately.

## Releasing

Maintainers only. Versions are CalVer, `YEAR.MONTH.DAY`, with an optional `-rc1` style prerelease.

Tags are zero-padded, the npm version is not. That is not a style choice, SemVer forbids leading
zeroes in numeric identifiers, so npm rejects `2026.08.19` and accepts `2026.8.19`. The release
workflow normalizes the tag and fails if the two disagree.

| Git tag | `package.json` version | npm dist-tag |
| --- | --- | --- |
| `2026.08.19` | `2026.8.19` | `latest` |
| `2026.08.19-rc1` | `2026.8.19-rc1` | `next` |
| `2026.01.09` | `2026.1.9` | `latest` |

To cut a release: set the version in `package.json`, commit, then tag and push.

```sh
git tag 2026.08.19
git push origin 2026.08.19
```

The workflow verifies the tag against `package.json`, re-runs every check, builds, and publishes
with provenance. A prerelease publishes under the `next` dist-tag so it never becomes the default
`npm install @rippieapp/core`.

`Release` can also be re-run manually from the Actions tab against an existing tag, which is the
escape hatch if a publish fails partway.

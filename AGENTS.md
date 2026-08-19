# rippie-core - Agent Guidelines

You are assisting with `@rippieapp/core`, an MIT-licensed TypeScript package for music-link
detection and cross-platform track resolution. It is consumed by Rippie, a private Discord bot,
but knows nothing about Discord.

Rippie is referred to as "her" in this project's prose. The public docs carry a deliberate warmth —
water, ripples, one link becoming many. Keep that voice in README/CONTRIBUTING when you touch them;
keep it light in code comments and out of the API itself.

## Repository Structure

- `src/index.ts`: The public API surface. If it is not exported here, it is internal.
- `src/platform.ts`: Supported platforms and URL detection.
- `src/providers/`: One file per streaming platform integration.
- `src/resolver.ts`, `src/pipeline.ts`: Cross-platform fan-out and the cache-aware `createRippie` client.
- `src/cache/`: The `TrackCache` interface, the in-memory default, and the SQLite adapter.
- `src/cache-sqlite.ts`: The optional `@rippieapp/core/cache-sqlite` entry point.
- `examples/`: Runnable CLI scripts.
- `test/`: `bun:test` suites. Nothing here may touch the network.

## Core Rules & Workflow

1. **Writing Code?** You MUST read and follow the rules in [docs/best-practices.md](./docs/best-practices.md) before generating or modifying TypeScript code.
2. **Changing the cache or resolver?** Read [docs/architecture.md](./docs/architecture.md) first. The negative-TTL contract is load-bearing and easy to break by accident.
3. **Four constraints that are not negotiable:** nothing reads `process.env`; nothing imports Discord; the main entry point stays runtime-neutral (`fetch`/`URL`/`btoa` only); lookups return `null` rather than throwing.
4. **Review Before Committing:** After making changes, you MUST show the user a summary of every file changed and a diff-style overview.
5. **Adding Dependencies?** This package deliberately ships two runtime dependencies. Do not add more without explicit user permission.
6. **Writing Commits?** Keep commit messages concise and follow [docs/commit-conventions.md](./docs/commit-conventions.md).
7. **Public repository.** Never add private Rippie configuration, credentials, or commissioned artwork here.

# TypeScript Best Practices

This document outlines the coding standards for `@rippieapp/core`. Keep it simple, strictly typed,
and consistent.

## 1. Types & Interfaces

- **Primitives:** Always use lowercase `string`, `number`, `boolean`. Never use uppercase (`String`, `Number`).
- **Interfaces vs. Types:** Prefer `type` for aliases and unions. Use `interface` primarily for class shapes or module augmentation.
- **The `any` rule:** Do NOT use `any`. Use `unknown` if the type is truly unknown, then narrow it down with type guards.
- **Callbacks:** If a callback's return value is ignored, type its return as `void`, not `any`.

## 2. Variables & Functions

- **Const by default:** Always use `const`. Only use `let` if the variable absolutely must be reassigned (e.g., caching a token in `providers/spotify.ts`). Never use `var`.
- **Functions:** Use arrow functions (`const myFunc = () => {}`) for everything except class methods.
- **Nullability:** Prefer Optional Chaining (`obj?.prop`) and Nullish Coalescing (`value ?? fallback`).

## 3. Naming Conventions

- `camelCase` for variables, functions, and files (`appleMusic.ts`, `deezerBridge.ts`).
- `PascalCase` for Types and Interfaces (`TrackInfo`, `Provider`).
- `UPPER_SNAKE_CASE` for module constants and regex patterns (`TRACK_ID_PATTERN`, `DEFAULT_TTL_MS`).

## 4. Architecture & Clean Code

- **Async/Await:** Always use `async/await`. Avoid `.then().catch()` chains. Handle errors gracefully.
- **Factories over module state:** Anything stateful (tokens, clients, caches) is created by a factory and scoped to the instance. Module-level mutable state is not allowed — see [architecture.md](architecture.md).
- **Encapsulation:** Do not export types or helper functions unless they are actively used outside the file. Keep the public API surface small. `src/index.ts` is the contract; everything else is internal.
- **Relative imports carry `.js` extensions.** The emitted output must resolve under Node's ESM rules.
- **Comments:** Comment the _why_, not the _what_ (see `cache/types.ts` for an example of explaining _why_ the TTLs are split).

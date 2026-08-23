# AGENTS.md

Converts MongoDB-style query DSL to Prisma query objects. Single entrypoint: `src/index.ts` (exports `mongoToPrisma`). No runtime dependencies.

## Commands
- `npm test` — jest (ts-jest). Tests are `*.spec.ts` files (regex `.*\.spec\.ts$`).
- Run one test file: `npx jest src/index.spec.ts`
- `npm run build` — `tsc` compiles to `dist/` (also emits `dist/index.d.ts`). No bundler.
- `npm publish` triggers `prepublishOnly` → auto `build`. No separate lint/typecheck/format scripts exist; do not assume `npm run lint`.

## Conventions
- Module system is **CommonJS** (`tsconfig` `module: CommonJS`, `baseUrl: ./src`). Import locally with `require`, not ESM.
- `tsconfig` is intentionally lenient: `strictNullChecks`, `noImplicitAny`, `strictBindCallApply` all **false**. Don't "fix" these or tighten types without reason.
- `dist/` is build output; `.gitignore` only ignores `node_modules/`. Build artifacts are not committed.

## DSL behavior (don't break these)
- `mongoToPrisma(query, context)` takes a structured query + a `context` object for variable substitution.
- Context variable refs start with `$`: `$foo.bar`, plus special keys `$date` (`now`, `now-7d`, etc.) and `$iterator`. `$context.foo` is accepted but the `$context` prefix is stripped (redundant).
- `where` short syntax: `"$gt:18"` → `{ gt: 18 }` via `preprocessWhereClause` (runs before substitution so it is not mistaken for a context var).
- `include`/`select` accept a comma string (`"a,b"`) or JSON/object; nested relations capped at `MAX_DEPTH = 2` (deeper includes/selects stripped — DoS mitigation).
- `mapWhere` adds `mode: 'insensitive'` for `contains`/`startsWith`/`endsWith`.
- Pass-through heuristic: if a query has no `entity`/`type` and no Prisma keys (`where`, `data`, `include`, ...), it is returned as a sanitized plain object (used for templates / `$expr` results), not wrapped in Prisma structure.
- All `undefined` values are stripped recursively by `sanitizeObject` before return.

## Verification
After changing `src/index.ts`, run `npm test`. Add/extend cases in `src/index.spec.ts` (mirrors the Feedback Service DSL) rather than creating new spec files.

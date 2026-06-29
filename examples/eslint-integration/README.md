# apex-lint × ESLint example

Runs apex-lint's rules through ESLint (flat config) on `.cls`/`.trigger` files.

```bash
# from this directory:
npx eslint .
```

`eslint.config.mjs` spreads `@cloudalgo/eslint-plugin-apex`'s `flatConfigs.recommended`,
which registers the Apex parser + all rules for `**/*.cls` and `**/*.trigger`.
`force-app/classes/Sample.cls` contains intentional violations (and one safe case).

Expected output: `SoqlInLoop`, `ApexSOQLInjection`, `DatabaseQueryWithVariable` (errors)
and `EmptyCatchBlock` (warning); ESLint exits 1. The bind-variable `safe()` method is
not flagged.

## Known limitation

`UnguardedCrudOperation` (the only metadata-dependent rule) does **not** fire through
ESLint: the plugin binds a `NullMetadataProvider` at module-load time, so the
`apex/metadataRoot` setting from flat config is never read. Tracked as a follow-up —
the adapter should build the provider from `context.settings` at lint time. The CLI
(`apex-lint --metadata-root …`) runs this rule normally.

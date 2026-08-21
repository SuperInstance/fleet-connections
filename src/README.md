# Fleet Connections — Source

Seven TypeScript connection modules — each one a wire between two fleet repos.

## Structure

```
src/
├── connections/
│   ├── 01-mud-oq.ts          — mud-engine ↔ elephant
│   ├── 02-hermes-sync.ts     — hermes-avatar ↔ hermes-cloudflare
│   ├── 03-zeroclaw-tap.ts    — zeroclaw ↔ the-tap
│   ├── 04-cu-corpus.ts       — collective-unconscious ↔ ai-writings
│   ├── 05-smp-ollama.ts      — SMP notebook ↔ local Ollama
│   ├── 06-emergence-tap.ts   — the-tap ↔ emergence-engine
│   └── 07-seed-cu.ts         — seed-logger ↔ collective-unconscious
└── tests/
    └── connections.test.ts   — shared connection assertions
```

## Patterns

Each connection module follows the same structure:

1. **Type mirrors** — Inline copies of types from both repos (cross-repo imports can't resolve at test time)
2. **Adapter functions** — Pure functions that translate type A → type B
3. **Integration helpers** — Optional functions that make live API calls for real-world use

## Related

- [Fleet Connections README](../README.md)
- [Integration tests](../../tests/)

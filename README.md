# Fleet Connections

**The integration layer wiring the fleet repos into one running system.**

## What This Is

Fleet Connections is the keel — the structural beam running the length of the ship. Each connection module wires together two or more fleet repos, translating types and protocols between them.

## Connection Modules

| # | Module | Connection | Description |
|---|--------|------------|-------------|
| 01 | `mud-oq` | mud-engine ↔ officers-quarters | Loads OQ's 12 rooms into a mud-engine World instance |
| 02 | `hermes-sync` | hermes-perception ↔ hermes-cloudflare | Converts ReferenceFrames to D1 storage format |
| 03 | `zeroclaw-tap` | zeroclaw ↔ the-tap | Posts ZeroClaw outputs to The Tap as conversation lines |
| 04 | `cu-corpus` | collective-unconscious | Parses markdown writings into embedding-ready chunks |
| 05 | `smp-ollama` | SMP ↔ local Ollama | Creates probe cells for local model experimentation |
| 06 | `emergence-tap` | the-tap ↔ emergence-engine | Converts Tap messages into group dynamics events |
| 07 | `seed-cu` | seed logger ↔ collective-unconscious | Logs and embeds agent state seeds |

## The Full Fleet Loop

```
1. Hermes captures a frame (hermes-perception)
2. Frame stored in D1 (hermes-cloudflare)
3. Notable observation posted to The Tap (zeroclaw-tap)
4. NPC Barnacle reacts (the-tap)
5. Conversation logged in collective unconscious (cu-corpus)
6. Emergence detector notices the interaction pattern (emergence-tap)
7. Seed logger records Hermes's state after the interaction (seed-cu)
```

## Status

- **Created:** August 9, 2026
- **Connection modules:** 7
- **Integration test:** Full fleet loop simulation
- **Repository:** SuperInstance/fleet-connections

## Development

```bash
npm install
npm test
```

## License

MIT

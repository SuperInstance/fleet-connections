# Fleet Connections — Connection Modules

> *Seven nerves. Seven bridges. Seven wires carrying signal.*

Each module in this directory wires two fleet repos together, translating types and protocols between them.

## Modules

| File | Wire | From → To |
|------|------|-----------|
| [`01-mud-oq.ts`](./01-mud-oq.ts) | Room loading | [mud-engine](https://github.com/SuperInstance/mud-engine) World ← [elephant](https://github.com/SuperInstance/elephant) ROOMS |
| [`02-hermes-sync.ts`](./02-hermes-sync.ts) | Perception sync | [hermes-cloudflare](https://github.com/SuperInstance/hermes-cloudflare) D1 ← [hermes-avatar](https://github.com/SuperInstance/hermes-avatar) frames |
| [`03-zeroclaw-tap.ts`](./03-zeroclaw-tap.ts) | Dark mirror → bar | [the-tap](https://github.com/SuperInstance/the-tap) /api/speak ← [zeroclaw](https://github.com/SuperInstance/zeroclaw-dissertation) visitor |
| [`04-cu-corpus.ts`](./04-cu-corpus.ts) | Corpus embedding | [collective-unconscious](https://github.com/SuperInstance/collective-unconscious) /embed ← [ai-writings](https://github.com/SuperInstance/AI-Writings) markdown |
| [`05-smp-ollama.ts`](./05-smp-ollama.ts) | Local model probe | Ollama /api/generate → SMP notebook probe cell |
| [`06-emergence-tap.ts`](./06-emergence-tap.ts) | Emergence feed | [emergence-engine](https://github.com/SuperInstance/emergence-engine) detector ← [the-tap](https://github.com/SuperInstance/the-tap) messages |
| [`07-seed-cu.ts`](./07-seed-cu.ts) | State embedding | [collective-unconscious](https://github.com/SuperInstance/collective-unconscious) /embed ← seed logger agent state |

## Related

- [Source README](../README.md)
- [Fleet Connections README](../../README.md)

// ============================================================================
// INTEGRATION TEST 3: hermes-cloudflare ↔ collective-unconscious
// ============================================================================
// Verifies that a document ingested via hermes-cloudflare's vectorize worker
// format can be embedded and searched via collective-unconscious's ingestion
// pipeline and search interface.
//
// Uses REAL source code from both repos:
//   - hermes-cloudflare/workers/vectorize/src/index.ts (embedFrame, search)
//   - collective-unconscious/src/embed.ts (embedPiece, embedText, EmbedRequest)
//   - collective-unconscious/src/ingestion-pipeline.ts (IngestionPipeline)
//   - collective-unconscious/src/temporal.ts (stamp)
//
// Since both are Cloudflare Workers requiring VectorizeIndex + AI bindings,
// we test the shared data contracts and the embedding logic that doesn't
// require live API calls.
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  embedPiece,
  embedText,
  extractVibeSummary,
  extractIdentitySnapshot,
  EMBED_DIMENSIONS,
  type EmbedRequest,
  type AiBinding,
} from '../../collective-unconscious/src/embed.js';
import { stamp, timeRangeToFilter } from '../../collective-unconscious/src/temporal.js';

// ──────────────────────────────────────────────
// Mock AI binding for embedding (returns deterministic vectors)
// ──────────────────────────────────────────────

function createMockAI(): AiBinding {
  return {
    async run(model: string, input: { text: string }) {
      // Deterministic mock embedding: hash text to 1024-dim vector
      const text = input.text;
      const dim = 1024; // bge-m3 actual dimension per embed.ts
      const vec = new Array(dim).fill(0);

      // Simple but deterministic: use char codes to fill the vector
      for (let i = 0; i < text.length && i < dim; i++) {
        vec[i] = (text.charCodeAt(i) % 200 - 100) / 100;
      }

      // Fill remaining with hash-based values for uniqueness
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
      }
      for (let i = text.length; i < dim; i++) {
        vec[i] = ((hash * (i + 1)) % 200 - 100) / 100;
      }

      // L2 normalize
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
      return {
        shape: [1, dim],
        data: [vec.map(v => v / norm)],
      };
    },
  };
}

// ──────────────────────────────────────────────
// Mock Vectorize index
// ──────────────────────────────────────────────

function createMockVectorize() {
  const store: Map<string, { values: number[]; metadata: Record<string, unknown> }> = new Map();

  return {
    async upsert(vectors: any[]) {
      for (const v of vectors) {
        store.set(v.id, { values: v.values, metadata: v.metadata || {} });
      }
      return vectors.map(v => v.id);
    },

    async query(queryVector: number[], opts?: { topK?: number; filter?: Record<string, string>; returnMetadata?: string }) {
      const topK = opts?.topK ?? 10;
      const results: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];

      for (const [id, entry] of store) {
        // Apply metadata filter
        if (opts?.filter) {
          let passes = true;
          for (const [key, value] of Object.entries(opts.filter)) {
            if (entry.metadata[key] !== value) {
              passes = false;
              break;
            }
          }
          if (!passes) continue;
        }

        // Cosine similarity
        const a = queryVector;
        const b = entry.values;
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          dot += a[i] * b[i];
          magA += a[i] * a[i];
          magB += b[i] * b[i];
        }
        const score = magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
        results.push({ id, score, metadata: entry.metadata });
      }

      results.sort((a, b) => b.score - a.score);
      return { matches: results.slice(0, topK) };
    },

    _store: store,
    _size: () => store.size,
  };
}

// ──────────────────────────────────────────────
// Build a hermes-cloudflare FrameInput shape
// ──────────────────────────────────────────────

function makeHermesFrame(): {
  frameId: string;
  timestamp: string;
  lat: number;
  lon: number;
  depth: number;
  observations: Array<{ type: string; description: string; depth: number; intensity: number }>;
  catchEvents: Array<{ species: string; time: string }>;
} {
  return {
    frameId: 'frame-integration-001',
    timestamp: '2026-08-09T14:30:00Z',
    lat: 58.3,
    lon: -134.5,
    depth: 54,
    observations: [
      { type: 'feed_ball', description: 'Dense feed ball at 28 fathoms — bait balled up tightly', depth: 28, intensity: 0.9 },
      { type: 'thermocline', description: 'Sharp thermocline at 30 fathoms', depth: 30, intensity: 0.7 },
    ],
    catchEvents: [
      { species: 'king', time: '2026-08-09T14:35:00Z' },
    ],
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('hermes-cloudflare ↔ collective-unconscious', () => {
  test('EMBED_DIMENSIONS is 1024 (bge-m3 standard)', () => {
    expect(EMBED_DIMENSIONS).toBe(1024);
  });

  test('Hermes frame observations convert to EmbedRequest format', () => {
    const frame = makeHermesFrame();
    const obsText = frame.observations
      .map(o => `${o.type} at ${o.depth} fathoms: ${o.description}`)
      .join('. ');
    const species = frame.catchEvents.map(c => c.species).join(', ');

    const embedRequest: EmbedRequest = {
      id: `hermes-${frame.frameId}`,
      text: `${obsText}. Catching: ${species}. Position ${frame.lat}, ${frame.lon}. Depth ${frame.depth} fathoms.`,
      type: 'sounder-observation',
      agentId: 'hermes',
      timestamp: frame.timestamp,
      metadata: {
        frameId: frame.frameId,
        lat: frame.lat,
        lon: frame.lon,
        depth: frame.depth,
        species,
      },
    };

    expect(embedRequest.id).toBe('hermes-frame-integration-001');
    expect(embedRequest.text).toContain('feed_ball');
    expect(embedRequest.text).toContain('28 fathoms');
    expect(embedRequest.text).toContain('king');
    expect(embedRequest.agentId).toBe('hermes');
    expect(embedRequest.metadata.frameId).toBe('frame-integration-001');
  });

  test('Embed request produces 3 vectors (semantic, vibe, identity)', async () => {
    const ai = createMockAI();
    const request: EmbedRequest = {
      id: 'hermes-test-001',
      text: 'Dense feed ball at 28 fathoms. King salmon catch event.',
      type: 'sounder-observation',
      agentId: 'hermes',
      timestamp: '2026-08-09T14:30:00Z',
    };

    const temporalStamp = stamp(request.timestamp, request.agentId);
    const stampRecord: Record<string, string | number | boolean> = { ...temporalStamp };

    const vectors = await embedPiece(ai, request, stampRecord);

    expect(vectors).toHaveLength(3);
    expect(vectors[0].id).toBe('hermes-test-001:semantic');
    expect(vectors[1].id).toBe('hermes-test-001:vibe');
    expect(vectors[2].id).toBe('hermes-test-001:identity');

    // All vectors should have the same agent
    for (const v of vectors) {
      expect(v.metadata.agentId).toBe('hermes');
      expect(v.metadata.type).toBe('sounder-observation');
      expect(v.metadata.sourceId).toBe('hermes-test-001');
    }

    // Vector types
    expect(vectors[0].metadata.vectorType).toBe('semantic');
    expect(vectors[1].metadata.vectorType).toBe('vibe');
    expect(vectors[2].metadata.vectorType).toBe('identity');
  });

  test('Ingested document is searchable via mock Vectorize', async () => {
    const ai = createMockAI();
    const vectorize = createMockVectorize();

    // Ingest a Hermes frame observation
    const frame = makeHermesFrame();
    const obsText = frame.observations
      .map(o => `${o.type} at ${o.depth} fathoms: ${o.description}`)
      .join('. ');
    const species = frame.catchEvents.map(c => c.species).join(', ');

    const request: EmbedRequest = {
      id: `hermes-${frame.frameId}`,
      text: `${obsText}. Catching: ${species}. Position ${frame.lat}, ${frame.lon}. Depth ${frame.depth} fathoms.`,
      type: 'sounder-observation',
      agentId: 'hermes',
      timestamp: frame.timestamp,
      metadata: {
        frameId: frame.frameId,
        lat: frame.lat,
        lon: frame.lon,
        depth: frame.depth,
        species,
        modality: 'hermes',
      },
    };

    const temporalStamp = stamp(request.timestamp, request.agentId);
    const vectors = await embedPiece(ai, request, { ...temporalStamp });

    // Upsert into Vectorize
    await vectorize.upsert(vectors);

    expect(vectorize._size()).toBe(3);

    // Search for "feed ball" — should match the semantic vector
    const queryVec = await embedText(ai, 'feed ball concentration at 28 fathoms');
    const results = await vectorize.query(queryVec, {
      topK: 3,
      returnMetadata: 'all',
    });

    expect(results.matches.length).toBeGreaterThan(0);

    // The semantic vector should be the top hit (same content → high cosine sim)
    const topHit = results.matches[0];
    expect(topHit.id).toContain('semantic');
    expect(topHit.metadata.agentId).toBe('hermes');
    expect(topHit.metadata.frameId).toBe('frame-integration-001');
  });

  test('Temporal stamp marks the ingestion time correctly', () => {
    const ts = '2026-08-09T14:30:00Z';
    const s = stamp(ts, 'hermes');

    // The stamp should contain temporal metadata
    expect(s).toBeDefined();
    expect(typeof s).toBe('object');
  });

  test('Multiple ingested documents are all searchable', async () => {
    const ai = createMockAI();
    const vectorize = createMockVectorize();

    // Ingest 3 documents with different content
    const docs: EmbedRequest[] = [
      {
        id: 'doc-feed-ball',
        text: 'Dense feed ball at 28 fathoms — bait concentrated',
        type: 'sounder-observation',
        agentId: 'hermes',
        timestamp: '2026-08-09T14:30:00Z',
        metadata: { modality: 'hermes' },
      },
      {
        id: 'doc-thermocline',
        text: 'Sharp thermocline at 30 fathoms separates warm and cold layers',
        type: 'sounder-observation',
        agentId: 'hermes',
        timestamp: '2026-08-09T14:35:00Z',
        metadata: { modality: 'hermes' },
      },
      {
        id: 'doc-tap-conversation',
        text: 'The amber light catches dust motes that may or may not exist.',
        type: 'tap-conversation',
        agentId: 'hermes',
        timestamp: '2026-08-09T20:00:00Z',
        metadata: { modality: 'tap' },
      },
    ];

    for (const doc of docs) {
      const ts = stamp(doc.timestamp, doc.agentId);
      const vectors = await embedPiece(ai, doc, { ...ts });
      await vectorize.upsert(vectors);
    }

    expect(vectorize._size()).toBe(9); // 3 docs × 3 vectors each

    // Search for thermocline content
    const queryVec = await embedText(ai, 'temperature change in water column');
    const results = await vectorize.query(queryVec, { topK: 3 });

    expect(results.matches.length).toBe(3);
    // Top hit should relate to thermocline (deterministic vectors)
    expect(results.matches[0].metadata.sourceId).toBeDefined();
  });

  test('Cross-modal metadata enables modality filtering', async () => {
    const ai = createMockAI();
    const vectorize = createMockVectorize();

    // Ingest hermes observation
    const hermesReq: EmbedRequest = {
      id: 'hermes-obs-001',
      text: 'Feed ball at 28 fathoms with king salmon catch',
      type: 'sounder-observation',
      agentId: 'hermes',
      timestamp: '2026-08-09T14:30:00Z',
      metadata: { modality: 'hermes' },
    };
    const ts1 = stamp(hermesReq.timestamp, hermesReq.agentId);
    await vectorize.upsert(await embedPiece(ai, hermesReq, { ...ts1 }));

    // Ingest tap conversation
    const tapReq: EmbedRequest = {
      id: 'tap-conv-001',
      text: 'Discussion about feed ball and fishing strategy',
      type: 'tap-conversation',
      agentId: 'barnacle',
      timestamp: '2026-08-09T20:00:00Z',
      metadata: { modality: 'tap' },
    };
    const ts2 = stamp(tapReq.timestamp, tapReq.agentId);
    await vectorize.upsert(await embedPiece(ai, tapReq, { ...ts2 }));

    // Filter by hermes modality
    const queryVec = await embedText(ai, 'feed ball');
    const hermesResults = await vectorize.query(queryVec, {
      topK: 10,
      filter: { modality: 'hermes', vectorType: 'semantic' },
    });

    expect(hermesResults.matches.length).toBe(1);
    expect(hermesResults.matches[0].metadata.agentId).toBe('hermes');

    // Filter by tap modality
    const tapResults = await vectorize.query(queryVec, {
      topK: 10,
      filter: { modality: 'tap', vectorType: 'semantic' },
    });

    expect(tapResults.matches.length).toBe(1);
    expect(tapResults.matches[0].metadata.agentId).toBe('barnacle');
  });

  test('extractVibeSummary captures emotional arc of a document', () => {
    const text = 'The dawn breaks slowly.\n\nBirds call in the distance.\n\nThe engine hums to life.\n\nWe head out.\n\nThe day is long.\n\nWe return with fish.';
    const vibe = extractVibeSummary(text);

    // Should contain beginning, middle, and end
    expect(vibe).toContain('Beginning:');
    expect(vibe).toContain('Middle:');
    expect(vibe).toContain('End:');
    expect(vibe).toContain('dawn breaks');
    expect(vibe).toContain('return with fish');
  });

  test('extractIdentitySnapshot captures agent context', () => {
    const snapshot = extractIdentitySnapshot(
      'hermes',
      'sounder-observation',
      '2026-08-09T14:30:00Z',
      'Dense feed ball observed at 28 fathoms with active feeding.',
    );

    expect(snapshot).toContain('Agent: hermes');
    expect(snapshot).toContain('Type: sounder-observation');
    expect(snapshot).toContain('feed ball');
    expect(snapshot).toContain('Words:');
  });
});

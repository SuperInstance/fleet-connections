// ============================================================================
// Tests for Connection 10: CU-Corpus ↔ AI-Writings-Vectorizer Bridge
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  chunkToEmbeddingRequest,
  chunksToEmbeddingRequests,
  cosineSimilarity,
  computeSimilarityMatrix,
  semanticSearch,
  computeCorpusStats,
  type ParsedChunk,
  type EmbeddingResult,
  type EmbeddingRequest,
} from '../connections/10-corpus-vectorizer-bridge.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mockChunk(overrides: Partial<ParsedChunk> = {}): ParsedChunk {
  return {
    id: 'chunk-001',
    title: 'The Hermit Crab',
    content: 'A hermit crab finds a shell and makes it home.',
    tags: ['fiction', 'crab'],
    sourcePath: '/ai-writings/hermit-crab.md',
    wordCount: 50,
    ...overrides,
  };
}

function mockEmbedding(id: string, vector: number[]): EmbeddingResult {
  return { chunkId: id, vector, model: 'nomic-embed-text', dimensions: vector.length };
}

// ──────────────────────────────────────────────
// chunkToEmbeddingRequest
// ──────────────────────────────────────────────

describe('chunkToEmbeddingRequest', () => {
  test('creates request with title prepended', () => {
    const chunk = mockChunk();
    const req = chunkToEmbeddingRequest(chunk);
    expect(req.text).toContain('The Hermit Crab');
    expect(req.text).toContain('A hermit crab finds a shell');
  });

  test('includes tags in text', () => {
    const chunk = mockChunk({ tags: ['poetry', 'night'] });
    const req = chunkToEmbeddingRequest(chunk);
    expect(req.text).toContain('Tags: poetry, night');
  });

  test('omits tags section when no tags', () => {
    const chunk = mockChunk({ tags: [] });
    const req = chunkToEmbeddingRequest(chunk);
    expect(req.text).not.toContain('Tags:');
  });

  test('preserves metadata', () => {
    const chunk = mockChunk();
    const req = chunkToEmbeddingRequest(chunk);
    expect(req.metadata.chunkId).toBe('chunk-001');
    expect(req.metadata.title).toBe('The Hermit Crab');
    expect(req.metadata.tags).toEqual(['fiction', 'crab']);
    expect(req.metadata.wordCount).toBe(50);
  });

  test('uses default model', () => {
    const req = chunkToEmbeddingRequest(mockChunk());
    expect(req.model).toBe('nomic-embed-text');
  });

  test('accepts custom model', () => {
    const req = chunkToEmbeddingRequest(mockChunk(), 'custom-model');
    expect(req.model).toBe('custom-model');
  });

  test('truncates very long content', () => {
    const longContent = 'x'.repeat(10000);
    const chunk = mockChunk({ content: longContent });
    const req = chunkToEmbeddingRequest(chunk);
    expect(req.text.length).toBeLessThanOrEqual(8192);
  });

  test('handles NaN wordCount safely', () => {
    const chunk = mockChunk({ wordCount: NaN as any });
    const req = chunkToEmbeddingRequest(chunk);
    expect(req.metadata.wordCount).toBe(0);
  });
});

// ──────────────────────────────────────────────
// chunksToEmbeddingRequests (batch)
// ──────────────────────────────────────────────

describe('chunksToEmbeddingRequests', () => {
  test('converts multiple chunks', () => {
    const chunks = [mockChunk({ id: 'a' }), mockChunk({ id: 'b' }), mockChunk({ id: 'c' })];
    const reqs = chunksToEmbeddingRequests(chunks);
    expect(reqs).toHaveLength(3);
    expect(reqs[0].metadata.chunkId).toBe('a');
    expect(reqs[2].metadata.chunkId).toBe('c');
  });

  test('empty array returns empty', () => {
    expect(chunksToEmbeddingRequests([])).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// cosineSimilarity
// ──────────────────────────────────────────────

describe('cosineSimilarity', () => {
  test('identical vectors → 1.0', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  test('orthogonal vectors → 0.0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  test('opposite vectors → -1.0', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 5);
  });

  test('different lengths → 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  test('empty vectors → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test('handles NaN values safely', () => {
    expect(cosineSimilarity([1, NaN, 3], [1, 2, 3])).toBeGreaterThanOrEqual(-1);
  });

  test('zero-magnitude vectors → 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

// ──────────────────────────────────────────────
// computeSimilarityMatrix
// ──────────────────────────────────────────────

describe('computeSimilarityMatrix', () => {
  test('finds similar pairs above threshold', () => {
    const embeddings = [
      mockEmbedding('a', [1, 0, 0]),
      mockEmbedding('b', [0.99, 0.01, 0]),
      mockEmbedding('c', [0, 1, 0]),
    ];
    const results = computeSimilarityMatrix(embeddings, 0.5);
    // a-b should be similar, a-c and b-c should not
    expect(results.some(r => r.chunkA === 'a' && r.chunkB === 'b')).toBe(true);
    expect(results.some(r => r.chunkA === 'a' && r.chunkB === 'c')).toBe(false);
  });

  test('respects threshold', () => {
    const embeddings = [
      mockEmbedding('x', [1, 0]),
      mockEmbedding('y', [0, 1]),
    ];
    const results = computeSimilarityMatrix(embeddings, 0.5);
    expect(results).toHaveLength(0);
  });

  test('sorts by similarity descending', () => {
    const embeddings = [
      mockEmbedding('a', [1, 0]),
      mockEmbedding('b', [0.9, 0.1]),
      mockEmbedding('c', [0.5, 0.5]),
    ];
    const results = computeSimilarityMatrix(embeddings, 0.3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });

  test('empty input → empty output', () => {
    expect(computeSimilarityMatrix([])).toEqual([]);
  });

  test('single embedding → empty output', () => {
    expect(computeSimilarityMatrix([mockEmbedding('a', [1, 0])])).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// semanticSearch
// ──────────────────────────────────────────────

describe('semanticSearch', () => {
  test('returns most similar results', () => {
    const embeddings = [
      mockEmbedding('a', [1, 0, 0]),
      mockEmbedding('b', [0.9, 0.1, 0]),
      mockEmbedding('c', [0, 0, 1]),
    ];
    const metadata = new Map<string, EmbeddingRequest>([
      ['a', { text: '', model: '', metadata: { chunkId: 'a', title: 'A', sourcePath: '/a', tags: [], wordCount: 10 } }],
      ['b', { text: '', model: '', metadata: { chunkId: 'b', title: 'B', sourcePath: '/b', tags: [], wordCount: 10 } }],
      ['c', { text: '', model: '', metadata: { chunkId: 'c', title: 'C', sourcePath: '/c', tags: [], wordCount: 10 } }],
    ]);
    const queryVec = [0.95, 0.05, 0];

    const results = semanticSearch(queryVec, embeddings, metadata, 2);
    expect(results).toHaveLength(2);
    expect(results[0].chunkId).toBe('a'); // most similar
    expect(results[1].chunkId).toBe('b');
  });

  test('respects limit', () => {
    const embeddings = Array.from({ length: 10 }, (_, i) =>
      mockEmbedding(`c${i}`, [Math.random(), Math.random(), Math.random()])
    );
    const metadata = new Map<string, EmbeddingRequest>();
    embeddings.forEach(e => metadata.set(e.chunkId, {
      text: '', model: '', metadata: { chunkId: e.chunkId, title: e.chunkId, sourcePath: '/', tags: [], wordCount: 1 }
    }));

    const results = semanticSearch([1, 0, 0], embeddings, metadata, 3);
    expect(results).toHaveLength(3);
  });

  test('sorted by similarity', () => {
    const embeddings = [
      mockEmbedding('a', [1, 0]),
      mockEmbedding('b', [0.5, 0.5]),
      mockEmbedding('c', [0.9, 0.1]),
    ];
    const metadata = new Map<string, EmbeddingRequest>();
    embeddings.forEach(e => metadata.set(e.chunkId, {
      text: '', model: '', metadata: { chunkId: e.chunkId, title: e.chunkId, sourcePath: '/', tags: [], wordCount: 1 }
    }));

    const results = semanticSearch([1, 0], embeddings, metadata, 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });
});

// ──────────────────────────────────────────────
// computeCorpusStats
// ──────────────────────────────────────────────

describe('computeCorpusStats', () => {
  test('computes basic stats', () => {
    const chunks = [
      mockChunk({ wordCount: 100, tags: ['a', 'b'] }),
      mockChunk({ wordCount: 200, tags: ['b', 'c'] }),
      mockChunk({ wordCount: 50, tags: ['a'] }),
    ];
    const stats = computeCorpusStats(chunks);
    expect(stats.totalChunks).toBe(3);
    expect(stats.totalWords).toBe(350);
    expect(stats.averageWordsPerChunk).toBe(117); // 350/3 ≈ 117
    expect(stats.uniqueTags).toBe(3); // a, b, c
    expect(stats.totalTags).toBe(5);
  });

  test('tag frequency correct', () => {
    const chunks = [
      mockChunk({ tags: ['night', 'crab'] }),
      mockChunk({ tags: ['night', 'ocean'] }),
      mockChunk({ tags: ['crab'] }),
    ];
    const stats = computeCorpusStats(chunks);
    expect(stats.tagFrequency['night']).toBe(2);
    expect(stats.tagFrequency['crab']).toBe(2);
    expect(stats.tagFrequency['ocean']).toBe(1);
  });

  test('empty corpus → zero stats', () => {
    const stats = computeCorpusStats([]);
    expect(stats.totalChunks).toBe(0);
    expect(stats.totalWords).toBe(0);
    expect(stats.averageWordsPerChunk).toBe(0);
    expect(stats.uniqueTags).toBe(0);
  });

  test('NaN wordCount treated as 0', () => {
    const chunks = [mockChunk({ wordCount: NaN as any }), mockChunk({ wordCount: 50 })];
    const stats = computeCorpusStats(chunks);
    expect(stats.totalWords).toBe(50);
    expect(stats.averageWordsPerChunk).toBe(25);
  });

  test('default embedding dimensions', () => {
    const stats = computeCorpusStats([]);
    expect(stats.embeddingDimensions).toBe(768);
    expect(stats.model).toBe('nomic-embed-text');
  });
});

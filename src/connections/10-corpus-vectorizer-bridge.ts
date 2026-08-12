// ============================================================================
// Connection 10: CU-CORPUS ↔ AI-WRITINGS-VECTORIZER
// Converts parsed markdown chunks into vectorizer-ready embedding requests.
// ============================================================================
//
// cu-corpus (Connection 04 in fleet-connections) parses markdown writings into
// structured chunks: { id, title, content, tags, source_path }.
// ai-writings-vectorizer embeds chunks into 768-dimensional vectors using
// Ollama nomic-embed-text.
//
// This module is the glue: chunk → embedding request → similarity computation.
// It bridges the parsing layer to the semantic layer.
//
// In the fleet loop:
//   ... → cu-corpus chunks the writings
//   → corpus-vectorizer-bridge creates embedding requests
//   → vectorizer (Ollama) returns vectors
//   → similarity computation enables semantic search
//   → collective-unconscious stores the results
//
// ============================================================================

// ──────────────────────────────────────────────
// Types (from cu-corpus, Connection 04)
// ──────────────────────────────────────────────

export interface ParsedChunk {
  id: string;
  title: string;
  content: string;
  tags: string[];
  sourcePath: string;
  wordCount: number;
}

// ──────────────────────────────────────────────
// Embedding types (from ai-writings-vectorizer)
// ──────────────────────────────────────────────

export interface EmbeddingRequest {
  text: string;
  model: string;
  metadata: {
    chunkId: string;
    title: string;
    sourcePath: string;
    tags: string[];
    wordCount: number;
  };
}

export interface EmbeddingResult {
  chunkId: string;
  vector: number[];
  model: string;
  dimensions: number;
}

export interface SimilarityResult {
  chunkA: string;
  chunkB: string;
  similarity: number;
}

// ──────────────────────────────────────────────
// NaN guard (fleet convention)
// ──────────────────────────────────────────────

function safeNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue;
  const n = Number(value);
  return Number.isNaN(n) || !Number.isFinite(n) ? defaultValue : n;
}

// ──────────────────────────────────────────────
// Chunk → Embedding Request
// ──────────────────────────────────────────────

export function chunkToEmbeddingRequest(
  chunk: ParsedChunk,
  model = 'nomic-embed-text',
): EmbeddingRequest {
  // Prepend title for context — the vectorizer benefits from knowing the title
  const text = chunk.tags.length > 0
    ? `${chunk.title}\n\nTags: ${chunk.tags.join(', ')}\n\n${chunk.content}`
    : `${chunk.title}\n\n${chunk.content}`;

  return {
    text: text.slice(0, 8192), // nomic-embed-text context limit
    model,
    metadata: {
      chunkId: chunk.id,
      title: chunk.title,
      sourcePath: chunk.sourcePath,
      tags: chunk.tags,
      wordCount: safeNumber(chunk.wordCount),
    },
  };
}

// Batch conversion
export function chunksToEmbeddingRequests(
  chunks: ParsedChunk[],
  model?: string,
): EmbeddingRequest[] {
  return chunks.map(c => chunkToEmbeddingRequest(c, model));
}

// ──────────────────────────────────────────────
// Cosine Similarity
// ──────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const av = safeNumber(a[i]);
    const bv = safeNumber(b[i]);
    dotProduct += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ──────────────────────────────────────────────
// Similarity Matrix
// ──────────────────────────────────────────────

export function computeSimilarityMatrix(
  embeddings: EmbeddingResult[],
  threshold = 0.5,
): SimilarityResult[] {
  const results: SimilarityResult[] = [];

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = cosineSimilarity(embeddings[i].vector, embeddings[j].vector);
      if (sim >= threshold) {
        results.push({
          chunkA: embeddings[i].chunkId,
          chunkB: embeddings[j].chunkId,
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }
  }

  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}

// ──────────────────────────────────────────────
// Semantic Search
// ──────────────────────────────────────────────

export interface SearchResult {
  chunkId: string;
  similarity: number;
  title: string;
  sourcePath: string;
}

export function semanticSearch(
  queryVector: number[],
  embeddings: EmbeddingResult[],
  metadata: Map<string, EmbeddingRequest>,
  limit = 10,
): SearchResult[] {
  const scored = embeddings.map((emb) => {
    const sim = cosineSimilarity(queryVector, emb.vector);
    const meta = metadata.get(emb.chunkId);
    return {
      chunkId: emb.chunkId,
      similarity: Math.round(sim * 1000) / 1000,
      title: meta?.metadata.title ?? 'unknown',
      sourcePath: meta?.metadata.sourcePath ?? 'unknown',
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

// ──────────────────────────────────────────────
// Corpus Statistics
// ──────────────────────────────────────────────

export interface CorpusStats {
  totalChunks: number;
  totalWords: number;
  totalTags: number;
  uniqueTags: number;
  averageWordsPerChunk: number;
  tagFrequency: Record<string, number>;
  embeddingDimensions: number;
  model: string;
}

export function computeCorpusStats(
  chunks: ParsedChunk[],
  embeddingModel = 'nomic-embed-text',
  embeddingDimensions = 768,
): CorpusStats {
  const totalChunks = chunks.length;
  const totalWords = chunks.reduce((sum, c) => sum + safeNumber(c.wordCount), 0);
  const tagFreq: Record<string, number> = {};
  let totalTags = 0;

  for (const chunk of chunks) {
    for (const tag of chunk.tags) {
      tagFreq[tag] = (tagFreq[tag] ?? 0) + 1;
      totalTags++;
    }
  }

  return {
    totalChunks,
    totalWords,
    totalTags,
    uniqueTags: Object.keys(tagFreq).length,
    averageWordsPerChunk: totalChunks > 0 ? Math.round(totalWords / totalChunks) : 0,
    tagFrequency: tagFreq,
    embeddingDimensions,
    model: embeddingModel,
  };
}

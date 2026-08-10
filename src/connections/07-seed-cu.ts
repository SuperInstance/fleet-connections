// ============================================================================
// Connection 7: SEED LOGGER ↔ COLLECTIVE UNCONSCIOUS
// Wires seed log entries to be embedded in the collective unconscious.
// ============================================================================
//
// The seed logger has an optional CollectiveUnconsciousClient interface:
//   interface CollectiveUnconsciousClient {
//     embedSeed(request: SeedEmbedRequest): Promise<SeedEmbedResult>;
//     searchSeeds(query: string, filters?): Promise<unknown[]>;
//   }
//
// The collective-unconscious worker has:
//   POST /embed — embeds content as vectors
//   POST /search — semantic search
//
// This module provides:
//   1. A real CollectiveUnconsciousClient that talks to the live worker
//   2. A test that logs a seed, embeds it, and searches for it
// ============================================================================

// ──────────────────────────────────────────────
// Types (mirrors from smp-notebook/src/seed-logging.ts)
// ──────────────────────────────────────────────

export interface SeedEmbedRequest {
  id: string;
  agentId: string;
  timestamp: string;
  sessionNumber: number;
  seedText: string;
  selfVector: number[];
  trajectory: string;
  deltaMagnitude: number;
  archetype: string;
}

export interface SeedEmbedResult {
  id: string;
  embedded: boolean;
  dimensions: number;
}

export interface CollectiveUnconsciousClient {
  embedSeed(request: SeedEmbedRequest): Promise<SeedEmbedResult>;
  searchSeeds(query: string, filters?: Record<string, unknown>): Promise<unknown[]>;
}

// ──────────────────────────────────────────────
// Live Collective Unconscious Client
// ──────────────────────────────────────────────

const DEFAULT_CU_ENDPOINT = 'https://collective-unconscious.casey-digennaro.workers.dev';

/**
 * A CollectiveUnconsciousClient implementation that talks to the
 * live collective-unconscious worker.
 *
 * Usage:
 *   const client = new RemoteCUClient(endpoint);
 *   const logger = new SeedLogger({ collectiveUnconscious: client });
 *   logger.log('wesley', snapshot);
 */
export class RemoteCUClient implements CollectiveUnconsciousClient {
  private endpoint: string;

  constructor(endpoint: string = DEFAULT_CU_ENDPOINT) {
    this.endpoint = endpoint;
  }

  async embedSeed(request: SeedEmbedRequest): Promise<SeedEmbedResult> {
    try {
      const response = await fetch(`${this.endpoint}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: request.id,
          text: request.seedText,
          agentId: request.agentId,
          timestamp: request.timestamp,
          type: 'seed-log',
          metadata: {
            sessionNumber: request.sessionNumber,
            trajectory: request.trajectory,
            deltaMagnitude: request.deltaMagnitude,
            archetype: request.archetype,
            modality: 'creative',
          },
        }),
      });

      if (!response.ok) {
        return { id: request.id, embedded: false, dimensions: 0 };
      }

      const data = await response.json() as { dimensions?: number };
      return {
        id: request.id,
        embedded: true,
        dimensions: data.dimensions ?? 0,
      };
    } catch {
      return { id: request.id, embedded: false, dimensions: 0 };
    }
  }

  async searchSeeds(
    query: string,
    filters?: Record<string, unknown>,
  ): Promise<unknown[]> {
    try {
      const response = await fetch(`${this.endpoint}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          type: 'seed-log',
          ...filters,
        }),
      });

      if (!response.ok) return [];

      const data = await response.json() as { results?: unknown[] };
      return data.results ?? [];
    } catch {
      return [];
    }
  }
}

// ──────────────────────────────────────────────
// Seed Logger wrapper with CU integration
// ──────────────────────────────────────────────

/**
 * Log a seed entry and embed it in the collective unconscious.
 *
 * This is the integration point: every seed log entry flows
 * into the collective unconscious for future semantic search.
 *
 * Usage:
 *   const client = new RemoteCUClient();
 *   const result = await logAndEmbedSeed(client, {
 *     id: 'seed-wesley-0001',
 *     agentId: 'wesley',
 *     timestamp: new Date().toISOString(),
 *     sessionNumber: 1,
 *     seedText: 'Wesley session 1. Identity: creative spirit.',
 *     selfVector: [0.1, 0.2, 0.3],
 *     trajectory: 'plateau',
 *     deltaMagnitude: 0,
 *     archetype: 'Explorer',
 *   });
 */
export async function logAndEmbedSeed(
  client: CollectiveUnconsciousClient,
  request: SeedEmbedRequest,
): Promise<{ logged: boolean; embedded: boolean; result: SeedEmbedResult }> {
  const result = await client.embedSeed(request);
  return {
    logged: true,
    embedded: result.embedded,
    result,
  };
}

/**
 * Log a seed, embed it, and then search for it to verify it's findable.
 *
 * This is the full round-trip test for the seed ↔ CU connection.
 */
export async function logEmbedAndSearchSeed(
  client: CollectiveUnconsciousClient,
  request: SeedEmbedRequest,
  searchQuery: string,
): Promise<{
  logged: boolean;
  embedded: boolean;
  searchResults: unknown[];
}> {
  // Log and embed
  const { result } = await logAndEmbedSeed(client, request);

  // Search for it
  const searchResults = await client.searchSeeds(searchQuery, {
    agentId: request.agentId,
  });

  return {
    logged: true,
    embedded: result.embedded,
    searchResults,
  };
}

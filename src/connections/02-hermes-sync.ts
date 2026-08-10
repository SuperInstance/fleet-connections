// ============================================================================
// Connection 2: HERMES PERCEPTION ↔ HERMES CLOUDFLARE
// Sync script that POSTs local perception frames to the hermes-frames worker.
// ============================================================================
//
// hermes-perception captures frames locally (PerceptionCapture → PerceptionLog).
// hermes-cloudflare/workers/frames stores frames in D1 via POST /frame.
//
// This sync script bridges the two: reads local frames and POSTs them
// to the remote frames worker for persistent cloud storage.
// ============================================================================

import type { ReferenceFrame } from '../../../hermes-perception/src/reference-frame.js';

// ──────────────────────────────────────────────
// Types (mirrors from hermes-cloudflare/workers/frames)
// ──────────────────────────────────────────────

export interface FrameInput {
  id?: string;
  timestamp: string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  depth?: number;
  inside_gear_range?: number;
  screenshot_path?: string;
  sounder_low?: string;
  sounder_high?: string;
  observations?: unknown[];
  catch_events?: unknown[];
  weather?: unknown;
  metadata?: unknown;
}

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
  duration: number;
}

// ──────────────────────────────────────────────
// Frame Sync: local ReferenceFrame → remote D1
// ──────────────────────────────────────────────

/**
 * Convert a local ReferenceFrame to the API format expected by
 * the hermes-frames worker's POST /frame endpoint.
 */
export function frameToInput(frame: ReferenceFrame): FrameInput {
  return {
    id: frame.frameId,
    timestamp: frame.timestamp,
    lat: frame.position.lat,
    lon: frame.position.lon,
    sog: frame.speedAndHeading.sog,
    cog: frame.speedAndHeading.cog,
    depth: frame.depthRelationship.currentDepth,
    inside_gear_range: frame.depthRelationship.insideOperatingRange ? 1 : 0,
    observations: frame.observations.map((o) => ({
      type: o.type,
      depth: o.depth,
      intensity: o.intensity,
      description: o.description,
      confidence: o.confidence,
      frequency: o.frequency,
    })),
    catch_events: (frame.catchEvents ?? []).map((c) => ({
      species: c.species,
      gearNumber: c.gearNumber,
      time: c.time,
    })),
    weather: frame.seaTemp !== undefined || frame.wind !== undefined
      ? {
          seaTemp: frame.seaTemp,
          windSpeed: frame.wind?.speedKnots,
          windDir: frame.wind?.directionDegrees,
        }
      : undefined,
    metadata: {
      source: 'hermes-perception-sync',
      triggerReason: frame.triggerReason,
      frameSource: frame.source,
      nearestShallow: frame.depthRelationship.nearestShallow,
    },
  };
}

/**
 * POST a single frame to the hermes-frames worker.
 */
export async function postFrameToCloud(
  frame: ReferenceFrame,
  endpoint: string = 'https://hermes-frames.casey-digennaro.workers.dev',
  authKey: string = 'hermes-key',
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const input = frameToInput(frame);

  try {
    const response = await fetch(`${endpoint}/frame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authKey}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unreadable');
      return { ok: false, error: `${response.status}: ${text.slice(0, 200)}` };
    }

    const data = await response.json() as { ok: boolean; data?: { id: string } };
    return { ok: true, id: data.data?.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Sync multiple local frames to the remote store.
 *
 * Usage:
 *   const result = await syncFrames(localFrames, endpoint, authKey);
 *   // result.synced === N
 */
export async function syncFrames(
  frames: ReferenceFrame[],
  endpoint?: string,
  authKey?: string,
): Promise<SyncResult> {
  const start = Date.now();
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const frame of frames) {
    const result = await postFrameToCloud(frame, endpoint, authKey);
    if (result.ok) {
      synced++;
    } else {
      failed++;
      errors.push(`Frame ${frame.frameId}: ${result.error}`);
    }
  }

  return { synced, failed, errors, duration: Date.now() - start };
}

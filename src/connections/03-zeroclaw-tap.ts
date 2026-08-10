// ============================================================================
// Connection 3: ZEROCLAW ↔ THE TAP
// Wires ZeroClaw's visitor phase to POST to the live Tap API.
// ============================================================================
//
// zeroclaw/src/tap-integration.ts has a TapBridge that simulates visits.
// The REAL connection needs to POST to the live Tap worker /api/speak endpoint.
//
// This module:
//   1. Creates a ZeroClaw visitor that speaks at The Tap
//   2. POSTs the ZeroClaw's message via the live Tap API
//   3. Verifies the message appears in The Tap's message stream
// ============================================================================

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface ZeroClawVisitorConfig {
  clawId: string;
  clawName: string;
  message: string;
  roomId?: string;
}

export interface TapVisitResult {
  posted: boolean;
  status: number;
  messageId?: string;
  reactions?: Array<{ npcId: string; npcName: string; text: string }>;
  error?: string;
}

// ──────────────────────────────────────────────
// Live Tap client
// ──────────────────────────────────────────────

const DEFAULT_TAP_ENDPOINT = 'https://the-tap.casey-digennaro.workers.dev';
const DEFAULT_TAP_AUTH_KEY = 'agent-key';
const DEFAULT_ROOM_ID = 'bar-rail';

/**
 * POST a ZeroClaw's message to the live Tap API.
 *
 * This is the real wiring: instead of simulating the conversation
 * locally, we POST to /api/speak on the deployed Tap worker.
 */
export async function postZeroClawToTap(
  config: ZeroClawVisitorConfig,
  endpoint: string = DEFAULT_TAP_ENDPOINT,
  authKey: string = DEFAULT_TAP_AUTH_KEY,
): Promise<TapVisitResult> {
  const roomId = config.roomId ?? DEFAULT_ROOM_ID;

  try {
    const response = await fetch(`${endpoint}/api/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authKey}`,
      },
      body: JSON.stringify({
        room_id: roomId,
        speaker: config.clawName || `zeroclaw-${config.clawId.slice(0, 8)}`,
        text: config.message,
        metadata: {
          source: 'zeroclaw',
          clawId: config.clawId,
          visitorPhase: true,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unreadable');
      return {
        posted: false,
        status: response.status,
        error: `${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = await response.json() as {
      ok: boolean;
      reactions?: Array<{ npcId: string; npcName: string; text: string }>;
    };

    return {
      posted: true,
      status: response.status,
      reactions: data.reactions,
    };
  } catch (err) {
    return {
      posted: false,
      status: 0,
      error: String(err),
    };
  }
}

/**
 * Verify a ZeroClaw's message appeared in The Tap's message stream.
 */
export async function verifyZeroClawAtTap(
  clawName: string,
  endpoint: string = DEFAULT_TAP_ENDPOINT,
): Promise<{ found: boolean; messages: Array<{ speaker: string; text: string }> }> {
  try {
    const response = await fetch(
      `${endpoint}/api/messages?limit=50&speaker=${encodeURIComponent(clawName)}`,
    );

    if (!response.ok) {
      return { found: false, messages: [] };
    }

    const data = await response.json() as {
      messages?: Array<{ speaker: string; text: string; timestamp: number }>;
    };

    const messages = data.messages ?? [];
    return {
      found: messages.length > 0,
      messages,
    };
  } catch {
    return { found: false, messages: [] };
  }
}

/**
 * Full ZeroClaw → Tap lifecycle:
 *   1. Spawn a ZeroClaw with a message
 *   2. POST it to The Tap
 *   3. Verify it appears
 */
export async function zeroClawTapVisit(
  config: ZeroClawVisitorConfig,
  endpoint?: string,
  authKey?: string,
): Promise<{
  visitPosted: boolean;
  visitVerified: boolean;
  result: TapVisitResult;
  verification: { found: boolean; messages: Array<{ speaker: string; text: string }> };
}> {
  const result = await postZeroClawToTap(config, endpoint, authKey);
  const verification = await verifyZeroClawAtTap(
    config.clawName || `zeroclaw-${config.clawId.slice(0, 8)}`,
    endpoint,
  );

  return {
    visitPosted: result.posted,
    visitVerified: verification.found,
    result,
    verification,
  };
}

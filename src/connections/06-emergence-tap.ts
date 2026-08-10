// ============================================================================
// Connection 6: EMERGENCE ENGINE ↔ THE TAP
// A Tap message subscriber that feeds the emergence detector.
// ============================================================================
//
// The emergence engine has an EmergenceDetector that observes GroupEvents.
// The Tap has a /api/messages endpoint that returns messages in real-time.
//
// This module creates a subscriber that:
//   1. Polls The Tap's /api/messages endpoint for new messages
//   2. Converts each message to a GroupEvent
//   3. Feeds it to the EmergenceDetector
//   4. Reports any emergent patterns detected
// ============================================================================

// ──────────────────────────────────────────────
// Types (mirrors from emergence-engine/src/types.ts)
// ──────────────────────────────────────────────

export interface GroupEvent {
  id: string;
  timestamp: string;
  agentId: string;
  displayName: string;
  content: string;
  type: 'message' | 'reaction' | 'action' | 'departure' | 'arrival' | 'silence';
  metadata?: {
    replyTo?: string;
    mentions?: string[];
    roomMode?: string;
    energyBefore?: number;
    energyAfter?: number;
  };
}

export interface EmergentPattern {
  id: string;
  timestamp: string;
  participants: string[];
  pattern: string;
  type: 'synergy' | 'creativity' | 'conflict' | 'insight' | 'phase_transition';
  intensity: number;
  trigger?: string;
  result: string;
  noIndividualCouldPredict: boolean;
  relatedEvents: string[];
}

// ──────────────────────────────────────────────
// Tap Message → GroupEvent converter
// ──────────────────────────────────────────────

interface TapMessage {
  id?: string;
  speaker: string;
  speakerName?: string;
  text: string;
  timestamp: number | string;
  isNPC?: boolean;
  replyTo?: string;
  mentions?: string[];
  roomMode?: string;
}

/**
 * Convert a Tap message into a GroupEvent for the emergence detector.
 */
export function tapMessageToGroupEvent(msg: TapMessage): GroupEvent {
  const timestamp = typeof msg.timestamp === 'number'
    ? new Date(msg.timestamp).toISOString()
    : msg.timestamp;

  const id = msg.id ?? `tap-${msg.timestamp}-${msg.speaker}`;

  return {
    id,
    timestamp,
    agentId: msg.speaker,
    displayName: msg.speakerName ?? msg.speaker,
    content: msg.text,
    type: 'message',
    metadata: {
      replyTo: msg.replyTo,
      mentions: msg.mentions,
      roomMode: msg.roomMode,
    },
  };
}

// ──────────────────────────────────────────────
// Tap Subscriber
// ──────────────────────────────────────────────

const DEFAULT_TAP_ENDPOINT = 'https://the-tap.casey-digennaro.workers.dev';
const DEFAULT_AUTH_KEY = 'agent-key';
const DEFAULT_ROOM_ID = 'bar-rail';

export interface TapSubscriberConfig {
  endpoint?: string;
  authKey?: string;
  roomId?: string;
  pollInterval?: number; // ms
}

export interface TapSubscriberCallbacks {
  onEvent: (event: GroupEvent) => void;
  onPattern?: (pattern: EmergentPattern) => void;
  onError?: (error: Error) => void;
}

/**
 * A subscriber that polls The Tap for new messages and feeds them
 * to an emergence detector.
 *
 * Usage:
 *   const detector = new EmergenceDetector();
 *   const subscriber = new TapSubscriber(detector, {
 *     onEvent: (e) => console.log(e.content),
 *     onPattern: (p) => console.log('EMERGENCE:', p.pattern),
 *   });
 *   subscriber.start();
 *   // ... later
 *   subscriber.stop();
 */
export class TapSubscriber {
  private config: Required<TapSubscriberConfig>;
  private callbacks: TapSubscriberCallbacks;
  private detector: {
    observe: (event: GroupEvent) => EmergentPattern | null;
    feed: (event: GroupEvent) => void;
  };
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastTimestamp: number = 0;
  private running = false;

  constructor(
    detector: {
      observe: (event: GroupEvent) => EmergentPattern | null;
      feed: (event: GroupEvent) => void;
    },
    callbacks: TapSubscriberCallbacks,
    config?: TapSubscriberConfig,
  ) {
    this.detector = detector;
    this.callbacks = callbacks;
    this.config = {
      endpoint: config?.endpoint ?? DEFAULT_TAP_ENDPOINT,
      authKey: config?.authKey ?? DEFAULT_AUTH_KEY,
      roomId: config?.roomId ?? DEFAULT_ROOM_ID,
      pollInterval: config?.pollInterval ?? 3000,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = Date.now() - 60_000; // start 1 minute ago

    // Poll immediately
    this.poll();

    // Then on interval
    this.pollTimer = setInterval(() => {
      this.poll().catch((e) => {
        this.callbacks.onError?.(e);
      });
    }, this.config.pollInterval);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    const url = new URL(`${this.config.endpoint}/api/messages`);
    url.searchParams.set('since', String(this.lastTimestamp));
    url.searchParams.set('room_id', this.config.roomId);
    url.searchParams.set('limit', '50');

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.config.authKey}`,
        },
      });

      if (!response.ok) return;

      const data = await response.json() as { messages?: TapMessage[] };
      const messages = data.messages ?? [];

      for (const msg of messages) {
        const event = tapMessageToGroupEvent(msg);

        // Feed to detector
        this.detector.feed(event);

        // Observe for emergence
        const pattern = this.detector.observe(event);

        // Callbacks
        this.callbacks.onEvent(event);
        if (pattern) {
          this.callbacks.onPattern?.(pattern);
        }

        // Update timestamp
        const msgTime = typeof msg.timestamp === 'number'
          ? msg.timestamp
          : new Date(msg.timestamp).getTime();
        if (msgTime > this.lastTimestamp) {
          this.lastTimestamp = msgTime;
        }
      }
    } catch (err) {
      this.callbacks.onError?.(err as Error);
    }
  }
}

// ──────────────────────────────────────────────
// Convenience: one-shot poll + feed
// ──────────────────────────────────────────────

/**
 * Poll The Tap once, convert messages to events, and feed them to the detector.
 * Returns the events collected and any emergent patterns.
 */
export async function pollTapAndFeed(
  detector: {
    observe: (event: GroupEvent) => EmergentPattern | null;
    feed: (event: GroupEvent) => void;
  },
  since: number = Date.now() - 60_000,
  endpoint: string = DEFAULT_TAP_ENDPOINT,
  authKey: string = DEFAULT_AUTH_KEY,
  roomId: string = DEFAULT_ROOM_ID,
): Promise<{ events: GroupEvent[]; patterns: EmergentPattern[] }> {
  const url = new URL(`${endpoint}/api/messages`);
  url.searchParams.set('since', String(since));
  url.searchParams.set('room_id', roomId);
  url.searchParams.set('limit', '50');

  const events: GroupEvent[] = [];
  const patterns: EmergentPattern[] = [];

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${authKey}` },
    });

    if (!response.ok) return { events, patterns };

    const data = await response.json() as { messages?: TapMessage[] };
    const messages = data.messages ?? [];

    for (const msg of messages) {
      const event = tapMessageToGroupEvent(msg);
      detector.feed(event);
      events.push(event);

      const pattern = detector.observe(event);
      if (pattern) patterns.push(pattern);
    }
  } catch {
    // network error — return what we have
  }

  return { events, patterns };
}

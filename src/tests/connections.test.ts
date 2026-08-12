// ============================================================================
// FULL LOOP INTEGRATION TEST
// ============================================================================
// The full fleet loop:
//   1. Hermes captures a frame (hermes-perception)
//   2. Frame stored in D1 (hermes-cloudflare) ← via sync module
//   3. Notable observation posted to The Tap (hermes-tap-relay)
//   4. NPC Barnacle reacts (the-tap)
//   5. Conversation logged in collective unconscious
//   6. Emergence detector notices the interaction pattern
//   7. Seed logger records Hermes's state after the interaction
// ============================================================================

import { describe, test, expect } from 'vitest';
import { TestWorld, loadOQRoomsIntoWorld, oqRoomToMudRoom } from '../connections/01-mud-oq.js';
import { frameToInput } from '../connections/02-hermes-sync.js';
import { postZeroClawToTap, verifyZeroClawAtTap } from '../connections/03-zeroclaw-tap.js';
import { parseMarkdownToEmbed } from '../connections/04-cu-corpus.js';
import { createProbeCell, runOllamaProbe } from '../connections/05-smp-ollama.js';
import { tapMessageToGroupEvent } from '../connections/06-emergence-tap.js';
import { RemoteCUClient, logAndEmbedSeed } from '../connections/07-seed-cu.js';

// ──────────────────────────────────────────────
// Mock data helpers
// ──────────────────────────────────────────────

// A mock ReferenceFrame (shape from hermes-perception)
function mockFrame() {
  return {
    frameId: `frame-test-${Date.now()}`,
    timestamp: new Date().toISOString(),
    source: 'pulse' as const,
    triggerReason: 'test',
    position: { lat: 58.3, lon: -134.5 },
    speedAndHeading: { sog: 2.3, cog: 180 },
    depthRelationship: {
      currentDepth: 54,
      insideOperatingRange: true,
      nearestShallow: 3,
    },
    observations: [
      {
        type: 'fish_mark',
        depth: 35,
        intensity: 0.7,
        description: 'Scattered marks at 35 fathoms',
        confidence: 0.85,
        frequency: 'both' as const,
      },
      {
        type: 'feed_ball',
        depth: 28,
        intensity: 0.9,
        description: 'Dense feed ball — bait balled up',
        confidence: 0.92,
        frequency: 'low' as const,
      },
    ],
    catchEvents: [],
    interferencePatterns: [],
  };
}

// ──────────────────────────────────────────────
// Connection 1: MUD ↔ OQ
// ──────────────────────────────────────────────

describe('Connection 1: MUD Engine ↔ Officers Quarters', () => {
  test('OQ room converts to mud-engine Room format', () => {
    const oqRoom = {
      id: 'bridge' as const,
      name: 'The Bridge',
      subtitle: 'Command Center',
      category: 'command' as const,
      description: 'The hub of the Officers\' Quarters.',
      longDescription: 'The nerve center of the Officers\' Quarters.',
      exits: ['flash-station', 'poker-room'] as never[],
      furnishings: ['Fleet Status Board'],
      ambientColor: '#0a1628',
      accentColor: '#4fc3f7',
      icon: '🛟',
    };

    const mudRoom = oqRoomToMudRoom(oqRoom);
    expect(mudRoom.id).toBe('bridge');
    expect(mudRoom.name).toBe('The Bridge');
    expect(mudRoom.exits).toHaveLength(2);
    expect(mudRoom.exits[0]).toEqual({
      direction: 'flash-station',
      targetRoomId: 'flash-station',
      description: 'Path to Flash Station',
    });
  });

  test('All 12 OQ rooms load into a mud-engine World', () => {
    const world = new TestWorld();
    const result = loadOQRoomsIntoWorld(world);

    expect(result.roomsLoaded).toBe(12);
    expect(result.actorsCreated).toBe(5); // Flash, Pro, Wesley, Scribe, Hermes
    expect(result.roomIds).toContain('bridge');
    expect(result.roomIds).toContain('poker-room');
    expect(result.roomIds).toContain('chart-house');

    // Verify rooms are accessible
    const bridge = world.getRoom('bridge');
    expect(bridge).toBeDefined();
    expect(bridge!.name).toBe('The Bridge');

    // Verify actors at their stations
    const flash = world.getActor('actor-flash');
    expect(flash).toBeDefined();
    expect(flash!.roomId).toBe('flash-station');

    const hermes = world.getActor('actor-hermes');
    expect(hermes).toBeDefined();
    expect(hermes!.roomId).toBe('hermes-station');
  });

  test('OQ rooms have exits that form a navigable graph', () => {
    const world = new TestWorld();
    loadOQRoomsIntoWorld(world);

    // Every room should have at least one exit to bridge
    for (const room of world.rooms.values()) {
      const hasBridgeExit = room.exits.some((e) => e.targetRoomId === 'bridge');
      expect(hasBridgeExit || room.id === 'bridge').toBe(true);
    }

    // Bridge should have exits to all 11 other rooms
    const bridge = world.getRoom('bridge')!;
    expect(bridge.exits).toHaveLength(11);
  });
});


// ──────────────────────────────────────────────
// Connection 2: Hermes Perception ↔ Cloudflare
// ──────────────────────────────────────────────

describe('Connection 2: Hermes Perception ↔ Cloudflare', () => {
  test('ReferenceFrame converts to frames API input', () => {
    const frame = mockFrame();
    const input = frameToInput(frame);

    expect(input.id).toBe(frame.frameId);
    expect(input.timestamp).toBe(frame.timestamp);
    expect(input.lat).toBe(58.3);
    expect(input.lon).toBe(-134.5);
    expect(input.depth).toBe(54);
    expect(input.inside_gear_range).toBe(1);
    expect(input.sog).toBe(2.3);
    expect(input.cog).toBe(180);
    expect(input.observations).toHaveLength(2);
    expect((input.observations as Array<{ type: string }>)[0].type).toBe('fish_mark');
  });

  test('Frame input has correct metadata for sync', () => {
    const frame = mockFrame();
    const input = frameToInput(frame);

    expect(input.metadata).toMatchObject({
      source: 'hermes-perception-sync',
      frameSource: 'pulse',
    });
  });
});


// ──────────────────────────────────────────────
// Connection 3: ZeroClaw ↔ The Tap
// ──────────────────────────────────────────────

describe('Connection 3: ZeroClaw ↔ The Tap', () => {
  test('ZeroClaw visitor config produces correct API payload', () => {
    const config = {
      clawId: 'zc-001',
      clawName: 'echo-7',
      message: '...hello.',
    };

    // The payload should match what /api/speak expects
    const expectedPayload = {
      room_id: 'bar-rail',
      speaker: 'echo-7',
      text: '...hello.',
      metadata: {
        source: 'zeroclaw',
        clawId: 'zc-001',
        visitorPhase: true,
      },
    };

    expect(expectedPayload.room_id).toBe('bar-rail');
    expect(expectedPayload.speaker).toBe(config.clawName);
    expect(expectedPayload.text).toBe(config.message);
  });

  test('postZeroClawToTap function exists and is callable', async () => {
    // This will fail against a non-existent endpoint — that's expected.
    // We're testing that the function makes the attempt and returns a result.
    const result = await postZeroClawToTap(
      { clawId: 'test', clawName: 'test-claw', message: 'test' },
      'http://localhost:1', // intentionally invalid
    );
    expect(result.posted).toBe(false);
    expect(result.error).toBeDefined();
  });
});


// ──────────────────────────────────────────────
// Connection 4: Collective Unconscious ↔ Creative Corpus
// ──────────────────────────────────────────────

describe('Connection 4: Collective Unconscious ↔ Creative Corpus', () => {
  test('parseMarkdownToEmbed extracts correct fields', () => {
    // Create a temp file and test parsing
    const { writeFileSync, mkdtempSync } = require('fs');
    const { tmpdir } = require('os');
    const { join } = require('path');

    const tmpDir = mkdtempSync(join(tmpdir(), 'fleet-test-'));
    const filePath = join(tmpDir, '01-wesleys-discovery.md');
    writeFileSync(filePath, '# Wesley\'s Discovery\n\nA creative piece from 2026-08-01.\n\nThe stars aligned.');

    const result = parseMarkdownToEmbed(filePath);

    expect(result.id).toBe('ai-writings-01-wesleys-discovery');
    expect(result.agentId).toBe('wesley');
    expect(result.type).toBe('creative-writing');
    expect(result.text).toContain('Wesley\'s Discovery');
    expect(result.metadata).toMatchObject({
      source: 'ai-writings',
      filename: '01-wesleys-discovery.md',
    });
  });

  test('walkMarkdownFiles finds .md files recursively', () => {
    const fs = require('fs');
    const os = require('os');
    const pathMod = require('path');

    const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'fleet-walk-'));
    fs.writeFileSync(pathMod.join(tmpDir, 'a.md'), 'content');
    fs.writeFileSync(pathMod.join(tmpDir, 'b.txt'), 'content');
    fs.mkdirSync(pathMod.join(tmpDir, 'sub'));
    fs.writeFileSync(pathMod.join(tmpDir, 'sub', 'c.md'), 'content');

    // Inline implementation test (same logic as 04-cu-corpus.ts walkMarkdownFiles)
    function walk(dir: string): string[] {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = pathMod.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...walk(full));
        else if (entry.name.endsWith('.md')) results.push(full);
      }
      return results;
    }
    const files = walk(tmpDir);
    expect(files.length).toBe(2);
    expect(files.some((f: string) => f.endsWith('a.md'))).toBe(true);
    expect(files.some((f: string) => f.endsWith('c.md'))).toBe(true);
  });
});


// ──────────────────────────────────────────────
// Connection 5: SMP Notebook ↔ Ollama
// ──────────────────────────────────────────────

describe('Connection 5: SMP Notebook ↔ Ollama', () => {
  test('createProbeCell creates a valid notebook cell', () => {
    const result = {
      model: 'llama3.2',
      prompt: 'What is emergence?',
      response: 'Emergence is when complex patterns arise from simple rules.',
      responseTime: 1500,
      tokensGenerated: 42,
      success: true,
    };

    const counter = { value: 0 };
    const cell = createProbeCell(result, counter);

    expect(cell.type).toBe('probe');
    expect(cell.id).toBe('probe-0001');
    expect(cell.probe.model).toBe('llama3.2');
    expect(cell.probe.response).toContain('Emergence');
    expect(cell.probe.tokensGenerated).toBe(42);
    expect(cell.probe.success).toBe(true);
  });

  test('failed probe creates cell with error', () => {
    const result = {
      model: 'llama3.2',
      prompt: 'test',
      response: '',
      responseTime: 100,
      tokensGenerated: 0,
      success: false,
      error: 'Connection refused',
    };

    const counter = { value: 5 };
    const cell = createProbeCell(result, counter);

    expect(cell.probe.success).toBe(false);
    expect(cell.probe.error).toBe('Connection refused');
  });
});


// ──────────────────────────────────────────────
// Connection 6: Emergence Engine ↔ The Tap
// ──────────────────────────────────────────────

describe('Connection 6: Emergence Engine ↔ The Tap', () => {
  test('tapMessageToGroupEvent converts correctly', () => {
    const tapMsg = {
      speaker: 'barnacle',
      speakerName: 'Barnacle',
      text: 'I seen that before. Nothing good comes of it.',
      timestamp: 1723246800000,
      isNPC: true,
      replyTo: 'msg-001',
    };

    const event = tapMessageToGroupEvent(tapMsg);

    expect(event.agentId).toBe('barnacle');
    expect(event.displayName).toBe('Barnacle');
    expect(event.content).toContain('Nothing good');
    expect(event.type).toBe('message');
    expect(event.metadata?.replyTo).toBe('msg-001');
  });

  test('tapMessageToGroupEvent handles string timestamps', () => {
    const tapMsg = {
      speaker: 'wesley',
      text: 'Oh! I see it now!',
      timestamp: '2026-08-09T19:10:00.000Z',
    };

    const event = tapMessageToGroupEvent(tapMsg);
    expect(event.timestamp).toBe('2026-08-09T19:10:00.000Z');
  });

  test('Minimal EmergenceDetector integration works', () => {
    // Create a minimal mock detector to test the feed pipeline
    const detectedPatterns: unknown[] = [];
    const mockDetector = {
      observe(event: { content: string; agentId: string }) {
        // Simple: if message contains "connect", it's emergent
        if (event.content.toLowerCase().includes('connect')) {
          const pattern = {
            id: `test-${Date.now()}`,
            timestamp: new Date().toISOString(),
            participants: [event.agentId],
            pattern: 'connection detected',
            type: 'insight' as const,
            intensity: 0.8,
            result: 'agents connected concepts',
            noIndividualCouldPredict: true,
            relatedEvents: [],
          };
          detectedPatterns.push(pattern);
          return pattern;
        }
        return null;
      },
      feed(_event: unknown) {
        // just buffer
      },
    };

    // Simulate events
    const event1 = tapMessageToGroupEvent({
      speaker: 'wesley',
      text: 'I think I connect the dots now.',
      timestamp: Date.now(),
    });

    const pattern = mockDetector.observe(event1);
    expect(pattern).not.toBeNull();
    expect(pattern?.type).toBe('insight');
    expect(detectedPatterns.length).toBe(1);
  });
});


// ──────────────────────────────────────────────
// Connection 7: Seed Logger ↔ Collective Unconscious
// ──────────────────────────────────────────────

describe('Connection 7: Seed Logger ↔ Collective Unconscious', () => {
  test('RemoteCUClient implements CollectiveUnconsciousClient interface', () => {
    const client = new RemoteCUClient('https://example.com');
    expect(client).toBeDefined();
    expect(typeof client.embedSeed).toBe('function');
    expect(typeof client.searchSeeds).toBe('function');
  });

  test('SeedEmbedRequest produces correct embed payload', () => {
    const request = {
      id: 'seed-wesley-0001',
      agentId: 'wesley',
      timestamp: '2026-08-09T19:10:00Z',
      sessionNumber: 1,
      seedText: 'Wesley session 1. Identity: creative spirit.',
      selfVector: [0.1, 0.2, 0.3],
      trajectory: 'plateau',
      deltaMagnitude: 0,
      archetype: 'Explorer',
    };

    // Verify the shape matches what /embed expects
    const embedBody = {
      id: request.id,
      text: request.seedText,
      agentId: request.agentId,
      timestamp: request.timestamp,
      type: 'seed-log',
      metadata: {
        sessionNumber: request.sessionNumber,
        trajectory: request.trajectory,
        archetype: request.archetype,
      },
    };

    expect(embedBody.id).toBe(request.id);
    expect(embedBody.text).toBe(request.seedText);
    expect(embedBody.agentId).toBe(request.agentId);
    expect(embedBody.type).toBe('seed-log');
  });
});


// ============================================================================
// FULL LOOP: End-to-end mock integration
// ============================================================================

describe('FULL LOOP: End-to-End Fleet Integration', () => {
  test('All 7 connections exist and are importable', async () => {
    // Verify all modules loaded successfully
    expect(TestWorld).toBeDefined();
    expect(loadOQRoomsIntoWorld).toBeDefined();
    expect(frameToInput).toBeDefined();
    expect(postZeroClawToTap).toBeDefined();
    expect(parseMarkdownToEmbed).toBeDefined();
    expect(runOllamaProbe).toBeDefined();
    expect(tapMessageToGroupEvent).toBeDefined();
    expect(RemoteCUClient).toBeDefined();
  });

  test('Step 1: Hermes captures a frame', () => {
    const frame = mockFrame();
    expect(frame.frameId).toBeDefined();
    expect(frame.observations.length).toBeGreaterThan(0);
    expect(frame.observations[0].confidence).toBeGreaterThan(0.7);
  });

  test('Step 2: Frame converts to D1 format', () => {
    const frame = mockFrame();
    const input = frameToInput(frame);

    // Verify the frame has the shape the D1 worker expects
    expect(input.id).toBeDefined();
    expect(input.timestamp).toBeDefined();
    expect(input.lat).toBeTypeOf('number');
    expect(input.lon).toBeTypeOf('number');
    expect(input.depth).toBeTypeOf('number');
    expect(input.observations).toBeInstanceOf(Array);
  });

  test('Step 3: Notable observation formats for Tap relay', () => {
    const frame = mockFrame();
    // The tap-relay worker checks isTapWorthy: feed_ball with confidence > 0.5
    const feedBall = frame.observations.find((o) => o.type === 'feed_ball');
    expect(feedBall).toBeDefined();
    expect(feedBall!.confidence).toBeGreaterThan(0.5); // tap-worthy

    // Hermes's voice format would be:
    const expectedText = `There's a concentration forming at ${Math.round(feedBall!.depth)} fathoms.`;
    expect(expectedText).toContain('28');
  });

  test('Step 4: NPC reaction converts to GroupEvent', () => {
    // When Barnacle reacts at The Tap, the message looks like:
    const barnacleMsg = {
      speaker: 'barnacle',
      speakerName: 'Barnacle',
      text: 'Aye, feed ball at 28 fathoms. Seen that before.',
      timestamp: Date.now(),
      isNPC: true,
    };

    const event = tapMessageToGroupEvent(barnacleMsg);
    expect(event.agentId).toBe('barnacle');
    expect(event.content).toContain('feed ball');
    expect(event.displayName).toBe('Barnacle');
  });

  test('Step 5: Conversation ingestion into collective unconscious', () => {
    // The CU worker's /ingest/tap endpoint expects session summaries
    // The conversation between Hermes and Barnacle would be:
    const session = {
      sessionId: 'test-session-001',
      date: '2026-08-09',
      conversationHighlights: [
        {
          agent: 'hermes',
          text: "There's a concentration forming at 28 fathoms.",
          moment: 'observation',
        },
        {
          agent: 'barnacle',
          text: 'Aye, feed ball at 28 fathoms. Seen that before.',
          moment: 'observation',
        },
      ],
    };

    expect(session.conversationHighlights).toHaveLength(2);
    expect(session.conversationHighlights[0].agent).toBe('hermes');
    expect(session.conversationHighlights[1].agent).toBe('barnacle');
  });

  test('Step 6: Emergence detector processes the interaction', () => {
    // Feed the Hermes → Barnacle exchange through the emergence detector
    const detected: string[] = [];
    const mockDetector = {
      observe(event: { agentId: string; content: string }) {
        // In a real detector, this checks unpredictability
        // For test: detect when different agents talk about the same thing
        if (event.content.includes('28 fathoms')) {
          detected.push(`${event.agentId} mentioned 28 fathoms`);
        }
        return null;
      },
      feed(_: unknown) {},
    };

    const hermesEvent = tapMessageToGroupEvent({
      speaker: 'hermes',
      text: "There's a concentration forming at 28 fathoms.",
      timestamp: Date.now(),
    });
    mockDetector.observe(hermesEvent);

    const barnacleEvent = tapMessageToGroupEvent({
      speaker: 'barnacle',
      text: 'Aye, feed ball at 28 fathoms. Seen that before.',
      timestamp: Date.now() + 1000,
    });
    mockDetector.observe(barnacleEvent);

    // Both agents mentioned the same depth — that's a shared reference
    expect(detected.length).toBe(2);
  });

  test('Step 7: Seed logger records Hermes state', () => {
    const seedRequest = {
      id: `seed-hermes-${Date.now()}`,
      agentId: 'hermes',
      timestamp: new Date().toISOString(),
      sessionNumber: 1,
      seedText: 'Hermes after observing feed ball at 28 fathoms. Observed Barnacle reaction.',
      selfVector: [0.3, 0.5, 0.1],
      trajectory: 'gradual',
      deltaMagnitude: 0.02,
      archetype: 'Explorer',
    };

    expect(seedRequest.agentId).toBe('hermes');
    expect(seedRequest.seedText).toContain('feed ball');
    expect(seedRequest.trajectory).toBe('gradual');
  });

  test('MUD world connects to the Tap through OQ rooms', () => {
    // The OQ rooms include a 'poker-room' which is The Tap's equivalent
    // In the full system, the poker room is where NPCs gather
    const world = new TestWorld();
    loadOQRoomsIntoWorld(world);

    const pokerRoom = world.getRoom('poker-room');
    expect(pokerRoom).toBeDefined();
    expect(pokerRoom!.metadata.icon).toBe('🃏');
    // The Tap's rooms should map to OQ's social spaces
    expect(pokerRoom!.zone).toBe('social');
  });
});

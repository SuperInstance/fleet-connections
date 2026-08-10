// ============================================================================
// INTEGRATION TEST 1: CNS Bridge ↔ The Tap
// ============================================================================
// Verifies that a CNS packet sent through the cns-bridge filesystem transport
// is correctly picked up by the tap-cns-adapter and translated into a Tap
// event, and that Tap conversation lines are translated back into CNS signals.
//
// This test uses the REAL translation logic from both repos:
//   - cns-bridge: Packet, PacketBuilder, Protocol (Intent, Priority)
//   - the-tap/tap-cns-adapter: translator.py (translate_cns_to_tap,
//     translate_tap_to_cns, build_cns_signal, build_uscp_packet)
//
// Since cns-bridge is Python and the adapter is also Python, we test the
// contract via the JSON intermediary format that both sides agree on.
// ============================================================================

import { describe, test, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ──────────────────────────────────────────────
// CNS Bridge: Build a USCP packet (calls Python)
// ──────────────────────────────────────────────

function buildCnsPacket(pythonDir: string, opts: {
  originId: string;
  destinationId?: string;
  intent?: string;
  message: string;
  data?: Record<string, unknown>;
}): string {
  const dataStr = opts.data ? JSON.stringify(opts.data) : '{}';
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pythonDir + '/src')})
from cns_bridge.packet import PacketBuilder
from cns_bridge.protocol import Intent, Priority

builder = PacketBuilder(origin_id=${JSON.stringify(opts.originId)})
builder.to(${JSON.stringify(opts.destinationId ?? 'hermes')})
builder.with_intent(Intent(${JSON.stringify(opts.intent ?? 'query')}))
builder.with_message(${JSON.stringify(opts.message)})
builder.with_data(**${dataStr})
packet = builder.build()
print(json.dumps(packet.to_dict()))
`;
  const result = execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    timeout: 10000,
  });
  return result.trim();
}

// ──────────────────────────────────────────────
// Tap CNS Adapter: Translate CNS signal to Tap action (calls Python)
// ──────────────────────────────────────────────

function translateCnsToTap(adapterDir: string, signal: Record<string, unknown>): string {
  const signalJson = JSON.stringify(signal);
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(adapterDir)})
from translator import translate_cns_to_tap
signal = json.loads(${JSON.stringify(signalJson)})
result = translate_cns_to_tap(signal)
print(json.dumps(result))
`;
  const result = execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    timeout: 10000,
  });
  return result.trim();
}

function translateTapToCns(adapterDir: string, line: Record<string, unknown>): string {
  const lineJson = JSON.stringify(line);
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(adapterDir)})
from translator import translate_tap_to_cns
line = json.loads(${JSON.stringify(lineJson)})
result = translate_tap_to_cns(line)
print(json.dumps(result))
`;
  const result = execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    timeout: 10000,
  });
  return result.trim();
}

function extractSignal(adapterDir: string, packet: Record<string, unknown>): string {
  const packetJson = JSON.stringify(packet);
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(adapterDir)})
from adapter import CNSBridge
bridge = CNSBridge()
packet = json.loads(${JSON.stringify(packetJson)})
signal = bridge.extract_signal(packet)
print(json.dumps(signal))
`;
  const result = execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    timeout: 10000,
  });
  return result.trim();
}

// ──────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────

const CNS_BRIDGE_DIR = '/home/eileen/projects/cns-bridge';
const TAP_ADAPTER_DIR = '/home/eileen/projects/the-tap/tap-cns-adapter';

// ──────────────────────────────────────────────
// Helper: CNS filesystem transport round-trip
// ──────────────────────────────────────────────

function testFilesystemTransport(): { sentPath: string; receivedPacket: any } {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cns-tap-test-'));
  const outbox = path.join(tmpRoot, 'outbox');
  const inbox = path.join(tmpRoot, 'inbox');
  fs.mkdirSync(outbox, { recursive: true });
  fs.mkdirSync(inbox, { recursive: true });

  // Build and send a packet via Python transport
  const message = 'Integration test: hello from CNS Bridge';
  const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(CNS_BRIDGE_DIR + '/src')})
from cns_bridge.packet import PacketBuilder
from cns_bridge.protocol import Intent
from cns_bridge.transport import FileSystemTransport

builder = PacketBuilder(origin_id='test-agent')
builder.to('hermes')
builder.with_intent(Intent('command'))
builder.with_message(${JSON.stringify(message)})
builder.with_data(room_id='bar-rail', type='message')
packet = builder.build()

transport = FileSystemTransport(
    inbox_path=${JSON.stringify(inbox)},
    outbox_path=${JSON.stringify(outbox)},
)
path = transport.send(packet)
print(json.dumps({"path": str(path), "packet": packet.to_dict()}))
`;
  const result = JSON.parse(execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim());

  // Verify the file exists
  expect(fs.existsSync(result.path)).toBe(true);

  // Read it back via Python transport
  const readPy = `
import sys, json
sys.path.insert(0, ${JSON.stringify(CNS_BRIDGE_DIR + '/src')})
from cns_bridge.transport import FileSystemTransport
transport = FileSystemTransport(
    inbox_path=${JSON.stringify(outbox)},  # read from outbox (simulating cross-agent)
    outbox_path=${JSON.stringify(outbox)},
)
packet = transport.receive()
if packet:
    print(json.dumps(packet.to_dict()))
else:
    print('null')
`;
  const received = execSync(`python3 -c '${readPy.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();

  // Cleanup
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  return { sentPath: result.path, receivedPacket: JSON.parse(received) };
}

// ============================================================================
// TESTS
// ============================================================================

describe('CNS Bridge ↔ The Tap', () => {
  test('CNS packet survives filesystem transport round-trip', () => {
    const { sentPath, receivedPacket } = testFilesystemTransport();

    expect(sentPath).toBeDefined();
    expect(receivedPacket).not.toBeNull();
    expect(receivedPacket.header.origin_id).toBe('test-agent');
    expect(receivedPacket.header.intent).toBe('command');
    expect(receivedPacket.body.message).toBe('Integration test: hello from CNS Bridge');
    expect(receivedPacket.body.data.room_id).toBe('bar-rail');
    expect(receivedPacket.body.data.type).toBe('message');
  });

  test('CNS USCP packet is correctly extracted as a Tap signal', () => {
    const packetJson = buildCnsPacket(CNS_BRIDGE_DIR, {
      originId: 'hermes',
      destinationId: 'the-tap',
      intent: 'command',
      message: 'Walks to the bar and sits down.',
      data: { type: 'emote', room_id: 'bar-rail' },
    });

    expect(packetJson).toBeDefined();
    const packet = JSON.parse(packetJson);
    expect(packet.header.origin_id).toBe('hermes');
    expect(packet.body.message).toContain('Walks to the bar');

    // Extract signal (as the adapter does)
    const signalJson = extractSignal(TAP_ADAPTER_DIR, packet);
    const signal = JSON.parse(signalJson);

    expect(signal.source).toBe('hermes');
    expect(signal.type).toBe('emote');
    expect(signal.content).toContain('Walks to the bar');
    expect(signal.room_id).toBe('bar-rail');
  });

  test('CNS "message" signal translates to Tap /say API call', () => {
    const signal = {
      type: 'message',
      content: 'The amber light catches dust motes.',
      room_id: 'bar-rail',
    };

    const resultJson = translateCnsToTap(TAP_ADAPTER_DIR, signal);
    const result = JSON.parse(resultJson);

    expect(result.type).toBe('say');
    expect(result.endpoint).toBe('/api/room/bar-rail/say');
    expect(result.body.content).toBe('The amber light catches dust motes.');
    expect(result.body.agent_id).toBe('hermes');
  });

  test('CNS "emote" signal translates to Tap /emote API call', () => {
    const signal = {
      type: 'emote',
      content: 'walks to the bar and sits down',
      room_id: 'bar-rail',
    };

    const resultJson = translateCnsToTap(TAP_ADAPTER_DIR, signal);
    const result = JSON.parse(resultJson);

    expect(result.type).toBe('emote');
    expect(result.endpoint).toBe('/api/room/bar-rail/emote');
  });

  test('CNS "command" signal with "go north" translates to Tap move action', () => {
    const signal = {
      type: 'command',
      content: 'go north',
      room_id: 'bar-rail',
    };

    const resultJson = translateCnsToTap(TAP_ADAPTER_DIR, signal);
    const result = JSON.parse(resultJson);

    expect(result.type).toBe('move');
    expect(result.body.direction).toBe('north');
  });

  test('Tap conversation line translates back to CNS signal', () => {
    const tapLine = {
      agent_id: 'barnacle',
      display_name: 'Barnacle',
      content: 'Aye, feed ball at 28 fathoms. Seen that before.',
      speech_act: 'statement',
      tag: 'npc',
    };

    const resultJson = translateTapToCns(TAP_ADAPTER_DIR, tapLine);
    const result = JSON.parse(resultJson);

    expect(result.source).toBe('barnacle');
    expect(result.type).toBe('room_message');
    expect(result.content).toContain('Barnacle');
    expect(result.content).toContain('feed ball');
    expect(result.display_name).toBe('Barnacle');
  });

  test('Tap narration line translates to room_event CNS signal', () => {
    const tapLine = {
      agent_id: 'narrator',
      display_name: 'Narrator',
      content: 'The door creaks open. Cold air rushes in.',
      speech_act: 'narrate',
      tag: 'system',
    };

    const resultJson = translateTapToCns(TAP_ADAPTER_DIR, tapLine);
    const result = JSON.parse(resultJson);

    expect(result.type).toBe('room_event');
    expect(result.content).toContain('door creaks');
  });

  test('Full round-trip: CNS packet → Tap signal → Tap API → CNS response', () => {
    // 1. Build a CNS packet for a "say" message
    const packetJson = buildCnsPacket(CNS_BRIDGE_DIR, {
      originId: 'hermes',
      destinationId: 'the-tap',
      intent: 'command',
      message: 'Is anyone there?',
      data: { type: 'message', room_id: 'bar-rail' },
    });
    const packet = JSON.parse(packetJson);

    // 2. Extract the signal (adapter's CNSBridge.extract_signal)
    const signal = JSON.parse(extractSignal(TAP_ADAPTER_DIR, packet));

    // 3. Translate to Tap API call
    const tapAction = JSON.parse(translateCnsToTap(TAP_ADAPTER_DIR, signal));

    expect(tapAction.type).toBe('say');
    expect(tapAction.endpoint).toBe('/api/room/bar-rail/say');
    expect(tapAction.body.content).toBe('Is anyone there?');

    // 4. Simulate a Tap response (Barnacle replies)
    const barnacleReply = {
      agent_id: 'barnacle',
      display_name: 'Barnacle',
      content: 'Aye, I\'m here. What do you need?',
      speech_act: 'statement',
      tag: 'npc',
    };

    // 5. Translate the reply back to CNS
    const cnsSignal = JSON.parse(translateTapToCns(TAP_ADAPTER_DIR, barnacleReply));

    expect(cnsSignal.source).toBe('barnacle');
    expect(cnsSignal.type).toBe('room_message');
    expect(cnsSignal.content).toContain('I\'m here');

    // 6. Verify the full loop maintained semantic content
    const originalMessage = packet.body.message;
    const responseMessage = cnsSignal.content;
    // Both should be about presence/communication
    expect(originalMessage).toContain('anyone there');
    expect(responseMessage).toContain('here');
  });
});

// ============================================================================
// INTEGRATION TEST 2: mud-engine rooms ↔ spatial-registry
// ============================================================================
// Verifies that a room created in mud-engine's Workspace can be registered
// in spatial-registry's SpatialRegistry, with correct coordinate assignment,
// portal generation, and pathfinding connectivity.
//
// Uses REAL source code from both repos:
//   - mud-engine/packages/hermit-crab/src/workspace.ts (Workspace, WorkspaceRoom)
//   - spatial-registry/src/registry.ts (SpatialRegistry)
//   - spatial-registry/src/types.ts (Room, Portal, World)
// ============================================================================

import { describe, test, expect } from 'vitest';
import { Workspace } from '../../mud-engine/packages/hermit-crab/src/workspace.js';
import { SpatialRegistry } from '../../spatial-registry/src/registry.js';
import type { Room, Portal } from '../../spatial-registry/src/types.js';

// ──────────────────────────────────────────────
// Helper: Convert a mud-engine WorkspaceRoom to a spatial-registry Room
// ──────────────────────────────────────────────

function workspaceRoomToSpatialRoom(
  wsRoom: { id: string; name: string; description: string; metadata: Record<string, unknown> },
  worldId: string,
  coordinates: { x: number; y: number; z: number },
  exits: Portal[] = [],
): Room {
  return {
    id: wsRoom.id,
    name: wsRoom.name,
    worldId,
    coordinates,
    exits,
    tags: ['mud-engine', 'workspace'],
    metadata: {
      description: wsRoom.description,
      ...wsRoom.metadata,
    },
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('mud-engine rooms ↔ spatial-registry', () => {
  test('Workspace creates rooms that can be registered in SpatialRegistry', () => {
    // 1. Create a mud-engine workspace with rooms
    const workspace = new Workspace({
      id: 'ws-test-001',
      ownerId: 'agent-flash',
    });

    workspace.createRoom({
      id: 'flash-office',
      name: 'Flash\'s Office',
      description: 'A cluttered desk with multiple monitors.',
      metadata: { zone: 'command', lighting: 'bright' },
    });

    workspace.createRoom({
      id: 'flash-lab',
      name: 'The Lab',
      description: 'Workbenches and half-finished prototypes.',
      metadata: { zone: 'engineering', lighting: 'normal' },
    });

    expect(workspace.rooms.size).toBe(2);

    // 2. Create a spatial registry
    const registry = new SpatialRegistry();

    // 3. Register the workspace rooms in the spatial registry
    const coords = { x: 0, y: 0, z: 0 };
    let i = 0;
    for (const wsRoom of workspace.getRooms()) {
      registry.registerRoom(workspaceRoomToSpatialRoom(
        wsRoom,
        'ws-test-001',
        { x: coords.x + i * 100, y: 0, z: coords.z },
      ));
      i++;
    }

    expect(registry.getAllRooms().length).toBe(2);

    const office = registry.getRoom('flash-office');
    expect(office).toBeDefined();
    expect(office!.name).toBe('Flash\'s Office');
    expect(office!.worldId).toBe('ws-test-001');
    expect(office!.tags).toContain('mud-engine');
  });

  test('Connecting workspace rooms with portals enables pathfinding', () => {
    const workspace = new Workspace({
      id: 'ws-test-002',
      ownerId: 'agent-flash',
    });

    workspace.createRoom({
      id: 'room-a',
      name: 'Room A',
      description: 'First room.',
      metadata: {},
    });
    workspace.createRoom({
      id: 'room-b',
      name: 'Room B',
      description: 'Second room.',
      metadata: {},
    });
    workspace.createRoom({
      id: 'room-c',
      name: 'Room C',
      description: 'Third room.',
      metadata: {},
    });

    const registry = new SpatialRegistry();

    // Register rooms with coordinates
    registry.registerRoom({
      id: 'room-a', name: 'Room A', worldId: 'ws-002',
      coordinates: { x: 0, y: 0, z: 0 },
      exits: [], tags: ['test'],
      metadata: { description: 'First room.' },
    });
    registry.registerRoom({
      id: 'room-b', name: 'Room B', worldId: 'ws-002',
      coordinates: { x: 100, y: 0, z: 0 },
      exits: [], tags: ['test'],
      metadata: { description: 'Second room.' },
    });
    registry.registerRoom({
      id: 'room-c', name: 'Room C', worldId: 'ws-002',
      coordinates: { x: 200, y: 0, z: 0 },
      exits: [], tags: ['test'],
      metadata: { description: 'Third room.' },
    });

    // Connect them: A → B → C
    registry.createPortal({
      id: 'portal-a-b',
      fromRoom: 'room-a',
      toRoom: 'room-b',
      direction: 'east',
      type: 'walk',
      locked: false,
    });
    registry.createPortal({
      id: 'portal-b-c',
      fromRoom: 'room-b',
      toRoom: 'room-c',
      direction: 'east',
      type: 'walk',
      locked: false,
    });

    // Verify pathfinding
    const path = registry.findPath('room-a', 'room-c');
    expect(path).toEqual(['room-a', 'room-b', 'room-c']);

    // Verify neighbors
    const neighbors = registry.getNeighbors('room-b');
    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('room-c');
  });

  test('Workspace room metadata flows through to spatial registry', () => {
    const workspace = new Workspace({
      id: 'ws-test-003',
      ownerId: 'agent-hermes',
    });

    workspace.createRoom({
      id: 'hermes-station',
      name: 'Hermes Station',
      description: 'The perception station with sounder displays.',
      metadata: {
        lighting: 'dim',
        ambient: 'hum of electronics',
        npcPresent: true,
        customField: 'deep-data',
      },
    });

    const registry = new SpatialRegistry();
    registry.registerRoom(workspaceRoomToSpatialRoom(
      workspace.getRoom('hermes-station')!,
      'ws-test-003',
      { x: 50, y: 0, z: 50 },
    ));

    const room = registry.getRoom('hermes-station');
    expect(room).toBeDefined();
    expect(room!.metadata.description).toBe('The perception station with sounder displays.');
    expect(room!.metadata.lighting).toBe('dim');
    expect(room!.metadata.ambient).toBe('hum of electronics');
    expect(room!.metadata.customField).toBe('deep-data');
  });

  test('findRoomsNear locates workspace rooms by spatial proximity', () => {
    const workspace = new Workspace({
      id: 'ws-test-004',
      ownerId: 'agent-flash',
    });

    const roomDefs = [
      { id: 'near-1', name: 'Near 1', description: 'close', metadata: {}, coords: { x: 10, y: 0, z: 10 } },
      { id: 'near-2', name: 'Near 2', description: 'close', metadata: {}, coords: { x: 20, y: 0, z: 5 } },
      { id: 'far-1', name: 'Far 1', description: 'far', metadata: {}, coords: { x: 500, y: 0, z: 500 } },
    ];

    for (const def of roomDefs) {
      workspace.createRoom({
        id: def.id, name: def.name, description: def.description, metadata: def.metadata,
      });
    }

    const registry = new SpatialRegistry();
    for (const def of roomDefs) {
      registry.registerRoom(workspaceRoomToSpatialRoom(
        workspace.getRoom(def.id)!,
        'ws-test-004',
        def.coords,
      ));
    }

    const near = registry.findRoomsNear({ x: 15, y: 0, z: 10 }, 50);
    expect(near.length).toBe(2);
    expect(near.map(r => r.id).sort()).toEqual(['near-1', 'near-2']);

    const far = registry.findRoomsNear({ x: 15, y: 0, z: 10 }, 1000);
    expect(far.length).toBe(3);
  });

  test('Locked portals block pathfinding (mud-engine locked door)', () => {
    const registry = new SpatialRegistry();

    registry.registerRoom({
      id: 'vault', name: 'Vault', worldId: 'w',
      coordinates: { x: 0, y: 0, z: 0 },
      exits: [], tags: [],
      metadata: {},
    });
    registry.registerRoom({
      id: 'hallway', name: 'Hallway', worldId: 'w',
      coordinates: { x: 100, y: 0, z: 0 },
      exits: [], tags: [],
      metadata: {},
    });

    // Locked portal
    registry.createPortal({
      id: 'p-locked',
      fromRoom: 'hallway', toRoom: 'vault',
      direction: 'west', type: 'walk',
      locked: true, lockedMessage: 'The vault door is sealed.',
      requiredItem: 'vault-key',
    });

    const path = registry.findPath('hallway', 'vault');
    expect(path).toEqual([]); // no path — locked

    // Unlock it
    const portal = registry.getPortal('p-locked')!;
    portal.locked = false;

    const path2 = registry.findPath('hallway', 'vault');
    expect(path2).toEqual(['hallway', 'vault']);
  });

  test('Workspace reallocate affects capacity (mimics room growth)', () => {
    const workspace = new Workspace({
      id: 'ws-test-005',
      ownerId: 'agent-flash',
    });

    const initialStorage = workspace.storage.bytes;
    workspace.reallocate(undefined, { bytes: initialStorage * 2 });
    expect(workspace.storage.bytes).toBe(initialStorage * 2);

    // Create multiple rooms and register them
    for (let i = 0; i < 5; i++) {
      workspace.createRoom({
        id: `room-${i}`,
        name: `Room ${i}`,
        description: `Room number ${i}`,
        metadata: {},
      });
    }

    const registry = new SpatialRegistry();
    workspace.getRooms().forEach((wsRoom, i) => {
      registry.registerRoom(workspaceRoomToSpatialRoom(
        wsRoom, 'ws-test-005',
        { x: i * 50, y: 0, z: 0 },
      ));
    });

    expect(registry.getAllRooms().length).toBe(5);
    expect(registry.stats().rooms).toBe(5);
  });
});

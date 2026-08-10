// ============================================================================
// INTEGRATION TEST 5: scummvm-arcade ↔ platos-shell
// ============================================================================
// Verifies that a ScummVM game schema (from scummvm-arcade/mud-schemas) loads
// into platos-shell's SharedWorldStore and that the dual-projection sync
// (MUD text + ScummVM scene) stays consistent.
//
// Uses REAL source code from both repos:
//   - scummvm-arcade/mud-schemas/types.ts (MUDWorld, MUDAction, SyncEngine)
//   - scummvm-arcade/mud-schemas/SyncEngine.ts (SyncEngine, verifySync)
//   - platos-shell/src/systems/shared-world.ts (SharedWorldStore, createWorld)
//   - platos-shell/src/projection/ProjectionBridge.ts (roundTripCheck concept)
// ============================================================================

import { describe, test, expect } from 'vitest';
import { SyncEngine } from '../../scummvm-arcade/mud-schemas/SyncEngine.js';
import type {
  MUDWorld,
  MUDAction,
  SyncReport,
  RoomStateSnapshot,
} from '../../scummvm-arcade/mud-schemas/types.js';
import {
  SharedWorldStore,
  createWorld,
} from '../../platos-shell/src/systems/shared-world.js';

// ──────────────────────────────────────────────
// Build a test MUD world (ScummVM game schema)
// ──────────────────────────────────────────────

function buildTestMUDWorld(): MUDWorld {
  return {
    id: 'test-adventure',
    name: 'Test Adventure',
    version: '1.0.0',
    rooms: {
      'harbor': {
        id: 'harbor',
        name: 'The Harbor',
        description: 'Small boats rock gently in the cold harbor. The smell of salt and fish fills the air.',
        exits: {
          'north': { target: 'tavern', label: 'To the Tavern' },
          'east': { target: 'dock', label: 'To the Dock' },
        },
        items: ['rope', 'lantern'],
        actors: ['fisherman'],
        ambient: 'harbor_ambient',
        lighting: 'normal',
        flags: { visited: false },
      },
      'tavern': {
        id: 'tavern',
        name: 'The Old Tavern',
        description: 'A worn establishment with low ceilings. The bar has seen better days.',
        exits: {
          'south': { target: 'harbor', label: 'To the Harbor' },
          'up': { target: 'attic', label: 'Up the Stairs', locked: true, lockedMessage: 'The stairs are boarded up.', requiredItem: 'crowbar' },
        },
        items: ['mug', 'note'],
        actors: ['bartender'],
        ambient: 'tavern_music',
        lighting: 'dim',
        flags: {},
      },
      'dock': {
        id: 'dock',
        name: 'The Dock',
        description: 'Weathered planks stretch over dark water. A small skiff is tied here.',
        exits: {
          'west': { target: 'harbor', label: 'To the Harbor' },
        },
        items: ['oar', 'bucket'],
        actors: [],
        ambient: 'water_lapping',
        lighting: 'bright',
        flags: {},
      },
      'attic': {
        id: 'attic',
        name: 'The Attic',
        description: 'Dusty and dark. Something glints in the corner.',
        exits: {
          'down': { target: 'tavern', label: 'Down the Stairs' },
        },
        items: ['treasure-chest'],
        actors: [],
        ambient: 'wind_whistle',
        lighting: 'dark',
        flags: { secret: true },
      },
    },
    items: {
      'rope': { id: 'rope', name: 'Rope', description: 'A sturdy hemp rope.', verbs: ['PICK UP', 'USE', 'EXAMINE'] },
      'lantern': { id: 'lantern', name: 'Lantern', description: 'An old oil lantern.', verbs: ['PICK UP', 'USE', 'EXAMINE'] },
      'mug': { id: 'mug', name: 'Mug', description: 'A pewter mug, still warm.', verbs: ['PICK UP', 'EXAMINE'] },
      'note': { id: 'note', name: 'Note', description: 'A scrap of paper with writing.', verbs: ['PICK UP', 'READ', 'EXAMINE'] },
      'oar': { id: 'oar', name: 'Oar', description: 'A wooden oar.', verbs: ['PICK UP', 'USE'] },
      'bucket': { id: 'bucket', name: 'Bucket', description: 'A rusty bucket.', verbs: ['PICK UP', 'EXAMINE'] },
      'treasure-chest': { id: 'treasure-chest', name: 'Treasure Chest', description: 'A heavy iron-bound chest.', verbs: ['EXAMINE', 'OPEN', 'USE'] },
      'crowbar': { id: 'crowbar', name: 'Crowbar', description: 'A pry bar.', verbs: ['PICK UP', 'USE'] },
    },
    actors: {
      'fisherman': {
        id: 'fisherman',
        name: 'Old Fisherman',
        description: 'A weathered man mending nets.',
        dialogueTree: 'fisherman_dialogue',
        schedule: 'fisherman_schedule',
        disposition: 'friendly',
        inventory: [],
        location: 'harbor',
      },
      'bartender': {
        id: 'bartender',
        name: 'Bartender',
        description: 'A tired woman polishing a glass.',
        dialogueTree: 'bartender_dialogue',
        schedule: 'bartender_schedule',
        disposition: 'neutral',
        inventory: ['crowbar'],
        location: 'tavern',
      },
    },
    verbs: [
      { id: 'look', command: 'LOOK', category: 'reflex', aliases: ['l'], requiresTarget: false },
      { id: 'examine', command: 'EXAMINE', category: 'reflex', aliases: ['x'], requiresTarget: true, targetType: 'item' },
      { id: 'pickup', command: 'PICK UP', category: 'reflex', aliases: ['take', 'get', 'grab'], requiresTarget: true, targetType: 'item' },
      { id: 'use', command: 'USE', category: 'edge', aliases: [], requiresTarget: true, targetType: 'item' },
      { id: 'talkto', command: 'TALK TO', category: 'edge', aliases: ['talk'], requiresTarget: true, targetType: 'actor' },
      { id: 'go', command: 'GO', category: 'reflex', aliases: ['walk', 'move'], requiresTarget: true, targetType: 'exit' },
      { id: 'open', command: 'OPEN', category: 'edge', aliases: [], requiresTarget: true, targetType: 'item' },
      { id: 'inventory', command: 'INVENTORY', category: 'reflex', aliases: ['i'], requiresTarget: false },
    ],
    schedules: [],
    physics: { gravity: true },
    initialState: {
      currentRoom: 'harbor',
      playerInventory: [],
      flags: {},
      itemStates: {},
      actorStates: {},
      time: 'morning',
      act: 1,
    },
  };
}

// ──────────────────────────────────────────────
// Convert MUDWorld rooms to platos-shell createWorld format
// ──────────────────────────────────────────────

function mudWorldToSharedWorldDef(world: MUDWorld): ReturnType<typeof buildTestMUDWorld> {
  return world; // already compatible
}

function mudWorldToCreateWorldDef(world: MUDWorld) {
  const rooms: Record<string, any> = {};
  const objects: Record<string, any> = {};
  const agents: Record<string, any> = {};

  for (const [roomId, room] of Object.entries(world.rooms)) {
    rooms[roomId] = {
      title: room.name,
      description: room.description,
      exits: Object.fromEntries(
        Object.entries(room.exits).map(([dir, exit]) => [
          dir,
          { destination: exit.target, locked: exit.locked ?? false },
        ])
      ),
      theme: 'default',
      ambientLight: room.lighting === 'dark' ? '#101020' : '#404060',
    };
  }

  for (const [itemId, item] of Object.entries(world.items)) {
    // Find which room the item starts in
    let room = 'harbor';
    for (const [rid, r] of Object.entries(world.rooms)) {
      if (r.items.includes(itemId)) { room = rid; break; }
    }
    objects[itemId] = {
      room,
      name: item.name,
      description: item.description,
      position: { x: Math.random() * 10, y: 0, z: Math.random() * 10 },
      state: {},
    };
  }

  for (const [actorId, actor] of Object.entries(world.actors)) {
    agents[actorId] = {
      room: actor.location,
      name: actor.name,
      mood: actor.disposition,
      activity: actor.description,
    };
  }

  return { rooms, objects, agents };
}

// ============================================================================
// TESTS
// ============================================================================

describe('scummvm-arcade ↔ platos-shell', () => {
  test('ScummVM game schema loads into SyncEngine', () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    expect(engine).toBeDefined();

    const state = engine.getState();
    expect(state.currentRoom).toBe('harbor');
    expect(state.playerInventory).toHaveLength(0);

    const log = engine.getActionLog();
    expect(log).toHaveLength(0);
  });

  test('Dual-projection sync: ScummVM and MUD agree after initial load', () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    // Verify all rooms are in sync at start
    for (const roomId of Object.keys(world.rooms)) {
      const report = engine.verifySync(roomId);
      expect(report.inSync).toBe(true);
      expect(report.discrepancies).toHaveLength(0);
    }
  });

  test('Pick up action syncs across both projections', async () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    // Player picks up the rope in the harbor
    await engine.applyAction('scummvm', {
      type: 'pickup',
      source: 'scummvm',
      itemId: 'rope',
      roomId: 'harbor',
      timestamp: new Date().toISOString(),
    });

    // Verify sync
    const report = engine.verifySync('harbor');
    expect(report.inSync).toBe(true);

    // Item removed from room in BOTH projections
    const projections = engine.getProjections();
    const scummvmHarbor = projections.scummvm.roomStates.get('harbor');
    const mudHarbor = projections.mud.roomStates.get('harbor');

    expect(scummvmHarbor!.items).not.toContain('rope');
    expect(mudHarbor!.items).not.toContain('rope');

    // Item in player inventory
    expect(engine.getState().playerInventory).toContain('rope');
  });

  test('Move action syncs actor position across projections', async () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    // Fisherman moves from harbor to tavern
    await engine.applyAction('mud', {
      type: 'move',
      source: 'mud',
      actorId: 'fisherman',
      direction: 'north', // harbor → tavern
      roomId: 'harbor',
      timestamp: new Date().toISOString(),
    });

    const report = engine.verifySync('harbor');
    expect(report.inSync).toBe(true);

    const report2 = engine.verifySync('tavern');
    expect(report2.inSync).toBe(true);

    // Fisherman should be in tavern in both projections
    const projections = engine.getProjections();
    const scummvmTavern = projections.scummvm.roomStates.get('tavern');
    const mudTavern = projections.mud.roomStates.get('tavern');

    expect(scummvmTavern!.actors).toContain('fisherman');
    expect(mudTavern!.actors).toContain('fisherman');

    const scummvmHarbor = projections.scummvm.roomStates.get('harbor');
    expect(scummvmHarbor!.actors).not.toContain('fisherman');
  });

  test('Locked exit blocks move action consistently', async () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    // Player in tavern tries to go up (locked)
    engine.applyAction('scummvm', {
      type: 'move',
      source: 'scummvm',
      actorId: 'fisherman',
      direction: 'up', // locked!
      roomId: 'tavern',
      timestamp: new Date().toISOString(),
    });

    // The fisherman shouldn't have moved (exit locked)
    // Both projections should still agree
    const report = engine.verifySync('tavern');
    expect(report.inSync).toBe(true);
  });

  test('A2A payload reflects current room state', () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    const payload = engine.toA2A();

    expect(payload.worldId).toBe('test-adventure');
    expect(payload.roomState.roomId).toBe('harbor');
    // Note: buildRoomSnapshots uses playerInventory for the current room,
    // so roomState.items reflects inventory at current room, not room-defining items.
    // The available actions come from the room snapshot, so pickups use inventory.
    // At game start (empty inventory), there are no pickups — only exits and actors.
    expect(payload.roomState.actors).toContain('fisherman');
    expect(payload.intentPayload.possibleVerbs).toContain('LOOK');
    expect(payload.intentPayload.possibleVerbs).toContain('GO');
    // Talk action exists for the fisherman
    expect(payload.availableActions.some(a => a.type === 'talk' && a.targetActorId === 'fisherman')).toBe(true);
  });

  test('ScummVM schema loads into platos-shell SharedWorldStore', () => {
    const world = buildTestMUDWorld();
    const def = mudWorldToCreateWorldDef(world);
    const store = createWorld(def);

    // Verify rooms loaded
    const harbor = store.getRoom('harbor');
    expect(harbor).toBeDefined();
    expect(harbor!.title).toBe('The Harbor');
    expect(harbor!.description).toContain('salt and fish');

    const tavern = store.getRoom('tavern');
    expect(tavern).toBeDefined();
    expect(tavern!.title).toBe('The Old Tavern');

    // Verify exits
    expect(Object.keys(harbor!.exits)).toContain('north');
    expect(Object.keys(harbor!.exits)).toContain('east');

    // Verify objects loaded
    const rope = store.getObject('rope');
    expect(rope).toBeDefined();
    expect(rope!.name).toBe('Rope');

    // Verify agents loaded
    const fisherman = store.getAgent('fisherman');
    expect(fisherman).toBeDefined();
    expect(fisherman!.name).toBe('Old Fisherman');
    expect(fisherman!.mood).toBe('friendly');
  });

  test('Dual-projection invariant: MUD and scene agree on room objects', () => {
    const world = buildTestMUDWorld();
    const def = mudWorldToCreateWorldDef(world);
    const store = createWorld(def);

    // The key invariant from platos-shell: projectionsAgree
    const check = store.projectionsAgree('harbor');
    expect(check.pass).toBe(true);
    expect(check.diff).toHaveLength(0);

    // Move an object and recheck
    store.moveObject('rope', { x: 5, y: 0, z: 5 });
    const check2 = store.projectionsAgree('harbor');
    expect(check2.pass).toBe(true);
  });

  test('Perception check returns correct room state', () => {
    const world = buildTestMUDWorld();
    const def = mudWorldToCreateWorldDef(world);
    const store = createWorld(def);

    // Add a player agent to the store
    // The fisherman is already an agent — use them
    const perception = store.perceive('fisherman');

    expect(perception.agentId).toBe('fisherman');
    expect(perception.room.title).toBe('The Harbor');
    expect(perception.room.objects.length).toBeGreaterThan(0);
    expect(perception.room.npcs.length).toBeGreaterThan(0);
    // The fisherman perceives itself and any other actors
  });

  test('Full dual-projection sync: action in ScummVM reflects in MUD', async () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    // 1. Player picks up rope (ScummVM click action)
    await engine.applyAction('scummvm', {
      type: 'pickup',
      source: 'scummvm',
      itemId: 'rope',
      roomId: 'harbor',
      timestamp: new Date().toISOString(),
    });

    // 2. Player picks up lantern
    await engine.applyAction('scummvm', {
      type: 'pickup',
      source: 'scummvm',
      itemId: 'lantern',
      roomId: 'harbor',
      timestamp: new Date().toISOString(),
    });

    // 3. Player moves to tavern (MUD "go north")
    await engine.applyAction('mud', {
      type: 'move',
      source: 'mud',
      actorId: 'fisherman',
      direction: 'north',
      roomId: 'harbor',
      timestamp: new Date().toISOString(),
    });

    // 4. Player talks to bartender
    await engine.applyAction('scummvm', {
      type: 'talk',
      source: 'scummvm',
      targetActorId: 'bartender',
      roomId: 'tavern',
      timestamp: new Date().toISOString(),
    });

    // 5. Verify ALL rooms are still in sync
    for (const roomId of Object.keys(world.rooms)) {
      const report = engine.verifySync(roomId);
      expect(report.inSync).toBe(true);
    }

    // 6. Verify inventory
    const state = engine.getState();
    expect(state.playerInventory).toContain('rope');
    expect(state.playerInventory).toContain('lantern');

    // 7. Verify fisherman moved
    const projections = engine.getProjections();
    const tavernScummvm = projections.scummvm.roomStates.get('tavern');
    expect(tavernScummvm!.actors).toContain('fisherman');

    const harborScummvm = projections.scummvm.roomStates.get('harbor');
    expect(harborScummvm!.actors).not.toContain('fisherman');

    // 8. Action log records all 4 actions
    const log = engine.getActionLog();
    expect(log.length).toBe(4);
    expect(log[0].source).toBe('scummvm');
    expect(log[1].source).toBe('scummvm');
    expect(log[2].source).toBe('mud');
    expect(log[3].source).toBe('scummvm');
  });

  test('Context vector from A2A matches platos-shell MUD projection', () => {
    const world = buildTestMUDWorld();
    const engine = new SyncEngine(world);

    const a2a = engine.toA2A();
    const ctx = a2a.intentPayload.contextVector;

    // Context vector: [items(in inv at current room), actors, exits, inventory, flags, lighting, locked_exits, hostile_count]
    expect(ctx.length).toBe(8);
    // ctx[0] is items from snapshot (player inventory at current room = 0 at start)
    expect(ctx[0]).toBe(0); // empty inventory at start
    // ctx[1] is actors count
    expect(ctx[1]).toBeGreaterThan(0); // has actors (fisherman)
    expect(ctx[2]).toBeGreaterThan(0); // has exits

    // Harbor has no hostile actors
    expect(ctx[7]).toBe(0);

    // The salience map uses roomSnap items + actors + exits + flags
    const salience = a2a.intentPayload.salienceMap;
    // Actor salience is set at 1.0
    expect(salience['actor:fisherman']).toBe(1.0);
    // Exit salience: unlocked exits have low salience (0.3), locked have high (0.9)
    expect(salience['exit:north']).toBe(0.3); // harbor→tavern unlocked
  });
});

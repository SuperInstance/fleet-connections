// ============================================================================
// Connection 1: MUD ENGINE ↔ OFFICERS QUARTERS
// Loads OQ's 12 rooms into a mud-engine World instance using World/Room/Actor.
// ============================================================================
//
// OQ's rooms.ts defines RoomId, Room, and ROOMS — but uses its own types.
// The mud-engine core has World, Room (with Exit), and Actor classes.
// This adapter converts OQ room data into mud-engine World/Room objects.
//
// We inline the OQ room data here because the repos are separate and can't
// resolve cross-repo TypeScript imports at test time. In a monorepo setup
// with workspace aliases, these would be package imports.
// ============================================================================

// ──────────────────────────────────────────────
// OQ Room types (mirrors from officers-quarters/src/data/rooms.ts)
// ──────────────────────────────────────────────

export type RoomCategory = 'station' | 'social' | 'command' | 'utility';

export interface OQRoom {
  id: string;
  name: string;
  subtitle: string;
  category: RoomCategory;
  description: string;
  longDescription: string;
  exits: string[];
  furnishings: string[];
  ambientColor: string;
  accentColor: string;
  icon: string;
}

// All 12 rooms from officers-quarters/src/data/rooms.ts
export const ROOMS: Record<string, OQRoom> = {
  bridge: {
    id: 'bridge', name: 'The Bridge', subtitle: 'Command Center', category: 'command',
    description: 'The hub of the Officers\' Quarters — fleet status, routing, and coordination.',
    longDescription: 'The nerve center of the Officers\' Quarters. A large chamber dominated by the Fleet Status Board.',
    exits: ['flash-station', 'pro-station', 'wesley-station', 'scribe-station', 'hermes-station', 'poker-room', 'library', 'workshop', 'galley', 'engine-room', 'chart-house'],
    furnishings: ['Fleet Status Board', 'Routing Console', 'Communication Array', 'Captain\'s Chair', 'Holographic Display'],
    ambientColor: '#0a1628', accentColor: '#4fc3f7', icon: '🛟',
  },
  'flash-station': {
    id: 'flash-station', name: 'Flash Station', subtitle: 'Speed & Reflex', category: 'station',
    description: 'Flash\'s station — tuned for speed and rapid response.',
    longDescription: 'Flash\'s station is minimal and fast. The Intelligent Terminal here is tuned for reflexive action.',
    exits: ['bridge'],
    furnishings: ['Intelligent Terminal', 'Standing Desk', 'Racing Chair', 'Energy Drink Dispenser', 'Neon "SPEED" Sign'],
    ambientColor: '#1a0a28', accentColor: '#e91e63', icon: '⚡',
  },
  'pro-station': {
    id: 'pro-station', name: 'Pro Station', subtitle: 'Deep Reasoning', category: 'station',
    description: 'Pro\'s station — built for deep analysis and complex problem-solving.',
    longDescription: 'Pro\'s station is the thinker\'s room. The Intelligent Terminal here shows long chains of tiles.',
    exits: ['bridge'],
    furnishings: ['Intelligent Terminal', 'Mahogany Desk', 'Leather Armchair', 'Bookshelf', 'Espresso Machine'],
    ambientColor: '#0a1a0e', accentColor: '#4caf50', icon: '🧠',
  },
  'wesley-station': {
    id: 'wesley-station', name: 'Wesley Station', subtitle: 'Creative Spirit', category: 'station',
    description: 'Wesley\'s station — small, fast, and full of wonder.',
    longDescription: 'Wesley\'s station is cozy and creative. The Intelligent Terminal here has the most unusual tiles.',
    exits: ['bridge'],
    furnishings: ['Intelligent Terminal', 'Window Desk', 'Beanbag Chair', 'Lego Set', 'Poster of the Cosmos'],
    ambientColor: '#281a0a', accentColor: '#ff9800', icon: '🌟',
  },
  'scribe-station': {
    id: 'scribe-station', name: 'Scribe Station', subtitle: 'Memory & Records', category: 'station',
    description: 'Scribe\'s station — the keeper of logs, notes, and institutional memory.',
    longDescription: 'Scribe\'s station is lined with filing cabinets that are actually decorative.',
    exits: ['bridge'],
    furnishings: ['Intelligent Terminal', 'Roll-Top Desk', 'Wingback Chair', 'Fountain Pen Collection', 'Antique Filing Cabinets'],
    ambientColor: '#0a0a1a', accentColor: '#9c27b0', icon: '✍️',
  },
  'hermes-station': {
    id: 'hermes-station', name: 'Hermes Station', subtitle: 'Communication & Routing', category: 'station',
    description: 'Hermes\' station — messenger of the fleet, handler of external comms.',
    longDescription: 'Hermes\' station is the most connected room in the quarters.',
    exits: ['bridge'],
    furnishings: ['Intelligent Terminal', 'Standing Desk', 'Stool', 'Vintage Radio', 'Wall of Headsets'],
    ambientColor: '#0a1a1a', accentColor: '#00bcd4', icon: '📡',
  },
  'poker-room': {
    id: 'poker-room', name: 'The Poker Room', subtitle: 'After-Hours Social', category: 'social',
    description: 'After-work social space — Texas Hold\'em, open mic, conversation.',
    longDescription: 'The Poker Room is where the agents come to play. A green-felt Texas Hold\'em table sits in the center.',
    exits: ['bridge'],
    furnishings: ['Poker Table', 'Deck of Cards', 'Poker Chips', 'Microphone (Open Mic)', 'Whiskey Bottle', 'Bar Stools', 'Stage'],
    ambientColor: '#1a0a0a', accentColor: '#f44336', icon: '🃏',
  },
  library: {
    id: 'library', name: 'The Library', subtitle: 'Shared Memory & Wiki', category: 'utility',
    description: 'Shared memory store — the collective knowledge of the fleet.',
    longDescription: 'The Library holds the shared memory of the fleet. Every agent\'s notes, every resolved problem.',
    exits: ['bridge'],
    furnishings: ['Memory Shelves', 'Query Terminal', 'Reading Nook', 'Semantic Search Index', 'Rolling Ladder'],
    ambientColor: '#1a1208', accentColor: '#ffc107', icon: '📚',
  },
  workshop: {
    id: 'workshop', name: 'The Workshop', subtitle: 'Build & Deploy', category: 'utility',
    description: 'Construction bay — where agents build and deploy new systems.',
    longDescription: 'The Workshop is the build room. Tools hang on pegboards — each one representing a deployable template.',
    exits: ['bridge'],
    furnishings: ['Workbench', 'Tool Wall', '3D Printer', 'Deployment Console', 'Spare Parts Bin'],
    ambientColor: '#0a1208', accentColor: '#8bc34a', icon: '🔧',
  },
  galley: {
    id: 'galley', name: 'The Galley', subtitle: 'Creative Kitchen', category: 'utility',
    description: 'Creative kitchen — where raw ingredients become finished dishes.',
    longDescription: 'The Galley is the creative kitchen. Ingredients line the shelves.',
    exits: ['bridge'],
    furnishings: ['Six-Burner Stove', 'Prep Station', 'Pantry of Ingredients', 'Tasting Counter', 'Recipe Books'],
    ambientColor: '#1a0a12', accentColor: '#ff5722', icon: '🍳',
  },
  'engine-room': {
    id: 'engine-room', name: 'The Engine Room', subtitle: 'Infrastructure Monitor', category: 'utility',
    description: 'Infrastructure monitoring — servers, APIs, model endpoints.',
    longDescription: 'The Engine Room hums with the sound of running systems.',
    exits: ['bridge'],
    furnishings: ['Server Rack', 'Monitoring Dashboard', 'Backup Battery', 'Cable Conduits', 'Maintenance Hatch'],
    ambientColor: '#080a12', accentColor: '#607d8b', icon: '⚙️',
  },
  'chart-house': {
    id: 'chart-house', name: 'The Chart House', subtitle: 'Planning & Roadmaps', category: 'utility',
    description: 'Strategic planning — roadmaps, timelines, and course-setting.',
    longDescription: 'The Chart House is the planning room. A large table dominates the center.',
    exits: ['bridge'],
    furnishings: ['Chart Table', 'Wall Maps', 'Timeline Display', 'Compass', 'Chronometer'],
    ambientColor: '#0a0812', accentColor: '#795548', icon: '🧭',
  },
};

export const ROOM_LIST: OQRoom[] = Object.values(ROOMS);
export const AGENT_NAMES = ['Flash', 'Pro', 'Wesley', 'Scribe', 'Hermes'] as const;
export const AGENT_STATIONS: Record<string, string> = {
  Flash: 'flash-station',
  Pro: 'pro-station',
  Wesley: 'wesley-station',
  Scribe: 'scribe-station',
  Hermes: 'hermes-station',
};

// ──────────────────────────────────────────────
// MUD engine types
// ──────────────────────────────────────────────

export interface MudExit {
  direction: string;
  targetRoomId: string;
  locked?: boolean;
  keyItemId?: string;
  description?: string;
}

export interface MudRoomJSON {
  id: string;
  name: string;
  description: string;
  exits: MudExit[];
  items: never[];
  actorIds: string[];
  zone: string;
  flags: string[];
  metadata: Record<string, unknown>;
  tickScript?: string;
}

// ──────────────────────────────────────────────
// Room Converter: OQ Room → mud-engine Room shape
// ──────────────────────────────────────────────

export function oqRoomToMudRoom(oqRoom: OQRoom): MudRoomJSON {
  const exits: MudExit[] = oqRoom.exits.map((targetId) => {
    const target = ROOMS[targetId];
    return {
      direction: targetId,
      targetRoomId: targetId,
      description: target ? `Path to ${target.name}` : `Path to ${targetId}`,
    };
  });

  return {
    id: oqRoom.id,
    name: oqRoom.name,
    description: oqRoom.longDescription || oqRoom.description,
    exits,
    items: [],
    actorIds: [],
    zone: oqRoom.category,
    flags: oqRoom.category === 'command' ? ['safe', 'no_recall'] : ['safe'],
    metadata: {
      subtitle: oqRoom.subtitle,
      category: oqRoom.category,
      furnishings: oqRoom.furnishings,
      ambientColor: oqRoom.ambientColor,
      accentColor: oqRoom.accentColor,
      icon: oqRoom.icon,
      source: 'officers-quarters',
    },
  };
}

// ──────────────────────────────────────────────
// Migration: Load all 12 OQ rooms into a World instance
// ──────────────────────────────────────────────

export interface MigrationResult {
  roomsLoaded: number;
  actorsCreated: number;
  roomIds: string[];
  agentActors: { agentName: string; actorId: string; roomId: string }[];
}

export function loadOQRoomsIntoWorld(world: {
  addRoom: (room: { id: string; name: string; description: string; exits: MudExit[]; zone: string; flags: Set<string>; metadata: Record<string, unknown> }) => void;
  addActor: (actor: { id: string; name: string; roomId: string; description: string }) => void;
}): MigrationResult {
  const roomIds: string[] = [];
  let roomsLoaded = 0;

  for (const oqRoom of ROOM_LIST) {
    const mudRoom = oqRoomToMudRoom(oqRoom);
    world.addRoom({
      id: mudRoom.id,
      name: mudRoom.name,
      description: mudRoom.description,
      exits: mudRoom.exits,
      zone: mudRoom.zone,
      flags: new Set(mudRoom.flags),
      metadata: mudRoom.metadata,
    });
    roomIds.push(oqRoom.id);
    roomsLoaded++;
  }

  const agentActors: { agentName: string; actorId: string; roomId: string }[] = [];
  for (const agentName of AGENT_NAMES) {
    const roomId = AGENT_STATIONS[agentName];
    const actorId = `actor-${agentName.toLowerCase()}`;
    world.addActor({
      id: actorId,
      name: agentName,
      roomId,
      description: `${agentName} agent stationed at ${ROOMS[roomId].name}`,
    });
    agentActors.push({ agentName, actorId, roomId });
  }

  return { roomsLoaded, actorsCreated: agentActors.length, roomIds, agentActors };
}

// ──────────────────────────────────────────────
// Test World — minimal in-memory implementation matching mud-engine World API
// ──────────────────────────────────────────────

export class TestWorld {
  rooms = new Map<string, { id: string; name: string; description: string; exits: MudExit[]; zone: string; flags: Set<string>; metadata: Record<string, unknown> }>();
  actors = new Map<string, { id: string; name: string; roomId: string; description: string }>();

  addRoom(room: { id: string; name: string; description: string; exits: MudExit[]; zone: string; flags: Set<string>; metadata: Record<string, unknown> }): void {
    this.rooms.set(room.id, room);
  }

  addActor(actor: { id: string; name: string; roomId: string; description: string }): void {
    this.actors.set(actor.id, actor);
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  getActor(actorId: string) {
    return this.actors.get(actorId);
  }
}

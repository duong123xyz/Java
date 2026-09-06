import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { StringTableResult } from '../types/item';
import { CellEvidence } from '../types/patch';
import { getSessionClassInfo } from './patchPlannerService';
import { analyzeStaticInitializer } from './staticInitializerAnalyzer';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { getBossDefinitions, BossDefinition } from './bossDataService';

export interface MapWaypoint {
  index: number;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isEnter: number;
  isOffline: number;
  destinationMapId: number;
  destinationX: number;
  destinationY: number;
}

export interface MapMobSpawn {
  index: number;
  mobId: number;
  level: number;
  hp: number;
  x: number;
  y: number;
  name: string;
  templateHp: number;
  type: number;
}

export interface MapNpcPlacement {
  index: number;
  npcId: number;
  x: number;
  y: number;
  name: string;
  head: number;
  body: number;
  leg: number;
  avatar: number;
  extra: number | null;
}

export interface MapDecoration {
  index: number;
  objectId: number;
  imageId: number;
  layer: number;
  dx: number;
  dy: number;
  x: number;
  y: number;
}

export interface MapBossPlacement {
  bossIndex: number;
  name: string;
  charId: number;
  mapId: number;
  head: number;
  body: number;
  leg: number;
  hp: number;
  damage: number;
  spawnX: number;
  statMode: BossDefinition['statMode'];
}

export interface GameMapRecord {
  rowIndex: number;
  sourceValues: string[];
  cellEvidences?: Record<number, CellEvidence>;
  id: number;
  name: string;
  zones: number;
  maxPlayer: number;
  type: number;
  planetId: number;
  bgType: number;
  tileId: number;
  bgId: number;
  isMapDouble: number;
  rawData: number[];
  waypoints: MapWaypoint[];
  mobs: MapMobSpawn[];
  npcs: MapNpcPlacement[];
  bosses: MapBossPlacement[];
}

export interface MapDataSnapshot {
  maps: GameMapRecord[];
  schema: string[];
  mobCount: number;
  npcPlacementCount: number;
  waypointCount: number;
  bossPlacementCount: number;
  diagnostics: {
    brokenWaypointTargets: number;
    missingMobTemplates: number;
    missingNpcTemplates: number;
  };
}

export interface MapDraft {
  mapId: number;
  name: string;
  zones: number;
  maxPlayer: number;
  type: number;
  planetId: number;
  bgType: number;
  tileId: number;
  bgId: number;
  isMapDouble: number;
  waypoints: MapWaypoint[];
  mobs: MapMobSpawn[];
  npcs: MapNpcPlacement[];
}

interface StaticTable {
  schema: string[];
  rows: StringTableResult['rows'];
}

const drafts = new WeakMap<LoadedJarSession, Map<number, MapDraft>>();
const decorationCatalogCache = new WeakMap<
  LoadedJarSession,
  Promise<Map<number, { imageId: number; layer: number; dx: number; dy: number }>>
>();

const MAP_SCHEMA = [
  'id', 'NAME', 'zones', 'max_player', 'data', 'type', 'planet_id',
  'bg_type', 'tile_id', 'bg_id', 'waypoints', 'mobs', 'npcs', 'is_map_double',
];
const MOB_SCHEMA = [
  'id', 'TYPE', 'NAME', 'hp', 'range_move', 'speed', 'dart_Type',
  'percent_dame', 'percent_tiem_nang',
];
const NPC_SCHEMA = ['id', 'NAME', 'head', 'body', 'leg', 'avatar'];

const int = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '');
}

function assertSchema(actual: string[], expected: string[], owner: string): void {
  const a = actual.map(norm);
  const e = expected.map(norm);
  if (a.length !== e.length || a.some((v, i) => v !== e[i])) {
    throw new Error(`Schema ${owner}.aF không khớp cấu trúc dự kiến.`);
  }
}

async function readTable(
  session: LoadedJarSession,
  owner: string,
  expectedSchema: string[]
): Promise<StaticTable> {
  const classInfo: ClassFileInfo | null = await getSessionClassInfo(session, owner);
  if (!classInfo) throw new Error(`Không tìm thấy ${owner}.class.`);

  const clinit = classInfo.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) throw new Error(`Không đọc được <clinit> ${owner}.class.`);

  const staticAnalysis = analyzeStaticInitializer(
    clinit,
    clinit.code.instructions,
    classInfo.fields,
    classInfo.constantPool
  );

  const schemaArray = staticAnalysis.detectedArrays.find((array) => array.fieldName === 'aF');
  if (!schemaArray) throw new Error(`Không tìm thấy schema aF trong ${owner}.class.`);

  const schema = schemaArray.elements
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((element) => element.stringValue ?? '');

  assertSchema(schema, expectedSchema, owner);

  const field = classInfo.fields.find((candidate) => candidate.name === 'u');
  if (!field) throw new Error(`Không tìm thấy ${owner}.u.`);

  const table = reconstructStringArrayTable(
    owner,
    'u',
    field.descriptor,
    0,
    clinit.code.instructions,
    classInfo.constantPool,
    schema.length
  );

  if (table.parseError) throw new Error(`${owner}.u: ${table.parseError}`);
  return { schema, rows: table.rows };
}

/**
 * Map table lưu nested-array dưới 2 kiểu:
 * [[7,228,432], ...]
 * [\"[0,1,100,780,432]\", ...]
 */
function parseNested(value: string): unknown[][] {
  const raw = (value || '').trim();
  if (!raw || raw === '[]') return [];

  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) {
      return direct
        .map((entry) => {
          if (Array.isArray(entry)) return entry;
          if (typeof entry === 'string') {
            try {
              const parsed = JSON.parse(entry);
              return Array.isArray(parsed) ? parsed : null;
            } catch {
              return null;
            }
          }
          return null;
        })
        .filter((entry): entry is unknown[] => Array.isArray(entry));
    }
  } catch {
    // Format escaped của waypoints/mobs.
  }

  const rows: unknown[][] = [];
  const regex = /\\"(\[.*?\])\\"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    try {
      const parsed = JSON.parse(match[1].replace(/\\"/g, '"'));
      if (Array.isArray(parsed)) rows.push(parsed);
    } catch {
      // Một record hỏng không làm hỏng cả map.
    }
  }
  return rows;
}

function parseNumbers(value: string): number[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map((v) => int(v)) : [];
  } catch {
    return [];
  }
}

function cloneWaypoint(v: MapWaypoint): MapWaypoint { return { ...v }; }
function cloneMob(v: MapMobSpawn): MapMobSpawn { return { ...v }; }
function cloneNpc(v: MapNpcPlacement): MapNpcPlacement { return { ...v }; }

function originalDraft(map: GameMapRecord): MapDraft {
  return {
    mapId: map.id,
    name: map.name,
    zones: map.zones,
    maxPlayer: map.maxPlayer,
    type: map.type,
    planetId: map.planetId,
    bgType: map.bgType,
    tileId: map.tileId,
    bgId: map.bgId,
    isMapDouble: map.isMapDouble,
    waypoints: map.waypoints.map(cloneWaypoint),
    mobs: map.mobs.map(cloneMob),
    npcs: map.npcs.map(cloneNpc),
  };
}

function cloneDraft(v: MapDraft): MapDraft {
  return {
    ...v,
    waypoints: v.waypoints.map(cloneWaypoint),
    mobs: v.mobs.map(cloneMob),
    npcs: v.npcs.map(cloneNpc),
  };
}

function comparable(v: MapDraft): unknown {
  return {
    mapId: v.mapId,
    name: v.name,
    zones: v.zones,
    maxPlayer: v.maxPlayer,
    type: v.type,
    planetId: v.planetId,
    bgType: v.bgType,
    tileId: v.tileId,
    bgId: v.bgId,
    isMapDouble: v.isMapDouble,
    waypoints: v.waypoints.map(({ index, ...rest }) => rest),
    mobs: v.mobs.map(({ index, name, templateHp, type, ...rest }) => rest),
    npcs: v.npcs.map(({ index, name, head, body, leg, avatar, ...rest }) => rest),
  };
}

async function loadDecorationCatalog(
  session: LoadedJarSession
): Promise<Map<number, { imageId: number; layer: number; dx: number; dy: number }>> {
  const cached = decorationCatalogCache.get(session);
  if (cached) return cached;

  const promise = (async () => {
    const table = await readTable(session, 'a/a/a/c', ['id', 'image_id', 'layer', 'dx', 'dy']);
    const result = new Map<number, { imageId: number; layer: number; dx: number; dy: number }>();

    for (const row of table.rows) {
      result.set(int(row.values[0]), {
        imageId: int(row.values[1], -1),
        layer: int(row.values[2]),
        dx: int(row.values[3]),
        dy: int(row.values[4]),
      });
    }
    return result;
  })();

  decorationCatalogCache.set(session, promise);
  return promise;
}

export async function loadMapDecorations(
  session: LoadedJarSession,
  mapId: number
): Promise<MapDecoration[]> {
  const entry = session.zip.file(`map/item_bg_map_data/${mapId}`);
  if (!entry) return [];

  const [bytes, catalog] = await Promise.all([
    entry.async('uint8array'),
    loadDecorationCatalog(session),
  ]);

  if (bytes.length < 2) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(0, false);
  const result: MapDecoration[] = [];
  let offset = 2;

  for (let index = 0; index < count; index++) {
    if (offset + 6 > bytes.length) break;

    const objectId = view.getUint16(offset, false);
    const tileX = view.getInt16(offset + 2, false);
    const tileY = view.getInt16(offset + 4, false);
    offset += 6;

    const template = catalog.get(objectId);
    if (!template || template.imageId < 0) continue;

    result.push({
      index,
      objectId,
      imageId: template.imageId,
      layer: template.layer,
      dx: template.dx,
      dy: template.dy,
      // a/a/aa.aH: tp/tq = tile coordinate * a/ba.aA (24px), sau đó a/bF.aK cộng dx/dy.
      x: tileX * 24 + template.dx,
      y: tileY * 24 + template.dy,
    });
  }

  return result;
}

export async function analyzeMaps(session: LoadedJarSession): Promise<MapDataSnapshot> {
  const [mapTable, mobTable, npcTable] = await Promise.all([
    readTable(session, 'a/a/a/z', MAP_SCHEMA),
    readTable(session, 'a/a/a/A', MOB_SCHEMA),
    readTable(session, 'a/a/a/B', NPC_SCHEMA),
  ]);
  const bossDefinitions = getBossDefinitions();

  const mobTemplates = new Map<number, { name: string; hp: number; type: number }>();
  for (const row of mobTable.rows) {
    mobTemplates.set(int(row.values[0]), {
      type: int(row.values[1]),
      name: row.values[2] ?? '',
      hp: int(row.values[3]),
    });
  }

  const npcTemplates = new Map<number, {
    name: string; head: number; body: number; leg: number; avatar: number;
  }>();
  for (const row of npcTable.rows) {
    npcTemplates.set(int(row.values[0]), {
      name: row.values[1] ?? '',
      head: int(row.values[2]),
      body: int(row.values[3]),
      leg: int(row.values[4]),
      avatar: int(row.values[5]),
    });
  }

  const bossesByMap = new Map<number, BossDefinition[]>();
  for (const boss of bossDefinitions) {
    const list = bossesByMap.get(boss.mapId) ?? [];
    list.push(boss);
    bossesByMap.set(boss.mapId, list);
  }

  const maps: GameMapRecord[] = mapTable.rows.map((row) => {
    const id = int(row.values[0]);

    const waypoints = parseNested(row.values[10] ?? '[]').map((r, index): MapWaypoint => ({
      index,
      name: String(r[0] ?? ''),
      x1: int(r[1]), y1: int(r[2]), x2: int(r[3]), y2: int(r[4]),
      isEnter: int(r[5]), isOffline: int(r[6]),
      destinationMapId: int(r[7], -1),
      destinationX: int(r[8]), destinationY: int(r[9]),
    }));

    const mobs = parseNested(row.values[11] ?? '[]').map((r, index): MapMobSpawn => {
      const mobId = int(r[0], -1);
      const template = mobTemplates.get(mobId);
      return {
        index,
        mobId,
        level: int(r[1], 1),
        hp: int(r[2], 1),
        x: int(r[3]),
        y: int(r[4]),
        name: template?.name ?? `Mob #${mobId}`,
        templateHp: template?.hp ?? 0,
        type: template?.type ?? -1,
      };
    });

    const npcs = parseNested(row.values[12] ?? '[]').map((r, index): MapNpcPlacement => {
      const npcId = int(r[0], -1);
      const template = npcTemplates.get(npcId);
      return {
        index,
        npcId,
        x: int(r[1]),
        y: int(r[2]),
        name: template?.name ?? `NPC #${npcId}`,
        head: template?.head ?? -1,
        body: template?.body ?? -1,
        leg: template?.leg ?? -1,
        avatar: template?.avatar ?? 0,
        extra: r.length > 3 ? int(r[3]) : null,
      };
    });

    const bosses = (bossesByMap.get(id) ?? []).map((boss): MapBossPlacement => ({
      bossIndex: boss.index,
      name: boss.name,
      charId: boss.charId,
      mapId: boss.mapId,
      head: boss.head,
      body: boss.body,
      leg: boss.leg,
      hp: boss.hp,
      damage: boss.damage,
      spawnX: boss.spawnX,
      statMode: boss.statMode,
    }));

    return {
      rowIndex: row.rowIndex,
      sourceValues: [...row.values],
      cellEvidences: row.cellEvidences,
      id,
      name: row.values[1] ?? '',
      zones: int(row.values[2]),
      maxPlayer: int(row.values[3]),
      rawData: parseNumbers(row.values[4] ?? '[]'),
      type: int(row.values[5]),
      planetId: int(row.values[6]),
      bgType: int(row.values[7]),
      tileId: int(row.values[8]),
      bgId: int(row.values[9]),
      waypoints,
      mobs,
      npcs,
      isMapDouble: int(row.values[13]),
      bosses,
    };
  });

  const mapIds = new Set(maps.map((map) => map.id));
  return {
    maps,
    schema: mapTable.schema,
    mobCount: maps.reduce((sum, map) => sum + map.mobs.length, 0),
    npcPlacementCount: maps.reduce((sum, map) => sum + map.npcs.length, 0),
    waypointCount: maps.reduce((sum, map) => sum + map.waypoints.length, 0),
    bossPlacementCount: maps.reduce((sum, map) => sum + map.bosses.length, 0),
    diagnostics: {
      brokenWaypointTargets: maps.reduce(
        (sum, map) =>
          sum + map.waypoints.filter(
            (wp) => wp.destinationMapId >= 0 && !mapIds.has(wp.destinationMapId)
          ).length,
        0
      ),
      missingMobTemplates: maps.reduce(
        (sum, map) => sum + map.mobs.filter((mob) => !mobTemplates.has(mob.mobId)).length,
        0
      ),
      missingNpcTemplates: maps.reduce(
        (sum, map) => sum + map.npcs.filter((npc) => !npcTemplates.has(npc.npcId)).length,
        0
      ),
    },
  };
}

export function getMapDraft(session: LoadedJarSession, map: GameMapRecord): MapDraft {
  let store = drafts.get(session);
  if (!store) {
    store = new Map<number, MapDraft>();
    drafts.set(session, store);
  }

  let draft = store.get(map.id);
  if (!draft) {
    draft = originalDraft(map);
    store.set(map.id, draft);
  }
  return cloneDraft(draft);
}

export function setMapDraft(session: LoadedJarSession, map: GameMapRecord, value: MapDraft): void {
  let store = drafts.get(session);
  if (!store) {
    store = new Map<number, MapDraft>();
    drafts.set(session, store);
  }

  store.set(map.id, {
    ...value,
    mapId: map.id,
    name: value.name.slice(0, 120),
    zones: Math.max(1, Math.min(1000, Math.round(value.zones))),
    maxPlayer: Math.max(1, Math.min(1000, Math.round(value.maxPlayer))),
    type: Math.round(value.type),
    planetId: Math.round(value.planetId),
    bgType: Math.round(value.bgType),
    tileId: Math.max(0, Math.round(value.tileId)),
    bgId: Math.max(-1, Math.round(value.bgId)),
    isMapDouble: value.isMapDouble ? 1 : 0,
    waypoints: value.waypoints.map((v, index) => ({ ...v, index })),
    mobs: value.mobs.map((v, index) => ({
      ...v, index,
      mobId: Math.round(v.mobId),
      level: Math.max(1, Math.round(v.level)),
      hp: Math.max(1, Math.round(v.hp)),
      x: Math.round(v.x),
      y: Math.round(v.y),
    })),
    npcs: value.npcs.map((v, index) => ({
      ...v, index,
      npcId: Math.round(v.npcId),
      x: Math.round(v.x),
      y: Math.round(v.y),
    })),
  });
}

export function isMapDraftDirty(map: GameMapRecord, draft: MapDraft): boolean {
  return JSON.stringify(comparable(originalDraft(map))) !== JSON.stringify(comparable(draft));
}

export function getDirtyMapCount(
  session: LoadedJarSession,
  maps: GameMapRecord[]
): number {
  const store = drafts.get(session);
  if (!store) return 0;
  return maps.reduce((count, map) => {
    const draft = store?.get(map.id);
    return count + (draft && isMapDraftDirty(map, draft) ? 1 : 0);
  }, 0);
}

export function resetMapDraft(session: LoadedJarSession, map: GameMapRecord): MapDraft {
  let store = drafts.get(session);
  if (!store) {
    store = new Map<number, MapDraft>();
    drafts.set(session, store);
  }
  const draft = originalDraft(map);
  store.set(map.id, draft);
  return cloneDraft(draft);
}


export interface DirtyMapDraftEntry {
  map: GameMapRecord;
  draft: MapDraft;
}

export function getDirtyMapDraftEntries(
  session: LoadedJarSession,
  maps: GameMapRecord[]
): DirtyMapDraftEntry[] {
  const store = drafts.get(session);
  if (!store) return [];

  const result: DirtyMapDraftEntry[] = [];
  for (const map of maps) {
    const draft = store.get(map.id);
    if (draft && isMapDraftDirty(map, draft)) {
      result.push({ map, draft: cloneDraft(draft) });
    }
  }
  return result;
}

function escapeSerializedText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function serializeQuotedArray(rows: Array<Array<string | number>>): string {
  return `[${rows
    .map((row) => {
      const inner = `[${row
        .map((value) =>
          typeof value === 'string' ? `\\"${escapeSerializedText(value)}\\"` : String(value)
        )
        .join(',')}]`;
      return `\\"${inner}\\"`;
    })
    .join(',')}]`;
}

export function serializeMapDraftValues(
  map: GameMapRecord,
  draft: MapDraft
): string[] {
  const values = [...map.sourceValues];
  while (values.length < 14) values.push('');

  values[0] = String(map.id);
  values[1] = draft.name;
  values[2] = String(draft.zones);
  values[3] = String(draft.maxPlayer);
  // data[4] hiện chưa cho sửa trong UI, giữ nguyên.
  values[5] = String(draft.type);
  values[6] = String(draft.planetId);
  values[7] = String(draft.bgType);
  values[8] = String(draft.tileId);
  values[9] = String(draft.bgId);

  const waypointComparable = (row: MapWaypoint) => ({
    name: row.name,
    x1: row.x1,
    y1: row.y1,
    x2: row.x2,
    y2: row.y2,
    isEnter: row.isEnter,
    isOffline: row.isOffline,
    destinationMapId: row.destinationMapId,
    destinationX: row.destinationX,
    destinationY: row.destinationY,
  });
  const mobComparable = (row: MapMobSpawn) => ({
    mobId: row.mobId,
    level: row.level,
    hp: row.hp,
    x: row.x,
    y: row.y,
  });
  const npcComparable = (row: MapNpcPlacement) => ({
    npcId: row.npcId,
    x: row.x,
    y: row.y,
    extra: row.extra,
  });

  if (
    JSON.stringify(map.waypoints.map(waypointComparable)) !==
    JSON.stringify(draft.waypoints.map(waypointComparable))
  ) {
    values[10] = serializeQuotedArray(
      draft.waypoints.map((row) => [
        row.name,
        row.x1,
        row.y1,
        row.x2,
        row.y2,
        row.isEnter,
        row.isOffline,
        row.destinationMapId,
        row.destinationX,
        row.destinationY,
      ])
    );
  }

  if (
    JSON.stringify(map.mobs.map(mobComparable)) !==
    JSON.stringify(draft.mobs.map(mobComparable))
  ) {
    values[11] = serializeQuotedArray(
      draft.mobs.map((row) => [row.mobId, row.level, row.hp, row.x, row.y])
    );
  }

  if (
    JSON.stringify(map.npcs.map(npcComparable)) !==
    JSON.stringify(draft.npcs.map(npcComparable))
  ) {
    values[12] = `[${draft.npcs
      .map((row) => {
        const parts = [row.npcId, row.x, row.y];
        if (row.extra !== null) parts.push(row.extra);
        return `[${parts.join(',')}]`;
      })
      .join(',')}]`;
  }

  values[13] = String(draft.isMapDouble);
  return values;
}

export function exportMapDrafts(session: LoadedJarSession): Array<[number, MapDraft]> {
  const store = drafts.get(session);
  if (!store) return [];
  return Array.from(store.entries()).map(([mapId, draft]) => [mapId, cloneDraft(draft)]);
}

export function importMapDrafts(
  session: LoadedJarSession,
  entries: Array<[number, MapDraft]>
): void {
  const store = new Map<number, MapDraft>();
  for (const [mapId, draft] of entries || []) {
    store.set(mapId, cloneDraft(draft));
  }
  drafts.set(session, store);
}

export function getMapDraftFingerprint(session: LoadedJarSession): string {
  const store = drafts.get(session);
  if (!store) return '[]';

  const rows = Array.from(store.entries())
    .sort(([a], [b]) => a - b)
    .map(([mapId, draft]) => [mapId, comparable(draft)]);
  return JSON.stringify(rows);
}

export function resetAllMapDrafts(session: LoadedJarSession): void {
  drafts.delete(session);
}

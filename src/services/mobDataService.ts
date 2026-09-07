import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { CellEvidence } from '../types/patch';
import { StringTableResult } from '../types/item';
import { getSessionClassInfo } from './patchPlannerService';
import { analyzeStaticInitializer } from './staticInitializerAnalyzer';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { analyzeMaps } from './mapDataService';

export interface MobMapUsage {
  mapId: number;
  mapName: string;
  spawnCount: number;
  avgLevel: number;
  avgSpawnHp: number;
  spawns: Array<{
    index: number;
    level: number;
    hp: number;
    x: number;
    y: number;
  }>;
}

export interface MobRecord {
  rowIndex: number;
  sourceValues: string[];
  cellEvidences?: Record<number, CellEvidence>;
  id: number;
  type: number;
  name: string;
  hp: number;
  rangeMove: number;
  speed: number;
  dartType: number;
  percentDamage: number;
  percentTiemNang: number;
  maps: MobMapUsage[];
  totalSpawnCount: number;
}

export interface MobDraft {
  name: string;
  hp: number;
  rangeMove: number;
  speed: number;
  dartType: number;
  percentDamage: number;
  percentTiemNang: number;
}

export interface DirtyMobDraftEntry {
  mob: MobRecord;
  draft: MobDraft;
}

export interface MobDataSnapshot {
  sourceClass: string;
  sourceField: string;
  schema: string[];
  rows: StringTableResult['rows'];
  mobs: MobRecord[];
  typeBuckets: Record<number, MobRecord[]>;
  totalSpawnCount: number;
  mapUsageCount: number;
}

const SOURCE_CLASS = 'a/a/a/A';
const SOURCE_FIELD = 'u';
const EXPECTED_SCHEMA = [
  'id',
  'TYPE',
  'NAME',
  'hp',
  'range_move',
  'speed',
  'dart_Type',
  'percent_dame',
  'percent_tiem_nang',
];

const analysisCache = new WeakMap<LoadedJarSession, Promise<MobDataSnapshot>>();
const draftStore = new WeakMap<LoadedJarSession, Map<number, MobDraft>>();

function normalizeColumn(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '');
}

function assertSchema(actual: string[]): void {
  const a = actual.map(normalizeColumn);
  const e = EXPECTED_SCHEMA.map(normalizeColumn);
  if (a.length !== e.length || a.some((value, index) => value !== e[index])) {
    throw new Error(
      `Schema ${SOURCE_CLASS}.aF không khớp. Nhận [${actual.join(', ')}], dự kiến [${EXPECTED_SCHEMA.join(', ')}].`
    );
  }
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cloneDraft(draft: MobDraft): MobDraft {
  return { ...draft };
}

function draftFromMob(mob: MobRecord): MobDraft {
  return {
    name: mob.name,
    hp: mob.hp,
    rangeMove: mob.rangeMove,
    speed: mob.speed,
    dartType: mob.dartType,
    percentDamage: mob.percentDamage,
    percentTiemNang: mob.percentTiemNang,
  };
}

async function readMobTable(
  session: LoadedJarSession
): Promise<{
  schema: string[];
  rows: StringTableResult['rows'];
}> {
  const classInfo: ClassFileInfo | null = await getSessionClassInfo(session, SOURCE_CLASS);
  if (!classInfo) {
    throw new Error(`Không tìm thấy ${SOURCE_CLASS}.class trong JAR.`);
  }

  const clinit = classInfo.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) {
    throw new Error(`Không giải mã được <clinit> của ${SOURCE_CLASS}.class.`);
  }

  const staticAnalysis = analyzeStaticInitializer(
    clinit,
    clinit.code.instructions,
    classInfo.fields,
    classInfo.constantPool
  );

  const schemaArray = staticAnalysis.detectedArrays.find((array) => array.fieldName === 'aF');
  if (!schemaArray) {
    throw new Error(`Không tìm thấy schema aF trong ${SOURCE_CLASS}.class.`);
  }

  const schema = schemaArray.elements
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((element) => element.stringValue ?? '');
  assertSchema(schema);

  const sourceField = classInfo.fields.find((field) => field.name === SOURCE_FIELD);
  if (!sourceField) {
    throw new Error(`Không tìm thấy field ${SOURCE_FIELD} trong ${SOURCE_CLASS}.class.`);
  }

  const reconstructed = reconstructStringArrayTable(
    SOURCE_CLASS,
    SOURCE_FIELD,
    sourceField.descriptor,
    0,
    clinit.code.instructions,
    classInfo.constantPool,
    schema.length
  );

  if (reconstructed.parseError) {
    throw new Error(`Không phục dựng được bảng quái: ${reconstructed.parseError}`);
  }

  return {
    schema,
    rows: reconstructed.rows,
  };
}

function summarizeMapUsage(mobId: number, maps: Awaited<ReturnType<typeof analyzeMaps>>['maps']): MobMapUsage[] {
  const result: MobMapUsage[] = [];

  for (const map of maps) {
    const spawns = map.mobs.filter((spawn) => spawn.mobId === mobId);
    if (spawns.length === 0) continue;

    const avgLevel = Math.round(
      spawns.reduce((sum, spawn) => sum + spawn.level, 0) / spawns.length
    );
    const avgSpawnHp = Math.round(
      spawns.reduce((sum, spawn) => sum + spawn.hp, 0) / spawns.length
    );

    result.push({
      mapId: map.id,
      mapName: map.name,
      spawnCount: spawns.length,
      avgLevel,
      avgSpawnHp,
      spawns: spawns.map((spawn) => ({
        index: spawn.index,
        level: spawn.level,
        hp: spawn.hp,
        x: spawn.x,
        y: spawn.y,
      })),
    });
  }

  return result.sort((a, b) => {
    if (b.spawnCount !== a.spawnCount) return b.spawnCount - a.spawnCount;
    return a.mapId - b.mapId;
  });
}

export async function analyzeMobs(session: LoadedJarSession): Promise<MobDataSnapshot> {
  let cached = analysisCache.get(session);
  if (!cached) {
    cached = (async () => {
      const [{ schema, rows }, mapSnapshot] = await Promise.all([
        readMobTable(session),
        analyzeMaps(session),
      ]);

      const mobs = rows.map((row): MobRecord => {
        const id = int(row.values[0], row.rowIndex);
        const maps = summarizeMapUsage(id, mapSnapshot.maps);
        return {
          rowIndex: row.rowIndex,
          sourceValues: [...row.values],
          cellEvidences: row.cellEvidences,
          id,
          type: int(row.values[1]),
          name: String(row.values[2] ?? ''),
          hp: int(row.values[3], 1),
          rangeMove: int(row.values[4]),
          speed: int(row.values[5]),
          dartType: int(row.values[6]),
          percentDamage: int(row.values[7]),
          percentTiemNang: int(row.values[8]),
          maps,
          totalSpawnCount: maps.reduce((sum, usage) => sum + usage.spawnCount, 0),
        };
      });

      const typeBuckets: Record<number, MobRecord[]> = {};
      for (const mob of mobs) {
        (typeBuckets[mob.type] ||= []).push(mob);
      }

      return {
        sourceClass: SOURCE_CLASS,
        sourceField: SOURCE_FIELD,
        schema,
        rows,
        mobs,
        typeBuckets,
        totalSpawnCount: mobs.reduce((sum, mob) => sum + mob.totalSpawnCount, 0),
        mapUsageCount: mobs.reduce((sum, mob) => sum + mob.maps.length, 0),
      };
    })();
    analysisCache.set(session, cached);
  }
  return cached;
}

export function getMobDraft(session: LoadedJarSession, mob: MobRecord): MobDraft {
  let store = draftStore.get(session);
  if (!store) {
    store = new Map<number, MobDraft>();
    draftStore.set(session, store);
  }
  const existing = store.get(mob.rowIndex);
  if (existing) return cloneDraft(existing);
  const draft = draftFromMob(mob);
  store.set(mob.rowIndex, draft);
  return cloneDraft(draft);
}

export function setMobDraft(
  session: LoadedJarSession,
  mob: MobRecord,
  draft: MobDraft
): void {
  let store = draftStore.get(session);
  if (!store) {
    store = new Map<number, MobDraft>();
    draftStore.set(session, store);
  }

  const normalized: MobDraft = {
    name: String(draft.name ?? ''),
    hp: clamp(draft.hp, 1, 2_147_483_647),
    rangeMove: clamp(draft.rangeMove, 0, 50_000),
    speed: clamp(draft.speed, 0, 50_000),
    dartType: clamp(draft.dartType, -10_000, 10_000),
    percentDamage: clamp(draft.percentDamage, 0, 100_000),
    percentTiemNang: clamp(draft.percentTiemNang, 0, 100_000),
  };

  if (isMobDraftDirty(mob, normalized)) {
    store.set(mob.rowIndex, normalized);
  } else {
    store.delete(mob.rowIndex);
  }
}

export function isMobDraftDirty(mob: MobRecord, draft: MobDraft): boolean {
  return JSON.stringify(draftFromMob(mob)) !== JSON.stringify(draft);
}

export function resetMobDraft(session: LoadedJarSession, mob: MobRecord): MobDraft {
  draftStore.get(session)?.delete(mob.rowIndex);
  return draftFromMob(mob);
}

export function resetAllMobDrafts(session: LoadedJarSession): void {
  draftStore.delete(session);
}

export function getDirtyMobCount(session: LoadedJarSession, mobs: MobRecord[]): number {
  const store = draftStore.get(session);
  if (!store) return 0;
  let count = 0;
  for (const mob of mobs) {
    const draft = store.get(mob.rowIndex);
    if (draft && isMobDraftDirty(mob, draft)) count++;
  }
  return count;
}

export function getDirtyMobDraftEntries(
  session: LoadedJarSession,
  mobs: MobRecord[]
): DirtyMobDraftEntry[] {
  const store = draftStore.get(session);
  if (!store) return [];
  const result: DirtyMobDraftEntry[] = [];
  for (const mob of mobs) {
    const draft = store.get(mob.rowIndex);
    if (draft && isMobDraftDirty(mob, draft)) {
      result.push({ mob, draft: cloneDraft(draft) });
    }
  }
  return result;
}

export function exportMobDrafts(session: LoadedJarSession): Array<[number, MobDraft]> {
  const store = draftStore.get(session);
  if (!store) return [];
  return Array.from(store.entries()).map(([rowIndex, draft]) => [
    rowIndex,
    cloneDraft(draft),
  ]);
}

export function importMobDrafts(
  session: LoadedJarSession,
  entries: Array<[number, MobDraft]>
): void {
  const store = new Map<number, MobDraft>();
  for (const [rowIndex, draft] of entries ?? []) {
    store.set(rowIndex, cloneDraft(draft));
  }
  draftStore.set(session, store);
}

export function getMobDraftFingerprint(session: LoadedJarSession): string {
  const store = draftStore.get(session);
  if (!store) return '[]';
  return JSON.stringify(
    Array.from(store.entries())
      .sort(([a], [b]) => a - b)
      .map(([rowIndex, draft]) => [rowIndex, draft])
  );
}

export function serializeMobDraftValues(mob: MobRecord, draft: MobDraft): string[] {
  const values = [...mob.sourceValues];
  while (values.length < EXPECTED_SCHEMA.length) values.push('');
  values[0] = String(mob.id);
  values[1] = String(mob.type);
  values[2] = draft.name;
  values[3] = String(draft.hp);
  values[4] = String(draft.rangeMove);
  values[5] = String(draft.speed);
  values[6] = String(draft.dartType);
  values[7] = String(draft.percentDamage);
  values[8] = String(draft.percentTiemNang);
  return values;
}

export function getMobTypeLabel(type: number): string {
  const known: Record<number, string> = {
    0: 'Đi bộ',
    1: 'Bay',
    2: 'Bắn xa',
    3: 'Đặc biệt',
  };
  return known[type] ?? `Type ${type}`;
}

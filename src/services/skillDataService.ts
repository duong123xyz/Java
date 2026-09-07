import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { CellEvidence } from '../types/patch';
import { StringTableResult } from '../types/item';
import { getSessionClassInfo } from './patchPlannerService';
import { analyzeStaticInitializer } from './staticInitializerAnalyzer';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';

export type SkillPlanet = 0 | 1 | 2;

export interface SkillLevelRecord {
  powerRequire: number;
  damage: number;
  dx: number;
  dy: number;
  price: number;
  maxFight: number;
  manaUse: number;
  coolDown: number;
  id: number;
  point: number;
  info: string;
}

export interface SkillRecord {
  rowIndex: number;
  sourceValues: string[];
  cellEvidences?: Record<number, CellEvidence>;
  nclassId: SkillPlanet;
  id: number;
  name: string;
  maxPoint: number;
  manaUseType: number;
  type: number;
  iconId: number;
  damageInfo: string;
  slot: number;
  levels: SkillLevelRecord[];
}

export interface SkillDraft {
  name: string;
  maxPoint: number;
  manaUseType: number;
  type: number;
  iconId: number;
  damageInfo: string;
  slot: number;
  levels: SkillLevelRecord[];
}

export interface SkillDataSnapshot {
  sourceClass: string;
  sourceField: string;
  schema: string[];
  rows: StringTableResult['rows'];
  skills: SkillRecord[];
  byPlanet: Record<number, SkillRecord[]>;
  levelCount: number;
}

export interface DirtySkillDraftEntry {
  skill: SkillRecord;
  draft: SkillDraft;
}

const SOURCE_CLASS = 'a/a/a/W';
const SOURCE_FIELD = 'u';
const EXPECTED_SCHEMA = [
  'nclass_id',
  'id',
  'NAME',
  'max_point',
  'mana_use_type',
  'TYPE',
  'icon_id',
  'dam_info',
  'slot',
  'skills',
];

const draftStore = new WeakMap<LoadedJarSession, Map<number, SkillDraft>>();
const analysisCache = new WeakMap<LoadedJarSession, Promise<SkillDataSnapshot>>();

function normalizeColumn(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '');
}

function assertSchema(actual: string[]): void {
  const a = actual.map(normalizeColumn);
  const e = EXPECTED_SCHEMA.map(normalizeColumn);
  if (a.length !== e.length || a.some((value, index) => value !== e[index])) {
    throw new Error(
      `Schema ${SOURCE_CLASS}.aF không khớp. Nhận [${actual.join(', ')}], ` +
        `dự kiến [${EXPECTED_SCHEMA.join(', ')}].`
    );
  }
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cloneLevel(level: SkillLevelRecord): SkillLevelRecord {
  return { ...level };
}

function cloneDraft(draft: SkillDraft): SkillDraft {
  return {
    ...draft,
    levels: draft.levels.map(cloneLevel),
  };
}

function draftFromSkill(skill: SkillRecord): SkillDraft {
  return {
    name: skill.name,
    maxPoint: skill.maxPoint,
    manaUseType: skill.manaUseType,
    type: skill.type,
    iconId: skill.iconId,
    damageInfo: skill.damageInfo,
    slot: skill.slot,
    levels: skill.levels.map(cloneLevel),
  };
}

function parseSkillLevelObject(rawObject: string): SkillLevelRecord | null {
  try {
    // Bảng W lưu JSON object dưới dạng chuỗi có escape quote: {\"damage\":100,...}
    // Gỡ đúng một lớp escape để JSON.parse nhận object thật.
    const decoded = rawObject.replace(/\\"/g, '"');
    const value = JSON.parse(decoded) as Record<string, unknown>;
    return {
      powerRequire: int(value.power_require),
      damage: int(value.damage),
      dx: int(value.dx),
      dy: int(value.dy),
      price: int(value.price),
      maxFight: int(value.max_fight, 1),
      manaUse: int(value.mana_use),
      coolDown: int(value.cool_down),
      id: int(value.id),
      point: int(value.point),
      info: typeof value.info === 'string' ? value.info : '',
    };
  } catch {
    return null;
  }
}

export function parseSkillLevels(raw: string): SkillLevelRecord[] {
  if (!raw || raw.trim() === '[]') return [];

  // Object skill không có object lồng nhau; regex theo cặp { ... } an toàn với
  // format bảng hiện tại và tránh phá chuỗi escape bên ngoài.
  const matches = raw.match(/\{(?:\\.|[^}])*\}/g) ?? [];
  const levels = matches
    .map(parseSkillLevelObject)
    .filter((value): value is SkillLevelRecord => value !== null);

  if (levels.length === 0) {
    throw new Error('Không parse được cột skills của a/a/a/W.u.');
  }

  return levels;
}

function levelToWireObject(level: SkillLevelRecord): Record<string, string | number> {
  // Giữ thứ tự key giống dữ liệu gốc để diff dễ đọc và writer ổn định.
  return {
    power_require: level.powerRequire,
    damage: level.damage,
    dx: level.dx,
    dy: level.dy,
    price: level.price,
    max_fight: level.maxFight,
    mana_use: level.manaUse,
    cool_down: level.coolDown,
    id: level.id,
    point: level.point,
    info: level.info,
  };
}

export function serializeSkillLevels(levels: SkillLevelRecord[]): string {
  return `[${levels
    .map((level) => {
      const json = JSON.stringify(levelToWireObject(level));
      const escaped = json.replace(/"/g, '\\"');
      return `\\"${escaped}\\"`;
    })
    .join(',')}]`;
}

async function readSkillTable(
  session: LoadedJarSession
): Promise<{
  schema: string[];
  rows: StringTableResult['rows'];
}> {
  const classInfo: ClassFileInfo | null = await getSessionClassInfo(
    session,
    SOURCE_CLASS
  );
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

  const schemaArray = staticAnalysis.detectedArrays.find(
    (array) => array.fieldName === 'aF'
  );
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
    throw new Error(
      `Không phục dựng được bảng kỹ năng: ${reconstructed.parseError}`
    );
  }

  return { schema, rows: reconstructed.rows };
}

export async function analyzeSkills(
  session: LoadedJarSession
): Promise<SkillDataSnapshot> {
  const cached = analysisCache.get(session);
  if (cached) return cached;

  const promise = (async () => {
    const table = await readSkillTable(session);

    const skills: SkillRecord[] = table.rows.map((row) => {
      const values = row.values;
      const nclassRaw = int(values[0]);
      const nclassId: SkillPlanet =
        nclassRaw === 1 ? 1 : nclassRaw === 2 ? 2 : 0;

      return {
        rowIndex: row.rowIndex,
        sourceValues: [...values],
        cellEvidences: row.cellEvidences,
        nclassId,
        id: int(values[1]),
        name: values[2] ?? '',
        maxPoint: int(values[3]),
        manaUseType: int(values[4]),
        type: int(values[5]),
        iconId: int(values[6]),
        damageInfo: values[7] ?? '',
        slot: int(values[8]),
        levels: parseSkillLevels(values[9] ?? '[]'),
      };
    });

    const byPlanet: Record<number, SkillRecord[]> = { 0: [], 1: [], 2: [] };
    for (const skill of skills) {
      byPlanet[skill.nclassId].push(skill);
    }

    return {
      sourceClass: SOURCE_CLASS,
      sourceField: SOURCE_FIELD,
      schema: table.schema,
      rows: table.rows,
      skills,
      byPlanet,
      levelCount: skills.reduce((sum, skill) => sum + skill.levels.length, 0),
    };
  })();

  analysisCache.set(session, promise);
  return promise;
}

export function getSkillDraft(
  session: LoadedJarSession,
  skill: SkillRecord
): SkillDraft {
  const draft = draftStore.get(session)?.get(skill.rowIndex);
  return draft ? cloneDraft(draft) : draftFromSkill(skill);
}

export function setSkillDraft(
  session: LoadedJarSession,
  skill: SkillRecord,
  draft: SkillDraft
): void {
  let store = draftStore.get(session);
  if (!store) {
    store = new Map<number, SkillDraft>();
    draftStore.set(session, store);
  }

  const originalById = new Map(skill.levels.map((level) => [level.id, level]));
  const normalizedLevels = draft.levels.map((level, index) => {
    const original = originalById.get(level.id) ?? skill.levels[index] ?? level;
    return {
      powerRequire: bounded(level.powerRequire, 0, Number.MAX_SAFE_INTEGER),
      damage: bounded(level.damage, -2_100_000_000, 2_100_000_000),
      dx: bounded(level.dx, -100_000, 100_000),
      dy: bounded(level.dy, -100_000, 100_000),
      price: bounded(level.price, 0, 2_100_000_000),
      maxFight: bounded(level.maxFight, 0, 100_000),
      manaUse: bounded(level.manaUse, 0, 2_100_000_000),
      coolDown: bounded(level.coolDown, 0, 2_100_000_000),
      // ID/point là identity runtime, UI không cho sửa; luôn giữ từ bản gốc.
      id: original.id,
      point: original.point,
      info: String(level.info ?? ''),
    };
  });

  const normalized: SkillDraft = {
    name: String(draft.name ?? ''),
    maxPoint: bounded(draft.maxPoint, 1, 100),
    manaUseType: bounded(draft.manaUseType, 0, 255),
    type: bounded(draft.type, 0, 255),
    iconId: bounded(draft.iconId, 0, 65_535),
    damageInfo: String(draft.damageInfo ?? ''),
    slot: bounded(draft.slot, 0, 255),
    levels: normalizedLevels,
  };

  if (isSkillDraftDirty(skill, normalized)) {
    store.set(skill.rowIndex, normalized);
  } else {
    store.delete(skill.rowIndex);
  }
}

export function isSkillDraftDirty(
  skill: SkillRecord,
  draft: SkillDraft
): boolean {
  return JSON.stringify(draftFromSkill(skill)) !== JSON.stringify(draft);
}

export function resetSkillDraft(
  session: LoadedJarSession,
  skill: SkillRecord
): SkillDraft {
  draftStore.get(session)?.delete(skill.rowIndex);
  return draftFromSkill(skill);
}

export function resetAllSkillDrafts(session: LoadedJarSession): void {
  draftStore.delete(session);
}

export function getDirtySkillCount(
  session: LoadedJarSession,
  skills: SkillRecord[]
): number {
  const store = draftStore.get(session);
  if (!store) return 0;
  let count = 0;
  for (const skill of skills) {
    const draft = store.get(skill.rowIndex);
    if (draft && isSkillDraftDirty(skill, draft)) count++;
  }
  return count;
}

export function getDirtySkillDraftEntries(
  session: LoadedJarSession,
  skills: SkillRecord[]
): DirtySkillDraftEntry[] {
  const store = draftStore.get(session);
  if (!store) return [];

  const result: DirtySkillDraftEntry[] = [];
  for (const skill of skills) {
    const draft = store.get(skill.rowIndex);
    if (draft && isSkillDraftDirty(skill, draft)) {
      result.push({ skill, draft: cloneDraft(draft) });
    }
  }
  return result;
}

export function serializeSkillDraftValues(
  skill: SkillRecord,
  draft: SkillDraft
): string[] {
  const values = [...skill.sourceValues];
  while (values.length < EXPECTED_SCHEMA.length) values.push('');

  // nclass_id và template id là identity; không đổi từ panel.
  values[0] = String(skill.nclassId);
  values[1] = String(skill.id);
  values[2] = draft.name;
  values[3] = String(draft.maxPoint);
  values[4] = String(draft.manaUseType);
  values[5] = String(draft.type);
  values[6] = String(draft.iconId);
  values[7] = draft.damageInfo;
  values[8] = String(draft.slot);

  if (JSON.stringify(skill.levels) !== JSON.stringify(draft.levels)) {
    const originalWire = skill.sourceValues[9] ?? '';
    const suffix = originalWire.endsWith('\\n') ? '\\n' : '';
    values[9] = `${serializeSkillLevels(draft.levels)}${suffix}`;
  }

  return values;
}

export function exportSkillDrafts(
  session: LoadedJarSession
): Array<[number, SkillDraft]> {
  const store = draftStore.get(session);
  if (!store) return [];
  return Array.from(store.entries()).map(([rowIndex, draft]) => [
    rowIndex,
    cloneDraft(draft),
  ]);
}

export function importSkillDrafts(
  session: LoadedJarSession,
  entries: Array<[number, SkillDraft]>
): void {
  const store = new Map<number, SkillDraft>();
  for (const [rowIndex, draft] of entries ?? []) {
    store.set(rowIndex, cloneDraft(draft));
  }
  draftStore.set(session, store);
}

export function getSkillDraftFingerprint(session: LoadedJarSession): string {
  const store = draftStore.get(session);
  if (!store) return '[]';
  return JSON.stringify(
    Array.from(store.entries())
      .sort(([a], [b]) => a - b)
      .map(([rowIndex, draft]) => [rowIndex, draft])
  );
}

export function getSkillPlanetName(planet: number): string {
  return planet === 0 ? 'Trái Đất' : planet === 1 ? 'Namek' : planet === 2 ? 'Xayda' : `Hệ ${planet}`;
}

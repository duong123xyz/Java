import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { CellEvidence } from '../types/patch';
import { StringTableResult } from '../types/item';
import { getSessionClassInfo } from './patchPlannerService';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { analyzeGameData } from './gameDataService';
import { getBossDefinitions } from './bossDataService';

export interface PartFrameDefinition {
  imageId: number;
  dx: number;
  dy: number;
}

export interface PartDefinition {
  id: number;
  type: number;
  frames: PartFrameDefinition[];
  sourceClass: string;
  sourceRow: number;
  sourceValues: string[];
  cellEvidences?: Record<number, CellEvidence>;
}

export interface PartDraft {
  frames: PartFrameDefinition[];
}

export interface DirtyPartDraftEntry {
  part: PartDefinition;
  draft: PartDraft;
}

export interface PartSourceTable {
  sourceClass: string;
  sourceField: 'u';
  schema: ['id', 'type', 'frames'];
  rows: StringTableResult['rows'];
}

export interface PartDataSnapshot {
  parts: PartDefinition[];
  catalog: Map<number, PartDefinition>;
  tables: PartSourceTable[];
  totalParts: number;
  headCount: number;
  bodyCount: number;
  legCount: number;
  maxPartId: number;
}

export interface PartUsageRef {
  kind: 'item' | 'npc' | 'boss';
  label: string;
  detail: string;
}

export interface NpcStandingPartPlacement {
  partId: number;
  role: 'head' | 'body' | 'leg';
  frameIndex: number;
  imageId: number;
  drawX: number;
  drawY: number;
  dx: number;
  dy: number;
  sourceClass: string;
  sourceRow: number;
}

export interface NpcStandingComposition {
  head: NpcStandingPartPlacement;
  body: NpcStandingPartPlacement;
  leg: NpcStandingPartPlacement;
}

const PART_SOURCE_CLASSES = [
  'a/a/a/F',
  'a/a/a/G',
  'a/a/a/H',
  'a/a/a/I',
  'a/a/a/J',
  'a/a/a/K',
  'a/a/a/L',
  'a/a/a/M',
  'a/a/a/N',
  'a/a/a/O',
  'a/a/a/P',
  'a/a/a/Q',
  'a/a/a/R',
  'a/a/a/S',
] as const;

export const PART_SCHEMA = ['id', 'type', 'frames'] as const;

// Trích đúng từ renderer a.bV của client, trạng thái đứng mặc định S=0:
// a/c.a[0][0] = [0, -13, 34]  -> head
// a/c.a[0][1] = [1, -8, 10]   -> leg
// a/c.a[0][2] = [1, -9, 16]   -> body
// Renderer tính Y = baseY - offsetY + partFrame.dy.
const DEFAULT_STANDING_POSE = {
  head: { frameIndex: 0, baseX: -13, baseY: -34 },
  leg: { frameIndex: 1, baseX: -8, baseY: -10 },
  body: { frameIndex: 1, baseX: -9, baseY: -16 },
} as const;

const snapshotCache = new WeakMap<LoadedJarSession, Promise<PartDataSnapshot>>();
const usageCache = new WeakMap<
  LoadedJarSession,
  Promise<Map<number, PartUsageRef[]>>
>();
const draftStore = new WeakMap<LoadedJarSession, Map<number, PartDraft>>();

function cloneFrames(frames: PartFrameDefinition[]): PartFrameDefinition[] {
  return frames.map((frame) => ({ ...frame }));
}

function cloneDraft(draft: PartDraft): PartDraft {
  return { frames: cloneFrames(draft.frames) };
}

export function parsePartFrames(encoded: string): PartFrameDefinition[] {
  const frames: PartFrameDefinition[] = [];
  const matcher = /\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(encoded)) !== null) {
    frames.push({
      imageId: Number.parseInt(match[1], 10),
      dx: Number.parseInt(match[2], 10),
      dy: Number.parseInt(match[3], 10),
    });
  }

  return frames;
}

export function serializePartFrames(frames: PartFrameDefinition[]): string {
  return `[${frames
    .map((frame) => `[${Math.round(frame.imageId)},${Math.round(frame.dx)},${Math.round(frame.dy)}]`)
    .join(',')}]`;
}

async function readPartTable(
  session: LoadedJarSession,
  sourceClass: string
): Promise<PartSourceTable> {
  const classInfo: ClassFileInfo | null = await getSessionClassInfo(
    session,
    sourceClass
  );
  if (!classInfo) {
    throw new Error(`Không tìm thấy ${sourceClass}.class khi đọc dữ liệu part.`);
  }

  const clinit = classInfo.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) {
    throw new Error(`Không giải mã được <clinit> của ${sourceClass}.class.`);
  }

  const sourceField = classInfo.fields.find((field) => field.name === 'u');
  if (!sourceField) {
    throw new Error(`Không tìm thấy field u trong ${sourceClass}.class.`);
  }

  const reconstructed = reconstructStringArrayTable(
    sourceClass,
    'u',
    sourceField.descriptor,
    0,
    clinit.code.instructions,
    classInfo.constantPool,
    PART_SCHEMA.length
  );

  if (reconstructed.parseError) {
    throw new Error(
      `Không phục dựng được bảng part ${sourceClass}.u: ${reconstructed.parseError}`
    );
  }

  return {
    sourceClass,
    sourceField: 'u',
    schema: [...PART_SCHEMA] as ['id', 'type', 'frames'],
    rows: reconstructed.rows,
  };
}

function rowToPart(
  sourceClass: string,
  row: StringTableResult['rows'][number]
): PartDefinition | null {
  const id = Number.parseInt(row.values[0] ?? '', 10);
  const type = Number.parseInt(row.values[1] ?? '', 10);
  const frames = parsePartFrames(row.values[2] ?? '');

  if (
    !Number.isInteger(id) ||
    !Number.isInteger(type) ||
    ![0, 1, 2].includes(type) ||
    frames.length === 0
  ) {
    return null;
  }

  return {
    id,
    type,
    frames,
    sourceClass,
    sourceRow: row.rowIndex,
    sourceValues: [...row.values],
    cellEvidences: row.cellEvidences,
  };
}

export async function loadPartSnapshot(
  session: LoadedJarSession
): Promise<PartDataSnapshot> {
  const cached = snapshotCache.get(session);
  if (cached) return cached;

  const promise = (async () => {
    const tables = await Promise.all(
      PART_SOURCE_CLASSES.map((sourceClass) =>
        readPartTable(session, sourceClass)
      )
    );

    const parts: PartDefinition[] = [];
    const catalog = new Map<number, PartDefinition>();

    for (const table of tables) {
      for (const row of table.rows) {
        const part = rowToPart(table.sourceClass, row);
        if (!part) continue;
        parts.push(part);
        catalog.set(part.id, part);
      }
    }

    parts.sort((a, b) => a.id - b.id);

    return {
      parts,
      catalog,
      tables,
      totalParts: parts.length,
      headCount: parts.filter((part) => part.type === 0).length,
      bodyCount: parts.filter((part) => part.type === 1).length,
      legCount: parts.filter((part) => part.type === 2).length,
      maxPartId: parts.reduce((max, part) => Math.max(max, part.id), -1),
    };
  })();

  snapshotCache.set(session, promise);
  return promise;
}

export async function loadPartCatalog(
  session: LoadedJarSession
): Promise<Map<number, PartDefinition>> {
  return (await loadPartSnapshot(session)).catalog;
}

export function getPartTypeLabel(type: number): string {
  return type === 0 ? 'Head' : type === 1 ? 'Body' : type === 2 ? 'Leg' : `Type ${type}`;
}

function draftFromPart(part: PartDefinition): PartDraft {
  return {
    frames: cloneFrames(part.frames),
  };
}

export function getPartDraft(
  session: LoadedJarSession,
  part: PartDefinition
): PartDraft {
  let store = draftStore.get(session);
  if (!store) {
    store = new Map<number, PartDraft>();
    draftStore.set(session, store);
  }

  const existing = store.get(part.id);
  if (existing) return cloneDraft(existing);

  const draft = draftFromPart(part);
  store.set(part.id, cloneDraft(draft));
  return draft;
}

export function setPartDraft(
  session: LoadedJarSession,
  part: PartDefinition,
  draft: PartDraft
): void {
  let store = draftStore.get(session);
  if (!store) {
    store = new Map<number, PartDraft>();
    draftStore.set(session, store);
  }

  const normalized: PartDraft = {
    frames: draft.frames.map((frame) => ({
      imageId: Math.max(-1, Math.min(65535, Math.round(Number(frame.imageId) || 0))),
      dx: Math.max(-32768, Math.min(32767, Math.round(Number(frame.dx) || 0))),
      dy: Math.max(-32768, Math.min(32767, Math.round(Number(frame.dy) || 0))),
    })),
  };

  if (normalized.frames.length !== part.frames.length) {
    throw new Error(
      `Part #${part.id} cần giữ nguyên ${part.frames.length} frame để không phá index animation.`
    );
  }

  if (isPartDraftDirty(part, normalized)) {
    store.set(part.id, normalized);
  } else {
    store.delete(part.id);
  }
}

export function isPartDraftDirty(
  part: PartDefinition,
  draft: PartDraft
): boolean {
  return JSON.stringify(part.frames) !== JSON.stringify(draft.frames);
}

export function resetPartDraft(
  session: LoadedJarSession,
  part: PartDefinition
): PartDraft {
  draftStore.get(session)?.delete(part.id);
  return draftFromPart(part);
}

export function resetAllPartDrafts(session: LoadedJarSession): void {
  draftStore.delete(session);
}

export function getDirtyPartCount(
  session: LoadedJarSession,
  parts: PartDefinition[]
): number {
  const store = draftStore.get(session);
  if (!store) return 0;

  let count = 0;
  for (const part of parts) {
    const draft = store.get(part.id);
    if (draft && isPartDraftDirty(part, draft)) count++;
  }
  return count;
}

export function getDirtyPartDraftEntries(
  session: LoadedJarSession,
  parts: PartDefinition[]
): DirtyPartDraftEntry[] {
  const store = draftStore.get(session);
  if (!store) return [];

  const result: DirtyPartDraftEntry[] = [];
  for (const part of parts) {
    const draft = store.get(part.id);
    if (draft && isPartDraftDirty(part, draft)) {
      result.push({
        part,
        draft: cloneDraft(draft),
      });
    }
  }
  return result;
}

export function exportPartDrafts(
  session: LoadedJarSession
): Array<[number, PartDraft]> {
  const store = draftStore.get(session);
  if (!store) return [];

  return Array.from(store.entries()).map(([partId, draft]) => [
    partId,
    cloneDraft(draft),
  ]);
}

export function importPartDrafts(
  session: LoadedJarSession,
  entries: Array<[number, PartDraft]>
): void {
  const store = new Map<number, PartDraft>();
  for (const [partId, draft] of entries ?? []) {
    store.set(partId, cloneDraft(draft));
  }
  draftStore.set(session, store);
}

export function getPartDraftFingerprint(session: LoadedJarSession): string {
  const store = draftStore.get(session);
  if (!store) return '[]';

  return JSON.stringify(
    Array.from(store.entries())
      .sort(([a], [b]) => a - b)
      .map(([partId, draft]) => [partId, draft])
  );
}

export function serializePartDraftValues(
  part: PartDefinition,
  draft: PartDraft
): string[] {
  const values = [...part.sourceValues];
  while (values.length < PART_SCHEMA.length) values.push('');

  values[0] = String(part.id);
  values[1] = String(part.type);
  values[2] = serializePartFrames(draft.frames);

  return values;
}

export async function analyzePartUsages(
  session: LoadedJarSession
): Promise<Map<number, PartUsageRef[]>> {
  const cached = usageCache.get(session);
  if (cached) return cached;

  const promise = (async () => {
    const snapshot = await loadPartSnapshot(session);
    const result = new Map<number, PartUsageRef[]>();

    const add = (partId: number, usage: PartUsageRef) => {
      if (!snapshot.catalog.has(partId)) return;
      const list = result.get(partId) ?? [];
      list.push(usage);
      result.set(partId, list);
    };

    try {
      const gameData = await analyzeGameData(session);

      for (const npc of gameData.npcs) {
        const ids = [
          ['head', Number(npc.head)],
          ['body', Number(npc.body)],
          ['leg', Number(npc.leg)],
        ] as const;

        for (const [role, partId] of ids) {
          if (Number.isInteger(partId)) {
            add(partId, {
              kind: 'npc',
              label: npc.name || `NPC #${npc.id}`,
              detail: `NPC #${npc.id} · ${role}`,
            });
          }
        }
      }

      for (const item of gameData.itemAnalysis?.items ?? []) {
        const candidates = [
          ['part', Number(item.part)],
          ['head', Number(item.head)],
          ['body', Number(item.body)],
          ['leg', Number(item.leg)],
        ] as const;

        const seen = new Set<number>();
        for (const [field, partId] of candidates) {
          if (!Number.isInteger(partId) || partId < 0 || seen.has(partId)) continue;
          seen.add(partId);
          add(partId, {
            kind: 'item',
            label: item.name || `Item #${item.id}`,
            detail: `Item #${item.id} · field ${field}`,
          });
        }
      }
    } catch (error) {
      console.warn('[part usage] Không đọc được NPC/Item usage:', error);
    }

    for (const boss of getBossDefinitions()) {
      const refs = [
        ['head', boss.head],
        ['body', boss.body],
        ['leg', boss.leg],
      ] as const;

      for (const [role, partId] of refs) {
        add(partId, {
          kind: 'boss',
          label: boss.name,
          detail: `Boss #${boss.index} · ${role} · map ${boss.mapId}`,
        });
      }
    }

    for (const list of result.values()) {
      list.sort((a, b) => {
        const order = { item: 0, npc: 1, boss: 2 } as const;
        return order[a.kind] - order[b.kind] || a.label.localeCompare(b.label);
      });
    }

    return result;
  })();

  usageCache.set(session, promise);
  return promise;
}

function getRequiredFrame(
  part: PartDefinition,
  role: 'head' | 'body' | 'leg',
  frameIndex: number
): PartFrameDefinition {
  const frame = part.frames[frameIndex];
  if (!frame || frame.imageId < 0) {
    throw new Error(
      `Part ${part.id} (${role}) không có frame đứng hợp lệ tại index ${frameIndex}.`
    );
  }
  return frame;
}

export async function resolveNpcStandingComposition(
  session: LoadedJarSession,
  headPartId: number,
  bodyPartId: number,
  legPartId: number
): Promise<NpcStandingComposition> {
  const catalog = await loadPartCatalog(session);

  const headPart = catalog.get(headPartId);
  const bodyPart = catalog.get(bodyPartId);
  const legPart = catalog.get(legPartId);

  if (!headPart) throw new Error(`Không tìm thấy head part #${headPartId}.`);
  if (!bodyPart) throw new Error(`Không tìm thấy body part #${bodyPartId}.`);
  if (!legPart) throw new Error(`Không tìm thấy leg part #${legPartId}.`);

  const headFrame = getRequiredFrame(
    headPart,
    'head',
    DEFAULT_STANDING_POSE.head.frameIndex
  );
  const bodyFrame = getRequiredFrame(
    bodyPart,
    'body',
    DEFAULT_STANDING_POSE.body.frameIndex
  );
  const legFrame = getRequiredFrame(
    legPart,
    'leg',
    DEFAULT_STANDING_POSE.leg.frameIndex
  );

  return {
    head: {
      partId: headPartId,
      role: 'head',
      frameIndex: DEFAULT_STANDING_POSE.head.frameIndex,
      imageId: headFrame.imageId,
      drawX: DEFAULT_STANDING_POSE.head.baseX + headFrame.dx,
      drawY: DEFAULT_STANDING_POSE.head.baseY + headFrame.dy,
      dx: headFrame.dx,
      dy: headFrame.dy,
      sourceClass: headPart.sourceClass,
      sourceRow: headPart.sourceRow,
    },
    body: {
      partId: bodyPartId,
      role: 'body',
      frameIndex: DEFAULT_STANDING_POSE.body.frameIndex,
      imageId: bodyFrame.imageId,
      drawX: DEFAULT_STANDING_POSE.body.baseX + bodyFrame.dx,
      drawY: DEFAULT_STANDING_POSE.body.baseY + bodyFrame.dy,
      dx: bodyFrame.dx,
      dy: bodyFrame.dy,
      sourceClass: bodyPart.sourceClass,
      sourceRow: bodyPart.sourceRow,
    },
    leg: {
      partId: legPartId,
      role: 'leg',
      frameIndex: DEFAULT_STANDING_POSE.leg.frameIndex,
      imageId: legFrame.imageId,
      drawX: DEFAULT_STANDING_POSE.leg.baseX + legFrame.dx,
      drawY: DEFAULT_STANDING_POSE.leg.baseY + legFrame.dy,
      dx: legFrame.dx,
      dy: legFrame.dy,
      sourceClass: legPart.sourceClass,
      sourceRow: legPart.sourceRow,
    },
  };
}

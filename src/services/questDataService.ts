import JSZip from 'jszip';
import { LoadedJarSession } from '../types/jar';
import { parseClassFile } from './classFileParser';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { rewriteClass } from './classFileRewriter';
import { getModifiedUtf8ByteLength } from './modifiedUtf8Service';
import { ClassPatchGroup, ItemFieldPatchPlan } from '../types/patch';
import { StringTableResult } from '../types/item';

export const QUEST_MAIN_CLASS = 'a/a/a/Z';
export const QUEST_STEP_CLASS = 'a/a/a/ab';
export const QUEST_FIELD = 'u';

export const QUEST_MAIN_SCHEMA = ['id', 'NAME', 'detail'] as const;
export const QUEST_STEP_SCHEMA = [
  'task_main_id',
  'NAME',
  'max_count',
  'notify',
  'npc_id',
  'map',
  'ducvupro',
] as const;

export interface QuestCellEdit {
  sourceClass: typeof QUEST_MAIN_CLASS | typeof QUEST_STEP_CLASS;
  sourceField: 'u';
  rowIndex: number;
  columnIndex: number;
  value: string;
}

export interface QuestStepRecord {
  rowIndex: number;
  values: string[];
}

export interface QuestRecord {
  rowIndex: number;
  id: string;
  name: string;
  detail: string;
  steps: QuestStepRecord[];
  runtimeOverride: boolean;
  runtimeOverrideNote?: string;
}

export interface QuestAnalysisSnapshot {
  mainTable: StringTableResult;
  stepTable: StringTableResult;
  quests: QuestRecord[];
  diagnostics: {
    mainRows: number;
    stepRows: number;
    orphanSteps: number;
    duplicateMainIds: string[];
    runtimeOverrides: string[];
  };
}

export interface QuestPatchCandidate {
  blob: Blob;
  metrics: {
    editCount: number;
    rewrittenClasses: string[];
    rewardOverrideCount: number;
    rewardHookMode: 'NONE' | 'INSTALLED' | 'REUSED';
  };
}

function getEntry(session: LoadedJarSession, path: string) {
  return session.zip.file(path) || session.entries.find((entry) => entry.path === path)?.zipEntry || null;
}

async function readTable(
  session: LoadedJarSession,
  sourceClass: string,
  expectedColumns: number
): Promise<StringTableResult> {
  const entry = getEntry(session, `${sourceClass}.class`);
  if (!entry) throw new Error(`Không tìm thấy ${sourceClass}.class trong JAR.`);
  const parsed = parseClassFile(await entry.async('arraybuffer'));
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error(`${sourceClass}.class không parse VALID.`);
  }
  const clinit = parsed.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) throw new Error(`${sourceClass}.<clinit> không có instructions.`);
  const table = reconstructStringArrayTable(
    sourceClass,
    QUEST_FIELD,
    '[[Ljava/lang/String;',
    0,
    clinit.code.instructions,
    parsed.constantPool,
    expectedColumns
  );
  if (table.parseError) throw new Error(`${sourceClass}.u: ${table.parseError}`);
  return table;
}

function duplicateIds(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([id, count]) => id !== '' && count > 1).map(([id]) => id);
}

export async function analyzeQuests(session: LoadedJarSession): Promise<QuestAnalysisSnapshot> {
  const [mainTable, stepTable] = await Promise.all([
    readTable(session, QUEST_MAIN_CLASS, QUEST_MAIN_SCHEMA.length),
    readTable(session, QUEST_STEP_CLASS, QUEST_STEP_SCHEMA.length),
  ]);

  const mainIds = new Set(mainTable.rows.map((row) => row.values[0] ?? ''));
  const quests: QuestRecord[] = mainTable.rows.map((row) => {
    const id = row.values[0] ?? '';
    const runtimeOverride = id === '29';
    return {
      rowIndex: row.rowIndex,
      id,
      name: row.values[1] ?? '',
      detail: row.values[2] ?? '',
      steps: stepTable.rows
        .filter((step) => (step.values[0] ?? '') === id)
        .map((step) => ({ rowIndex: step.rowIndex, values: [...step.values] })),
      runtimeOverride,
      runtimeOverrideNote: runtimeOverride
        ? 'Task #29 bị a/a/a/Y chuyển sang patch/LegendQuest.main()/steps(), nên sửa bảng Z/ab không đổi runtime của nhiệm vụ này.'
        : undefined,
    };
  });

  return {
    mainTable,
    stepTable,
    quests,
    diagnostics: {
      mainRows: mainTable.rows.length,
      stepRows: stepTable.rows.length,
      orphanSteps: stepTable.rows.filter((row) => !mainIds.has(row.values[0] ?? '')).length,
      duplicateMainIds: duplicateIds(mainTable.rows.map((row) => row.values[0] ?? '')),
      runtimeOverrides: ['29 = LegendQuest runtime override', '30 = PlantInvasionQuest runtime-only, không nằm trong Z.u'],
    },
  };
}

function validationSessionForSchema(session: LoadedJarSession, schema: readonly string[]): LoadedJarSession {
  const currentAnalysis: any = session.itemAnalysis ?? {};
  return {
    ...(session as any),
    itemAnalysis: {
      ...currentAnalysis,
      diagnostics: {
        ...(currentAnalysis.diagnostics ?? {}),
        schemaColumns: [...schema],
      },
    },
  } as LoadedJarSession;
}

function makePlan(
  sourceClass: string,
  rowIndex: number,
  columnIndex: number,
  fieldName: string,
  originalValue: string,
  draftValue: string,
  evidence: NonNullable<StringTableResult['rows'][number]['cellEvidences']>[number],
  cpCount: number
): ItemFieldPatchPlan {
  return {
    id: `quest|${sourceClass}|u|${rowIndex}|${columnIndex}`,
    draftKey: `quest|${sourceClass}|u|${rowIndex}`,
    sourceClass,
    sourceField: 'u',
    sourceRow: rowIndex,
    fieldName,
    columnIndex,
    originalValue,
    draftValue,
    hasEvidence: !evidence.isUnsupportedProducer,
    producerOffset: evidence.producerInstructionOffset,
    producerOpcode: evidence.producerOpcode,
    producerMnemonic: evidence.producerMnemonic,
    aastoreOffset: evidence.aastoreInstructionOffset,
    cpStringIndex: evidence.stringConstantIndex ?? evidence.constantPoolIndex,
    utf8Index: evidence.utf8Index,
    utf8RawString: evidence.utf8RawString,
    isShared: true,
    stringConstantInstructionRefCount: 2,
    tableCellUsageCount: 2,
    utf8TotalCpRefCount: 2,
    sharingExplanation: 'Quest writer luôn clone + retarget để không làm đổi cell dùng chung constant.',
    originalMutf8Length: getModifiedUtf8ByteLength(originalValue),
    draftMutf8Length: getModifiedUtf8ByteLength(draftValue),
    mutf8Delta: getModifiedUtf8ByteLength(draftValue) - getModifiedUtf8ByteLength(originalValue),
    requiresConstantClone: true,
    requiresClassRebuild: true,
    currentOpcodeIsLdc: evidence.producerOpcode === 0x12,
    mayRequireLdcW: evidence.producerOpcode === 0x12 && cpCount + 2 > 255,
    currentCpCount: cpCount,
    strategy: 'CLONE_AND_RETARGET',
    riskLevel: 'NEEDS_REBUILD',
    status: 'NEEDS_REBUILD',
    statusMessage: 'Clone CONSTANT_String + retarget producer.',
    diagnostics: [],
  };
}

async function patchOneQuestClass(
  zip: JSZip,
  session: LoadedJarSession,
  sourceClass: typeof QUEST_MAIN_CLASS | typeof QUEST_STEP_CLASS,
  edits: QuestCellEdit[]
): Promise<boolean> {
  if (!edits.length) return false;
  const schema = sourceClass === QUEST_MAIN_CLASS ? QUEST_MAIN_SCHEMA : QUEST_STEP_SCHEMA;
  const path = `${sourceClass}.class`;
  const entry = zip.file(path);
  if (!entry) throw new Error(`Quest writer: thiếu ${path}.`);

  const originalBytes = await entry.async('arraybuffer');
  const parsed = parseClassFile(originalBytes);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error(`Quest writer: ${path} không parse VALID.`);
  }
  const clinit = parsed.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) throw new Error(`Quest writer: ${sourceClass}.<clinit> không decode được.`);

  const table = reconstructStringArrayTable(
    sourceClass,
    'u',
    '[[Ljava/lang/String;',
    0,
    clinit.code.instructions,
    parsed.constantPool,
    schema.length
  );
  if (table.parseError) throw new Error(`Quest writer: ${sourceClass}.u ${table.parseError}`);

  const plans: ItemFieldPatchPlan[] = [];
  for (const edit of edits) {
    const row = table.rows[edit.rowIndex];
    if (!row) throw new Error(`Quest writer: row ${edit.rowIndex} không tồn tại trong ${sourceClass}.u.`);
    if (edit.columnIndex < 0 || edit.columnIndex >= schema.length) {
      throw new Error(`Quest writer: column ${edit.columnIndex} ngoài schema ${sourceClass}.u.`);
    }
    const current = row.values[edit.columnIndex] ?? '';
    if (current === edit.value) continue;
    const evidence = row.cellEvidences?.[edit.columnIndex];
    if (!evidence || evidence.isUnsupportedProducer) {
      throw new Error(`Quest writer: thiếu evidence an toàn tại ${sourceClass}.u row ${edit.rowIndex} col ${edit.columnIndex}.`);
    }
    plans.push(makePlan(
      sourceClass,
      edit.rowIndex,
      edit.columnIndex,
      schema[edit.columnIndex] ?? `col_${edit.columnIndex}`,
      current,
      String(edit.value ?? ''),
      evidence as any,
      parsed.constantPoolCount
    ));
  }

  if (!plans.length) return false;
  const group: ClassPatchGroup = {
    sourceClass,
    classEntryPath: path,
    plans,
    modifiedCellCount: plans.length,
    totalModifiedCells: plans.length,
    modifiedItemCount: new Set(plans.map((plan) => plan.sourceRow)).size,
    requiresRebuild: true,
    hasUnsupportedPlans: false,
    sharedConstantsCount: plans.length,
    uniqueConstantsCount: 0,
  };

  const result = await rewriteClass(
    originalBytes,
    parsed,
    group,
    validationSessionForSchema(session, schema)
  );
  if (result.status !== 'VALIDATED' || !result.rewrittenBytes) {
    throw new Error(`Quest writer ${sourceClass}: ${result.errorMessage || 'rewrite FAILED'}`);
  }
  zip.file(path, result.rewrittenBytes);
  return true;
}


export interface QuestRewardOverride {
  questId: number;
  enabled: boolean;
  gold: number;
  power: number;
  potential: number;
  gems: number;
  itemId: number | null;
  itemQuantity: number;
}

export interface QuestRewardValues {
  gold: number;
  power: number;
  potential: number;
  gems: number;
  itemId: number | null;
  itemQuantity: number;
}

const QUEST_REWARD_TARGET_CLASS = 'a/a/X';
const QUEST_REWARD_TARGET_PATH = `${QUEST_REWARD_TARGET_CLASS}.class`;
const QUEST_REWARD_HELPER_INTERNAL_NAME = 'a/a/PanelQuestRewardRuntime';
const QUEST_REWARD_HELPER_PATH = `${QUEST_REWARD_HELPER_INTERNAL_NAME}.class`;
const JAVA_INT_MIN = -2147483648;
const JAVA_INT_MAX = 2147483647;

/** Runtime reward gốc của a/a/X.c(H, questId) trên v1.9.6f. */
export function getOriginalQuestReward(questId: number): QuestRewardValues {
  const id = Math.round(Number(questId));
  let power = 0;
  let potential = 0;
  if (id === 0) power = potential = 500;
  else if (id === 1) power = potential = 1000;
  else if (id === 2) power = potential = 1200;
  else if (id === 3) power = potential = 3000;
  else if (id === 4) power = potential = 7000;
  else if (id === 5) power = potential = 20000;

  let gold = 0;
  if (id > 0 && id < 25) {
    const extra = 500 * (id + 1);
    power += extra;
    potential += extra;
    gold = id < 5 ? 100000 * (id + 1) : 500000;
  }
  return { gold, power, potential, gems: 0, itemId: null, itemQuantity: 1 };
}

function normalizeQuestRewardOverrides(input: QuestRewardOverride[]): QuestRewardOverride[] {
  const byQuest = new Map<number, QuestRewardOverride>();
  const safeLong = (value: unknown) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, n);
  };
  for (const raw of input ?? []) {
    const questId = Math.round(Number(raw?.questId));
    if (!Number.isInteger(questId) || questId < 0 || questId > 30) continue;
    const itemRaw = raw?.itemId == null ? null : Math.round(Number(raw.itemId));
    const itemId = itemRaw == null || !Number.isInteger(itemRaw) || itemRaw < 0 || itemRaw > 32767
      ? null
      : itemRaw;
    byQuest.set(questId, {
      questId,
      enabled: raw?.enabled === true,
      gold: safeLong(raw?.gold),
      power: safeLong(raw?.power),
      potential: safeLong(raw?.potential),
      gems: Math.max(0, Math.min(JAVA_INT_MAX, Math.round(Number(raw?.gems) || 0))),
      itemId,
      itemQuantity: Math.max(1, Math.min(JAVA_INT_MAX, Math.round(Number(raw?.itemQuantity) || 1))),
    });
  }
  return [...byQuest.values()].sort((a, b) => a.questId - b.questId);
}

interface QuestRawCpEntry {
  index: number;
  tag: number;
  tagOffset: number;
  payloadOffset: number;
  value?: string | number | bigint;
}
interface QuestRawMethodLayout {
  name: string;
  descriptor: string;
  codeStart: number;
  codeLength: number;
  codeEnd: number;
}
interface QuestRawClassLayout {
  constantPool: Array<QuestRawCpEntry | null>;
  utf8: Map<number, string>;
  cpEnd: number;
  methods: QuestRawMethodLayout[];
}
interface QuestMutableClass {
  bytes: Uint8Array;
  layout: QuestRawClassLayout;
}

const Q_UTF8 = 1;
const Q_INTEGER = 3;
const Q_FLOAT = 4;
const Q_LONG = 5;
const Q_DOUBLE = 6;
const Q_CLASS = 7;
const Q_STRING = 8;
const Q_FIELDREF = 9;
const Q_METHODREF = 10;
const Q_INTERFACE_METHODREF = 11;
const Q_NAME_AND_TYPE = 12;
const Q_METHOD_HANDLE = 15;
const Q_METHOD_TYPE = 16;
const Q_DYNAMIC = 17;
const Q_INVOKE_DYNAMIC = 18;
const Q_MODULE = 19;
const Q_PACKAGE = 20;

function qReadU2(view: DataView, offset: number): number { return view.getUint16(offset, false); }
function qReadU4(view: DataView, offset: number): number { return view.getUint32(offset, false); }
function qWriteU2(view: DataView, offset: number, value: number): void { view.setUint16(offset, value & 0xffff, false); }
function qWriteU4(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, false); }
function qToArrayBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }

function qSkipAttributes(view: DataView, offset: number, count: number): number {
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    cursor += 2;
    const length = qReadU4(view, cursor);
    cursor += 4 + length;
  }
  return cursor;
}

function qParseRawClassLayout(buffer: ArrayBuffer): QuestRawClassLayout {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0xcafebabe) throw new Error('Quest reward hook: class thiếu CAFEBABE.');
  const cpCount = qReadU2(view, 8);
  const constantPool: Array<QuestRawCpEntry | null> = new Array(cpCount).fill(null);
  const utf8 = new Map<number, string>();
  let cursor = 10;
  for (let index = 1; index < cpCount; index++) {
    const tagOffset = cursor;
    const tag = view.getUint8(cursor++);
    const payloadOffset = cursor;
    switch (tag) {
      case Q_UTF8: {
        const len = qReadU2(view, cursor); cursor += 2;
        const value = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(cursor, cursor + len));
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        utf8.set(index, value);
        cursor += len;
        break;
      }
      case Q_INTEGER:
      case Q_FLOAT:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 4;
        break;
      case Q_LONG:
      case Q_DOUBLE:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 8;
        index++;
        if (index < cpCount) constantPool[index] = null;
        break;
      case Q_CLASS:
      case Q_STRING:
      case Q_METHOD_TYPE:
      case Q_MODULE:
      case Q_PACKAGE:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 2;
        break;
      case Q_FIELDREF:
      case Q_METHODREF:
      case Q_INTERFACE_METHODREF:
      case Q_NAME_AND_TYPE:
      case Q_DYNAMIC:
      case Q_INVOKE_DYNAMIC:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 4;
        break;
      case Q_METHOD_HANDLE:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 3;
        break;
      default:
        throw new Error(`Quest reward hook: CP tag ${tag} chưa hỗ trợ.`);
    }
  }
  const cpEnd = cursor;
  cursor += 6; // access/this/super
  const interfaces = qReadU2(view, cursor); cursor += 2 + interfaces * 2;
  const fields = qReadU2(view, cursor); cursor += 2;
  for (let i = 0; i < fields; i++) {
    cursor += 6;
    const attrs = qReadU2(view, cursor); cursor += 2;
    cursor = qSkipAttributes(view, cursor, attrs);
  }
  const methodsCount = qReadU2(view, cursor); cursor += 2;
  const methods: QuestRawMethodLayout[] = [];
  for (let i = 0; i < methodsCount; i++) {
    cursor += 2;
    const nameIndex = qReadU2(view, cursor); cursor += 2;
    const descIndex = qReadU2(view, cursor); cursor += 2;
    const attrs = qReadU2(view, cursor); cursor += 2;
    const name = utf8.get(nameIndex) ?? '';
    const descriptor = utf8.get(descIndex) ?? '';
    for (let a = 0; a < attrs; a++) {
      const attrNameIndex = qReadU2(view, cursor); cursor += 2;
      const attrLength = qReadU4(view, cursor); cursor += 4;
      const dataStart = cursor;
      if ((utf8.get(attrNameIndex) ?? '') === 'Code') {
        const codeLength = qReadU4(view, dataStart + 4);
        const codeStart = dataStart + 8;
        methods.push({ name, descriptor, codeStart, codeLength, codeEnd: codeStart + codeLength });
      }
      cursor = dataStart + attrLength;
    }
  }
  return { constantPool, utf8, cpEnd, methods };
}

function qRawUtf8(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const out = new Uint8Array(3 + encoded.length);
  out[0] = Q_UTF8;
  const view = new DataView(out.buffer);
  qWriteU2(view, 1, encoded.length);
  out.set(encoded, 3);
  return out;
}
function qRawU2(tag: number, value: number): Uint8Array {
  return new Uint8Array([tag, (value >> 8) & 0xff, value & 0xff]);
}
function qRawU2U2(tag: number, a: number, b: number): Uint8Array {
  return new Uint8Array([tag, (a >> 8) & 0xff, a & 0xff, (b >> 8) & 0xff, b & 0xff]);
}
function qAppendCpEntry(target: QuestMutableClass, entry: Uint8Array): number {
  const currentCount = target.layout.constantPool.length;
  const cpEnd = target.layout.cpEnd;
  const next = new Uint8Array(target.bytes.length + entry.length);
  next.set(target.bytes.slice(0, cpEnd));
  next.set(entry, cpEnd);
  next.set(target.bytes.slice(cpEnd), cpEnd + entry.length);
  qWriteU2(new DataView(next.buffer), 8, currentCount + 1);
  target.bytes = next;
  target.layout = qParseRawClassLayout(qToArrayBuffer(next));
  return currentCount;
}
function qAppendRewardMethodRef(target: QuestMutableClass): number {
  const ownerUtf8 = qAppendCpEntry(target, qRawUtf8(QUEST_REWARD_HELPER_INTERNAL_NAME));
  const ownerClass = qAppendCpEntry(target, qRawU2(Q_CLASS, ownerUtf8));
  const nameUtf8 = qAppendCpEntry(target, qRawUtf8('apply'));
  const descUtf8 = qAppendCpEntry(target, qRawUtf8('(La/a/H;I)V'));
  const nat = qAppendCpEntry(target, qRawU2U2(Q_NAME_AND_TYPE, nameUtf8, descUtf8));
  return qAppendCpEntry(target, qRawU2U2(Q_METHODREF, ownerClass, nat));
}

function qResolveInvoke(target: QuestMutableClass, absolute: number): { owner: string; name: string; descriptor: string } | null {
  const opcode = target.bytes[absolute];
  if (![0xb6, 0xb7, 0xb8, 0xb9].includes(opcode)) return null;
  const cpIndex = (target.bytes[absolute + 1] << 8) | target.bytes[absolute + 2];
  const ref = target.layout.constantPool[cpIndex];
  if (!ref || (ref.tag !== Q_METHODREF && ref.tag !== Q_INTERFACE_METHODREF)) return null;
  const view = new DataView(target.bytes.buffer, target.bytes.byteOffset, target.bytes.byteLength);
  const classIndex = qReadU2(view, ref.payloadOffset);
  const natIndex = qReadU2(view, ref.payloadOffset + 2);
  const classEntry = target.layout.constantPool[classIndex];
  const natEntry = target.layout.constantPool[natIndex];
  if (!classEntry || classEntry.tag !== Q_CLASS || !natEntry || natEntry.tag !== Q_NAME_AND_TYPE) return null;
  const owner = target.layout.utf8.get(qReadU2(view, classEntry.payloadOffset)) ?? '';
  const name = target.layout.utf8.get(qReadU2(view, natEntry.payloadOffset)) ?? '';
  const descriptor = target.layout.utf8.get(qReadU2(view, natEntry.payloadOffset + 2)) ?? '';
  return owner && name && descriptor ? { owner, name, descriptor } : null;
}

function qFindInvokes(target: QuestMutableClass, method: QuestRawMethodLayout, owner: string, name: string, descriptor: string): number[] {
  const result: number[] = [];
  for (let rel = 0; rel + 2 < method.codeLength; rel++) {
    const abs = method.codeStart + rel;
    const ref = qResolveInvoke(target, abs);
    if (ref?.owner === owner && ref.name === name && ref.descriptor === descriptor) result.push(rel);
  }
  return result;
}

function qImmediatePush(value: number): number[] | null {
  if (!Number.isInteger(value)) return null;
  if (value === -1) return [0x02];
  if (value >= 0 && value <= 5) return [0x03 + value];
  if (value >= -128 && value <= 127) return [0x10, value & 0xff];
  if (value >= -32768 && value <= 32767) {
    const n = value & 0xffff;
    return [0x11, (n >> 8) & 0xff, n & 0xff];
  }
  return null;
}

class QuestHelperConstantPool {
  private entries: Uint8Array[] = [];
  private cache = new Map<string, number>();
  private nextIndex = 1;

  /** Long/Double chiếm 2 slot CP nhưng chỉ có 1 payload được serialize. */
  private add(key: string, bytes: Uint8Array, slots = 1): number {
    const old = this.cache.get(key);
    if (old != null) return old;
    const index = this.nextIndex;
    this.entries.push(bytes);
    this.nextIndex += slots;
    this.cache.set(key, index);
    return index;
  }
  utf8(value: string): number { return this.add(`u:${value}`, qRawUtf8(value)); }
  clazz(name: string): number { const u = this.utf8(name); return this.add(`c:${name}`, qRawU2(Q_CLASS, u)); }
  nameAndType(name: string, desc: string): number {
    const n = this.utf8(name); const d = this.utf8(desc);
    return this.add(`nt:${name}:${desc}`, qRawU2U2(Q_NAME_AND_TYPE, n, d));
  }
  fieldRef(owner: string, name: string, desc: string): number {
    return this.add(`f:${owner}:${name}:${desc}`, qRawU2U2(Q_FIELDREF, this.clazz(owner), this.nameAndType(name, desc)));
  }
  methodRef(owner: string, name: string, desc: string): number {
    return this.add(`m:${owner}:${name}:${desc}`, qRawU2U2(Q_METHODREF, this.clazz(owner), this.nameAndType(name, desc)));
  }
  integer(value: number): number {
    const out = new Uint8Array(5); out[0] = Q_INTEGER;
    new DataView(out.buffer).setInt32(1, value, false);
    return this.add(`i:${value}`, out);
  }
  long(value: number): number {
    const safe = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(value) || 0)));
    const base = 0x100000000;
    const high = Math.floor(safe / base);
    const low = safe - high * base;
    const out = new Uint8Array(9);
    out[0] = Q_LONG;
    const view = new DataView(out.buffer);
    view.setUint32(1, high >>> 0, false);
    view.setUint32(5, low >>> 0, false);
    return this.add(`j:${safe}`, out, 2);
  }
  serialize(): Uint8Array {
    const out = new Uint8Array(this.entries.reduce((n, e) => n + e.length, 0));
    let cursor = 0;
    for (const e of this.entries) { out.set(e, cursor); cursor += e.length; }
    return out;
  }
  get count(): number { return this.nextIndex; }
}

function qPushInt(cp: QuestHelperConstantPool, value: number): number[] {
  const direct = qImmediatePush(value);
  if (direct) return direct;
  const index = cp.integer(value);
  return index <= 255 ? [0x12, index] : [0x13, (index >> 8) & 0xff, index & 0xff];
}
function qALoad(index: number): number[] { return index <= 3 ? [0x2a + index] : [0x19, index & 0xff]; }
function qAStore(index: number): number[] { return index <= 3 ? [0x4b + index] : [0x3a, index & 0xff]; }
function qILoad(index: number): number[] { return index <= 3 ? [0x1a + index] : [0x15, index & 0xff]; }
function qIStore(index: number): number[] { return index <= 3 ? [0x3b + index] : [0x36, index & 0xff]; }
function qLLoad(index: number): number[] { return index <= 3 ? [0x1e + index] : [0x16, index & 0xff]; }
function qPatchBranch(code: number[], pos: number, target: number): void {
  const delta = target - pos;
  if (delta < -32768 || delta > 32767) throw new Error(`Quest helper branch ${delta} vượt short.`);
  const n = delta & 0xffff;
  code[pos + 1] = (n >> 8) & 0xff;
  code[pos + 2] = n & 0xff;
}
interface QuestHelperMethodSpec { accessFlags: number; nameIndex: number; descriptorIndex: number; maxStack: number; maxLocals: number; code: number[]; }
function qEncodeMethod(codeName: number, spec: QuestHelperMethodSpec): Uint8Array {
  const codeBytes = new Uint8Array(spec.code);
  const payloadLength = 2 + 2 + 4 + codeBytes.length + 2 + 2;
  const attr = new Uint8Array(6 + payloadLength);
  const view = new DataView(attr.buffer);
  qWriteU2(view, 0, codeName); qWriteU4(view, 2, payloadLength);
  let c = 6;
  qWriteU2(view, c, spec.maxStack); c += 2;
  qWriteU2(view, c, spec.maxLocals); c += 2;
  qWriteU4(view, c, codeBytes.length); c += 4;
  attr.set(codeBytes, c); c += codeBytes.length;
  qWriteU2(view, c, 0); c += 2; // exceptions
  qWriteU2(view, c, 0); // nested attrs
  const method = new Uint8Array(8 + attr.length);
  const mv = new DataView(method.buffer);
  qWriteU2(mv, 0, spec.accessFlags); qWriteU2(mv, 2, spec.nameIndex); qWriteU2(mv, 4, spec.descriptorIndex); qWriteU2(mv, 6, 1);
  method.set(attr, 8);
  return method;
}

function qBuildRewardHelper(targetClass: ReturnType<typeof parseClassFile>, overrides: QuestRewardOverride[]): ArrayBuffer {
  const cp = new QuestHelperConstantPool();
  const thisClass = cp.clazz(QUEST_REWARD_HELPER_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const codeName = cp.utf8('Code');
  const applyName = cp.utf8('apply');
  const applyDesc = cp.utf8('(La/a/H;I)V');
  const applyRewardName = cp.utf8('applyReward');
  const applyRewardDesc = cp.utf8('(La/a/H;JJJIII)V');
  const grantName = cp.utf8('grantItem');
  const grantDesc = cp.utf8('(La/a/H;II)V');
  const syncName = cp.utf8('sync');
  const syncDesc = cp.utf8('(La/a/H;)V');

  const stringValueOf = cp.methodRef('java/lang/String', 'valueOf', '(J)Ljava/lang/String;');
  const applyRewardRef = cp.methodRef(QUEST_REWARD_HELPER_INTERNAL_NAME, 'applyReward', '(La/a/H;JJJIII)V');
  const grantRef = cp.methodRef(QUEST_REWARD_HELPER_INTERNAL_NAME, 'grantItem', '(La/a/H;II)V');
  const syncRef = cp.methodRef(QUEST_REWARD_HELPER_INTERNAL_NAME, 'sync', '(La/a/H;)V');

  const hGold = cp.fieldRef('a/a/H', 'bS', 'J');
  const hPower = cp.fieldRef('a/a/H', 'bT', 'J');
  const hPotential = cp.fieldRef('a/a/H', 'bU', 'J');
  const hGems = cp.fieldRef('a/a/H', 'xv', 'I');
  const hBag = cp.fieldRef('a/a/H', 'e', '[La/a/w;');
  const hChest = cp.fieldRef('a/a/H', 'f', '[La/a/w;');
  const cGet = cp.methodRef('a/c', 'a', '()La/c;');
  const cGold = cp.fieldRef('a/c', 'l', 'J');
  const cPower = cp.fieldRef('a/c', 'a', 'J');
  const cPotential = cp.fieldRef('a/c', 'i', 'J');
  const cGems = cp.fieldRef('a/c', 'U', 'I');
  const cGoldText = cp.fieldRef('a/c', 'e', 'Ljava/lang/String;');
  const cX = cp.fieldRef('a/c', 'p', 'I');
  const cY = cp.fieldRef('a/c', 'q', 'I');
  const itemFactory = cp.methodRef('a/a/w', 'b', '(IIII)La/a/w;');
  const findSlot = cp.methodRef('a/a/g', 'a', '([La/a/w;La/a/w;)I');
  const itemIsSpecial = cp.methodRef('a/a/w', 'av', '()Z');
  const itemQty = cp.fieldRef('a/a/w', 'xh', 'I');
  const dropItem = cp.methodRef('a/a/h', 'k', '(IIII)V');

  const pushLong = (value: number): number[] => {
    const safe = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(value) || 0)));
    if (safe === 0) return [0x09]; // lconst_0
    if (safe === 1) return [0x0a]; // lconst_1
    const index = cp.long(safe);
    return [0x14, (index >> 8) & 0xff, index & 0xff]; // ldc2_w CONSTANT_Long
  };

  const overrideById = new Map(normalizeQuestRewardOverrides(overrides).filter((r) => r.enabled).map((r) => [r.questId, r]));
  const apply: number[] = [...qALoad(0)];
  const applyNull = apply.length; apply.push(0xc6, 0, 0);
  for (let questId = 0; questId <= 30; questId++) {
    apply.push(...qILoad(1), ...qPushInt(cp, questId));
    const next = apply.length; apply.push(0xa0, 0, 0); // if_icmpne
    const original = getOriginalQuestReward(questId);
    const override = overrideById.get(questId);
    const value = override ? {
      gold: override.gold,
      power: override.power,
      potential: override.potential,
      gems: override.gems,
      itemId: override.itemId,
      itemQuantity: override.itemQuantity,
    } : original;
    apply.push(
      ...qALoad(0),
      ...pushLong(value.gold),
      ...pushLong(value.power),
      ...pushLong(value.potential),
      ...qPushInt(cp, value.gems),
      ...qPushInt(cp, value.itemId ?? -1),
      ...qPushInt(cp, value.itemId == null ? 1 : value.itemQuantity),
      0xb8, (applyRewardRef >> 8) & 0xff, applyRewardRef & 0xff,
      0xb1
    );
    qPatchBranch(apply, next, apply.length);
  }
  const applyEnd = apply.length; apply.push(0xb1); qPatchBranch(apply, applyNull, applyEnd);

  // applyReward(H, gold, power, potential, gems, itemId, itemQty)
  const applyReward: number[] = [
    ...qALoad(0), 0x59, 0xb4, (hGold >> 8) & 0xff, hGold & 0xff, ...qLLoad(1), 0x61, 0xb5, (hGold >> 8) & 0xff, hGold & 0xff,
    ...qALoad(0), 0x59, 0xb4, (hPower >> 8) & 0xff, hPower & 0xff, ...qLLoad(3), 0x61, 0xb5, (hPower >> 8) & 0xff, hPower & 0xff,
    ...qALoad(0), 0x59, 0xb4, (hPotential >> 8) & 0xff, hPotential & 0xff, ...qLLoad(5), 0x61, 0xb5, (hPotential >> 8) & 0xff, hPotential & 0xff,
    ...qALoad(0), 0x59, 0xb4, (hGems >> 8) & 0xff, hGems & 0xff, ...qILoad(7), 0x60, 0xb5, (hGems >> 8) & 0xff, hGems & 0xff,
    ...qILoad(8),
  ];
  const noItem1 = applyReward.length; applyReward.push(0x9b, 0, 0); // iflt
  applyReward.push(...qILoad(9));
  const noItem2 = applyReward.length; applyReward.push(0x9e, 0, 0); // ifle
  applyReward.push(...qALoad(0), ...qILoad(8), ...qILoad(9), 0xb8, (grantRef >> 8) & 0xff, grantRef & 0xff);
  const syncStart = applyReward.length;
  applyReward.push(...qALoad(0), 0xb8, (syncRef >> 8) & 0xff, syncRef & 0xff, 0xb1);
  qPatchBranch(applyReward, noItem1, syncStart); qPatchBranch(applyReward, noItem2, syncStart);

  // sync fields to the J2ME client singleton.
  const sync: number[] = [...qALoad(0)];
  const syncNullH = sync.length; sync.push(0xc6, 0, 0);
  sync.push(0xb8, (cGet >> 8) & 0xff, cGet & 0xff, ...qAStore(1), ...qALoad(1));
  const syncNullC = sync.length; sync.push(0xc6, 0, 0);
  sync.push(
    ...qALoad(1), ...qALoad(0), 0xb4, (hGold >> 8) & 0xff, hGold & 0xff, 0xb5, (cGold >> 8) & 0xff, cGold & 0xff,
    ...qALoad(1), ...qALoad(0), 0xb4, (hPower >> 8) & 0xff, hPower & 0xff, 0xb5, (cPower >> 8) & 0xff, cPower & 0xff,
    ...qALoad(1), ...qALoad(0), 0xb4, (hPotential >> 8) & 0xff, hPotential & 0xff, 0xb5, (cPotential >> 8) & 0xff, cPotential & 0xff,
    ...qALoad(1), ...qALoad(0), 0xb4, (hGems >> 8) & 0xff, hGems & 0xff, 0xb5, (cGems >> 8) & 0xff, cGems & 0xff,
    ...qALoad(1), ...qALoad(0), 0xb4, (hGold >> 8) & 0xff, hGold & 0xff, 0xb8, (stringValueOf >> 8) & 0xff, stringValueOf & 0xff, 0xb5, (cGoldText >> 8) & 0xff, cGoldText & 0xff
  );
  const syncEnd = sync.length; sync.push(0xb1); qPatchBranch(sync, syncNullH, syncEnd); qPatchBranch(sync, syncNullC, syncEnd);

  // grantItem mirrors a/a/X.h(H,itemId,qty) but lives in package a/a so it can call a/a/g.a.
  const grant: number[] = [
    ...qILoad(1), ...qILoad(2), 0x02, 0x03,
    0xb8, (itemFactory >> 8) & 0xff, itemFactory & 0xff,
    ...qAStore(3),
    ...qALoad(0), 0xb4, (hBag >> 8) & 0xff, hBag & 0xff, ...qALoad(3),
    0xb8, (findSlot >> 8) & 0xff, findSlot & 0xff,
    ...qIStore(4),
    ...qALoad(0), 0xb4, (hBag >> 8) & 0xff, hBag & 0xff, ...qAStore(5),
    ...qILoad(4),
  ];
  const bagFound = grant.length; grant.push(0x9c, 0, 0); // ifge -> have slot
  grant.push(
    ...qALoad(0), 0xb4, (hChest >> 8) & 0xff, hChest & 0xff, ...qALoad(3),
    0xb8, (findSlot >> 8) & 0xff, findSlot & 0xff,
    ...qIStore(4),
    ...qALoad(0), 0xb4, (hChest >> 8) & 0xff, hChest & 0xff, ...qAStore(5),
    ...qILoad(4)
  );
  const chestFound = grant.length; grant.push(0x9c, 0, 0);
  // no slot -> drop at player's position
  grant.push(
    ...qILoad(1), ...qILoad(2),
    0xb8, (cGet >> 8) & 0xff, cGet & 0xff, 0xb4, (cX >> 8) & 0xff, cX & 0xff,
    0xb8, (cGet >> 8) & 0xff, cGet & 0xff, 0xb4, (cY >> 8) & 0xff, cY & 0xff,
    0xb8, (dropItem >> 8) & 0xff, dropItem & 0xff,
    0xb1
  );
  const haveSlot = grant.length;
  qPatchBranch(grant, bagFound, haveSlot); qPatchBranch(grant, chestFound, haveSlot);
  grant.push(...qALoad(5), ...qILoad(4), 0x32);
  const assignIfNull = grant.length; grant.push(0xc6, 0, 0);
  grant.push(...qALoad(5), ...qILoad(4), 0x32, 0xb6, (itemIsSpecial >> 8) & 0xff, itemIsSpecial & 0xff);
  const assignIfSpecial = grant.length; grant.push(0x9a, 0, 0);
  grant.push(
    ...qALoad(5), ...qILoad(4), 0x32, 0x59, 0xb4, (itemQty >> 8) & 0xff, itemQty & 0xff, ...qILoad(2), 0x60, 0xb5, (itemQty >> 8) & 0xff, itemQty & 0xff,
    0xb1
  );
  const assignStart = grant.length;
  grant.push(...qALoad(5), ...qILoad(4), ...qALoad(3), 0x53, 0xb1);
  qPatchBranch(grant, assignIfNull, assignStart); qPatchBranch(grant, assignIfSpecial, assignStart);

  const methods = [
    qEncodeMethod(codeName, { accessFlags: 0x0009, nameIndex: applyName, descriptorIndex: applyDesc, maxStack: 10, maxLocals: 2, code: apply }),
    qEncodeMethod(codeName, { accessFlags: 0x000a, nameIndex: applyRewardName, descriptorIndex: applyRewardDesc, maxStack: 5, maxLocals: 10, code: applyReward }),
    qEncodeMethod(codeName, { accessFlags: 0x000a, nameIndex: grantName, descriptorIndex: grantDesc, maxStack: 5, maxLocals: 6, code: grant }),
    qEncodeMethod(codeName, { accessFlags: 0x000a, nameIndex: syncName, descriptorIndex: syncDesc, maxStack: 4, maxLocals: 2, code: sync }),
  ];
  const cpBytes = cp.serialize();
  const total = 10 + cpBytes.length + 12 + methods.reduce((n, m) => n + m.length, 0) + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  qWriteU2(view, 4, (targetClass as any).minorVersion ?? 0);
  qWriteU2(view, 6, (targetClass as any).majorVersion ?? 47);
  qWriteU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor); cursor += cpBytes.length;
  qWriteU2(view, cursor, 0x0031); cursor += 2;
  qWriteU2(view, cursor, thisClass); cursor += 2;
  qWriteU2(view, cursor, superClass); cursor += 2;
  qWriteU2(view, cursor, 0); cursor += 2;
  qWriteU2(view, cursor, 0); cursor += 2;
  qWriteU2(view, cursor, methods.length); cursor += 2;
  for (const method of methods) { out.set(method, cursor); cursor += method.length; }
  qWriteU2(view, cursor, 0);
  const buffer = qToArrayBuffer(out);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) throw new Error('Quest reward helper tự sinh không parse VALID.');
  return buffer;
}

function qPatchRewardHook(
  original: ArrayBuffer,
  overrides: QuestRewardOverride[]
): { classBytes: ArrayBuffer; helperBytes: ArrayBuffer; mode: 'INSTALLED' | 'REUSED' } {
  const parsed = parseClassFile(original);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) throw new Error('Quest reward: a/a/X.class không parse VALID.');
  const target: QuestMutableClass = { bytes: new Uint8Array(original.slice(0)), layout: qParseRawClassLayout(original) };
  let method = target.layout.methods.find((m) => m.name === 'l' && m.descriptor === '(La/a/H;I)Z');
  if (!method) throw new Error('Quest reward: không tìm thấy a/a/X.l(La/a/H;I)Z.');
  const existing = qFindInvokes(target, method, QUEST_REWARD_HELPER_INTERNAL_NAME, 'apply', '(La/a/H;I)V');
  let mode: 'INSTALLED' | 'REUSED' = 'REUSED';
  if (existing.length === 0) {
    const originalCalls = qFindInvokes(target, method, 'a/a/X', 'c', '(La/a/H;I)V');
    if (originalCalls.length !== 1) {
      throw new Error(`Quest reward: cần đúng 1 hook a/a/X.c(H,int), tìm thấy ${originalCalls.length}.`);
    }
    const helperRef = qAppendRewardMethodRef(target);
    method = target.layout.methods.find((m) => m.name === 'l' && m.descriptor === '(La/a/H;I)Z');
    if (!method) throw new Error('Quest reward: mất layout method l sau khi tăng CP.');
    const rel = qFindInvokes(target, method, 'a/a/X', 'c', '(La/a/H;I)V')[0];
    if (rel == null) throw new Error('Quest reward: mất original call sau khi tăng CP.');
    const absolute = method.codeStart + rel;
    target.bytes[absolute + 1] = (helperRef >> 8) & 0xff;
    target.bytes[absolute + 2] = helperRef & 0xff;
    mode = 'INSTALLED';
  }
  const classBytes = qToArrayBuffer(target.bytes);
  const verifyClass = parseClassFile(classBytes);
  if (verifyClass.status !== 'valid' || verifyClass.remainingBytes !== 0) throw new Error('Quest reward: a/a/X.class sau hook không parse VALID.');
  return { classBytes, helperBytes: qBuildRewardHelper(parsed, overrides), mode };
}

async function patchQuestRewardRuntime(
  zip: JSZip,
  rewards: QuestRewardOverride[]
): Promise<{ enabledCount: number; hookMode: 'NONE' | 'INSTALLED' | 'REUSED' }> {
  const active = normalizeQuestRewardOverrides(rewards).filter((reward) => reward.enabled);
  if (!active.length) return { enabledCount: 0, hookMode: 'NONE' };
  const entry = zip.file(QUEST_REWARD_TARGET_PATH);
  if (!entry) throw new Error(`Quest reward: thiếu ${QUEST_REWARD_TARGET_PATH}.`);
  const result = qPatchRewardHook(await entry.async('arraybuffer'), active);
  zip.file(QUEST_REWARD_TARGET_PATH, result.classBytes);
  zip.file(QUEST_REWARD_HELPER_PATH, result.helperBytes);
  return { enabledCount: active.length, hookMode: result.mode };
}

export async function buildQuestPatchCandidate(
  session: LoadedJarSession,
  edits: QuestCellEdit[],
  inputBlob: Blob,
  rewards: QuestRewardOverride[] = []
): Promise<QuestPatchCandidate> {
  const safeEdits = (edits ?? [])
    .filter((edit) => edit && edit.sourceField === 'u')
    .map((edit) => ({ ...edit, value: String(edit.value ?? '') }));
  if (!safeEdits.length && !normalizeQuestRewardOverrides(rewards).some((reward) => reward.enabled)) return { blob: inputBlob, metrics: { editCount: 0, rewrittenClasses: [], rewardOverrideCount: 0, rewardHookMode: 'NONE' } };

  const zip = await JSZip.loadAsync(await inputBlob.arrayBuffer());
  const rewrittenClasses: string[] = [];
  for (const sourceClass of [QUEST_MAIN_CLASS, QUEST_STEP_CLASS] as const) {
    const classEdits = safeEdits.filter((edit) => edit.sourceClass === sourceClass);
    if (await patchOneQuestClass(zip, session, sourceClass, classEdits)) rewrittenClasses.push(sourceClass);
  }

  const rewardMetrics = await patchQuestRewardRuntime(zip, rewards);
  if (rewardMetrics.enabledCount > 0) rewrittenClasses.push(QUEST_REWARD_TARGET_CLASS, QUEST_REWARD_HELPER_INTERNAL_NAME);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const verify = await JSZip.loadAsync(await blob.arrayBuffer());
  for (const edit of safeEdits) {
    const schema = edit.sourceClass === QUEST_MAIN_CLASS ? QUEST_MAIN_SCHEMA : QUEST_STEP_SCHEMA;
    const entry = verify.file(`${edit.sourceClass}.class`);
    if (!entry) throw new Error(`Quest verify: thiếu ${edit.sourceClass}.class.`);
    const parsed = parseClassFile(await entry.async('arraybuffer'));
    const clinit = parsed.methods.find((method) => method.name === '<clinit>');
    if (!clinit?.code?.instructions) throw new Error(`Quest verify: không decode được ${edit.sourceClass}.<clinit>.`);
    const table = reconstructStringArrayTable(
      edit.sourceClass,
      'u',
      '[[Ljava/lang/String;',
      0,
      clinit.code.instructions,
      parsed.constantPool,
      schema.length
    );
    const actual = table.rows[edit.rowIndex]?.values[edit.columnIndex] ?? '';
    if (actual !== edit.value) {
      throw new Error(`Quest verify sai ${edit.sourceClass}.u[${edit.rowIndex}][${edit.columnIndex}]: cần "${edit.value}", nhận "${actual}".`);
    }
  }

  return {
    blob,
    metrics: {
      editCount: safeEdits.length,
      rewrittenClasses,
      rewardOverrideCount: rewardMetrics.enabledCount,
      rewardHookMode: rewardMetrics.hookMode,
    },
  };
}

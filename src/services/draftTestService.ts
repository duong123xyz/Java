import JSZip from 'jszip';
import { LoadedJarSession, CandidateOutputJar, ClassFileInfo } from '../types/jar';
import { JvmInstruction, MethodInfo } from '../types/bytecode';
import { ItemDraft, StringTableRow } from '../types/item';
import {
  CellEvidence,
  ClassPatchGroup,
  ClassRewriteResult,
  ItemFieldPatchPlan,
} from '../types/patch';
import { CpTag } from '../types/constantPool';
import { getModifiedUtf8ByteLength } from './modifiedUtf8Service';
import {
  buildClassPatchGroups,
  buildItemDraftPatchPlans,
  getSessionClassInfo,
  isPlanEligibleForGroup,
  normalizeClassEntryPath,
} from './patchPlannerService';
import { rewriteClass } from './classFileRewriter';
import { analyzeItemTables } from './itemDataService';
import { getDirtyDrafts } from './itemDraftService';
import { analyzeGameData } from './gameDataService';
import {
  analyzeMaps,
  getDirtyMapDraftEntries,
  getMapDraftFingerprint,
  serializeMapDraftValues,
} from './mapDataService';
import {
  analyzeMobs,
  getDirtyMobDraftEntries,
  getMobDraftFingerprint,
  serializeMobDraftValues,
} from './mobDataService';
import {
  analyzeCharacterDefaults,
  getCharacterDraft,
  getCharacterDraftFingerprint,
} from './characterDataService';
import { buildCharacterPatches } from './characterPatchService';
import {
  BossDefinition,
  BossDraft,
  BossCustomDrop,
  exportBossDrafts,
  getBossDefinitions,
  getBossDraftFingerprint,
  getDirtyBossCount,
  isBossDraftDirty,
} from './bossDataService';
import {
  GenericMobDropRule,
  getGameMechanicsDraft,
  getGameMechanicsDirtyCount,
  setGameMechanicsDraft,
} from './gameMechanicsService';
import { buildMechanicsPatches } from './mechanicsPatchService';
import {
  exportMobDropDrafts,
  getMobDropDraftFingerprint,
} from './mobDropDraftService';
import {
  analyzeSkills,
  getDirtySkillDraftEntries,
  getSkillDraftFingerprint,
  serializeSkillDraftValues,
} from './skillDataService';
import { parseClassFile } from './classFileParser';
import {
  getPatchWorkspaceFingerprint,
  getPatchWorkspaceOperations,
  WorkspaceNewItemOperation,
} from './patchWorkspaceStateService';

export type DraftTestPhase =
  | 'COLLECTING'
  | 'PLANNING'
  | 'REWRITING'
  | 'PACKING'
  | 'VERIFYING'
  | 'DONE';

export interface DraftTestProgress {
  phase: DraftTestPhase;
  label: string;
  current: number;
  total: number;
}

export interface DraftTestBlocker {
  area: 'Vật phẩm' | 'NPC' | 'Map' | 'Quái' | 'Kỹ năng' | 'Boss' | 'Cơ chế' | 'Nhân vật' | 'Hệ thống';
  count: number;
  message: string;
}

export interface DraftTestSummary {
  itemDrafts: number;
  npcDrafts: number;
  mapDrafts: number;
  mobDrafts: number;
  skillDrafts: number;
  bossDrafts: number;
  mechanicDrafts: number;
  characterDrafts: number;
  supportedDrafts: number;
  unsupportedDrafts: number;
  modifiedCells: number;
  rewrittenClasses: number;
}

export interface DraftTestBuildResult {
  status: 'VALIDATED' | 'BLOCKED' | 'FAILED' | 'NO_CHANGES';
  candidate?: CandidateOutputJar;
  blockers: DraftTestBlocker[];
  summary: DraftTestSummary;
  errorMessage?: string;
}

interface GenericTableChange {
  row: StringTableRow;
  nextValues: string[];
}

interface RewriteJob {
  sourceClass: string;
  schemaColumns: string[];
  group: ClassPatchGroup;
  label: string;
}

type GameDataSession = LoadedJarSession & {
  gameNpcDrafts?: Record<
    string,
    {
      name: string;
      head: string;
      body: string;
      leg: string;
      avatar: string;
    }
  >;
};

function createSummary(): DraftTestSummary {
  return {
    itemDrafts: 0,
    npcDrafts: 0,
    mapDrafts: 0,
    mobDrafts: 0,
    skillDrafts: 0,
    bossDrafts: 0,
    mechanicDrafts: 0,
    characterDrafts: 0,
    supportedDrafts: 0,
    unsupportedDrafts: 0,
    modifiedCells: 0,
    rewrittenClasses: 0,
  };
}

function arrayBufferEquals(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}


/**
 * a/a/V.gE() contains startup invariant tests for the 1e12 player/disciple cap.
 * The mechanics writer changes the shared CONSTANT_Long 1e12, but the test
 * fixtures cap-5 (999999999995) and cap+1 (1000000000001) are separate CP
 * constants. Leaving those two fixtures unchanged makes the exported JAR
 * crash at startup with "offline state: player power cap mismatch".
 *
 * Keep this repair here (existing draft build pipeline) so every mechanics
 * candidate is internally consistent before Boss/other writers consume it.
 */
function repairPowerCapStartupInvariants(
  buffer: ArrayBuffer,
  multiplier: number
): ArrayBuffer {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) {
    return buffer;
  }

  const BASE_CAP = 1_000_000_000_000;
  const BASE_CAP_BIG = 1_000_000_000_000n;
  const LONG_MAX = 9_223_372_036_854_775_807n;
  const rawCap = BASE_CAP * multiplier;
  if (!Number.isFinite(rawCap) || rawCap < 1) {
    throw new Error(`Power cap x${multiplier} không tạo được Java long hợp lệ.`);
  }

  // Must mirror mechanicsPatchService exactly so we repair the same value it wrote.
  const nextCap = BigInt(Math.max(1, Math.trunc(rawCap)));
  if (nextCap > LONG_MAX) {
    throw new Error(
      `Power cap ${nextCap.toString()} vượt Long.MAX_VALUE (9223372036854775807).`
    );
  }
  if (nextCap === BASE_CAP_BIG) return buffer;

  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  if (bytes.byteLength < 10 || view.getUint32(0, false) !== 0xcafebabe) {
    throw new Error('a/a/V.class không có magic CAFEBABE khi sửa invariant power cap.');
  }

  const cpCount = view.getUint16(8, false);
  let cursor = 10;
  const capMinusFiveOffsets: number[] = [];
  const capPlusOneOffsets: number[] = [];
  let patchedCapSeen = 0;

  for (let index = 1; index < cpCount; index++) {
    if (cursor >= bytes.byteLength) {
      throw new Error('Constant Pool a/a/V bị cắt khi sửa invariant power cap.');
    }

    const tag = view.getUint8(cursor++);
    switch (tag) {
      case 1: { // Utf8
        const length = view.getUint16(cursor, false);
        cursor += 2 + length;
        break;
      }
      case 3: // Integer
      case 4: // Float
        cursor += 4;
        break;
      case 5: { // Long
        const payloadOffset = cursor;
        const value = view.getBigInt64(payloadOffset, false);
        if (value === 999_999_999_995n) capMinusFiveOffsets.push(payloadOffset);
        if (value === 1_000_000_000_001n) capPlusOneOffsets.push(payloadOffset);
        if (value === nextCap) patchedCapSeen++;
        cursor += 8;
        index++; // long occupies two CP slots
        break;
      }
      case 6: // Double, also occupies two CP slots
        cursor += 8;
        index++;
        break;
      case 7: // Class
      case 8: // String
      case 16: // MethodType
      case 19: // Module
      case 20: // Package
        cursor += 2;
        break;
      case 9: // Fieldref
      case 10: // Methodref
      case 11: // InterfaceMethodref
      case 12: // NameAndType
      case 17: // Dynamic
      case 18: // InvokeDynamic
        cursor += 4;
        break;
      case 15: // MethodHandle
        cursor += 3;
        break;
      default:
        throw new Error(`Constant Pool tag ${tag} chưa hỗ trợ khi sửa invariant power cap.`);
    }
  }

  if (patchedCapSeen < 1) {
    throw new Error(
      `Không thấy power cap ${nextCap.toString()} trong a/a/V sau mechanics writer.`
    );
  }
  if (capMinusFiveOffsets.length !== 1 || capPlusOneOffsets.length !== 1) {
    throw new Error(
      `Startup invariant a/a/V khác shape đã xác minh: cap-5=${capMinusFiveOffsets.length}, cap+1=${capPlusOneOffsets.length}.`
    );
  }

  // gE() uses cap-5 twice (player + disciple) through the same CP entry.
  view.setBigInt64(capMinusFiveOffsets[0], nextCap - 5n, false);

  // At Long.MAX_VALUE there is no representable cap+1. Using cap itself still
  // exercises the sanitize path without overflowing the Java long constant.
  const aboveCap = nextCap < LONG_MAX ? nextCap + 1n : nextCap;
  view.setBigInt64(capPlusOneOffsets[0], aboveCap, false);

  return bytes.buffer;
}



/**
 * Điều khiển toàn bộ penalty TNSM theo chênh lệch level trong tm$reward.
 *
 * Bytecode gốc (v1.3.8 / v1.5.5):
 *   77: iload 7
 *   79: iconst_5
 *   80: if_icmple 95
 *   ...
 *   90: lconst_1
 *   91: lstore_3
 *   92: goto 117
 *   95..116: chia reward theo |levelDiff|
 *
 * Khi tắt giới hạn level, thay đúng 6 byte @77..82 bằng:
 *   77: goto 117
 *   80..82: nop
 *
 * Stack tại @77 đang rỗng và local #7 đã được gán, còn @117 vốn đã là target
 * của nhánh goto gốc nên không tạo target/frame mới. Đây là rewrite cùng độ dài.
 *
 * Khi bật lại, writer khôi phục bytes gốc và cả cặp lconst_1/lstore_3 mà V10
 * từng neutralize, giúp toggle hoạt động kể cả khi người dùng nạp JAR đã patch.
 */
function setTnsmLevelLimit(
  buffer: ArrayBuffer,
  enabled: boolean
): ArrayBuffer {
  const bytes = new Uint8Array(buffer.slice(0));
  const layout = parseRawClassLayout(bytes.buffer);
  const method = layout.methods.find(
    (candidate) =>
      candidate.name === 'tm$reward' &&
      candidate.descriptor === '(La/a/H;La/m;I)V'
  );
  if (!method) {
    throw new Error('Không tìm thấy a/a/aa.tm$reward(La/a/H;La/m;I)V.');
  }

  const code = bytes.subarray(method.codeStart, method.codeEnd);

  // Chấp nhận cả shape gốc và shape V10/V11 để toggle có thể đảo trạng thái.
  const originalGate = [0x15, 0x07, 0x08, 0xa4, 0x00, 0x0f]; // iload 7; iconst_5; if_icmple +15
  const bypassGate = [0xa7, 0x00, 0x28, 0x00, 0x00, 0x00]; // goto 117; nop; nop; nop
  const currentGate = Array.from(code.slice(77, 83));
  const gateMatches = (expected: number[]) =>
    expected.every((value, index) => currentGate[index] === value);

  if (!gateMatches(originalGate) && !gateMatches(bypassGate)) {
    throw new Error(
      `tm$reward level-gate @77..82 khác JAR đã xác minh: ${currentGate
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(' ')}.`
    );
  }

  // @92 phải vẫn là goto -> 117.
  if (code[92] !== 0xa7) {
    throw new Error(`tm$reward @92 expected goto, nhận 0x${code[92]?.toString(16)}.`);
  }
  const raw = (code[93] << 8) | code[94];
  const signed = raw >= 0x8000 ? raw - 0x10000 : raw;
  if (92 + signed !== 117) {
    throw new Error(`tm$reward goto @92 không trỏ 117 (đang trỏ ${92 + signed}).`);
  }

  // V10 có thể đã đổi @90/@91 thành NOP. Toggle ON phải khôi phục game gốc.
  const oldClampIsOriginal = code[90] === 0x0a && code[91] === 0x42;
  const oldClampIsV10 = code[90] === 0x00 && code[91] === 0x00;
  if (!oldClampIsOriginal && !oldClampIsV10) {
    throw new Error(
      `tm$reward clamp @90/@91 khác shape đã xác minh: 0x${code[90]?.toString(
        16
      )} 0x${code[91]?.toString(16)}.`
    );
  }

  // Luôn normalize cặp clamp về bytes gốc; khi limit OFF nhánh này không còn reachable.
  code[90] = 0x0a; // lconst_1
  code[91] = 0x42; // lstore_3

  code.set(enabled ? originalGate : bypassGate, 77);

  return bytes.buffer;
}

/**
 * If the starter-character writer raises player power while the mechanics cap
 * stays at the original 1e12, the first reward tick calls a/a/V.a(H, gain, gain)
 * and clamps H.bT straight back to the cap. That looks like "power resets after
 * the first/second hit" in-game.
 *
 * The character editor itself accepts values up to Number.MAX_SAFE_INTEGER, so
 * when a character power draft is changed we lift the shared runtime cap to the
 * same safe ceiling. This keeps a/a/V.a(), a/a/V.L() and disciple sanitation on
 * one consistent cap without touching method code or stack maps.
 */
function retargetPowerCapClass(
  buffer: ArrayBuffer,
  currentCap: bigint,
  nextCap: bigint
): ArrayBuffer {
  const LONG_MAX = 9_223_372_036_854_775_807n;
  if (nextCap <= currentCap) return buffer;
  if (nextCap > LONG_MAX) {
    throw new Error(`Power cap ${nextCap.toString()} vượt Long.MAX_VALUE.`);
  }

  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  if (bytes.byteLength < 10 || view.getUint32(0, false) !== 0xcafebabe) {
    throw new Error('a/a/V.class không có magic CAFEBABE khi auto-unlimit power.');
  }

  const cpCount = view.getUint16(8, false);
  let cursor = 10;
  const capOffsets: number[] = [];
  const minusFiveOffsets: number[] = [];
  const plusOneOffsets: number[] = [];

  for (let index = 1; index < cpCount; index++) {
    if (cursor >= bytes.byteLength) {
      throw new Error('Constant Pool a/a/V bị cắt khi auto-unlimit power.');
    }
    const tag = view.getUint8(cursor++);
    switch (tag) {
      case 1: {
        const length = view.getUint16(cursor, false);
        cursor += 2 + length;
        break;
      }
      case 3:
      case 4:
        cursor += 4;
        break;
      case 5: {
        const payloadOffset = cursor;
        const value = view.getBigInt64(payloadOffset, false);
        if (value === currentCap) capOffsets.push(payloadOffset);
        if (value === currentCap - 5n) minusFiveOffsets.push(payloadOffset);
        if (value === currentCap + 1n) plusOneOffsets.push(payloadOffset);
        cursor += 8;
        index++;
        break;
      }
      case 6:
        cursor += 8;
        index++;
        break;
      case 7:
      case 8:
      case 16:
      case 19:
      case 20:
        cursor += 2;
        break;
      case 9:
      case 10:
      case 11:
      case 12:
      case 17:
      case 18:
        cursor += 4;
        break;
      case 15:
        cursor += 3;
        break;
      default:
        throw new Error(`Constant Pool tag ${tag} chưa hỗ trợ khi auto-unlimit power.`);
    }
  }

  // The verified JAR has one shared CONSTANT_Long cap, one cap-5 fixture and
  // one cap+1 fixture. Do not guess if a different JAR shape is loaded.
  if (capOffsets.length !== 1 || minusFiveOffsets.length !== 1 || plusOneOffsets.length !== 1) {
    throw new Error(
      `a/a/V khác shape đã xác minh khi auto-unlimit: cap=${capOffsets.length}, cap-5=${minusFiveOffsets.length}, cap+1=${plusOneOffsets.length}.`
    );
  }

  view.setBigInt64(capOffsets[0], nextCap, false);
  view.setBigInt64(minusFiveOffsets[0], nextCap - 5n, false);
  view.setBigInt64(plusOneOffsets[0], nextCap + 1n, false);
  return bytes.buffer;
}

function powerCapFromMultiplier(multiplier: number): bigint {
  const raw = 1_000_000_000_000 * multiplier;
  if (!Number.isFinite(raw) || raw < 1) {
    throw new Error(`Power cap x${multiplier} không tạo được Java long hợp lệ.`);
  }
  return BigInt(Math.max(1, Math.trunc(raw)));
}

function deriveDraftTestFileName(name: string): string {
  const safe = name || 'game.jar';
  return safe.toLowerCase().endsWith('.jar')
    ? `${safe.slice(0, -4)}_draft_test.jar`
    : `${safe}_draft_test.jar`;
}

function countTableConstantUsage(
  rows: StringTableRow[],
  cpStringIndex: number
): number {
  let count = 0;
  for (const row of rows) {
    if (!row.cellEvidences) continue;
    for (const evidence of Object.values(row.cellEvidences)) {
      if (evidence?.stringConstantIndex === cpStringIndex) count++;
    }
  }
  return count;
}

function analyzeGenericSharing(
  classInfo: ClassFileInfo,
  rows: StringTableRow[],
  cpStringIndex: number,
  utf8Index: number
): {
  isShared: boolean;
  instructionRefCount: number;
  tableCellUsageCount: number;
  utf8TotalCpRefCount: number;
  explanation: string;
} {
  let instructionRefCount = 0;
  for (const method of classInfo.methods) {
    for (const instruction of method.code?.instructions ?? []) {
      if (
        (instruction.opcode === 0x12 || instruction.opcode === 0x13) &&
        instruction.cpIndex === cpStringIndex
      ) {
        instructionRefCount++;
      }
    }
  }

  const tableCellUsageCount = countTableConstantUsage(rows, cpStringIndex);

  let utf8TotalCpRefCount = 0;
  for (let i = 1; i < classInfo.constantPool.length; i++) {
    const entry: any = classInfo.constantPool[i];
    if (!entry) continue;

    if (entry.tag === CpTag.String && entry.stringIndex === utf8Index) {
      utf8TotalCpRefCount++;
    } else if (entry.tag === CpTag.Class && entry.nameIndex === utf8Index) {
      utf8TotalCpRefCount++;
    } else if (
      entry.tag === CpTag.NameAndType &&
      (entry.nameIndex === utf8Index || entry.descriptorIndex === utf8Index)
    ) {
      utf8TotalCpRefCount++;
    }
  }

  for (const field of classInfo.fields) {
    if (field.nameIndex === utf8Index || field.descriptorIndex === utf8Index) {
      utf8TotalCpRefCount++;
    }
  }
  for (const method of classInfo.methods) {
    if (method.nameIndex === utf8Index || method.descriptorIndex === utf8Index) {
      utf8TotalCpRefCount++;
    }
  }

  const isShared =
    instructionRefCount > 1 ||
    tableCellUsageCount > 1 ||
    utf8TotalCpRefCount > 1;

  return {
    isShared,
    instructionRefCount,
    tableCellUsageCount,
    utf8TotalCpRefCount,
    explanation: isShared
      ? `Constant dùng chung: ${instructionRefCount} instruction, ${tableCellUsageCount} cell, ${utf8TotalCpRefCount} CP reference.`
      : 'Constant chỉ được target cell sử dụng; có thể rewrite an toàn.',
  };
}

async function buildGenericTablePlans(
  session: LoadedJarSession,
  sourceClass: string,
  sourceField: string,
  schemaColumns: string[],
  rows: StringTableRow[],
  changes: GenericTableChange[],
  blockerArea: DraftTestBlocker['area']
): Promise<{ plans: ItemFieldPatchPlan[]; blockers: DraftTestBlocker[] }> {
  const blockers: DraftTestBlocker[] = [];
  const plans: ItemFieldPatchPlan[] = [];
  const classInfo = await getSessionClassInfo(session, sourceClass);

  if (!classInfo) {
    return {
      plans,
      blockers: [
        {
          area: blockerArea,
          count: changes.length,
          message: `Không tìm thấy ${sourceClass}.class để dựng JAR test.`,
        },
      ],
    };
  }

  for (const change of changes) {
    const originalValues = change.row.values;
    const maxColumns = Math.max(originalValues.length, change.nextValues.length);

    for (let columnIndex = 0; columnIndex < maxColumns; columnIndex++) {
      const originalValue = originalValues[columnIndex] ?? '';
      const draftValue = change.nextValues[columnIndex] ?? '';
      if (originalValue === draftValue) continue;

      const evidence: CellEvidence | undefined =
        change.row.cellEvidences?.[columnIndex];

      if (
        !evidence ||
        evidence.isUnsupportedProducer ||
        (evidence.producerOpcode !== 0x12 && evidence.producerOpcode !== 0x13) ||
        evidence.producerInstructionOffset < 0
      ) {
        blockers.push({
          area: blockerArea,
          count: 1,
          message: `${sourceClass}.u[row ${change.row.rowIndex}] col ${columnIndex} thiếu bytecode evidence dạng ldc/ldc_w.`,
        });
        continue;
      }

      const cpStringIndex =
        evidence.stringConstantIndex ?? evidence.constantPoolIndex;
      const utf8Index = evidence.utf8Index;

      if (
        cpStringIndex === undefined ||
        cpStringIndex <= 0 ||
        utf8Index === undefined ||
        utf8Index <= 0
      ) {
        blockers.push({
          area: blockerArea,
          count: 1,
          message: `${sourceClass}.u[row ${change.row.rowIndex}] col ${columnIndex} không resolve được Constant Pool chain.`,
        });
        continue;
      }

      if (evidence.originalValue !== undefined && evidence.originalValue !== originalValue) {
        blockers.push({
          area: blockerArea,
          count: 1,
          message: `${sourceClass}.u[row ${change.row.rowIndex}] col ${columnIndex} có evidence cũ, cần tải lại JAR.`,
        });
        continue;
      }

      const sharing = analyzeGenericSharing(
        classInfo,
        rows,
        cpStringIndex,
        utf8Index
      );
      const originalMutf8Length = getModifiedUtf8ByteLength(originalValue);
      const draftMutf8Length = getModifiedUtf8ByteLength(draftValue);
      const mutf8Delta = draftMutf8Length - originalMutf8Length;
      const requiresConstantClone = sharing.isShared;
      const requiresClassRebuild = mutf8Delta !== 0 || requiresConstantClone;
      const currentOpcodeIsLdc = evidence.producerOpcode === 0x12;
      const currentCpCount = classInfo.constantPool.length;
      const mayRequireLdcW =
        currentOpcodeIsLdc &&
        requiresConstantClone &&
        currentCpCount >= 254;

      plans.push({
        id: `${sourceClass}|${sourceField}|${change.row.rowIndex}|${columnIndex}`,
        draftKey: `${sourceClass}|${sourceField}|${change.row.rowIndex}`,
        sourceClass,
        sourceField,
        sourceRow: change.row.rowIndex,
        fieldName: schemaColumns[columnIndex] ?? `col_${columnIndex}`,
        columnIndex,
        originalValue,
        draftValue,
        hasEvidence: true,
        producerOffset: evidence.producerInstructionOffset,
        producerOpcode: evidence.producerOpcode,
        producerMnemonic: evidence.producerMnemonic,
        aastoreOffset: evidence.aastoreInstructionOffset,
        cpStringIndex,
        utf8Index,
        utf8RawString: evidence.utf8RawString ?? originalValue,
        isShared: sharing.isShared,
        stringConstantInstructionRefCount: sharing.instructionRefCount,
        tableCellUsageCount: sharing.tableCellUsageCount,
        utf8TotalCpRefCount: sharing.utf8TotalCpRefCount,
        sharingExplanation: sharing.explanation,
        originalMutf8Length,
        draftMutf8Length,
        mutf8Delta,
        requiresConstantClone,
        requiresClassRebuild,
        currentOpcodeIsLdc,
        mayRequireLdcW,
        currentCpCount,
        strategy: sharing.isShared ? 'CLONE_AND_RETARGET' : 'UNIQUE_REPLACE',
        riskLevel: requiresClassRebuild ? 'NEEDS_REBUILD' : 'SAFE_TO_PLAN',
        status: requiresClassRebuild ? 'NEEDS_REBUILD' : 'READY',
        statusMessage: requiresClassRebuild
          ? 'Cần rebuild class nhưng writer hiện tại hỗ trợ.'
          : 'Có thể rewrite trực tiếp.',
        diagnostics: [],
      });
    }
  }

  return { plans, blockers };
}

function makeGroup(sourceClass: string, plans: ItemFieldPatchPlan[]): ClassPatchGroup {
  const canonical = normalizeClassEntryPath(sourceClass);
  const itemKeys = new Set(plans.map((plan) => plan.draftKey));
  return {
    sourceClass: canonical,
    classEntryPath: canonical,
    plans,
    modifiedCellCount: plans.length,
    totalModifiedCells: plans.length,
    modifiedItemCount: itemKeys.size,
    requiresRebuild: plans.some((plan) => plan.requiresClassRebuild),
    hasUnsupportedPlans: plans.some(
      (plan) => plan.status === 'UNSUPPORTED' || plan.strategy === 'UNSUPPORTED'
    ),
    sharedConstantsCount: plans.filter((plan) => plan.isShared).length,
    uniqueConstantsCount: plans.filter((plan) => !plan.isShared).length,
  };
}

function mergeJobs(
  jobs: RewriteJob[]
): { jobs: RewriteJob[]; blockers: DraftTestBlocker[] } {
  const byClass = new Map<string, RewriteJob>();
  const blockers: DraftTestBlocker[] = [];

  for (const job of jobs) {
    const key = normalizeClassEntryPath(job.sourceClass);
    const existing = byClass.get(key);

    if (!existing) {
      byClass.set(key, {
        ...job,
        sourceClass: key,
        group: makeGroup(key, [...job.group.plans]),
      });
      continue;
    }

    if (existing.schemaColumns.join('\u0000') !== job.schemaColumns.join('\u0000')) {
      blockers.push({
        area: 'Hệ thống',
        count: 1,
        message: `Hai loại draft cùng sửa ${key} nhưng dùng schema khác nhau; chưa thể merge an toàn.`,
      });
      continue;
    }

    const cellKeys = new Set(
      existing.group.plans.map(
        (plan) => `${plan.sourceField}|${plan.sourceRow}|${plan.columnIndex}`
      )
    );

    for (const plan of job.group.plans) {
      const cellKey = `${plan.sourceField}|${plan.sourceRow}|${plan.columnIndex}`;
      if (!cellKeys.has(cellKey)) {
        existing.group.plans.push(plan);
        cellKeys.add(cellKey);
      }
    }

    existing.group = makeGroup(key, existing.group.plans);
    existing.label = `${existing.label} + ${job.label}`;
  }

  return { jobs: Array.from(byClass.values()), blockers };
}

function createRewriteSession(
  session: LoadedJarSession,
  schemaColumns: string[]
): LoadedJarSession {
  const baseItemAnalysis: any = session.itemAnalysis ?? {
    diagnostics: {},
    sourceTables: [],
    items: [],
    sourceFilters: [],
  };

  return {
    ...session,
    itemAnalysis: {
      ...baseItemAnalysis,
      diagnostics: {
        ...(baseItemAnalysis.diagnostics ?? {}),
        schemaColumns,
        schemaColumnCount: schemaColumns.length,
      },
    },
  } as LoadedJarSession;
}

async function rewriteJob(
  session: LoadedJarSession,
  job: RewriteJob
): Promise<ClassRewriteResult> {
  const classPath = normalizeClassEntryPath(job.sourceClass);
  const entry = session.zip.file(classPath);
  if (!entry) {
    throw new Error(`Không tìm thấy ${classPath} trong JAR.`);
  }

  const [originalBytes, classInfo] = await Promise.all([
    entry.async('arraybuffer'),
    getSessionClassInfo(session, classPath),
  ]);

  if (!classInfo) {
    throw new Error(`Không parse được ${classPath}.`);
  }

  return rewriteClass(
    originalBytes,
    classInfo,
    job.group,
    createRewriteSession(session, job.schemaColumns)
  );
}

async function collectUnsupportedDrafts(
  _session: LoadedJarSession,
  _summary: DraftTestSummary
): Promise<DraftTestBlocker[]> {
  // Boss được writer nội bộ trong chính file này phân loại supported/unsupported.
  return [];
}

function stableItemDraftFingerprint(session: LoadedJarSession): string {
  const drafts = getDirtyDrafts(session.itemDrafts)
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((draft) => ({
      key: draft.key,
      dirtyFields: [...draft.dirtyFields],
      values: draft.values,
      optionOverrides: (draft.optionOverrides ?? [])
        .map((option) => ({
          optionId: option.optionId,
          param: option.param,
          enabled: option.enabled !== false,
          note: option.note || '',
        }))
        .sort((a, b) => a.optionId - b.optionId),
    }));
  return JSON.stringify(drafts);
}

function stableNpcDraftFingerprint(session: LoadedJarSession): string {
  const drafts = (session as GameDataSession).gameNpcDrafts ?? {};
  return JSON.stringify(
    Object.entries(drafts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, draft]) => [id, draft])
  );
}

export function getDraftStateFingerprint(session: LoadedJarSession): string {
  return JSON.stringify({
    items: stableItemDraftFingerprint(session),
    npc: stableNpcDraftFingerprint(session),
    map: getMapDraftFingerprint(session),
    mobs: getMobDraftFingerprint(session),
    mobDrops: getMobDropDraftFingerprint(session),
    skills: getSkillDraftFingerprint(session),
    boss: getBossDraftFingerprint(session),
    character: getCharacterDraftFingerprint(session),
    mechanics: getGameMechanicsDraft(session),
    workspace: getPatchWorkspaceFingerprint(session),
  });
}

export function isDraftTestCandidateFresh(session: LoadedJarSession): boolean {
  const candidate = session.candidateOutput;
  if (
    !candidate ||
    candidate.status !== 'VALIDATED' ||
    !['DRAFT_TEST', 'UNIFIED_WORKSPACE'].includes(candidate.metrics?.source)
  ) {
    return false;
  }

  return candidate.metrics?.draftFingerprint === getDraftStateFingerprint(session);
}

export async function buildDraftTestCandidate(
  session: LoadedJarSession,
  onProgress?: (progress: DraftTestProgress) => void
): Promise<DraftTestBuildResult> {
  const summary = createSummary();
  const blockers: DraftTestBlocker[] = [];
  const jobs: RewriteJob[] = [];

  const progress = (
    phase: DraftTestPhase,
    label: string,
    current: number,
    total: number
  ) => onProgress?.({ phase, label, current, total });

  try {
    progress('COLLECTING', 'Đang gom toàn bộ nháp...', 1, 5);

    // 1) Vật phẩm — writer hiện tại đã hỗ trợ.
    const itemDrafts = getDirtyDrafts(session.itemDrafts);
    const workspaceNewItems = getPatchWorkspaceOperations(session).filter(
      (operation): operation is WorkspaceNewItemOperation => operation.kind === 'NEW_ITEM'
    );
    const workspaceItemsWithOptions = workspaceNewItems.filter((operation) =>
      (operation.optionOverrides ?? []).some((option) => option.enabled !== false)
    );
    // Một item mới có ItemOption cũng là thay đổi runtime thật. Tính nó vào summary
    // để buildDraftTestCandidate không trả NO_CHANGES trước khi helper được ghi vào JAR.
    summary.itemDrafts = itemDrafts.length + workspaceItemsWithOptions.length;
    const itemOptionRuntimeRules = collectItemOptionRuntimeRules(itemDrafts, workspaceNewItems);

    if (itemDrafts.length > 0) {
      const itemAnalysis =
        session.itemAnalysis ?? (await analyzeItemTables(session));
      session.itemAnalysis = itemAnalysis;

      const itemPlans: ItemFieldPatchPlan[] = [];
      for (const draft of itemDrafts) {
        const item = itemAnalysis.items.find(
          (candidate) =>
            candidate.sourceClass === draft.sourceClass &&
            candidate.sourceField === draft.sourceField &&
            candidate.sourceRow === draft.sourceRow
        );

        if (!item) {
          blockers.push({
            area: 'Vật phẩm',
            count: 1,
            message: `Không tìm lại được Item row ${draft.sourceClass}.u[${draft.sourceRow}].`,
          });
          continue;
        }

        const plans = await buildItemDraftPatchPlans(session, item, draft);
        const eligible = plans.filter(isPlanEligibleForGroup);

        if (eligible.length !== draft.dirtyFields.length) {
          blockers.push({
            area: 'Vật phẩm',
            count: 1,
            message: `${item.name || item.id}: có field nháp chưa đủ evidence để rewrite.`,
          });
        }

        itemPlans.push(...eligible);
      }

      for (const group of buildClassPatchGroups(itemPlans)) {
        jobs.push({
          sourceClass: group.sourceClass,
          schemaColumns: itemAnalysis.diagnostics.schemaColumns,
          group,
          label: 'Vật phẩm',
        });
      }
    }

    // Runtime ItemOption writer has TWO distinct targets in this integrated JAR:
    // 1) a/ab.b (a/H[]) is the J2ME/client representation used to DISPLAY options.
    // 2) a/a/H.b (a/a/w[]) is the gameplay/stat representation consumed by
    //    a/a/l for HP/KI/damage/armor/crit. V21-V26 only patched (1), which is
    //    why '+200% sức đánh' could be visible but did not change combat stats.
    // Keep the client tick hook for UI, and additionally hook a/a/w.fU() so the
    // gameplay item gets the same option BEFORE every stat calculation.
    const itemOptionRuntimeClasses = new Map<string, ArrayBuffer>();
    let itemOptionRuntimePatchCount = 0;
    if (itemOptionRuntimeRules.length > 0) {
      try {
        const loopEntry = session.zip.file('a/bN.class');
        if (!loopEntry) throw new Error('Không tìm thấy a/bN.class để gắn ItemOption client writer.');
        const loopBytes = await loopEntry.async('arraybuffer');
        const patched = patchItemOptionTickHook(loopBytes, itemOptionRuntimeRules);

        const statEntry = session.zip.file('a/a/w.class');
        if (!statEntry) throw new Error('Không tìm thấy a/a/w.class để gắn ItemOption gameplay writer.');
        const statBytes = await statEntry.async('arraybuffer');
        const statPatched = patchItemOptionServerStatHook(statBytes);

        itemOptionRuntimeClasses.set('a/bN.class', patched.classBytes);
        itemOptionRuntimeClasses.set('a/a/w.class', statPatched);
        itemOptionRuntimeClasses.set(ITEM_OPTION_HELPER_PATH, patched.helperBytes);
        itemOptionRuntimeClasses.set(ITEM_OPTION_BRIDGE_PATH, patched.bridgeBytes);
        itemOptionRuntimePatchCount = 4 + patched.ruleCount;
      } catch (error: unknown) {
        blockers.push({
          area: 'Vật phẩm',
          count: Math.max(1, itemOptionRuntimeRules.length),
          message: `ItemOption runtime writer: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    // 2) NPC — static String[][] a/a/a/B.
    const sessionWithNpcDrafts = session as GameDataSession;
    const npcDrafts = sessionWithNpcDrafts.gameNpcDrafts ?? {};
    summary.npcDrafts = Object.keys(npcDrafts).length;

    if (summary.npcDrafts > 0) {
      const gameData = await analyzeGameData(session);
      const changes: GenericTableChange[] = [];

      for (const [npcId, draft] of Object.entries(npcDrafts)) {
        const npc = gameData.npcs.find((candidate) => candidate.id === npcId);
        if (!npc) {
          blockers.push({
            area: 'NPC',
            count: 1,
            message: `Không tìm thấy NPC #${npcId} trong bảng a/a/a/B.u.`,
          });
          continue;
        }

        const row = gameData.npcTable.rows.find(
          (candidate) => candidate.rowIndex === npc.rowIndex
        );
        if (!row) {
          blockers.push({
            area: 'NPC',
            count: 1,
            message: `Không tìm thấy source row của NPC #${npcId}.`,
          });
          continue;
        }

        const nextValues = [
          npc.id,
          draft.name,
          draft.head,
          draft.body,
          draft.leg,
          draft.avatar,
        ];

        if (
          nextValues.some(
            (value, index) => value !== (row.values[index] ?? '')
          )
        ) {
          changes.push({ row, nextValues });
        }
      }

      const built = await buildGenericTablePlans(
        session,
        gameData.npcTable.sourceClass,
        gameData.npcTable.sourceField,
        gameData.npcTable.schema,
        gameData.npcTable.rows,
        changes,
        'NPC'
      );
      blockers.push(...built.blockers);

      if (built.plans.length > 0) {
        jobs.push({
          sourceClass: gameData.npcTable.sourceClass,
          schemaColumns: gameData.npcTable.schema,
          group: makeGroup(gameData.npcTable.sourceClass, built.plans),
          label: 'NPC',
        });
      }
    }

    // 3) Map — static String[][] a/a/a/z.
    const mapSnapshot = await analyzeMaps(session);
    const dirtyMaps = getDirtyMapDraftEntries(session, mapSnapshot.maps);
    summary.mapDrafts = dirtyMaps.length;

    if (dirtyMaps.length > 0) {
      const rows: StringTableRow[] = dirtyMaps.map(({ map }) => ({
        rowIndex: map.rowIndex,
        values: [...map.sourceValues],
        cellEvidences: map.cellEvidences,
        evidence: {
          instructionOffsets: [],
          summary: `a/a/a/z.u[row ${map.rowIndex}]`,
        },
      }));

      // Sharing phải được đếm trên toàn bảng, không chỉ dirty rows.
      const allRows: StringTableRow[] = mapSnapshot.maps.map((map) => ({
        rowIndex: map.rowIndex,
        values: [...map.sourceValues],
        cellEvidences: map.cellEvidences,
        evidence: {
          instructionOffsets: [],
          summary: `a/a/a/z.u[row ${map.rowIndex}]`,
        },
      }));

      const changes: GenericTableChange[] = dirtyMaps.map(({ map, draft }) => ({
        row: rows.find((row) => row.rowIndex === map.rowIndex)!,
        nextValues: serializeMapDraftValues(map, draft),
      }));

      const built = await buildGenericTablePlans(
        session,
        'a/a/a/z',
        'u',
        mapSnapshot.schema,
        allRows,
        changes,
        'Map'
      );
      blockers.push(...built.blockers);

      if (built.plans.length > 0) {
        jobs.push({
          sourceClass: 'a/a/a/z',
          schemaColumns: mapSnapshot.schema,
          group: makeGroup('a/a/a/z', built.plans),
          label: 'Map',
        });
      }
    }


    // 4) Quái — static String[][] a/a/a/A.
    // Schema: id, TYPE, NAME, hp, range_move, speed, dart_Type, percent_dame, percent_tiem_nang.
    // ID / TYPE vẫn giữ nguyên trong serializeMobDraftValues; panel chỉ sửa template stats/name.
    const mobSnapshot = await analyzeMobs(session);
    const dirtyMobs = getDirtyMobDraftEntries(session, mobSnapshot.mobs);
    summary.mobDrafts = dirtyMobs.length;

    if (dirtyMobs.length > 0) {
      // Dùng toàn bộ rows của bảng để tính sharing Constant Pool chính xác.
      const allRows: StringTableRow[] = mobSnapshot.rows.map((row) => ({
        rowIndex: row.rowIndex,
        values: [...row.values],
        cellEvidences: row.cellEvidences,
        evidence: {
          instructionOffsets: row.evidence?.instructionOffsets ?? [],
          summary:
            row.evidence?.summary ??
            `${mobSnapshot.sourceClass}.${mobSnapshot.sourceField}[row ${row.rowIndex}]`,
        },
      }));

      const rowByIndex = new Map(
        allRows.map((row) => [row.rowIndex, row])
      );

      const changes: GenericTableChange[] = [];
      for (const { mob, draft } of dirtyMobs) {
        const row = rowByIndex.get(mob.rowIndex);
        if (!row) {
          blockers.push({
            area: 'Quái',
            count: 1,
            message: `Không tìm thấy source row của Mob #${mob.id} tại ${mobSnapshot.sourceClass}.${mobSnapshot.sourceField}[${mob.rowIndex}].`,
          });
          continue;
        }

        changes.push({
          row,
          nextValues: serializeMobDraftValues(mob, draft),
        });
      }

      const built = await buildGenericTablePlans(
        session,
        mobSnapshot.sourceClass,
        mobSnapshot.sourceField,
        mobSnapshot.schema,
        allRows,
        changes,
        'Quái'
      );
      blockers.push(...built.blockers);

      if (built.plans.length > 0) {
        jobs.push({
          sourceClass: mobSnapshot.sourceClass,
          schemaColumns: mobSnapshot.schema,
          group: makeGroup(mobSnapshot.sourceClass, built.plans),
          label: 'Quái',
        });
      }
    }


    // 5) Kỹ năng — static String[][] a/a/a/W. Cột skills chứa array JSON đã escape.
    const skillSnapshot = await analyzeSkills(session);
    const dirtySkills = getDirtySkillDraftEntries(session, skillSnapshot.skills);
    summary.skillDrafts = dirtySkills.length;

    if (dirtySkills.length > 0) {
      const allRows: StringTableRow[] = skillSnapshot.skills.map((skill) => ({
        rowIndex: skill.rowIndex,
        values: [...skill.sourceValues],
        cellEvidences: skill.cellEvidences,
        evidence: {
          instructionOffsets: [],
          summary: `a/a/a/W.u[row ${skill.rowIndex}]`,
        },
      }));

      const rowByIndex = new Map(allRows.map((row) => [row.rowIndex, row]));
      const changes: GenericTableChange[] = dirtySkills.map(({ skill, draft }) => ({
        row: rowByIndex.get(skill.rowIndex)!,
        nextValues: serializeSkillDraftValues(skill, draft),
      }));

      const built = await buildGenericTablePlans(
        session,
        skillSnapshot.sourceClass,
        skillSnapshot.sourceField,
        skillSnapshot.schema,
        allRows,
        changes,
        'Kỹ năng'
      );
      blockers.push(...built.blockers);

      if (built.plans.length > 0) {
        jobs.push({
          sourceClass: skillSnapshot.sourceClass,
          schemaColumns: skillSnapshot.schema,
          group: makeGroup(skillSnapshot.sourceClass, built.plans),
          label: 'Kỹ năng',
        });
      }
    }


    progress('PLANNING', 'Đang dựng writer Cơ chế và kiểm tra nháp...', 2, 5);

    const mechanicDraft = getGameMechanicsDraft(session);

    // MobPanel stores per-mob drop rules in mobDropDraftService, while the runtime
    // helper historically read only mechanicDraft.customMobDrops. That disconnect
    // made the UI show a saved 100% rule but the exported JAR contained no such
    // drop at all. Merge both sources here, at the actual build boundary.
    const panelMobDropRules: GenericMobDropInputRule[] = exportMobDropDrafts(session)
      .flatMap(([mobId, rules]) =>
        rules.map((rule) => ({
          id: `mob-panel:${mobId}:${rule.ruleId}`,
          enabled: rule.enabled !== false,
          itemId: rule.itemId,
          quantity: rule.quantityMin,
          quantityMin: rule.quantityMin,
          quantityMax: rule.quantityMax,
          chancePercent: rule.chancePercent,
          // a/m.cG is the mob template id used by MobPanel (x1/mob/{id}/...).
          mobType: mobId,
          mapId: null,
        }))
      );

    const runtimeCustomMobDrops: GenericMobDropInputRule[] = [
      ...(mechanicDraft.customMobDrops ?? []).map((rule) => ({
        ...rule,
        quantityMin: rule.quantity,
        quantityMax: rule.quantity,
      })),
      ...panelMobDropRules,
    ];

    if (runtimeCustomMobDrops.length > 100) {
      blockers.push({
        area: 'Cơ chế',
        count: runtimeCustomMobDrops.length,
        message: `Generic Mob Drop có ${runtimeCustomMobDrops.length} rule, vượt giới hạn an toàn 100 rule/JAR.`,
      });
    }

    summary.mechanicDrafts =
      getGameMechanicsDirtyCount(mechanicDraft) + panelMobDropRules.length;

    // IMPORTANT: mechanicsPatchService's legacy "global gold" writer multiplies
    // the generic a/a/h drop wrapper, so it also scales non-gold items (eggs,
    // custom drops, gems...) because they all eventually pass through the same
    // method. Neutralize that one field while the legacy writers run, then apply
    // our guarded gold-only runtime writer below. This keeps quantity=1 as exactly
    // one item for every non-gold drop regardless of the configured gold multiplier.
    let mechanicsResult: Awaited<ReturnType<typeof buildMechanicsPatches>>;
    if (mechanicDraft.desiredGlobalGoldMultiplier !== 1) {
      setGameMechanicsDraft(session, {
        ...mechanicDraft,
        desiredGlobalGoldMultiplier: 1,
      });
      try {
        mechanicsResult = await buildMechanicsPatches(session);
      } finally {
        setGameMechanicsDraft(session, mechanicDraft);
      }
    } else {
      mechanicsResult = await buildMechanicsPatches(session);
    }

    // Flexible normal-gem quantity writer.
    // mechanicsPatchService can only replace the original 1-byte iconst_2 in-place,
    // so values >5 used to be blocked. Instead of resizing a/a/aa (which would move
    // branches/CLDC StackMap frames), retarget only the gem invokestatic @430 to a
    // tiny branchless helper. The helper ignores the original qty=2 and forwards the
    // exact editor quantity to a/a/h.a(m,item,qty). Real limit = Java int32.
    if (
      mechanicsResult.status !== 'FAILED' &&
      (mechanicDraft.dropQuantity.gem ?? 2) > 5
    ) {
      try {
        const quantity = Math.round(mechanicDraft.dropQuantity.gem ?? 2);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > JAVA_INT_MAX) {
          throw new Error(`Số lượng Ngọc ${quantity} vượt Java int 1..${JAVA_INT_MAX}.`);
        }

        const wantedPath = normalizeClassEntryPath('a/a/aa');
        let currentBytes: ArrayBuffer | null = null;
        let currentKey = 'a/a/aa.class';
        for (const [path, bytes] of mechanicsResult.rewrittenClasses) {
          if (normalizeClassEntryPath(path) === wantedPath) {
            currentBytes = bytes;
            currentKey = path;
            break;
          }
        }
        if (!currentBytes) {
          const entry = session.zip.file('a/a/aa.class');
          if (!entry) throw new Error('Không tìm thấy a/a/aa.class để viết quantity Ngọc.');
          currentBytes = await entry.async('arraybuffer');
        }

        const patched = patchFlexibleGemQuantity(currentBytes, quantity);
        mechanicsResult.rewrittenClasses.set(currentKey, patched.classBytes);
        mechanicsResult.rewrittenClasses.set(GEM_HELPER_PATH, patched.helperBytes);

        const before = mechanicsResult.blockers.length;
        mechanicsResult.blockers = mechanicsResult.blockers.filter(
          (blocker) => blocker.field !== 'gem quantity'
        );
        const removed = before - mechanicsResult.blockers.length;
        mechanicsResult.unsupportedDraftCount = Math.max(
          0,
          mechanicsResult.unsupportedDraftCount - removed
        );
        if (removed > 0) mechanicsResult.appliedDraftCount += 1;
        mechanicsResult.appliedPatchCount += patched.retargeted ? 2 : 1;
        mechanicsResult.diagnostics.push(
          `Ngọc thường #${GEM_DROP_ITEM_ID}: quantity 2 → ${quantity} qua PanelGemDropRuntime (không resize a/a/aa).`
        );
        if (mechanicsResult.blockers.length === 0) {
          mechanicsResult.status = 'READY';
        }
      } catch (error: unknown) {
        // Keep the original mechanics blocker so the build cannot silently export
        // a JAR whose visible quantity differs from the requested quantity.
        blockers.push({
          area: 'Cơ chế',
          count: 1,
          message: `Gem quantity writer: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    // Generic custom mob drops. Instead of inserting/resizing the large
    // a/a/aa drop method, retarget the existing first call in customDrop from
    // patch/SA.maybeDropLevel1Activation(mob) to PanelGenericMobDropRuntime.apply(mob).
    // The helper calls SA first, then executes user rules. Item ID and quantity are
    // full Java int32 values and therefore do not inherit the old iconst 1..5 limit.
    if (
      mechanicsResult.status !== 'FAILED' &&
      runtimeCustomMobDrops.length > 0 &&
      runtimeCustomMobDrops.length <= 100
    ) {
      try {
        const wantedPath = normalizeClassEntryPath('a/a/aa');
        let currentBytes: ArrayBuffer | null = null;
        let currentKey = 'a/a/aa.class';
        for (const [path, bytes] of mechanicsResult.rewrittenClasses) {
          if (normalizeClassEntryPath(path) === wantedPath) {
            currentBytes = bytes;
            currentKey = path;
            break;
          }
        }
        if (!currentBytes) {
          const entry = session.zip.file('a/a/aa.class');
          if (!entry) throw new Error('Không tìm thấy a/a/aa.class để gắn Generic Mob Drop writer.');
          currentBytes = await entry.async('arraybuffer');
        }

        const patched = patchGenericMobDropHook(
          currentBytes,
          runtimeCustomMobDrops
        );
        mechanicsResult.rewrittenClasses.set(currentKey, patched.classBytes);
        mechanicsResult.rewrittenClasses.set(
          GENERIC_DROP_HELPER_PATH,
          patched.helperBytes
        );
        mechanicsResult.appliedDraftCount += patched.ruleCount;
        mechanicsResult.appliedPatchCount += 2;
        const enabled = runtimeCustomMobDrops.filter(
          (rule) => rule.enabled !== false
        ).length;
        mechanicsResult.diagnostics.push(
          `Generic Mob Drop: ${patched.ruleCount} rule (${enabled} bật), hook customDrop -> PanelGenericMobDropRuntime.apply.`
        );
        if (mechanicsResult.blockers.length === 0) mechanicsResult.status = 'READY';
      } catch (error: unknown) {
        blockers.push({
          area: 'Cơ chế',
          count: Math.max(1, runtimeCustomMobDrops.length),
          message: `Generic Mob Drop writer: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    // Gold-only multiplier writer. We intentionally run this for EVERY non-1
    // global-gold multiplier (small or huge). The helper first preserves the
    // game's original GTLFix/TM behavior and then applies the user's multiplier
    // only when itemId is one of the actual gold item IDs 188..190. Non-gold
    // quantities are returned untouched, so custom item x1 can never become
    // x10.000/x1.000.000 because of the gold setup.
    if (
      mechanicsResult.status !== 'FAILED' &&
      mechanicDraft.desiredGlobalGoldMultiplier !== 1
    ) {
      try {
        const multiplier = mechanicDraft.desiredGlobalGoldMultiplier;
        const wantedPath = normalizeClassEntryPath('a/a/h');
        let currentBytes: ArrayBuffer | null = null;
        let currentKey = 'a/a/h.class';
        for (const [path, bytes] of mechanicsResult.rewrittenClasses) {
          if (normalizeClassEntryPath(path) === wantedPath) {
            currentBytes = bytes;
            currentKey = path;
            break;
          }
        }
        if (!currentBytes) {
          const entry = session.zip.file('a/a/h.class');
          if (!entry) throw new Error('Không tìm thấy a/a/h.class để viết vàng global.');
          currentBytes = await entry.async('arraybuffer');
        }

        const patched = patchFlexibleGlobalGold(currentBytes, multiplier);
        mechanicsResult.rewrittenClasses.set(currentKey, patched.classBytes);
        mechanicsResult.rewrittenClasses.set(GOLD_HELPER_PATH, patched.helperBytes);

        const before = mechanicsResult.blockers.length;
        mechanicsResult.blockers = mechanicsResult.blockers.filter(
          (blocker) => blocker.field !== 'Vàng global'
        );
        const removed = before - mechanicsResult.blockers.length;
        mechanicsResult.unsupportedDraftCount = Math.max(
          0,
          mechanicsResult.unsupportedDraftCount - removed
        );
        mechanicsResult.appliedDraftCount += 1;
        mechanicsResult.appliedPatchCount += patched.retargeted ? 2 : 1;
        mechanicsResult.diagnostics.push(
          `Vàng global: x${multiplier} CHỈ item #188..190 qua PanelGlobalGoldRuntime; non-gold giữ nguyên quantity.`
        );
        if (mechanicsResult.blockers.length === 0) mechanicsResult.status = 'READY';
      } catch (error: unknown) {
        blockers.push({
          area: 'Cơ chế',
          count: 1,
          message: `Vàng global writer: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    // TNSM level-limit toggle.
    // ON  = giữ nguyên game gốc: reward bị scale theo chênh level và có thể về +1.
    // OFF = bỏ toàn bộ đoạn penalty level @77..116; reward giữ nguyên giá trị đã
    //       tính từ damage + mobHP coefficient, sau đó vẫn qua multiplier/cap bình thường.
    if (
      mechanicsResult.status !== 'FAILED' &&
      mechanicDraft.tnsmLevelLimitEnabled === false
    ) {
      try {
        const wantedPath = normalizeClassEntryPath('a/a/aa');
        let currentBytes: ArrayBuffer | null = null;
        let currentKey = 'a/a/aa.class';

        for (const [path, bytes] of mechanicsResult.rewrittenClasses) {
          if (normalizeClassEntryPath(path) === wantedPath) {
            currentBytes = bytes;
            currentKey = path;
            break;
          }
        }

        if (!currentBytes) {
          const entry = session.zip.file('a/a/aa.class');
          if (!entry) {
            throw new Error('Không tìm thấy a/a/aa.class để chỉnh giới hạn TNSM theo level.');
          }
          currentBytes = await entry.async('arraybuffer');
        }

        mechanicsResult.rewrittenClasses.set(
          currentKey,
          setTnsmLevelLimit(currentBytes, false)
        );
        mechanicsResult.appliedPatchCount += 1;
        mechanicsResult.diagnostics.push(
          'TNSM level limit: OFF — bỏ cả clamp +1 và hệ số chia theo chênh level; power/potential nhận cùng reward.'
        );
      } catch (error: unknown) {
        blockers.push({
          area: 'Cơ chế',
          count: 1,
          message: `TNSM level limit: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    // Repair a/a/V.gE startup self-test after changing the shared 1e12 cap.
    // Without this, a valid cap increase still crashes on boot because gE keeps
    // its old cap-5 / cap+1 fixture constants.
    if (mechanicsResult.status !== 'FAILED' && mechanicDraft.powerCapMultiplier !== 1) {
      try {
        const wantedPath = normalizeClassEntryPath('a/a/V');
        let repaired = false;
        for (const [path, bytes] of mechanicsResult.rewrittenClasses) {
          if (normalizeClassEntryPath(path) !== wantedPath) continue;
          mechanicsResult.rewrittenClasses.set(
            path,
            repairPowerCapStartupInvariants(
              bytes,
              mechanicDraft.powerCapMultiplier
            )
          );
          repaired = true;
          break;
        }
        if (!repaired) {
          throw new Error('Mechanics writer không trả về a/a/V.class để sửa startup invariant.');
        }
      } catch (error: unknown) {
        blockers.push({
          area: 'Cơ chế',
          count: 1,
          message: `Power cap startup invariant: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }



    // Character starter power is a separate writer from Mechanics. If the JAR
    // contains starter power at/above the runtime cap, a/a/V.a() clamps bT on the
    // first reward tick. This must also work for an already-patched JAR where the
    // current draft equals the source baseline, so we inspect effective power
    // unconditionally instead of relying on the dirty flag.
    if (mechanicsResult.status !== 'FAILED') {
      try {
        const characterSnapshotForCap = await analyzeCharacterDefaults(session);
        const characterDraftsForCap = characterSnapshotForCap.profiles.map((profile) =>
          getCharacterDraft(session, profile)
        );
        // Do NOT depend on "draft dirty" here. A previously exported/patched JAR can
        // already contain a large starter power, so the current draft may equal the
        // source baseline even though a/a/V still has the old 1e12 runtime cap. In
        // that case the first reward tick clamps bT and the UI appears to reset on
        // the next hit. Always compare the effective starter power against the cap.
        const maxStarterPower = characterDraftsForCap.reduce(
          (max, draft) => Math.max(max, Number.isFinite(draft.power) ? draft.power : 0),
          0
        );
        const maxSourcePower = characterSnapshotForCap.profiles.reduce(
          (max, profile) => Math.max(max, Number.isFinite(profile.power) ? profile.power : 0),
          0
        );

        const configuredCap = powerCapFromMultiplier(mechanicDraft.powerCapMultiplier);
        const effectivePower = Math.max(maxStarterPower, maxSourcePower);
        const starterPower = BigInt(Math.max(0, Math.trunc(effectivePower)));
        const shouldAutoLift = starterPower >= configuredCap;

        if (shouldAutoLift) {
          const safeCeiling = BigInt(Number.MAX_SAFE_INTEGER);
          if (configuredCap < safeCeiling) {
            const wantedPath = normalizeClassEntryPath('a/a/V');
            let currentBytes: ArrayBuffer | null = null;
            let currentKey = 'a/a/V.class';

            for (const [path, bytes] of mechanicsResult.rewrittenClasses) {
              if (normalizeClassEntryPath(path) === wantedPath) {
                currentBytes = bytes;
                currentKey = path;
                break;
              }
            }

            if (!currentBytes) {
              const entry = session.zip.file('a/a/V.class');
              if (!entry) throw new Error('Không tìm thấy a/a/V.class để auto-unlimit power.');
              currentBytes = await entry.async('arraybuffer');
              currentKey = 'a/a/V.class';
            }

            mechanicsResult.rewrittenClasses.set(
              currentKey,
              retargetPowerCapClass(currentBytes, configuredCap, safeCeiling)
            );
            mechanicsResult.appliedPatchCount += 3;
            mechanicsResult.diagnostics.push(
              `Auto-unlimit power: cap ${configuredCap.toString()} → ${safeCeiling.toString()} vì starter power=${starterPower.toString()}.`
            );
          }
        }
      } catch (error: unknown) {
        blockers.push({
          area: 'Nhân vật',
          count: 1,
          message: `Auto-unlimit power: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    if (mechanicsResult.status === 'FAILED') {
      blockers.push({
        area: 'Cơ chế',
        count: summary.mechanicDrafts,
        message:
          mechanicsResult.errorMessage ??
          'Mechanics writer thất bại khi dựng bytecode patch.',
      });
    }

    for (const blocker of mechanicsResult.blockers) {
      blockers.push({
        area: 'Cơ chế',
        count: 1,
        message: `${blocker.field}: ${blocker.message}`,
      });
    }

    const bossResult = await buildBossPatches(
      session,
      mechanicsResult.rewrittenClasses
    );
    summary.bossDrafts = getDirtyBossCount(session);

    if (bossResult.status === 'FAILED') {
      blockers.push({
        area: 'Boss',
        count: Math.max(1, summary.bossDrafts),
        message:
          bossResult.errorMessage ??
          'Boss writer thất bại khi dựng runtime custom drop.',
      });
    }

    for (const blocker of bossResult.blockers) {
      blockers.push({
        area: 'Boss',
        count: 1,
        message: `Boss #${blocker.bossIndex} / ${blocker.field}: ${blocker.message}`,
      });
    }

    const characterResult = await buildCharacterPatches(session);
    summary.characterDrafts = characterResult.appliedDraftCount;

    if (characterResult.status === 'FAILED') {
      blockers.push({
        area: 'Nhân vật',
        count: Math.max(1, summary.characterDrafts),
        message:
          characterResult.errorMessage ??
          'Character writer thất bại khi rewrite H.p(byte).',
      });
    }

    for (const blocker of characterResult.blockers) {
      blockers.push({
        area: 'Nhân vật',
        count: 1,
        message: `${blocker.field}: ${blocker.message}`,
      });
    }

    blockers.push(...(await collectUnsupportedDrafts(session, summary)));

    const merged = mergeJobs(jobs);
    blockers.push(...merged.blockers);

    summary.supportedDrafts =
      summary.itemDrafts +
      summary.npcDrafts +
      summary.mapDrafts +
      summary.mobDrafts +
      summary.skillDrafts +
      mechanicsResult.appliedDraftCount +
      bossResult.appliedDraftCount +
      characterResult.appliedDraftCount;
    summary.unsupportedDrafts =
      bossResult.unsupportedDraftCount +
      mechanicsResult.unsupportedDraftCount;

    if (
      summary.supportedDrafts === 0 &&
      summary.unsupportedDrafts === 0
    ) {
      return {
        status: 'NO_CHANGES',
        blockers: [],
        summary,
      };
    }

    if (blockers.length > 0) {
      return {
        status: 'BLOCKED',
        blockers,
        summary,
      };
    }

    const rewriteJobs = merged.jobs;
    if (
      rewriteJobs.length === 0 &&
      itemOptionRuntimeClasses.size === 0 &&
      mechanicsResult.rewrittenClasses.size === 0 &&
      bossResult.rewrittenClasses.size === 0 &&
      characterResult.rewrittenClasses.size === 0
    ) {
      return {
        status: 'NO_CHANGES',
        blockers: [],
        summary,
      };
    }

    progress(
      'REWRITING',
      `Đang rewrite ${
        rewriteJobs.length +
        itemOptionRuntimeClasses.size +
        mechanicsResult.rewrittenClasses.size +
        bossResult.rewrittenClasses.size +
        characterResult.rewrittenClasses.size
      } class trong RAM...`,
      3,
      5
    );

    const rewritten = new Map<string, ArrayBuffer>();
    let totalCells = 0;

    for (const [path, bytes] of mechanicsResult.rewrittenClasses) {
      rewritten.set(normalizeClassEntryPath(path), bytes);
    }
    totalCells += mechanicsResult.appliedPatchCount;

    for (const [path, bytes] of itemOptionRuntimeClasses) {
      const normalizedPath = normalizeClassEntryPath(path);
      if (rewritten.has(normalizedPath)) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `Xung đột writer ItemOption: ${normalizedPath} đã được writer khác sửa.`,
        };
      }
      rewritten.set(normalizedPath, bytes);
    }
    totalCells += itemOptionRuntimePatchCount;

    // Boss writer chạy trên chính bytes Mechanics đã rewrite, nên patch/TM được hợp nhất.
    for (const [path, bytes] of bossResult.rewrittenClasses) {
      rewritten.set(normalizeClassEntryPath(path), bytes);
    }
    totalCells += bossResult.appliedPatchCount;

    for (const [path, bytes] of characterResult.rewrittenClasses) {
      const normalizedPath = normalizeClassEntryPath(path);
      if (rewritten.has(normalizedPath)) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage:
            `Xung đột writer: ${normalizedPath} vừa được Cơ chế vừa được Nhân vật sửa trong cùng lượt test.`,
        };
      }
      rewritten.set(normalizedPath, bytes);
    }
    totalCells += characterResult.appliedPatchCount;

    for (const job of rewriteJobs) {
      const result = await rewriteJob(session, job);
      if (result.status !== 'VALIDATED' || !result.rewrittenBytes) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage:
            result.errorMessage ??
            `Rewrite ${job.sourceClass} không đạt VALIDATED.`,
        };
      }

      const classPath = normalizeClassEntryPath(job.sourceClass);
      if (rewritten.has(classPath)) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage:
            `Xung đột writer: ${classPath} vừa được writer đặc thù vừa được table writer sửa trong cùng lượt test.`,
        };
      }

      rewritten.set(classPath, result.rewrittenBytes);
      totalCells += result.actualChangedCount;
    }

    summary.modifiedCells = totalCells;
    summary.rewrittenClasses = rewritten.size;

    progress('PACKING', 'Đang tạo JAR test tạm trong bộ nhớ...', 4, 5);

    const originalBytes = await session.originalFile.arrayBuffer();
    const outputZip = await JSZip.loadAsync(originalBytes.slice(0));

    for (const [path, bytes] of rewritten) {
      outputZip.file(path, new Uint8Array(bytes));
    }

    const candidateBlob = await outputZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    progress('VERIFYING', 'Đang mở lại JAR tạm và kiểm tra bytecode...', 5, 5);

    const reopened = await JSZip.loadAsync(await candidateBlob.arrayBuffer());
    const originalManifest =
      (await session.zip.file('META-INF/MANIFEST.MF')?.async('string')) ?? '';
    const candidateManifest =
      (await reopened.file('META-INF/MANIFEST.MF')?.async('string')) ?? '';

    if (originalManifest !== candidateManifest) {
      return {
        status: 'FAILED',
        blockers: [],
        summary,
        errorMessage: 'Manifest bị thay đổi ngoài dự kiến khi dựng JAR test.',
      };
    }

    for (const [path, expectedBytes] of rewritten) {
      const entry = reopened.file(path);
      if (!entry) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `JAR test bị thiếu ${path}.`,
        };
      }

      const actualBytes = await entry.async('arraybuffer');
      if (!arrayBufferEquals(actualBytes, expectedBytes)) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `${path} sau khi đóng ZIP không khớp rewritten bytes.`,
        };
      }

      const parsed = parseClassFile(actualBytes);
      if (
        parsed.status !== 'valid' ||
        parsed.remainingBytes !== 0 ||
        parsed.magic !== 0xcafebabe
      ) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `${path} không parse hợp lệ sau khi đóng JAR test.`,
        };
      }
    }

    const candidate: CandidateOutputJar = {
      blob: candidateBlob,
      fileName: deriveDraftTestFileName(session.jarInfo.fileName),
      status: 'VALIDATED',
      validatedAt: Date.now(),
      expectedModifiedCount: totalCells,
      metrics: {
        source: 'DRAFT_TEST',
        draftTest: true,
        draftFingerprint: getDraftStateFingerprint(session),
        summary: { ...summary },
        patchedClassPaths: Array.from(rewritten.keys()),
        note:
          'Candidate này chỉ dùng để test trong RAM. Không tự động ghi đè JAR gốc.',
      },
    };

    progress('DONE', 'JAR test nháp đã sẵn sàng.', 5, 5);

    return {
      status: 'VALIDATED',
      candidate,
      blockers: [],
      summary,
    };
  } catch (err: unknown) {
    return {
      status: 'FAILED',
      blockers,
      summary,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
export interface BossPatchBlocker {
  bossIndex: number;
  field: string;
  message: string;
}

export interface BossPatchResult {
  status: 'NO_CHANGES' | 'READY' | 'BLOCKED' | 'FAILED';
  rewrittenClasses: Map<string, ArrayBuffer>;
  appliedDraftCount: number;
  appliedPatchCount: number;
  unsupportedDraftCount: number;
  blockers: BossPatchBlocker[];
  diagnostics: string[];
  errorMessage?: string;
}

interface CpLayoutEntry {
  index: number;
  tag: number;
  tagOffset: number;
  payloadOffset: number;
  value?: number | bigint | string;
}

interface NestedAttributeLayout {
  name: string;
  nameIndex: number;
  attributeStart: number;
  length: number;
  dataStart: number;
  attributeEnd: number;
}

interface MethodLayout {
  name: string;
  descriptor: string;
  accessFlags: number;
  attributeStart: number;
  attributeNameIndex: number;
  attributeLength: number;
  maxStackOffset: number;
  maxLocalsOffset: number;
  codeStart: number;
  codeLength: number;
  codeEnd: number;
  exceptionTableOffset: number;
  exceptionTableLength: number;
  nestedAttributes: NestedAttributeLayout[];
  attributeEnd: number;
}

interface ClassLayout {
  constantPool: Array<CpLayoutEntry | null>;
  utf8: Map<number, string>;
  cpEnd: number;
  methods: MethodLayout[];
}

interface MutableClass {
  path: string;
  bytes: Uint8Array;
  layout: ClassLayout;
  classInfo: ClassFileInfo;
}

interface MatchField {
  cpIndex: number;
  owner: string;
  name: string;
  descriptor: string;
  objectLoadBytes: Uint8Array;
}

interface RuntimeHooks {
  onBossKilled: MethodInfo;
  charField: MatchField;
  mapField: MatchField;
  dropDescriptor: string;
  dropInvokeOpcode: number;
  rngDescriptor: string | null;
  rngInvokeOpcode: number | null;
  stackMapMode: 'StackMapTable' | 'StackMap' | 'none';
}

const TAG_UTF8 = 1;
const TAG_INTEGER = 3;
const TAG_FLOAT = 4;
const TAG_LONG = 5;
const TAG_DOUBLE = 6;
const TAG_CLASS = 7;
const TAG_STRING = 8;
const TAG_FIELDREF = 9;
const TAG_METHODREF = 10;
const TAG_INTERFACE_METHODREF = 11;
const TAG_NAME_AND_TYPE = 12;
const TAG_METHOD_HANDLE = 15;
const TAG_METHOD_TYPE = 16;
const TAG_DYNAMIC = 17;
const TAG_INVOKE_DYNAMIC = 18;
const TAG_MODULE = 19;
const TAG_PACKAGE = 20;
const JAVA_INT_MIN = -2_147_483_648;
const JAVA_INT_MAX = 2_147_483_647;
const HELPER_INTERNAL_NAME = 'patch/PanelBossDropRuntime';
const HELPER_PATH = `${HELPER_INTERNAL_NAME}.class`;
const GEM_HELPER_INTERNAL_NAME = 'patch/PanelGemDropRuntime';
const GEM_HELPER_PATH = `${GEM_HELPER_INTERNAL_NAME}.class`;
const GEM_DROP_ITEM_ID = 77;
const GEM_DROP_CALL_OFFSET = 430; // legacy verified offset; semantic finder below no longer depends on it
const GOLD_HELPER_INTERNAL_NAME = 'patch/PanelGlobalGoldRuntime';
const GOLD_HELPER_PATH = `${GOLD_HELPER_INTERNAL_NAME}.class`;
const GENERIC_DROP_HELPER_INTERNAL_NAME = 'patch/PanelGenericMobDropRuntime';
const GENERIC_DROP_HELPER_PATH = `${GENERIC_DROP_HELPER_INTERNAL_NAME}.class`;
const ITEM_OPTION_HELPER_INTERNAL_NAME = 'patch/PanelItemOptionRuntime';
const ITEM_OPTION_HELPER_PATH = `${ITEM_OPTION_HELPER_INTERNAL_NAME}.class`;
const ITEM_OPTION_BRIDGE_INTERNAL_NAME = 'a/PanelItemOptionBridge';
const ITEM_OPTION_BRIDGE_PATH = `${ITEM_OPTION_BRIDGE_INTERNAL_NAME}.class`;

function readU2(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readU4(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function writeU2(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, false);
}

function writeU4(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function skipAttributes(view: DataView, offset: number, count: number): number {
  let cursor = offset;
  for (let index = 0; index < count; index++) {
    cursor += 2;
    const length = readU4(view, cursor);
    cursor += 4 + length;
  }
  return cursor;
}

function parseRawClassLayout(buffer: ArrayBuffer): ClassLayout {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0xcafebabe) {
    throw new Error('Class không có magic CAFEBABE.');
  }

  const cpCount = readU2(view, 8);
  const constantPool: Array<CpLayoutEntry | null> = new Array(cpCount).fill(null);
  const utf8 = new Map<number, string>();
  let cursor = 10;

  for (let index = 1; index < cpCount; index++) {
    const tagOffset = cursor;
    const tag = view.getUint8(cursor++);
    const payloadOffset = cursor;
    switch (tag) {
      case TAG_UTF8: {
        const length = readU2(view, cursor);
        cursor += 2;
        const value = decodeUtf8(bytes.slice(cursor, cursor + length));
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        utf8.set(index, value);
        cursor += length;
        break;
      }
      case TAG_INTEGER: {
        const value = view.getInt32(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 4;
        break;
      }
      case TAG_FLOAT: {
        const value = view.getFloat32(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 4;
        break;
      }
      case TAG_LONG: {
        const value = view.getBigInt64(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 8;
        index++;
        if (index < cpCount) constantPool[index] = null;
        break;
      }
      case TAG_DOUBLE: {
        const value = view.getFloat64(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 8;
        index++;
        if (index < cpCount) constantPool[index] = null;
        break;
      }
      case TAG_CLASS:
      case TAG_STRING:
      case TAG_METHOD_TYPE:
      case TAG_MODULE:
      case TAG_PACKAGE:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 2;
        break;
      case TAG_FIELDREF:
      case TAG_METHODREF:
      case TAG_INTERFACE_METHODREF:
      case TAG_NAME_AND_TYPE:
      case TAG_DYNAMIC:
      case TAG_INVOKE_DYNAMIC:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 4;
        break;
      case TAG_METHOD_HANDLE:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 3;
        break;
      default:
        throw new Error(`Constant Pool tag ${tag} chưa hỗ trợ tại offset ${tagOffset}.`);
    }
  }

  const cpEnd = cursor;
  cursor += 2 + 2 + 2; // access, this, super
  const interfacesCount = readU2(view, cursor);
  cursor += 2 + interfacesCount * 2;

  const fieldsCount = readU2(view, cursor);
  cursor += 2;
  for (let index = 0; index < fieldsCount; index++) {
    cursor += 2 + 2 + 2;
    const attributesCount = readU2(view, cursor);
    cursor += 2;
    cursor = skipAttributes(view, cursor, attributesCount);
  }

  const methodsCount = readU2(view, cursor);
  cursor += 2;
  const methods: MethodLayout[] = [];

  for (let index = 0; index < methodsCount; index++) {
    const accessFlags = readU2(view, cursor);
    cursor += 2;
    const nameIndex = readU2(view, cursor);
    cursor += 2;
    const descriptorIndex = readU2(view, cursor);
    cursor += 2;
    const attributesCount = readU2(view, cursor);
    cursor += 2;
    const name = utf8.get(nameIndex) ?? '';
    const descriptor = utf8.get(descriptorIndex) ?? '';

    for (let attrIndex = 0; attrIndex < attributesCount; attrIndex++) {
      const attributeStart = cursor;
      const attributeNameIndex = readU2(view, cursor);
      cursor += 2;
      const attributeLength = readU4(view, cursor);
      cursor += 4;
      const dataStart = cursor;
      const attributeName = utf8.get(attributeNameIndex) ?? '';

      if (attributeName === 'Code') {
        const maxStackOffset = dataStart;
        const maxLocalsOffset = dataStart + 2;
        const codeLength = readU4(view, dataStart + 4);
        const codeStart = dataStart + 8;
        const codeEnd = codeStart + codeLength;
        const exceptionTableOffset = codeEnd;
        const exceptionTableLength = readU2(view, exceptionTableOffset);
        let codeCursor = exceptionTableOffset + 2 + exceptionTableLength * 8;
        const nestedAttributeCount = readU2(view, codeCursor);
        codeCursor += 2;
        const nestedAttributes: NestedAttributeLayout[] = [];

        for (let nestedIndex = 0; nestedIndex < nestedAttributeCount; nestedIndex++) {
          const nestedStart = codeCursor;
          const nestedNameIndex = readU2(view, codeCursor);
          codeCursor += 2;
          const nestedLength = readU4(view, codeCursor);
          codeCursor += 4;
          const nestedDataStart = codeCursor;
          const nestedEnd = nestedDataStart + nestedLength;
          nestedAttributes.push({
            name: utf8.get(nestedNameIndex) ?? '',
            nameIndex: nestedNameIndex,
            attributeStart: nestedStart,
            length: nestedLength,
            dataStart: nestedDataStart,
            attributeEnd: nestedEnd,
          });
          codeCursor = nestedEnd;
        }

        methods.push({
          name,
          descriptor,
          accessFlags,
          attributeStart,
          attributeNameIndex,
          attributeLength,
          maxStackOffset,
          maxLocalsOffset,
          codeStart,
          codeLength,
          codeEnd,
          exceptionTableOffset,
          exceptionTableLength,
          nestedAttributes,
          attributeEnd: dataStart + attributeLength,
        });
      }
      cursor = dataStart + attributeLength;
    }
  }

  return { constantPool, utf8, cpEnd, methods };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function refreshMutable(target: MutableClass): void {
  const buffer = toArrayBuffer(target.bytes);
  target.layout = parseRawClassLayout(buffer);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error(`Reparse ${target.path} thất bại.`);
  }
  target.classInfo = parsed;
}

function rawUtf8(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > 0xffff) throw new Error('CONSTANT_Utf8 vượt 65535 bytes.');
  const out = new Uint8Array(3 + encoded.length);
  out[0] = TAG_UTF8;
  const view = new DataView(out.buffer);
  writeU2(view, 1, encoded.length);
  out.set(encoded, 3);
  return out;
}

function rawU2Entry(tag: number, index: number): Uint8Array {
  return new Uint8Array([tag, (index >> 8) & 0xff, index & 0xff]);
}

function rawU2U2Entry(tag: number, a: number, b: number): Uint8Array {
  return new Uint8Array([
    tag,
    (a >> 8) & 0xff,
    a & 0xff,
    (b >> 8) & 0xff,
    b & 0xff,
  ]);
}

function appendCpEntry(target: MutableClass, entry: Uint8Array): number {
  const currentCount = target.layout.constantPool.length;
  if (currentCount >= 0xffff) throw new Error('Constant Pool đã đạt 65535 entry.');
  const cpEnd = target.layout.cpEnd;
  const next = new Uint8Array(target.bytes.length + entry.length);
  next.set(target.bytes.slice(0, cpEnd), 0);
  next.set(entry, cpEnd);
  next.set(target.bytes.slice(cpEnd), cpEnd + entry.length);
  const view = new DataView(next.buffer);
  writeU2(view, 8, currentCount + 1);
  target.bytes = next;
  refreshMutable(target);
  return currentCount;
}

function appendHelperMethodRef(target: MutableClass): number {
  const helperUtf8 = appendCpEntry(target, rawUtf8(HELPER_INTERNAL_NAME));
  const helperClass = appendCpEntry(target, rawU2Entry(TAG_CLASS, helperUtf8));
  const applyUtf8 = appendCpEntry(target, rawUtf8('apply'));
  const descUtf8 = appendCpEntry(target, rawUtf8('(La/m;)V'));
  const nat = appendCpEntry(target, rawU2U2Entry(TAG_NAME_AND_TYPE, applyUtf8, descUtf8));
  return appendCpEntry(target, rawU2U2Entry(TAG_METHODREF, helperClass, nat));
}

function readNumericPush(instruction: JvmInstruction, cp: any[]): number | null {
  if (typeof instruction.pushValue === 'number') return instruction.pushValue;
  if (
    typeof instruction.cpIndex === 'number' &&
    instruction.cpIndex > 0 &&
    instruction.cpIndex < cp.length
  ) {
    const entry: any = cp[instruction.cpIndex];
    if (typeof entry?.value === 'number') return entry.value;
    if (typeof entry?.value === 'bigint') return Number(entry.value);
  }
  return null;
}

function isObjectLoad(instruction: JvmInstruction | undefined): boolean {
  if (!instruction) return false;
  return (
    (instruction.opcode >= 0x2a && instruction.opcode <= 0x2d) ||
    instruction.opcode === 0x19
  );
}

function descriptorArguments(descriptor: string): string[] {
  if (!descriptor.startsWith('(')) return [];
  const result: string[] = [];
  let index = 1;
  while (index < descriptor.length && descriptor[index] !== ')') {
    const start = index;
    while (descriptor[index] === '[') index++;
    if (descriptor[index] === 'L') {
      const end = descriptor.indexOf(';', index);
      if (end < 0) return [];
      index = end + 1;
    } else {
      index++;
    }
    result.push(descriptor.slice(start, index));
  }
  return result;
}

function descriptorReturn(descriptor: string): string {
  const close = descriptor.indexOf(')');
  return close >= 0 ? descriptor.slice(close + 1) : '';
}

function findDirectDropCall(method: MethodInfo, cp: any[]): JvmInstruction | null {
  const instructions = method.code?.instructions ?? [];
  for (let index = 2; index < instructions.length; index++) {
    const instruction = instructions[index];
    if (
      instruction.methodRef?.owner !== 'a/a/h' ||
      instruction.methodRef?.name !== 'a'
    ) continue;
    const item = readNumericPush(instructions[index - 2], cp);
    const quantity = readNumericPush(instructions[index - 1], cp);
    if (item === 611 && quantity === 1) return instruction;
  }
  return null;
}

function findFieldMatchBefore(
  method: MethodInfo,
  cp: any[],
  numericValue: number,
  beforeOffset: number,
  code: Uint8Array
): MatchField | null {
  const instructions = method.code?.instructions ?? [];
  const numericIndices: number[] = [];
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index];
    if (instruction.offset < beforeOffset && readNumericPush(instruction, cp) === numericValue) {
      numericIndices.push(index);
    }
  }

  for (let candidate = numericIndices.length - 1; candidate >= 0; candidate--) {
    const numericIndex = numericIndices[candidate];
    for (let fieldIndex = numericIndex - 1; fieldIndex >= Math.max(0, numericIndex - 4); fieldIndex--) {
      const field = instructions[fieldIndex];
      if (field.opcode !== 0xb4 || !field.fieldRef || typeof field.cpIndex !== 'number') continue;
      const load = instructions[fieldIndex - 1];
      if (!isObjectLoad(load) || load.offset + load.length !== field.offset) continue;
      return {
        cpIndex: field.cpIndex,
        owner: field.fieldRef.owner,
        name: field.fieldRef.name,
        descriptor: field.fieldRef.descriptor,
        objectLoadBytes: code.slice(load.offset, load.offset + load.length),
      };
    }
  }
  return null;
}

function findRngCall(classInfo: ClassFileInfo): JvmInstruction | null {
  for (const method of classInfo.methods) {
    for (const instruction of method.code?.instructions ?? []) {
      if (
        instruction.methodRef?.owner === 'a/a/h' &&
        instruction.methodRef?.name === 'w' &&
        instruction.methodRef?.descriptor === '(I)I'
      ) return instruction;
    }
  }
  return null;
}

function verifyBossManagerHook(manager: ClassFileInfo | null, descriptor: string): boolean {
  if (!manager) return false;
  for (const method of manager.methods) {
    for (const instruction of method.code?.instructions ?? []) {
      if (
        instruction.methodRef?.owner === 'patch/TM' &&
        instruction.methodRef?.name === 'onBossKilled' &&
        instruction.methodRef?.descriptor === descriptor
      ) return true;
    }
  }
  return false;
}

function resolveRuntimeHooks(target: MutableClass, manager: ClassFileInfo | null): RuntimeHooks {
  const onBossKilled = target.classInfo.methods.find(
    (method) => method.name === 'onBossKilled' && method.code?.instructions
  );
  if (!onBossKilled?.code) throw new Error('Không tìm thấy patch/TM.onBossKilled có bytecode.');
  if (descriptorReturn(onBossKilled.descriptor) !== 'V') {
    throw new Error(`onBossKilled${onBossKilled.descriptor} không trả void.`);
  }
  if (!verifyBossManagerHook(manager, onBossKilled.descriptor)) {
    throw new Error(
      `a/a/d không gọi patch/TM.onBossKilled${onBossKilled.descriptor}; không xác minh được hook boss toàn cục.`
    );
  }

  const directDrop = findDirectDropCall(onBossKilled, target.classInfo.constantPool as any[]);
  if (!directDrop?.methodRef) throw new Error('Không xác minh được drop item #611 trong onBossKilled.');
  const args = descriptorArguments(directDrop.methodRef.descriptor);
  if (
    directDrop.opcode !== 0xb8 ||
    args.length !== 3 ||
    args[0] !== 'La/m;' ||
    args[1] !== 'I' ||
    args[2] !== 'I'
  ) {
    throw new Error(`Hàm drop ${directDrop.methodRef.descriptor} không phải static (La/m;II).`);
  }

  const code = onBossKilled.code.code;
  const charField = findFieldMatchBefore(
    onBossKilled,
    target.classInfo.constantPool as any[],
    -10004,
    directDrop.offset,
    code
  );
  const mapField = findFieldMatchBefore(
    onBossKilled,
    target.classInfo.constantPool as any[],
    62,
    directDrop.offset,
    code
  );
  if (!charField || !mapField) {
    throw new Error('Không resolve được charId/mapId từ rule boss #611 đã xác minh.');
  }
  if (charField.owner !== 'a/m' || mapField.owner !== 'a/m') {
    throw new Error(`Field boss không thuộc a/m (${charField.owner}, ${mapField.owner}).`);
  }

  const methodLayout = target.layout.methods.find(
    (method) => method.name === onBossKilled.name && method.descriptor === onBossKilled.descriptor
  );
  if (!methodLayout) throw new Error('Không resolve được Code layout của onBossKilled.');
  const nestedNames = new Set(methodLayout.nestedAttributes.map((attribute) => attribute.name));
  const stackMapMode: RuntimeHooks['stackMapMode'] = nestedNames.has('StackMap')
    ? 'StackMap'
    : nestedNames.has('StackMapTable')
      ? 'StackMapTable'
      : 'none';
  const rng = findRngCall(target.classInfo);

  return {
    onBossKilled,
    charField,
    mapField,
    dropDescriptor: directDrop.methodRef.descriptor,
    dropInvokeOpcode: directDrop.opcode,
    rngDescriptor: rng?.methodRef?.descriptor ?? null,
    rngInvokeOpcode: rng?.opcode ?? null,
    stackMapMode,
  };
}

class HelperConstantPool {
  private entries: Uint8Array[] = [];
  private cache = new Map<string, number>();

  private add(key: string, bytes: Uint8Array): number {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const index = this.entries.length + 1;
    this.entries.push(bytes);
    this.cache.set(key, index);
    return index;
  }

  utf8(value: string): number {
    return this.add(`u:${value}`, rawUtf8(value));
  }

  clazz(internalName: string): number {
    const name = this.utf8(internalName);
    return this.add(`c:${internalName}`, rawU2Entry(TAG_CLASS, name));
  }

  nameAndType(name: string, descriptor: string): number {
    const nameIndex = this.utf8(name);
    const descriptorIndex = this.utf8(descriptor);
    return this.add(
      `nt:${name}:${descriptor}`,
      rawU2U2Entry(TAG_NAME_AND_TYPE, nameIndex, descriptorIndex)
    );
  }

  fieldRef(owner: string, name: string, descriptor: string): number {
    const ownerIndex = this.clazz(owner);
    const nat = this.nameAndType(name, descriptor);
    return this.add(
      `f:${owner}:${name}:${descriptor}`,
      rawU2U2Entry(TAG_FIELDREF, ownerIndex, nat)
    );
  }

  methodRef(owner: string, name: string, descriptor: string): number {
    const ownerIndex = this.clazz(owner);
    const nat = this.nameAndType(name, descriptor);
    return this.add(
      `m:${owner}:${name}:${descriptor}`,
      rawU2U2Entry(TAG_METHODREF, ownerIndex, nat)
    );
  }

  integer(value: number): number {
    if (!Number.isInteger(value) || value < JAVA_INT_MIN || value > JAVA_INT_MAX) {
      throw new Error(`${value} không nằm trong Java int32.`);
    }
    const bytes = new Uint8Array(5);
    bytes[0] = TAG_INTEGER;
    new DataView(bytes.buffer).setInt32(1, value, false);
    return this.add(`i:${value}`, bytes);
  }

  serialize(): Uint8Array {
    const total = this.entries.reduce((sum, entry) => sum + entry.length, 0);
    const out = new Uint8Array(total);
    let cursor = 0;
    for (const entry of this.entries) {
      out.set(entry, cursor);
      cursor += entry.length;
    }
    return out;
  }

  get count(): number {
    return this.entries.length + 1;
  }
}

function immediatePush(value: number): number[] | null {
  if (!Number.isInteger(value)) return null;
  if (value === -1) return [0x02];
  if (value >= 0 && value <= 5) return [0x03 + value];
  if (value >= -128 && value <= 127) return [0x10, value & 0xff];
  if (value >= -32768 && value <= 32767) {
    const normalized = value & 0xffff;
    return [0x11, (normalized >> 8) & 0xff, normalized & 0xff];
  }
  return null;
}

function helperIntPush(cp: HelperConstantPool, value: number): number[] {
  const direct = immediatePush(value);
  if (direct) return direct;
  const index = cp.integer(value);
  if (index <= 0xff) return [0x12, index];
  return [0x13, (index >> 8) & 0xff, index & 0xff];
}

function addBranch(
  code: number[],
  opcode: number,
  fixups: Array<{ pos: number; targetId: number }>,
  targetId: number
): void {
  const pos = code.length;
  code.push(opcode, 0, 0);
  fixups.push({ pos, targetId });
}

function patchBranch(code: number[], pos: number, target: number): void {
  const displacement = target - pos;
  if (displacement < -32768 || displacement > 32767) {
    throw new Error(`Branch ${displacement} vượt signed short.`);
  }
  const value = displacement & 0xffff;
  code[pos + 1] = (value >> 8) & 0xff;
  code[pos + 2] = value & 0xff;
}

function encodeStackMapTable(frameTargets: number[]): Uint8Array {
  const body: number[] = [];
  let previous = -1;
  for (const target of frameTargets) {
    const delta = target - previous - 1;
    if (delta <= 63) body.push(delta);
    else body.push(251, (delta >> 8) & 0xff, delta & 0xff);
    previous = target;
  }
  const out = new Uint8Array(2 + body.length);
  const view = new DataView(out.buffer);
  writeU2(view, 0, frameTargets.length);
  out.set(body, 2);
  return out;
}

function encodeCldcStackMap(frameTargets: number[], aMClassIndex: number): Uint8Array {
  // CLDC StackMap: absolute offset + full locals/stack. apply(La/m;)V has exactly local0 = a/m.
  const entryLength = 2 + 2 + 3 + 2;
  const out = new Uint8Array(2 + frameTargets.length * entryLength);
  const view = new DataView(out.buffer);
  writeU2(view, 0, frameTargets.length);
  let cursor = 2;
  for (const target of frameTargets) {
    writeU2(view, cursor, target);
    cursor += 2;
    writeU2(view, cursor, 1); // locals
    cursor += 2;
    out[cursor++] = 7; // ITEM_Object
    writeU2(view, cursor, aMClassIndex);
    cursor += 2;
    writeU2(view, cursor, 0); // stack items
    cursor += 2;
  }
  return out;
}


/**
 * Build a tiny branchless runtime helper for the normal gem drop (item #77).
 * Only the single gem call in a/a/aa is retargeted to this helper, so every
 * other drop keeps its original quantity. The incoming third argument is
 * intentionally ignored and replaced with the editor quantity.
 */
function buildGemQuantityHelper(
  targetClass: ClassFileInfo,
  quantity: number
): ArrayBuffer {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > JAVA_INT_MAX) {
    throw new Error(`Số lượng Ngọc ${quantity} vượt Java int 1..${JAVA_INT_MAX}.`);
  }

  const cp = new HelperConstantPool();
  const thisClass = cp.clazz(GEM_HELPER_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const methodName = cp.utf8('drop');
  const methodDescriptor = cp.utf8('(La/m;II)I');
  const codeName = cp.utf8('Code');
  const originalDropRef = cp.methodRef('a/a/h', 'a', '(La/m;II)I');

  const code = new Uint8Array([
    0x2a, // aload_0 (mob)
    0x1b, // iload_1 (item id)
    ...helperIntPush(cp, quantity),
    0xb8,
    (originalDropRef >> 8) & 0xff,
    originalDropRef & 0xff,
    0xac, // ireturn
  ]);

  // Serialize CP only after helperIntPush has had a chance to register a
  // CONSTANT_Integer for quantities that do not fit iconst/bipush/sipush.
  const cpBytes = cp.serialize();
  const codeDataLength = 2 + 2 + 4 + code.length + 2 + 2;
  const codeAttribute = new Uint8Array(6 + codeDataLength);
  const codeView = new DataView(codeAttribute.buffer);
  writeU2(codeView, 0, codeName);
  writeU4(codeView, 2, codeDataLength);
  let c = 6;
  writeU2(codeView, c, 3); // max_stack: mob, itemId, quantity
  c += 2;
  writeU2(codeView, c, 3); // max_locals: mob, itemId, ignored original qty
  c += 2;
  writeU4(codeView, c, code.length);
  c += 4;
  codeAttribute.set(code, c);
  c += code.length;
  writeU2(codeView, c, 0); // exception_table_length
  c += 2;
  writeU2(codeView, c, 0); // Code attributes_count (branchless, no frames needed)

  const method = new Uint8Array(8 + codeAttribute.length);
  const methodView = new DataView(method.buffer);
  writeU2(methodView, 0, 0x0009); // public static
  writeU2(methodView, 2, methodName);
  writeU2(methodView, 4, methodDescriptor);
  writeU2(methodView, 6, 1);
  method.set(codeAttribute, 8);

  const total = 10 + cpBytes.length + 12 + method.length + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  writeU2(view, 4, targetClass.minorVersion);
  writeU2(view, 6, targetClass.majorVersion);
  writeU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor);
  cursor += cpBytes.length;
  writeU2(view, cursor, 0x0031); // public final super
  cursor += 2;
  writeU2(view, cursor, thisClass);
  cursor += 2;
  writeU2(view, cursor, superClass);
  cursor += 2;
  writeU2(view, cursor, 0); // interfaces
  cursor += 2;
  writeU2(view, cursor, 0); // fields
  cursor += 2;
  writeU2(view, cursor, 1); // methods
  cursor += 2;
  out.set(method, cursor);
  cursor += method.length;
  writeU2(view, cursor, 0); // class attributes

  const buffer = toArrayBuffer(out);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('PanelGemDropRuntime.class tự sinh không parse VALID.');
  }
  return buffer;
}

function appendGemHelperMethodRef(target: MutableClass): number {
  const helperUtf8 = appendCpEntry(target, rawUtf8(GEM_HELPER_INTERNAL_NAME));
  const helperClass = appendCpEntry(target, rawU2Entry(TAG_CLASS, helperUtf8));
  const nameUtf8 = appendCpEntry(target, rawUtf8('drop'));
  const descUtf8 = appendCpEntry(target, rawUtf8('(La/m;II)I'));
  const nat = appendCpEntry(
    target,
    rawU2U2Entry(TAG_NAME_AND_TYPE, nameUtf8, descUtf8)
  );
  return appendCpEntry(
    target,
    rawU2U2Entry(TAG_METHODREF, helperClass, nat)
  );
}

function patchFlexibleGemQuantity(
  buffer: ArrayBuffer,
  quantity: number
): { classBytes: ArrayBuffer; helperBytes: ArrayBuffer; retargeted: boolean } {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > JAVA_INT_MAX) {
    throw new Error(`Số lượng Ngọc ${quantity} vượt Java int 1..${JAVA_INT_MAX}.`);
  }

  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('a/a/aa.class không parse VALID trước khi gắn writer nhiều Ngọc.');
  }

  const target: MutableClass = {
    path: 'a/a/aa.class',
    bytes: new Uint8Array(buffer.slice(0)),
    layout: parseRawClassLayout(buffer),
    classInfo: parsed,
  };

  /*
   * IMPORTANT: do not use the generic JvmInstruction.methodRef metadata here.
   * The repo decoder can stop before/around this CLDC method on opcodes it does
   * not fully model, which made V13 report 0 candidates even though javap shows:
   *   426:aload_0  427:bipush 77  429:iconst_2  430:invokestatic a/a/h.a
   *
   * Locate the gem call from raw bytecode instead. In the verified 1.3.8/1.5.5
   * game this pattern is unique inside a/a/aa.a(m,H,Z)[I. Constant-pool growth
   * changes the absolute class offset but never the logical method offset.
   */
  const numericPushLength = (code: Uint8Array, offset: number): number => {
    const opcode = code[offset];
    if (opcode === 0x02 || (opcode >= 0x03 && opcode <= 0x08)) return 1;
    if (opcode === 0x10 || opcode === 0x12) return 2; // bipush / ldc
    if (opcode === 0x11 || opcode === 0x13) return 3; // sipush / ldc_w
    return 0;
  };

  const numericPushValue = (code: Uint8Array, offset: number): number | null => {
    const opcode = code[offset];
    if (opcode === 0x02) return -1;
    if (opcode >= 0x03 && opcode <= 0x08) return opcode - 0x03;
    if (opcode === 0x10) {
      const raw = code[offset + 1];
      return raw >= 0x80 ? raw - 0x100 : raw;
    }
    if (opcode === 0x11) {
      const raw = (code[offset + 1] << 8) | code[offset + 2];
      return raw >= 0x8000 ? raw - 0x10000 : raw;
    }
    return null;
  };

  const findRawGemCall = (): { method: MethodLayout; callOffset: number } => {
    const method = target.layout.methods.find(
      (candidate) =>
        candidate.name === 'a' && candidate.descriptor === '(La/m;La/a/H;Z)[I'
    );
    if (!method) {
      throw new Error('Không tìm thấy a/a/aa.a(La/m;La/a/H;Z)[I.');
    }

    const code = target.bytes.slice(method.codeStart, method.codeEnd);
    const candidates: number[] = [];

    for (let itemOffset = 0; itemOffset + 4 < code.length; itemOffset++) {
      // item #77 is emitted as bipush 77 in both verified JARs.
      if (code[itemOffset] !== 0x10 || code[itemOffset + 1] !== GEM_DROP_ITEM_ID) {
        continue;
      }

      const qtyOffset = itemOffset + 2;
      const qtyLength = numericPushLength(code, qtyOffset);
      if (qtyLength === 0) continue;
      const callOffset = qtyOffset + qtyLength;
      if (callOffset + 2 >= code.length || code[callOffset] !== 0xb8) continue;

      // Original game passes qty=2. An already patched workspace still keeps
      // this ignored argument, so accept any immediate numeric push here.
      const immediate = numericPushValue(code, qtyOffset);
      if (immediate === null && code[qtyOffset] !== 0x12 && code[qtyOffset] !== 0x13) {
        continue;
      }
      candidates.push(callOffset);
    }

    if (candidates.length !== 1) {
      throw new Error(
        `Không định vị duy nhất được raw gem drop #${GEM_DROP_ITEM_ID}; tìm thấy ${candidates.length} pattern.`
      );
    }
    return { method, callOffset: candidates[0] };
  };

  const initial = findRawGemCall();
  const callOffset = initial.callOffset;

  // Always append a fresh verified Methodref and retarget the call. This also
  // repairs workspace JARs that were partially patched by an older writer.
  const helperRef = appendGemHelperMethodRef(target);
  const afterCp = findRawGemCall();
  if (afterCp.callOffset !== callOffset) {
    throw new Error(`Gem call logical offset đổi ${callOffset} → ${afterCp.callOffset} sau CP append.`);
  }

  const absolute = afterCp.method.codeStart + callOffset;
  if (target.bytes[absolute] !== 0xb8) {
    throw new Error(`Gem call @${callOffset} không còn là invokestatic sau mở rộng Constant Pool.`);
  }
  target.bytes[absolute + 1] = (helperRef >> 8) & 0xff;
  target.bytes[absolute + 2] = helperRef & 0xff;
  refreshMutable(target);

  const verifiedRaw = findRawGemCall();
  const verifiedAbsolute = verifiedRaw.method.codeStart + verifiedRaw.callOffset;
  const writtenRef =
    (target.bytes[verifiedAbsolute + 1] << 8) |
    target.bytes[verifiedAbsolute + 2];
  if (writtenRef !== helperRef) {
    throw new Error(`Gem Methodref verify sai: #${writtenRef}, expected #${helperRef}.`);
  }

  const finalBuffer = toArrayBuffer(target.bytes);
  const finalParsed = parseClassFile(finalBuffer);
  if (finalParsed.status !== 'valid' || finalParsed.remainingBytes !== 0) {
    throw new Error('a/a/aa.class không parse VALID sau writer nhiều Ngọc.');
  }

  return {
    classBytes: finalBuffer,
    helperBytes: buildGemQuantityHelper(finalParsed, quantity),
    retargeted: true,
  };
}



interface ItemOptionRuntimeRule {
  itemId: number;
  optionId: number;
  param: number;
}

/**
 * Collect per-item gameplay options from ItemDraft. The 15-column ItemTemplate
 * table only owns metadata; the live stat list is a.ab.b : a.H[].
 */
function collectItemOptionRuntimeRules(
  drafts: ItemDraft[],
  newItems: WorkspaceNewItemOperation[] = []
): ItemOptionRuntimeRule[] {
  const byKey = new Map<string, ItemOptionRuntimeRule>();

  const addRules = (
    itemIdRaw: unknown,
    itemName: string,
    options: Array<{ optionId: number; param: number; enabled: boolean; note?: string }> | undefined
  ) => {
    if (!options?.length) return;

    const itemId = Number(itemIdRaw ?? '');
    if (!Number.isInteger(itemId) || itemId < 0 || itemId > 32767) {
      throw new Error(
        `${itemName}: Item ID ${String(itemIdRaw)} không nằm trong short dương 0..32767.`
      );
    }

    for (const option of options) {
      if (option.enabled === false) continue;
      let optionId = Math.round(Number(option.optionId));
      let param = Math.round(Number(option.param));
      if (!Number.isInteger(optionId) || optionId < 0 || optionId > 32767) {
        throw new Error(
          `${itemName}: optionId ${option.optionId} không hợp lệ.`
        );
      }

      // a.H(int,int) converts the two compact K-options before storing them:
      // #22 HP+#K -> #6 with param*1000, #23 KI+#K -> #7 with param*1000.
      // Normalize here too so an override updates the existing runtime option
      // instead of creating a duplicate alias that combat code may ignore.
      if (optionId === 22 || optionId === 23) {
        optionId = optionId === 22 ? 6 : 7;
        param *= 1000;
      }

      if (!Number.isInteger(param) || param < JAVA_INT_MIN || param > JAVA_INT_MAX) {
        throw new Error(
          `${itemName}: param option #${option.optionId} vượt Java int32 sau normalize.`
        );
      }
      byKey.set(`${itemId}:${optionId}`, { itemId, optionId, param });
    }
  };

  for (const draft of drafts) {
    addRules(
      draft.values[0],
      draft.values[3] || draft.key || 'Item',
      draft.optionOverrides
    );
  }

  // NEW_ITEM là operation của Patch Workspace, không tồn tại trong itemDrafts.
  // Nếu bỏ nhánh này, item mới có thể được tạo ra nhưng toàn bộ HP/KI/damage/crit
  // nhập trong modal sẽ không bao giờ đi vào PanelItemOptionRuntime.
  for (const operation of newItems) {
    addRules(
      operation.values[0],
      operation.values[3] || `Item mới #${operation.values[0] || '?'}`,
      operation.optionOverrides
    );
  }

  const rules = [...byKey.values()].sort(
    (a, b) => a.itemId - b.itemId || a.optionId - b.optionId
  );
  if (rules.length > 256) {
    throw new Error(`ItemOption runtime có ${rules.length} rule, vượt giới hạn an toàn 256 rule/JAR.`);
  }
  return rules;
}

interface HelperMethodSpec {
  accessFlags: number;
  nameIndex: number;
  descriptorIndex: number;
  maxStack: number;
  maxLocals: number;
  code: number[];
}

function encodeSimpleHelperMethod(codeName: number, spec: HelperMethodSpec): Uint8Array {
  const codeBytes = new Uint8Array(spec.code);
  const codeDataLength = 2 + 2 + 4 + codeBytes.length + 2 + 2;
  const codeAttribute = new Uint8Array(6 + codeDataLength);
  const codeView = new DataView(codeAttribute.buffer);
  writeU2(codeView, 0, codeName);
  writeU4(codeView, 2, codeDataLength);
  let cursor = 6;
  writeU2(codeView, cursor, spec.maxStack); cursor += 2;
  writeU2(codeView, cursor, spec.maxLocals); cursor += 2;
  writeU4(codeView, cursor, codeBytes.length); cursor += 4;
  codeAttribute.set(codeBytes, cursor); cursor += codeBytes.length;
  writeU2(codeView, cursor, 0); cursor += 2; // exception table
  writeU2(codeView, cursor, 0); // nested attributes; target is classfile v47

  const method = new Uint8Array(8 + codeAttribute.length);
  const methodView = new DataView(method.buffer);
  writeU2(methodView, 0, spec.accessFlags);
  writeU2(methodView, 2, spec.nameIndex);
  writeU2(methodView, 4, spec.descriptorIndex);
  writeU2(methodView, 6, 1);
  method.set(codeAttribute, 8);
  return method;
}

function aLoad(index: number): number[] {
  if (index >= 0 && index <= 3) return [0x2a + index];
  return [0x19, index & 0xff];
}
function aStore(index: number): number[] {
  if (index >= 0 && index <= 3) return [0x4b + index];
  return [0x3a, index & 0xff];
}
function iLoad(index: number): number[] {
  if (index >= 0 && index <= 3) return [0x1a + index];
  return [0x15, index & 0xff];
}
function iStore(index: number): number[] {
  if (index >= 0 && index <= 3) return [0x3b + index];
  return [0x36, index & 0xff];
}

/**
 * Build a runtime stat writer that updates live a.ab item instances.
 * Existing options are edited in place; missing options are appended, never
 * replacing the whole option array. This preserves all unspecified stats.
 */
function buildItemOptionRuntimeHelper(
  targetClass: ClassFileInfo,
  rules: ItemOptionRuntimeRule[]
): ArrayBuffer {
  const cp = new HelperConstantPool();
  const thisClass = cp.clazz(ITEM_OPTION_HELPER_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const codeName = cp.utf8('Code');

  const tickName = cp.utf8('tick');
  const tickDesc = cp.utf8('()J');
  const sleepAndTickName = cp.utf8('sleepAndTick');
  const sleepAndTickDesc = cp.utf8('(J)V');
  const applyArrayName = cp.utf8('applyArray');
  const applyArrayDesc = cp.utf8('([La/ab;)V');
  const apply2DName = cp.utf8('apply2D');
  const apply2DDesc = cp.utf8('([[La/ab;)V');
  const applyItemName = cp.utf8('applyItem');
  const applyItemDesc = cp.utf8('(La/ab;)V');
  const setOptionName = cp.utf8('setOption');
  const setOptionDesc = cp.utf8('(La/ab;II)V');
  const cleanAndApplyName = cp.utf8('cleanAndApply');
  const cleanAndApplyDesc = cp.utf8('(La/a/w;)Z');
  const applyServerItemName = cp.utf8('applyServerItem');
  const applyServerItemDesc = cp.utf8('(La/a/w;)V');
  const setServerOptionName = cp.utf8('setServerOption');
  const setServerOptionDesc = cp.utf8('(La/a/w;II)V');

  const playerGetter = cp.methodRef('a/c', 'a', '()La/c;');
  const playerItemsA = cp.fieldRef('a/c', 'a', '[La/ab;');
  const playerItemsB = cp.fieldRef('a/c', 'b', '[La/ab;');
  const playerItemsC = cp.fieldRef('a/c', 'c', '[La/ab;');
  const playerItems2D = cp.fieldRef('a/c', 'a', '[[La/ab;');
  const itemTemplateRef = cp.fieldRef('a/ab', 'a', 'La/bK;');
  const itemOptionsRef = cp.fieldRef('a/ab', 'b', '[La/H;');
  const templateIdRef = cp.fieldRef('a/bK', 'aj', 'S');
  const optionTemplateRef = cp.fieldRef('a/H', 'a', 'La/bU;');
  const optionParamRef = cp.fieldRef('a/H', 'fq', 'I');
  const optionIdRef = cp.fieldRef('a/bU', 'ui', 'I');
  const optionClass = cp.clazz('a/H');
  const optionCtor = cp.methodRef('a/H', '<init>', '(II)V');
  const optionManagerGetter = cp.methodRef('a/am', 'a', '()La/am;');
  const optionTemplatesRef = cp.fieldRef('a/am', 'a', '[La/bU;');
  const currentTimeMillis = cp.methodRef('java/lang/System', 'currentTimeMillis', '()J');
  const threadSleep = cp.methodRef('java/lang/Thread', 'sleep', '(J)V');
  const arrayCopy = cp.methodRef(
    'java/lang/System',
    'arraycopy',
    '(Ljava/lang/Object;ILjava/lang/Object;II)V'
  );

  // Gameplay-side item representation. a/a/l.a(H, statKind) walks H.b and
  // reads a/a/w.cE/cF. Option #50 is explicitly included in attack-percent math.
  const dbFixCleanCall = cp.methodRef('patch/DBFix', 'cleanIfDragon', '(La/a/w;)Z');
  const serverItemIdRef = cp.fieldRef('a/a/w', 'cG', 'I');
  const serverOptionIdsRef = cp.fieldRef('a/a/w', 'cE', '[I');
  const serverOptionParamsRef = cp.fieldRef('a/a/w', 'cF', '[I');
  const serverOptionCountRef = cp.fieldRef('a/a/w', 'xk', 'I');
  const serverAppendOptionCall = cp.methodRef('a/a/w', 'v', '(II)V');

  const applyArrayCall = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'applyArray', '([La/ab;)V');
  const apply2DCall = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'apply2D', '([[La/ab;)V');
  const applyItemCall = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'applyItem', '(La/ab;)V');
  const setOptionCall = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'setOption', '(La/ab;II)V');
  const applyServerItemCall = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'applyServerItem', '(La/a/w;)V');
  const setServerOptionCall = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'setServerOption', '(La/a/w;II)V');
  const tickCall = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'tick', '()J');

  // tick(): client/display side only. Actual combat stat application is hooked
  // directly in a/a/w.fU() via cleanAndApply(), below.
  // the exact original System.currentTimeMillis() return contract used by bN.run().
  const tick: number[] = [
    0xb8, (playerGetter >> 8) & 0xff, playerGetter & 0xff,
    ...aStore(0),
    ...aLoad(0),
  ];
  const tickNull = tick.length;
  tick.push(0xc6, 0, 0); // ifnull -> time
  const appendArrayCall = (fieldRef: number) => {
    tick.push(
      ...aLoad(0),
      0xb4, (fieldRef >> 8) & 0xff, fieldRef & 0xff,
      0xb8, (applyArrayCall >> 8) & 0xff, applyArrayCall & 0xff
    );
  };
  appendArrayCall(playerItemsA);
  appendArrayCall(playerItemsB);
  appendArrayCall(playerItemsC);
  tick.push(
    ...aLoad(0),
    0xb4, (playerItems2D >> 8) & 0xff, playerItems2D & 0xff,
    0xb8, (apply2DCall >> 8) & 0xff, apply2DCall & 0xff
  );
  const tickTime = tick.length;
  patchBranch(tick, tickNull, tickTime);
  tick.push(
    0xb8, (currentTimeMillis >> 8) & 0xff, currentTimeMillis & 0xff,
    0xad // lreturn
  );

  // sleepAndTick(long ms): fallback hook for game builds whose render loop no
  // longer calls System.currentTimeMillis() directly. Preserve Thread.sleep(J)V
  // semantics, then execute the exact same ItemOption tick and discard its time.
  // Because the caller originally invokes Thread.sleep with the same descriptor,
  // retargeting that call does not change caller code length or stack shape.
  const sleepAndTick: number[] = [
    0x1e, // lload_0
    0xb8, (threadSleep >> 8) & 0xff, threadSleep & 0xff,
    0xb8, (tickCall >> 8) & 0xff, tickCall & 0xff,
    0x58, // pop2 (discard long returned by tick)
    0xb1, // return
  ];

  // applyArray(a.ab[]): null-safe array walk.
  const applyArray: number[] = [...aLoad(0)];
  const arrayNull = applyArray.length;
  applyArray.push(0xc6, 0, 0);
  applyArray.push(0x03, ...iStore(1)); // int i = 0
  const arrayLoop = applyArray.length;
  applyArray.push(...iLoad(1), ...aLoad(0), 0xbe); // i, arr.length
  const arrayDone = applyArray.length;
  applyArray.push(0xa2, 0, 0); // if_icmpge end
  applyArray.push(
    ...aLoad(0), ...iLoad(1), 0x32, // aaload
    0xb8, (applyItemCall >> 8) & 0xff, applyItemCall & 0xff,
    0x84, 0x01, 0x01 // iinc 1,1
  );
  const arrayBack = applyArray.length;
  applyArray.push(0xa7, 0, 0);
  const arrayEnd = applyArray.length;
  applyArray.push(0xb1);
  patchBranch(applyArray, arrayNull, arrayEnd);
  patchBranch(applyArray, arrayDone, arrayEnd);
  patchBranch(applyArray, arrayBack, arrayLoop);

  // apply2D(a.ab[][]): walk each inventory/equipment row.
  const apply2D: number[] = [...aLoad(0)];
  const twoDNull = apply2D.length;
  apply2D.push(0xc6, 0, 0);
  apply2D.push(0x03, ...iStore(1));
  const twoDLoop = apply2D.length;
  apply2D.push(...iLoad(1), ...aLoad(0), 0xbe);
  const twoDDone = apply2D.length;
  apply2D.push(0xa2, 0, 0);
  apply2D.push(
    ...aLoad(0), ...iLoad(1), 0x32,
    0xb8, (applyArrayCall >> 8) & 0xff, applyArrayCall & 0xff,
    0x84, 0x01, 0x01
  );
  const twoDBack = apply2D.length;
  apply2D.push(0xa7, 0, 0);
  const twoDEnd = apply2D.length;
  apply2D.push(0xb1);
  patchBranch(apply2D, twoDNull, twoDEnd);
  patchBranch(apply2D, twoDDone, twoDEnd);
  patchBranch(apply2D, twoDBack, twoDLoop);

  // Group options by item ID so each item does only one ID comparison chain.
  const grouped = new Map<number, ItemOptionRuntimeRule[]>();
  for (const rule of rules) {
    const list = grouped.get(rule.itemId) ?? [];
    list.push(rule);
    grouped.set(rule.itemId, list);
  }

  const applyItem: number[] = [...aLoad(0)];
  const itemNull = applyItem.length;
  applyItem.push(0xc6, 0, 0);
  applyItem.push(...aLoad(0), 0xb4, (itemTemplateRef >> 8) & 0xff, itemTemplateRef & 0xff);
  const templateNull = applyItem.length;
  applyItem.push(0xc6, 0, 0);
  const itemGotoEnd: number[] = [];

  for (const [itemId, itemRules] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    applyItem.push(
      ...aLoad(0),
      0xb4, (itemTemplateRef >> 8) & 0xff, itemTemplateRef & 0xff,
      0xb4, (templateIdRef >> 8) & 0xff, templateIdRef & 0xff,
      ...helperIntPush(cp, itemId)
    );
    const mismatch = applyItem.length;
    applyItem.push(0xa0, 0, 0); // if_icmpne next item

    for (const rule of itemRules) {
      applyItem.push(
        ...aLoad(0),
        ...helperIntPush(cp, rule.optionId),
        ...helperIntPush(cp, rule.param),
        0xb8, (setOptionCall >> 8) & 0xff, setOptionCall & 0xff
      );
    }
    const jumpEnd = applyItem.length;
    applyItem.push(0xa7, 0, 0);
    itemGotoEnd.push(jumpEnd);
    const nextItem = applyItem.length;
    patchBranch(applyItem, mismatch, nextItem);
  }
  const itemEnd = applyItem.length;
  applyItem.push(0xb1);
  patchBranch(applyItem, itemNull, itemEnd);
  patchBranch(applyItem, templateNull, itemEnd);
  for (const pos of itemGotoEnd) patchBranch(applyItem, pos, itemEnd);

  // setOption(item, optionId, param): update an existing a.H or append one.
  // Locals: 0 item, 1 optionId, 2 param, 3 old[], 4 i, 5 current, 6 len, 7 next[].
  const setOption: number[] = [...aLoad(0)];
  const setItemNull = setOption.length;
  setOption.push(0xc6, 0, 0);
  setOption.push(
    ...aLoad(0),
    0xb4, (itemOptionsRef >> 8) & 0xff, itemOptionsRef & 0xff,
    ...aStore(3),
    ...aLoad(3)
  );
  const oldNullToAppend = setOption.length;
  setOption.push(0xc6, 0, 0);
  setOption.push(0x03, ...iStore(4));
  const optionLoop = setOption.length;
  setOption.push(...iLoad(4), ...aLoad(3), 0xbe);
  const exhausted = setOption.length;
  setOption.push(0xa2, 0, 0);
  setOption.push(...aLoad(3), ...iLoad(4), 0x32, ...aStore(5), ...aLoad(5));
  const currentNull = setOption.length;
  setOption.push(0xc6, 0, 0);
  setOption.push(
    ...aLoad(5),
    0xb4, (optionTemplateRef >> 8) & 0xff, optionTemplateRef & 0xff
  );
  const currentTemplateNull = setOption.length;
  setOption.push(0xc6, 0, 0);
  setOption.push(
    ...aLoad(5),
    0xb4, (optionTemplateRef >> 8) & 0xff, optionTemplateRef & 0xff,
    0xb4, (optionIdRef >> 8) & 0xff, optionIdRef & 0xff,
    ...iLoad(1)
  );
  const notSameOption = setOption.length;
  setOption.push(0xa0, 0, 0);
  setOption.push(
    ...aLoad(5), ...iLoad(2),
    0xb5, (optionParamRef >> 8) & 0xff, optionParamRef & 0xff,
    0xb1
  );
  const optionNext = setOption.length;
  setOption.push(0x84, 0x04, 0x01);
  const optionBack = setOption.length;
  setOption.push(0xa7, 0, 0);
  const appendStart = setOption.length;
  patchBranch(setOption, oldNullToAppend, appendStart);
  patchBranch(setOption, exhausted, appendStart);
  patchBranch(setOption, currentNull, optionNext);
  patchBranch(setOption, currentTemplateNull, optionNext);
  patchBranch(setOption, notSameOption, optionNext);
  patchBranch(setOption, optionBack, optionLoop);

  // Appending a missing option eventually calls a.H(int,int), which indexes
  // a/am.a:[La/bU;. During very early startup that table can still be null.
  // Guard it here; tick() runs again next frame after game data finishes loading.
  setOption.push(
    0xb8, (optionManagerGetter >> 8) & 0xff, optionManagerGetter & 0xff,
    0xb4, (optionTemplatesRef >> 8) & 0xff, optionTemplatesRef & 0xff,
    ...aStore(8),
    ...aLoad(8)
  );
  const templatesNull = setOption.length;
  setOption.push(0xc6, 0, 0);
  setOption.push(...iLoad(1), ...aLoad(8), 0xbe);
  const optionOutOfRange = setOption.length;
  setOption.push(0xa2, 0, 0); // optionId >= templates.length -> return

  // len = old == null ? 0 : old.length
  setOption.push(...aLoad(3));
  const oldNullLen = setOption.length;
  setOption.push(0xc6, 0, 0);
  setOption.push(...aLoad(3), 0xbe, ...iStore(6));
  const lenGotoAlloc = setOption.length;
  setOption.push(0xa7, 0, 0);
  const lenZero = setOption.length;
  setOption.push(0x03, ...iStore(6));
  const alloc = setOption.length;
  patchBranch(setOption, oldNullLen, lenZero);
  patchBranch(setOption, lenGotoAlloc, alloc);

  setOption.push(
    ...iLoad(6), 0x04, 0x60, // len + 1
    0xbd, (optionClass >> 8) & 0xff, optionClass & 0xff,
    ...aStore(7),
    ...iLoad(6)
  );
  const noCopy = setOption.length;
  setOption.push(0x9e, 0, 0); // ifle
  setOption.push(
    ...aLoad(3), 0x03,
    ...aLoad(7), 0x03,
    ...iLoad(6),
    0xb8, (arrayCopy >> 8) & 0xff, arrayCopy & 0xff
  );
  const afterCopy = setOption.length;
  patchBranch(setOption, noCopy, afterCopy);

  setOption.push(
    ...aLoad(7), ...iLoad(6),
    0xbb, (optionClass >> 8) & 0xff, optionClass & 0xff,
    0x59,
    ...iLoad(1), ...iLoad(2),
    0xb7, (optionCtor >> 8) & 0xff, optionCtor & 0xff,
    0x53, // aastore
    ...aLoad(0), ...aLoad(7),
    0xb5, (itemOptionsRef >> 8) & 0xff, itemOptionsRef & 0xff
  );
  const setEnd = setOption.length;
  setOption.push(0xb1);
  patchBranch(setOption, setItemNull, setEnd);
  patchBranch(setOption, templatesNull, setEnd);
  patchBranch(setOption, optionOutOfRange, setEnd);


  // cleanAndApply(a/a/w): exact-descriptor replacement for the first call in
  // a/a/w.fU(). Preserve DBFix.cleanIfDragon(item) semantics, then apply our
  // options before fU continues into its normal intrinsic-option normalization.
  const cleanAndApply: number[] = [
    ...aLoad(0),
    0xb8, (dbFixCleanCall >> 8) & 0xff, dbFixCleanCall & 0xff,
  ];
  const notClean = cleanAndApply.length;
  cleanAndApply.push(0x99, 0, 0); // ifeq -> apply rules
  cleanAndApply.push(0x04, 0xac); // iconst_1; ireturn
  const applyGameplayRules = cleanAndApply.length;
  patchBranch(cleanAndApply, notClean, applyGameplayRules);
  cleanAndApply.push(
    ...aLoad(0),
    0xb8, (applyServerItemCall >> 8) & 0xff, applyServerItemCall & 0xff,
    0x03,
    0xac
  );

  // applyServerItem(a/a/w): match gameplay item by template ID cG and write
  // the configured options. This is what makes '+200% sức đánh' affect a/a/l.h().
  const applyServerItem: number[] = [...aLoad(0)];
  const serverItemNull = applyServerItem.length;
  applyServerItem.push(0xc6, 0, 0);
  const serverItemGotoEnd: number[] = [];
  for (const [itemId, itemRules] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    applyServerItem.push(
      ...aLoad(0),
      0xb4, (serverItemIdRef >> 8) & 0xff, serverItemIdRef & 0xff,
      ...helperIntPush(cp, itemId)
    );
    const mismatch = applyServerItem.length;
    applyServerItem.push(0xa0, 0, 0);
    for (const rule of itemRules) {
      applyServerItem.push(
        ...aLoad(0),
        ...helperIntPush(cp, rule.optionId),
        ...helperIntPush(cp, rule.param),
        0xb8, (setServerOptionCall >> 8) & 0xff, setServerOptionCall & 0xff
      );
    }
    const jumpEnd = applyServerItem.length;
    applyServerItem.push(0xa7, 0, 0);
    serverItemGotoEnd.push(jumpEnd);
    const nextItem = applyServerItem.length;
    patchBranch(applyServerItem, mismatch, nextItem);
  }
  const serverItemEnd = applyServerItem.length;
  applyServerItem.push(0xb1);
  patchBranch(applyServerItem, serverItemNull, serverItemEnd);
  for (const pos of serverItemGotoEnd) patchBranch(applyServerItem, pos, serverItemEnd);

  // setServerOption(a/a/w, optionId, param): replace an existing option in cE/cF
  // or append through the game's own v(II). Never call fU() here (recursion).
  const setServerOption: number[] = [...aLoad(0)];
  const serverSetNull = setServerOption.length;
  setServerOption.push(0xc6, 0, 0);
  setServerOption.push(0x03, ...iStore(3));
  const serverSetLoop = setServerOption.length;
  setServerOption.push(
    ...iLoad(3),
    ...aLoad(0),
    0xb4, (serverOptionCountRef >> 8) & 0xff, serverOptionCountRef & 0xff
  );
  const serverSetAppend = setServerOption.length;
  setServerOption.push(0xa2, 0, 0);
  setServerOption.push(
    ...aLoad(0),
    0xb4, (serverOptionIdsRef >> 8) & 0xff, serverOptionIdsRef & 0xff,
    ...iLoad(3),
    0x2e,
    ...iLoad(1)
  );
  const serverSetNext = setServerOption.length;
  setServerOption.push(0xa0, 0, 0);
  setServerOption.push(
    ...aLoad(0),
    0xb4, (serverOptionParamsRef >> 8) & 0xff, serverOptionParamsRef & 0xff,
    ...iLoad(3),
    ...iLoad(2),
    0x4f,
    0xb1
  );
  const serverSetInc = setServerOption.length;
  setServerOption.push(0x84, 0x03, 0x01);
  const serverSetBack = setServerOption.length;
  setServerOption.push(0xa7, 0, 0);
  const serverAppendStart = setServerOption.length;
  patchBranch(setServerOption, serverSetAppend, serverAppendStart);
  patchBranch(setServerOption, serverSetNext, serverSetInc);
  patchBranch(setServerOption, serverSetBack, serverSetLoop);
  setServerOption.push(
    ...aLoad(0),
    ...iLoad(1),
    ...iLoad(2),
    0xb6, (serverAppendOptionCall >> 8) & 0xff, serverAppendOptionCall & 0xff
  );
  const serverSetEnd = setServerOption.length;
  setServerOption.push(0xb1);
  patchBranch(setServerOption, serverSetNull, serverSetEnd);

  for (const [name, code] of [
    ['tick', tick],
    ['sleepAndTick', sleepAndTick],
    ['applyArray', applyArray],
    ['apply2D', apply2D],
    ['applyItem', applyItem],
    ['setOption', setOption],
    ['cleanAndApply', cleanAndApply],
    ['applyServerItem', applyServerItem],
    ['setServerOption', setServerOption],
  ] as Array<[string, number[]]>) {
    if (code.length > 65535) {
      throw new Error(`PanelItemOptionRuntime.${name} dài ${code.length} byte, vượt JVM code_length.`);
    }
  }

  // Serialize CP after all helperIntPush() calls have registered large integers.
  const methodSpecs: HelperMethodSpec[] = [
    { accessFlags: 0x0009, nameIndex: tickName, descriptorIndex: tickDesc, maxStack: 2, maxLocals: 1, code: tick },
    { accessFlags: 0x0009, nameIndex: sleepAndTickName, descriptorIndex: sleepAndTickDesc, maxStack: 2, maxLocals: 2, code: sleepAndTick },
    { accessFlags: 0x000a, nameIndex: applyArrayName, descriptorIndex: applyArrayDesc, maxStack: 2, maxLocals: 2, code: applyArray },
    { accessFlags: 0x000a, nameIndex: apply2DName, descriptorIndex: apply2DDesc, maxStack: 2, maxLocals: 2, code: apply2D },
    { accessFlags: 0x000a, nameIndex: applyItemName, descriptorIndex: applyItemDesc, maxStack: 3, maxLocals: 1, code: applyItem },
    { accessFlags: 0x000a, nameIndex: setOptionName, descriptorIndex: setOptionDesc, maxStack: 6, maxLocals: 9, code: setOption },
    { accessFlags: 0x0009, nameIndex: cleanAndApplyName, descriptorIndex: cleanAndApplyDesc, maxStack: 1, maxLocals: 1, code: cleanAndApply },
    { accessFlags: 0x000a, nameIndex: applyServerItemName, descriptorIndex: applyServerItemDesc, maxStack: 3, maxLocals: 1, code: applyServerItem },
    { accessFlags: 0x000a, nameIndex: setServerOptionName, descriptorIndex: setServerOptionDesc, maxStack: 3, maxLocals: 4, code: setServerOption },
  ];
  const methods = methodSpecs.map((spec) => encodeSimpleHelperMethod(codeName, spec));
  const cpBytes = cp.serialize();
  const methodsLength = methods.reduce((sum, method) => sum + method.length, 0);
  const total = 10 + cpBytes.length + 12 + methodsLength + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  writeU2(view, 4, targetClass.minorVersion);
  writeU2(view, 6, targetClass.majorVersion);
  writeU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor); cursor += cpBytes.length;
  writeU2(view, cursor, 0x0031); cursor += 2; // public final super
  writeU2(view, cursor, thisClass); cursor += 2;
  writeU2(view, cursor, superClass); cursor += 2;
  writeU2(view, cursor, 0); cursor += 2; // interfaces
  writeU2(view, cursor, 0); cursor += 2; // fields
  writeU2(view, cursor, methods.length); cursor += 2;
  for (const method of methods) {
    out.set(method, cursor);
    cursor += method.length;
  }
  writeU2(view, cursor, 0); // class attrs

  const buffer = toArrayBuffer(out);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('PanelItemOptionRuntime.class tự sinh không parse VALID.');
  }
  return buffer;
}

function appendItemOptionHelperMethodRef(
  target: MutableClass,
  name: string,
  descriptor: string
): number {
  const helperUtf8 = appendCpEntry(target, rawUtf8(ITEM_OPTION_HELPER_INTERNAL_NAME));
  const helperClass = appendCpEntry(target, rawU2Entry(TAG_CLASS, helperUtf8));
  const nameUtf8 = appendCpEntry(target, rawUtf8(name));
  const descUtf8 = appendCpEntry(target, rawUtf8(descriptor));
  const nat = appendCpEntry(target, rawU2U2Entry(TAG_NAME_AND_TYPE, nameUtf8, descUtf8));
  return appendCpEntry(target, rawU2U2Entry(TAG_METHODREF, helperClass, nat));
}

function appendItemOptionBridgeMethodRef(
  target: MutableClass,
  name: string,
  descriptor: string
): number {
  const helperUtf8 = appendCpEntry(target, rawUtf8(ITEM_OPTION_BRIDGE_INTERNAL_NAME));
  const helperClass = appendCpEntry(target, rawU2Entry(TAG_CLASS, helperUtf8));
  const nameUtf8 = appendCpEntry(target, rawUtf8(name));
  const descUtf8 = appendCpEntry(target, rawUtf8(descriptor));
  const nat = appendCpEntry(target, rawU2U2Entry(TAG_NAME_AND_TYPE, nameUtf8, descUtf8));
  return appendCpEntry(target, rawU2U2Entry(TAG_METHODREF, helperClass, nat));
}

/**
 * Same-package bridge used when a/bN.run() has no direct time/sleep call.
 * Retargeting invokevirtual a/bN.cu()V to this invokestatic keeps the caller
 * code length and stack effect unchanged while preserving the original cu().
 */
function buildItemOptionLoopBridge(targetClass: ClassFileInfo): ArrayBuffer {
  const cp = new HelperConstantPool();
  const thisClass = cp.clazz(ITEM_OPTION_BRIDGE_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const codeName = cp.utf8('Code');
  const nameIndex = cp.utf8('cuAndTick');
  const descIndex = cp.utf8('(La/bN;)V');
  const cuRef = cp.methodRef('a/bN', 'cu', '()V');
  const tickRef = cp.methodRef(ITEM_OPTION_HELPER_INTERNAL_NAME, 'tick', '()J');
  const code: number[] = [
    ...aLoad(0),
    0xb6, (cuRef >> 8) & 0xff, cuRef & 0xff,
    0xb8, (tickRef >> 8) & 0xff, tickRef & 0xff,
    0x58,
    0xb1,
  ];
  const method = encodeSimpleHelperMethod(codeName, {
    accessFlags: 0x0009,
    nameIndex,
    descriptorIndex: descIndex,
    maxStack: 2,
    maxLocals: 1,
    code,
  });
  const cpBytes = cp.serialize();
  const total = 10 + cpBytes.length + 12 + method.length + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  writeU2(view, 4, targetClass.minorVersion);
  writeU2(view, 6, targetClass.majorVersion);
  writeU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor); cursor += cpBytes.length;
  writeU2(view, cursor, 0x0031); cursor += 2;
  writeU2(view, cursor, thisClass); cursor += 2;
  writeU2(view, cursor, superClass); cursor += 2;
  writeU2(view, cursor, 0); cursor += 2;
  writeU2(view, cursor, 0); cursor += 2;
  writeU2(view, cursor, 1); cursor += 2;
  out.set(method, cursor); cursor += method.length;
  writeU2(view, cursor, 0);

  const buffer = toArrayBuffer(out);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('PanelItemOptionBridge.class tự sinh không parse VALID.');
  }
  return buffer;
}

interface RawInvokeRef {
  owner: string;
  name: string;
  descriptor: string;
}

/**
 * Resolve an invoke target directly from raw constant-pool bytes.
 * Some obfuscated CLDC builds decode the invoke instruction but do not attach
 * JvmInstruction.methodRef metadata. The writer must not treat that as "no hook".
 */
function resolveRawInvokeRef(
  target: MutableClass,
  absoluteOpcodeOffset: number
): RawInvokeRef | null {
  const opcode = target.bytes[absoluteOpcodeOffset];
  if (opcode !== 0xb6 && opcode !== 0xb7 && opcode !== 0xb8 && opcode !== 0xb9) {
    return null;
  }
  if (absoluteOpcodeOffset + 2 >= target.bytes.length) return null;

  const cpIndex =
    (target.bytes[absoluteOpcodeOffset + 1] << 8) |
    target.bytes[absoluteOpcodeOffset + 2];
  const methodEntry = target.layout.constantPool[cpIndex];
  if (!methodEntry ||
      (methodEntry.tag !== TAG_METHODREF && methodEntry.tag !== TAG_INTERFACE_METHODREF)) {
    return null;
  }

  const view = new DataView(
    target.bytes.buffer,
    target.bytes.byteOffset,
    target.bytes.byteLength
  );
  const classIndex = readU2(view, methodEntry.payloadOffset);
  const ntIndex = readU2(view, methodEntry.payloadOffset + 2);
  const classEntry = target.layout.constantPool[classIndex];
  const ntEntry = target.layout.constantPool[ntIndex];
  if (!classEntry || classEntry.tag !== TAG_CLASS ||
      !ntEntry || ntEntry.tag !== TAG_NAME_AND_TYPE) {
    return null;
  }

  const ownerNameIndex = readU2(view, classEntry.payloadOffset);
  const nameIndex = readU2(view, ntEntry.payloadOffset);
  const descriptorIndex = readU2(view, ntEntry.payloadOffset + 2);
  const owner = target.layout.utf8.get(ownerNameIndex) ?? '';
  const name = target.layout.utf8.get(nameIndex) ?? '';
  const descriptor = target.layout.utf8.get(descriptorIndex) ?? '';
  if (!owner || !name || !descriptor) return null;
  return { owner, name, descriptor };
}

function findRawInvokeOffsets(
  target: MutableClass,
  methodLayout: MethodLayout,
  matcher: (ref: RawInvokeRef, opcode: number) => boolean
): number[] {
  const offsets: number[] = [];
  const last = Math.max(0, methodLayout.codeLength - 3);

  // Deliberately scan the raw Code byte range instead of trusting
  // JvmInstruction.methodRef / decoded instruction offsets. Some obfuscated
  // CLDC classes expose valid invoke bytecode but the higher-level decoder can
  // attach stale/missing MethodRef metadata. Requiring the 16-bit operand to
  // resolve to an exact CONSTANT_Methodref makes accidental operand-byte
  // matches extremely unlikely.
  for (let offset = 0; offset <= last; offset++) {
    const absolute = methodLayout.codeStart + offset;
    const opcode = target.bytes[absolute];
    if (opcode !== 0xb6 && opcode !== 0xb7 && opcode !== 0xb8 && opcode !== 0xb9) {
      continue;
    }
    const ref = resolveRawInvokeRef(target, absolute);
    if (ref && matcher(ref, opcode)) offsets.push(offset);
  }
  return offsets;
}

function rawInvokeMatchesAt(
  target: MutableClass,
  methodLayout: MethodLayout,
  offset: number,
  owner: string,
  name: string,
  descriptor: string,
  opcode?: number
): boolean {
  const absolute = methodLayout.codeStart + offset;
  if (absolute < methodLayout.codeStart || absolute + 2 >= methodLayout.codeEnd) return false;
  if (opcode !== undefined && target.bytes[absolute] !== opcode) return false;
  const ref = resolveRawInvokeRef(target, absolute);
  return Boolean(
    ref &&
      ref.owner === owner &&
      ref.name === name &&
      ref.descriptor === descriptor
  );
}



/**
 * Hook the actual gameplay stat item path. a/a/l.a(H, statKind) calls fU() on
 * each equipped a/a/w before reading cE/cF. Retarget the existing
 * DBFix.cleanIfDragon(a/a/w)Z call at the start of fU() to our same-descriptor
 * cleanAndApply(a/a/w)Z wrapper. No instruction resize and no stack change.
 */
function patchItemOptionServerStatHook(buffer: ArrayBuffer): ArrayBuffer {
  const initialParsed = parseClassFile(buffer);
  if (initialParsed.status !== 'valid' || initialParsed.remainingBytes !== 0) {
    throw new Error('a/a/w.class không parse VALID trước ItemOption gameplay writer.');
  }

  const target: MutableClass = {
    path: 'a/a/w.class',
    bytes: new Uint8Array(buffer.slice(0)),
    layout: parseRawClassLayout(buffer),
    classInfo: initialParsed,
  };
  const helperRef = appendItemOptionHelperMethodRef(target, 'cleanAndApply', '(La/a/w;)Z');
  refreshMutable(target);

  const fULayout = target.layout.methods.find(
    (method) => method.name === 'fU' && method.descriptor === '()V'
  );
  if (!fULayout) {
    throw new Error('Không tìm thấy a/a/w.fU()V để gắn gameplay ItemOption writer.');
  }

  const existing = findRawInvokeOffsets(
    target,
    fULayout,
    (ref, opcode) =>
      opcode === 0xb8 &&
      ref.owner === ITEM_OPTION_HELPER_INTERNAL_NAME &&
      ref.name === 'cleanAndApply' &&
      ref.descriptor === '(La/a/w;)Z'
  );

  let hookOffset: number;
  if (existing.length > 0) {
    hookOffset = existing[0];
  } else {
    const original = findRawInvokeOffsets(
      target,
      fULayout,
      (ref, opcode) =>
        opcode === 0xb8 &&
        ref.owner === 'patch/DBFix' &&
        ref.name === 'cleanIfDragon' &&
        ref.descriptor === '(La/a/w;)Z'
    );
    if (original.length === 0) {
      throw new Error('Không tìm thấy DBFix.cleanIfDragon(La/a/w;)Z trong a/a/w.fU().');
    }
    hookOffset = original[0];
    const absolute = fULayout.codeStart + hookOffset;
    target.bytes[absolute + 1] = (helperRef >> 8) & 0xff;
    target.bytes[absolute + 2] = helperRef & 0xff;
  }

  refreshMutable(target);
  const verifyLayout = target.layout.methods.find(
    (method) => method.name === 'fU' && method.descriptor === '()V'
  );
  if (
    !verifyLayout ||
    !rawInvokeMatchesAt(
      target,
      verifyLayout,
      hookOffset,
      ITEM_OPTION_HELPER_INTERNAL_NAME,
      'cleanAndApply',
      '(La/a/w;)Z',
      0xb8
    )
  ) {
    throw new Error('Không verify được ItemOption gameplay hook trong a/a/w.fU().');
  }

  const classBytes = toArrayBuffer(target.bytes);
  const finalParsed = parseClassFile(classBytes);
  if (finalParsed.status !== 'valid' || finalParsed.remainingBytes !== 0) {
    throw new Error('a/a/w.class không parse VALID sau ItemOption gameplay hook.');
  }
  return classBytes;
}

/**
 * Hook the render/game loop without resizing its bytecode.
 * Preferred path: currentTimeMillis()J -> tick()J (same descriptor).
 * Fallback path: every Thread.sleep(J)V -> sleepAndTick(J)V (same descriptor).
 * The fallback supports newer JAR builds where a/bN.run() no longer references
 * System.currentTimeMillis directly.
 */
function patchItemOptionTickHook(
  buffer: ArrayBuffer,
  rules: ItemOptionRuntimeRule[]
): { classBytes: ArrayBuffer; helperBytes: ArrayBuffer; bridgeBytes: ArrayBuffer; ruleCount: number } {
  const initialParsed = parseClassFile(buffer);
  if (initialParsed.status !== 'valid' || initialParsed.remainingBytes !== 0) {
    throw new Error('a/bN.class không parse VALID trước ItemOption writer.');
  }

  const target: MutableClass = {
    path: 'a/bN.class',
    bytes: new Uint8Array(buffer.slice(0)),
    layout: parseRawClassLayout(buffer),
    classInfo: initialParsed,
  };
  const tickRef = appendItemOptionHelperMethodRef(target, 'tick', '()J');
  const sleepAndTickRef = appendItemOptionHelperMethodRef(target, 'sleepAndTick', '(J)V');
  const cuAndTickRef = appendItemOptionBridgeMethodRef(target, 'cuAndTick', '(La/bN;)V');
  refreshMutable(target);

  const runInfo = target.classInfo.methods.find(
    (method) => method.name === 'run' && method.descriptor === '()V'
  );
  const runLayout = target.layout.methods.find(
    (method) => method.name === 'run' && method.descriptor === '()V'
  );
  if (!runInfo?.code?.instructions || !runLayout) {
    throw new Error('Không tìm thấy a/bN.run()V hoặc bytecode instructions.');
  }

  let hookMode: 'TIME' | 'SLEEP' | 'CU';
  let hookOffsets: number[];

  // First detect an already-installed hook so rebuilding a workspace JAR is
  // idempotent and does not add a second tick path.
  const existingTimeHooks = findRawInvokeOffsets(
    target,
    runLayout,
    (ref, opcode) =>
      opcode === 0xb8 &&
      ref.owner === ITEM_OPTION_HELPER_INTERNAL_NAME &&
      ref.name === 'tick' &&
      ref.descriptor === '()J'
  );
  const existingSleepHooks = findRawInvokeOffsets(
    target,
    runLayout,
    (ref, opcode) =>
      opcode === 0xb8 &&
      ref.owner === ITEM_OPTION_HELPER_INTERNAL_NAME &&
      ref.name === 'sleepAndTick' &&
      ref.descriptor === '(J)V'
  );
  const existingCuHooks = findRawInvokeOffsets(
    target,
    runLayout,
    (ref, opcode) =>
      opcode === 0xb8 &&
      ref.owner === ITEM_OPTION_BRIDGE_INTERNAL_NAME &&
      ref.name === 'cuAndTick' &&
      ref.descriptor === '(La/bN;)V'
  );

  if (existingTimeHooks.length > 0) {
    hookMode = 'TIME';
    hookOffsets = existingTimeHooks;
  } else if (existingCuHooks.length > 0) {
    hookMode = 'CU';
    hookOffsets = existingCuHooks;
  } else if (existingSleepHooks.length > 0) {
    hookMode = 'SLEEP';
    hookOffsets = existingSleepHooks;
  } else {
    // Do a true raw Code scan. Do not consult JvmInstruction.methodRef at all.
    // NgocRongChay 1.9.6f has the exact calls below in a/bN.run(), but its
    // higher-level decoder metadata can fail to expose them.
    const timeCalls = findRawInvokeOffsets(
      target,
      runLayout,
      (ref, opcode) =>
        opcode === 0xb8 &&
        ref.owner === 'java/lang/System' &&
        ref.name === 'currentTimeMillis' &&
        ref.descriptor === '()J'
    );

    if (timeCalls.length > 0) {
      const offset = timeCalls[0];
      const absolute = runLayout.codeStart + offset;
      target.bytes[absolute + 1] = (tickRef >> 8) & 0xff;
      target.bytes[absolute + 2] = tickRef & 0xff;
      hookMode = 'TIME';
      hookOffsets = [offset];
    } else {
      const cuCalls = findRawInvokeOffsets(
        target,
        runLayout,
        (ref, opcode) =>
          opcode === 0xb6 &&
          ref.owner === 'a/bN' &&
          ref.name === 'cu' &&
          ref.descriptor === '()V'
      );

      if (cuCalls.length > 0) {
        const offset = cuCalls[0];
        const absolute = runLayout.codeStart + offset;
        target.bytes[absolute] = 0xb8;
        target.bytes[absolute + 1] = (cuAndTickRef >> 8) & 0xff;
        target.bytes[absolute + 2] = cuAndTickRef & 0xff;
        hookMode = 'CU';
        hookOffsets = [offset];
      } else {
        const sleepCalls = findRawInvokeOffsets(
          target,
          runLayout,
          (ref, opcode) =>
            opcode === 0xb8 &&
            ref.owner === 'java/lang/Thread' &&
            ref.name === 'sleep' &&
            ref.descriptor === '(J)V'
        );

        if (sleepCalls.length === 0) {
          throw new Error(
            'Không tìm thấy hook vòng lặp trong raw Code của a/bN.run() (time/cu/sleep).'
          );
        }

        hookOffsets = [];
        for (const offset of sleepCalls) {
          const absolute = runLayout.codeStart + offset;
          target.bytes[absolute + 1] = (sleepAndTickRef >> 8) & 0xff;
          target.bytes[absolute + 2] = sleepAndTickRef & 0xff;
          hookOffsets.push(offset);
        }
        hookMode = 'SLEEP';
      }
    }
  }


  refreshMutable(target);

  const verifyRunLayout = target.layout.methods.find(
    (method) => method.name === 'run' && method.descriptor === '()V'
  );
  if (!verifyRunLayout) {
    throw new Error('Không tìm thấy a/bN.run()V khi verify ItemOption hook.');
  }

  let verifiedCount = 0;
  for (const offset of hookOffsets) {
    const ok =
      hookMode === 'TIME'
        ? rawInvokeMatchesAt(
            target,
            verifyRunLayout,
            offset,
            ITEM_OPTION_HELPER_INTERNAL_NAME,
            'tick',
            '()J',
            0xb8
          )
        : hookMode === 'SLEEP'
        ? rawInvokeMatchesAt(
            target,
            verifyRunLayout,
            offset,
            ITEM_OPTION_HELPER_INTERNAL_NAME,
            'sleepAndTick',
            '(J)V',
            0xb8
          )
        : rawInvokeMatchesAt(
            target,
            verifyRunLayout,
            offset,
            ITEM_OPTION_BRIDGE_INTERNAL_NAME,
            'cuAndTick',
            '(La/bN;)V',
            0xb8
          );
    if (ok) verifiedCount++;
  }
  if (verifiedCount !== hookOffsets.length) {
    throw new Error(
      `Không verify đủ ItemOption ${hookMode.toLowerCase()} hook bằng raw Code: ${verifiedCount}/${hookOffsets.length}.`
    );
  }



  const classBytes = toArrayBuffer(target.bytes);
  const finalParsed = parseClassFile(classBytes);
  if (finalParsed.status !== 'valid' || finalParsed.remainingBytes !== 0) {
    throw new Error('a/bN.class không parse VALID sau ItemOption hook.');
  }

  return {
    classBytes,
    helperBytes: buildItemOptionRuntimeHelper(finalParsed, rules),
    bridgeBytes: buildItemOptionLoopBridge(finalParsed),
    ruleCount: rules.length,
  };
}

type GenericMobDropInputRule = GenericMobDropRule & {
  /** Optional runtime range used by MobPanel rules. Mechanics rules keep min=max=quantity. */
  quantityMin?: number;
  quantityMax?: number;
};

type NormalizedGenericMobDropRule = GenericMobDropRule & {
  quantityMin: number;
  quantityMax: number;
};

function normalizeGenericMobDropRules(
  rules: GenericMobDropInputRule[]
): NormalizedGenericMobDropRule[] {
  if (!Array.isArray(rules)) return [];
  if (rules.length > 100) {
    throw new Error('Generic Mob Drop hiện hỗ trợ tối đa 100 rule trong một JAR.');
  }
  return rules.map((rule, index) => {
    const itemId = Math.round(Number(rule.itemId));
    const quantityMin = Math.round(Number(rule.quantityMin ?? rule.quantity));
    const quantityMax = Math.round(Number(rule.quantityMax ?? rule.quantity));
    const chancePercent = Number(rule.chancePercent);
    const mobType = rule.mobType === null || rule.mobType === undefined
      ? null
      : Math.round(Number(rule.mobType));
    const mapId = rule.mapId === null || rule.mapId === undefined
      ? null
      : Math.round(Number(rule.mapId));

    if (!Number.isInteger(itemId) || itemId < 0 || itemId > JAVA_INT_MAX) {
      throw new Error(`Drop custom #${index + 1}: itemId ${rule.itemId} không hợp lệ.`);
    }
    if (!Number.isInteger(quantityMin) || quantityMin < 1 || quantityMin > JAVA_INT_MAX) {
      throw new Error(`Drop custom #${index + 1}: SL min ${rule.quantityMin ?? rule.quantity} vượt Java int32.`);
    }
    if (
      !Number.isInteger(quantityMax) ||
      quantityMax < quantityMin ||
      quantityMax > JAVA_INT_MAX
    ) {
      throw new Error(
        `Drop custom #${index + 1}: SL max ${rule.quantityMax ?? rule.quantity} phải nằm trong ${quantityMin}..${JAVA_INT_MAX}.`
      );
    }
    if (!Number.isFinite(chancePercent) || chancePercent < 0 || chancePercent > 100) {
      throw new Error(`Drop custom #${index + 1}: chance ${rule.chancePercent}% phải nằm trong 0..100.`);
    }
    for (const [label, value] of [['mobType', mobType], ['mapId', mapId]] as const) {
      if (value !== null && (!Number.isInteger(value) || value < JAVA_INT_MIN || value > JAVA_INT_MAX)) {
        throw new Error(`Drop custom #${index + 1}: ${label} ${value} vượt Java int32.`);
      }
    }

    return {
      id: String(rule.id || `custom-drop-${index}`),
      enabled: rule.enabled !== false,
      itemId,
      // Preserve the legacy fixed-quantity field for compatibility/diagnostics.
      quantity: quantityMin,
      quantityMin,
      quantityMax,
      chancePercent: Math.round(chancePercent * 1000) / 1000,
      mobType,
      mapId,
    };
  });
}

/**
 * Runtime helper for user-defined mob drops.
 * a/a/aa.customDrop originally begins with:
 *   aload_0
 *   invokestatic patch/SA.maybeDropLevel1Activation(La/m;)V
 * We retarget that single call to apply(La/m;)V. The helper first calls the
 * original SA method and then evaluates every custom rule. No a/a/aa method is
 * resized, so its CLDC StackMap/branch offsets remain untouched.
 */
function buildGenericMobDropHelper(
  targetClass: ClassFileInfo,
  inputRules: GenericMobDropInputRule[]
): ArrayBuffer {
  const rules = normalizeGenericMobDropRules(inputRules);
  const cp = new HelperConstantPool();
  const thisClass = cp.clazz(GENERIC_DROP_HELPER_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const methodName = cp.utf8('apply');
  const methodDescriptor = cp.utf8('(La/m;)V');
  const codeName = cp.utf8('Code');

  const originalSaRef = cp.methodRef('patch/SA', 'maybeDropLevel1Activation', '(La/m;)V');
  const mobTypeRef = cp.fieldRef('a/m', 'cG', 'I');
  const mapIdRef = cp.fieldRef('a/ba', 'pU', 'I');
  const rngRef = cp.methodRef('a/a/h', 'w', '(I)I');
  const dropRef = cp.methodRef('a/a/h', 'a', '(La/m;II)I');

  const code: number[] = [
    0x2a, // aload_0
    0xb8, (originalSaRef >> 8) & 0xff, originalSaRef & 0xff,
  ];

  const chanceDenominator = 100_000; // 0.001% editor precision without float bytecode

  for (const rule of rules) {
    if (!rule.enabled || rule.chancePercent <= 0) continue;
    const skipBranches: number[] = [];

    if (rule.mobType !== null) {
      code.push(
        0x2a, // aload_0
        0xb4, (mobTypeRef >> 8) & 0xff, mobTypeRef & 0xff,
        ...helperIntPush(cp, rule.mobType)
      );
      const pos = code.length;
      code.push(0xa0, 0, 0); // if_icmpne -> skip rule
      skipBranches.push(pos);
    }

    if (rule.mapId !== null) {
      code.push(
        0xb2, (mapIdRef >> 8) & 0xff, mapIdRef & 0xff,
        ...helperIntPush(cp, rule.mapId)
      );
      const pos = code.length;
      code.push(0xa0, 0, 0); // if_icmpne -> skip rule
      skipBranches.push(pos);
    }

    if (rule.chancePercent < 100) {
      const threshold = Math.max(
        0,
        Math.min(chanceDenominator, Math.round((rule.chancePercent / 100) * chanceDenominator))
      );
      code.push(
        ...helperIntPush(cp, chanceDenominator),
        0xb8, (rngRef >> 8) & 0xff, rngRef & 0xff,
        ...helperIntPush(cp, threshold)
      );
      const pos = code.length;
      code.push(0xa2, 0, 0); // if_icmpge -> skip rule
      skipBranches.push(pos);
    }

    const quantityCode =
      rule.quantityMin === rule.quantityMax
        ? helperIntPush(cp, rule.quantityMin)
        : [
            ...helperIntPush(cp, rule.quantityMin),
            ...helperIntPush(cp, rule.quantityMax - rule.quantityMin + 1),
            0xb8, (rngRef >> 8) & 0xff, rngRef & 0xff,
            0x60, // iadd -> min + w(max-min+1)
          ];

    code.push(
      0x2a, // aload_0
      ...helperIntPush(cp, rule.itemId),
      ...quantityCode,
      0xb8, (dropRef >> 8) & 0xff, dropRef & 0xff,
      0x57 // pop drop slot/result
    );

    const skipTarget = code.length;
    for (const pos of skipBranches) patchBranch(code, pos, skipTarget);
  }

  code.push(0xb1); // return
  if (code.length > 65535) {
    throw new Error(`PanelGenericMobDropRuntime.apply dài ${code.length} byte, vượt JVM code_length.`);
  }

  const cpBytes = cp.serialize();
  const codeBytes = new Uint8Array(code);
  const codeDataLength = 2 + 2 + 4 + codeBytes.length + 2 + 2;
  const codeAttribute = new Uint8Array(6 + codeDataLength);
  const codeView = new DataView(codeAttribute.buffer);
  writeU2(codeView, 0, codeName);
  writeU4(codeView, 2, codeDataLength);
  let c = 6;
  writeU2(codeView, c, 4); // max_stack
  c += 2;
  writeU2(codeView, c, 1); // only mob arg local
  c += 2;
  writeU4(codeView, c, codeBytes.length);
  c += 4;
  codeAttribute.set(codeBytes, c);
  c += codeBytes.length;
  writeU2(codeView, c, 0); // exceptions
  c += 2;
  writeU2(codeView, c, 0); // no nested attrs; class major 47 doesn't require StackMapTable

  const method = new Uint8Array(8 + codeAttribute.length);
  const methodView = new DataView(method.buffer);
  writeU2(methodView, 0, 0x0009); // public static
  writeU2(methodView, 2, methodName);
  writeU2(methodView, 4, methodDescriptor);
  writeU2(methodView, 6, 1);
  method.set(codeAttribute, 8);

  const total = 10 + cpBytes.length + 12 + method.length + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  writeU2(view, 4, targetClass.minorVersion);
  writeU2(view, 6, targetClass.majorVersion);
  writeU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor);
  cursor += cpBytes.length;
  writeU2(view, cursor, 0x0031); cursor += 2; // public final super
  writeU2(view, cursor, thisClass); cursor += 2;
  writeU2(view, cursor, superClass); cursor += 2;
  writeU2(view, cursor, 0); cursor += 2; // interfaces
  writeU2(view, cursor, 0); cursor += 2; // fields
  writeU2(view, cursor, 1); cursor += 2; // methods
  out.set(method, cursor); cursor += method.length;
  writeU2(view, cursor, 0); // class attrs

  const buffer = toArrayBuffer(out);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('PanelGenericMobDropRuntime.class tự sinh không parse VALID.');
  }
  return buffer;
}

function appendGenericDropHelperMethodRef(target: MutableClass): number {
  const helperUtf8 = appendCpEntry(target, rawUtf8(GENERIC_DROP_HELPER_INTERNAL_NAME));
  const helperClass = appendCpEntry(target, rawU2Entry(TAG_CLASS, helperUtf8));
  const nameUtf8 = appendCpEntry(target, rawUtf8('apply'));
  const descUtf8 = appendCpEntry(target, rawUtf8('(La/m;)V'));
  const nat = appendCpEntry(
    target,
    rawU2U2Entry(TAG_NAME_AND_TYPE, nameUtf8, descUtf8)
  );
  return appendCpEntry(
    target,
    rawU2U2Entry(TAG_METHODREF, helperClass, nat)
  );
}

function patchGenericMobDropHook(
  buffer: ArrayBuffer,
  rules: GenericMobDropInputRule[]
): { classBytes: ArrayBuffer; helperBytes: ArrayBuffer; ruleCount: number } {
  const normalizedRules = normalizeGenericMobDropRules(rules);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('a/a/aa.class không parse VALID trước Generic Mob Drop writer.');
  }

  const target: MutableClass = {
    path: 'a/a/aa.class',
    bytes: new Uint8Array(buffer.slice(0)),
    layout: parseRawClassLayout(buffer),
    classInfo: parsed,
  };

  const locateHook = (): MethodLayout => {
    const method = target.layout.methods.find(
      (candidate) => candidate.name === 'customDrop' && candidate.descriptor === '(La/m;)V'
    );
    if (!method) throw new Error('Không tìm thấy a/a/aa.customDrop(La/m;)V.');
    const code = target.bytes.slice(method.codeStart, method.codeEnd);
    if (code.length < 4 || code[0] !== 0x2a || code[1] !== 0xb8) {
      throw new Error('customDrop không còn pattern aload_0 + invokestatic ở đầu method.');
    }
    return method;
  };

  locateHook();
  const helperRef = appendGenericDropHelperMethodRef(target);
  const method = locateHook();
  const absolute = method.codeStart + 1;
  target.bytes[absolute + 1] = (helperRef >> 8) & 0xff;
  target.bytes[absolute + 2] = helperRef & 0xff;
  refreshMutable(target);

  const verifiedMethod = locateHook();
  const verifiedAbsolute = verifiedMethod.codeStart + 1;
  const writtenRef = (target.bytes[verifiedAbsolute + 1] << 8) | target.bytes[verifiedAbsolute + 2];
  if (writtenRef !== helperRef) {
    throw new Error(`Generic Mob Drop Methodref verify sai: #${writtenRef}, expected #${helperRef}.`);
  }

  const classBytes = toArrayBuffer(target.bytes);
  const finalParsed = parseClassFile(classBytes);
  if (finalParsed.status !== 'valid' || finalParsed.remainingBytes !== 0) {
    throw new Error('a/a/aa.class không parse VALID sau Generic Mob Drop hook.');
  }

  return {
    classBytes,
    helperBytes: buildGenericMobDropHelper(finalParsed, normalizedRules),
    ruleCount: normalizedRules.length,
  };
}

function appendGlobalGoldHelperMethodRef(target: MutableClass): number {
  const helperUtf8 = appendCpEntry(target, rawUtf8(GOLD_HELPER_INTERNAL_NAME));
  const helperClass = appendCpEntry(target, rawU2Entry(TAG_CLASS, helperUtf8));
  const nameUtf8 = appendCpEntry(target, rawUtf8('scale'));
  const descUtf8 = appendCpEntry(target, rawUtf8('(La/m;II)I'));
  const nat = appendCpEntry(
    target,
    rawU2U2Entry(TAG_NAME_AND_TYPE, nameUtf8, descUtf8)
  );
  return appendCpEntry(
    target,
    rawU2U2Entry(TAG_METHODREF, helperClass, nat)
  );
}

function rationalMultiplier(value: number): { numerator: number; denominator: number } {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Hệ số vàng ${value} không hợp lệ.`);
  }
  // Any multiplier >= int max has the same representable result for a positive
  // Java-int quantity once we saturate at Integer.MAX_VALUE.
  if (value >= JAVA_INT_MAX) return { numerator: JAVA_INT_MAX, denominator: 1 };

  const gcd = (a: number, b: number): number => {
    a = Math.abs(Math.trunc(a));
    b = Math.abs(Math.trunc(b));
    while (b !== 0) [a, b] = [b, a % b];
    return Math.max(1, a);
  };

  const maxDenominator = Math.max(
    1,
    Math.min(1_000_000, Math.floor(JAVA_INT_MAX / Math.max(1, value)))
  );
  let denominator = maxDenominator;
  let numerator = Math.max(1, Math.round(value * denominator));
  const common = gcd(numerator, denominator);
  numerator = Math.trunc(numerator / common);
  denominator = Math.trunc(denominator / common);

  if (numerator > JAVA_INT_MAX) {
    denominator = Math.max(1, Math.floor(JAVA_INT_MAX / value));
    numerator = Math.max(1, Math.round(value * denominator));
  }
  if (numerator > JAVA_INT_MAX || denominator > JAVA_INT_MAX) {
    throw new Error(`Không biểu diễn được hệ số vàng x${value} bằng Java int ratio.`);
  }
  return { numerator, denominator };
}

/**
 * Gold-only helper for every non-1 global multiplier. It first calls the game's
 * original GTLFix.scaleGoldQty(), then applies the editor multiplier only to
 * item IDs 188..190 and saturates at Integer.MAX_VALUE.
 */
function buildGlobalGoldHelper(
  targetClass: ClassFileInfo,
  multiplier: number
): ArrayBuffer {
  const ratio = rationalMultiplier(multiplier);
  const cp = new HelperConstantPool();
  const thisClass = cp.clazz(GOLD_HELPER_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const methodName = cp.utf8('scale');
  const methodDescriptor = cp.utf8('(La/m;II)I');
  const codeName = cp.utf8('Code');
  const originalScaleRef = cp.methodRef('patch/GTLFix', 'scaleGoldQty', '(La/m;II)I');

  // Important: a/a/h.a(mob,item,qty) is a GENERIC item-drop API. Every item,
  // including eggs/gems/custom drops, eventually reaches the 5-arg wrapper that
  // calls GTLFix.scaleGoldQty. The old panel multiplied the wrapper's qty without
  // checking itemId, therefore a custom egg x1 could become x10.000/x1.000.000.
  // Keep the game's original scale result in local3, and apply the panel's extra
  // multiplier ONLY to the real gold item range 188..190.
  const code: number[] = [
    0x2a, // aload_0 mob
    0x1b, // iload_1 itemId
    0x1c, // iload_2 requested qty
    0xb8, (originalScaleRef >> 8) & 0xff, originalScaleRef & 0xff,
    0x3e, // istore_3 original/game-scaled qty
  ];

  const returnOriginalBranches: number[] = [];

  // if (itemId < 188) return originalQty;
  code.push(0x1b, ...helperIntPush(cp, 188));
  let branchPos = code.length;
  code.push(0xa1, 0, 0); // if_icmplt
  returnOriginalBranches.push(branchPos);

  // if (itemId > 190) return originalQty;
  code.push(0x1b, ...helperIntPush(cp, 190));
  branchPos = code.length;
  code.push(0xa3, 0, 0); // if_icmpgt
  returnOriginalBranches.push(branchPos);

  // Gold only: scale in long arithmetic to avoid int overflow.
  code.push(
    0x1d, // iload_3
    0x85, // i2l
    ...helperIntPush(cp, ratio.numerator),
    0x85, // i2l
    0x69, // lmul
    ...helperIntPush(cp, ratio.denominator),
    0x85, // i2l
    0x6d, // ldiv
    0x37, 0x04 // lstore 4 (locals 4+5)
  );

  // Saturate to Integer.MAX_VALUE.
  code.push(
    0x16, 0x04, // lload 4
    ...helperIntPush(cp, JAVA_INT_MAX),
    0x85, // i2l
    0x94 // lcmp
  );
  const withinIntBranch = code.length;
  code.push(0x9e, 0, 0); // ifle -> return scaled long as int
  code.push(...helperIntPush(cp, JAVA_INT_MAX), 0xac); // ireturn max

  const returnScaledTarget = code.length;
  code.push(0x16, 0x04, 0x88, 0xac); // lload 4; l2i; ireturn

  const returnOriginalTarget = code.length;
  code.push(0x1d, 0xac); // iload_3; ireturn

  patchBranch(code, withinIntBranch, returnScaledTarget);
  for (const pos of returnOriginalBranches) patchBranch(code, pos, returnOriginalTarget);

  const cpBytes = cp.serialize();
  const codeBytes = new Uint8Array(code);
  const codeDataLength = 2 + 2 + 4 + codeBytes.length + 2 + 2;
  const codeAttribute = new Uint8Array(6 + codeDataLength);
  const codeView = new DataView(codeAttribute.buffer);
  writeU2(codeView, 0, codeName);
  writeU4(codeView, 2, codeDataLength);
  let c = 6;
  writeU2(codeView, c, 6); // max_stack
  c += 2;
  writeU2(codeView, c, 6); // locals: mob,item,qty,originalQty,long4/5
  c += 2;
  writeU4(codeView, c, codeBytes.length);
  c += 4;
  codeAttribute.set(codeBytes, c);
  c += codeBytes.length;
  writeU2(codeView, c, 0);
  c += 2;
  writeU2(codeView, c, 0); // class version 47: StackMap not required

  const method = new Uint8Array(8 + codeAttribute.length);
  const methodView = new DataView(method.buffer);
  writeU2(methodView, 0, 0x0009); // public static
  writeU2(methodView, 2, methodName);
  writeU2(methodView, 4, methodDescriptor);
  writeU2(methodView, 6, 1);
  method.set(codeAttribute, 8);

  const total = 10 + cpBytes.length + 12 + method.length + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  writeU2(view, 4, targetClass.minorVersion);
  writeU2(view, 6, targetClass.majorVersion);
  writeU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor);
  cursor += cpBytes.length;
  writeU2(view, cursor, 0x0031); cursor += 2;
  writeU2(view, cursor, thisClass); cursor += 2;
  writeU2(view, cursor, superClass); cursor += 2;
  writeU2(view, cursor, 0); cursor += 2; // interfaces
  writeU2(view, cursor, 0); cursor += 2; // fields
  writeU2(view, cursor, 1); cursor += 2; // methods
  out.set(method, cursor); cursor += method.length;
  writeU2(view, cursor, 0);

  const buffer = toArrayBuffer(out);
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('PanelGlobalGoldRuntime.class tự sinh không parse VALID.');
  }
  return buffer;
}

function patchFlexibleGlobalGold(
  buffer: ArrayBuffer,
  multiplier: number
): { classBytes: ArrayBuffer; helperBytes: ArrayBuffer; retargeted: boolean } {
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('a/a/h.class không parse VALID trước global-gold fallback.');
  }
  const target: MutableClass = {
    path: 'a/a/h.class',
    bytes: new Uint8Array(buffer.slice(0)),
    layout: parseRawClassLayout(buffer),
    classInfo: parsed,
  };

  const findScaleCall = () => {
    const methodInfo = target.classInfo.methods.find(
      (method) => method.name === 'a' && method.descriptor === '(La/m;IIII)I' && method.code?.instructions
    );
    const methodLayout = target.layout.methods.find(
      (method) => method.name === 'a' && method.descriptor === '(La/m;IIII)I'
    );
    if (!methodInfo?.code || !methodLayout) {
      throw new Error('Không tìm thấy a/a/h.a(La/m;IIII)I.');
    }
    const candidates = methodInfo.code.instructions.filter((instruction) => {
      if (instruction.opcode !== 0xb8) return false;
      const owner = instruction.methodRef?.owner ?? '';
      const name = instruction.methodRef?.name ?? '';
      const descriptor = instruction.methodRef?.descriptor ?? '';
      return (
        (owner === 'patch/GTLFix' && name === 'scaleGoldQty' && descriptor === '(La/m;II)I') ||
        (owner === GOLD_HELPER_INTERNAL_NAME && name === 'scale' && descriptor === '(La/m;II)I')
      );
    });
    if (candidates.length !== 1) {
      throw new Error(`Không định vị duy nhất được scaleGoldQty; tìm thấy ${candidates.length} call.`);
    }
    return { methodInfo, methodLayout, call: candidates[0] };
  };

  let { call } = findScaleCall();
  const owner = call.methodRef?.owner ?? '';
  let retargeted = false;
  if (owner === 'patch/GTLFix') {
    const offset = call.offset;
    const helperRef = appendGlobalGoldHelperMethodRef(target);
    const found = findScaleCall();
    const absolute = found.methodLayout.codeStart + offset;
    if (target.bytes[absolute] !== 0xb8) {
      throw new Error(`Gold scale call @${offset} không còn invokestatic.`);
    }
    target.bytes[absolute + 1] = (helperRef >> 8) & 0xff;
    target.bytes[absolute + 2] = helperRef & 0xff;
    refreshMutable(target);
    retargeted = true;
    ({ call } = findScaleCall());
  }
  if (call.methodRef?.owner !== GOLD_HELPER_INTERNAL_NAME) {
    throw new Error('Không xác minh được global gold call đã trỏ PanelGlobalGoldRuntime.scale.');
  }

  const classBytes = toArrayBuffer(target.bytes);
  const finalParsed = parseClassFile(classBytes);
  if (finalParsed.status !== 'valid' || finalParsed.remainingBytes !== 0) {
    throw new Error('a/a/h.class không parse VALID sau global-gold fallback.');
  }
  return {
    classBytes,
    helperBytes: buildGlobalGoldHelper(finalParsed, multiplier),
    retargeted,
  };
}

function buildCustomDropHelper(
  targetClass: ClassFileInfo,
  hooks: RuntimeHooks,
  custom: Array<{ boss: BossDefinition; drop: BossCustomDrop }>
): { bytes: ArrayBuffer; diagnostics: string[] } {
  const cp = new HelperConstantPool();
  const thisClass = cp.clazz(HELPER_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const applyName = cp.utf8('apply');
  const applyDescriptor = cp.utf8('(La/m;)V');
  const codeName = cp.utf8('Code');
  const aMClass = cp.clazz('a/m');
  const charFieldRef = cp.fieldRef('a/m', hooks.charField.name, hooks.charField.descriptor);
  const mapFieldRef = cp.fieldRef('a/m', hooks.mapField.name, hooks.mapField.descriptor);
  const dropRef = cp.methodRef('a/a/h', 'a', hooks.dropDescriptor);
  const needRng = custom.some(({ drop }) => drop.chancePercent > 0 && drop.chancePercent < 100);
  const rngRef = needRng ? cp.methodRef('a/a/h', 'w', hooks.rngDescriptor ?? '(I)I') : 0;

  let stackAttributeName = 0;
  let stackMode: RuntimeHooks['stackMapMode'];
  if (targetClass.majorVersion >= 50) {
    stackMode = 'StackMapTable';
  } else {
    stackMode = hooks.stackMapMode === 'StackMap' ? 'StackMap' : 'none';
  }
  if (stackMode !== 'none') stackAttributeName = cp.utf8(stackMode);

  const code: number[] = [];
  const fixups: Array<{ pos: number; targetId: number }> = [];
  const targets = new Map<number, number>();
  const frameTargets: number[] = [];
  const diagnostics: string[] = [];

  custom.forEach(({ boss, drop }, index) => {
    const itemId = Number(drop.itemId);
    const quantity = Math.round(drop.quantity);
    if (!Number.isInteger(itemId) || itemId < 0 || itemId > JAVA_INT_MAX) {
      throw new Error(`Boss #${boss.index}: itemId '${drop.itemId}' không hợp lệ.`);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > JAVA_INT_MAX) {
      throw new Error(
        `Boss #${boss.index}: quantity ${drop.quantity} vượt Java int 1..${JAVA_INT_MAX}.`
      );
    }
    if (!Number.isFinite(drop.chancePercent) || drop.chancePercent < 0 || drop.chancePercent > 100) {
      throw new Error(`Boss #${boss.index}: chance phải nằm trong 0..100%.`);
    }

    const targetId = index;
    code.push(0x2a, 0xb4, (charFieldRef >> 8) & 0xff, charFieldRef & 0xff);
    code.push(...helperIntPush(cp, boss.charId));
    addBranch(code, 0xa0, fixups, targetId); // if_icmpne

    code.push(0x2a, 0xb4, (mapFieldRef >> 8) & 0xff, mapFieldRef & 0xff);
    code.push(...helperIntPush(cp, boss.mapId));
    addBranch(code, 0xa0, fixups, targetId);

    let actualChance = drop.chancePercent;
    if (drop.chancePercent <= 0) {
      addBranch(code, 0xa7, fixups, targetId);
      actualChance = 0;
    } else if (drop.chancePercent < 100) {
      if (!rngRef || hooks.rngInvokeOpcode !== 0xb8 || hooks.rngDescriptor !== '(I)I') {
        throw new Error(`Không xác minh được a/a/h.w(I)I để dựng chance cho Boss #${boss.index}.`);
      }
      const range = 1_000_000;
      const threshold = Math.max(0, Math.min(range, Math.round((drop.chancePercent / 100) * range)));
      code.push(...helperIntPush(cp, range));
      code.push(0xb8, (rngRef >> 8) & 0xff, rngRef & 0xff);
      code.push(...helperIntPush(cp, threshold));
      addBranch(code, 0xa2, fixups, targetId); // if_icmpge
      actualChance = (threshold / range) * 100;
    }

    code.push(0x2a);
    code.push(...helperIntPush(cp, itemId));
    code.push(...helperIntPush(cp, quantity));
    if (hooks.dropInvokeOpcode !== 0xb8) {
      throw new Error('Hàm drop gốc không dùng invokestatic; writer helper không áp dụng mù.');
    }
    code.push(0xb8, (dropRef >> 8) & 0xff, dropRef & 0xff);
    const returnType = descriptorReturn(hooks.dropDescriptor);
    if (returnType !== 'V') code.push(returnType === 'J' || returnType === 'D' ? 0x58 : 0x57);

    const targetOffset = code.length;
    code.push(0x00); // branch target NOP
    targets.set(targetId, targetOffset);
    frameTargets.push(targetOffset);
    diagnostics.push(
      `Boss #${boss.index} ${boss.name}: thêm item #${itemId} x${quantity} @ ${actualChance.toFixed(4)}%.`
    );
  });
  code.push(0xb1); // return

  for (const fixup of fixups) {
    const target = targets.get(fixup.targetId);
    if (target === undefined) throw new Error('Thiếu branch target custom boss drop.');
    patchBranch(code, fixup.pos, target);
  }
  if (code.length > 0xffff) throw new Error('Helper boss drop vượt 65535-byte method limit.');

  let nestedAttribute = new Uint8Array(0);
  if (stackMode !== 'none') {
    const payload = stackMode === 'StackMap'
      ? encodeCldcStackMap(frameTargets, aMClass)
      : encodeStackMapTable(frameTargets);
    nestedAttribute = new Uint8Array(6 + payload.length);
    const nestedView = new DataView(nestedAttribute.buffer);
    writeU2(nestedView, 0, stackAttributeName);
    writeU4(nestedView, 2, payload.length);
    nestedAttribute.set(payload, 6);
  }

  // cp must be serialized only after all immediate/Integer constants have been registered.
  const cpBytes = cp.serialize();
  const codeBytes = new Uint8Array(code);
  const codeDataLength = 2 + 2 + 4 + codeBytes.length + 2 + 2 + nestedAttribute.length;
  const codeAttribute = new Uint8Array(6 + codeDataLength);
  const codeView = new DataView(codeAttribute.buffer);
  writeU2(codeView, 0, codeName);
  writeU4(codeView, 2, codeDataLength);
  let c = 6;
  writeU2(codeView, c, 4); // max_stack
  c += 2;
  writeU2(codeView, c, 1); // max_locals: a/m argument
  c += 2;
  writeU4(codeView, c, codeBytes.length);
  c += 4;
  codeAttribute.set(codeBytes, c);
  c += codeBytes.length;
  writeU2(codeView, c, 0); // exception_table_length
  c += 2;
  writeU2(codeView, c, nestedAttribute.length > 0 ? 1 : 0);
  c += 2;
  if (nestedAttribute.length > 0) codeAttribute.set(nestedAttribute, c);

  const method = new Uint8Array(8 + codeAttribute.length);
  const methodView = new DataView(method.buffer);
  writeU2(methodView, 0, 0x0009); // public static
  writeU2(methodView, 2, applyName);
  writeU2(methodView, 4, applyDescriptor);
  writeU2(methodView, 6, 1);
  method.set(codeAttribute, 8);

  const total = 10 + cpBytes.length + 2 + 2 + 2 + 2 + 2 + 2 + 2 + method.length + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  writeU2(view, 4, targetClass.minorVersion);
  writeU2(view, 6, targetClass.majorVersion);
  writeU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor);
  cursor += cpBytes.length;
  writeU2(view, cursor, 0x0031); // public final super
  cursor += 2;
  writeU2(view, cursor, thisClass);
  cursor += 2;
  writeU2(view, cursor, superClass);
  cursor += 2;
  writeU2(view, cursor, 0); // interfaces
  cursor += 2;
  writeU2(view, cursor, 0); // fields
  cursor += 2;
  writeU2(view, cursor, 1); // methods
  cursor += 2;
  out.set(method, cursor);
  cursor += method.length;
  writeU2(view, cursor, 0); // class attributes

  const parsed = parseClassFile(toArrayBuffer(out));
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('Helper PanelBossDropRuntime.class tự sinh không parse VALID.');
  }
  return { bytes: toArrayBuffer(out), diagnostics };
}

function appendHelperCallAtFinalReturn(
  target: MutableClass,
  hooks: RuntimeHooks,
  helperMethodRef: number
): void {
  const methodInfo = target.classInfo.methods.find(
    (method) => method.name === hooks.onBossKilled.name && method.descriptor === hooks.onBossKilled.descriptor
  );
  const method = target.layout.methods.find(
    (candidate) => candidate.name === hooks.onBossKilled.name && candidate.descriptor === hooks.onBossKilled.descriptor
  );
  if (!methodInfo?.code || !method) throw new Error('Không tìm lại được onBossKilled sau khi mở rộng CP.');

  const returns = (methodInfo.code.instructions ?? []).filter((instruction) => instruction.opcode === 0xb1);
  if (returns.length !== 1 || returns[0].offset !== method.codeLength - 1) {
    throw new Error(
      `onBossKilled cần đúng 1 RETURN ở cuối method; hiện thấy ${returns.length}. Không chèn hook mù.`
    );
  }
  const oldCode = target.bytes.slice(method.codeStart, method.codeEnd);
  if (oldCode[oldCode.length - 1] !== 0xb1) throw new Error('Byte cuối onBossKilled không phải RETURN.');

  const call = [
    ...Array.from(hooks.charField.objectLoadBytes),
    0xb8,
    (helperMethodRef >> 8) & 0xff,
    helperMethodRef & 0xff,
    0xb1,
  ];
  const nextCode = new Uint8Array(oldCode.length - 1 + call.length);
  nextCode.set(oldCode.slice(0, -1), 0);
  nextCode.set(call, oldCode.length - 1);

  const oldView = new DataView(target.bytes.buffer, target.bytes.byteOffset, target.bytes.byteLength);
  const maxStack = readU2(oldView, method.maxStackOffset);
  const maxLocals = readU2(oldView, method.maxLocalsOffset);
  const exceptionAndNested = target.bytes.slice(method.codeEnd, method.attributeEnd);
  const codeDataLength = 2 + 2 + 4 + nextCode.length + exceptionAndNested.length;
  const replacement = new Uint8Array(6 + codeDataLength);
  const view = new DataView(replacement.buffer);
  writeU2(view, 0, method.attributeNameIndex);
  writeU4(view, 2, codeDataLength);
  let cursor = 6;
  writeU2(view, cursor, Math.max(maxStack, 1));
  cursor += 2;
  writeU2(view, cursor, maxLocals);
  cursor += 2;
  writeU4(view, cursor, nextCode.length);
  cursor += 4;
  replacement.set(nextCode, cursor);
  cursor += nextCode.length;
  replacement.set(exceptionAndNested, cursor);

  const next = new Uint8Array(
    target.bytes.length - (method.attributeEnd - method.attributeStart) + replacement.length
  );
  next.set(target.bytes.slice(0, method.attributeStart), 0);
  next.set(replacement, method.attributeStart);
  next.set(target.bytes.slice(method.attributeEnd), method.attributeStart + replacement.length);
  target.bytes = next;
  refreshMutable(target);
}

async function loadMutableClass(
  session: LoadedJarSession,
  className: string,
  baseRewrittenClasses: Map<string, ArrayBuffer>
): Promise<MutableClass> {
  const path = normalizeClassEntryPath(className);
  const base = baseRewrittenClasses.get(path) ?? baseRewrittenClasses.get(className) ?? null;
  let buffer: ArrayBuffer;
  if (base) buffer = base.slice(0);
  else {
    const entry = session.zip.file(path);
    if (!entry) throw new Error(`Không tìm thấy ${path}.`);
    buffer = await entry.async('arraybuffer');
  }
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error(`Không parse hợp lệ ${path}.`);
  }
  return {
    path,
    bytes: new Uint8Array(buffer.slice(0)),
    layout: parseRawClassLayout(buffer),
    classInfo: parsed,
  };
}

function baseBossDraft(boss: BossDefinition): BossDraft {
  return {
    bossIndex: boss.index,
    name: boss.name,
    head: boss.head,
    body: boss.body,
    leg: boss.leg,
    hpOverride: boss.statMode === 'fixed' ? boss.hp : null,
    damageOverride: boss.statMode === 'fixed' ? boss.damage : null,
    spawnX: boss.spawnX,
    dropChanceOverrides: {},
    dropQuantityOverrides: {},
    customDrops: [],
  };
}

function unsupportedFields(boss: BossDefinition, draft: BossDraft): string[] {
  const base = baseBossDraft(boss);
  const fields: string[] = [];
  if (draft.name !== base.name) fields.push('name');
  if (draft.head !== base.head) fields.push('head');
  if (draft.body !== base.body) fields.push('body');
  if (draft.leg !== base.leg) fields.push('leg');
  if (draft.hpOverride !== base.hpOverride) fields.push('hpOverride');
  if (draft.damageOverride !== base.damageOverride) fields.push('damageOverride');
  if (draft.spawnX !== base.spawnX) fields.push('spawnX');
  if (Object.keys(draft.dropChanceOverrides).length > 0) fields.push('dropChanceOverrides');
  if (Object.keys(draft.dropQuantityOverrides).length > 0) fields.push('dropQuantityOverrides');
  return fields;
}


function concatBossBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function bossMethodLayout(buffer: ArrayBuffer): MethodLayout {
  const layout = parseRawClassLayout(buffer);
  const method = layout.methods.find(
    (candidate) => candidate.name === 'h' && candidate.descriptor === '(La/c;)V'
  );
  if (!method) throw new Error('Không tìm thấy a/a/d.h(La/c;)V - hook boss chết.');
  return method;
}

function verifyOriginalBossDeathCode(code: Uint8Array): void {
  if (code.length !== 26) {
    throw new Error(`a/a/d.h(La/c;)V có code_length ${code.length}, expected 26.`);
  }
  const expected: Array<[number, number]> = [
    [0, 0x2a], [1, 0xb4], [4, 0x4c],
    [5, 0x2a], [6, 0xb4], [9, 0x3d],
    [10, 0x2a], [11, 0xb4], [14, 0x3e],
    [15, 0x2a], [16, 0xb8],
    [19, 0x2b], [20, 0x1c], [21, 0x1d], [22, 0xb8],
    [25, 0xb1],
  ];
  for (const [offset, opcode] of expected) {
    if (code[offset] !== opcode) {
      throw new Error(
        `a/a/d.h boss-death pattern lệch @${offset}: 0x${code[offset]?.toString(16)} != 0x${opcode.toString(16)}.`
      );
    }
  }
}

function appendBossRuntimeMethodRefRaw(
  original: Uint8Array
): { bytes: Uint8Array; methodRefIndex: number } {
  const originalBuffer = toArrayBuffer(original);
  const layout = parseRawClassLayout(originalBuffer);
  const base = layout.constantPool.length;
  if (base + 6 >= 0xffff) throw new Error('Constant Pool a/a/d không còn đủ chỗ cho boss helper hook.');

  const helperUtf8 = base;
  const helperClass = base + 1;
  const applyUtf8 = base + 2;
  const descUtf8 = base + 3;
  const nat = base + 4;
  const methodRef = base + 5;
  const entries = [
    rawUtf8(HELPER_INTERNAL_NAME),
    rawU2Entry(TAG_CLASS, helperUtf8),
    rawUtf8('apply'),
    rawUtf8('(La/c;)V'),
    rawU2U2Entry(TAG_NAME_AND_TYPE, applyUtf8, descUtf8),
    rawU2U2Entry(TAG_METHODREF, helperClass, nat),
  ];
  const cpBytes = concatBossBytes(entries);
  const next = new Uint8Array(original.length + cpBytes.length);
  next.set(original.slice(0, layout.cpEnd), 0);
  next.set(cpBytes, layout.cpEnd);
  next.set(original.slice(layout.cpEnd), layout.cpEnd + cpBytes.length);
  writeU2(new DataView(next.buffer), 8, base + entries.length);
  return { bytes: next, methodRefIndex: methodRef };
}

function patchBossDeathManagerHookRaw(buffer: ArrayBuffer): ArrayBuffer {
  let bytes = new Uint8Array(buffer.slice(0));
  let method = bossMethodLayout(toArrayBuffer(bytes));
  if (method.exceptionTableLength !== 0 || method.nestedAttributes.length !== 0) {
    throw new Error('a/a/d.h có exception/StackMap lạ; không resize mù.');
  }
  let oldCode = bytes.slice(method.codeStart, method.codeEnd);

  // Already patched by this writer: aload_0 + invokestatic helper + original 26B method.
  if (
    oldCode.length === 30 &&
    oldCode[0] === 0x2a &&
    oldCode[1] === 0xb8 &&
    oldCode[4] === 0x2a &&
    oldCode[5] === 0xb4 &&
    oldCode[29] === 0xb1
  ) {
    verifyOriginalBossDeathCode(oldCode.slice(4));
    return toArrayBuffer(bytes);
  }

  verifyOriginalBossDeathCode(oldCode);
  const appended = appendBossRuntimeMethodRefRaw(bytes);
  bytes = appended.bytes;
  method = bossMethodLayout(toArrayBuffer(bytes));
  oldCode = bytes.slice(method.codeStart, method.codeEnd);
  verifyOriginalBossDeathCode(oldCode);

  const prefix = new Uint8Array([
    0x2a, // aload_0 boss a/c
    0xb8,
    (appended.methodRefIndex >> 8) & 0xff,
    appended.methodRefIndex & 0xff,
  ]);
  const nextCode = concatBossBytes([prefix, oldCode]);
  const oldView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxStack = readU2(oldView, method.maxStackOffset);
  const maxLocals = readU2(oldView, method.maxLocalsOffset);
  const codeDataLength = 2 + 2 + 4 + nextCode.length + 2 + 2;
  const replacement = new Uint8Array(6 + codeDataLength);
  const view = new DataView(replacement.buffer);
  writeU2(view, 0, method.attributeNameIndex);
  writeU4(view, 2, codeDataLength);
  let cursor = 6;
  writeU2(view, cursor, Math.max(maxStack, 1)); cursor += 2;
  writeU2(view, cursor, maxLocals); cursor += 2;
  writeU4(view, cursor, nextCode.length); cursor += 4;
  replacement.set(nextCode, cursor); cursor += nextCode.length;
  writeU2(view, cursor, 0); cursor += 2; // exception table
  writeU2(view, cursor, 0); // nested attrs

  const next = new Uint8Array(
    bytes.length - (method.attributeEnd - method.attributeStart) + replacement.length
  );
  next.set(bytes.slice(0, method.attributeStart), 0);
  next.set(replacement, method.attributeStart);
  next.set(bytes.slice(method.attributeEnd), method.attributeStart + replacement.length);

  const finalMethod = bossMethodLayout(toArrayBuffer(next));
  const finalCode = next.slice(finalMethod.codeStart, finalMethod.codeEnd);
  if (finalCode.length !== 30 || finalCode[0] !== 0x2a || finalCode[1] !== 0xb8) {
    throw new Error('Không xác minh được hook boss custom drop sau rewrite a/a/d.h.');
  }
  verifyOriginalBossDeathCode(finalCode.slice(4));
  return toArrayBuffer(next);
}

function encodeCldcBossStackMap(
  frameTargets: number[],
  bossClassIndex: number,
  mobClassIndex: number
): Uint8Array {
  // locals at all branch targets: local0=a/c, local1=a/m
  const entryLength = 2 + 2 + 3 + 3 + 2;
  const out = new Uint8Array(2 + frameTargets.length * entryLength);
  const view = new DataView(out.buffer);
  writeU2(view, 0, frameTargets.length);
  let cursor = 2;
  for (const target of frameTargets) {
    writeU2(view, cursor, target); cursor += 2;
    writeU2(view, cursor, 2); cursor += 2;
    out[cursor++] = 7; writeU2(view, cursor, bossClassIndex); cursor += 2;
    out[cursor++] = 7; writeU2(view, cursor, mobClassIndex); cursor += 2;
    writeU2(view, cursor, 0); cursor += 2;
  }
  return out;
}

function buildBossDeathDropHelper(
  targetClass: { minorVersion: number; majorVersion: number },
  custom: Array<{ boss: BossDefinition; drop: BossCustomDrop }>
): { bytes: ArrayBuffer; diagnostics: string[] } {
  const cp = new HelperConstantPool();
  const thisClass = cp.clazz(HELPER_INTERNAL_NAME);
  const superClass = cp.clazz('java/lang/Object');
  const bossClass = cp.clazz('a/c');
  const mobClass = cp.clazz('a/m');
  const applyName = cp.utf8('apply');
  const applyDescriptor = cp.utf8('(La/c;)V');
  const codeName = cp.utf8('Code');

  const bossCharRef = cp.fieldRef('a/c', 'z', 'I');
  const bossXRef = cp.fieldRef('a/c', 'p', 'I');
  const bossYRef = cp.fieldRef('a/c', 'q', 'I');
  const mapRef = cp.fieldRef('a/ba', 'pU', 'I');
  const mobXRef = cp.fieldRef('a/m', 'cp', 'I');
  const mobYRef = cp.fieldRef('a/m', 'cq', 'I');
  const mobStateRef = cp.fieldRef('a/m', 'cI', 'I');
  const mobCtor = cp.methodRef('a/m', '<init>', '()V');
  const dropRef = cp.methodRef('a/a/h', 'a', '(La/m;II)I');
  const needRng = custom.some(({ drop }) => drop.chancePercent > 0 && drop.chancePercent < 100);
  const rngRef = needRng ? cp.methodRef('a/a/h', 'w', '(I)I') : 0;

  const code: number[] = [
    0xbb, (mobClass >> 8) & 0xff, mobClass & 0xff, // new a/m
    0x59, // dup
    0xb7, (mobCtor >> 8) & 0xff, mobCtor & 0xff, // invokespecial <init>
    0x4c, // astore_1
    0x2b, 0x2a, 0xb4, (bossXRef >> 8) & 0xff, bossXRef & 0xff,
    0xb5, (mobXRef >> 8) & 0xff, mobXRef & 0xff,
    0x2b, 0x2a, 0xb4, (bossYRef >> 8) & 0xff, bossYRef & 0xff,
    0xb5, (mobYRef >> 8) & 0xff, mobYRef & 0xff,
    0x2b, 0x04, 0xb5, (mobStateRef >> 8) & 0xff, mobStateRef & 0xff,
  ];
  const fixups: Array<{ pos: number; targetId: number }> = [];
  const targets = new Map<number, number>();
  const frameTargets: number[] = [];
  const diagnostics: string[] = [];

  custom.forEach(({ boss, drop }, index) => {
    const itemId = Number(drop.itemId);
    const quantity = Math.round(drop.quantity);
    if (!Number.isInteger(itemId) || itemId < 0 || itemId > JAVA_INT_MAX) {
      throw new Error(`Boss #${boss.index}: itemId '${drop.itemId}' không hợp lệ.`);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > JAVA_INT_MAX) {
      throw new Error(`Boss #${boss.index}: quantity ${drop.quantity} vượt Java int 1..${JAVA_INT_MAX}.`);
    }
    if (!Number.isFinite(drop.chancePercent) || drop.chancePercent < 0 || drop.chancePercent > 100) {
      throw new Error(`Boss #${boss.index}: chance phải nằm trong 0..100%.`);
    }

    const targetId = index;
    code.push(0x2a, 0xb4, (bossCharRef >> 8) & 0xff, bossCharRef & 0xff);
    code.push(...helperIntPush(cp, boss.charId));
    addBranch(code, 0xa0, fixups, targetId);

    code.push(0xb2, (mapRef >> 8) & 0xff, mapRef & 0xff); // getstatic current map
    code.push(...helperIntPush(cp, boss.mapId));
    addBranch(code, 0xa0, fixups, targetId);

    let actualChance = drop.chancePercent;
    if (drop.chancePercent <= 0) {
      addBranch(code, 0xa7, fixups, targetId);
      actualChance = 0;
    } else if (drop.chancePercent < 100) {
      const range = 1_000_000;
      const threshold = Math.max(0, Math.min(range, Math.round((drop.chancePercent / 100) * range)));
      code.push(...helperIntPush(cp, range));
      code.push(0xb8, (rngRef >> 8) & 0xff, rngRef & 0xff);
      code.push(...helperIntPush(cp, threshold));
      addBranch(code, 0xa2, fixups, targetId);
      actualChance = (threshold / range) * 100;
    }

    code.push(0x2b);
    code.push(...helperIntPush(cp, itemId));
    code.push(...helperIntPush(cp, quantity));
    code.push(0xb8, (dropRef >> 8) & 0xff, dropRef & 0xff);
    code.push(0x57); // pop returned drop index

    const targetOffset = code.length;
    code.push(0x00);
    targets.set(targetId, targetOffset);
    frameTargets.push(targetOffset);
    diagnostics.push(
      `Boss #${boss.index} ${boss.name} [charId=${boss.charId}, map=${boss.mapId}]: item #${itemId} x${quantity} @ ${actualChance.toFixed(4)}%.`
    );
  });
  code.push(0xb1);

  for (const fixup of fixups) {
    const target = targets.get(fixup.targetId);
    if (target === undefined) throw new Error('Thiếu branch target boss custom drop V2.');
    patchBranch(code, fixup.pos, target);
  }
  if (code.length > 0xffff) throw new Error('PanelBossDropRuntime.apply vượt 65535 byte.');

  // v1.3.8/v1.5.5 are major 47 and their boss-death hook has no nested StackMap.
  // Keep helper compatible with that class shape; only add modern StackMapTable if ever needed.
  let nestedAttribute = new Uint8Array(0);
  if (targetClass.majorVersion >= 50 && frameTargets.length > 0) {
    const stackName = cp.utf8('StackMapTable');
    const payload = encodeStackMapTable(frameTargets);
    nestedAttribute = new Uint8Array(6 + payload.length);
    const nv = new DataView(nestedAttribute.buffer);
    writeU2(nv, 0, stackName);
    writeU4(nv, 2, payload.length);
    nestedAttribute.set(payload, 6);
  } else if (targetClass.majorVersion === 48 && frameTargets.length > 0) {
    // Kept for CLDC variants that explicitly require the old StackMap attribute.
    const stackName = cp.utf8('StackMap');
    const payload = encodeCldcBossStackMap(frameTargets, bossClass, mobClass);
    nestedAttribute = new Uint8Array(6 + payload.length);
    const nv = new DataView(nestedAttribute.buffer);
    writeU2(nv, 0, stackName);
    writeU4(nv, 2, payload.length);
    nestedAttribute.set(payload, 6);
  }

  const cpBytes = cp.serialize();
  const codeBytes = new Uint8Array(code);
  const codeDataLength = 2 + 2 + 4 + codeBytes.length + 2 + 2 + nestedAttribute.length;
  const codeAttribute = new Uint8Array(6 + codeDataLength);
  const codeView = new DataView(codeAttribute.buffer);
  writeU2(codeView, 0, codeName);
  writeU4(codeView, 2, codeDataLength);
  let c = 6;
  writeU2(codeView, c, 3); c += 2;
  writeU2(codeView, c, 2); c += 2;
  writeU4(codeView, c, codeBytes.length); c += 4;
  codeAttribute.set(codeBytes, c); c += codeBytes.length;
  writeU2(codeView, c, 0); c += 2;
  writeU2(codeView, c, nestedAttribute.length > 0 ? 1 : 0); c += 2;
  if (nestedAttribute.length > 0) codeAttribute.set(nestedAttribute, c);

  const method = new Uint8Array(8 + codeAttribute.length);
  const mv = new DataView(method.buffer);
  writeU2(mv, 0, 0x0009);
  writeU2(mv, 2, applyName);
  writeU2(mv, 4, applyDescriptor);
  writeU2(mv, 6, 1);
  method.set(codeAttribute, 8);

  const total = 10 + cpBytes.length + 12 + method.length + 2;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xcafebabe, false);
  writeU2(view, 4, targetClass.minorVersion);
  writeU2(view, 6, targetClass.majorVersion);
  writeU2(view, 8, cp.count);
  let cursor = 10;
  out.set(cpBytes, cursor); cursor += cpBytes.length;
  writeU2(view, cursor, 0x0031); cursor += 2;
  writeU2(view, cursor, thisClass); cursor += 2;
  writeU2(view, cursor, superClass); cursor += 2;
  writeU2(view, cursor, 0); cursor += 2;
  writeU2(view, cursor, 0); cursor += 2;
  writeU2(view, cursor, 1); cursor += 2;
  out.set(method, cursor); cursor += method.length;
  writeU2(view, cursor, 0);

  if (cursor + 2 !== out.length) {
    throw new Error(`PanelBossDropRuntime.class size mismatch ${cursor + 2}/${out.length}.`);
  }
  return { bytes: toArrayBuffer(out), diagnostics };
}

async function loadBossManagerBuffer(
  session: LoadedJarSession,
  baseRewrittenClasses: Map<string, ArrayBuffer>
): Promise<ArrayBuffer> {
  const path = 'a/a/d.class';
  const base = baseRewrittenClasses.get(path) ?? baseRewrittenClasses.get('a/a/d') ?? null;
  if (base) return base.slice(0);
  const entry = session.zip.file(path);
  if (!entry) throw new Error('Không tìm thấy a/a/d.class.');
  return entry.async('arraybuffer');
}

export async function buildBossPatches(
  session: LoadedJarSession,
  baseRewrittenClasses: Map<string, ArrayBuffer> = new Map()
): Promise<BossPatchResult> {
  const rewrittenClasses = new Map<string, ArrayBuffer>();
  const blockers: BossPatchBlocker[] = [];
  const diagnostics: string[] = [];
  const definitions = getBossDefinitions();
  const byIndex = new Map(definitions.map((boss) => [boss.index, boss]));
  const dirty = exportBossDrafts(session)
    .map(([index, draft]) => ({ boss: byIndex.get(index), draft }))
    .filter(
      (entry): entry is { boss: BossDefinition; draft: BossDraft } =>
        Boolean(entry.boss && isBossDraftDirty(entry.boss, entry.draft))
    );

  if (dirty.length === 0) {
    return {
      status: 'NO_CHANGES',
      rewrittenClasses,
      appliedDraftCount: 0,
      appliedPatchCount: 0,
      unsupportedDraftCount: 0,
      blockers,
      diagnostics,
    };
  }

  let unsupportedDraftCount = 0;
  const custom: Array<{ boss: BossDefinition; drop: BossCustomDrop }> = [];
  for (const { boss, draft } of dirty) {
    const unsupported = unsupportedFields(boss, draft);
    if (unsupported.length > 0) {
      unsupportedDraftCount++;
      blockers.push({
        bossIndex: boss.index,
        field: unsupported.join(', '),
        message:
          'Custom drop mới có writer thật. Các stat/tên/override rule drop cũ vẫn chưa có writer an toàn nên bị chặn, không bị bỏ qua âm thầm.',
      });
    }
    for (const drop of draft.customDrops) custom.push({ boss, drop });
  }

  if (custom.length === 0) {
    return {
      status: blockers.length > 0 ? 'BLOCKED' : 'NO_CHANGES',
      rewrittenClasses,
      appliedDraftCount: 0,
      appliedPatchCount: 0,
      unsupportedDraftCount,
      blockers,
      diagnostics,
    };
  }

  try {
    const managerBuffer = await loadBossManagerBuffer(session, baseRewrittenClasses);
    const managerView = new DataView(managerBuffer);
    if (managerView.getUint32(0, false) !== 0xcafebabe) {
      throw new Error('a/a/d.class không có magic CAFEBABE.');
    }
    const helper = buildBossDeathDropHelper(
      {
        minorVersion: managerView.getUint16(4, false),
        majorVersion: managerView.getUint16(6, false),
      },
      custom
    );
    const finalBuffer = patchBossDeathManagerHookRaw(managerBuffer);
    const finalParsed = parseClassFile(finalBuffer);
    const helperParsed = parseClassFile(helper.bytes);
    if (finalParsed.status !== 'valid' || finalParsed.remainingBytes !== 0) {
      throw new Error('a/a/d.class không parse VALID sau boss custom-drop hook.');
    }
    if (helperParsed.status !== 'valid' || helperParsed.remainingBytes !== 0) {
      throw new Error('PanelBossDropRuntime.class không parse VALID sau khi sinh.');
    }

    rewrittenClasses.set('a/a/d.class', finalBuffer);
    rewrittenClasses.set(HELPER_PATH, helper.bytes);
    diagnostics.push(
      'Boss custom drop: hook trực tiếp a/a/d.h(a/c), dùng a/c.z làm charId và a/ba.pU làm mapId; không còn phụ thuộc rule item #611 trong patch/TM.',
      ...helper.diagnostics
    );
    const appliedBosses = new Set(custom.map(({ boss }) => boss.index)).size;

    return {
      status: blockers.length > 0 ? 'BLOCKED' : 'READY',
      rewrittenClasses,
      appliedDraftCount: appliedBosses,
      appliedPatchCount: custom.length + 1,
      unsupportedDraftCount,
      blockers,
      diagnostics,
    };
  } catch (error: unknown) {
    blockers.push({
      bossIndex: -1,
      field: 'customDrops',
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 'BLOCKED',
      rewrittenClasses: new Map(),
      appliedDraftCount: 0,
      appliedPatchCount: 0,
      unsupportedDraftCount: Math.max(1, unsupportedDraftCount),
      blockers,
      diagnostics,
    };
  }
}

import JSZip from 'jszip';
import { LoadedJarSession, CandidateOutputJar, ClassFileInfo } from '../types/jar';
import { StringTableRow } from '../types/item';
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
  getCharacterDraftFingerprint,
} from './characterDataService';
import { buildCharacterPatches } from './characterPatchService';
import {
  getBossDraftFingerprint,
  getDirtyBossCount,
} from './bossDataService';
import {
  getGameMechanicsDraft,
  getGameMechanicsDirtyCount,
} from './gameMechanicsService';
import { buildMechanicsPatches } from './mechanicsPatchService';
import {
  analyzeSkills,
  getDirtySkillDraftEntries,
  getSkillDraftFingerprint,
  serializeSkillDraftValues,
} from './skillDataService';
import { parseClassFile } from './classFileParser';
import { getPatchWorkspaceFingerprint } from './patchWorkspaceStateService';

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
  session: LoadedJarSession,
  summary: DraftTestSummary
): Promise<DraftTestBlocker[]> {
  const blockers: DraftTestBlocker[] = [];

  summary.bossDrafts = getDirtyBossCount(session);
  if (summary.bossDrafts > 0) {
    blockers.push({
      area: 'Boss',
      count: summary.bossDrafts,
      message:
        'Boss hiện có nháp nhưng writer numeric/runtime chưa hoàn thiện. Test nháp sẽ không âm thầm bỏ qua thay đổi Boss.',
    });
  }

  return blockers;
}

function stableItemDraftFingerprint(session: LoadedJarSession): string {
  const drafts = getDirtyDrafts(session.itemDrafts)
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((draft) => ({
      key: draft.key,
      dirtyFields: [...draft.dirtyFields],
      values: draft.values,
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
    summary.itemDrafts = itemDrafts.length;

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
    summary.mechanicDrafts = getGameMechanicsDirtyCount(mechanicDraft);
    const mechanicsResult = await buildMechanicsPatches(session);

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
      characterResult.appliedDraftCount;
    summary.unsupportedDrafts =
      summary.bossDrafts +
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
      mechanicsResult.rewrittenClasses.size === 0 &&
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
        mechanicsResult.rewrittenClasses.size +
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

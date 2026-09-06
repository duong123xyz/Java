import { LoadedJarSession } from '../types/jar';
import { ItemRecord } from '../types/item';
import { ClassPatchGroup, ClassRewriteResult, ItemFieldPatchPlan } from '../types/patch';
import { analyzeItemTables } from './itemDataService';
import { getDirtyDrafts, getItemDraftKey } from './itemDraftService';
import {
  buildClassPatchGroups,
  buildFieldPatchPlan,
  isPlanEligibleForGroup,
} from './patchPlannerService';
import { runClassPreflight } from './classPreflightService';
import { rewriteClass } from './classFileRewriter';
import {
  buildAndVerifyPatchedJar,
  ExportProgress,
  ExportValidationResult,
} from './jarExportService';

export type QuickTestPhase =
  | 'ANALYZING_ITEMS'
  | 'PLANNING_PATCHES'
  | 'REWRITING_CLASSES'
  | 'BUILDING_JAR'
  | 'READY';

export interface QuickTestProgress {
  phase: QuickTestPhase;
  message: string;
  current?: number;
  total?: number;
}

export interface QuickTestBuildResult {
  classGroups: ClassPatchGroup[];
  rewriteResults: Map<string, ClassRewriteResult>;
  exportResult: ExportValidationResult;
}

/**
 * One-click pipeline used by the "Test Game" button:
 * Drafts -> Patch Plans -> Rewrite Previews -> Verified Patched JAR in RAM.
 *
 * It deliberately does NOT download anything and does NOT mutate the original JAR.
 */
export async function buildLatestPatchedJarForTest(
  session: LoadedJarSession,
  onProgress?: (progress: QuickTestProgress) => void
): Promise<QuickTestBuildResult> {
  const dirtyDrafts = getDirtyDrafts(session.itemDrafts);
  if (dirtyDrafts.length === 0) {
    throw new Error('Không có thay đổi nào cần build.');
  }

  onProgress?.({
    phase: 'ANALYZING_ITEMS',
    message: 'Đang chuẩn bị dữ liệu item hiện tại...',
  });

  const analysis = session.itemAnalysis || (await analyzeItemTables(session));
  const itemsByKey = new Map<string, ItemRecord>();
  for (const item of analysis.items) {
    itemsByKey.set(getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow), item);
  }

  const expectedDirtyCells = dirtyDrafts.reduce(
    (sum, draft) => sum + draft.dirtyFields.length,
    0
  );

  const plans: ItemFieldPatchPlan[] = [];
  let plannedCellIndex = 0;

  for (const draft of dirtyDrafts) {
    const item = itemsByKey.get(draft.key);
    if (!item) {
      throw new Error(
        `Không tìm thấy ItemRecord cho draft ${draft.key}. Hãy mở lại tab Items để phân tích dữ liệu.`
      );
    }

    for (const colIndex of draft.dirtyFields) {
      plannedCellIndex += 1;
      onProgress?.({
        phase: 'PLANNING_PATCHES',
        message: `Đang lập Patch Plan ${plannedCellIndex}/${expectedDirtyCells}...`,
        current: plannedCellIndex,
        total: expectedDirtyCells,
      });

      const plan = await buildFieldPatchPlan(session, item, draft, colIndex);
      if (!plan || !isPlanEligibleForGroup(plan)) {
        const fieldLabel = plan?.fieldName || `column ${colIndex}`;
        const reason = plan?.statusMessage || plan?.status || 'không có bytecode evidence hợp lệ';
        throw new Error(`Không thể patch ${fieldLabel}: ${reason}`);
      }
      plans.push(plan);
    }
  }

  const classGroups = buildClassPatchGroups(plans);
  const groupedCellCount = classGroups.reduce((sum, group) => sum + group.modifiedCellCount, 0);
  if (groupedCellCount !== expectedDirtyCells) {
    throw new Error(
      `Patch grouping không đầy đủ: expected ${expectedDirtyCells} cells nhưng chỉ group được ${groupedCellCount}.`
    );
  }

  const rewriteResults = new Map<string, ClassRewriteResult>();

  for (let i = 0; i < classGroups.length; i++) {
    const group = classGroups[i];
    onProgress?.({
      phase: 'REWRITING_CLASSES',
      message: `Đang rebuild & validate ${group.sourceClass} (${i + 1}/${classGroups.length})...`,
      current: i + 1,
      total: classGroups.length,
    });

    const preflight = await runClassPreflight(session, group);
    if (preflight.status !== 'PASS' || !preflight.originalBytes || !preflight.classInfo) {
      throw new Error(
        `Preflight thất bại cho ${group.sourceClass}: ${preflight.reason || 'unknown error'}`
      );
    }

    const rewrite = await rewriteClass(
      preflight.originalBytes,
      preflight.classInfo,
      group,
      session
    );

    if (rewrite.status !== 'VALIDATED' || !rewrite.rewrittenBytes) {
      throw new Error(
        `Rewrite validation thất bại cho ${group.sourceClass}: ${rewrite.errorMessage || 'unknown error'}`
      );
    }

    rewriteResults.set(group.sourceClass, rewrite);
  }

  // Keep previews in the session so the existing Changes UI can show the latest validated state too.
  session.rewritePreviews = new Map(rewriteResults);

  onProgress?.({
    phase: 'BUILDING_JAR',
    message: 'Đang tạo JAR patched trong RAM và verify round-trip...',
  });

  const exportResult = await buildAndVerifyPatchedJar(
    session,
    classGroups,
    rewriteResults,
    (p: ExportProgress) => {
      const sub = p.subProgress
        ? ` (${p.subProgress.current}/${p.subProgress.total}${p.subProgress.message ? ` - ${p.subProgress.message}` : ''})`
        : '';
      onProgress?.({
        phase: 'BUILDING_JAR',
        message: `${p.phaseLabel}${sub}`,
        current: p.currentStep,
        total: p.totalSteps,
      });
    }
  );

  if (exportResult.status !== 'VALIDATED' || !exportResult.candidateBlob) {
    throw new Error(
      exportResult.failureReason ||
        `Build Patched JAR thất bại tại ${exportResult.failurePhase || 'unknown phase'}.`
    );
  }

  session.candidateOutput = {
    blob: exportResult.candidateBlob,
    fileName: exportResult.candidateFileName,
    status: 'VALIDATED',
    validatedAt: Date.now(),
    expectedModifiedCount: expectedDirtyCells,
    metrics: exportResult.metrics,
  };

  onProgress?.({
    phase: 'READY',
    message: `Patched JAR đã verify xong (${expectedDirtyCells} cells). Đang mở Test Game...`,
  });

  return {
    classGroups,
    rewriteResults,
    exportResult,
  };
}

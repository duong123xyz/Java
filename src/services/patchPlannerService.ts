import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { ItemRecord, ItemDraft } from '../types/item';
import {
  ItemFieldPatchPlan,
  ClassPatchGroup,
  CellEvidence,
  PatchPlanRisk,
  PatchPlanStatus,
  PatchStrategy,
} from '../types/patch';
import { ITEM_SCHEMA_FIELDS, getItemDraftKey } from './itemDraftService';
import { getModifiedUtf8ByteLength } from './modifiedUtf8Service';
import { CpTag, CpStringEntry, CpUtf8Entry } from '../types/constantPool';
import { parseClassFile } from './classFileParser';

/**
 * Maps a field name (case-insensitive, underscore-insensitive) or index to runtime schema column index.
 * Does not hardcode separate schema - uses runtime schema extracted from a/a/a/h.class.
 */
export function resolveColumnIndex(schemaColumns: string[], fieldIdentifier: string | number): number {
  if (typeof fieldIdentifier === 'number') {
    return fieldIdentifier;
  }

  const cleanQuery = fieldIdentifier.toLowerCase().replace(/_/g, '');
  const foundIdx = schemaColumns.findIndex(
    (col) => col.toLowerCase().replace(/_/g, '') === cleanQuery
  );

  if (foundIdx !== -1) {
    return foundIdx;
  }

  // Fallback to ITEM_SCHEMA_FIELDS
  const fallback = ITEM_SCHEMA_FIELDS.find(
    (f) => f.key.toLowerCase().replace(/_/g, '') === cleanQuery || f.label.toLowerCase().replace(/_/g, '') === cleanQuery
  );

  return fallback ? fallback.index : 0;
}

/**
 * Normalizes any class identifier or entry path to canonical JAR entry format (e.g. "a/a/a/i.class").
 * Exact case-sensitive. Never converts to lowercase. Does not append ".class" if already present.
 */
export function normalizeClassEntryPath(identifier: string): string {
  if (!identifier) return '';
  const trimmed = identifier.trim();
  return trimmed.endsWith('.class') ? trimmed : `${trimmed}.class`;
}

/**
 * Helper to retrieve or parse a ClassFileInfo case-sensitively.
 * Reuses same pipeline as Step 07 without creating a redundant retrieval logic.
 * Checks memory cache first; loads directly from JSZip on cache miss.
 */
export async function getSessionClassInfo(
  session: LoadedJarSession,
  classIdentifier: string
): Promise<ClassFileInfo | null> {
  const exactPath = normalizeClassEntryPath(classIdentifier);

  if (session.classParseCache?.has(exactPath)) {
    return session.classParseCache.get(exactPath)!;
  }

  // Look up in session.zip directly or fallback to session.entries
  const zipEntry = session.zip?.file(exactPath) || session.entries.find((e) => e.path === exactPath)?.zipEntry;
  if (!zipEntry) {
    console.error(`[getSessionClassInfo] Entry not found in JAR: '${exactPath}'. Session total entries: ${session.entries.length}`);
    return null;
  }

  let buffer: ArrayBuffer | null = null;
  try {
    buffer = await zipEntry.async('arraybuffer');
    const classInfo = parseClassFile(buffer);
    if (!session.classParseCache) {
      session.classParseCache = new Map();
    }
    session.classParseCache.set(exactPath, classInfo);
    return classInfo;
  } catch (err: any) {
    console.error('[getSessionClassInfo] Class parse failed:', {
      path: exactPath,
      entryFound: true,
      byteLength: buffer ? buffer.byteLength : 0,
      exceptionName: err?.name,
      exceptionMessage: err?.message,
      stack: err?.stack,
    });
    throw new Error(`Class parse failed for '${exactPath}': ${err?.message || err}`);
  }
}

/**
 * Performs deep constant sharing analysis within the target source class:
 * 1. Bytecode instructions in all methods referencing target CONSTANT_String CP index
 * 2. Item table cells referencing target CONSTANT_String CP index
 * 3. Constant Pool & class structure references to target CONSTANT_Utf8 CP index
 */
export function analyzeConstantSharing(
  classInfo: ClassFileInfo,
  session: LoadedJarSession,
  sourceClass: string,
  cpStringIndex: number,
  utf8Index: number,
  rawStringValue: string
): {
  isShared: boolean;
  instructionRefCount: number;
  tableCellUsageCount: number;
  utf8TotalCpRefCount: number;
  explanation: string;
} {
  // 1. Instruction references to CONSTANT_String
  let instructionRefCount = 0;
  for (const method of classInfo.methods) {
    if (method.code?.instructions) {
      for (const inst of method.code.instructions) {
        if (
          (inst.opcode === 0x12 || inst.opcode === 0x13) &&
          inst.cpIndex === cpStringIndex
        ) {
          instructionRefCount++;
        }
      }
    }
  }

  // 2. Table cell references across session item records
  let tableCellUsageCount = 0;
  if (session.itemAnalysis?.items) {
    for (const it of session.itemAnalysis.items) {
      if (it.sourceClass === sourceClass && it.cellEvidences) {
        for (const colStr in it.cellEvidences) {
          const ev = it.cellEvidences[colStr];
          if (ev && ev.stringConstantIndex === cpStringIndex) {
            tableCellUsageCount++;
          }
        }
      }
    }
  }

  // 3. Constant Pool references to CONSTANT_Utf8
  let utf8TotalCpRefCount = 0;
  for (let i = 1; i < classInfo.constantPool.length; i++) {
    const entry = classInfo.constantPool[i];
    if (!entry) continue;

    switch (entry.tag) {
      case CpTag.String:
        if (entry.stringIndex === utf8Index) utf8TotalCpRefCount++;
        break;
      case CpTag.Class:
        if (entry.nameIndex === utf8Index) utf8TotalCpRefCount++;
        break;
      case CpTag.NameAndType:
        if (entry.nameIndex === utf8Index || entry.descriptorIndex === utf8Index) {
          utf8TotalCpRefCount++;
        }
        break;
      default:
        break;
    }
  }

  // Also check fields and methods
  for (const f of classInfo.fields) {
    if (f.nameIndex === utf8Index || f.descriptorIndex === utf8Index) utf8TotalCpRefCount++;
  }
  for (const m of classInfo.methods) {
    if (m.nameIndex === utf8Index || m.descriptorIndex === utf8Index) utf8TotalCpRefCount++;
    if (m.attributes) {
      for (const a of m.attributes) {
        if (a.attributeNameIndex === utf8Index) utf8TotalCpRefCount++;
      }
    }
  }

  const isShared =
    instructionRefCount > 1 ||
    tableCellUsageCount > 1 ||
    utf8TotalCpRefCount > 1;

  let explanation = '';
  if (isShared) {
    const reasons: string[] = [];
    if (tableCellUsageCount > 1) {
      reasons.push(
        `CONSTANT_String #${cpStringIndex} ("${rawStringValue}") được sử dụng trong ${tableCellUsageCount} cells của bảng item`
      );
    }
    if (instructionRefCount > 1) {
      reasons.push(
        `Có ${instructionRefCount} instructions trong class tham chiếu cùng CP #${cpStringIndex}`
      );
    }
    if (utf8TotalCpRefCount > 1) {
      reasons.push(
        `CONSTANT_Utf8 #${utf8Index} được tham chiếu bởi ${utf8TotalCpRefCount} thành phần trong Constant Pool (không được sửa in-place UTF-8 toàn cục)`
      );
    }
    explanation = reasons.join(' • ');
  } else {
    explanation = `Constant #${cpStringIndex} được cell này sử dụng duy nhất (1 instruction, 1 cell, 1 CP reference).`;
  }

  return {
    isShared,
    instructionRefCount,
    tableCellUsageCount,
    utf8TotalCpRefCount,
    explanation,
  };
}

/**
 * Builds a read-only patch plan for a single modified field of an item draft.
 * Strictly adheres to Step 09 rules:
 * - Maps directly to bytecode instruction without relying on item ID
 * - Verifies evidence against current loaded session bytes
 * - Deep 2-tier shared constant analysis (CONSTANT_String -> CONSTANT_Utf8)
 * - Modified UTF-8 byte length delta
 * - LDC vs LDC_W operand size analysis
 * - Does NOT mutate any bytecode or archive
 */
export async function buildFieldPatchPlan(
  session: LoadedJarSession,
  item: ItemRecord,
  draft: ItemDraft,
  columnIndex: number
): Promise<ItemFieldPatchPlan | null> {
  const schemaColumns = session.itemAnalysis?.diagnostics.schemaColumns || [];
  const fieldName = schemaColumns[columnIndex] || ITEM_SCHEMA_FIELDS[columnIndex]?.label || `col#${columnIndex}`;

  const originalValue = draft.originalValues[columnIndex] ?? '';
  const draftValue = draft.values[columnIndex] ?? '';

  // 1. NO-OP DETECTION: If draft == original, do not generate patch plan
  if (originalValue === draftValue) {
    return null;
  }

  const draftKey = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
  const planId = `${item.sourceClass}|${item.sourceField}|${item.sourceRow}|${columnIndex}`;

  // 2. Bytecode Evidence
  const cellEvidence: CellEvidence | undefined = item.cellEvidences?.[columnIndex];
  const diagnostics: string[] = [];

  const originalMutf8Length = getModifiedUtf8ByteLength(originalValue);
  const draftMutf8Length = getModifiedUtf8ByteLength(draftValue);
  const mutf8Delta = draftMutf8Length - originalMutf8Length;

  if (!cellEvidence) {
    return {
      id: planId,
      draftKey,
      sourceClass: item.sourceClass,
      sourceField: item.sourceField,
      sourceRow: item.sourceRow,
      fieldName,
      columnIndex,
      originalValue,
      draftValue,
      hasEvidence: false,
      producerOffset: -1,
      producerOpcode: 0,
      producerMnemonic: 'none',
      aastoreOffset: -1,
      isShared: false,
      stringConstantInstructionRefCount: 0,
      tableCellUsageCount: 0,
      utf8TotalCpRefCount: 0,
      sharingExplanation: 'Không tìm thấy bytecode evidence cho cell này',
      originalMutf8Length,
      draftMutf8Length,
      mutf8Delta,
      requiresConstantClone: false,
      requiresClassRebuild: true,
      currentOpcodeIsLdc: false,
      mayRequireLdcW: false,
      currentCpCount: 0,
      strategy: 'UNSUPPORTED',
      riskLevel: 'AMBIGUOUS',
      status: 'AMBIGUOUS',
      statusMessage: 'Thiếu bytecode evidence — không thể xác định instruction đích',
      diagnostics: ['Cell evidence không tồn tại trong metadata phân tích'],
    };
  }

  // 3. ORIGINAL BYTE VERIFICATION: Check evidence original value against ItemRecord.rawValues
  const rawTableValue = item.rawValues[columnIndex] ?? '';
  if (cellEvidence.originalValue !== rawTableValue) {
    return {
      id: planId,
      draftKey,
      sourceClass: item.sourceClass,
      sourceField: item.sourceField,
      sourceRow: item.sourceRow,
      fieldName,
      columnIndex,
      originalValue,
      draftValue,
      hasEvidence: true,
      producerOffset: cellEvidence.producerInstructionOffset,
      producerOpcode: cellEvidence.producerOpcode,
      producerMnemonic: cellEvidence.producerMnemonic,
      aastoreOffset: cellEvidence.aastoreInstructionOffset,
      isShared: false,
      stringConstantInstructionRefCount: 0,
      tableCellUsageCount: 0,
      utf8TotalCpRefCount: 0,
      sharingExplanation: 'Giá trị evidence không khớp với dữ liệu bảng gốc',
      originalMutf8Length,
      draftMutf8Length,
      mutf8Delta,
      requiresConstantClone: false,
      requiresClassRebuild: true,
      currentOpcodeIsLdc: cellEvidence.producerOpcode === 0x12,
      mayRequireLdcW: false,
      currentCpCount: 0,
      strategy: 'UNSUPPORTED',
      riskLevel: 'AMBIGUOUS',
      status: 'STALE_EVIDENCE',
      statusMessage: `Dữ liệu evidence (${cellEvidence.originalValue}) không khớp raw table (${rawTableValue})`,
      diagnostics: ['Phát hiện sai lệch giữa bytecode evidence và rawValues'],
    };
  }

  // 4. Check for Unsupported Producer (iconst, bipush, getstatic, null, etc.)
  if (cellEvidence.isUnsupportedProducer || (cellEvidence.producerOpcode !== 0x12 && cellEvidence.producerOpcode !== 0x13)) {
    return {
      id: planId,
      draftKey,
      sourceClass: item.sourceClass,
      sourceField: item.sourceField,
      sourceRow: item.sourceRow,
      fieldName,
      columnIndex,
      originalValue,
      draftValue,
      hasEvidence: true,
      producerOffset: cellEvidence.producerInstructionOffset,
      producerOpcode: cellEvidence.producerOpcode,
      producerMnemonic: cellEvidence.producerMnemonic,
      aastoreOffset: cellEvidence.aastoreInstructionOffset,
      isShared: false,
      stringConstantInstructionRefCount: 0,
      tableCellUsageCount: 0,
      utf8TotalCpRefCount: 0,
      sharingExplanation: cellEvidence.unsupportedReason || 'Producer opcode không phải ldc/ldc_w',
      originalMutf8Length,
      draftMutf8Length,
      mutf8Delta,
      requiresConstantClone: false,
      requiresClassRebuild: true,
      currentOpcodeIsLdc: false,
      mayRequireLdcW: false,
      currentCpCount: 0,
      strategy: 'UNSUPPORTED',
      riskLevel: 'UNSUPPORTED',
      status: 'UNSUPPORTED',
      statusMessage: `Producer '${cellEvidence.producerMnemonic}' không hỗ trợ patch String constant trực tiếp`,
      diagnostics: [cellEvidence.unsupportedReason || 'Unsupported producer opcode'],
    };
  }

  // 5. Load ClassFileInfo for CP analysis
  const classInfo = await getSessionClassInfo(session, item.sourceClass);
  if (!classInfo) {
    return {
      id: planId,
      draftKey,
      sourceClass: item.sourceClass,
      sourceField: item.sourceField,
      sourceRow: item.sourceRow,
      fieldName,
      columnIndex,
      originalValue,
      draftValue,
      hasEvidence: true,
      producerOffset: cellEvidence.producerInstructionOffset,
      producerOpcode: cellEvidence.producerOpcode,
      producerMnemonic: cellEvidence.producerMnemonic,
      aastoreOffset: cellEvidence.aastoreInstructionOffset,
      isShared: false,
      stringConstantInstructionRefCount: 0,
      tableCellUsageCount: 0,
      utf8TotalCpRefCount: 0,
      sharingExplanation: `Không thể đọc class file ${item.sourceClass}.class`,
      originalMutf8Length,
      draftMutf8Length,
      mutf8Delta,
      requiresConstantClone: false,
      requiresClassRebuild: true,
      currentOpcodeIsLdc: cellEvidence.producerOpcode === 0x12,
      mayRequireLdcW: false,
      currentCpCount: 0,
      strategy: 'UNSUPPORTED',
      riskLevel: 'AMBIGUOUS',
      status: 'AMBIGUOUS',
      statusMessage: `Không tìm thấy hoặc không thể giải mã ${item.sourceClass}.class`,
      diagnostics: ['ClassFileInfo null from session cache'],
    };
  }

  const cpStringIndex = cellEvidence.stringConstantIndex;
  const utf8Index = cellEvidence.utf8Index;
  const utf8RawString = cellEvidence.utf8RawString || originalValue;

  if (typeof cpStringIndex !== 'number' || typeof utf8Index !== 'number') {
    return {
      id: planId,
      draftKey,
      sourceClass: item.sourceClass,
      sourceField: item.sourceField,
      sourceRow: item.sourceRow,
      fieldName,
      columnIndex,
      originalValue,
      draftValue,
      hasEvidence: true,
      producerOffset: cellEvidence.producerInstructionOffset,
      producerOpcode: cellEvidence.producerOpcode,
      producerMnemonic: cellEvidence.producerMnemonic,
      aastoreOffset: cellEvidence.aastoreInstructionOffset,
      isShared: false,
      stringConstantInstructionRefCount: 0,
      tableCellUsageCount: 0,
      utf8TotalCpRefCount: 0,
      sharingExplanation: 'Không thể resolve Constant Pool index cho String/Utf8',
      originalMutf8Length,
      draftMutf8Length,
      mutf8Delta,
      requiresConstantClone: false,
      requiresClassRebuild: true,
      currentOpcodeIsLdc: cellEvidence.producerOpcode === 0x12,
      mayRequireLdcW: false,
      currentCpCount: classInfo.constantPool.length,
      strategy: 'UNSUPPORTED',
      riskLevel: 'UNSUPPORTED',
      status: 'UNSUPPORTED',
      statusMessage: 'Constant pool index bị thiếu trong evidence',
      diagnostics: ['cpStringIndex hoặc utf8Index undefined'],
    };
  }

  // 6. Deep Shared Constant Analysis
  const sharing = analyzeConstantSharing(
    classInfo,
    session,
    item.sourceClass,
    cpStringIndex,
    utf8Index,
    utf8RawString
  );

  // 7. Strategy & Patch Mechanics Classification
  let strategy: PatchStrategy = 'UNIQUE_REPLACE';
  let requiresConstantClone = false;

  if (sharing.isShared) {
    strategy = 'CLONE_AND_RETARGET';
    requiresConstantClone = true;
    diagnostics.push('Phát hiện shared constant: bắt buộc tạo String constant bản sao mới');
  } else {
    strategy = 'UNIQUE_REPLACE';
    requiresConstantClone = false;
    diagnostics.push('Constant là độc nhất: có thể thay thế hoặc clone khi patch engine thực thi');
  }

  // 8. Rebuild requirement analysis
  // If byte lengths differ, or if new CP entry must be inserted (cloning), class rebuild is mandatory
  let requiresClassRebuild = false;
  if (mutf8Delta !== 0) {
    requiresClassRebuild = true;
    diagnostics.push(`MUTF-8 byte length thay đổi (${originalMutf8Length} -> ${draftMutf8Length} bytes, delta ${mutf8Delta}): bắt buộc rebuild class file`);
  } else {
    diagnostics.push(`MUTF-8 byte length bằng nhau (${originalMutf8Length} bytes): technically in-place overwrite khả thi, nhưng vẫn áp dụng an toàn rebuild`);
  }

  if (requiresConstantClone) {
    requiresClassRebuild = true;
    diagnostics.push('Tạo mới Constant Pool entry yêu cầu cập nhật constant_pool_count và rebuild class');
  }

  // 9. LDC vs LDC_W Risk
  const currentOpcodeIsLdc = cellEvidence.producerOpcode === 0x12;
  const currentCpCount = classInfo.constantPool.length;
  let mayRequireLdcW = false;

  if (currentOpcodeIsLdc) {
    if (requiresConstantClone) {
      if (currentCpCount >= 254) {
        mayRequireLdcW = true;
        diagnostics.push(`CẢNH BÁO LDC -> LDC_W: Constant Pool hiện có ${currentCpCount} entries. Clone constant mới sẽ có index > 255, yêu cầu đổi ldc thành ldc_w và mở rộng Code attribute (+1 byte).`);
      } else {
        mayRequireLdcW = false;
        diagnostics.push(`LDC opcode (u1): CP hiện tại ${currentCpCount} < 255. Nếu số lượng clone trong batch không vượt quá 255 thì vẫn giữ được ldc.`);
      }
    } else {
      mayRequireLdcW = false;
    }
  } else {
    // Opcode is already ldc_w (0x13)
    mayRequireLdcW = false;
    diagnostics.push('Opcode hiện tại đã là ldc_w (u2 operand), hỗ trợ CP index lên tới 65535.');
  }

  // 10. Risk Level and Status
  let riskLevel: PatchPlanRisk = 'SAFE_TO_PLAN';
  let status: PatchPlanStatus = 'READY';
  let statusMessage = 'Sẵn sàng cho Patch Engine (Kế hoạch hợp lệ)';

  if (requiresClassRebuild) {
    riskLevel = 'NEEDS_REBUILD';
    status = 'NEEDS_REBUILD';
    statusMessage = 'Cần rebuild cấu trúc Class (do thay đổi kích thước hoặc thêm constant)';
  } else {
    riskLevel = 'SAFE_TO_PLAN';
    status = 'READY';
    statusMessage = 'Kế hoạch patch hợp lệ — bằng chứng bytecode đầy đủ';
  }

  return {
    id: planId,
    draftKey,
    sourceClass: item.sourceClass,
    sourceField: item.sourceField,
    sourceRow: item.sourceRow,
    fieldName,
    columnIndex,
    originalValue,
    draftValue,
    hasEvidence: true,
    producerOffset: cellEvidence.producerInstructionOffset,
    producerOpcode: cellEvidence.producerOpcode,
    producerMnemonic: cellEvidence.producerMnemonic,
    aastoreOffset: cellEvidence.aastoreInstructionOffset,
    cpStringIndex,
    utf8Index,
    utf8RawString,
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
    strategy,
    riskLevel,
    status,
    statusMessage,
    diagnostics,
  };
}

/**
 * Builds all patch plans for a given item draft across all its dirty fields.
 */
export async function buildItemDraftPatchPlans(
  session: LoadedJarSession,
  item: ItemRecord,
  draft: ItemDraft
): Promise<ItemFieldPatchPlan[]> {
  const plans: ItemFieldPatchPlan[] = [];

  for (const colIdx of draft.dirtyFields) {
    const plan = await buildFieldPatchPlan(session, item, draft, colIdx);
    if (plan) {
      plans.push(plan);
    }
  }

  return plans;
}

/**
 * Normalizes source class name to an exact, case-sensitive class entry format (e.g. "a/a/a/i.class").
 * Never calls toLowerCase().
 */
export function formatClassGroupKey(sourceClass: string): string {
  if (!sourceClass) return '';
  return sourceClass.endsWith('.class') ? sourceClass : `${sourceClass}.class`;
}

/**
 * Checks whether a patch plan is eligible to be grouped in a ClassPatchGroup.
 * Must have valid sourceClass, sourceRow, columnIndex, producer evidence, verified original,
 * and status must NOT be unresolved / ambiguous / unsupported.
 * Crucially, NEEDS_REBUILD and SAFE_TO_PLAN are both eligible.
 */
export function isPlanEligibleForGroup(plan: ItemFieldPatchPlan): boolean {
  if (!plan) return false;

  // 1. Valid sourceClass (non-empty string)
  if (!plan.sourceClass || typeof plan.sourceClass !== 'string' || plan.sourceClass.trim() === '') {
    return false;
  }

  // 2. Valid sourceRow (number >= 0)
  if (typeof plan.sourceRow !== 'number' || plan.sourceRow < 0) {
    return false;
  }

  // 3. Valid columnIndex (number >= 0)
  if (typeof plan.columnIndex !== 'number' || plan.columnIndex < 0) {
    return false;
  }

  // 4. Producer evidence
  if (!plan.hasEvidence || typeof plan.producerOffset !== 'number' || plan.producerOffset < 0 || !plan.producerOpcode) {
    return false;
  }

  // 5. Must NOT be unsupported, ambiguous, or unresolved
  const status = (plan.status || '').toUpperCase();
  if (status === 'UNSUPPORTED' || status === 'AMBIGUOUS' || status === 'UNRESOLVED' || status === 'STALE_EVIDENCE' || status === 'NO_OP') {
    return false;
  }

  const risk = (plan.riskLevel || '').toUpperCase();
  if (risk === 'UNSUPPORTED' || risk === 'AMBIGUOUS') {
    return false;
  }

  return true;
}

/**
 * Groups multiple patch plans across all drafts by exact sourceClass.
 * - Group key is exact sourceClass (case-sensitive, e.g. "a/a/a/i.class")
 * - Independent of item ID and field name
 * - Includes both SAFE_TO_PLAN and NEEDS_REBUILD plans
 * - Synthesizes modifiedItemCount and modifiedCellCount
 * - De-duplicates cells based on (sourceClass, sourceField, sourceRow, columnIndex)
 */
export function buildClassPatchGroups(plans: ItemFieldPatchPlan[]): ClassPatchGroup[] {
  const groupsMap = new Map<string, ItemFieldPatchPlan[]>();
  const seenCellKeys = new Set<string>();

  for (const plan of plans) {
    if (!isPlanEligibleForGroup(plan)) {
      continue;
    }

    // Stable cell identity: sourceClass + sourceField + sourceRow + columnIndex
    const cellKey = `${plan.sourceClass}|${plan.sourceField}|${plan.sourceRow}|${plan.columnIndex}`;
    if (seenCellKeys.has(cellKey)) {
      continue;
    }
    seenCellKeys.add(cellKey);

    const groupKey = formatClassGroupKey(plan.sourceClass);
    const list = groupsMap.get(groupKey) || [];
    list.push(plan);
    groupsMap.set(groupKey, list);
  }

  const groups: ClassPatchGroup[] = [];

  for (const [groupKey, classPlans] of groupsMap.entries()) {
    // Sort plans deterministically by sourceRow, then columnIndex
    classPlans.sort((a, b) => {
      if (a.sourceRow !== b.sourceRow) return a.sourceRow - b.sourceRow;
      return a.columnIndex - b.columnIndex;
    });

    // Count distinct items in this group
    const itemKeysSet = new Set<string>();
    for (const p of classPlans) {
      const itemIdentity = p.draftKey || `${p.sourceClass}|${p.sourceField}|${p.sourceRow}`;
      itemKeysSet.add(itemIdentity);
    }

    const sharedCount = classPlans.filter((p) => p.isShared).length;
    const uniqueCount = classPlans.filter((p) => !p.isShared).length;
    const requiresRebuild = classPlans.some(
      (p) => p.requiresClassRebuild || p.riskLevel === 'NEEDS_REBUILD' || p.status === 'NEEDS_REBUILD'
    );
    const hasUnsupportedPlans = classPlans.some(
      (p) => p.status === 'UNSUPPORTED' || p.riskLevel === 'UNSUPPORTED' || p.strategy === 'UNSUPPORTED'
    );

    groups.push({
      sourceClass: groupKey,
      classEntryPath: groupKey,
      plans: classPlans,
      modifiedCellCount: classPlans.length,
      totalModifiedCells: classPlans.length,
      modifiedItemCount: itemKeysSet.size,
      requiresRebuild,
      hasUnsupportedPlans,
      sharedConstantsCount: sharedCount,
      uniqueConstantsCount: uniqueCount,
    });
  }

  // Sort groups: most modified cells first, then alphabetical by groupKey
  return groups.sort((a, b) => {
    if (b.modifiedCellCount !== a.modifiedCellCount) {
      return b.modifiedCellCount - a.modifiedCellCount;
    }
    return a.sourceClass.localeCompare(b.sourceClass);
  });
}

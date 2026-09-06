export interface CellEvidence {
  rowIndex: number;
  columnIndex: number;
  sourceClass: string;
  sourceField: string;

  producerInstructionOffset: number;
  producerOpcode: number;
  producerMnemonic: string;

  constantPoolIndex?: number;
  stringConstantIndex?: number;
  utf8Index?: number;
  utf8RawString?: string;

  aastoreInstructionOffset: number;
  originalValue: string;

  isUnsupportedProducer?: boolean;
  unsupportedReason?: string;
}

export type PatchPlanRisk = 'SAFE_TO_PLAN' | 'NEEDS_REBUILD' | 'UNSUPPORTED' | 'AMBIGUOUS';

export type PatchPlanStatus =
  | 'READY'
  | 'NEEDS_REBUILD'
  | 'UNSUPPORTED'
  | 'AMBIGUOUS'
  | 'STALE_EVIDENCE'
  | 'NO_OP';

export type PatchStrategy =
  | 'CLONE_AND_RETARGET'
  | 'UNIQUE_REPLACE'
  | 'NO_PATCH'
  | 'UNSUPPORTED';

export interface ItemFieldPatchPlan {
  id: string; // e.g. "a/a/a/i|u|0|3"
  draftKey: string;

  sourceClass: string;
  sourceField: string;
  sourceRow: number;

  fieldName: string;
  columnIndex: number;

  originalValue: string;
  draftValue: string;

  // Bytecode evidence
  hasEvidence: boolean;
  producerOffset: number;
  producerOpcode: number;
  producerMnemonic: string;
  aastoreOffset: number;

  // Constant pool reference chain:
  // Instruction (offset X, ldc #Y) -> CP #Y CONSTANT_String (string_index = #Z) -> CP #Z CONSTANT_Utf8 (value = "...")
  cpStringIndex?: number;
  utf8Index?: number;
  utf8RawString?: string;

  // Sharing analysis
  isShared: boolean;
  stringConstantInstructionRefCount: number;
  tableCellUsageCount: number;
  utf8TotalCpRefCount: number;
  sharingExplanation: string;

  // Java Modified UTF-8 analysis
  originalMutf8Length: number;
  draftMutf8Length: number;
  mutf8Delta: number;

  // Patch mechanics & risks
  requiresConstantClone: boolean;
  requiresClassRebuild: boolean;
  currentOpcodeIsLdc: boolean;
  mayRequireLdcW: boolean;
  currentCpCount: number;

  strategy: PatchStrategy;
  riskLevel: PatchPlanRisk;
  status: PatchPlanStatus;
  statusMessage: string;
  diagnostics: string[];
}

export interface ClassPatchGroup {
  sourceClass: string;
  classEntryPath: string;
  plans: ItemFieldPatchPlan[];
  modifiedCellCount: number;
  totalModifiedCells: number;
  modifiedItemCount: number;
  requiresRebuild: boolean;
  hasUnsupportedPlans: boolean;
  sharedConstantsCount: number;
  uniqueConstantsCount: number;
}

export interface SemanticCellDiff {
  rowIndex: number;
  columnIndex: number;
  fieldName: string;
  originalValue: string;
  rewrittenValue: string;
  expected: boolean;
}

export interface AppliedPatchLog {
  planId: string;
  sourceRow: number;
  columnIndex: number;
  fieldName: string;
  originalValue: string;
  draftValue: string;
  strategyUsed: 'REUSE_EXISTING_STRING' | 'REWRITE_UNIQUE_UTF8' | 'CLONE_AND_RETARGET';
  details: string;
  oldProducer: string;
  newProducer: string;
}

export interface StructuralMetrics {
  originalClassSize: number;
  rewrittenClassSize: number;
  sizeDelta: number;
  originalCpCount: number;
  rewrittenCpCount: number;
  cpEntriesAdded: number;
  originalCodeLength: number;
  rewrittenCodeLength: number;
  codeLengthDelta: number;
  instructionsResized: number;
}

export interface ClassRewriteResult {
  sourceClass: string;
  status: 'VALIDATED' | 'FAILED';
  errorMessage?: string;

  originalBytes: ArrayBuffer;
  rewrittenBytes?: ArrayBuffer;

  appliedPlans: AppliedPatchLog[];
  semanticDiffs: SemanticCellDiff[];

  expectedChangedCount: number;
  actualChangedCount: number;
  unexpectedChangedCount: number;

  metrics: StructuralMetrics;

  originalUnchanged: boolean;
  zipMutated: boolean;
}


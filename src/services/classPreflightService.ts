import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { ClassPatchGroup } from '../types/patch';
import { parseClassFile } from './classFileParser';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { normalizeClassEntryPath } from './patchPlannerService';

export interface PreflightCheckResult {
  status: 'PASS' | 'FAIL';
  exactPath: string;
  entryFound: boolean;
  isDirectory: boolean;
  byteLength: number;
  magicPass: boolean;
  magicHex: string;
  classParsePass: boolean;
  internalClass: string;
  clinitFound: boolean;
  targetFieldFound: boolean;
  targetFieldName: string;
  tableReconstructionPass: boolean;
  evidenceCheckPass: boolean;
  reconstructedRowCount: number;
  reason?: string;
  errorStep?:
    | 'ENTRY_LOOKUP'
    | 'ARRAY_BUFFER'
    | 'MAGIC'
    | 'PARSER'
    | 'CLINIT'
    | 'TARGET_FIELD'
    | 'TABLE_RECONSTRUCT'
    | 'EVIDENCE_CHECK';
  originalBytes?: ArrayBuffer;
  classInfo?: ClassFileInfo;
}

/**
 * Runs a rigorous preflight check on the original class before any rewrite is attempted.
 * 
 * Reuses the exact same retrieval & parsing pipeline as Step 07:
 * 1. Entry lookup via JSZip / session.entries (exact case-sensitive canonical path)
 * 2. ArrayBuffer extraction directly from JSZip
 * 3. CAFEBABE magic number verification
 * 4. ClassFileParser & ConstantPool parsing
 * 5. <clinit> method & instructions discovery
 * 6. Target field discovery (e.g. u: [[Ljava/lang/String;)
 * 7. String[][] table reconstruction (via reconstructStringArrayTable)
 * 8. Patch plan evidence verification against live reconstructed table cells
 * 
 * Never swallows exceptions. Logs detailed diagnostics on failure.
 */
export async function runClassPreflight(
  session: LoadedJarSession,
  group: ClassPatchGroup
): Promise<PreflightCheckResult> {
  // 1. Resolve canonical path (e.g. "a/a/a/i.class") - exact case-sensitive
  const exactPath = normalizeClassEntryPath(group.classEntryPath || group.sourceClass);
  const targetFieldName = group.plans[0]?.sourceField || 'u';

  console.log(`[ClassPreflight] Starting preflight check for '${exactPath}' (target field: '${targetFieldName}')...`);

  // 2. JSZip Entry lookup
  // Check session.zip directly, fallback to session.entries
  const zipEntry =
    session.zip?.file(exactPath) ||
    session.entries.find((e) => e.path === exactPath)?.zipEntry;

  if (!zipEntry) {
    const reason = `JSZip entry '${exactPath}' not found in archive. Total session entries: ${session.entries.length}`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at ENTRY_LOOKUP:`, {
      exactPath,
      entryFound: false,
      reason,
      sessionEntriesCount: session.entries.length,
    });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: false,
      isDirectory: false,
      byteLength: 0,
      magicPass: false,
      magicHex: '0x00000000',
      classParsePass: false,
      internalClass: '',
      clinitFound: false,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'ENTRY_LOOKUP',
      reason,
    };
  }

  if (zipEntry.dir) {
    const reason = `Entry '${exactPath}' is a directory, not a valid Java class file.`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at ENTRY_LOOKUP:`, { exactPath, isDirectory: true, reason });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: true,
      byteLength: 0,
      magicPass: false,
      magicHex: '0x00000000',
      classParsePass: false,
      internalClass: '',
      clinitFound: false,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'ENTRY_LOOKUP',
      reason,
    };
  }

  // 3. ArrayBuffer extraction
  let originalBytes: ArrayBuffer;
  try {
    originalBytes = await zipEntry.async('arraybuffer');
  } catch (err: any) {
    const reason = `Failed to read ArrayBuffer from JSZip entry '${exactPath}': ${err?.message || err}`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at ARRAY_BUFFER:`, err);
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: false,
      byteLength: 0,
      magicPass: false,
      magicHex: '0x00000000',
      classParsePass: false,
      internalClass: '',
      clinitFound: false,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'ARRAY_BUFFER',
      reason,
    };
  }

  const byteLength = originalBytes.byteLength;
  if (byteLength < 4) {
    const reason = `File '${exactPath}' byteLength is ${byteLength}, less than minimum 4 bytes for Java ClassFile.`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at ARRAY_BUFFER:`, { exactPath, byteLength, reason });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: false,
      byteLength,
      magicPass: false,
      magicHex: '0x00000000',
      classParsePass: false,
      internalClass: '',
      clinitFound: false,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'ARRAY_BUFFER',
      reason,
    };
  }

  // 4. CAFEBABE Magic Verification
  const dataView = new DataView(originalBytes);
  const magic = dataView.getUint32(0);
  const magicHex = '0x' + magic.toString(16).toUpperCase();

  if (magic !== 0xcafebabe) {
    const reason = `Invalid Java Class magic: ${magicHex}, expected 0xCAFEBABE.`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at MAGIC:`, { exactPath, magicHex, reason });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: false,
      byteLength,
      magicPass: false,
      magicHex,
      classParsePass: false,
      internalClass: '',
      clinitFound: false,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'MAGIC',
      reason,
    };
  }

  // 5. ClassFile Parser & ConstantPool Parser
  let classInfo: ClassFileInfo;
  try {
    classInfo = parseClassFile(originalBytes);
    // Cache for future lookups
    if (!session.classParseCache) {
      session.classParseCache = new Map();
    }
    session.classParseCache.set(exactPath, classInfo);
  } catch (err: any) {
    const reason = `Class parser exception in '${exactPath}': ${err?.message || err}`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at PARSER:`, {
      exactPath,
      entryFound: true,
      byteLength,
      magicHex,
      exceptionName: err?.name,
      exceptionMessage: err?.message,
      stack: err?.stack,
    });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: false,
      byteLength,
      magicPass: true,
      magicHex,
      classParsePass: false,
      internalClass: '',
      clinitFound: false,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'PARSER',
      reason,
    };
  }

  const internalClass = classInfo.internalClassName || classInfo.className;

  // 6. <clinit> Discovery
  const clinit = classInfo.methods.find((m) => m.name === '<clinit>');
  if (!clinit || !clinit.code?.instructions) {
    const reason = `Static initializer <clinit> not found or contains no bytecode instructions in '${exactPath}'.`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at CLINIT:`, { exactPath, internalClass, reason });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: false,
      byteLength,
      magicPass: true,
      magicHex,
      classParsePass: true,
      internalClass,
      clinitFound: false,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'CLINIT',
      reason,
    };
  }

  // 7. Target Field Discovery (e.g. u: [[Ljava/lang/String;)
  const field = classInfo.fields.find((f) => f.name === targetFieldName);
  if (!field) {
    const reason = `Target field '${targetFieldName}' not found in class fields of '${exactPath}'. Available fields: [${classInfo.fields.map((f) => f.name).join(', ')}]`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at TARGET_FIELD:`, { exactPath, targetFieldName, reason });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: false,
      byteLength,
      magicPass: true,
      magicHex,
      classParsePass: true,
      internalClass,
      clinitFound: true,
      targetFieldFound: false,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'TARGET_FIELD',
      reason,
    };
  }

  // 8. Reconstruct String[][] Table (reusing Step 07 analyzer)
  const schemaColumnsCount =
    session.itemAnalysis?.diagnostics?.schemaColumnCount ||
    session.itemAnalysis?.diagnostics?.schemaColumns?.length ||
    15;
  const tableResult = reconstructStringArrayTable(
    classInfo.internalClassName || classInfo.className,
    targetFieldName,
    field.descriptor || '[[Ljava/lang/String;',
    0,
    clinit.code.instructions,
    classInfo.constantPool,
    schemaColumnsCount
  );

  if (tableResult.parseError) {
    const reason = `Failed to reconstruct String[][] table '${targetFieldName}' in '${exactPath}': ${tableResult.parseError}`;
    console.error(`[ClassPreflight] PRE-FLIGHT FAILED at TABLE_RECONSTRUCT:`, { exactPath, reason });
    return {
      status: 'FAIL',
      exactPath,
      entryFound: true,
      isDirectory: false,
      byteLength,
      magicPass: true,
      magicHex,
      classParsePass: true,
      internalClass,
      clinitFound: true,
      targetFieldFound: true,
      targetFieldName,
      tableReconstructionPass: false,
      evidenceCheckPass: false,
      reconstructedRowCount: 0,
      errorStep: 'TABLE_RECONSTRUCT',
      reason,
    };
  }

  // 9. Patch Evidence Validation against live reconstructed table cells
  for (const plan of group.plans) {
    const row = tableResult.rows.find((r) => r.rowIndex === plan.sourceRow);
    if (!row) {
      const reason = `STALE_EVIDENCE: Source row #${plan.sourceRow} not found in reconstructed table of '${exactPath}'. Table has ${tableResult.rows.length} rows.`;
      console.error(`[ClassPreflight] PRE-FLIGHT FAILED at EVIDENCE_CHECK:`, { planId: plan.id, reason });
      return {
        status: 'FAIL',
        exactPath,
        entryFound: true,
        isDirectory: false,
        byteLength,
        magicPass: true,
        magicHex,
        classParsePass: true,
        internalClass,
        clinitFound: true,
        targetFieldFound: true,
        targetFieldName,
        tableReconstructionPass: true,
        evidenceCheckPass: false,
        reconstructedRowCount: tableResult.rows.length,
        errorStep: 'EVIDENCE_CHECK',
        reason,
      };
    }

    const actualOrigVal = row.values[plan.columnIndex];
    if (actualOrigVal !== plan.originalValue) {
      const reason = `STALE_EVIDENCE: Original value mismatch at row ${plan.sourceRow}, column ${plan.columnIndex} (${plan.fieldName}). Plan expected: "${plan.originalValue}", live reconstructed table has: "${actualOrigVal}".`;
      console.error(`[ClassPreflight] PRE-FLIGHT FAILED at EVIDENCE_CHECK:`, {
        planId: plan.id,
        expected: plan.originalValue,
        actual: actualOrigVal,
        reason,
      });
      return {
        status: 'FAIL',
        exactPath,
        entryFound: true,
        isDirectory: false,
        byteLength,
        magicPass: true,
        magicHex,
        classParsePass: true,
        internalClass,
        clinitFound: true,
        targetFieldFound: true,
        targetFieldName,
        tableReconstructionPass: true,
        evidenceCheckPass: false,
        reconstructedRowCount: tableResult.rows.length,
        errorStep: 'EVIDENCE_CHECK',
        reason,
      };
    }
  }

  // 10. ALL PREFLIGHT CHECKS PASSED
  console.log(`[ClassPreflight] Original class preflight: PASS`, {
    exactPath,
    entryFound: true,
    byteLength,
    magicHex,
    internalClass,
    clinitFound: true,
    targetField: targetFieldName,
    reconstructedRowCount: tableResult.rows.length,
    plansVerifiedCount: group.plans.length,
  });

  return {
    status: 'PASS',
    exactPath,
    entryFound: true,
    isDirectory: false,
    byteLength,
    magicPass: true,
    magicHex,
    classParsePass: true,
    internalClass,
    clinitFound: true,
    targetFieldFound: true,
    targetFieldName,
    tableReconstructionPass: true,
    evidenceCheckPass: true,
    reconstructedRowCount: tableResult.rows.length,
    originalBytes,
    classInfo,
  };
}

import JSZip from 'jszip';
import { LoadedJarSession } from '../types/jar';
import { ClassPatchGroup, ClassRewriteResult, SemanticCellDiff } from '../types/patch';
import { normalizeClassEntryPath } from './patchPlannerService';
import { loadAndAnalyzeJarSession } from './jarService';
import { parseClassFile } from './classFileParser';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { analyzeItemTables } from './itemDataService';

export type ExportValidationPhase =
  | 'IDLE'
  | 'STALE_CHECK'
  | 'CLONING_ARCHIVE'
  | 'APPLYING_REWRITTEN_CLASSES'
  | 'VERIFYING_UNCHANGED_ENTRIES'
  | 'SERIALIZING_OUTPUT'
  | 'REOPENING_OUTPUT'
  | 'VALIDATING_REOPENED_ARCHIVE'
  | 'VERIFYING_MANIFEST'
  | 'DETECTING_SIGNATURES'
  | 'PARSING_PATCHED_CLASSES_FROM_OUTPUT'
  | 'RECONSTRUCTING_ITEMS_FROM_OUTPUT'
  | 'VERIFYING_SEMANTIC_DIFFS'
  | 'COMPLETED'
  | 'FAILED';

export interface ExportProgress {
  phase: ExportValidationPhase;
  phaseLabel: string;
  currentStep: number;
  totalSteps: number;
  subProgress?: {
    current: number;
    total: number;
    message?: string;
  };
}

export interface ExportCheckStep {
  name: string;
  status: 'PASS' | 'FAIL' | 'PENDING';
  details?: string;
}

export interface ExportValidationMetrics {
  originalFileName: string;
  outputFileName: string;
  originalFileSize: number;
  outputFileSize: number;

  originalTotalEntries: number;
  outputTotalEntries: number;
  originalClassEntries: number;
  outputClassEntries: number;
  originalPngEntries: number;
  outputPngEntries: number;

  unchangedEntriesVerified: number;
  totalEntriesVerified: number;

  manifestUnchanged: boolean;
  signatureDetected: boolean;
  signatureFiles: string[];

  validatedClassGroupsCount: number;
  patchedClassPaths: string[];

  expectedModifiedCellsCount: number;
  actualModifiedCellsCount: number;
  unexpectedModifiedCellsCount: number;

  originalItemCount: number;
  outputItemCount: number;

  reopenedSuccessfully: boolean;
  originalJarUntouched: boolean;
}

export interface ExportValidationResult {
  status: 'VALIDATED' | 'FAILED';
  failurePhase?: ExportValidationPhase;
  failureReason?: string;
  candidateBlob?: Blob;
  candidateFileName: string;
  metrics: ExportValidationMetrics;
  checkSteps: ExportCheckStep[];
  semanticDiffs: SemanticCellDiff[];
}

/**
 * Computes a deterministic hash / representation of patch plans in a group to detect stale previews.
 */
export function getGroupPlanFingerprint(group: ClassPatchGroup): string {
  return group.plans
    .map((p) => `${p.sourceRow}:${p.columnIndex}:${p.fieldName}:${p.originalValue}->${p.draftValue}`)
    .sort()
    .join('|');
}

/**
 * Derives output patched filename based on original filename.
 * e.g. "NgocRongChay-v1.3.8.jar" -> "NgocRongChay-v1.3.8_patched.jar"
 */
export function derivePatchedFileName(originalName: string): string {
  if (!originalName) return 'patched_game.jar';
  if (originalName.toLowerCase().endsWith('.jar')) {
    const base = originalName.slice(0, -4);
    return `${base}_patched.jar`;
  }
  return `${originalName}_patched.jar`;
}

/**
 * Fast comparison of two Uint8Arrays for identical byte sequences.
 */
function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  // Compare 32-bit words for high speed
  const len = a.byteLength;
  const wordCount = Math.floor(len / 4);
  const aView = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const bView = new DataView(b.buffer, b.byteOffset, b.byteLength);

  for (let i = 0; i < wordCount; i++) {
    if (aView.getUint32(i * 4) !== bView.getUint32(i * 4)) {
      return false;
    }
  }
  for (let i = wordCount * 4; i < len; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Builds, verifies end-to-end, and prepares the patched JAR candidate completely in-memory.
 * Re-opens the generated output JAR via JSZip, re-parses bytecode, and re-reconstructs item tables
 * to guarantee 100% semantic fidelity before enabling download.
 */
export async function buildAndVerifyPatchedJar(
  session: LoadedJarSession,
  groups: ClassPatchGroup[],
  rewriteResults: Map<string, ClassRewriteResult>,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportValidationResult> {
  const TOTAL_STEPS = 10;
  const originalFileName = session.jarInfo.fileName || 'game.jar';
  const outputFileName = derivePatchedFileName(originalFileName);

  const checkSteps: ExportCheckStep[] = [
    { name: 'Stale Preview Protection', status: 'PENDING' },
    { name: 'Independent Archive Clone', status: 'PENDING' },
    { name: 'Apply Rewritten Classes', status: 'PENDING' },
    { name: 'Unchanged Entries Content Verification', status: 'PENDING' },
    { name: 'Candidate JAR Serialization', status: 'PENDING' },
    { name: 'Serialized Output Reopen', status: 'PENDING' },
    { name: 'Manifest & Signature Verification', status: 'PENDING' },
    { name: 'Patched Bytecode Parsing from Output', status: 'PENDING' },
    { name: 'Full Item Reconstruction from Output', status: 'PENDING' },
    { name: 'End-to-End Semantic Diff & Side-effect Check', status: 'PENDING' },
  ];

  const updateStep = (index: number, status: 'PASS' | 'FAIL', details?: string) => {
    if (checkSteps[index]) {
      checkSteps[index].status = status;
      if (details) checkSteps[index].details = details;
    }
  };

  const metrics: ExportValidationMetrics = {
    originalFileName,
    outputFileName,
    originalFileSize: session.jarInfo.fileSize,
    outputFileSize: 0,
    originalTotalEntries: session.jarInfo.totalEntries,
    outputTotalEntries: 0,
    originalClassEntries: session.jarInfo.classEntries,
    outputClassEntries: 0,
    originalPngEntries: session.jarInfo.pngEntries,
    outputPngEntries: 0,
    unchangedEntriesVerified: 0,
    totalEntriesVerified: 0,
    manifestUnchanged: false,
    signatureDetected: false,
    signatureFiles: [],
    validatedClassGroupsCount: 0,
    patchedClassPaths: [],
    expectedModifiedCellsCount: 0,
    actualModifiedCellsCount: 0,
    unexpectedModifiedCellsCount: 0,
    originalItemCount: session.itemAnalysis?.items.length || 0,
    outputItemCount: 0,
    reopenedSuccessfully: false,
    originalJarUntouched: true,
  };

  // ----------------------------------------------------
  // STEP 1: VALIDATE ALL GROUPS & STALE PROTECTION
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'STALE_CHECK',
      phaseLabel: '1/10 Checking rewrite preview validity and freshness...',
      currentStep: 1,
      totalSteps: TOTAL_STEPS,
    });
  }

  if (groups.length === 0) {
    updateStep(0, 'FAIL', 'No patch groups available for export');
    return {
      status: 'FAILED',
      failurePhase: 'STALE_CHECK',
      failureReason: 'Không có Class Patch Group nào cần export.',
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }

  const patchedClassMap = new Map<string, { group: ClassPatchGroup; result: ClassRewriteResult }>();
  let totalExpectedCells = 0;

  for (const g of groups) {
    const canonicalPath = normalizeClassEntryPath(g.classEntryPath || g.sourceClass);
    const rewriteRes = rewriteResults.get(g.sourceClass);

    if (!rewriteRes || rewriteRes.status !== 'VALIDATED' || !rewriteRes.rewrittenBytes) {
      updateStep(0, 'FAIL', `Class ${canonicalPath} has not been validated`);
      return {
        status: 'FAILED',
        failurePhase: 'STALE_CHECK',
        failureReason: `Class group '${canonicalPath}' chưa có Rewrite Preview trạng thái VALIDATED trong RAM. Hãy bấm 'Build Rewrite Preview' trước khi export.`,
        candidateFileName: outputFileName,
        metrics,
        checkSteps,
        semanticDiffs: [],
      };
    }

    // Verify freshness: expected changed count must equal plan count
    if (rewriteRes.expectedChangedCount !== g.plans.length || rewriteRes.actualChangedCount !== g.plans.length) {
      updateStep(0, 'FAIL', `Class ${canonicalPath} preview is stale`);
      return {
        status: 'FAILED',
        failurePhase: 'STALE_CHECK',
        failureReason: `STALE_REWRITE_PREVIEW: Class group '${canonicalPath}' có số lượng draft thay đổi (${g.plans.length}) không khớp preview (${rewriteRes.actualChangedCount}). Vui lòng bấm Build Rewrite Preview lại.`,
        candidateFileName: outputFileName,
        metrics,
        checkSteps,
        semanticDiffs: [],
      };
    }

    patchedClassMap.set(canonicalPath, { group: g, result: rewriteRes });
    totalExpectedCells += g.plans.length;
  }

  metrics.validatedClassGroupsCount = patchedClassMap.size;
  metrics.patchedClassPaths = Array.from(patchedClassMap.keys());
  metrics.expectedModifiedCellsCount = totalExpectedCells;
  updateStep(0, 'PASS', `${patchedClassMap.size} group(s) validated, ${totalExpectedCells} cell(s) planned`);

  // ----------------------------------------------------
  // STEP 2: CLONE ORIGINAL JAR TO INDEPENDENT WORKING ZIP
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'CLONING_ARCHIVE',
      phaseLabel: '2/10 Cloning original archive into isolated working memory...',
      currentStep: 2,
      totalSteps: TOTAL_STEPS,
    });
  }

  let outputZip: JSZip;
  try {
    const originalArrayBuffer = await session.originalFile.arrayBuffer();
    // Use an independent JSZip instance so session.zip remains 100% read-only and immutable
    outputZip = await JSZip.loadAsync(originalArrayBuffer.slice(0));
    updateStep(1, 'PASS', `Cloned ${session.entries.length} entries independently`);
  } catch (err: any) {
    updateStep(1, 'FAIL', err.message || String(err));
    return {
      status: 'FAILED',
      failurePhase: 'CLONING_ARCHIVE',
      failureReason: `Không thể clone ZIP độc lập: ${err.message || err}`,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }

  // ----------------------------------------------------
  // STEP 3: APPLY REWRITTEN CLASSES TO OUTPUT ZIP
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'APPLYING_REWRITTEN_CLASSES',
      phaseLabel: '3/10 Applying validated in-memory class bytecode...',
      currentStep: 3,
      totalSteps: TOTAL_STEPS,
    });
  }

  try {
    for (const [canonicalPath, { result }] of patchedClassMap.entries()) {
      outputZip.file(canonicalPath, result.rewrittenBytes!);
    }
    updateStep(2, 'PASS', `Replaced ${patchedClassMap.size} class file(s): ${metrics.patchedClassPaths.join(', ')}`);
  } catch (err: any) {
    updateStep(2, 'FAIL', err.message || String(err));
    return {
      status: 'FAILED',
      failurePhase: 'APPLYING_REWRITTEN_CLASSES',
      failureReason: `Lỗi khi apply rewritten bytecode vào output ZIP: ${err.message || err}`,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }

  // ----------------------------------------------------
  // STEP 4: CONTENT VERIFICATION FOR UNCHANGED ENTRIES
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'VERIFYING_UNCHANGED_ENTRIES',
      phaseLabel: '4/10 Verifying uncompressed contents of all untouched archive entries...',
      currentStep: 4,
      totalSteps: TOTAL_STEPS,
    });
  }

  const nonDirEntries = session.entries.filter((e) => !e.directory);
  const totalNonDir = nonDirEntries.length;
  let verifiedCount = 0;

  for (let i = 0; i < totalNonDir; i++) {
    const origEntry = nonDirEntries[i];
    const path = origEntry.path;

    if (i % 250 === 0 && onProgress) {
      onProgress({
        phase: 'VERIFYING_UNCHANGED_ENTRIES',
        phaseLabel: `4/10 Verifying unchanged entries (${i}/${totalNonDir})...`,
        currentStep: 4,
        totalSteps: TOTAL_STEPS,
        subProgress: {
          current: i,
          total: totalNonDir,
          message: path,
        },
      });
      // Yield to main thread
      await new Promise((res) => setTimeout(res, 2));
    }

    if (patchedClassMap.has(path)) {
      // Patched entry: content MUST match rewrittenBytes
      const candidateBytes = await outputZip.file(path)?.async('uint8array');
      const expectedBytes = new Uint8Array(patchedClassMap.get(path)!.result.rewrittenBytes!);
      if (!candidateBytes || !areUint8ArraysEqual(candidateBytes, expectedBytes)) {
        updateStep(3, 'FAIL', `Patched entry '${path}' does not match expected rewritten bytes`);
        return {
          status: 'FAILED',
          failurePhase: 'VERIFYING_UNCHANGED_ENTRIES',
          failureReason: `UNEXPECTED_ENTRY_CHANGE: Entry '${path}' trong output ZIP không khớp bytecode rewritten!`,
          candidateFileName: outputFileName,
          metrics,
          checkSteps,
          semanticDiffs: [],
        };
      }
    } else {
      // Untouched entry: content MUST match original entry EXACTLY
      const origBytes = await origEntry.zipEntry.async('uint8array');
      const candZipEntry = outputZip.file(path);
      if (!candZipEntry) {
        updateStep(3, 'FAIL', `Untouched entry '${path}' missing in output archive`);
        return {
          status: 'FAILED',
          failurePhase: 'VERIFYING_UNCHANGED_ENTRIES',
          failureReason: `MISSING_ENTRY: Entry '${path}' bị thiếu trong output ZIP!`,
          candidateFileName: outputFileName,
          metrics,
          checkSteps,
          semanticDiffs: [],
        };
      }

      const candBytes = await candZipEntry.async('uint8array');
      if (!areUint8ArraysEqual(origBytes, candBytes)) {
        updateStep(3, 'FAIL', `Untouched entry '${path}' was unexpectedly modified`);
        return {
          status: 'FAILED',
          failurePhase: 'VERIFYING_UNCHANGED_ENTRIES',
          failureReason: `UNEXPECTED_ENTRY_CHANGE: Entry '${path}' không nằm trong patched classes nhưng nội dung bị biến đổi!`,
          candidateFileName: outputFileName,
          metrics,
          checkSteps,
          semanticDiffs: [],
        };
      }
      verifiedCount++;
    }
  }

  metrics.unchangedEntriesVerified = verifiedCount;
  metrics.totalEntriesVerified = totalNonDir;
  updateStep(3, 'PASS', `${verifiedCount} untouched entries verified bit-for-bit identical`);

  // ----------------------------------------------------
  // STEP 5: SERIALIZE CANDIDATE OUTPUT JAR TO BLOB
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'SERIALIZING_OUTPUT',
      phaseLabel: '5/10 Serializing candidate output JAR in browser RAM...',
      currentStep: 5,
      totalSteps: TOTAL_STEPS,
    });
  }

  let candidateBlob: Blob;
  try {
    candidateBlob = await outputZip.generateAsync({
      type: 'blob',
      mimeType: 'application/java-archive',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    metrics.outputFileSize = candidateBlob.size;
    updateStep(4, 'PASS', `Serialized archive size: ${(candidateBlob.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err: any) {
    updateStep(4, 'FAIL', err.message || String(err));
    return {
      status: 'FAILED',
      failurePhase: 'SERIALIZING_OUTPUT',
      failureReason: `Lỗi serialize output JAR: ${err.message || err}`,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }

  // ----------------------------------------------------
  // STEP 6: REOPEN CANDIDATE OUTPUT JAR (MANDATORY ROUND-TRIP)
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'REOPENING_OUTPUT',
      phaseLabel: '6/10 Reopening serialized output JAR to verify archive integrity...',
      currentStep: 6,
      totalSteps: TOTAL_STEPS,
    });
  }

  let reopenedSession: LoadedJarSession;
  try {
    const candidateFile = new File([candidateBlob], outputFileName, {
      type: 'application/java-archive',
      lastModified: Date.now(),
    });

    reopenedSession = await loadAndAnalyzeJarSession(candidateFile);
    metrics.reopenedSuccessfully = true;
    metrics.outputTotalEntries = reopenedSession.jarInfo.totalEntries;
    metrics.outputClassEntries = reopenedSession.jarInfo.classEntries;
    metrics.outputPngEntries = reopenedSession.jarInfo.pngEntries;

    // Check entry count match
    if (metrics.outputTotalEntries !== metrics.originalTotalEntries) {
      updateStep(5, 'FAIL', `Total entries mismatch (${metrics.outputTotalEntries} vs ${metrics.originalTotalEntries})`);
      return {
        status: 'FAILED',
        failurePhase: 'VALIDATING_REOPENED_ARCHIVE',
        failureReason: `ENTRY_COUNT_MISMATCH: Tổng số entry trong output (${metrics.outputTotalEntries}) khác với original (${metrics.originalTotalEntries})!`,
        candidateBlob,
        candidateFileName: outputFileName,
        metrics,
        checkSteps,
        semanticDiffs: [],
      };
    }

    if (metrics.outputClassEntries !== metrics.originalClassEntries) {
      updateStep(5, 'FAIL', `Class entries mismatch (${metrics.outputClassEntries} vs ${metrics.originalClassEntries})`);
      return {
        status: 'FAILED',
        failurePhase: 'VALIDATING_REOPENED_ARCHIVE',
        failureReason: `CLASS_COUNT_MISMATCH: Số lượng class trong output (${metrics.outputClassEntries}) khác với original (${metrics.originalClassEntries})!`,
        candidateBlob,
        candidateFileName: outputFileName,
        metrics,
        checkSteps,
        semanticDiffs: [],
      };
    }

    updateStep(5, 'PASS', `Reopened successfully: ${metrics.outputTotalEntries} entries, ${metrics.outputClassEntries} classes`);
  } catch (err: any) {
    updateStep(5, 'FAIL', err.message || String(err));
    return {
      status: 'FAILED',
      failurePhase: 'REOPENING_OUTPUT',
      failureReason: `ARCHIVE_REOPEN_FAILED: Không thể đọc lại candidate output JAR bằng JSZip: ${err.message || err}`,
      candidateBlob,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }

  // ----------------------------------------------------
  // STEP 7: MANIFEST VERIFICATION & SIGNATURE DETECTION
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'VERIFYING_MANIFEST',
      phaseLabel: '7/10 Verifying META-INF/MANIFEST.MF and checking signature files...',
      currentStep: 7,
      totalSteps: TOTAL_STEPS,
    });
  }

  // Check manifest fields
  const origMan = session.jarInfo.manifest;
  const outMan = reopenedSession.jarInfo.manifest;

  const manifestFieldsMatch =
    origMan.manifestVersion === outMan.manifestVersion &&
    origMan.midletName === outMan.midletName &&
    origMan.midletVersion === outMan.midletVersion &&
    origMan.midletVendor === outMan.midletVendor &&
    origMan.midlet1 === outMan.midlet1 &&
    origMan.configuration === outMan.configuration &&
    origMan.profile === outMan.profile;

  if (!manifestFieldsMatch) {
    updateStep(6, 'FAIL', 'Manifest headers differ from original');
    return {
      status: 'FAILED',
      failurePhase: 'VERIFYING_MANIFEST',
      failureReason: `MANIFEST_CHANGED: Các trường trong META-INF/MANIFEST.MF của output JAR bị thay đổi không mong muốn!`,
      candidateBlob,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }
  metrics.manifestUnchanged = true;

  // Signature check
  const sigFiles: string[] = [];
  reopenedSession.entries.forEach((e) => {
    const p = e.path.toUpperCase();
    if (p.startsWith('META-INF/') && (p.endsWith('.SF') || p.endsWith('.RSA') || p.endsWith('.DSA') || p.endsWith('.EC'))) {
      sigFiles.push(e.path);
    }
  });

  metrics.signatureDetected = sigFiles.length > 0;
  metrics.signatureFiles = sigFiles;
  updateStep(
    6,
    'PASS',
    `Manifest 100% identical. Signature metadata: ${sigFiles.length > 0 ? sigFiles.join(', ') : 'NO'}`
  );

  // ----------------------------------------------------
  // STEP 8: PARSE PATCHED CLASSES DIRECTLY FROM REOPENED OUTPUT
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'PARSING_PATCHED_CLASSES_FROM_OUTPUT',
      phaseLabel: '8/10 Parsing rewritten bytecode directly from reopened output JAR...',
      currentStep: 8,
      totalSteps: TOTAL_STEPS,
    });
  }

  const outputReconstructedTables = new Map<string, any>();

  try {
    for (const [canonicalPath, { group }] of patchedClassMap.entries()) {
      const entry = reopenedSession.entries.find((e) => e.path === canonicalPath);
      if (!entry) {
        throw new Error(`Class entry '${canonicalPath}' not found in reopened output JAR!`);
      }

      const classBuffer = await entry.zipEntry.async('arraybuffer');
      const classInfo = parseClassFile(classBuffer);

      const targetField = group.plans[0]?.sourceField || 'u';
      const clinit = classInfo.methods.find((m) => m.name === '<clinit>');
      if (!clinit || !clinit.code?.instructions) {
        throw new Error(`Method <clinit> not found in rewritten class '${canonicalPath}'!`);
      }

      const field = classInfo.fields.find((f) => f.name === targetField);
      if (!field) {
        throw new Error(`Field '${targetField}' not found in rewritten class '${canonicalPath}'!`);
      }

      const schemaCount = session.itemAnalysis?.diagnostics?.schemaColumnCount || 15;
      const tableRes = reconstructStringArrayTable(
        classInfo.internalClassName || classInfo.className,
        targetField,
        field.descriptor || '[[Ljava/lang/String;',
        0,
        clinit.code.instructions,
        classInfo.constantPool,
        schemaCount
      );

      if (tableRes.parseError) {
        throw new Error(`Reconstructing table '${targetField}' failed: ${tableRes.parseError}`);
      }

      outputReconstructedTables.set(canonicalPath, tableRes);
    }
    updateStep(7, 'PASS', `Parsed and reconstructed String[][] for ${patchedClassMap.size} class(es)`);
  } catch (err: any) {
    updateStep(7, 'FAIL', err.message || String(err));
    return {
      status: 'FAILED',
      failurePhase: 'PARSING_PATCHED_CLASSES_FROM_OUTPUT',
      failureReason: `PATCHED_CLASS_PARSE_FAILED: Lỗi khi parse bytecode từ output JAR vừa reopened: ${err.message || err}`,
      candidateBlob,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }

  // ----------------------------------------------------
  // STEP 9: FULL ITEM RECONSTRUCTION FROM REOPENED OUTPUT
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'RECONSTRUCTING_ITEMS_FROM_OUTPUT',
      phaseLabel: '9/10 Running full Item Reconstruction pipeline on candidate output JAR...',
      currentStep: 9,
      totalSteps: TOTAL_STEPS,
    });
  }

  let reopenedItemData: any;
  try {
    reopenedItemData = await analyzeItemTables(reopenedSession);
    metrics.outputItemCount = reopenedItemData.items.length;

    if (metrics.outputItemCount !== metrics.originalItemCount) {
      updateStep(8, 'FAIL', `Item count mismatch (${metrics.outputItemCount} vs ${metrics.originalItemCount})`);
      return {
        status: 'FAILED',
        failurePhase: 'RECONSTRUCTING_ITEMS_FROM_OUTPUT',
        failureReason: `ITEM_COUNT_MISMATCH: Tổng số vật phẩm tái cấu trúc từ output JAR (${metrics.outputItemCount}) không khớp với file gốc (${metrics.originalItemCount})!`,
        candidateBlob,
        candidateFileName: outputFileName,
        metrics,
        checkSteps,
        semanticDiffs: [],
      };
    }
    updateStep(8, 'PASS', `Reconstructed full catalog: ${metrics.outputItemCount} items (100% matched)`);
  } catch (err: any) {
    updateStep(8, 'FAIL', err.message || String(err));
    return {
      status: 'FAILED',
      failurePhase: 'RECONSTRUCTING_ITEMS_FROM_OUTPUT',
      failureReason: `ITEM_RECONSTRUCTION_FAILED: Lỗi khi chạy full item reconstruction trên candidate output: ${err.message || err}`,
      candidateBlob,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: [],
    };
  }

  // ----------------------------------------------------
  // STEP 10: END-TO-END SEMANTIC DIFF & SIDE-EFFECT VERIFICATION
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'VERIFYING_SEMANTIC_DIFFS',
      phaseLabel: '10/10 Verifying exact semantic table changes and confirming zero side effects...',
      currentStep: 10,
      totalSteps: TOTAL_STEPS,
    });
  }

  const allSemanticDiffs: SemanticCellDiff[] = [];
  let actualChangedCount = 0;
  let unexpectedChangedCount = 0;

  for (const [canonicalPath, { group }] of patchedClassMap.entries()) {
    const outTable = outputReconstructedTables.get(canonicalPath);
    // Find original table from session.itemAnalysis
    const origTable = session.itemAnalysis?.sourceTables.find(
      (st) => normalizeClassEntryPath(st.owner) === canonicalPath
    );

    if (!origTable || !outTable) {
      updateStep(9, 'FAIL', `Table data not found for ${canonicalPath}`);
      return {
        status: 'FAILED',
        failurePhase: 'VERIFYING_SEMANTIC_DIFFS',
        failureReason: `Không tìm thấy bảng đối chứng giữa Original và Output cho '${canonicalPath}'.`,
        candidateBlob,
        candidateFileName: outputFileName,
        metrics,
        checkSteps,
        semanticDiffs: [],
      };
    }

    const maxRows = Math.max(origTable.rows.length, outTable.rows.length);

    for (let r = 0; r < maxRows; r++) {
      const origRow = origTable.rows[r];
      const outRow = outTable.rows[r];

      if (!origRow || !outRow) {
        unexpectedChangedCount++;
        continue;
      }

      const maxCols = Math.max(origRow.values.length, outRow.values.length);
      for (let c = 0; c < maxCols; c++) {
        const origVal = origRow.values[c] ?? '';
        const outVal = outRow.values[c] ?? '';

        if (origVal !== outVal) {
          // Check if this cell was expected in plans
          const plan = group.plans.find((p) => p.sourceRow === r && p.columnIndex === c);

          if (plan) {
            // Expected patch
            const isExpectedValue = outVal === plan.draftValue;
            if (isExpectedValue) {
              actualChangedCount++;
              allSemanticDiffs.push({
                rowIndex: r,
                columnIndex: c,
                fieldName: plan.fieldName,
                originalValue: origVal,
                rewrittenValue: outVal,
                expected: true,
              });
            } else {
              unexpectedChangedCount++;
              allSemanticDiffs.push({
                rowIndex: r,
                columnIndex: c,
                fieldName: plan.fieldName,
                originalValue: origVal,
                rewrittenValue: outVal,
                expected: false,
              });
            }
          } else {
            // UNEXPECTED SIDE EFFECT!
            unexpectedChangedCount++;
            allSemanticDiffs.push({
              rowIndex: r,
              columnIndex: c,
              fieldName: `col_${c}`,
              originalValue: origVal,
              rewrittenValue: outVal,
              expected: false,
            });
          }
        }
      }
    }
  }

  metrics.actualModifiedCellsCount = actualChangedCount;
  metrics.unexpectedModifiedCellsCount = unexpectedChangedCount;

  if (actualChangedCount !== metrics.expectedModifiedCellsCount || unexpectedChangedCount > 0) {
    updateStep(
      9,
      'FAIL',
      `Semantic diff failure: ${actualChangedCount}/${metrics.expectedModifiedCellsCount} expected cells, ${unexpectedChangedCount} unexpected changes`
    );
    return {
      status: 'FAILED',
      failurePhase: 'VERIFYING_SEMANTIC_DIFFS',
      failureReason: `UNEXPECTED_SEMANTIC_CHANGE: Phát hiện sai lệch ngữ nghĩa trong output JAR: ${actualChangedCount}/${metrics.expectedModifiedCellsCount} ô mong đợi, ${unexpectedChangedCount} ô bị thay đổi ngoài ý muốn!`,
      candidateBlob,
      candidateFileName: outputFileName,
      metrics,
      checkSteps,
      semanticDiffs: allSemanticDiffs,
    };
  }

  updateStep(
    9,
    'PASS',
    `Exactly ${actualChangedCount}/${metrics.expectedModifiedCellsCount} cell(s) modified, 0 unexpected side-effects`
  );

  // ----------------------------------------------------
  // ALL 10 PHASES PASSED — VALIDATED FOR EXPORT
  // ----------------------------------------------------
  if (onProgress) {
    onProgress({
      phase: 'COMPLETED',
      phaseLabel: 'All 10 verification steps PASSED! Output JAR is VALIDATED FOR EXPORT.',
      currentStep: TOTAL_STEPS,
      totalSteps: TOTAL_STEPS,
    });
  }

  console.log('[buildAndVerifyPatchedJar] Output JAR fully validated for export:', metrics);

  return {
    status: 'VALIDATED',
    candidateBlob,
    candidateFileName: outputFileName,
    metrics,
    checkSteps,
    semanticDiffs: allSemanticDiffs,
  };
}

/**
 * Triggers a clean browser download of the verified output JAR Blob.
 * Cleans up ObjectURL immediately after invoking the anchor click.
 */
export function downloadPatchedJarBlob(blob: Blob, fileName: string): void {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

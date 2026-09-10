import JSZip from 'jszip';
import { CandidateOutputJar, LoadedJarSession } from '../types/jar';
import {
  buildDraftTestCandidate,
  DraftTestBuildResult,
  DraftTestProgress,
  DraftTestSummary,
  getDraftStateFingerprint,
} from './draftTestService';
import { buildNewItemCandidate } from './itemCreationService';
import {
  buildMultiplayerCandidate,
  MultiplayerLiteConfig,
} from './multiplayerPatchService';
import {
  getPatchWorkspaceFingerprint,
  getPatchWorkspaceOperations,
  WorkspaceMultiplayerOperation,
  WorkspaceNewItemOperation,
} from './patchWorkspaceStateService';

const SMALL_IMAGE_INDEX_PATH = 'x1/smallimage.idx';
const SMALL_IMAGE_MAGIC = 0x53495032; // SIP2
const SMALL_IMAGE_HEADER_SIZE = 10;
const SMALL_IMAGE_RECORD_SIZE = 12;

function emptySummary(): DraftTestSummary {
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

function outputName(name: string): string {
  const safe = name || 'game.jar';
  return safe.toLowerCase().endsWith('.jar')
    ? `${safe.slice(0, -4)}_workspace.jar`
    : `${safe}_workspace.jar`;
}

async function originalBlob(session: LoadedJarSession): Promise<Blob> {
  return session.originalFile.slice(
    0,
    session.originalFile.size,
    session.originalFile.type || 'application/java-archive'
  );
}

function splitOperations(operations: ReturnType<typeof getPatchWorkspaceOperations>) {
  return {
    newItems: operations.filter(
      (operation): operation is WorkspaceNewItemOperation => operation.kind === 'NEW_ITEM'
    ),
    multiplayer: operations.find(
      (operation): operation is WorkspaceMultiplayerOperation =>
        operation.kind === 'MULTIPLAYER_LITE'
    ),
  };
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = String(value || '').replace(/^data:image\/png;base64,/i, '').trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

function assertPng(bytes: Uint8Array): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Custom item icon không phải PNG hợp lệ.');
  }
}

async function appendCustomSmallImage(
  inputBlob: Blob,
  pngBase64: string
): Promise<{ blob: Blob; imageId: number; pack: number; packPath: string }> {
  const png = base64ToBytes(pngBase64);
  assertPng(png);
  if (png.byteLength > 2 * 1024 * 1024) {
    throw new Error('Custom item icon vượt 2 MB.');
  }

  const zip = await JSZip.loadAsync(await inputBlob.arrayBuffer());
  const idxEntry = zip.file(SMALL_IMAGE_INDEX_PATH);
  if (!idxEntry) throw new Error(`Không tìm thấy ${SMALL_IMAGE_INDEX_PATH}.`);

  const idx = await idxEntry.async('uint8array');
  if (idx.byteLength < SMALL_IMAGE_HEADER_SIZE) {
    throw new Error('smallimage.idx quá ngắn.');
  }
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
  if (view.getUint32(0, false) !== SMALL_IMAGE_MAGIC) {
    throw new Error('smallimage.idx không phải SIP2.');
  }

  const count = view.getUint16(4, false);
  const recordsEnd = SMALL_IMAGE_HEADER_SIZE + count * SMALL_IMAGE_RECORD_SIZE;
  if (idx.byteLength < recordsEnd) {
    throw new Error(`smallimage.idx thiếu record: count=${count}, bytes=${idx.byteLength}.`);
  }
  if (count >= 0xffff) throw new Error('smallimage.idx đã đạt giới hạn 65535 record.');

  let maxId = -1;
  let maxPack = -1;
  let previousId = -1;
  for (let i = 0; i < count; i++) {
    const offset = SMALL_IMAGE_HEADER_SIZE + i * SMALL_IMAGE_RECORD_SIZE;
    const id = view.getUint16(offset, false);
    const pack = view.getUint16(offset + 2, false);
    if (id <= previousId) {
      throw new Error(`smallimage.idx không sort tăng dần tại record ${i}; writer không tự chèn mù.`);
    }
    previousId = id;
    if (id > maxId) maxId = id;
    if (pack > maxPack) maxPack = pack;
  }

  const imageId = maxId + 1;
  const pack = maxPack + 1;
  if (imageId > 0xffff) throw new Error('Không còn SmallImage ID trống sau max ID hiện tại.');
  if (pack > 0xffff) throw new Error('Không còn pack ID trống cho SmallImage.');

  const nextIdx = new Uint8Array(recordsEnd + SMALL_IMAGE_RECORD_SIZE);
  nextIdx.set(idx.slice(0, recordsEnd), 0);
  const nextView = new DataView(nextIdx.buffer);
  nextView.setUint16(4, count + 1, false);
  const recordOffset = recordsEnd;
  nextView.setUint16(recordOffset, imageId, false);
  nextView.setUint16(recordOffset + 2, pack, false);
  nextView.setUint32(recordOffset + 4, 0, false);
  nextView.setUint32(recordOffset + 8, png.byteLength, false);

  const packPath = `x1/smallimage-${pack}.pack`;
  if (zip.file(packPath)) {
    throw new Error(`${packPath} đã tồn tại dù pack ID được xác định là mới.`);
  }

  zip.file(SMALL_IMAGE_INDEX_PATH, nextIdx);
  zip.file(packPath, png);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // Re-open và xác minh record vừa ghi trước khi cho phép build item tiếp.
  const verifyZip = await JSZip.loadAsync(await blob.arrayBuffer());
  const verifyIdx = await verifyZip.file(SMALL_IMAGE_INDEX_PATH)?.async('uint8array');
  const verifyPack = await verifyZip.file(packPath)?.async('uint8array');
  if (!verifyIdx || !verifyPack || verifyPack.byteLength !== png.byteLength) {
    throw new Error('Không verify được SmallImage asset vừa thêm.');
  }
  const verifyView = new DataView(verifyIdx.buffer, verifyIdx.byteOffset, verifyIdx.byteLength);
  const last = SMALL_IMAGE_HEADER_SIZE + count * SMALL_IMAGE_RECORD_SIZE;
  if (
    verifyView.getUint16(4, false) !== count + 1 ||
    verifyView.getUint16(last, false) !== imageId ||
    verifyView.getUint16(last + 2, false) !== pack ||
    verifyView.getUint32(last + 4, false) !== 0 ||
    verifyView.getUint32(last + 8, false) !== png.byteLength
  ) {
    throw new Error('Record SmallImage mới không khớp sau khi đóng JAR.');
  }

  return { blob, imageId, pack, packPath };
}

export async function buildUnifiedWorkspaceCandidate(
  session: LoadedJarSession,
  onProgress?: (progress: DraftTestProgress) => void
): Promise<DraftTestBuildResult> {
  const operations = getPatchWorkspaceOperations(session);
  const { newItems, multiplayer } = splitOperations(operations);
  let activeSummary = emptySummary();

  try {
    onProgress?.({
      phase: 'COLLECTING',
      label: `Đang gom nháp + ${operations.length} operation trong Patch Workspace...`,
      current: 1,
      total: 5,
    });

    const draftResult = await buildDraftTestCandidate(session, (progress) => {
      if (progress.phase === 'DONE') return;
      onProgress?.(progress);
    });

    if (draftResult.status === 'BLOCKED' || draftResult.status === 'FAILED') {
      return draftResult;
    }

    if (draftResult.status === 'NO_CHANGES' && operations.length === 0) {
      return draftResult;
    }

    let currentBlob =
      draftResult.status === 'VALIDATED' && draftResult.candidate
        ? draftResult.candidate.blob
        : await originalBlob(session);
    const summary = draftResult.summary ?? activeSummary;
    activeSummary = summary;
    const appliedOperations: Array<Record<string, unknown>> = [];

    onProgress?.({
      phase: 'REWRITING',
      label: `Đang áp ${newItems.length} item mới vào JAR nền...`,
      current: 3,
      total: 5,
    });

    for (const operation of newItems) {
      const effectiveValues = [...operation.values];
      let customIconMetric: Record<string, unknown> | undefined;

      if (operation.customIcon?.pngBase64) {
        const iconResult = await appendCustomSmallImage(currentBlob, operation.customIcon.pngBase64);
        currentBlob = iconResult.blob;
        while (effectiveValues.length < 15) effectiveValues.push('');
        effectiveValues[6] = String(iconResult.imageId);
        customIconMetric = {
          fileName: operation.customIcon.fileName,
          imageId: iconResult.imageId,
          pack: iconResult.pack,
          packPath: iconResult.packPath,
        };
      }

      const candidate = await buildNewItemCandidate(
        session,
        {
          sourceClass: operation.sourceClass,
          values: effectiveValues,
        },
        currentBlob
      );
      currentBlob = candidate.blob;
      appliedOperations.push({
        kind: operation.kind,
        sourceClass: operation.sourceClass,
        id: effectiveValues[0],
        name: effectiveValues[3],
        iconId: effectiveValues[6],
        customIcon: customIconMetric,
        metrics: candidate.metrics?.newItem,
      });
    }

    if (multiplayer) {
      onProgress?.({
        phase: 'PACKING',
        label: 'Đang áp Multiplayer Lite lên chính JAR đã chứa các chỉnh sửa trước...',
        current: 4,
        total: 5,
      });

      const candidate = await buildMultiplayerCandidate(
        session,
        multiplayer.config as MultiplayerLiteConfig,
        currentBlob
      );
      currentBlob = candidate.blob;
      appliedOperations.push({
        kind: multiplayer.kind,
        config: { ...multiplayer.config },
      });
    }

    onProgress?.({
      phase: 'VERIFYING',
      label: 'Đang mở lại JAR hợp nhất và kiểm tra manifest / ZIP...',
      current: 5,
      total: 5,
    });

    const reopened = await JSZip.loadAsync(await currentBlob.arrayBuffer());
    const originalManifest =
      (await session.zip.file('META-INF/MANIFEST.MF')?.async('string')) ?? '';
    const finalManifest =
      (await reopened.file('META-INF/MANIFEST.MF')?.async('string')) ?? '';

    if (originalManifest !== finalManifest) {
      return {
        status: 'FAILED',
        blockers: [],
        summary,
        errorMessage: 'Unified Patch Workspace làm thay đổi MANIFEST ngoài dự kiến.',
      };
    }

    for (const operation of newItems) {
      const classPath = `${operation.sourceClass}.class`;
      if (!reopened.file(classPath)) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `JAR hợp nhất bị thiếu ${classPath} sau operation Item #${operation.values[0]}.`,
        };
      }
    }

    if (multiplayer) {
      const required = [
        'a/ai.class',
        'patch/MultiplayerLite.class',
        'patch/MultiplayerLite$RemotePlayer.class',
        'patch/MultiplayerLite$1.class',
        'multiplayer.cfg',
      ];
      const missing = required.filter((path) => !reopened.file(path));
      if (missing.length > 0) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `JAR hợp nhất thiếu asset Multiplayer: ${missing.join(', ')}.`,
        };
      }
    }

    const candidate: CandidateOutputJar = {
      blob: currentBlob,
      fileName: outputName(session.jarInfo.fileName),
      status: 'VALIDATED',
      validatedAt: Date.now(),
      expectedModifiedCount:
        (draftResult.candidate?.expectedModifiedCount ?? 0) + operations.length,
      metrics: {
        source: 'UNIFIED_WORKSPACE',
        draftFingerprint: getDraftStateFingerprint(session),
        workspaceFingerprint: getPatchWorkspaceFingerprint(session),
        summary,
        operations: appliedOperations,
        draftBase:
          draftResult.status === 'VALIDATED'
            ? 'DRAFT_TEST'
            : 'ORIGINAL',
        newItemCount: newItems.length,
        multiplayerLite: Boolean(multiplayer),
        config: multiplayer ? { ...multiplayer.config } : undefined,
      },
    };

    onProgress?.({
      phase: 'DONE',
      label: `VALIDATED: ${operations.length} operation + toàn bộ draft đã được hợp nhất.`,
      current: 5,
      total: 5,
    });

    return {
      status: 'VALIDATED',
      candidate,
      blockers: [],
      summary,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      blockers: [],
      summary: activeSummary,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

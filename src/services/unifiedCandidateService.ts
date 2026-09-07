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

function emptySummary(): DraftTestSummary {
  return {
    itemDrafts: 0,
    npcDrafts: 0,
    mapDrafts: 0,
    mobDrafts: 0,
    skillDrafts: 0,
    partDrafts: 0,
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
    const candidate = await buildNewItemCandidate(
      session,
      {
        sourceClass: operation.sourceClass,
        values: operation.values,
      },
      currentBlob
    );
    currentBlob = candidate.blob;
    appliedOperations.push({
      kind: operation.kind,
      sourceClass: operation.sourceClass,
      id: operation.values[0],
      name: operation.values[3],
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

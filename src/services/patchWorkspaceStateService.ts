import { LoadedJarSession } from '../types/jar';

export interface WorkspaceMultiplayerConfig {
  enabled: boolean;
  host: string;
  port: number;
  name: string;
}

export interface WorkspaceNewItemOperation {
  kind: 'NEW_ITEM';
  id: string;
  sourceClass: string;
  values: string[];
  createdAt: number;
}

export interface WorkspaceMultiplayerOperation {
  kind: 'MULTIPLAYER_LITE';
  id: 'multiplayer-lite';
  config: WorkspaceMultiplayerConfig;
  createdAt: number;
}

export type PatchWorkspaceOperation =
  | WorkspaceNewItemOperation
  | WorkspaceMultiplayerOperation;

const store = new WeakMap<LoadedJarSession, PatchWorkspaceOperation[]>();

function invalidateCandidate(session: LoadedJarSession): void {
  if (session.candidateOutput?.status === 'VALIDATED') {
    session.candidateOutput.status = 'STALE';
  }
}

function cloneOperation(operation: PatchWorkspaceOperation): PatchWorkspaceOperation {
  if (operation.kind === 'NEW_ITEM') {
    return {
      ...operation,
      values: [...operation.values],
    };
  }

  return {
    ...operation,
    config: { ...operation.config },
  };
}

function getMutable(session: LoadedJarSession): PatchWorkspaceOperation[] {
  let operations = store.get(session);
  if (!operations) {
    operations = [];
    store.set(session, operations);
  }
  return operations;
}

function normalizeSourceClass(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\.class$/i, '')
    .replace(/\./g, '/');
}

export function getPatchWorkspaceOperations(
  session: LoadedJarSession
): PatchWorkspaceOperation[] {
  return getMutable(session).map(cloneOperation);
}

export function getPatchWorkspaceOperationCount(session: LoadedJarSession): number {
  return getMutable(session).length;
}

export function getQueuedNewItemIds(session: LoadedJarSession): string[] {
  return getMutable(session)
    .filter((operation): operation is WorkspaceNewItemOperation => operation.kind === 'NEW_ITEM')
    .map((operation) => operation.values[0] ?? '')
    .filter(Boolean);
}

export function isNewItemIdQueued(session: LoadedJarSession, id: string): boolean {
  return getMutable(session).some(
    (operation) => operation.kind === 'NEW_ITEM' && operation.values[0] === String(id)
  );
}

export function queueNewItemOperation(
  session: LoadedJarSession,
  input: { sourceClass: string; values: string[] }
): WorkspaceNewItemOperation {
  const sourceClass = normalizeSourceClass(input.sourceClass);
  const values = input.values.map((value) => String(value ?? ''));
  const itemId = values[0] ?? '';

  if (!itemId) throw new Error('Item mới phải có ID.');
  if (isNewItemIdQueued(session, itemId)) {
    throw new Error(`Item ID ${itemId} đã có trong Patch Workspace.`);
  }

  const operation: WorkspaceNewItemOperation = {
    kind: 'NEW_ITEM',
    id: `new-item:${sourceClass}:${itemId}:${Date.now()}`,
    sourceClass,
    values,
    createdAt: Date.now(),
  };

  getMutable(session).push(operation);
  invalidateCandidate(session);
  return cloneOperation(operation) as WorkspaceNewItemOperation;
}

export function setMultiplayerWorkspaceOperation(
  session: LoadedJarSession,
  config: WorkspaceMultiplayerConfig
): WorkspaceMultiplayerOperation {
  const operations = getMutable(session);
  const next: WorkspaceMultiplayerOperation = {
    kind: 'MULTIPLAYER_LITE',
    id: 'multiplayer-lite',
    config: {
      enabled: config.enabled !== false,
      host: String(config.host || '').trim(),
      port: Math.round(Number(config.port) || 0),
      name: String(config.name || ''),
    },
    createdAt: Date.now(),
  };

  const index = operations.findIndex((operation) => operation.kind === 'MULTIPLAYER_LITE');
  if (index >= 0) operations[index] = next;
  else operations.push(next);
  invalidateCandidate(session);

  return cloneOperation(next) as WorkspaceMultiplayerOperation;
}

export function removePatchWorkspaceOperation(
  session: LoadedJarSession,
  operationId: string
): void {
  const operations = getMutable(session);
  const index = operations.findIndex((operation) => operation.id === operationId);
  if (index >= 0) {
    operations.splice(index, 1);
    invalidateCandidate(session);
  }
}

export function clearPatchWorkspace(session: LoadedJarSession): void {
  store.delete(session);
  invalidateCandidate(session);
}

export function exportPatchWorkspaceOperations(
  session: LoadedJarSession
): PatchWorkspaceOperation[] {
  return getPatchWorkspaceOperations(session);
}

export function importPatchWorkspaceOperations(
  session: LoadedJarSession,
  operations: PatchWorkspaceOperation[]
): void {
  const safe: PatchWorkspaceOperation[] = [];

  for (const raw of operations ?? []) {
    if (!raw || typeof raw !== 'object') continue;

    if (raw.kind === 'NEW_ITEM' && Array.isArray(raw.values)) {
      safe.push({
        kind: 'NEW_ITEM',
        id: String(raw.id || `new-item:${Date.now()}`),
        sourceClass: normalizeSourceClass(raw.sourceClass),
        values: raw.values.map((value) => String(value ?? '')),
        createdAt: Number(raw.createdAt) || Date.now(),
      });
    } else if (raw.kind === 'MULTIPLAYER_LITE' && raw.config) {
      safe.push({
        kind: 'MULTIPLAYER_LITE',
        id: 'multiplayer-lite',
        config: {
          enabled: raw.config.enabled !== false,
          host: String(raw.config.host || '').trim(),
          port: Math.round(Number(raw.config.port) || 0),
          name: String(raw.config.name || ''),
        },
        createdAt: Number(raw.createdAt) || Date.now(),
      });
    }
  }

  store.set(session, safe);
}

export function getPatchWorkspaceFingerprint(session: LoadedJarSession): string {
  const normalized = getMutable(session)
    .map((operation) => {
      if (operation.kind === 'NEW_ITEM') {
        return {
          kind: operation.kind,
          sourceClass: operation.sourceClass,
          values: operation.values,
        };
      }
      return {
        kind: operation.kind,
        config: operation.config,
      };
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return JSON.stringify(normalized);
}

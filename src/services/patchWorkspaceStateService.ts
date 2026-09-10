import { LoadedJarSession } from '../types/jar';
import { ItemOptionOverride } from '../types/item';

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
  customIcon?: {
    fileName: string;
    pngBase64: string;
  };
  /**
   * ItemOption runtime dành riêng cho item mới. Các option này được đóng chung
   * vào PanelItemOptionRuntime ngay trong Test workspace / Export JAR.
   */
  optionOverrides?: ItemOptionOverride[];
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

function normalizeOptions(input: ItemOptionOverride[] | undefined): ItemOptionOverride[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<number, ItemOptionOverride>();
  for (const raw of input) {
    const optionId = Math.round(Number(raw?.optionId));
    const param = Math.round(Number(raw?.param));
    if (!Number.isInteger(optionId) || optionId < 0 || optionId > 32767) continue;
    if (!Number.isInteger(param) || param < -2147483648 || param > 2147483647) continue;
    byId.set(optionId, {
      optionId,
      param,
      enabled: raw?.enabled !== false,
      note: String(raw?.note || '').slice(0, 300),
    });
  }
  return [...byId.values()].sort((a, b) => a.optionId - b.optionId);
}

function normalizeCustomIcon(input: WorkspaceNewItemOperation['customIcon'] | undefined): WorkspaceNewItemOperation['customIcon'] | undefined {
  if (!input) return undefined;
  const pngBase64 = String(input.pngBase64 || '').replace(/^data:image\/png;base64,/i, '').trim();
  if (!pngBase64 || pngBase64.length > 4_000_000) return undefined;
  return {
    fileName: String(input.fileName || 'item-icon.png').slice(0, 180),
    pngBase64,
  };
}

function cloneOperation(operation: PatchWorkspaceOperation): PatchWorkspaceOperation {
  if (operation.kind === 'NEW_ITEM') {
    return {
      ...operation,
      values: [...operation.values],
      customIcon: normalizeCustomIcon(operation.customIcon),
      optionOverrides: normalizeOptions(operation.optionOverrides).map((option) => ({ ...option })),
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
  input: { sourceClass: string; values: string[]; optionOverrides?: ItemOptionOverride[]; customIcon?: WorkspaceNewItemOperation['customIcon'] }
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
    customIcon: normalizeCustomIcon(input.customIcon),
    optionOverrides: normalizeOptions(input.optionOverrides),
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
        customIcon: normalizeCustomIcon(raw.customIcon),
        optionOverrides: normalizeOptions(raw.optionOverrides),
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
          customIcon: operation.customIcon ? { fileName: operation.customIcon.fileName, pngBase64: operation.customIcon.pngBase64 } : undefined,
          optionOverrides: normalizeOptions(operation.optionOverrides),
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

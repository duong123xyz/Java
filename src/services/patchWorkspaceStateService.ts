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


export interface WorkspaceNewBossOperation {
  kind: 'NEW_BOSS';
  id: string;
  cloneBossIndex: number;
  charId: number;
  mapId: number;
  name: string;
  head: number;
  body: number;
  leg: number;
  hp: number;
  damage: number;
  spawnX: number;
  createdAt: number;
}

export interface WorkspaceMultiplayerOperation {
  kind: 'MULTIPLAYER_LITE';
  id: 'multiplayer-lite';
  config: WorkspaceMultiplayerConfig;
  createdAt: number;
}

export interface WorkspaceQuestCellEdit {
  sourceClass: 'a/a/a/Z' | 'a/a/a/ab';
  sourceField: 'u';
  rowIndex: number;
  columnIndex: number;
  value: string;
}

export interface WorkspaceQuestRewardOverride {
  questId: number;
  enabled: boolean;
  gold: number;
  power: number;
  potential: number;
  gems: number;
  itemId: number | null;
  itemQuantity: number;
}

export interface WorkspaceQuestPatchOperation {
  kind: 'QUEST_PATCH';
  id: 'quest-patch';
  edits: WorkspaceQuestCellEdit[];
  rewards: WorkspaceQuestRewardOverride[];
  createdAt: number;
}

export type PatchWorkspaceOperation =
  | WorkspaceNewItemOperation
  | WorkspaceNewBossOperation
  | WorkspaceMultiplayerOperation
  | WorkspaceQuestPatchOperation;

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

function normalizeQuestEdits(input: WorkspaceQuestCellEdit[] | undefined): WorkspaceQuestCellEdit[] {
  if (!Array.isArray(input)) return [];
  const dedupe = new Map<string, WorkspaceQuestCellEdit>();
  for (const raw of input) {
    const sourceClass = raw?.sourceClass;
    const rowIndex = Math.round(Number(raw?.rowIndex));
    const columnIndex = Math.round(Number(raw?.columnIndex));
    if (sourceClass !== 'a/a/a/Z' && sourceClass !== 'a/a/a/ab') continue;
    const maxColumn = sourceClass === 'a/a/a/Z' ? 2 : 6;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 10000) continue;
    if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex > maxColumn) continue;
    const edit: WorkspaceQuestCellEdit = {
      sourceClass,
      sourceField: 'u',
      rowIndex,
      columnIndex,
      value: String(raw?.value ?? '').slice(0, 20000),
    };
    dedupe.set(`${sourceClass}|${rowIndex}|${columnIndex}`, edit);
  }
  return [...dedupe.values()].sort((a, b) =>
    a.sourceClass.localeCompare(b.sourceClass) || a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex
  );
}

function normalizeQuestRewards(
  input: WorkspaceQuestRewardOverride[] | undefined
): WorkspaceQuestRewardOverride[] {
  if (!Array.isArray(input)) return [];
  const byQuest = new Map<number, WorkspaceQuestRewardOverride>();
  const safeLong = (value: unknown) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, n);
  };
  for (const raw of input) {
    const questId = Math.round(Number(raw?.questId));
    if (!Number.isInteger(questId) || questId < 0 || questId > 30) continue;
    const itemIdRaw = raw?.itemId == null || raw?.itemId === ('' as any)
      ? null
      : Math.round(Number(raw.itemId));
    const itemId = itemIdRaw == null || !Number.isInteger(itemIdRaw) || itemIdRaw < 0 || itemIdRaw > 32767
      ? null
      : itemIdRaw;
    const itemQuantity = Math.max(1, Math.min(2147483647, Math.round(Number(raw?.itemQuantity) || 1)));
    const gems = Math.max(0, Math.min(2147483647, Math.round(Number(raw?.gems) || 0)));
    byQuest.set(questId, {
      questId,
      enabled: raw?.enabled === true,
      gold: safeLong(raw?.gold),
      power: safeLong(raw?.power),
      potential: safeLong(raw?.potential),
      gems,
      itemId,
      itemQuantity,
    });
  }
  return [...byQuest.values()].sort((a, b) => a.questId - b.questId);
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

  if (operation.kind === 'NEW_BOSS') {
    return { ...operation };
  }

  if (operation.kind === 'QUEST_PATCH') {
    return {
      ...operation,
      edits: normalizeQuestEdits(operation.edits).map((edit) => ({ ...edit })),
      rewards: normalizeQuestRewards(operation.rewards).map((reward) => ({ ...reward })),
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

export function getQueuedNewBosses(session: LoadedJarSession): WorkspaceNewBossOperation[] {
  return getMutable(session)
    .filter((operation): operation is WorkspaceNewBossOperation => operation.kind === 'NEW_BOSS')
    .map((operation) => ({ ...operation }));
}

export function isNewBossCharIdQueued(session: LoadedJarSession, charId: number): boolean {
  return getMutable(session).some(
    (operation) => operation.kind === 'NEW_BOSS' && operation.charId === Math.round(Number(charId))
  );
}

export function queueNewBossOperation(
  session: LoadedJarSession,
  input: Omit<WorkspaceNewBossOperation, 'kind' | 'id' | 'createdAt'>
): WorkspaceNewBossOperation {
  const charId = Math.round(Number(input.charId));
  const mapId = Math.round(Number(input.mapId));
  const hp = Math.round(Number(input.hp));
  const damage = Math.round(Number(input.damage));
  const spawnX = Math.round(Number(input.spawnX));
  if (!Number.isInteger(charId) || charId >= 0 || charId < -2147483648) {
    throw new Error('Char ID boss mới phải là số nguyên âm.');
  }
  if (isNewBossCharIdQueued(session, charId)) {
    throw new Error(`Char ID ${charId} đã có trong Patch Workspace.`);
  }
  if (!Number.isInteger(mapId) || mapId < 0 || mapId > 32767) throw new Error('Map ID không hợp lệ.');
  if (!Number.isFinite(hp) || hp < 1 || hp > Number.MAX_SAFE_INTEGER) throw new Error('HP boss không hợp lệ.');
  if (!Number.isInteger(damage) || damage < 1 || damage > 2147483647) throw new Error('Sát thương boss không hợp lệ.');
  if (!Number.isInteger(spawnX) || spawnX < 0 || spawnX > 2147483647) throw new Error('Spawn X không hợp lệ.');
  const operation: WorkspaceNewBossOperation = {
    kind: 'NEW_BOSS',
    id: `new-boss:${charId}:${Date.now()}`,
    cloneBossIndex: Math.max(0, Math.round(Number(input.cloneBossIndex) || 0)),
    charId,
    mapId,
    name: String(input.name || `Boss ${charId}`).slice(0, 120),
    head: Math.max(0, Math.round(Number(input.head) || 0)),
    body: Math.max(0, Math.round(Number(input.body) || 0)),
    leg: Math.max(0, Math.round(Number(input.leg) || 0)),
    hp,
    damage,
    spawnX,
    createdAt: Date.now(),
  };
  getMutable(session).push(operation);
  invalidateCandidate(session);
  return { ...operation };
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

export function getQuestWorkspaceOperation(
  session: LoadedJarSession
): WorkspaceQuestPatchOperation | null {
  const operation = getMutable(session).find(
    (item): item is WorkspaceQuestPatchOperation => item.kind === 'QUEST_PATCH'
  );
  return operation ? (cloneOperation(operation) as WorkspaceQuestPatchOperation) : null;
}

export function setQuestWorkspaceOperation(
  session: LoadedJarSession,
  edits: WorkspaceQuestCellEdit[],
  rewards?: WorkspaceQuestRewardOverride[]
): WorkspaceQuestPatchOperation | null {
  const operations = getMutable(session);
  const normalized = normalizeQuestEdits(edits);
  const index = operations.findIndex((operation) => operation.kind === 'QUEST_PATCH');
  const previousRewards = index >= 0 && operations[index].kind === 'QUEST_PATCH'
    ? (operations[index] as WorkspaceQuestPatchOperation).rewards
    : [];
  const normalizedRewards = normalizeQuestRewards(rewards ?? previousRewards);
  const activeRewards = normalizedRewards.filter((reward) => reward.enabled);

  if (normalized.length === 0 && activeRewards.length === 0) {
    if (index >= 0) operations.splice(index, 1);
    invalidateCandidate(session);
    return null;
  }

  const next: WorkspaceQuestPatchOperation = {
    kind: 'QUEST_PATCH',
    id: 'quest-patch',
    edits: normalized,
    rewards: normalizedRewards,
    createdAt: Date.now(),
  };
  if (index >= 0) operations[index] = next;
  else operations.push(next);
  invalidateCandidate(session);
  return cloneOperation(next) as WorkspaceQuestPatchOperation;
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
    } else if (raw.kind === 'NEW_BOSS') {
      const boss = raw as WorkspaceNewBossOperation;
      const charId = Math.round(Number(boss.charId));
      if (charId < 0) {
        safe.push({
          kind: 'NEW_BOSS',
          id: String(boss.id || `new-boss:${charId}:${Date.now()}`),
          cloneBossIndex: Math.max(0, Math.round(Number(boss.cloneBossIndex) || 0)),
          charId,
          mapId: Math.max(0, Math.round(Number(boss.mapId) || 0)),
          name: String(boss.name || `Boss ${charId}`).slice(0, 120),
          head: Math.max(0, Math.round(Number(boss.head) || 0)),
          body: Math.max(0, Math.round(Number(boss.body) || 0)),
          leg: Math.max(0, Math.round(Number(boss.leg) || 0)),
          hp: Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(boss.hp) || 1))),
          damage: Math.max(1, Math.min(2147483647, Math.round(Number(boss.damage) || 1))),
          spawnX: Math.max(0, Math.round(Number(boss.spawnX) || 0)),
          createdAt: Number(boss.createdAt) || Date.now(),
        });
      }
    } else if (raw.kind === 'QUEST_PATCH' && Array.isArray(raw.edits)) {
      const edits = normalizeQuestEdits(raw.edits);
      const rewards = normalizeQuestRewards((raw as WorkspaceQuestPatchOperation).rewards);
      if (edits.length > 0 || rewards.some((reward) => reward.enabled)) {
        safe.push({
          kind: 'QUEST_PATCH',
          id: 'quest-patch',
          edits,
          rewards,
          createdAt: Number(raw.createdAt) || Date.now(),
        });
      }
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
      if (operation.kind === 'NEW_BOSS') {
    return { ...operation };
  }

  if (operation.kind === 'QUEST_PATCH') {
        return {
          kind: operation.kind,
          edits: normalizeQuestEdits(operation.edits),
          rewards: normalizeQuestRewards(operation.rewards),
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

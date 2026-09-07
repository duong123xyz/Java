import { LoadedJarSession } from '../types/jar';
import { ItemDraft } from '../types/item';
import {
  exportMapDrafts,
  importMapDrafts,
  MapDraft,
} from './mapDataService';
import {
  exportMobDrafts,
  importMobDrafts,
  MobDraft,
} from './mobDataService';
import {
  BossDraft,
  exportBossDrafts,
  importBossDrafts,
} from './bossDataService';
import {
  CharacterDraft,
  CharacterPlanet,
  exportCharacterDrafts,
  importCharacterDrafts,
} from './characterDataService';
import {
  exportGameMechanicsDraft,
  GameMechanicsDraft,
  importGameMechanicsDraft,
} from './gameMechanicsService';
import {
  exportSkillDrafts,
  importSkillDrafts,
  SkillDraft,
} from './skillDataService';
import {
  exportPartDrafts,
  importPartDrafts,
  PartDraft,
} from './partDataService';
import {
  exportPatchWorkspaceOperations,
  importPatchWorkspaceOperations,
  PatchWorkspaceOperation,
} from './patchWorkspaceStateService';

const DB_NAME = 'nro-studio-workspace';
const DB_VERSION = 1;
const SOURCE_STORE = 'source';
const DRAFT_STORE = 'drafts';
const LAST_KEY = 'last';

export interface WorkspaceDirtyCounts {
  items: number;
  npcs: number;
  maps: number;
  mobs: number;
  characters: number;
  bosses: number;
  mechanics: number;
  skills: number;
  parts: number;
}

interface PersistedJarSource {
  key: typeof LAST_KEY;
  version: 1;
  fileName: string;
  fileType: string;
  fileSize: number;
  lastModified: number;
  blob: Blob;
  savedAt: number;
}

interface PersistedDraftSnapshot {
  key: typeof LAST_KEY;
  version: 1;
  source: {
    fileName: string;
    fileSize: number;
    lastModified: number;
  };
  itemDrafts: Array<[string, ItemDraft]>;
  npcDrafts: Record<string, any>;
  mapDrafts: Array<[number, MapDraft]>;
  mobDrafts: Array<[number, MobDraft]>;
  bossDrafts: Array<[number, BossDraft]>;
  characterDrafts: Array<[CharacterPlanet, CharacterDraft]>;
  mechanicsDraft: GameMechanicsDraft;
  skillDrafts: Array<[number, SkillDraft]>;
  partDrafts: Array<[number, PartDraft]>;
  patchWorkspaceOperations: PatchWorkspaceOperation[];
  counts: WorkspaceDirtyCounts;
  savedAt: number;
}

export interface RestoredWorkspaceDrafts {
  restored: boolean;
  counts: WorkspaceDirtyCounts;
  savedAt?: number;
}

const EMPTY_COUNTS: WorkspaceDirtyCounts = {
  items: 0,
  npcs: 0,
  maps: 0,
  mobs: 0,
  characters: 0,
  bosses: 0,
  mechanics: 0,
  skills: 0,
  parts: 0,
};

let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDraftSave:
  | { session: LoadedJarSession; counts: WorkspaceDirtyCounts }
  | null = null;

function cloneCounts(counts?: Partial<WorkspaceDirtyCounts>): WorkspaceDirtyCounts {
  return {
    items: Math.max(0, counts?.items ?? 0),
    npcs: Math.max(0, counts?.npcs ?? 0),
    maps: Math.max(0, counts?.maps ?? 0),
    mobs: Math.max(0, counts?.mobs ?? 0),
    characters: Math.max(0, counts?.characters ?? 0),
    bosses: Math.max(0, counts?.bosses ?? 0),
    mechanics: Math.max(0, counts?.mechanics ?? 0),
    skills: Math.max(0, counts?.skills ?? 0),
    parts: Math.max(0, counts?.parts ?? 0),
  };
}

function canUseIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error('IndexedDB không khả dụng trong trình duyệt hiện tại.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SOURCE_STORE)) {
        db.createObjectStore(SOURCE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Không mở được IndexedDB.'));
  });
}

async function dbPut(storeName: string, value: any): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted.'));
    });
  } finally {
    db.close();
  }
}

async function dbGet<T>(storeName: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(LAST_KEY);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB read failed.'));
    });
  } finally {
    db.close();
  }
}

async function dbDelete(storeName: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(LAST_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed.'));
    });
  } finally {
    db.close();
  }
}

function sourceIdentity(session: LoadedJarSession) {
  return {
    fileName: session.originalFile.name || session.jarInfo.fileName,
    fileSize: session.originalFile.size,
    lastModified: session.originalFile.lastModified,
  };
}

function sourceMatches(
  session: LoadedJarSession,
  source: PersistedDraftSnapshot['source']
): boolean {
  const current = sourceIdentity(session);
  return (
    current.fileName === source.fileName &&
    current.fileSize === source.fileSize
  );
}

export async function saveWorkspaceSource(
  session: LoadedJarSession
): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Không chặn autosave nếu browser không cho persistent storage.
  }

  const file = session.originalFile;
  const record: PersistedJarSource = {
    key: LAST_KEY,
    version: 1,
    fileName: file.name || session.jarInfo.fileName,
    fileType: file.type || 'application/java-archive',
    fileSize: file.size,
    lastModified: file.lastModified,
    blob: file.slice(0, file.size, file.type || 'application/java-archive'),
    savedAt: Date.now(),
  };
  await dbPut(SOURCE_STORE, record);
}

export async function loadWorkspaceSource(): Promise<File | null> {
  const record = await dbGet<PersistedJarSource>(SOURCE_STORE);
  if (!record?.blob || !record.fileName) return null;

  if (record.blob.size !== record.fileSize) {
    await dbDelete(SOURCE_STORE);
    await dbDelete(DRAFT_STORE);
    throw new Error('Bản JAR tự lưu bị thiếu byte; workspace cũ đã được bỏ.');
  }

  return new File([record.blob], record.fileName, {
    type: record.fileType || 'application/java-archive',
    lastModified: record.lastModified,
  });
}

function cloneItemDraft(draft: ItemDraft): ItemDraft {
  return {
    ...draft,
    originalValues: [...draft.originalValues],
    values: [...draft.values],
    dirtyFields: [...draft.dirtyFields],
  };
}

function buildDraftSnapshot(
  session: LoadedJarSession,
  counts: WorkspaceDirtyCounts
): PersistedDraftSnapshot {
  const npcDrafts = { ...((session as any).gameNpcDrafts ?? {}) };

  return {
    key: LAST_KEY,
    version: 1,
    source: sourceIdentity(session),
    itemDrafts: Array.from(session.itemDrafts?.entries() ?? []).map(
      ([key, draft]) => [key, cloneItemDraft(draft)]
    ),
    npcDrafts,
    mapDrafts: exportMapDrafts(session),
    mobDrafts: exportMobDrafts(session),
    bossDrafts: exportBossDrafts(session),
    characterDrafts: exportCharacterDrafts(session),
    mechanicsDraft: exportGameMechanicsDraft(session),
    skillDrafts: exportSkillDrafts(session),
    partDrafts: exportPartDrafts(session),
    patchWorkspaceOperations: exportPatchWorkspaceOperations(session),
    counts: cloneCounts(counts),
    savedAt: Date.now(),
  };
}

export async function saveWorkspaceDrafts(
  session: LoadedJarSession,
  counts: WorkspaceDirtyCounts
): Promise<void> {
  await dbPut(DRAFT_STORE, buildDraftSnapshot(session, counts));
}

export function queueWorkspaceDraftSave(
  session: LoadedJarSession,
  counts: WorkspaceDirtyCounts,
  delayMs = 50
): void {
  pendingDraftSave = { session, counts: cloneCounts(counts) };

  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    const pending = pendingDraftSave;
    pendingDraftSave = null;
    draftSaveTimer = null;
    if (!pending) return;

    void saveWorkspaceDrafts(pending.session, pending.counts).catch((error) => {
      console.warn('[workspace persistence] draft save failed', error);
    });
  }, delayMs);
}

export async function flushWorkspaceDraftSave(): Promise<void> {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }

  const pending = pendingDraftSave;
  pendingDraftSave = null;
  if (pending) {
    await saveWorkspaceDrafts(pending.session, pending.counts);
  }
}

export async function restoreWorkspaceDrafts(
  session: LoadedJarSession
): Promise<RestoredWorkspaceDrafts> {
  const snapshot = await dbGet<PersistedDraftSnapshot>(DRAFT_STORE);
  if (!snapshot) {
    return { restored: false, counts: { ...EMPTY_COUNTS } };
  }

  if (!sourceMatches(session, snapshot.source)) {
    await dbDelete(DRAFT_STORE);
    return { restored: false, counts: { ...EMPTY_COUNTS } };
  }

  session.itemDrafts = new Map(
    (snapshot.itemDrafts ?? []).map(([key, draft]) => [
      key,
      cloneItemDraft(draft),
    ])
  );

  (session as any).gameNpcDrafts = { ...(snapshot.npcDrafts ?? {}) };
  importMapDrafts(session, snapshot.mapDrafts ?? []);
  importMobDrafts(session, snapshot.mobDrafts ?? []);
  importBossDrafts(session, snapshot.bossDrafts ?? []);
  importCharacterDrafts(session, snapshot.characterDrafts ?? []);
  importGameMechanicsDraft(session, snapshot.mechanicsDraft);
  importSkillDrafts(session, snapshot.skillDrafts ?? []);
  importPartDrafts(session, snapshot.partDrafts ?? []);
  importPatchWorkspaceOperations(
    session,
    snapshot.patchWorkspaceOperations ?? []
  );

  // candidateOutput cố ý không restore: JAR test phải build lại từ draft hiện tại.
  session.candidateOutput = undefined;

  return {
    restored: true,
    counts: cloneCounts(snapshot.counts),
    savedAt: snapshot.savedAt,
  };
}

export async function clearPersistedWorkspace(): Promise<void> {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  pendingDraftSave = null;

  if (!canUseIndexedDb()) return;
  await Promise.all([
    dbDelete(SOURCE_STORE).catch(() => undefined),
    dbDelete(DRAFT_STORE).catch(() => undefined),
  ]);
}

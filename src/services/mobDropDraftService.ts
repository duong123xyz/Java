import { LoadedJarSession } from '../types/jar';

export interface MobDropRule {
  sourceType: 'mob';
  sourceId: number;
  ruleId: string;
  itemId: number;
  chancePercent: number;
  quantityMin: number;
  quantityMax: number;
  enabled: boolean;
  note?: string;
}

interface PersistedMobDropSnapshot {
  version: 1;
  source: {
    fileName: string;
    fileSize: number;
    lastModified: number;
  };
  rules: Record<string, MobDropRule[]>;
  savedAt: number;
}

const STORAGE_PREFIX = 'nro-studio-mob-drop-drafts-v1:';
const sessionStore = new WeakMap<LoadedJarSession, Map<number, MobDropRule[]>>();

function normalizeInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function sourceIdentity(session: LoadedJarSession) {
  const file = session.originalFile;
  return {
    fileName: file.name || session.jarInfo.fileName,
    fileSize: file.size,
    lastModified: file.lastModified,
  };
}

function storageKey(session: LoadedJarSession): string {
  const source = sourceIdentity(session);
  return `${STORAGE_PREFIX}${encodeURIComponent(source.fileName)}:${source.fileSize}`;
}

function cloneRule(rule: MobDropRule): MobDropRule {
  return { ...rule };
}

function normalizeRule(mobId: number, rule: MobDropRule): MobDropRule {
  const min = Math.max(1, normalizeInt(rule.quantityMin, 1));
  const max = Math.max(min, normalizeInt(rule.quantityMax, min));
  const itemId = Math.max(0, normalizeInt(rule.itemId, 0));
  const safeRuleId =
    String(rule.ruleId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64) || `item-${itemId}`;

  return {
    sourceType: 'mob',
    sourceId: mobId,
    ruleId: safeRuleId,
    itemId,
    chancePercent: clamp(Number(rule.chancePercent), 0, 100),
    quantityMin: min,
    quantityMax: max,
    enabled: rule.enabled !== false,
    note: String(rule.note || '').slice(0, 500),
  };
}

function invalidateCandidate(session: LoadedJarSession): void {
  if (session.candidateOutput?.status === 'VALIDATED') {
    session.candidateOutput.status = 'STALE';
  }
}

function persist(session: LoadedJarSession, store: Map<number, MobDropRule[]>): void {
  if (typeof window === 'undefined') return;
  try {
    const source = sourceIdentity(session);
    const rules: Record<string, MobDropRule[]> = {};
    for (const [mobId, entries] of store) {
      rules[String(mobId)] = entries.map(cloneRule);
    }
    const snapshot: PersistedMobDropSnapshot = {
      version: 1,
      source,
      rules,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(session), JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[mob drop] Không lưu được localStorage:', error);
  }
}

function loadPersisted(session: LoadedJarSession): Map<number, MobDropRule[]> {
  const store = new Map<number, MobDropRule[]>();
  if (typeof window === 'undefined') return store;

  try {
    const raw = window.localStorage.getItem(storageKey(session));
    if (!raw) return store;
    const snapshot = JSON.parse(raw) as PersistedMobDropSnapshot;
    const source = sourceIdentity(session);
    if (
      snapshot?.version !== 1 ||
      snapshot.source?.fileName !== source.fileName ||
      snapshot.source?.fileSize !== source.fileSize
    ) {
      return store;
    }

    for (const [mobIdText, rules] of Object.entries(snapshot.rules ?? {})) {
      const mobId = normalizeInt(mobIdText, -1);
      if (mobId < 0 || !Array.isArray(rules)) continue;
      store.set(
        mobId,
        rules.map((rule) => normalizeRule(mobId, rule))
      );
    }
  } catch (error) {
    console.warn('[mob drop] Không đọc được localStorage:', error);
  }

  return store;
}

function getMutableStore(session: LoadedJarSession): Map<number, MobDropRule[]> {
  let store = sessionStore.get(session);
  if (!store) {
    store = loadPersisted(session);
    sessionStore.set(session, store);
  }
  return store;
}

export function getMobDropRules(session: LoadedJarSession, mobId: number): MobDropRule[] {
  return (getMutableStore(session).get(mobId) ?? []).map(cloneRule);
}

export function getMobDropRuleCount(session: LoadedJarSession, mobId?: number): number {
  const store = getMutableStore(session);
  if (mobId !== undefined) return store.get(mobId)?.length ?? 0;
  let count = 0;
  for (const rules of store.values()) count += rules.length;
  return count;
}

export function upsertMobDropRule(
  session: LoadedJarSession,
  mobId: number,
  rawRule: MobDropRule
): MobDropRule {
  const store = getMutableStore(session);
  const rule = normalizeRule(mobId, rawRule);
  const rules = [...(store.get(mobId) ?? [])];
  const index = rules.findIndex((candidate) => candidate.ruleId === rule.ruleId);
  if (index >= 0) rules[index] = rule;
  else rules.push(rule);
  rules.sort((a, b) => a.itemId - b.itemId || a.ruleId.localeCompare(b.ruleId));
  store.set(mobId, rules);
  persist(session, store);
  invalidateCandidate(session);
  return cloneRule(rule);
}

export function deleteMobDropRule(
  session: LoadedJarSession,
  mobId: number,
  ruleId: string
): void {
  const store = getMutableStore(session);
  const next = (store.get(mobId) ?? []).filter((rule) => rule.ruleId !== ruleId);
  if (next.length > 0) store.set(mobId, next);
  else store.delete(mobId);
  persist(session, store);
  invalidateCandidate(session);
}

export function replaceMobDropRules(
  session: LoadedJarSession,
  mobId: number,
  rules: MobDropRule[]
): void {
  const store = getMutableStore(session);
  const normalized = rules.map((rule) => normalizeRule(mobId, rule));
  if (normalized.length > 0) store.set(mobId, normalized);
  else store.delete(mobId);
  persist(session, store);
  invalidateCandidate(session);
}

export function exportMobDropDrafts(
  session: LoadedJarSession
): Array<[number, MobDropRule[]]> {
  return Array.from(getMutableStore(session).entries()).map(([mobId, rules]) => [
    mobId,
    rules.map(cloneRule),
  ]);
}

export function importMobDropDrafts(
  session: LoadedJarSession,
  entries: Array<[number, MobDropRule[]]>
): void {
  const store = new Map<number, MobDropRule[]>();
  for (const [mobIdRaw, rules] of entries ?? []) {
    const mobId = normalizeInt(mobIdRaw, -1);
    if (mobId < 0 || !Array.isArray(rules)) continue;
    store.set(mobId, rules.map((rule) => normalizeRule(mobId, rule)));
  }
  sessionStore.set(session, store);
  persist(session, store);
  invalidateCandidate(session);
}

export function getMobDropDraftFingerprint(session: LoadedJarSession): string {
  return JSON.stringify(
    exportMobDropDrafts(session)
      .sort(([a], [b]) => a - b)
      .map(([mobId, rules]) => [
        mobId,
        rules
          .slice()
          .sort((a, b) => a.ruleId.localeCompare(b.ruleId))
          .map((rule) => ({
            ruleId: rule.ruleId,
            itemId: rule.itemId,
            chancePercent: rule.chancePercent,
            quantityMin: rule.quantityMin,
            quantityMax: rule.quantityMax,
            enabled: rule.enabled,
            note: rule.note || '',
          })),
      ])
  );
}

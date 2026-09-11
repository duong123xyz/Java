import { LoadedJarSession } from '../types/jar';
import { getSessionClassInfo } from './patchPlannerService';
import {
  DiscipleDefaultsValues,
  DiscipleSkillValue,
  getDiscipleHelperClassPath,
  inspectDiscipleHelperDefaults,
} from './discipleBytecodeService';

export type DiscipleFieldGroup = 'identity' | 'progress' | 'combat' | 'runtime' | 'skills' | 'inventory';

export interface DiscipleFieldInfo {
  field: string;
  label: string;
  type: string;
  group: DiscipleFieldGroup;
  saveBacked: boolean;
  editable: boolean;
  note?: string;
}

export interface DiscipleDraft extends DiscipleDefaultsValues {}

export interface DiscipleSchemaSnapshot {
  verified: boolean;
  verificationDetail: string;
  sourceClass: string;
  codecClass: string;
  resetMethod: string;
  presenceField: string;
  helperClass: string;
  writerReady: boolean;
  skillSlots: number;
  equipmentSlots: number;
  bagSlots: number;
  resetDefaults: DiscipleDraft;
  fields: DiscipleFieldInfo[];
}

const FALLBACK_DEFAULTS: DiscipleDraft = {
  type: 0,
  planet: 0,
  status: 0,
  power: 0,
  potential: 0,
  baseHp: 0,
  baseKi: 0,
  baseDamage: 0,
  armor: 0,
  critical: 0,
  hp: 0,
  ki: 0,
  stamina: 1000,
  maxStamina: 1000,
  skills: Array.from({ length: 7 }, () => ({ id: -1, level: 0 })),
};

const DISCIPLE_FIELDS: DiscipleFieldInfo[] = [
  { field: 'gN', label: 'Có đệ tử', type: 'boolean', group: 'identity', saveBacked: true, editable: false, note: 'Game tự quản lý presence; writer không ép gN để tránh tự sinh đệ tử ngoài flow gốc.' },
  { field: 'hQ', label: 'Tên đệ tử', type: 'String', group: 'identity', saveBacked: true, editable: false, note: 'Tên nằm trong save; phase này không ép tên để không ghi đè tên người chơi đang có.' },
  { field: 'aZ', label: 'Loại đệ tử', type: 'byte', group: 'identity', saveBacked: true, editable: true },
  { field: 'ba', label: 'Hành tinh đệ tử', type: 'byte', group: 'identity', saveBacked: true, editable: true },
  { field: 'bb', label: 'Trạng thái đệ tử', type: 'byte', group: 'identity', saveBacked: true, editable: true },
  { field: 'cj', label: 'Sức mạnh đệ tử', type: 'long', group: 'progress', saveBacked: true, editable: true },
  { field: 'ck', label: 'Tiềm năng đệ tử', type: 'long', group: 'progress', saveBacked: true, editable: true },
  { field: 'yq', label: 'HP gốc đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yr', label: 'KI gốc đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'ys', label: 'Sức đánh đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yt', label: 'Giáp đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yu', label: 'Chí mạng đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yv', label: 'HP đệ tử', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'yw', label: 'KI đệ tử', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'yx', label: 'Thể lực đệ tử', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'yy', label: 'Thể lực tối đa đệ tử', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'cV', label: 'ID kỹ năng đệ tử', type: 'int[7]', group: 'skills', saveBacked: true, editable: true },
  { field: 'cW', label: 'Cấp kỹ năng đệ tử', type: 'int[7]', group: 'skills', saveBacked: true, editable: true },
  { field: 'b', label: 'Trang bị đệ tử', type: 'Item[7]', group: 'inventory', saveBacked: true, editable: false },
  { field: 'c', label: 'Hành trang đệ tử', type: 'Item[30]', group: 'inventory', saveBacked: true, editable: false },
];

const draftStore = new WeakMap<LoadedJarSession, DiscipleDraft>();
const baselineStore = new WeakMap<LoadedJarSession, DiscipleDraft>();

function cloneSkills(skills: DiscipleSkillValue[]): DiscipleSkillValue[] {
  return Array.from({ length: 7 }, (_, index) => ({
    id: skills[index]?.id ?? -1,
    level: skills[index]?.level ?? 0,
  }));
}

function cloneDraft(draft: DiscipleDraft): DiscipleDraft {
  return { ...draft, skills: cloneSkills(draft.skills) };
}

function constantPoolText(classInfo: any): string {
  const pool = classInfo?.constantPool ?? [];
  const values: string[] = [];
  for (const entry of pool) {
    if (!entry) continue;
    if (typeof entry.value === 'string') values.push(entry.value);
    if (typeof entry.utf8 === 'string') values.push(entry.utf8);
    if (typeof entry.text === 'string') values.push(entry.text);
  }
  return values.join('\n');
}

function hasMethod(classInfo: any, name: string, descriptor: string): boolean {
  return Boolean(
    classInfo?.methods?.some(
      (method: any) => method?.name === name && method?.descriptor === descriptor && method?.code?.instructions
    )
  );
}

function cleanNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeDraft(input: DiscipleDraft): DiscipleDraft {
  return {
    type: cleanNumber(input.type, 0, 1),
    planet: cleanNumber(input.planet, 0, 2),
    status: cleanNumber(input.status, 0, 4),
    power: cleanNumber(input.power, 0, 1_000_000_000_000),
    potential: cleanNumber(input.potential, 0, 1_000_000_000_000),
    baseHp: cleanNumber(input.baseHp, 0, 2_100_000_000),
    baseKi: cleanNumber(input.baseKi, 0, 2_100_000_000),
    baseDamage: cleanNumber(input.baseDamage, 0, 2_100_000_000),
    armor: cleanNumber(input.armor, 0, 2_100_000_000),
    critical: cleanNumber(input.critical, 0, 100),
    hp: cleanNumber(input.hp, 0, 2_100_000_000),
    ki: cleanNumber(input.ki, 0, 2_100_000_000),
    stamina: cleanNumber(input.stamina, 0, 2_100_000_000),
    maxStamina: cleanNumber(input.maxStamina, 0, 2_100_000_000),
    skills: cloneSkills(input.skills).map((skill) => {
      const id = cleanNumber(skill.id, -1, 2_100_000_000);
      return {
        id,
        level: id < 0 ? 0 : cleanNumber(skill.level, 0, 10_000),
      };
    }),
  };
}

async function readCurrentDefaults(session: LoadedJarSession): Promise<DiscipleDraft> {
  const helper = session.zip.file(getDiscipleHelperClassPath());
  if (!helper) return cloneDraft(FALLBACK_DEFAULTS);
  try {
    const bytes = await helper.async('arraybuffer');
    return normalizeDraft(inspectDiscipleHelperDefaults(bytes));
  } catch {
    return cloneDraft(FALLBACK_DEFAULTS);
  }
}

export async function analyzeDiscipleSchema(session: LoadedJarSession): Promise<DiscipleSchemaSnapshot> {
  const [saveClass, playerClass, defaults] = await Promise.all([
    getSessionClassInfo(session, 'a/a/N'),
    getSessionClassInfo(session, 'a/a/H'),
    readCurrentDefaults(session),
  ]);

  const saveText = constantPoolText(saveClass);
  const requiredLabels = [
    'Tên đệ tử',
    'loại đệ tử',
    'hành tinh đệ tử',
    'trạng thái đệ tử',
    'sức mạnh đệ tử',
    'tiềm năng đệ tử',
    'HP gốc đệ tử',
    'KI gốc đệ tử',
    'sức đánh đệ tử',
    'giáp đệ tử',
    'chí mạng đệ tử',
    'kỹ năng đệ tử',
    'trang bị đệ tử',
    'hành trang đệ tử',
  ];
  const labelsFound = requiredLabels.filter((label) => saveText.includes(label));

  const readerReady = hasMethod(saveClass, 'f', '(Ljava/io/DataInputStream;La/a/H;)V');
  const writerReady = hasMethod(saveClass, 'f', '(Ljava/io/DataOutputStream;La/a/H;)V');
  const resetReady = hasMethod(playerClass, 'gf', '()V');
  const verified = Boolean(saveClass && playerClass && readerReady && writerReady && resetReady && labelsFound.length >= 10);

  baselineStore.set(session, cloneDraft(defaults));

  return {
    verified,
    verificationDetail: verified
      ? `Đã xác minh block đệ tử trong a/a/N.f(Input/OutputStream, H), reset a/a/H.gf() và ${labelsFound.length}/${requiredLabels.length} nhãn schema.`
      : `Chưa xác minh đủ schema đệ tử: reader=${readerReady}, writer=${writerReady}, reset=${resetReady}, labels=${labelsFound.length}/${requiredLabels.length}.`,
    sourceClass: 'a/a/H',
    codecClass: 'a/a/N',
    resetMethod: 'gf()V',
    presenceField: 'gN',
    helperClass: getDiscipleHelperClassPath().replace(/\.class$/, ''),
    writerReady: verified,
    skillSlots: 7,
    equipmentSlots: 7,
    bagSlots: 30,
    resetDefaults: cloneDraft(defaults),
    fields: DISCIPLE_FIELDS.map((field) => ({ ...field })),
  };
}

export function getDiscipleDraft(
  session: LoadedJarSession,
  snapshot?: DiscipleSchemaSnapshot
): DiscipleDraft {
  const existing = draftStore.get(session);
  if (existing) return cloneDraft(existing);
  const baseline = snapshot?.resetDefaults ?? baselineStore.get(session) ?? FALLBACK_DEFAULTS;
  const draft = cloneDraft(baseline);
  draftStore.set(session, draft);
  return cloneDraft(draft);
}

export function setDiscipleDraft(
  session: LoadedJarSession,
  draft: DiscipleDraft
): DiscipleDraft {
  const normalized = normalizeDraft(draft);
  draftStore.set(session, normalized);
  session.candidateOutput = undefined;
  return cloneDraft(normalized);
}

export function isDiscipleDraftDirty(
  session: LoadedJarSession,
  draft?: DiscipleDraft
): boolean {
  const current = draft ?? draftStore.get(session);
  if (!current) return false;
  const baseline = baselineStore.get(session) ?? FALLBACK_DEFAULTS;
  return JSON.stringify(normalizeDraft(current)) !== JSON.stringify(normalizeDraft(baseline));
}

export function getDirtyDiscipleCount(session: LoadedJarSession): number {
  return isDiscipleDraftDirty(session) ? 1 : 0;
}

export function resetDiscipleDraft(
  session: LoadedJarSession,
  snapshot?: DiscipleSchemaSnapshot
): DiscipleDraft {
  const baseline = snapshot?.resetDefaults ?? baselineStore.get(session) ?? FALLBACK_DEFAULTS;
  const next = cloneDraft(baseline);
  draftStore.set(session, next);
  session.candidateOutput = undefined;
  return cloneDraft(next);
}

export function getDiscipleDraftFingerprint(session: LoadedJarSession): string {
  const draft = draftStore.get(session);
  if (!draft || !isDiscipleDraftDirty(session, draft)) return '{}';
  return JSON.stringify(normalizeDraft(draft));
}

export function exportDiscipleDraft(session: LoadedJarSession): DiscipleDraft | null {
  const draft = draftStore.get(session);
  return draft && isDiscipleDraftDirty(session, draft) ? cloneDraft(draft) : null;
}

export function importDiscipleDraft(session: LoadedJarSession, draft: DiscipleDraft | null | undefined): void {
  if (!draft) {
    draftStore.delete(session);
    return;
  }
  draftStore.set(session, normalizeDraft(draft));
  session.candidateOutput = undefined;
}

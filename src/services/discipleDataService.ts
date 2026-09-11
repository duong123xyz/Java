import { LoadedJarSession } from '../types/jar';
import { getSessionClassInfo } from './patchPlannerService';
import { DiscipleDefaultsValues, DiscipleSkillValue, getDiscipleHelperClassPath } from './discipleBytecodeService';

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

export interface DiscipleDraft extends DiscipleDefaultsValues {
  /**
   * false = giữ nguyên RNG/logic tạo đệ tử của game.
   * true = chạy RNG gốc trước, sau đó áp bộ chỉ số cố định ở cuối method tạo đệ tử.
   */
  overrideCreation: boolean;
}

export interface DiscipleCreationRule {
  key: string;
  label: string;
  formula: string;
  range: string;
  source: string;
}

export interface DiscipleSkillUnlockRule {
  slot: number;
  power: number;
  choices: Array<{ id: number; chance: string }>;
}

export interface DiscipleSchemaSnapshot {
  verified: boolean;
  verificationDetail: string;
  sourceClass: string;
  codecClass: string;
  resetMethod: string;
  creationClass: string;
  creationMethod: string;
  rngMethod: string;
  rngAlgorithm: string;
  presenceField: string;
  helperClass: string;
  writerReady: boolean;
  skillSlots: number;
  equipmentSlots: number;
  bagSlots: number;
  fixedDefaults: DiscipleDraft;
  fields: DiscipleFieldInfo[];
  creationRules: DiscipleCreationRule[];
  skillUnlocks: DiscipleSkillUnlockRule[];
  rewardNotes: string[];
  statNotes: string[];
}

const FIXED_DEFAULTS: DiscipleDraft = {
  overrideCreation: false,
  type: 0,
  planet: 0,
  status: 0,
  power: 2000,
  potential: 0,
  baseHp: 1440,
  baseKi: 1440,
  baseDamage: 32,
  armor: 29,
  critical: 1,
  hp: 1440,
  ki: 1440,
  stamina: 1000,
  maxStamina: 1000,
  skills: [
    { id: 0, level: 1 },
    { id: -1, level: 0 },
    { id: -1, level: 0 },
    { id: -1, level: 0 },
    { id: -1, level: 0 },
    { id: -1, level: 0 },
    { id: -1, level: 0 },
  ],
};

const DISCIPLE_FIELDS: DiscipleFieldInfo[] = [
  { field: 'gN', label: 'Có đệ tử', type: 'boolean', group: 'identity', saveBacked: true, editable: false, note: 'Game tự quản lý presence.' },
  { field: 'hQ', label: 'Tên đệ tử', type: 'String', group: 'identity', saveBacked: true, editable: false, note: 'Tên nằm trong save; writer không ghi đè.' },
  { field: 'aZ', label: 'Loại đệ tử', type: 'byte', group: 'identity', saveBacked: true, editable: false, note: 'Là tham số của flow tạo đệ tử; giữ logic game.' },
  { field: 'ba', label: 'Hành tinh đệ tử', type: 'byte', group: 'identity', saveBacked: true, editable: false, note: 'Là tham số của flow tạo đệ tử; giữ logic game.' },
  { field: 'bb', label: 'Trạng thái AI', type: 'byte', group: 'identity', saveBacked: true, editable: false, note: 'Được AI runtime thay đổi; không ép bằng writer.' },
  { field: 'cj', label: 'Sức mạnh đệ tử', type: 'long', group: 'progress', saveBacked: true, editable: true },
  { field: 'ck', label: 'Tiềm năng đệ tử', type: 'long', group: 'progress', saveBacked: true, editable: true },
  { field: 'yq', label: 'HP gốc đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yr', label: 'KI gốc đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'ys', label: 'Sức đánh đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yt', label: 'Giáp đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yu', label: 'Chí mạng đệ tử', type: 'int', group: 'combat', saveBacked: true, editable: true },
  { field: 'yv', label: 'HP hiện tại', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'yw', label: 'KI hiện tại', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'yx', label: 'Thể lực', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'yy', label: 'Thể lực tối đa', type: 'int', group: 'runtime', saveBacked: true, editable: true },
  { field: 'cV', label: 'ID kỹ năng đệ tử', type: 'int[7]', group: 'skills', saveBacked: true, editable: true },
  { field: 'cW', label: 'Cấp kỹ năng đệ tử', type: 'int[7]', group: 'skills', saveBacked: true, editable: true },
  { field: 'b', label: 'Trang bị đệ tử', type: 'Item[7]', group: 'inventory', saveBacked: true, editable: false },
  { field: 'c', label: 'Hành trang đệ tử', type: 'Item[30]', group: 'inventory', saveBacked: true, editable: false },
];

const CREATION_RULES: DiscipleCreationRule[] = [
  { key: 'planet', label: 'Hành tinh lúc nhận Đệ tử', formula: 'flow thường: w(3) → 0 / 1 / 2', range: 'mỗi hành tinh xấp xỉ 1/3', source: 'a/a/l.am() @27..34' },
  { key: 'type', label: 'Loại Đệ tử', formula: 'flow thường type=0; flow Mabu type=1', range: 'type được truyền vào method tạo', source: 'callers → a/a/l.a(H,BB)' },
  { key: 'power', label: 'Sức mạnh ban đầu', formula: 'type == 1 ? 1,500,000 : 2,000', range: 'cố định theo loại', source: 'a/a/l.a(H,BB) @54..69' },
  { key: 'hp', label: 'HP gốc', formula: '(40 + w(66)) × 20', range: '800 → 2,100; bước 20', source: '@77..89' },
  { key: 'ki', label: 'KI gốc', formula: '(40 + w(66)) × 20', range: '800 → 2,100; bước 20', source: '@92..104' },
  { key: 'damage', label: 'Sức đánh', formula: 'normal: 20 + w(26); Mabu: 50 + w(71)', range: '20→45 hoặc 50→120', source: '@107..136' },
  { key: 'armor', label: 'Giáp', formula: '9 + w(42)', range: '9 → 50', source: '@139..148' },
  { key: 'critical', label: 'Chí mạng', formula: 'w(3)', range: '0 → 2', source: '@151..156' },
  { key: 'stamina', label: 'Thể lực', formula: 'yx = yy = 1000', range: '1,000', source: '@175..184' },
  { key: 'skill0', label: 'Skill đầu', formula: 'w(3) → 0 / 14 / 28', range: 'mỗi lựa chọn ~33%', source: '@187..224' },
];

const SKILL_UNLOCKS: DiscipleSkillUnlockRule[] = [
  { slot: 1, power: 150_000_000, choices: [{ id: 7, chance: '33%' }, { id: 21, chance: '33%' }, { id: 35, chance: '34%' }] },
  { slot: 2, power: 1_500_000_000, choices: [{ id: 42, chance: '30%' }, { id: 56, chance: '40%' }, { id: 63, chance: '30%' }] },
  { slot: 3, power: 20_000_000_000, choices: [{ id: 91, chance: '10%' }, { id: 84, chance: '70%' }, { id: 121, chance: '20%' }] },
];

const REWARD_NOTES = [
  'e(reward, forceOne) nhận TNSM, ép tối thiểu 1 rồi đi qua patch/GTLFix.applyDiscipleReward(H, reward).',
  'Trang bị Đệ tử có option 88 / 101 / 160 cộng % reward; option 155 làm reward ×2.',
  'xV > 0 áp thêm phần trăm; điều kiện a/a/x.h(H) có thể biến reward thành ×3; forceOne=true ép reward = 1.',
  'a/a/V.b(H, reward, reward) cộng cùng lúc sức mạnh cj và tiềm năng ck, cap gốc 1,000,000,000,000.',
  'Sau khi Đệ tử nhận reward, game lấy actualGain / 2 rồi cộng cho sư phụ qua a/a/V.a(H, half, half).',
];

const STAT_NOTES = [
  'Chỉ số hiệu lực không chỉ lấy yq/yr/ys/yt/yu: a/a/l.a(H,int) còn cộng option trang bị và % bonus.',
  'HP dùng yq, KI dùng yr, damage dùng ys, giáp bắt đầu từ yt×4, chí mạng dùng yu rồi cộng option tương ứng.',
  'Các option flat/percent từ 7 ô trang bị Đệ tử được cộng trước khi clamp về int; một số patch riêng còn tăng HP/damage.',
  'Vì vậy sửa “base” trong panel là sửa nền tảng; chỉ số chiến đấu thực tế vẫn có thể khác khi Đệ tử mặc đồ/buff.',
  'Luồng sanitize save sẽ sửa giá trị hỏng: power < 1 → 2,000; HP/KI base < 1 → 800; damage < 1 → 20; HP/KI hiện tại < 1 → base; max stamina < 1 → 1,000.',
];

const draftStore = new WeakMap<LoadedJarSession, DiscipleDraft>();

function cloneSkills(skills: DiscipleSkillValue[]): DiscipleSkillValue[] {
  return Array.from({ length: 7 }, (_, index) => ({ id: skills[index]?.id ?? -1, level: skills[index]?.level ?? 0 }));
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
  return Boolean(classInfo?.methods?.some((method: any) => method?.name === name && method?.descriptor === descriptor && method?.code?.instructions));
}
function cleanNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
function normalizeDraft(input: DiscipleDraft): DiscipleDraft {
  return {
    overrideCreation: Boolean(input.overrideCreation),
    type: 0,
    planet: 0,
    status: 0,
    power: cleanNumber(input.power, 0, 1_000_000_000_000),
    potential: cleanNumber(input.potential, 0, 1_000_000_000_000),
    baseHp: cleanNumber(input.baseHp, 1, 2_100_000_000),
    baseKi: cleanNumber(input.baseKi, 1, 2_100_000_000),
    baseDamage: cleanNumber(input.baseDamage, 1, 2_100_000_000),
    armor: cleanNumber(input.armor, 0, 2_100_000_000),
    critical: cleanNumber(input.critical, 0, 100),
    hp: cleanNumber(input.hp, 0, 2_100_000_000),
    ki: cleanNumber(input.ki, 0, 2_100_000_000),
    stamina: cleanNumber(input.stamina, 0, 2_100_000_000),
    maxStamina: cleanNumber(input.maxStamina, 1, 2_100_000_000),
    skills: cloneSkills(input.skills).map((skill) => {
      const id = cleanNumber(skill.id, -1, 2_100_000_000);
      return { id, level: id < 0 ? 0 : cleanNumber(skill.level, 0, 10_000) };
    }),
  };
}

export async function analyzeDiscipleSchema(session: LoadedJarSession): Promise<DiscipleSchemaSnapshot> {
  const [saveClass, playerClass, creationClass] = await Promise.all([
    getSessionClassInfo(session, 'a/a/N'),
    getSessionClassInfo(session, 'a/a/H'),
    getSessionClassInfo(session, 'a/a/l'),
  ]);

  const saveText = constantPoolText(saveClass);
  const requiredLabels = ['Tên đệ tử', 'loại đệ tử', 'hành tinh đệ tử', 'trạng thái đệ tử', 'sức mạnh đệ tử', 'tiềm năng đệ tử', 'HP gốc đệ tử', 'KI gốc đệ tử', 'sức đánh đệ tử', 'giáp đệ tử', 'chí mạng đệ tử', 'kỹ năng đệ tử', 'trang bị đệ tử', 'hành trang đệ tử'];
  const labelsFound = requiredLabels.filter((label) => saveText.includes(label));
  const readerReady = hasMethod(saveClass, 'f', '(Ljava/io/DataInputStream;La/a/H;)V');
  const saveWriterReady = hasMethod(saveClass, 'f', '(Ljava/io/DataOutputStream;La/a/H;)V');
  const resetReady = hasMethod(playerClass, 'gf', '()V');
  const creationReady = hasMethod(creationClass, 'a', '(La/a/H;BB)V');
  const rngReady = hasMethod(creationClass, 'w', '(I)I');
  const verified = Boolean(saveClass && playerClass && creationClass && readerReady && saveWriterReady && resetReady && creationReady && rngReady && labelsFound.length >= 10);

  return {
    verified,
    verificationDetail: verified
      ? `Đã xác minh save a/a/N, reset H.gf(), creation a/a/l.a(H,BB), RNG a/a/l.w(int) và ${labelsFound.length}/${requiredLabels.length} nhãn schema.`
      : `Schema Đệ tử chưa đủ: reader=${readerReady}, saveWriter=${saveWriterReady}, reset=${resetReady}, creation=${creationReady}, rng=${rngReady}, labels=${labelsFound.length}/${requiredLabels.length}.`,
    sourceClass: 'a/a/H',
    codecClass: 'a/a/N',
    resetMethod: 'gf()V',
    creationClass: 'a/a/l',
    creationMethod: 'a(La/a/H;BB)V',
    rngMethod: 'w(I)I',
    rngAlgorithm: 'seed = seed × 1103515245 + 12345; r = (seed >>> 1) & 0x7fffffff; w(n) = n <= 1 ? 0 : r % n. Seed lấy từ System.currentTimeMillis().',
    presenceField: 'gN',
    helperClass: getDiscipleHelperClassPath().replace(/\.class$/, ''),
    writerReady: verified,
    skillSlots: 7,
    equipmentSlots: 7,
    bagSlots: 30,
    fixedDefaults: cloneDraft(FIXED_DEFAULTS),
    fields: DISCIPLE_FIELDS.map((field) => ({ ...field })),
    creationRules: CREATION_RULES.map((rule) => ({ ...rule })),
    skillUnlocks: SKILL_UNLOCKS.map((rule) => ({ ...rule, choices: rule.choices.map((choice) => ({ ...choice })) })),
    rewardNotes: [...REWARD_NOTES],
    statNotes: [...STAT_NOTES],
  };
}

export function getDiscipleDraft(session: LoadedJarSession, snapshot?: DiscipleSchemaSnapshot): DiscipleDraft {
  const existing = draftStore.get(session);
  if (existing) return cloneDraft(existing);
  const draft = cloneDraft(snapshot?.fixedDefaults ?? FIXED_DEFAULTS);
  draftStore.set(session, draft);
  return cloneDraft(draft);
}
export function setDiscipleDraft(session: LoadedJarSession, draft: DiscipleDraft): DiscipleDraft {
  const normalized = normalizeDraft(draft);
  draftStore.set(session, normalized);
  session.candidateOutput = undefined;
  return cloneDraft(normalized);
}
export function isDiscipleDraftDirty(session: LoadedJarSession, draft?: DiscipleDraft): boolean {
  const current = draft ?? draftStore.get(session);
  return Boolean(current?.overrideCreation);
}
export function getDirtyDiscipleCount(session: LoadedJarSession): number {
  return isDiscipleDraftDirty(session) ? 1 : 0;
}
export function resetDiscipleDraft(session: LoadedJarSession, snapshot?: DiscipleSchemaSnapshot): DiscipleDraft {
  const next = cloneDraft(snapshot?.fixedDefaults ?? FIXED_DEFAULTS);
  draftStore.set(session, next);
  session.candidateOutput = undefined;
  return cloneDraft(next);
}
export function getDiscipleDraftFingerprint(session: LoadedJarSession): string {
  const draft = draftStore.get(session);
  if (!draft?.overrideCreation) return '{}';
  return JSON.stringify(normalizeDraft(draft));
}
export function exportDiscipleDraft(session: LoadedJarSession): DiscipleDraft | null {
  const draft = draftStore.get(session);
  return draft?.overrideCreation ? cloneDraft(draft) : null;
}
export function importDiscipleDraft(session: LoadedJarSession, draft: DiscipleDraft | null | undefined): void {
  if (!draft) {
    draftStore.delete(session);
    return;
  }
  draftStore.set(session, normalizeDraft(draft));
  session.candidateOutput = undefined;
}

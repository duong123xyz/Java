import { LoadedJarSession } from '../types/jar';
import { getSessionClassInfo } from './patchPlannerService';
import { inspectCharacterStarterClass } from './characterBytecodeService';

export type CharacterPlanet = 0 | 1 | 2;

export interface CharacterStarterProfile {
  planet: CharacterPlanet;
  planetName: string;
  archetype: string;
  previewHead: number;
  previewBody: number;
  previewLeg: number;
  mapId: number;
  spawnX: number;
  spawnY: number;
  gold: number;
  gems: number;
  ruby: number;
  power: number;
  potential: number;
  baseHp: number;
  baseKi: number;
  baseDamage: number;
  baseArmor: number;
  baseCritical: number;
  speed: number;
  level: number;
  skillPoints: number;
  stamina: number;
  maxStamina: number;
  selectedSkill: number;
}

export interface CharacterDraft extends CharacterStarterProfile {}

export interface CharacterStructureInfo {
  equipmentSlots: number;
  bagSlots: number;
  chestSlots: number;
  saleSlots: number;
  discipleEquipmentSlots: number;
  discipleBagSlots: number;
  skillSlots: number;
}

export interface CharacterFieldInfo {
  field: string;
  label: string;
  type: string;
  editableInStarter: boolean;
}

export interface CharacterAnalysisSnapshot {
  profiles: CharacterStarterProfile[];
  verified: boolean;
  sourceClass: string;
  sourceMethod: string;
  verificationDetail: string;
  structure: CharacterStructureInfo;
  saveFields: CharacterFieldInfo[];
}

const PROFILE_DEFAULTS: CharacterStarterProfile[] = [
  {
    planet: 0,
    planetName: 'Trái Đất',
    archetype: 'Cân bằng · Khởi đầu HP cao',
    previewHead: 64,
    previewBody: 65,
    previewLeg: 66,
    mapId: 39,
    spawnX: 100,
    spawnY: 384,
    gold: 2000,
    gems: 10000,
    ruby: 0,
    power: 2000,
    potential: 2000,
    baseHp: 200,
    baseKi: 100,
    baseDamage: 10,
    baseArmor: 0,
    baseCritical: 0,
    speed: 5,
    level: 1,
    skillPoints: 0,
    stamina: 1200,
    maxStamina: 1200,
    selectedSkill: 0,
  },
  {
    planet: 1,
    planetName: 'Namek',
    archetype: 'Thiên KI · Hồi phục tốt',
    previewHead: 9,
    previewBody: 10,
    previewLeg: 11,
    mapId: 40,
    spawnX: 100,
    spawnY: 384,
    gold: 2000,
    gems: 10000,
    ruby: 0,
    power: 2000,
    potential: 2000,
    baseHp: 100,
    baseKi: 200,
    baseDamage: 10,
    baseArmor: 0,
    baseCritical: 0,
    speed: 5,
    level: 1,
    skillPoints: 0,
    stamina: 1200,
    maxStamina: 1200,
    selectedSkill: 14,
  },
  {
    planet: 2,
    planetName: 'Xayda',
    archetype: 'Thiên công · Đòn đánh mạnh',
    previewHead: 6,
    previewBody: 7,
    previewLeg: 8,
    mapId: 41,
    spawnX: 100,
    spawnY: 384,
    gold: 2000,
    gems: 10000,
    ruby: 0,
    power: 2000,
    potential: 2000,
    baseHp: 100,
    baseKi: 100,
    baseDamage: 15,
    baseArmor: 0,
    baseCritical: 0,
    speed: 5,
    level: 1,
    skillPoints: 0,
    stamina: 1200,
    maxStamina: 1200,
    selectedSkill: 28,
  },
];

const STRUCTURE: CharacterStructureInfo = {
  equipmentSlots: 11,
  bagSlots: 30,
  chestSlots: 30,
  saleSlots: 10,
  discipleEquipmentSlots: 7,
  discipleBagSlots: 30,
  skillSlots: 10,
};

const SAVE_FIELDS: CharacterFieldInfo[] = [
  { field: 'r', label: 'Tên nhân vật', type: 'String', editableInStarter: false },
  { field: 'aX', label: 'Hành tinh', type: 'byte', editableInStarter: true },
  { field: 'xu', label: 'Tóc / kiểu ngoại hình', type: 'int', editableInStarter: false },
  { field: 'vP', label: 'Map hiện tại', type: 'int', editableInStarter: true },
  { field: 'cp', label: 'Tọa độ X', type: 'int', editableInStarter: true },
  { field: 'cq', label: 'Tọa độ Y', type: 'int', editableInStarter: true },
  { field: 'bS', label: 'Vàng', type: 'long', editableInStarter: true },
  { field: 'xv', label: 'Ngọc', type: 'int', editableInStarter: true },
  { field: 'xw', label: 'Hồng ngọc', type: 'int', editableInStarter: true },
  { field: 'bT', label: 'Sức mạnh', type: 'long', editableInStarter: true },
  { field: 'bU', label: 'Tiềm năng', type: 'long', editableInStarter: true },
  { field: 'xx', label: 'HP gốc', type: 'int', editableInStarter: true },
  { field: 'xy', label: 'KI gốc', type: 'int', editableInStarter: true },
  { field: 'xz', label: 'Sức đánh gốc', type: 'int', editableInStarter: true },
  { field: 'xA', label: 'Giáp gốc', type: 'int', editableInStarter: true },
  { field: 'xB', label: 'Chí mạng gốc', type: 'int', editableInStarter: true },
  { field: 'xC', label: 'Tốc độ', type: 'int', editableInStarter: true },
  { field: 'vO', label: 'Cấp', type: 'int', editableInStarter: true },
  { field: 'yf', label: 'Điểm kỹ năng', type: 'int', editableInStarter: true },
  { field: 'yg', label: 'Thể lực', type: 'int', editableInStarter: true },
  { field: 'yh', label: 'Thể lực tối đa', type: 'int', editableInStarter: true },
  { field: 'yi', label: 'Kỹ năng đang chọn', type: 'int', editableInStarter: true },
  { field: 'd', label: 'Trang bị', type: 'Item[11]', editableInStarter: false },
  { field: 'e', label: 'Hành trang', type: 'Item[30]', editableInStarter: false },
  { field: 'f', label: 'Rương đồ', type: 'Item[30]', editableInStarter: false },
  { field: 'g', label: 'Đồ đã bán', type: 'Item[10]', editableInStarter: false },
];

const draftStore = new WeakMap<LoadedJarSession, Map<CharacterPlanet, CharacterDraft>>();
const baselineStore = new WeakMap<
  LoadedJarSession,
  Map<CharacterPlanet, CharacterStarterProfile>
>();

function numericInstructionValue(instruction: any, constantPool: any[]): number | null {
  if (typeof instruction?.pushValue === 'number') return instruction.pushValue;

  if (typeof instruction?.cpIndex === 'number') {
    const entry = constantPool[instruction.cpIndex];
    if (entry) {
      if (typeof entry.value === 'number') return entry.value;
      if (typeof entry.value === 'bigint') return Number(entry.value);
    }
  }

  const text = `${instruction?.resolved ?? ''} ${instruction?.operandDisplay ?? ''}`.replace(/,/g, '');
  const matches = text.match(/-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?/g);
  if (!matches?.length) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
}

function methodHasRequiredConstants(method: any, constantPool: any[]): boolean {
  const values = (method?.code?.instructions ?? [])
    .map((instruction: any) => numericInstructionValue(instruction, constantPool))
    .filter((value: number | null): value is number => value !== null);

  const required = [
    39,
    100,
    384,
    2000,
    10000,
    200,
    15,
    10,
    5,
    1,
    1200,
    14,
    28,
  ];

  return required.every((target) => values.some((value) => value === target));
}

export async function analyzeCharacterDefaults(
  session: LoadedJarSession
): Promise<CharacterAnalysisSnapshot> {
  const [saveClass, hBytes] = await Promise.all([
    getSessionClassInfo(session, 'a/a/N'),
    session.zip.file('a/a/H.class')?.async('arraybuffer') ??
      Promise.resolve<ArrayBuffer | null>(null),
  ]);

  const saveReader = saveClass?.methods.find(
    (method: any) =>
      method.name === 'a' &&
      method.descriptor === '([BI)La/a/H;'
  );
  const saveVerified = Boolean(saveReader?.code?.instructions);

  const inspection = hBytes
    ? inspectCharacterStarterClass(hBytes)
    : {
        verified: false,
        detail: 'Không tìm thấy a/a/H.class.',
        profiles: [] as any[],
        methodCodeLength: 0,
        constantPoolCount: 0,
      };

  const profiles = PROFILE_DEFAULTS.map((fallback, index) => ({
    ...fallback,
    ...(inspection.verified ? inspection.profiles[index] : {}),
  }));

  baselineStore.set(
    session,
    new Map(
      profiles.map(
        (profile) => [profile.planet, { ...profile }] as const
      )
    )
  );

  return {
    profiles,
    verified: inspection.verified && saveVerified,
    sourceClass: 'a/a/H',
    sourceMethod: 'p(B)',
    verificationDetail:
      inspection.verified && saveVerified
        ? `${inspection.detail} Save reader a/a/N.a(byte[], int) cũng đã xác minh.`
        : `${inspection.detail}${
            saveVerified
              ? ''
              : ' Không xác minh được save reader a/a/N.a(byte[], int).'
          }`,
    structure: { ...STRUCTURE },
    saveFields: SAVE_FIELDS.map((field) => ({ ...field })),
  };
}

function cloneDraft(profile: CharacterStarterProfile): CharacterDraft {
  return { ...profile };
}

function getStore(session: LoadedJarSession): Map<CharacterPlanet, CharacterDraft> {
  let store = draftStore.get(session);
  if (!store) {
    store = new Map<CharacterPlanet, CharacterDraft>();
    draftStore.set(session, store);
  }
  return store;
}

function getBaselineProfiles(
  session: LoadedJarSession
): Map<CharacterPlanet, CharacterStarterProfile> {
  return (
    baselineStore.get(session) ??
    new Map(
      PROFILE_DEFAULTS.map(
        (profile) => [profile.planet, profile] as const
      )
    )
  );
}

function ensureDraft(
  session: LoadedJarSession,
  planet: CharacterPlanet
): CharacterDraft {
  const store = getStore(session);
  const existing = store.get(planet);
  if (existing) return { ...existing };

  const baseline =
    getBaselineProfiles(session).get(planet) ??
    PROFILE_DEFAULTS[planet];
  const draft = { ...baseline };
  store.set(planet, draft);
  return { ...draft };
}

export function getCharacterDraft(
  session: LoadedJarSession,
  profile: CharacterStarterProfile
): CharacterDraft {
  const store = getStore(session);
  let draft = store.get(profile.planet);
  if (!draft) {
    draft = cloneDraft(profile);
    store.set(profile.planet, draft);
  }
  return { ...draft };
}

function cleanNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function setCharacterDraft(
  session: LoadedJarSession,
  profile: CharacterStarterProfile,
  draft: CharacterDraft
): void {
  const store = getStore(session);
  const current = ensureDraft(session, profile.planet);

  const normalized: CharacterDraft = {
    ...draft,
    planet: profile.planet,
    planetName: profile.planetName,
    mapId: cleanNumber(draft.mapId, 0, 10000),
    spawnX: cleanNumber(draft.spawnX, 0, 100000),
    spawnY: cleanNumber(draft.spawnY, 0, 100000),
    gold: cleanNumber(draft.gold, 0, Number.MAX_SAFE_INTEGER),
    gems: cleanNumber(draft.gems, 0, 2_100_000_000),
    ruby: cleanNumber(draft.ruby, 0, 2_100_000_000),
    power: cleanNumber(draft.power, 0, Number.MAX_SAFE_INTEGER),
    potential: cleanNumber(draft.potential, 0, Number.MAX_SAFE_INTEGER),
    baseHp: cleanNumber(draft.baseHp, 1, 2_100_000_000),
    baseKi: cleanNumber(draft.baseKi, 1, 2_100_000_000),
    baseDamage: cleanNumber(draft.baseDamage, 1, 2_100_000_000),
    baseArmor: cleanNumber(draft.baseArmor, 0, 2_100_000_000),
    baseCritical: cleanNumber(draft.baseCritical, 0, 100),
    speed: cleanNumber(draft.speed, 1, 1000),
    level: cleanNumber(draft.level, 1, 10000),
    skillPoints: cleanNumber(draft.skillPoints, 0, 2_100_000_000),
    stamina: cleanNumber(draft.stamina, 0, 2_100_000_000),
    maxStamina: cleanNumber(draft.maxStamina, 1, 2_100_000_000),
    selectedSkill: cleanNumber(draft.selectedSkill, -1, 2_100_000_000),
  };

  store.set(profile.planet, normalized);

  const changed = <K extends keyof CharacterDraft>(key: K) =>
    current[key] !== normalized[key];

  // H.p(byte) dùng chung các producer này cho cả 3 hành tinh.
  const globalFields: Array<keyof CharacterDraft> = [
    'spawnX',
    'spawnY',
    'gold',
    'gems',
    'ruby',
    'power',
    'potential',
    'baseArmor',
    'baseCritical',
    'speed',
    'level',
    'skillPoints',
  ];

  for (const field of globalFields) {
    if (!changed(field)) continue;
    for (const planet of [0, 1, 2] as const) {
      const target = ensureDraft(session, planet);
      (target as any)[field] = (normalized as any)[field];
      store.set(planet, target);
    }
  }

  // Map mặc định là base + planet, nên giữ ba map liên tiếp.
  if (changed('mapId')) {
    const baseMap = normalized.mapId - profile.planet;
    for (const planet of [0, 1, 2] as const) {
      const target = ensureDraft(session, planet);
      target.mapId = cleanNumber(baseMap + planet, 0, 10000);
      store.set(planet, target);
    }
  }

  // HP: Earth có producer riêng, Namek/Xayda dùng chung.
  if (changed('baseHp') && profile.planet !== 0) {
    for (const planet of [1, 2] as const) {
      const target = ensureDraft(session, planet);
      target.baseHp = normalized.baseHp;
      store.set(planet, target);
    }
  }

  // KI: Namek có producer riêng, Earth/Xayda dùng chung.
  if (changed('baseKi') && profile.planet !== 1) {
    for (const planet of [0, 2] as const) {
      const target = ensureDraft(session, planet);
      target.baseKi = normalized.baseKi;
      store.set(planet, target);
    }
  }

  // Damage: Xayda có producer riêng, Earth/Namek dùng chung.
  if (changed('baseDamage') && profile.planet !== 2) {
    for (const planet of [0, 1] as const) {
      const target = ensureDraft(session, planet);
      target.baseDamage = normalized.baseDamage;
      store.set(planet, target);
    }
  }

  // H.p(byte) dùng một push + dup_x1 cho cả yg/yh.
  if (changed('stamina') || changed('maxStamina')) {
    const value = changed('maxStamina')
      ? normalized.maxStamina
      : normalized.stamina;
    for (const planet of [0, 1, 2] as const) {
      const target = ensureDraft(session, planet);
      target.stamina = value;
      target.maxStamina = value;
      store.set(planet, target);
    }
  }
}

export function isCharacterDraftDirty(
  profile: CharacterStarterProfile,
  draft: CharacterDraft
): boolean {
  return JSON.stringify(profile) !== JSON.stringify(draft);
}

export function getDirtyCharacterCount(
  session: LoadedJarSession,
  profiles: CharacterStarterProfile[]
): number {
  const store = draftStore.get(session);
  if (!store) return 0;

  return profiles.reduce((count, profile) => {
    const draft = store.get(profile.planet);
    return count + (draft && isCharacterDraftDirty(profile, draft) ? 1 : 0);
  }, 0);
}

export function resetCharacterDraft(
  session: LoadedJarSession,
  profile: CharacterStarterProfile
): CharacterDraft {
  setCharacterDraft(session, profile, cloneDraft(profile));
  return getCharacterDraft(session, profile);
}

export function exportCharacterDrafts(
  session: LoadedJarSession
): Array<[CharacterPlanet, CharacterDraft]> {
  const store = draftStore.get(session);
  if (!store) return [];
  return Array.from(store.entries()).map(([planet, draft]) => [
    planet,
    { ...draft },
  ]);
}

export function importCharacterDrafts(
  session: LoadedJarSession,
  entries: Array<[CharacterPlanet, CharacterDraft]>
): void {
  const store = new Map<CharacterPlanet, CharacterDraft>();
  for (const [planet, draft] of entries || []) {
    store.set(planet, { ...draft });
  }
  draftStore.set(session, store);
}

export function getCharacterDraftFingerprint(
  session: LoadedJarSession
): string {
  const store = draftStore.get(session);
  if (!store) return '[]';

  const baseline = getBaselineProfiles(session);
  const rows = Array.from(store.entries())
    .filter(([planet, draft]) => {
      const profile = baseline.get(planet);
      return Boolean(
        profile && isCharacterDraftDirty(profile, draft)
      );
    })
    .sort(([a], [b]) => a - b)
    .map(([planet, draft]) => [planet, draft]);

  return JSON.stringify(rows);
}

export function resetAllCharacterDrafts(session: LoadedJarSession): void {
  draftStore.delete(session);
}

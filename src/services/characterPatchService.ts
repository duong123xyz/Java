import { LoadedJarSession } from '../types/jar';
import {
  analyzeCharacterDefaults,
  CharacterDraft,
  CharacterStarterProfile,
  getCharacterDraft,
  isCharacterDraftDirty,
} from './characterDataService';
import {
  CharacterBytecodePatchValues,
  patchCharacterStarterClass,
} from './characterBytecodeService';

export interface CharacterPatchBlocker {
  field: string;
  message: string;
}

export interface CharacterPatchResult {
  status: 'NO_CHANGES' | 'READY' | 'BLOCKED' | 'FAILED';
  rewrittenClasses: Map<string, ArrayBuffer>;
  appliedDraftCount: number;
  appliedPatchCount: number;
  blockers: CharacterPatchBlocker[];
  diagnostics: string[];
  errorMessage?: string;
}

const WRITABLE_FIELDS: Array<keyof CharacterDraft> = [
  'mapId',
  'spawnX',
  'spawnY',
  'gold',
  'gems',
  'ruby',
  'power',
  'potential',
  'baseHp',
  'baseKi',
  'baseDamage',
  'baseArmor',
  'baseCritical',
  'speed',
  'level',
  'skillPoints',
  'stamina',
  'maxStamina',
  'selectedSkill',
];

const GLOBAL_FIELDS: Array<keyof CharacterDraft> = [
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
  'stamina',
  'maxStamina',
];

function sameAcross(
  drafts: CharacterDraft[],
  field: keyof CharacterDraft
): boolean {
  return drafts.every(
    (draft) => draft[field] === drafts[0][field]
  );
}

function fieldChanged(
  profile: CharacterStarterProfile,
  draft: CharacterDraft,
  field: keyof CharacterDraft
): boolean {
  return profile[field] !== draft[field];
}

function validateWritableChanges(
  profiles: CharacterStarterProfile[],
  drafts: CharacterDraft[]
): CharacterPatchBlocker[] {
  const blockers: CharacterPatchBlocker[] = [];
  const writable = new Set<keyof CharacterDraft>(WRITABLE_FIELDS);

  for (let index = 0; index < profiles.length; index++) {
    const profile = profiles[index];
    const draft = drafts[index];

    for (const key of Object.keys(profile) as Array<
      keyof CharacterDraft
    >) {
      if (
        !writable.has(key) &&
        fieldChanged(profile, draft, key)
      ) {
        blockers.push({
          field: `${profile.planetName}.${String(key)}`,
          message:
            'Field này chỉ là metadata/preview của editor, chưa có producer tương ứng trong H.p(byte).',
        });
      }
    }
  }

  return blockers;
}

function validateRuntimeShape(
  drafts: CharacterDraft[]
): CharacterPatchBlocker[] {
  const blockers: CharacterPatchBlocker[] = [];

  for (const field of GLOBAL_FIELDS) {
    if (!sameAcross(drafts, field)) {
      blockers.push({
        field: String(field),
        message:
          'H.p(byte) dùng chung một producer cho cả 3 hành tinh. Giá trị này phải giống nhau.',
      });
    }
  }

  if (
    drafts[1].baseHp !== drafts[2].baseHp
  ) {
    blockers.push({
      field: 'baseHp',
      message:
        'HP trong H.p(byte) có 2 nhánh: Earth riêng, Namek/Xayda dùng chung.',
    });
  }

  if (
    drafts[0].baseKi !== drafts[2].baseKi
  ) {
    blockers.push({
      field: 'baseKi',
      message:
        'KI trong H.p(byte) có 2 nhánh: Namek riêng, Earth/Xayda dùng chung.',
    });
  }

  if (
    drafts[0].baseDamage !== drafts[1].baseDamage
  ) {
    blockers.push({
      field: 'baseDamage',
      message:
        'Sức đánh trong H.p(byte) có 2 nhánh: Xayda riêng, Earth/Namek dùng chung.',
    });
  }

  if (
    drafts[0].mapId + 1 !== drafts[1].mapId ||
    drafts[1].mapId + 1 !== drafts[2].mapId
  ) {
    blockers.push({
      field: 'mapId',
      message:
        'Map khởi tạo đang được tính bằng baseMap + planet, nên ba map phải liên tiếp.',
    });
  }

  if (
    drafts.some(
      (draft) => draft.stamina !== draft.maxStamina
    )
  ) {
    blockers.push({
      field: 'stamina/maxStamina',
      message:
        'H.p(byte) dùng một push + dup_x1 để gán cùng lúc yg/yh; hai giá trị phải bằng nhau.',
    });
  }

  return blockers;
}

function toPatchValues(
  drafts: CharacterDraft[]
): CharacterBytecodePatchValues {
  return {
    mapBase: drafts[0].mapId,
    spawnX: drafts[0].spawnX,
    spawnY: drafts[0].spawnY,
    gold: drafts[0].gold,
    gems: drafts[0].gems,
    ruby: drafts[0].ruby,
    power: drafts[0].power,
    potential: drafts[0].potential,
    hpEarth: drafts[0].baseHp,
    hpOther: drafts[1].baseHp,
    kiNamek: drafts[1].baseKi,
    kiOther: drafts[0].baseKi,
    damageXayda: drafts[2].baseDamage,
    damageOther: drafts[0].baseDamage,
    baseArmor: drafts[0].baseArmor,
    baseCritical: drafts[0].baseCritical,
    speed: drafts[0].speed,
    level: drafts[0].level,
    skillPoints: drafts[0].skillPoints,
    stamina: drafts[0].stamina,
    selectedSkillEarth: drafts[0].selectedSkill,
    selectedSkillNamek: drafts[1].selectedSkill,
    selectedSkillXayda: drafts[2].selectedSkill,
  };
}

export async function buildCharacterPatches(
  session: LoadedJarSession
): Promise<CharacterPatchResult> {
  try {
    const snapshot = await analyzeCharacterDefaults(session);
    const profiles = snapshot.profiles;
    const drafts = profiles.map((profile) =>
      getCharacterDraft(session, profile)
    );

    const appliedDraftCount = profiles.reduce(
      (count, profile, index) =>
        count +
        (isCharacterDraftDirty(profile, drafts[index]) ? 1 : 0),
      0
    );

    if (appliedDraftCount === 0) {
      return {
        status: 'NO_CHANGES',
        rewrittenClasses: new Map(),
        appliedDraftCount: 0,
        appliedPatchCount: 0,
        blockers: [],
        diagnostics: [],
      };
    }

    if (!snapshot.verified) {
      return {
        status: 'BLOCKED',
        rewrittenClasses: new Map(),
        appliedDraftCount,
        appliedPatchCount: 0,
        blockers: [
          {
            field: 'H.p(byte)',
            message:
              `Source-backed verification chưa đạt: ${snapshot.verificationDetail}`,
          },
        ],
        diagnostics: [],
      };
    }

    const blockers = [
      ...validateWritableChanges(profiles, drafts),
      ...validateRuntimeShape(drafts),
    ];

    if (blockers.length > 0) {
      return {
        status: 'BLOCKED',
        rewrittenClasses: new Map(),
        appliedDraftCount,
        appliedPatchCount: 0,
        blockers,
        diagnostics: [],
      };
    }

    const entry = session.zip.file('a/a/H.class');
    if (!entry) {
      return {
        status: 'FAILED',
        rewrittenClasses: new Map(),
        appliedDraftCount,
        appliedPatchCount: 0,
        blockers: [],
        diagnostics: [],
        errorMessage: 'Không tìm thấy a/a/H.class trong JAR.',
      };
    }

    const originalBytes = await entry.async('arraybuffer');
    const patched = patchCharacterStarterClass(
      originalBytes,
      toPatchValues(drafts)
    );

    return {
      status: 'READY',
      rewrittenClasses: new Map([
        ['a/a/H.class', patched.bytes],
      ]),
      appliedDraftCount,
      appliedPatchCount: patched.patchCount,
      blockers: [],
      diagnostics: [
        `H.p(B): ${patched.patchCount} numeric producer đã đổi.`,
        `code_length delta: ${patched.codeLengthDelta >= 0 ? '+' : ''}${patched.codeLengthDelta}.`,
        ...patched.diagnostics,
      ],
    };
  } catch (error) {
    return {
      status: 'FAILED',
      rewrittenClasses: new Map(),
      appliedDraftCount: 0,
      appliedPatchCount: 0,
      blockers: [],
      diagnostics: [],
      errorMessage:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

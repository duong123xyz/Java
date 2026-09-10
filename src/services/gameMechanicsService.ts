import { LoadedJarSession } from '../types/jar';
import { ItemAnalysisSessionData } from '../types/item';
import { getSessionClassInfo } from './patchPlannerService';
import { analyzeItemTables } from './itemDataService';

export interface MechanicSource {
  className: string;
  methodName: string;
  descriptor?: string;
  offset?: number;
  detail: string;
  detected: boolean;
}

export interface DropItemRef {
  id: string;
  name: string;
  iconId: string;
}

export interface DropDistributionEntry {
  label: string;
  chancePercent: number;
  item: DropItemRef | null;
}

export interface DropMechanic {
  key: string;
  title: string;
  description: string;
  baseChancePercent: number;
  quantity?: number;
  group: 'common' | 'conditional' | 'special';
  condition: string;
  items: DropItemRef[];
  source: MechanicSource;
  editableChance: boolean;
  editableQuantity?: boolean;
  distribution?: DropDistributionEntry[];
  notes?: string[];
}

export interface GameMechanicsSnapshot {
  tnsm: {
    baseHpCoefficient: number;
    source: MechanicSource;
    details: string[];
  };
  powerCap: {
    baseCap: number;
    sources: MechanicSource[];
  };
  treasureReward: {
    basePercentAtLevel1: number;
    basePercentAtLevel110: number;
    rawBase: number;
    rawRange: number;
    interpolationDivisor: number;
    boostNumerator: number;
    boostDivisor: number;
    source: MechanicSource;
  };
  gold: {
    globalMultiplierDetected: boolean;
    hookSource: MechanicSource;
    treasureOnlySource: MechanicSource;
  };
  mobDrops: DropMechanic[];
}

export interface GenericMobDropRule {
  id: string;
  enabled: boolean;
  itemId: number;
  quantity: number;
  chancePercent: number;
  /** null = mọi loại quái. Có thể dùng cả mob type âm như -239. */
  mobType: number | null;
  /** null = mọi map. */
  mapId: number | null;
}

export interface GameMechanicsDraft {
  tnsmMultiplier: number;
  /**
   * true  = giữ nguyên cơ chế game gốc: chênh level làm giảm TNSM và có thể ép còn +1.
   * false = bỏ toàn bộ penalty theo chênh level trong tm$reward để reward bám theo damage/các multiplier.
   */
  tnsmLevelLimitEnabled: boolean;
  powerCapMultiplier: number;
  treasureRewardMultiplier: number;
  desiredGlobalGoldMultiplier: number;
  dropChancePercent: Record<string, number>;
  dropQuantity: Record<string, number>;
  /** Drop custom chạy ở hook customDrop cho mọi mob chết. */
  customMobDrops: GenericMobDropRule[];
}

const DEFAULT_DROP_CHANCES: Record<string, number> = {
  gem: 100,
  purpleQuartz: 100 / 30,
  dragonBall5: 5,
  dragonBall7: 2,
  mabuEgg: 5,
  activationLevel1: 0.1,
  upgradeStoneU: 20,
  foodFullDivine: 5,
  rareU: 0.1,
  crystalStar: 5,
  mysteryCapsule: 100,
  questDragon7: 100,
  specialMinus239Dragon: 100,
  specialMinus239Gear: 10,
  campGold: 100,
};

const DEFAULT_DROP_QUANTITY: Record<string, number> = {
  gem: 2,
  purpleQuartz: 1,
  dragonBall5: 1,
  dragonBall7: 1,
  mabuEgg: 1,
  activationLevel1: 1,
  upgradeStoneU: 1,
  foodFullDivine: 1,
  rareU: 1,
  crystalStar: 1,
  mysteryCapsule: 1,
  questDragon7: 1,
  specialMinus239Dragon: 1,
  specialMinus239Gear: 1,
  campGold: 100000,
};

const DEFAULT_DRAFT: GameMechanicsDraft = {
  tnsmMultiplier: 1,
  tnsmLevelLimitEnabled: true,
  powerCapMultiplier: 1,
  treasureRewardMultiplier: 1,
  desiredGlobalGoldMultiplier: 1,
  dropChancePercent: { ...DEFAULT_DROP_CHANCES },
  dropQuantity: { ...DEFAULT_DROP_QUANTITY },
  customMobDrops: [],
};

const draftStore = new WeakMap<LoadedJarSession, GameMechanicsDraft>();

function sameNumber(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Number.EPSILON * scale * 32;
}

function parseNumberFromText(text: string): number | null {
  if (!text) return null;
  const normalized = text.replace(/,/g, '');
  const matches = normalized.match(/-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?/g);
  if (!matches?.length) return null;

  for (let i = matches.length - 1; i >= 0; i--) {
    const parsed = Number(matches[i]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readNumericPush(instruction: any, constantPool?: any[]): number | null {
  if (typeof instruction?.pushValue === 'number') return instruction.pushValue;

  if (
    typeof instruction?.cpIndex === 'number' &&
    constantPool &&
    instruction.cpIndex > 0 &&
    instruction.cpIndex < constantPool.length
  ) {
    const entry: any = constantPool[instruction.cpIndex];
    if (entry) {
      if (typeof entry.value === 'number') return entry.value;
      if (typeof entry.value === 'bigint') return Number(entry.value);
    }
  }

  const resolved =
    typeof instruction?.resolved === 'string' ? parseNumberFromText(instruction.resolved) : null;
  if (resolved !== null) return resolved;

  const operand =
    typeof instruction?.operandDisplay === 'string'
      ? parseNumberFromText(instruction.operandDisplay)
      : null;
  if (operand !== null) return operand;

  return null;
}

function methodHasCall(
  method: any,
  owner: string,
  name: string
): { found: boolean; offset?: number; index?: number } {
  const instructions = method?.code?.instructions || [];
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index];
    const methodRef = instruction.methodRef;
    if (methodRef?.owner === owner && methodRef?.name === name) {
      return { found: true, offset: instruction.offset, index };
    }

    const resolved = `${instruction.resolved || ''} ${instruction.operandDisplay || ''}`;
    if (resolved.includes(owner) && resolved.includes(name)) {
      return { found: true, offset: instruction.offset, index };
    }
  }
  return { found: false };
}

function findConstantPoolNumericIndex(cp: any[], target: number): number | null {
  for (let index = 1; index < cp.length; index++) {
    const entry: any = cp[index];
    if (!entry) continue;
    const raw = typeof entry.value === 'bigint' ? Number(entry.value) : entry.value;
    if (typeof raw === 'number' && Number.isFinite(raw) && sameNumber(raw, target)) {
      return index;
    }
  }
  return null;
}

function findRawConstantLoadOffset(method: any, cp: any[], target: number): number | undefined {
  const cpIndex = findConstantPoolNumericIndex(cp, target);
  const code: Uint8Array | undefined = method?.code?.code;
  if (cpIndex === null || !code) return undefined;

  const hi = (cpIndex >> 8) & 0xff;
  const lo = cpIndex & 0xff;

  for (let offset = 0; offset + 2 < code.length; offset++) {
    if (code[offset] === 0x14 && code[offset + 1] === hi && code[offset + 2] === lo) {
      return offset;
    }
  }

  for (let offset = 0; offset + 2 < code.length; offset++) {
    if (code[offset] === 0x13 && code[offset + 1] === hi && code[offset + 2] === lo) {
      return offset;
    }
  }
  if (cpIndex <= 0xff) {
    for (let offset = 0; offset + 1 < code.length; offset++) {
      if (code[offset] === 0x12 && code[offset + 1] === cpIndex) {
        return offset;
      }
    }
  }

  return undefined;
}

function findNumericOffset(method: any, cp: any[], target: number): number | undefined {
  const instruction = (method?.code?.instructions || []).find((candidate: any) => {
    const value = readNumericPush(candidate, cp);
    return value !== null && sameNumber(value, target);
  });
  if (instruction) return instruction.offset;

  return findRawConstantLoadOffset(method, cp, target);
}

function methodContainsNumericValues(method: any, cp: any[], expected: number[]): boolean {
  return expected.every((target) => findNumericOffset(method, cp, target) !== undefined);
}

function findDirectDrop(
  method: any,
  cp: any[],
  itemId: number,
  quantity: number
): { found: boolean; offset?: number } {
  const instructions = method?.code?.instructions || [];
  for (let index = 2; index < instructions.length; index++) {
    const instruction = instructions[index];
    const ref = instruction.methodRef;
    const resolved = `${instruction.resolved || ''} ${instruction.operandDisplay || ''}`;
    const isDropCall =
      (ref?.owner === 'a/a/h' && ref?.name === 'a') ||
      (resolved.includes('a/a/h') && resolved.includes('.a'));

    if (!isDropCall) continue;

    const maybeItem = readNumericPush(instructions[index - 2], cp);
    const maybeQuantity = readNumericPush(instructions[index - 1], cp);
    if (
      maybeItem !== null &&
      maybeQuantity !== null &&
      sameNumber(maybeItem, itemId) &&
      sameNumber(maybeQuantity, quantity)
    ) {
      return { found: true, offset: instruction.offset };
    }
  }
  return { found: false };
}

function source(
  className: string,
  methodName: string,
  detected: boolean,
  detail: string,
  descriptor?: string,
  offset?: number
): MechanicSource {
  return { className, methodName, descriptor, offset, detail, detected };
}

async function findNumericConstant(
  session: LoadedJarSession,
  className: string,
  methodName: string,
  targetValue: number,
  descriptor?: string
): Promise<MechanicSource> {
  const classInfo = await getSessionClassInfo(session, className);
  if (!classInfo) {
    return source(className, methodName, false, `Không tìm thấy ${className}.class`, descriptor);
  }

  const methods = classInfo.methods.filter(
    (method: any) =>
      method.name === methodName && (!descriptor || method.descriptor === descriptor)
  );

  for (const method of methods) {
    const offset = findNumericOffset(method, classInfo.constantPool, targetValue);
    if (offset !== undefined) {
      const decoded = (method.code?.instructions || []).find(
        (instruction: any) => instruction.offset === offset
      );
      return source(
        className,
        methodName,
        true,
        decoded
          ? `${decoded.mnemonic} ${String(targetValue)}`
          : `ldc2_w/Constant Pool ${String(targetValue)} (raw bytecode fallback)`,
        method.descriptor,
        offset
      );
    }
  }

  return source(
    className,
    methodName,
    false,
    `Không tìm thấy hằng số ${targetValue} trong method`,
    descriptor
  );
}

async function findAllCapSources(
  session: LoadedJarSession,
  cap: number
): Promise<MechanicSource[]> {
  const className = 'a/a/V';
  const classInfo = await getSessionClassInfo(session, className);
  if (!classInfo) {
    return [source(className, '*', false, `Không tìm thấy ${className}.class`)];
  }

  const result: MechanicSource[] = [];
  for (const method of classInfo.methods) {
    const offset = findNumericOffset(method, classInfo.constantPool, cap);
    if (offset !== undefined) {
      result.push(
        source(
          className,
          method.name,
          true,
          `Constant Pool cap ${cap}`,
          method.descriptor,
          offset
        )
      );
    }
  }

  return result.length > 0
    ? result
    : [source(className, '*', false, `Không tìm thấy cap ${cap}`)];
}

async function detectGoldHook(session: LoadedJarSession): Promise<MechanicSource> {
  const className = 'a/a/h';
  const classInfo = await getSessionClassInfo(session, className);
  if (!classInfo) return source(className, 'a', false, `Không tìm thấy ${className}.class`);

  for (const method of classInfo.methods) {
    const call = methodHasCall(method, 'patch/GTLFix', 'scaleGoldQty');
    if (call.found) {
      return source(
        className,
        method.name,
        true,
        'Đường gọi vàng quái → patch/GTLFix.scaleGoldQty',
        method.descriptor,
        call.offset
      );
    }
  }

  return source(className, '*', false, 'Không tìm thấy hook scaleGoldQty');
}

async function detectTreasureGold(session: LoadedJarSession): Promise<MechanicSource> {
  const className = 'patch/TM';
  const classInfo = await getSessionClassInfo(session, className);
  if (!classInfo) {
    return source(className, 'scaleGoldQty', false, `Không tìm thấy ${className}.class`);
  }

  const method = classInfo.methods.find((candidate: any) => candidate.name === 'scaleGoldQty');
  const call = methodHasCall(method, 'patch/DR', 'rewardMultiplierPercent');

  return source(
    className,
    'scaleGoldQty',
    call.found,
    call.found
      ? 'Vàng Bản đồ kho báu dùng rewardMultiplierPercent'
      : 'Không xác minh được rewardMultiplierPercent trong scaleGoldQty',
    method?.descriptor,
    call.offset
  );
}

async function detectTreasureFormula(
  session: LoadedJarSession
): Promise<GameMechanicsSnapshot['treasureReward']> {
  const className = 'patch/DR';
  const methodName = 'rewardMultiplierPercent';
  const classInfo = await getSessionClassInfo(session, className);
  const method = classInfo?.methods.find((candidate: any) => candidate.name === methodName);

  const rawBase = 110;
  const rawRange = 90;
  const interpolationDivisor = 109;
  const boostNumerator = 4;
  const boostDivisor = 3;

  const calc = (level: number) => {
    const interpolated =
      rawBase + Math.trunc(((Math.max(1, level) - 1) * rawRange) / interpolationDivisor);
    return Math.trunc((interpolated * boostNumerator + 1) / boostDivisor);
  };

  if (!method?.code?.instructions || !classInfo) {
    return {
      basePercentAtLevel1: calc(1),
      basePercentAtLevel110: calc(110),
      rawBase,
      rawRange,
      interpolationDivisor,
      boostNumerator,
      boostDivisor,
      source: source(
        className,
        methodName,
        false,
        'Không đọc được công thức; đang hiển thị fallback đã biết'
      ),
    };
  }

  const hasExpected = methodContainsNumericValues(method, classInfo.constantPool, [
    rawBase,
    rawRange,
    interpolationDivisor,
    boostNumerator,
    boostDivisor,
  ]);

  return {
    basePercentAtLevel1: calc(1),
    basePercentAtLevel110: calc(110),
    rawBase,
    rawRange,
    interpolationDivisor,
    boostNumerator,
    boostDivisor,
    source: source(
      className,
      methodName,
      hasExpected,
      hasExpected
        ? 'Đã xác minh hằng số 110 / 90 / 109 / 4 / 3'
        : 'Method tồn tại nhưng không resolve đủ chuỗi hằng số dự kiến',
      method.descriptor,
      method.code.instructions[0]?.offset
    ),
  };
}

async function ensureItemAnalysis(
  session: LoadedJarSession
): Promise<ItemAnalysisSessionData | null> {
  if (session.itemAnalysis) return session.itemAnalysis;
  try {
    return await analyzeItemTables(session);
  } catch (err) {
    console.warn('Không phân tích được Item Template khi dò cơ chế drop:', err);
    return null;
  }
}

function fallbackItemName(id: string): string {
  const names: Record<string, string> = {
    '14': 'Ngọc Rồng 1 sao',
    '15': 'Ngọc Rồng 2 sao',
    '16': 'Ngọc Rồng 3 sao',
    '17': 'Ngọc Rồng 4 sao',
    '18': 'Ngọc Rồng 5 sao',
    '19': 'Ngọc Rồng 6 sao',
    '20': 'Ngọc Rồng 7 sao',
    '77': 'Ngọc',
    '220': 'Đá lục bảo',
    '221': 'Đá Saphia',
    '222': 'Đá Ruby',
    '223': 'Đá Titan',
    '190': 'Vàng',
    '224': 'Đá thạch anh tím',
    '380': 'Viên Capsule kì bí',
    '441': 'Sao pha lê đỏ',
    '442': 'Sao pha lê lam',
    '443': 'Sao pha lê hồng',
    '444': 'Sao pha lê tím',
    '445': 'Sao pha lê cam',
    '446': 'Sao pha lê vàng',
    '447': 'Sao pha lê lục',
    '556': 'Quần Thần Linh',
    '558': 'Quần Thần Namek',
    '560': 'Quần Thần Xayda',
    '568': 'Quả Trứng',
    '663': 'Bánh Pudding',
    '664': 'Xúc xích',
    '665': 'Kem dâu',
    '666': 'Mì ly',
    '667': 'Sushi',
  };
  return names[id] || `Item #${id}`;
}

function itemRef(
  itemAnalysis: ItemAnalysisSessionData | null,
  id: number
): DropItemRef {
  const idText = String(id);
  const item = itemAnalysis?.items.find((candidate: any) => candidate.id === idText);
  return {
    id: idText,
    name: item?.name || fallbackItemName(idText),
    iconId: item?.rawValues?.[6] ?? '',
  };
}

async function analyzeMobDrops(
  session: LoadedJarSession,
  itemAnalysis: ItemAnalysisSessionData | null
): Promise<DropMechanic[]> {
  const [aaClass, saClass, tmClass] = await Promise.all([
    getSessionClassInfo(session, 'a/a/aa'),
    getSessionClassInfo(session, 'patch/SA'),
    getSessionClassInfo(session, 'patch/TM'),
  ]);

  const mainDrop = aaClass?.methods.find(
    (method: any) => method.name === 'a' && method.descriptor === '(La/m;La/a/H;Z)[I'
  );
  const customDrop = aaClass?.methods.find((method: any) => method.name === 'customDrop');
  const activation = saClass?.methods.find(
    (method: any) => method.name === 'maybeDropLevel1Activation'
  );
  const mabuEgg = saClass?.methods.find((method: any) => method.name === 'maybeDropMabuEgg');
  const campLoot = tmClass?.methods.find((method: any) => method.name === 'dropCampMobLoot');

  const aaCp = aaClass?.constantPool || [];
  const saCp = saClass?.constantPool || [];
  const tmCp = tmClass?.constantPool || [];

  const gemDirect = findDirectDrop(mainDrop, aaCp, 77, 2);
  const purpleDirect = findDirectDrop(customDrop, aaCp, 224, 1);
  const db5Direct = findDirectDrop(customDrop, aaCp, 18, 1);
  const db7Direct = findDirectDrop(customDrop, aaCp, 20, 1);
  const eggDirect = findDirectDrop(mabuEgg, saCp, 568, 1);
  const capsuleDirect = findDirectDrop(mainDrop, aaCp, 380, 1);
  const questDragon7Direct = findDirectDrop(mainDrop, aaCp, 20, 1);

  const activationVerified =
    !!activation &&
    !!saClass &&
    methodContainsNumericValues(activation, saCp, [10000, 10, 12, 5, 1635]);

  const upgradeVerified =
    !!mainDrop &&
    !!aaClass &&
    methodContainsNumericValues(mainDrop, aaCp, [100, 20, 4, 220, 71]);

  const foodVerified =
    !!mainDrop &&
    !!aaClass &&
    methodContainsNumericValues(mainDrop, aaCp, [100, 5, 555, 567, 663]);

  const rareUVerified =
    !!mainDrop &&
    !!aaClass &&
    methodContainsNumericValues(mainDrop, aaCp, [1000, 1]) &&
    methodHasCall(mainDrop, 'a/a/aa', 'c').found;

  const starVerified =
    !!mainDrop &&
    !!aaClass &&
    methodContainsNumericValues(mainDrop, aaCp, [100, 5, 441, 7, 461]);

  const campVerified =
    !!campLoot &&
    !!tmClass &&
    methodContainsNumericValues(campLoot, tmCp, [100000, 100, 10, 40, 70, 18, 19, 20]);

  const questDragon7Verified =
    !!mainDrop &&
    !!aaClass &&
    methodContainsNumericValues(mainDrop, aaCp, [8, 1, 10, 11, 12, 20]);

  const specialMinus239Verified =
    !!customDrop &&
    !!aaClass &&
    methodContainsNumericValues(customDrop, aaCp, [-239, 14, 7, 100, 10, 3, 556, 558, 560]);

  return [
    {
      key: 'gem',
      title: 'Ngọc rơi từ quái',
      description: 'Item #77 “Ngọc” được tạo trực tiếp trong bảng drop chính.',
      baseChancePercent: 100,
      quantity: 2,
      group: 'common',
      condition: 'Luồng drop chính sau khi quái chết. Trong bytecode hiện tại, kết quả w(1.000.000) không được dùng để branch nên lệnh drop chạy vô điều kiện.',
      items: [itemRef(itemAnalysis, 77)],
      source: source(
        'a/a/aa',
        'a',
        gemDirect.found,
        gemDirect.found
          ? 'Drop item #77 qty=2; RNG w(1.000.000) bị bỏ kết quả → hiệu lực hiện tại 100%'
          : 'Không xác minh được drop item #77 qty=2',
        mainDrop?.descriptor,
        gemDirect.offset
      ),
      editableChance: true,
      editableQuantity: true,
      notes: [
        'Đây là “Ngọc” dạng item drop của client, không phải mọi phép cộng gem trực tiếp vào tài khoản.',
        'Writer hiện tại có thể phục hồi branch RNG cho rule này; giá trị thực tế sau rewrite được kiểm tra lại khi export.',
      ],
    },
    {
      key: 'purpleQuartz',
      title: 'Đá thạch anh tím',
      description: 'Drop phổ thông trong customDrop.',
      baseChancePercent: 100 / 30,
      quantity: 1,
      group: 'common',
      condition: 'Quái thường đi qua customDrop; random(30) < 1.',
      items: [itemRef(itemAnalysis, 224)],
      source: source('a/a/aa', 'customDrop', purpleDirect.found, 'w(30) < 1 → item #224', customDrop?.descriptor, purpleDirect.offset),
      editableChance: true,
      editableQuantity: true,
    },
    {
      key: 'dragonBall5', title: 'Ngọc Rồng 5 sao', description: 'Một nhánh drop phổ thông trong customDrop.', baseChancePercent: 5, quantity: 1, group: 'common', condition: 'random(100) < 5.', items: [itemRef(itemAnalysis, 18)], source: source('a/a/aa','customDrop',db5Direct.found,'w(100) < 5 → item #18',customDrop?.descriptor,db5Direct.offset), editableChance: true, editableQuantity: true,
    },
    {
      key: 'dragonBall7', title: 'Ngọc Rồng 7 sao', description: 'Một nhánh drop phổ thông trong customDrop.', baseChancePercent: 2, quantity: 1, group: 'common', condition: 'random(100) < 2.', items: [itemRef(itemAnalysis, 20)], source: source('a/a/aa','customDrop',db7Direct.found,'w(100) < 2 → item #20',customDrop?.descriptor,db7Direct.offset), editableChance: true, editableQuantity: true,
    },
    {
      key: 'mabuEgg', title: 'Quả Trứng từ mob #70', description: 'Drop riêng trong patch/SA.', baseChancePercent: 5, quantity: 1, group: 'conditional', condition: 'Chỉ khi mob.cG == 70; random(100) < 5.', items: [itemRef(itemAnalysis, 568)], source: source('patch/SA','maybeDropMabuEgg',eggDirect.found,'mob type 70 + w(100) < 5 → item #568',mabuEgg?.descriptor,eggDirect.offset), editableChance: true, editableQuantity: true,
    },
    {
      key: 'activationLevel1', title: 'Trang bị kích hoạt cấp 1', description: 'Patch SA tạo một món trang bị kích hoạt ngẫu nhiên phù hợp hành tinh.', baseChancePercent: 0.1, quantity: 1, group: 'conditional', condition: 'Map 1–3 / 8–10 / 15–17 và mob HP đúng 200 / 500 / 600. Base 10/10.000; nếu có item #1635 thì 12/10.000.', items: [], source: source('patch/SA','maybeDropLevel1Activation',activationVerified,activationVerified ? 'w(10000) < 10; có Cỏ bốn lá #1635 → threshold 12' : 'Không xác minh đủ chuỗi 10000 / 10 / 12 / 1635',activation?.descriptor,activation ? findNumericOffset(activation, saCp, 10000) : undefined), editableChance: true, editableQuantity: false, notes: ['Tỷ lệ khi có Cỏ bốn lá là 0,12%, cao hơn base 0,10%.'],
    },
    {
      key: 'upgradeStoneU', title: 'Đá nâng cấp ở map 105–110', description: 'Chọn ngẫu nhiên một trong 4 loại đá.', baseChancePercent: 20, quantity: 1, group: 'conditional', condition: 'Chỉ map ID 105–110; random(100) < 20; sau đó random(4) chọn #220–223.', items: [220,221,222,223].map((id)=>itemRef(itemAnalysis,id)), source: source('a/a/aa','a',upgradeVerified,'U(map)=105..110; w(100) < 20; item = 220 + w(4)',mainDrop?.descriptor,mainDrop ? findNumericOffset(mainDrop,aaCp,220) : undefined), editableChance: true, editableQuantity: true,
    },
    {
      key: 'foodFullDivine', title: 'Đồ ăn Bill khi mặc đủ Thần Linh', description: 'Random một trong 5 món #663–667.', baseChancePercent: 5, quantity: 1, group: 'conditional', condition: 'Map 105–110 + cả 5 slot đầu đều có template ID trong 555–567 + random(100) < 5.', items: [663,664,665,666,667].map((id)=>itemRef(itemAnalysis,id)), source: source('a/a/aa','a',foodVerified,'U(map) + full set 555..567 + w(100) < 5',mainDrop?.descriptor,mainDrop ? findNumericOffset(mainDrop,aaCp,663) : undefined), editableChance: true, editableQuantity: true,
    },
    {
      key: 'rareU', title: 'Drop hiếm ở map 105–110', description: 'Nhánh c(mob) chọn item theo loại / cấp mob.', baseChancePercent: 0.1, quantity: 1, group: 'conditional', condition: 'Map ID 105–110; random(1000) < 1.', items: [], source: source('a/a/aa','a',rareUVerified,'U(map) + w(1000) < 1 → c(mob)',mainDrop?.descriptor,mainDrop ? findNumericOffset(mainDrop,aaCp,1000) : undefined), editableChance: true, editableQuantity: true,
    },
    {
      key: 'crystalStar', title: 'Sao pha lê', description: 'Random #441–447 khi đủ điều kiện cải trang.', baseChancePercent: 5, quantity: 1, group: 'conditional', condition: 'Điều kiện trang bị slot 5 là template #461 + random(100) < 5.', items: [441,442,443,444,445,446,447].map((id)=>itemRef(itemAnalysis,id)), source: source('a/a/aa','a',starVerified,'item slot 5 == #461 + w(100) < 5; item = 441 + w(7)',mainDrop?.descriptor,mainDrop ? findNumericOffset(mainDrop,aaCp,441) : undefined), editableChance: true, editableQuantity: true,
    },
    {
      key: 'mysteryCapsule', title: 'Viên Capsule kì bí', description: 'Drop theo nhóm mob tương lai khi người chơi có máy dò.', baseChancePercent: 100, quantity: 1, group: 'conditional', condition: 'Mob type 58–65 + người chơi có item #379 “Máy dò Capsule kì bí”. Nhánh xác suất đang bị ép thành luôn cho qua.', items: [itemRef(itemAnalysis,380)], source: source('a/a/aa','a',capsuleDirect.found,'mob 58..65 + item #379 → item #380; branch hiện tại cho qua 100% khi đủ điều kiện',mainDrop?.descriptor,capsuleDirect.offset), editableChance: true, editableQuantity: true,
    },
    {
      key: 'questDragon7', title: 'Ngọc Rồng 7 sao theo nhiệm vụ', description: 'Một nhánh riêng trong bảng drop chính, không dùng RNG khi đủ điều kiện.', baseChancePercent: 100, quantity: 1, group: 'conditional', condition: 'Player yk == 8, an == 1 và mob type khớp hành tinh: Trái Đất #11 / Namek #12 / Xayda #10.', items: [itemRef(itemAnalysis,20)], source: source('a/a/aa','a',questDragon7Verified && questDragon7Direct.found,'Điều kiện quest/hành tinh → item #20 qty=1, không có random trong nhánh này',mainDrop?.descriptor,questDragon7Direct.offset), editableChance: true, editableQuantity: true, notes: ['Đây là drop theo trạng thái nhiệm vụ; chỉnh tỷ lệ cần chèn RNG mới vào nhánh vốn đang guaranteed.'],
    },
    {
      key: 'specialMinus239Dragon', title: 'Mob đặc biệt type -239: Ngọc Rồng 1–7 sao', description: 'Nhánh customDrop dành riêng cho mob type âm đặc biệt.', baseChancePercent: 100, quantity: 1, group: 'special', condition: 'mob.cG == -239; luôn chọn ngẫu nhiên item #14 + random(7), tức Ngọc Rồng 1–7 sao.', items: [14,15,16,17,18,19,20].map((id)=>itemRef(itemAnalysis,id)), source: source('a/a/aa','customDrop',specialMinus239Verified,'cG == -239 → item = 14 + w(7), qty=1',customDrop?.descriptor,customDrop ? findNumericOffset(customDrop,aaCp,-239) : undefined), editableChance: true, editableQuantity: true,
    },
    {
      key: 'specialMinus239Gear', title: 'Mob type -239: trang bị Thần Linh phụ', description: 'Sau Ngọc Rồng, mob đặc biệt còn roll thêm một món quần Thần Linh theo hành tinh.', baseChancePercent: 10, quantity: 1, group: 'special', condition: 'mob.cG == -239; random(100) < 10; random(3) chọn #556 / #558 / #560.', items: [556,558,560].map((id)=>itemRef(itemAnalysis,id)), source: source('a/a/aa','customDrop',specialMinus239Verified,'w(100) < 10; w(3) chọn #556/#558/#560',customDrop?.descriptor,customDrop ? findNumericOffset(customDrop,aaCp,100) : undefined), editableChance: true, editableQuantity: true,
    },
    {
      key: 'campGold', title: 'Vàng mob doanh trại', description: 'Mỗi mob doanh trại tạo một drop vàng cố định trước khi roll Ngọc Rồng.', baseChancePercent: 100, quantity: 100000, group: 'special', condition: 'Map ID 53–62; patch/TM.dropCampMobLoot gọi tm$drop5(item #190, quantity 100000).', items: [itemRef(itemAnalysis,190)], source: source('patch/TM','dropCampMobLoot',campVerified,'item #190 “Vàng”, qty=100000, không có RNG bao quanh lệnh drop',campLoot?.descriptor,campLoot ? findNumericOffset(campLoot,tmCp,100000) : undefined), editableChance: true, editableQuantity: true,
    },
    {
      key: 'campDragonBalls', title: 'Loot mob doanh trại (map 53–62)', description: 'Ngoài vàng cố định, random một nhánh Ngọc Rồng.', baseChancePercent: 70, quantity: 1, group: 'special', condition: 'customDrop chuyển sang patch/TM.dropCampMobLoot khi map ID 53–62.', items: [18,19,20].map((id)=>itemRef(itemAnalysis,id)), source: source('patch/TM','dropCampMobLoot',campVerified,'Vàng 100.000 luôn rơi; RNG 0..99: <10 #18, <40 #19, <70 #20, còn lại không có Ngọc Rồng',campLoot?.descriptor,campLoot ? findNumericOffset(campLoot,tmCp,100000) : undefined), editableChance: false, distribution: [
        { label: 'Ngọc Rồng 5 sao', chancePercent: 10, item: itemRef(itemAnalysis,18) },
        { label: 'Ngọc Rồng 6 sao', chancePercent: 30, item: itemRef(itemAnalysis,19) },
        { label: 'Ngọc Rồng 7 sao', chancePercent: 30, item: itemRef(itemAnalysis,20) },
        { label: 'Không rơi Ngọc Rồng', chancePercent: 30, item: null },
      ], notes: ['Mỗi mob doanh trại còn tạo một drop vàng với quantity 100.000 trước khi roll Ngọc Rồng.'],
    },
  ];
}

export async function analyzeGameMechanics(session: LoadedJarSession): Promise<GameMechanicsSnapshot> {
  const itemAnalysisPromise = ensureItemAnalysis(session);
  const [tnsmSource, capSources, treasureReward, goldHook, treasureGold, itemAnalysis] = await Promise.all([
    findNumericConstant(session, 'a/a/aa', 'tm$reward', 0.0005),
    findAllCapSources(session, 1_000_000_000_000),
    detectTreasureFormula(session),
    detectGoldHook(session),
    detectTreasureGold(session),
    itemAnalysisPromise,
  ]);
  const mobDrops = await analyzeMobDrops(session, itemAnalysis);
  return {
    tnsm: {
      baseHpCoefficient: 0.0005,
      source: tnsmSource,
      details: [
        'Base reward = tham số reward + mobHP × 0.0005.',
        'Mob type 0 hoặc 117 ép base reward về 1.',
        'Nếu người chơi cao hơn mob quá 5 cấp thì reward bị ép về 1.',
        'Các trường hợp còn lại chia cho 1.25 + floor(|levelDiff| × 0.5).',
        'tm$reward truyền cùng một reward vào a/a/V.a(player, reward, reward), nên sức mạnh và tiềm năng nhận cùng delta trước cap.',
        'Sau đó còn đi qua multiplier a/a/x.l(player), a/a/u.b(reward), a/a/x.d(player,reward) và cap trong a/a/V.',
      ],
    },
    powerCap: { baseCap: 1_000_000_000_000, sources: capSources },
    treasureReward,
    gold: { globalMultiplierDetected: goldHook.detected, hookSource: goldHook, treasureOnlySource: treasureGold },
    mobDrops,
  };
}

function cloneDraft(draft: GameMechanicsDraft): GameMechanicsDraft {
  return {
    ...draft,
    dropChancePercent: { ...draft.dropChancePercent },
    dropQuantity: { ...draft.dropQuantity },
    customMobDrops: (draft.customMobDrops ?? []).map((rule) => ({ ...rule })),
  };
}

export function getGameMechanicsDraft(session: LoadedJarSession): GameMechanicsDraft {
  const existing = draftStore.get(session);
  if (existing) return cloneDraft(existing);
  const draft = cloneDraft(DEFAULT_DRAFT);
  draftStore.set(session, draft);
  return cloneDraft(draft);
}

export function setGameMechanicsDraft(session: LoadedJarSession, nextDraft: GameMechanicsDraft): void {
  const normalized: GameMechanicsDraft = {
    tnsmMultiplier: normalizeMultiplier(nextDraft.tnsmMultiplier),
    // Backward compatible với draft cũ chưa có field này.
    tnsmLevelLimitEnabled: nextDraft.tnsmLevelLimitEnabled !== false,
    powerCapMultiplier: normalizeMultiplier(nextDraft.powerCapMultiplier),
    treasureRewardMultiplier: normalizeMultiplier(nextDraft.treasureRewardMultiplier),
    desiredGlobalGoldMultiplier: normalizeMultiplier(nextDraft.desiredGlobalGoldMultiplier),
    dropChancePercent: {},
    dropQuantity: {},
    customMobDrops: [],
  };
  for (const [key, defaultValue] of Object.entries(DEFAULT_DROP_CHANCES)) {
    normalized.dropChancePercent[key] = normalizeChance(nextDraft.dropChancePercent[key] ?? defaultValue);
  }
  for (const [key, defaultValue] of Object.entries(DEFAULT_DROP_QUANTITY)) {
    normalized.dropQuantity[key] = normalizeQuantity(nextDraft.dropQuantity[key] ?? defaultValue);
  }

  const incomingCustom = Array.isArray(nextDraft.customMobDrops)
    ? nextDraft.customMobDrops
    : [];
  normalized.customMobDrops = incomingCustom.slice(0, 100).map((rule, index) => {
    const itemId = Math.max(0, Math.min(2_147_483_647, Math.round(Number(rule?.itemId) || 0)));
    const quantity = Math.max(1, Math.min(2_147_483_647, Math.round(Number(rule?.quantity) || 1)));
    const chancePercent = normalizeChance(Number(rule?.chancePercent ?? 100));
    const mobTypeRaw = rule?.mobType;
    const mapIdRaw = rule?.mapId;
    const mobType = mobTypeRaw === null || mobTypeRaw === undefined || mobTypeRaw === ('' as any)
      ? null
      : Math.max(-2_147_483_648, Math.min(2_147_483_647, Math.round(Number(mobTypeRaw) || 0)));
    const mapId = mapIdRaw === null || mapIdRaw === undefined || mapIdRaw === ('' as any)
      ? null
      : Math.max(-2_147_483_648, Math.min(2_147_483_647, Math.round(Number(mapIdRaw) || 0)));
    return {
      id: String(rule?.id || `custom-drop-${index}`),
      enabled: rule?.enabled !== false,
      itemId,
      quantity,
      chancePercent,
      mobType,
      mapId,
    };
  });
  draftStore.set(session, normalized);
}

export function resetGameMechanicsDraft(session: LoadedJarSession): void {
  draftStore.set(session, cloneDraft(DEFAULT_DRAFT));
}

export function exportGameMechanicsDraft(session: LoadedJarSession): GameMechanicsDraft {
  return getGameMechanicsDraft(session);
}

export function importGameMechanicsDraft(session: LoadedJarSession, draft: GameMechanicsDraft | null | undefined): void {
  if (!draft) { resetGameMechanicsDraft(session); return; }
  setGameMechanicsDraft(session, draft);
}

export function getGameMechanicsDirtyCount(draft: GameMechanicsDraft): number {
  let count = 0;
  if (!sameNumber(draft.tnsmMultiplier, DEFAULT_DRAFT.tnsmMultiplier)) count++;
  if (draft.tnsmLevelLimitEnabled !== DEFAULT_DRAFT.tnsmLevelLimitEnabled) count++;
  if (!sameNumber(draft.powerCapMultiplier, DEFAULT_DRAFT.powerCapMultiplier)) count++;
  if (!sameNumber(draft.treasureRewardMultiplier, DEFAULT_DRAFT.treasureRewardMultiplier)) count++;
  if (!sameNumber(draft.desiredGlobalGoldMultiplier, DEFAULT_DRAFT.desiredGlobalGoldMultiplier)) count++;
  for (const [key, defaultValue] of Object.entries(DEFAULT_DROP_CHANCES)) {
    if (!sameNumber(draft.dropChancePercent[key] ?? defaultValue, defaultValue)) count++;
  }
  for (const [key, defaultValue] of Object.entries(DEFAULT_DROP_QUANTITY)) {
    if (!sameNumber(draft.dropQuantity[key] ?? defaultValue, defaultValue)) count++;
  }
  count += (draft.customMobDrops ?? []).length;
  return count;
}

/**
 * Multipliers are intentionally NOT hard-capped by the panel anymore.
 * The writer is responsible for rejecting values that cannot be represented by the
 * real JVM primitive used by that mechanic (int/long/double). This avoids silently
 * cutting e.g. x5000 TNSM back to x100.
 */
export function normalizeMultiplier(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value;
}

/** Probability has a real mathematical range of 0..100%. This is not an artificial UI cap. */
export function normalizeChance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value * 1000) / 1000));
}

/** Quantity no longer has the old artificial 999,999 cap. */
export function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

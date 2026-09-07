export interface CharacterSourceProfileNumbers {
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

export interface CharacterBytecodeInspection {
  verified: boolean;
  detail: string;
  profiles: [
    CharacterSourceProfileNumbers,
    CharacterSourceProfileNumbers,
    CharacterSourceProfileNumbers
  ];
  methodCodeLength: number;
  constantPoolCount: number;
}

export interface CharacterBytecodePatchValues {
  mapBase: number;
  spawnX: number;
  spawnY: number;
  gold: number;
  gems: number;
  ruby: number;
  power: number;
  potential: number;
  hpEarth: number;
  hpOther: number;
  kiNamek: number;
  kiOther: number;
  damageXayda: number;
  damageOther: number;
  baseArmor: number;
  baseCritical: number;
  speed: number;
  level: number;
  skillPoints: number;
  stamina: number;
  selectedSkillEarth: number;
  selectedSkillNamek: number;
  selectedSkillXayda: number;
}

export interface CharacterClassPatchResult {
  bytes: ArrayBuffer;
  patchCount: number;
  codeLengthDelta: number;
  diagnostics: string[];
}

interface CpEntry {
  index: number;
  tag: number;
  payloadOffset: number;
  value?: number | bigint | string;
  nameIndex?: number;
  classIndex?: number;
  nameAndTypeIndex?: number;
  descriptorIndex?: number;
}

interface ExceptionEntry {
  startPc: number;
  endPc: number;
  handlerPc: number;
  catchType: number;
}

interface NestedCodeAttribute {
  nameIndex: number;
  name: string;
  data: Uint8Array;
}

interface MethodLayout {
  name: string;
  descriptor: string;
  attributeLengthOffset: number;
  attributeLength: number;
  codeDataStart: number;
  maxStack: number;
  maxLocals: number;
  codeLengthOffset: number;
  codeStart: number;
  codeLength: number;
  codeEnd: number;
  exceptionTable: ExceptionEntry[];
  nestedAttributes: NestedCodeAttribute[];
}

interface ClassLayout {
  cpCount: number;
  cpEnd: number;
  constantPool: Array<CpEntry | null>;
  utf8: Map<number, string>;
  methods: MethodLayout[];
}

interface NumericPush {
  value: number | bigint;
  length: number;
  cpIndex?: number;
}

interface Replacement {
  offset: number;
  oldLength: number;
  bytes: Uint8Array;
  label: string;
}

const TAG_INTEGER = 3;
const TAG_LONG = 5;
const TAG_CLASS = 7;
const TAG_FIELDREF = 9;
const TAG_NAME_AND_TYPE = 12;

type CharacterTargetKey =
  | 'mapBase'
  | 'spawnX'
  | 'spawnY'
  | 'gold'
  | 'gems'
  | 'ruby'
  | 'power'
  | 'potential'
  | 'hpEarth'
  | 'hpOther'
  | 'kiNamek'
  | 'kiOther'
  | 'damageXayda'
  | 'damageOther'
  | 'baseArmor'
  | 'baseCritical'
  | 'speed'
  | 'level'
  | 'skillPoints'
  | 'stamina'
  | 'selectedSkillEarth'
  | 'selectedSkillNamek'
  | 'selectedSkillXayda';

type CharacterTargetOffsets = Record<CharacterTargetKey, number>;


function readU2(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}
function readU4(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}
function writeU2(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}
function writeI2(bytes: Uint8Array, offset: number, value: number): void {
  writeU2(bytes, offset, value & 0xffff);
}
function writeU4(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
function writeI4(bytes: Uint8Array, offset: number, value: number): void {
  writeU4(bytes, offset, value >>> 0);
}
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
function skipAttributes(view: DataView, offset: number, count: number): number {
  let cursor = offset;
  for (let index = 0; index < count; index++) {
    cursor += 2;
    const length = readU4(view, cursor);
    cursor += 4 + length;
  }
  return cursor;
}

function parseClassLayout(buffer: ArrayBuffer): ClassLayout {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0xcafebabe) {
    throw new Error('a/a/H.class không có magic CAFEBABE.');
  }

  const cpCount = readU2(view, 8);
  const constantPool: Array<CpEntry | null> = new Array(cpCount).fill(null);
  const utf8 = new Map<number, string>();
  let cursor = 10;

  for (let index = 1; index < cpCount; index++) {
    const tag = view.getUint8(cursor++);
    const payloadOffset = cursor;

    switch (tag) {
      case 1: {
        const length = readU2(view, cursor);
        cursor += 2;
        const value = new TextDecoder('utf-8', { fatal: false }).decode(
          bytes.slice(cursor, cursor + length)
        );
        constantPool[index] = { index, tag, payloadOffset, value };
        utf8.set(index, value);
        cursor += length;
        break;
      }
      case 3:
        constantPool[index] = {
          index,
          tag,
          payloadOffset,
          value: view.getInt32(cursor, false),
        };
        cursor += 4;
        break;
      case 4:
        constantPool[index] = {
          index,
          tag,
          payloadOffset,
          value: view.getFloat32(cursor, false),
        };
        cursor += 4;
        break;
      case 5:
        constantPool[index] = {
          index,
          tag,
          payloadOffset,
          value: view.getBigInt64(cursor, false),
        };
        cursor += 8;
        index++;
        if (index < cpCount) constantPool[index] = null;
        break;
      case 6:
        constantPool[index] = {
          index,
          tag,
          payloadOffset,
          value: view.getFloat64(cursor, false),
        };
        cursor += 8;
        index++;
        if (index < cpCount) constantPool[index] = null;
        break;
      case 7:
        constantPool[index] = {
          index,
          tag,
          payloadOffset,
          nameIndex: readU2(view, cursor),
        };
        cursor += 2;
        break;
      case 8:
      case 16:
      case 19:
      case 20:
        constantPool[index] = { index, tag, payloadOffset };
        cursor += 2;
        break;
      case 9:
      case 10:
      case 11:
        constantPool[index] = {
          index,
          tag,
          payloadOffset,
          classIndex: readU2(view, cursor),
          nameAndTypeIndex: readU2(view, cursor + 2),
        };
        cursor += 4;
        break;
      case 12:
        constantPool[index] = {
          index,
          tag,
          payloadOffset,
          nameIndex: readU2(view, cursor),
          descriptorIndex: readU2(view, cursor + 2),
        };
        cursor += 4;
        break;
      case 15:
        constantPool[index] = { index, tag, payloadOffset };
        cursor += 3;
        break;
      case 17:
      case 18:
        constantPool[index] = { index, tag, payloadOffset };
        cursor += 4;
        break;
      default:
        throw new Error(`Constant Pool tag ${tag} chưa hỗ trợ trong Character writer.`);
    }
  }

  const cpEnd = cursor;
  cursor += 6;

  const interfaceCount = readU2(view, cursor);
  cursor += 2 + interfaceCount * 2;

  const fieldCount = readU2(view, cursor);
  cursor += 2;
  for (let index = 0; index < fieldCount; index++) {
    cursor += 6;
    const attributeCount = readU2(view, cursor);
    cursor += 2;
    cursor = skipAttributes(view, cursor, attributeCount);
  }

  const methodCount = readU2(view, cursor);
  cursor += 2;
  const methods: MethodLayout[] = [];

  for (let index = 0; index < methodCount; index++) {
    cursor += 2;
    const nameIndex = readU2(view, cursor);
    cursor += 2;
    const descriptorIndex = readU2(view, cursor);
    cursor += 2;
    const attributeCount = readU2(view, cursor);
    cursor += 2;

    const name = utf8.get(nameIndex) ?? '';
    const descriptor = utf8.get(descriptorIndex) ?? '';

    for (let attr = 0; attr < attributeCount; attr++) {
      const attributeNameIndex = readU2(view, cursor);
      cursor += 2;
      const attributeLengthOffset = cursor;
      const attributeLength = readU4(view, cursor);
      cursor += 4;
      const dataStart = cursor;
      const attributeName = utf8.get(attributeNameIndex) ?? '';

      if (attributeName === 'Code') {
        const maxStack = readU2(view, dataStart);
        const maxLocals = readU2(view, dataStart + 2);
        const codeLengthOffset = dataStart + 4;
        const codeLength = readU4(view, codeLengthOffset);
        const codeStart = dataStart + 8;
        const codeEnd = codeStart + codeLength;
        let tail = codeEnd;

        const exceptionTableLength = readU2(view, tail);
        tail += 2;
        const exceptionTable: ExceptionEntry[] = [];
        for (let exceptionIndex = 0; exceptionIndex < exceptionTableLength; exceptionIndex++) {
          exceptionTable.push({
            startPc: readU2(view, tail),
            endPc: readU2(view, tail + 2),
            handlerPc: readU2(view, tail + 4),
            catchType: readU2(view, tail + 6),
          });
          tail += 8;
        }

        const nestedAttributeCount = readU2(view, tail);
        tail += 2;
        const nestedAttributes: NestedCodeAttribute[] = [];
        for (let nestedIndex = 0; nestedIndex < nestedAttributeCount; nestedIndex++) {
          const nestedNameIndex = readU2(view, tail);
          tail += 2;
          const nestedLength = readU4(view, tail);
          tail += 4;
          nestedAttributes.push({
            nameIndex: nestedNameIndex,
            name: utf8.get(nestedNameIndex) ?? '',
            data: bytes.slice(tail, tail + nestedLength),
          });
          tail += nestedLength;
        }

        methods.push({
          name,
          descriptor,
          attributeLengthOffset,
          attributeLength,
          codeDataStart: dataStart,
          maxStack,
          maxLocals,
          codeLengthOffset,
          codeStart,
          codeLength,
          codeEnd,
          exceptionTable,
          nestedAttributes,
        });
      }
      cursor = dataStart + attributeLength;
    }
  }

  return { cpCount, cpEnd, constantPool, utf8, methods };
}

function findMethod(layout: ClassLayout): MethodLayout {
  const method = layout.methods.find(
    (candidate) => candidate.name === 'p' && candidate.descriptor === '(B)V'
  );
  if (!method) throw new Error('Không tìm thấy a/a/H.p(B)V.');
  return method;
}

function fieldRef(
  layout: ClassLayout,
  cpIndex: number
): { name: string; descriptor: string } {
  const ref = layout.constantPool[cpIndex];
  if (!ref || ref.tag !== TAG_FIELDREF || !ref.classIndex || !ref.nameAndTypeIndex) {
    throw new Error(`#${cpIndex} không phải Fieldref.`);
  }
  const classEntry = layout.constantPool[ref.classIndex];
  const nt = layout.constantPool[ref.nameAndTypeIndex];
  if (
    !classEntry ||
    classEntry.tag !== TAG_CLASS ||
    !classEntry.nameIndex ||
    !nt ||
    nt.tag !== TAG_NAME_AND_TYPE ||
    !nt.nameIndex ||
    !nt.descriptorIndex
  ) {
    throw new Error(`Fieldref #${cpIndex} có cấu trúc CP không hợp lệ.`);
  }
  return {
    name: layout.utf8.get(nt.nameIndex) ?? '',
    descriptor: layout.utf8.get(nt.descriptorIndex) ?? '',
  };
}

function codeBytes(allBytes: Uint8Array, method: MethodLayout): Uint8Array {
  return allBytes.slice(method.codeStart, method.codeEnd);
}
function readSignedShort(code: Uint8Array, offset: number): number {
  const raw = (code[offset] << 8) | code[offset + 1];
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}
function readSignedInt(code: Uint8Array, offset: number): number {
  return new DataView(code.buffer, code.byteOffset + offset, 4).getInt32(0, false);
}

function readNumericPush(
  code: Uint8Array,
  offset: number,
  layout: ClassLayout
): NumericPush | null {
  const opcode = code[offset];
  if (opcode === 0x02) return { value: -1, length: 1 };
  if (opcode >= 0x03 && opcode <= 0x08) {
    return { value: opcode - 0x03, length: 1 };
  }
  if (opcode === 0x09) return { value: 0n, length: 1 };
  if (opcode === 0x0a) return { value: 1n, length: 1 };
  if (opcode === 0x10) {
    const raw = code[offset + 1];
    return { value: raw >= 0x80 ? raw - 0x100 : raw, length: 2 };
  }
  if (opcode === 0x11) {
    return { value: readSignedShort(code, offset + 1), length: 3 };
  }
  if (opcode === 0x12) {
    const cpIndex = code[offset + 1];
    const entry = layout.constantPool[cpIndex];
    if (entry && (entry.tag === TAG_INTEGER || entry.tag === TAG_LONG)) {
      return { value: entry.value as number | bigint, length: 2, cpIndex };
    }
  }
  if (opcode === 0x13 || opcode === 0x14) {
    const cpIndex = (code[offset + 1] << 8) | code[offset + 2];
    const entry = layout.constantPool[cpIndex];
    if (entry && (entry.tag === TAG_INTEGER || entry.tag === TAG_LONG)) {
      return { value: entry.value as number | bigint, length: 3, cpIndex };
    }
  }
  return null;
}

function numericAsNumber(push: NumericPush | null, label: string): number {
  if (!push) throw new Error(`${label}: không đọc được numeric push.`);
  const value = typeof push.value === 'bigint' ? Number(push.value) : push.value;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label}: giá trị vượt Number.MAX_SAFE_INTEGER.`);
  }
  return value;
}

function expectPutfield(
  code: Uint8Array,
  layout: ClassLayout,
  offset: number,
  expectedName: string,
  expectedDescriptor: string
): void {
  if (code[offset] !== 0xb5) {
    throw new Error(`H.p(B) @${offset}: expected putfield ${expectedName}.`);
  }
  const cpIndex = (code[offset + 1] << 8) | code[offset + 2];
  const ref = fieldRef(layout, cpIndex);
  if (ref.name !== expectedName || ref.descriptor !== expectedDescriptor) {
    throw new Error(
      `H.p(B) @${offset}: nhận ${ref.name}:${ref.descriptor}, expected ${expectedName}:${expectedDescriptor}.`
    );
  }
}

function expectBranch(
  code: Uint8Array,
  offset: number,
  opcode: number,
  target: number
): void {
  if (code[offset] !== opcode) {
    throw new Error(
      `H.p(B) @${offset}: branch opcode 0x${code[offset].toString(16)}, expected 0x${opcode.toString(16)}.`
    );
  }
  const actualTarget = offset + readSignedShort(code, offset + 1);
  if (actualTarget !== target) {
    throw new Error(`H.p(B) @${offset}: branch target ${actualTarget}, expected ${target}.`);
  }
}


function findPutfieldOffset(
  code: Uint8Array,
  layout: ClassLayout,
  name: string,
  descriptor: string
): number {
  const matches: number[] = [];
  for (const offset of instructionOffsets(code)) {
    if (code[offset] !== 0xb5) continue;
    const cpIndex = (code[offset + 1] << 8) | code[offset + 2];
    try {
      const ref = fieldRef(layout, cpIndex);
      if (ref.name === name && ref.descriptor === descriptor) {
        matches.push(offset);
      }
    } catch {
      // Ignore non-field refs; opcode already narrows this heavily.
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `H.p(B): cần đúng 1 putfield ${name}:${descriptor}, nhận ${matches.length}.`
    );
  }
  return matches[0];
}

function previousInstruction(
  offsets: number[],
  currentOffset: number,
  steps: number
): number {
  const index = offsets.indexOf(currentOffset);
  if (index < steps) {
    throw new Error(
      `Không tìm được instruction -${steps} trước offset ${currentOffset}.`
    );
  }
  return offsets[index - steps];
}

function branchTargetAt(
  code: Uint8Array,
  offset: number
): number {
  const opcode = code[offset];
  if (
    (opcode >= 0x99 && opcode <= 0xa8) ||
    opcode === 0xc6 ||
    opcode === 0xc7
  ) {
    return offset + readSignedShort(code, offset + 1);
  }
  if (opcode === 0xc8 || opcode === 0xc9) {
    return offset + readSignedInt(code, offset + 1);
  }
  throw new Error(`Instruction @${offset} không phải branch.`);
}

function gotosTo(
  code: Uint8Array,
  target: number
): number[] {
  return instructionOffsets(code).filter(
    (offset) =>
      (code[offset] === 0xa7 || code[offset] === 0xc8) &&
      branchTargetAt(code, offset) === target
  );
}

function locateCharacterTargets(
  code: Uint8Array,
  layout: ClassLayout
): CharacterTargetOffsets {
  const offsets = instructionOffsets(code);
  const pf = (name: string, descriptor = 'I') =>
    findPutfieldOffset(code, layout, name, descriptor);

  const mapPut = pf('vP');
  const xPut = pf('cp');
  const yPut = pf('cq');
  const goldPut = pf('bS', 'J');
  const gemsPut = pf('xv');
  const rubyPut = pf('xw');
  const powerPut = pf('bT', 'J');
  const potentialPut = pf('bU', 'J');
  const hpPut = pf('xx');
  const kiPut = pf('xy');
  const damagePut = pf('xz');
  const armorPut = pf('xA');
  const critPut = pf('xB');
  const speedPut = pf('xC');
  const levelPut = pf('vO');
  const pointsPut = pf('yf');
  const maxStaminaPut = pf('yh');
  const staminaPut = pf('yg');
  const skillPut = pf('yi');

  const mapBase = previousInstruction(offsets, mapPut, 3);
  const mapPlanetLoad = previousInstruction(offsets, mapPut, 2);
  const mapAdd = previousInstruction(offsets, mapPut, 1);
  if (code[mapPlanetLoad] !== 0x1b || code[mapAdd] !== 0x60) {
    throw new Error('Công thức map spawn không còn dạng base + planet.');
  }

  const twoWayProducers = (
    putfieldOffset: number,
    label: string
  ): [number, number] => {
    const commonProducer = previousInstruction(offsets, putfieldOffset, 1);
    const gotos = gotosTo(code, putfieldOffset);
    if (gotos.length !== 1) {
      throw new Error(
        `${label}: cần đúng 1 goto hội tụ vào putfield, nhận ${gotos.length}.`
      );
    }
    return [
      previousInstruction(offsets, gotos[0], 1),
      commonProducer,
    ];
  };

  const [hpEarth, hpOther] = twoWayProducers(hpPut, 'baseHp');
  const [kiNamek, kiOther] = twoWayProducers(kiPut, 'baseKi');
  const [damageXayda, damageOther] = twoWayProducers(
    damagePut,
    'baseDamage'
  );

  // Hai goto tương ứng Earth và Namek; Xayda rơi thẳng vào putfield yi.
  const skillGotos = gotosTo(code, skillPut).sort((a, b) => a - b);
  if (skillGotos.length !== 2) {
    throw new Error(
      `selectedSkill: cần đúng 2 goto hội tụ, nhận ${skillGotos.length}.`
    );
  }

  const staminaProducer = previousInstruction(offsets, staminaPut, 3);
  const dupOffset = previousInstruction(offsets, staminaPut, 2);
  const yhOffset = previousInstruction(offsets, staminaPut, 1);
  if (code[dupOffset] !== 0x5a || yhOffset !== maxStaminaPut) {
    throw new Error(
      'Thể lực không còn dạng push; dup_x1; putfield yh; putfield yg.'
    );
  }

  return {
    mapBase,
    spawnX: previousInstruction(offsets, xPut, 1),
    spawnY: previousInstruction(offsets, yPut, 1),
    gold: previousInstruction(offsets, goldPut, 1),
    gems: previousInstruction(offsets, gemsPut, 1),
    ruby: previousInstruction(offsets, rubyPut, 1),
    power: previousInstruction(offsets, powerPut, 1),
    potential: previousInstruction(offsets, potentialPut, 1),
    hpEarth,
    hpOther,
    kiNamek,
    kiOther,
    damageXayda,
    damageOther,
    baseArmor: previousInstruction(offsets, armorPut, 1),
    baseCritical: previousInstruction(offsets, critPut, 1),
    speed: previousInstruction(offsets, speedPut, 1),
    level: previousInstruction(offsets, levelPut, 1),
    skillPoints: previousInstruction(offsets, pointsPut, 1),
    stamina: staminaProducer,
    selectedSkillEarth: previousInstruction(offsets, skillGotos[0], 1),
    selectedSkillNamek: previousInstruction(offsets, skillGotos[1], 1),
    selectedSkillXayda: previousInstruction(offsets, skillPut, 1),
  };
}

function inspectInternal(buffer: ArrayBuffer): {
  layout: ClassLayout;
  method: MethodLayout;
  code: Uint8Array;
  targets: CharacterTargetOffsets;
  profiles: [
    CharacterSourceProfileNumbers,
    CharacterSourceProfileNumbers,
    CharacterSourceProfileNumbers
  ];
} {
  const layout = parseClassLayout(buffer);
  const method = findMethod(layout);
  const allBytes = new Uint8Array(buffer);
  const code = codeBytes(allBytes, method);

  const unsupportedNested = method.nestedAttributes.filter(
    (attribute) => attribute.name !== 'StackMap'
  );
  if (unsupportedNested.length > 0) {
    throw new Error(
      `H.p(B) có nested Code attribute chưa hỗ trợ: ${unsupportedNested
        .map((attribute) => attribute.name || '?')
        .join(', ')}.`
    );
  }

  const targets = locateCharacterTargets(code, layout);
  const n = (key: CharacterTargetKey) =>
    numericAsNumber(readNumericPush(code, targets[key], layout), key);

  const mapBase = n('mapBase');
  const common = {
    spawnX: n('spawnX'),
    spawnY: n('spawnY'),
    gold: n('gold'),
    gems: n('gems'),
    ruby: n('ruby'),
    power: n('power'),
    potential: n('potential'),
    baseArmor: n('baseArmor'),
    baseCritical: n('baseCritical'),
    speed: n('speed'),
    level: n('level'),
    skillPoints: n('skillPoints'),
    stamina: n('stamina'),
    maxStamina: n('stamina'),
  };

  const hpEarth = n('hpEarth');
  const hpOther = n('hpOther');
  const kiNamek = n('kiNamek');
  const kiOther = n('kiOther');
  const damageXayda = n('damageXayda');
  const damageOther = n('damageOther');

  return {
    layout,
    method,
    code,
    targets,
    profiles: [
      {
        ...common,
        mapId: mapBase,
        baseHp: hpEarth,
        baseKi: kiOther,
        baseDamage: damageOther,
        selectedSkill: n('selectedSkillEarth'),
      },
      {
        ...common,
        mapId: mapBase + 1,
        baseHp: hpOther,
        baseKi: kiNamek,
        baseDamage: damageOther,
        selectedSkill: n('selectedSkillNamek'),
      },
      {
        ...common,
        mapId: mapBase + 2,
        baseHp: hpOther,
        baseKi: kiOther,
        baseDamage: damageXayda,
        selectedSkill: n('selectedSkillXayda'),
      },
    ],
  };
}

function zeroProfile(): CharacterSourceProfileNumbers {
  return {
    mapId: 0,
    spawnX: 0,
    spawnY: 0,
    gold: 0,
    gems: 0,
    ruby: 0,
    power: 0,
    potential: 0,
    baseHp: 0,
    baseKi: 0,
    baseDamage: 0,
    baseArmor: 0,
    baseCritical: 0,
    speed: 0,
    level: 0,
    skillPoints: 0,
    stamina: 0,
    maxStamina: 0,
    selectedSkill: 0,
  };
}

export function inspectCharacterStarterClass(
  buffer: ArrayBuffer
): CharacterBytecodeInspection {
  try {
    const inspected = inspectInternal(buffer);
    return {
      verified: true,
      detail:
        'Đã parse trực tiếp H.p(byte): field refs, branch targets và 23 numeric producer đều khớp.',
      profiles: inspected.profiles,
      methodCodeLength: inspected.method.codeLength,
      constantPoolCount: inspected.layout.cpCount,
    };
  } catch (error) {
    return {
      verified: false,
      detail: error instanceof Error ? error.message : String(error),
      profiles: [zeroProfile(), zeroProfile(), zeroProfile()],
      methodCodeLength: 0,
      constantPoolCount: 0,
    };
  }
}

function instructionLength(code: Uint8Array, offset: number): number {
  const opcode = code[offset];
  if (opcode === 0xaa || opcode === 0xab) {
    throw new Error(
      `H.p(B) chứa ${opcode === 0xaa ? 'tableswitch' : 'lookupswitch'}; writer không resize method này.`
    );
  }
  if (opcode === 0xc4) {
    return code[offset + 1] === 0x84 ? 6 : 4;
  }
  if (
    opcode === 0x10 ||
    opcode === 0x12 ||
    (opcode >= 0x15 && opcode <= 0x19) ||
    (opcode >= 0x36 && opcode <= 0x3a) ||
    opcode === 0xa9 ||
    opcode === 0xbc
  ) return 2;
  if (
    opcode === 0x11 ||
    opcode === 0x13 ||
    opcode === 0x14 ||
    opcode === 0x84 ||
    (opcode >= 0x99 && opcode <= 0xa8) ||
    (opcode >= 0xb2 && opcode <= 0xb8) ||
    opcode === 0xbb ||
    opcode === 0xbd ||
    opcode === 0xc0 ||
    opcode === 0xc1 ||
    opcode === 0xc6 ||
    opcode === 0xc7
  ) return 3;
  if (opcode === 0xc5) return 4;
  if (
    opcode === 0xb9 ||
    opcode === 0xba ||
    opcode === 0xc8 ||
    opcode === 0xc9
  ) return 5;
  return 1;
}

function instructionOffsets(code: Uint8Array): number[] {
  const result: number[] = [];
  let offset = 0;
  while (offset < code.length) {
    result.push(offset);
    const length = instructionLength(code, offset);
    if (length <= 0 || offset + length > code.length) {
      throw new Error(`Instruction tại ${offset} có length ${length} không hợp lệ.`);
    }
    offset += length;
  }
  if (offset !== code.length) {
    throw new Error(`Instruction walk dừng tại ${offset}/${code.length}.`);
  }
  return result;
}

function findExistingNumericCp(
  layout: ClassLayout,
  tag: number,
  value: number | bigint
): number | null {
  for (const entry of layout.constantPool) {
    if (!entry || entry.tag !== tag) continue;
    if (
      tag === TAG_INTEGER &&
      typeof entry.value === 'number' &&
      entry.value === Number(value)
    ) return entry.index;
    if (
      tag === TAG_LONG &&
      typeof entry.value === 'bigint' &&
      entry.value === BigInt(value)
    ) return entry.index;
  }
  return null;
}

function integerConstant(value: number): Uint8Array {
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint8(0, TAG_INTEGER);
  view.setInt32(1, value, false);
  return new Uint8Array(buffer);
}

function longConstant(value: bigint): Uint8Array {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, TAG_LONG);
  view.setBigInt64(1, value, false);
  return new Uint8Array(buffer);
}

function numericKey(tag: number, value: number | bigint): string {
  return `${tag}:${String(value)}`;
}

function appendNumericConstants(
  original: Uint8Array,
  requirements: Array<{ tag: number; value: number | bigint }>
): { bytes: Uint8Array; indexes: Map<string, number> } {
  const originalBuffer = original.buffer.slice(
    original.byteOffset,
    original.byteOffset + original.byteLength
  ) as ArrayBuffer;
  const layout = parseClassLayout(originalBuffer);
  const indexes = new Map<string, number>();
  const appended: Uint8Array[] = [];
  let nextIndex = layout.cpCount;

  for (const requirement of requirements) {
    const key = numericKey(requirement.tag, requirement.value);
    if (indexes.has(key)) continue;

    const existing = findExistingNumericCp(layout, requirement.tag, requirement.value);
    if (existing !== null) {
      indexes.set(key, existing);
      continue;
    }

    const index = nextIndex;
    if (requirement.tag === TAG_LONG) {
      appended.push(longConstant(BigInt(requirement.value)));
      nextIndex += 2;
    } else if (requirement.tag === TAG_INTEGER) {
      appended.push(integerConstant(Number(requirement.value)));
      nextIndex += 1;
    } else {
      throw new Error(`Numeric CP tag ${requirement.tag} không hỗ trợ.`);
    }
    indexes.set(key, index);
  }

  if (nextIndex > 65535) throw new Error('Constant Pool H.class vượt 65535 sau patch.');
  if (appended.length === 0) return { bytes: original.slice(), indexes };

  const cpCountBytes = new Uint8Array(2);
  writeU2(cpCountBytes, 0, nextIndex);
  return {
    bytes: concatBytes([
      original.slice(0, 8),
      cpCountBytes,
      original.slice(10, layout.cpEnd),
      ...appended,
      original.slice(layout.cpEnd),
    ]),
    indexes,
  };
}

function intPushRequirements(values: number[]): Array<{ tag: number; value: number }> {
  return values
    .filter((value) => Number.isInteger(value) && (value < -32768 || value > 32767))
    .map((value) => ({ tag: TAG_INTEGER, value }));
}

function encodeIntPush(value: number, cpIndexes: Map<string, number>): Uint8Array {
  if (!Number.isInteger(value)) throw new Error(`${value} không phải integer.`);
  if (value === -1) return new Uint8Array([0x02]);
  if (value >= 0 && value <= 5) return new Uint8Array([0x03 + value]);
  if (value >= -128 && value <= 127) return new Uint8Array([0x10, value & 0xff]);
  if (value >= -32768 && value <= 32767) {
    return new Uint8Array([0x11, (value >>> 8) & 0xff, value & 0xff]);
  }
  if (value < -2147483648 || value > 2147483647) {
    throw new Error(`Integer ${value} vượt phạm vi JVM int.`);
  }

  const cpIndex = cpIndexes.get(numericKey(TAG_INTEGER, value));
  if (!cpIndex) throw new Error(`Thiếu CONSTANT_Integer ${value}.`);
  if (cpIndex <= 255) return new Uint8Array([0x12, cpIndex]);
  return new Uint8Array([0x13, (cpIndex >>> 8) & 0xff, cpIndex & 0xff]);
}

function encodeLongPush(value: number, cpIndexes: Map<string, number>): Uint8Array {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Long ${value} phải là safe integer trong editor hiện tại.`);
  }
  if (value === 0) return new Uint8Array([0x09]);
  if (value === 1) return new Uint8Array([0x0a]);

  const asBigInt = BigInt(value);
  const cpIndex = cpIndexes.get(numericKey(TAG_LONG, asBigInt));
  if (!cpIndex) throw new Error(`Thiếu CONSTANT_Long ${value}.`);
  return new Uint8Array([0x14, (cpIndex >>> 8) & 0xff, cpIndex & 0xff]);
}

function valueEquals(current: NumericPush, nextValue: number): boolean {
  return typeof current.value === 'bigint'
    ? current.value === BigInt(nextValue)
    : current.value === nextValue;
}

function buildReplacement(
  code: Uint8Array,
  layout: ClassLayout,
  offset: number,
  nextValue: number,
  label: string,
  kind: 'int' | 'long',
  cpIndexes: Map<string, number>
): Replacement | null {
  const current = readNumericPush(code, offset, layout);
  if (!current) throw new Error(`${label} @${offset}: không phải numeric push.`);
  if (valueEquals(current, nextValue)) return null;

  return {
    offset,
    oldLength: current.length,
    bytes: kind === 'long'
      ? encodeLongPush(nextValue, cpIndexes)
      : encodeIntPush(nextValue, cpIndexes),
    label,
  };
}

function deltaBefore(replacements: Replacement[], oldOffset: number): number {
  let delta = 0;
  for (const replacement of replacements) {
    if (replacement.offset >= oldOffset) break;
    delta += replacement.bytes.length - replacement.oldLength;
  }
  return delta;
}
function remapOffset(replacements: Replacement[], oldOffset: number): number {
  return oldOffset + deltaBefore(replacements, oldOffset);
}

function rewriteCodeWithReplacements(
  originalCode: Uint8Array,
  rawReplacements: Replacement[]
): { code: Uint8Array; delta: number } {
  const replacements = rawReplacements.slice().sort((a, b) => a.offset - b.offset);
  const offsets = instructionOffsets(originalCode);
  const boundaries = new Set(offsets);

  let previousEnd = -1;
  for (const replacement of replacements) {
    if (!boundaries.has(replacement.offset)) {
      throw new Error(`${replacement.label}: offset ${replacement.offset} không nằm trên instruction boundary.`);
    }
    if (replacement.offset < previousEnd) {
      throw new Error(`${replacement.label}: replacement chồng lấn.`);
    }
    previousEnd = replacement.offset + replacement.oldLength;
  }

  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const replacement of replacements) {
    parts.push(originalCode.slice(cursor, replacement.offset));
    parts.push(replacement.bytes);
    cursor = replacement.offset + replacement.oldLength;
  }
  parts.push(originalCode.slice(cursor));
  const rewritten = concatBytes(parts);

  for (const oldOffset of offsets) {
    const opcode = originalCode[oldOffset];
    if (
      (opcode >= 0x99 && opcode <= 0xa8) ||
      opcode === 0xc6 ||
      opcode === 0xc7
    ) {
      const oldTarget = oldOffset + readSignedShort(originalCode, oldOffset + 1);
      const newSource = remapOffset(replacements, oldOffset);
      const newTarget = remapOffset(replacements, oldTarget);
      const nextDelta = newTarget - newSource;
      if (nextDelta < -32768 || nextDelta > 32767) {
        throw new Error(`Branch @${oldOffset} vượt 16-bit sau resize.`);
      }
      writeI2(rewritten, newSource + 1, nextDelta);
    } else if (opcode === 0xc8 || opcode === 0xc9) {
      const oldTarget = oldOffset + readSignedInt(originalCode, oldOffset + 1);
      const newSource = remapOffset(replacements, oldOffset);
      const newTarget = remapOffset(replacements, oldTarget);
      writeI4(rewritten, newSource + 1, newTarget - newSource);
    }
  }

  return {
    code: rewritten,
    delta: rewritten.length - originalCode.length,
  };
}

function verificationTypeLength(data: Uint8Array, offset: number): number {
  const tag = data[offset];
  if (tag >= 0 && tag <= 6) return 1;
  if (tag === 7 || tag === 8) return 3;
  throw new Error(`StackMap verification_type tag ${tag} không hỗ trợ.`);
}

function rewriteStackMap(
  original: Uint8Array,
  replacements: Replacement[]
): Uint8Array {
  const data = original.slice();
  if (data.length < 2) throw new Error('StackMap bị cắt.');
  let cursor = 0;
  const entries = (data[cursor] << 8) | data[cursor + 1];
  cursor += 2;

  for (let entryIndex = 0; entryIndex < entries; entryIndex++) {
    if (cursor + 2 > data.length) throw new Error('StackMap frame bị cắt.');
    const oldOffset = (data[cursor] << 8) | data[cursor + 1];
    const newOffset = remapOffset(replacements, oldOffset);
    if (newOffset < 0 || newOffset > 65535) {
      throw new Error(`StackMap frame ${oldOffset} → ${newOffset} vượt u2.`);
    }
    writeU2(data, cursor, newOffset);
    cursor += 2;

    if (cursor + 2 > data.length) throw new Error('StackMap locals count bị cắt.');
    const locals = (data[cursor] << 8) | data[cursor + 1];
    cursor += 2;
    for (let localIndex = 0; localIndex < locals; localIndex++) {
      const tag = data[cursor];
      const length = verificationTypeLength(data, cursor);
      if (tag === 8) {
        const oldNewOffset = (data[cursor + 1] << 8) | data[cursor + 2];
        const mapped = remapOffset(replacements, oldNewOffset);
        writeU2(data, cursor + 1, mapped);
      }
      cursor += length;
    }

    if (cursor + 2 > data.length) throw new Error('StackMap stack count bị cắt.');
    const stack = (data[cursor] << 8) | data[cursor + 1];
    cursor += 2;
    for (let stackIndex = 0; stackIndex < stack; stackIndex++) {
      const tag = data[cursor];
      const length = verificationTypeLength(data, cursor);
      if (tag === 8) {
        const oldNewOffset = (data[cursor + 1] << 8) | data[cursor + 2];
        const mapped = remapOffset(replacements, oldNewOffset);
        writeU2(data, cursor + 1, mapped);
      }
      cursor += length;
    }
  }

  if (cursor !== data.length) {
    throw new Error(`StackMap parse còn ${data.length - cursor} byte dư.`);
  }
  return data;
}

function u2(value: number): Uint8Array {
  const out = new Uint8Array(2);
  writeU2(out, 0, value);
  return out;
}
function u4(value: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU4(out, 0, value);
  return out;
}

function replaceMethodCode(
  original: Uint8Array,
  method: MethodLayout,
  rewrittenCode: Uint8Array,
  replacements: Replacement[]
): Uint8Array {
  const delta = rewrittenCode.length - method.codeLength;

  const nestedAttributes = method.nestedAttributes.map((attribute) => {
    if (attribute.name === 'StackMap') {
      return {
        ...attribute,
        data: rewriteStackMap(attribute.data, replacements),
      };
    }
    if (delta !== 0) {
      throw new Error(
        `Không thể resize H.p(B) khi còn nested attribute ${attribute.name}.`
      );
    }
    return attribute;
  });

  const exceptionBytes: Uint8Array[] = [u2(method.exceptionTable.length)];
  for (const entry of method.exceptionTable) {
    const startPc = remapOffset(replacements, entry.startPc);
    const endPc = remapOffset(replacements, entry.endPc);
    const handlerPc = remapOffset(replacements, entry.handlerPc);
    exceptionBytes.push(
      u2(startPc),
      u2(endPc),
      u2(handlerPc),
      u2(entry.catchType)
    );
  }

  const nestedBytes: Uint8Array[] = [u2(nestedAttributes.length)];
  for (const attribute of nestedAttributes) {
    nestedBytes.push(
      u2(attribute.nameIndex),
      u4(attribute.data.length),
      attribute.data
    );
  }

  const codePayload = concatBytes([
    u2(method.maxStack),
    u2(method.maxLocals),
    u4(rewrittenCode.length),
    rewrittenCode,
    ...exceptionBytes,
    ...nestedBytes,
  ]);

  const oldDataEnd = method.codeDataStart + method.attributeLength;
  const result = concatBytes([
    original.slice(0, method.codeDataStart),
    codePayload,
    original.slice(oldDataEnd),
  ]);

  writeU4(result, method.attributeLengthOffset, codePayload.length);
  return result;
}



export function patchCharacterStarterClass(
  originalBuffer: ArrayBuffer,
  values: CharacterBytecodePatchValues
): CharacterClassPatchResult {
  const originalInspection = inspectInternal(originalBuffer);

  const integerValues = [
    values.mapBase,
    values.spawnX,
    values.spawnY,
    values.gems,
    values.ruby,
    values.hpEarth,
    values.hpOther,
    values.kiNamek,
    values.kiOther,
    values.damageXayda,
    values.damageOther,
    values.baseArmor,
    values.baseCritical,
    values.speed,
    values.level,
    values.skillPoints,
    values.stamina,
    values.selectedSkillEarth,
    values.selectedSkillNamek,
    values.selectedSkillXayda,
  ];

  for (const value of integerValues) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      throw new Error(`Character int ${value} vượt phạm vi JVM int.`);
    }
  }
  for (const value of [values.gold, values.power, values.potential]) {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Character long ${value} vượt Number safe integer.`);
    }
  }

  const requirements: Array<{ tag: number; value: number | bigint }> = [
    ...intPushRequirements(integerValues),
  ];
  for (const value of [values.gold, values.power, values.potential]) {
    if (value !== 0 && value !== 1) {
      requirements.push({ tag: TAG_LONG, value: BigInt(value) });
    }
  }

  const originalBytes = new Uint8Array(originalBuffer);
  const withCp = appendNumericConstants(originalBytes, requirements);
  const cpBuffer = withCp.bytes.buffer.slice(
    withCp.bytes.byteOffset,
    withCp.bytes.byteOffset + withCp.bytes.byteLength
  ) as ArrayBuffer;
  const layout = parseClassLayout(cpBuffer);
  const method = findMethod(layout);
  const code = codeBytes(withCp.bytes, method);

  const targets = locateCharacterTargets(code, layout);
  for (const key of Object.keys(targets) as CharacterTargetKey[]) {
    if (targets[key] !== originalInspection.targets[key]) {
      throw new Error(
        `CP append làm lệch logical target ${key}: ${originalInspection.targets[key]} → ${targets[key]}.`
      );
    }
  }

  const replacements: Replacement[] = [];
  const add = (
    key: CharacterTargetKey,
    nextValue: number,
    kind: 'int' | 'long' = 'int'
  ) => {
    const replacement = buildReplacement(
      code,
      layout,
      targets[key],
      nextValue,
      key,
      kind,
      withCp.indexes
    );
    if (replacement) replacements.push(replacement);
  };

  add('mapBase', values.mapBase);
  add('spawnX', values.spawnX);
  add('spawnY', values.spawnY);
  add('gold', values.gold, 'long');
  add('gems', values.gems);
  add('ruby', values.ruby);
  add('power', values.power, 'long');
  add('potential', values.potential, 'long');
  add('hpEarth', values.hpEarth);
  add('hpOther', values.hpOther);
  add('kiNamek', values.kiNamek);
  add('kiOther', values.kiOther);
  add('damageXayda', values.damageXayda);
  add('damageOther', values.damageOther);
  add('baseArmor', values.baseArmor);
  add('baseCritical', values.baseCritical);
  add('speed', values.speed);
  add('level', values.level);
  add('skillPoints', values.skillPoints);
  add('stamina', values.stamina);
  add('selectedSkillEarth', values.selectedSkillEarth);
  add('selectedSkillNamek', values.selectedSkillNamek);
  add('selectedSkillXayda', values.selectedSkillXayda);

  if (replacements.length === 0) {
    return {
      bytes: originalBytes.slice().buffer,
      patchCount: 0,
      codeLengthDelta: 0,
      diagnostics: ['H.p(B): không có numeric field thay đổi.'],
    };
  }

  const rewritten = rewriteCodeWithReplacements(code, replacements);
  const finalBytes = replaceMethodCode(withCp.bytes, method, rewritten.code, replacements);
  const finalBuffer = finalBytes.buffer.slice(
    finalBytes.byteOffset,
    finalBytes.byteOffset + finalBytes.byteLength
  ) as ArrayBuffer;

  const verifiedInspection = inspectInternal(finalBuffer);
  const verified = verifiedInspection.profiles;
  const expected = [
    {
      mapId: values.mapBase,
      hp: values.hpEarth,
      ki: values.kiOther,
      damage: values.damageOther,
      skill: values.selectedSkillEarth,
    },
    {
      mapId: values.mapBase + 1,
      hp: values.hpOther,
      ki: values.kiNamek,
      damage: values.damageOther,
      skill: values.selectedSkillNamek,
    },
    {
      mapId: values.mapBase + 2,
      hp: values.hpOther,
      ki: values.kiOther,
      damage: values.damageXayda,
      skill: values.selectedSkillXayda,
    },
  ];

  for (let planet = 0; planet < 3; planet++) {
    const profile = verified[planet];
    const exp = expected[planet];
    if (
      profile.mapId !== exp.mapId ||
      profile.spawnX !== values.spawnX ||
      profile.spawnY !== values.spawnY ||
      profile.gold !== values.gold ||
      profile.gems !== values.gems ||
      profile.ruby !== values.ruby ||
      profile.power !== values.power ||
      profile.potential !== values.potential ||
      profile.baseHp !== exp.hp ||
      profile.baseKi !== exp.ki ||
      profile.baseDamage !== exp.damage ||
      profile.baseArmor !== values.baseArmor ||
      profile.baseCritical !== values.baseCritical ||
      profile.speed !== values.speed ||
      profile.level !== values.level ||
      profile.skillPoints !== values.skillPoints ||
      profile.stamina !== values.stamina ||
      profile.maxStamina !== values.stamina ||
      profile.selectedSkill !== exp.skill
    ) {
      throw new Error(`Verify H.p(B) planet ${planet} không khớp sau rewrite.`);
    }
  }

  return {
    bytes: finalBuffer,
    patchCount: replacements.length,
    codeLengthDelta: rewritten.delta,
    diagnostics: replacements.map(
      (replacement) =>
        `${replacement.label} @${replacement.offset}: ${replacement.oldLength}B → ${replacement.bytes.length}B`
    ),
  };
}

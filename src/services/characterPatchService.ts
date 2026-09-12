import { LoadedJarSession } from '../types/jar';
import { getSessionClassInfo } from './patchPlannerService';
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


// ---- Đệ tử: inlined into existing characterPatchService (no new source file) ----
export interface DiscipleSkillValue {
  id: number;
  level: number;
}

export interface DiscipleDefaultsValues {
  type: number;
  planet: number;
  status: number;
  power: number;
  potential: number;
  baseHp: number;
  baseKi: number;
  baseDamage: number;
  armor: number;
  critical: number;
  hp: number;
  ki: number;
  stamina: number;
  maxStamina: number;
  skills: DiscipleSkillValue[];
}

export interface DiscipleClassPatchResult {
  classBytes: ArrayBuffer;
  helperBytes: ArrayBuffer;
  hookAdded: boolean;
  patchCount: number;
  diagnostics: string[];
}

interface CpEntry {
  index: number;
  tag: number;
  payloadOffset: number;
  value?: string | number | bigint;
  classIndex?: number;
  nameAndTypeIndex?: number;
  nameIndex?: number;
  descriptorIndex?: number;
}

interface MethodLayout {
  name: string;
  descriptor: string;
  attributeLengthOffset: number;
  codeLengthOffset: number;
  codeStart: number;
  codeLength: number;
  codeEnd: number;
}

interface ClassLayout {
  cpCount: number;
  cpEnd: number;
  constantPool: Array<CpEntry | null>;
  utf8: Map<number, string>;
  methods: MethodLayout[];
}

const HELPER_CLASS_INTERNAL = 'patch/PanelDiscipleDefaults';
const HELPER_CLASS_PATH = `${HELPER_CLASS_INTERNAL}.class`;
const HELPER_METHOD = 'apply';
const HELPER_DESCRIPTOR = '(La/a/H;)V';

// Template compiled as straight-line bytecode, then class major retargeted to 47
// (CLDC-era compatible). All editable values are unique CONSTANT_Integer/Long
// entries, so writer only changes CP payloads and never resizes helper code.
const HELPER_TEMPLATE_BASE64 = 'yv66vgAAAC8AZAoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWAwaOd4EKAAkACgcACwwADAANAQAbcGF0Y2gvUGFuZWxEaXNjaXBsZURlZmF1bHRzAQAGYXNCeXRlAQAEKEkpQgkADwAQBwARDAASABMBAAVhL2EvSAEAAmFaAQABQgMGjneCCQAPABYMABcAEwEAAmJhAwaOd4MJAA8AGgwAGwATAQACYmIFAAAA0YwuKAEJAA8AHwwAIAAhAQACY2oBAAFKBQAAANGMLigCCQAPACUMACYAIQEAAmNrAwcnDgEJAA8AKQwAKgArAQACeXEBAAFJAwcnDgIJAA8ALgwALwArAQACeXIDBycOAwkADwAyDAAzACsBAAJ5cwMHJw4ECQAPADYMADcAKwEAAnl0AwcnDgUJAA8AOgwAOwArAQACeXUDBycOBgkADwA+DAA/ACsBAAJ5dgMHJw4HCQAPAEIMAEMAKwEAAnl3AwcnDggJAA8ARgwARwArAQACeXgDBycOCQkADwBKDABLACsBAAJ5eQkADwBNDABOAE8BAAJjVgEAAltJAwe/pIEJAA8AUgwAUwBPAQACY1cDCFg7AQMHv6SCAwhYOwIDB7+kgwMIWDsDAwe/pIQDCFg7BAMHv6SFAwhYOwUDB7+khgMIWDsGAwe/pIcDCFg7BwEABENvZGUBAAVhcHBseQEACihMYS9hL0g7KVYAMQAJAAIAAAAAAAMAAgAFAAYAAQBhAAAAEQABAAEAAAAFKrcAAbEAAAAAAAoADAANAAEAYQAAAA8AAQABAAAAAxqRrAAAAAAACQBiAGMAAQBhAAAA3gADAAEAAADSKhIHuAAItQAOKhIUuAAItQAVKhIYuAAItQAZKhQAHLUAHioUACK1ACQqEie1ACgqEiy1AC0qEjC1ADEqEjS1ADUqEji1ADkqEjy1AD0qEkC1AEEqEkS1AEUqEki1AEkqtABMAxJQTyq0AFEDElRPKrQATAQSVU8qtABRBBJWTyq0AEwFEldPKrQAUQUSWE8qtABMBhJZTyq0AFEGElpPKrQATAcSW08qtABRBxJcTyq0AEwIEl1PKrQAUQgSXk8qtABMEAYSX08qtABREAYSYE+xAAAAAAAA';

const HELPER_CP_INDEX = {
  type: 7,
  planet: 20,
  status: 24,
  power: 28,
  potential: 34,
  baseHp: 39,
  baseKi: 44,
  baseDamage: 48,
  armor: 52,
  critical: 56,
  hp: 60,
  ki: 64,
  stamina: 68,
  maxStamina: 72,
  skillIds: [80, 85, 87, 89, 91, 93, 95],
  skillLevels: [84, 86, 88, 90, 92, 94, 96],
} as const;

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

function writeU4(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
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
  if (bytes.byteLength < 10 || view.getUint32(0, false) !== 0xcafebabe) {
    throw new Error('Class đệ tử không có magic CAFEBABE.');
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
        constantPool[index] = { index, tag, payloadOffset };
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
        constantPool[index] = { index, tag, payloadOffset };
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
        throw new Error(`Constant Pool tag ${tag} chưa hỗ trợ trong Disciple writer.`);
    }
  }

  const cpEnd = cursor;
  cursor += 6; // access_flags + this_class + super_class

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

    for (let attributeIndex = 0; attributeIndex < attributeCount; attributeIndex++) {
      const attributeNameIndex = readU2(view, cursor);
      cursor += 2;
      const attributeLengthOffset = cursor;
      const attributeLength = readU4(view, cursor);
      cursor += 4;
      const dataStart = cursor;
      const attributeName = utf8.get(attributeNameIndex) ?? '';

      if (attributeName === 'Code') {
        const codeLengthOffset = dataStart + 4;
        const codeLength = readU4(view, codeLengthOffset);
        const codeStart = dataStart + 8;
        methods.push({
          name,
          descriptor,
          attributeLengthOffset,
          codeLengthOffset,
          codeStart,
          codeLength,
          codeEnd: codeStart + codeLength,
        });
      }

      cursor = dataStart + attributeLength;
    }
  }

  return { cpCount, cpEnd, constantPool, utf8, methods };
}

function resolveMethodRef(
  layout: ClassLayout,
  index: number
): { owner: string; name: string; descriptor: string } | null {
  const ref = layout.constantPool[index];
  if (!ref || ref.tag !== 10 || !ref.classIndex || !ref.nameAndTypeIndex) return null;
  const classEntry = layout.constantPool[ref.classIndex];
  const nameAndType = layout.constantPool[ref.nameAndTypeIndex];
  if (
    !classEntry ||
    classEntry.tag !== 7 ||
    !classEntry.nameIndex ||
    !nameAndType ||
    nameAndType.tag !== 12 ||
    !nameAndType.nameIndex ||
    !nameAndType.descriptorIndex
  ) {
    return null;
  }
  return {
    owner: layout.utf8.get(classEntry.nameIndex) ?? '',
    name: layout.utf8.get(nameAndType.nameIndex) ?? '',
    descriptor: layout.utf8.get(nameAndType.descriptorIndex) ?? '',
  };
}

function findHelperMethodRef(layout: ClassLayout): number | null {
  for (let index = 1; index < layout.cpCount; index++) {
    const resolved = resolveMethodRef(layout, index);
    if (
      resolved?.owner === HELPER_CLASS_INTERNAL &&
      resolved.name === HELPER_METHOD &&
      resolved.descriptor === HELPER_DESCRIPTOR
    ) {
      return index;
    }
  }
  return null;
}

function utf8Entry(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const out = new Uint8Array(3 + encoded.byteLength);
  out[0] = 1;
  writeU2(out, 1, encoded.byteLength);
  out.set(encoded, 3);
  return out;
}

function u2Entry(tag: number, value: number): Uint8Array {
  const out = new Uint8Array(3);
  out[0] = tag;
  writeU2(out, 1, value);
  return out;
}

function pairEntry(tag: number, first: number, second: number): Uint8Array {
  const out = new Uint8Array(5);
  out[0] = tag;
  writeU2(out, 1, first);
  writeU2(out, 3, second);
  return out;
}

function ensureDiscipleHook(input: ArrayBuffer): { bytes: ArrayBuffer; hookAdded: boolean } {
  let bytes = new Uint8Array(input.slice(0));
  let layout = parseClassLayout(toArrayBuffer(bytes));
  let helperRef = findHelperMethodRef(layout);

  if (helperRef === null) {
    if (layout.cpCount + 6 >= 0xffff) {
      throw new Error('Constant Pool a/a/H đã quá đầy để gắn Disciple writer.');
    }

    const classUtf8Index = layout.cpCount;
    const classIndex = classUtf8Index + 1;
    const methodUtf8Index = classUtf8Index + 2;
    const descriptorUtf8Index = classUtf8Index + 3;
    const nameAndTypeIndex = classUtf8Index + 4;
    helperRef = classUtf8Index + 5;

    const cpAppend = concatBytes([
      utf8Entry(HELPER_CLASS_INTERNAL),
      u2Entry(7, classUtf8Index),
      utf8Entry(HELPER_METHOD),
      utf8Entry(HELPER_DESCRIPTOR),
      pairEntry(12, methodUtf8Index, descriptorUtf8Index),
      pairEntry(10, classIndex, nameAndTypeIndex),
    ]);

    const next = new Uint8Array(bytes.byteLength + cpAppend.byteLength);
    next.set(bytes.slice(0, layout.cpEnd), 0);
    next.set(cpAppend, layout.cpEnd);
    next.set(bytes.slice(layout.cpEnd), layout.cpEnd + cpAppend.byteLength);
    writeU2(next, 8, layout.cpCount + 6);
    bytes = next;
    layout = parseClassLayout(toArrayBuffer(bytes));
  }

  const method = layout.methods.find(
    (candidate) => candidate.name === 'gf' && candidate.descriptor === '()V'
  );
  if (!method) throw new Error('Không tìm thấy a/a/H.gf()V để gắn Disciple writer.');

  const code = bytes.slice(method.codeStart, method.codeEnd);
  const callPattern = new Uint8Array([
    0x2a,
    0xb8,
    (helperRef >>> 8) & 0xff,
    helperRef & 0xff,
    0xb1,
  ]);

  if (
    code.byteLength >= callPattern.byteLength &&
    callPattern.every(
      (value, index) => code[code.byteLength - callPattern.byteLength + index] === value
    )
  ) {
    return { bytes: toArrayBuffer(bytes), hookAdded: false };
  }

  if (code[code.byteLength - 1] !== 0xb1) {
    throw new Error('a/a/H.gf() không kết thúc bằng RETURN như JAR đã xác minh.');
  }

  // gf() gốc chỉ có branch target <= 141; hook được chèn ngay trước RETURN @150.
  // Vì không đổi offset của instruction/StackMap frame cũ nên writer không phải
  // rebuild StackMapTable hay branch offsets.
  const insertionOffset = method.codeEnd - 1;
  const call = new Uint8Array([
    0x2a, // aload_0
    0xb8, // invokestatic
    (helperRef >>> 8) & 0xff,
    helperRef & 0xff,
  ]);

  const output = new Uint8Array(bytes.byteLength + call.byteLength);
  output.set(bytes.slice(0, insertionOffset), 0);
  output.set(call, insertionOffset);
  output.set(bytes.slice(insertionOffset), insertionOffset + call.byteLength);

  const previousCodeLength = method.codeLength;
  const previousAttributeLength = readU4(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    method.attributeLengthOffset
  );
  writeU4(output, method.codeLengthOffset, previousCodeLength + call.byteLength);
  writeU4(output, method.attributeLengthOffset, previousAttributeLength + call.byteLength);

  const verifiedLayout = parseClassLayout(toArrayBuffer(output));
  const verifiedMethod = verifiedLayout.methods.find(
    (candidate) => candidate.name === 'gf' && candidate.descriptor === '()V'
  );
  if (!verifiedMethod) throw new Error('Không reparse được a/a/H.gf() sau khi gắn hook.');
  const verifiedCode = output.slice(verifiedMethod.codeStart, verifiedMethod.codeEnd);
  const verifiedRef = findHelperMethodRef(verifiedLayout);
  if (verifiedRef === null || verifiedCode[verifiedCode.byteLength - 1] !== 0xb1) {
    throw new Error('Verify Disciple hook trong a/a/H.gf() thất bại.');
  }

  return { bytes: toArrayBuffer(output), hookAdded: true };
}

function cpEntryAt(layout: ClassLayout, index: number, tag: number): CpEntry {
  const entry = layout.constantPool[index];
  if (!entry || entry.tag !== tag) {
    throw new Error(`Disciple helper CP #${index} không đúng tag ${tag}.`);
  }
  return entry;
}

function patchHelperTemplate(values: DiscipleDefaultsValues): ArrayBuffer {
  const bytes = decodeBase64(HELPER_TEMPLATE_BASE64);
  const layout = parseClassLayout(toArrayBuffer(bytes));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const writeInt = (index: number, value: number) => {
    const entry = cpEntryAt(layout, index, 3);
    view.setInt32(entry.payloadOffset, Math.trunc(value), false);
  };
  const writeLong = (index: number, value: number) => {
    const entry = cpEntryAt(layout, index, 5);
    view.setBigInt64(entry.payloadOffset, BigInt(Math.trunc(value)), false);
  };

  writeInt(HELPER_CP_INDEX.type, values.type);
  writeInt(HELPER_CP_INDEX.planet, values.planet);
  writeInt(HELPER_CP_INDEX.status, values.status);
  writeLong(HELPER_CP_INDEX.power, values.power);
  writeLong(HELPER_CP_INDEX.potential, values.potential);
  writeInt(HELPER_CP_INDEX.baseHp, values.baseHp);
  writeInt(HELPER_CP_INDEX.baseKi, values.baseKi);
  writeInt(HELPER_CP_INDEX.baseDamage, values.baseDamage);
  writeInt(HELPER_CP_INDEX.armor, values.armor);
  writeInt(HELPER_CP_INDEX.critical, values.critical);
  writeInt(HELPER_CP_INDEX.hp, values.hp);
  writeInt(HELPER_CP_INDEX.ki, values.ki);
  writeInt(HELPER_CP_INDEX.stamina, values.stamina);
  writeInt(HELPER_CP_INDEX.maxStamina, values.maxStamina);

  for (let index = 0; index < 7; index++) {
    const skill = values.skills[index] ?? { id: -1, level: 0 };
    writeInt(HELPER_CP_INDEX.skillIds[index], skill.id);
    writeInt(HELPER_CP_INDEX.skillLevels[index], skill.level);
  }

  return toArrayBuffer(bytes);
}

export function inspectDiscipleHelperDefaults(
  input: ArrayBuffer
): DiscipleDefaultsValues {
  const layout = parseClassLayout(input);

  const readInt = (index: number): number => {
    const entry = cpEntryAt(layout, index, 3);
    return Number(entry.value ?? 0);
  };
  const readLong = (index: number): number => {
    const entry = cpEntryAt(layout, index, 5);
    return Number(entry.value ?? 0n);
  };

  return {
    type: readInt(HELPER_CP_INDEX.type),
    planet: readInt(HELPER_CP_INDEX.planet),
    status: readInt(HELPER_CP_INDEX.status),
    power: readLong(HELPER_CP_INDEX.power),
    potential: readLong(HELPER_CP_INDEX.potential),
    baseHp: readInt(HELPER_CP_INDEX.baseHp),
    baseKi: readInt(HELPER_CP_INDEX.baseKi),
    baseDamage: readInt(HELPER_CP_INDEX.baseDamage),
    armor: readInt(HELPER_CP_INDEX.armor),
    critical: readInt(HELPER_CP_INDEX.critical),
    hp: readInt(HELPER_CP_INDEX.hp),
    ki: readInt(HELPER_CP_INDEX.ki),
    stamina: readInt(HELPER_CP_INDEX.stamina),
    maxStamina: readInt(HELPER_CP_INDEX.maxStamina),
    skills: Array.from({ length: 7 }, (_, index) => ({
      id: readInt(HELPER_CP_INDEX.skillIds[index]),
      level: readInt(HELPER_CP_INDEX.skillLevels[index]),
    })),
  };
}

export function patchDiscipleDefaultsClass(
  input: ArrayBuffer,
  values: DiscipleDefaultsValues
): DiscipleClassPatchResult {
  const hooked = ensureDiscipleHook(input);
  const helperBytes = patchHelperTemplate(values);
  const verify = inspectDiscipleHelperDefaults(helperBytes);

  if (JSON.stringify(verify) !== JSON.stringify(values)) {
    throw new Error('Verify giá trị Disciple helper sau patch không khớp draft.');
  }

  return {
    classBytes: hooked.bytes,
    helperBytes,
    hookAdded: hooked.hookAdded,
    patchCount: 3 + 2 + 9 + 14 + (hooked.hookAdded ? 1 : 0),
    diagnostics: [
      `a/a/H.gf(): ${hooked.hookAdded ? 'đã gắn' : 'đã có'} hook ${HELPER_CLASS_INTERNAL}.apply(H).`,
      'Disciple helper: type/planet/status + power/potential + combat/runtime + 7 skill slots đã ghi.',
      'Writer chỉ thay default/reset đệ tử; save codec a/a/N không bị sửa.',
    ],
  };
}

export function getDiscipleHelperClassPath(): string {
  return HELPER_CLASS_PATH;
}



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


// ---- Character writer ----
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
    const [snapshot, discipleSnapshot] = await Promise.all([
      analyzeCharacterDefaults(session),
      analyzeDiscipleSchema(session),
    ]);
    const profiles = snapshot.profiles;
    const drafts = profiles.map((profile) =>
      getCharacterDraft(session, profile)
    );
    const discipleDraft = getDiscipleDraft(session, discipleSnapshot);

    const starterDraftCount = profiles.reduce(
      (count, profile, index) =>
        count +
        (isCharacterDraftDirty(profile, drafts[index]) ? 1 : 0),
      0
    );
    const discipleDirty = isDiscipleDraftDirty(session, discipleDraft);
    const appliedDraftCount = starterDraftCount + (discipleDirty ? 1 : 0);

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

    const blockers: CharacterPatchBlocker[] = [];

    if (starterDraftCount > 0) {
      if (!snapshot.verified) {
        blockers.push({
          field: 'H.p(byte)',
          message:
            `Source-backed verification nhân vật chưa đạt: ${snapshot.verificationDetail}`,
        });
      } else {
        blockers.push(
          ...validateWritableChanges(profiles, drafts),
          ...validateRuntimeShape(drafts)
        );
      }
    }

    if (discipleDirty && !discipleSnapshot.verified) {
      blockers.push({
        field: 'H.gf()/Đệ tử',
        message:
          `Source-backed verification Đệ tử chưa đạt: ${discipleSnapshot.verificationDetail}`,
      });
    }

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

    let workingBytes = await entry.async('arraybuffer');
    let appliedPatchCount = 0;
    const diagnostics: string[] = [];
    const rewrittenClasses = new Map<string, ArrayBuffer>();

    if (starterDraftCount > 0) {
      const patched = patchCharacterStarterClass(
        workingBytes,
        toPatchValues(drafts)
      );
      workingBytes = patched.bytes;
      appliedPatchCount += patched.patchCount;
      diagnostics.push(
        `H.p(B): ${patched.patchCount} numeric producer đã đổi.`,
        `H.p(B) code_length delta: ${patched.codeLengthDelta >= 0 ? '+' : ''}${patched.codeLengthDelta}.`,
        ...patched.diagnostics
      );
    }

    if (discipleDirty) {
      const patched = patchDiscipleDefaultsClass(
        workingBytes,
        discipleDraft
      );
      workingBytes = patched.classBytes;
      appliedPatchCount += patched.patchCount;
      diagnostics.push(...patched.diagnostics);
      rewrittenClasses.set(getDiscipleHelperClassPath(), patched.helperBytes);
    }

    rewrittenClasses.set('a/a/H.class', workingBytes);

    return {
      status: 'READY',
      rewrittenClasses,
      appliedDraftCount,
      appliedPatchCount,
      blockers: [],
      diagnostics,
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

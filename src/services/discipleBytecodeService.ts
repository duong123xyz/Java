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

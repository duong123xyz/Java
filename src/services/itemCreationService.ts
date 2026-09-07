import JSZip from 'jszip';
import { CandidateOutputJar, LoadedJarSession } from '../types/jar';

export const ITEM_CREATE_SCHEMA = [
  'id',
  'type',
  'gender',
  'NAME',
  'description',
  'level',
  'icon_id',
  'part',
  'is_up_to_up',
  'power_require',
  'gold',
  'gem',
  'head',
  'body',
  'leg',
] as const;

export interface NewItemRowInput {
  sourceClass: string;
  values: string[];
}

interface CpEntry {
  tag: number;
  utf8?: string;
  nameIndex?: number;
  descriptorIndex?: number;
  classIndex?: number;
  nameAndTypeIndex?: number;
  stringIndex?: number;
}

interface ParsedMethod {
  name: string;
  descriptor: string;
  codeAttributeLengthOffset: number;
  codeAttributeLength: number;
  codeLengthOffset: number;
  codeStart: number;
  codeLength: number;
}

interface ParsedClass {
  cpCount: number;
  cpEnd: number;
  cp: Array<CpEntry | null>;
  utf8: Map<number, string>;
  methods: ParsedMethod[];
}

function readU2(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readI2(bytes: Uint8Array, offset: number): number {
  const value = readU2(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function readU4(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
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

function u2Bytes(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeModifiedUtf8(value: string): Uint8Array {
  const out: number[] = [];

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);

    if (code === 0) {
      out.push(0xc0, 0x80);
    } else if (code <= 0x7f) {
      out.push(code);
    } else if (code <= 0x7ff) {
      out.push(
        0xc0 | ((code >>> 6) & 0x1f),
        0x80 | (code & 0x3f)
      );
    } else {
      out.push(
        0xe0 | ((code >>> 12) & 0x0f),
        0x80 | ((code >>> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  if (out.length > 65535) {
    throw new Error('Một field của item vượt giới hạn CONSTANT_Utf8 65535 bytes.');
  }

  return new Uint8Array(out);
}

function utf8Constant(value: string): Uint8Array {
  const raw = encodeModifiedUtf8(value);
  return new Uint8Array([1, ...u2Bytes(raw.length), ...raw]);
}

function stringConstant(utf8Index: number): Uint8Array {
  return new Uint8Array([8, ...u2Bytes(utf8Index)]);
}

function parseClass(bytes: Uint8Array): ParsedClass {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0xca ||
    bytes[1] !== 0xfe ||
    bytes[2] !== 0xba ||
    bytes[3] !== 0xbe
  ) {
    throw new Error('Class không có magic CAFEBABE.');
  }

  const cpCount = readU2(bytes, 8);
  const cp: Array<CpEntry | null> = new Array(cpCount).fill(null);
  const utf8 = new Map<number, string>();
  let offset = 10;

  for (let index = 1; index < cpCount; index++) {
    const tag = bytes[offset++];

    if (tag === 1) {
      const length = readU2(bytes, offset);
      offset += 2;
      const raw = bytes.slice(offset, offset + length);
      offset += length;
      const decoded = decodeModifiedUtf8(raw);
      cp[index] = { tag, utf8: decoded };
      utf8.set(index, decoded);
    } else if (tag === 3 || tag === 4) {
      cp[index] = { tag };
      offset += 4;
    } else if (tag === 5 || tag === 6) {
      cp[index] = { tag };
      offset += 8;
      index++;
    } else if (tag === 7) {
      cp[index] = { tag, nameIndex: readU2(bytes, offset) };
      offset += 2;
    } else if (tag === 8) {
      cp[index] = { tag, stringIndex: readU2(bytes, offset) };
      offset += 2;
    } else if (tag === 9 || tag === 10 || tag === 11) {
      cp[index] = {
        tag,
        classIndex: readU2(bytes, offset),
        nameAndTypeIndex: readU2(bytes, offset + 2),
      };
      offset += 4;
    } else if (tag === 12) {
      cp[index] = {
        tag,
        nameIndex: readU2(bytes, offset),
        descriptorIndex: readU2(bytes, offset + 2),
      };
      offset += 4;
    } else if (tag === 15) {
      cp[index] = { tag };
      offset += 3;
    } else if (tag === 16 || tag === 19 || tag === 20) {
      cp[index] = { tag };
      offset += 2;
    } else if (tag === 17 || tag === 18) {
      cp[index] = { tag };
      offset += 4;
    } else {
      throw new Error(`Constant Pool tag ${tag} chưa được hỗ trợ.`);
    }
  }

  const cpEnd = offset;

  offset += 6;
  const interfaceCount = readU2(bytes, offset);
  offset += 2 + interfaceCount * 2;

  const fieldCount = readU2(bytes, offset);
  offset += 2;
  for (let i = 0; i < fieldCount; i++) {
    offset += 6;
    const attributeCount = readU2(bytes, offset);
    offset += 2;

    for (let a = 0; a < attributeCount; a++) {
      offset += 2;
      const length = readU4(bytes, offset);
      offset += 4 + length;
    }
  }

  const methodCount = readU2(bytes, offset);
  offset += 2;
  const methods: ParsedMethod[] = [];

  for (let i = 0; i < methodCount; i++) {
    offset += 2;
    const nameIndex = readU2(bytes, offset);
    offset += 2;
    const descriptorIndex = readU2(bytes, offset);
    offset += 2;
    const attributeCount = readU2(bytes, offset);
    offset += 2;

    const methodName = utf8.get(nameIndex) ?? `#${nameIndex}`;
    const descriptor = utf8.get(descriptorIndex) ?? `#${descriptorIndex}`;

    let codeAttributeLengthOffset = -1;
    let codeAttributeLength = 0;
    let codeLengthOffset = -1;
    let codeStart = -1;
    let codeLength = 0;

    for (let a = 0; a < attributeCount; a++) {
      const attributeNameIndex = readU2(bytes, offset);
      offset += 2;
      const attributeLengthOffset = offset;
      const attributeLength = readU4(bytes, offset);
      offset += 4;
      const dataStart = offset;

      if (utf8.get(attributeNameIndex) === 'Code') {
        codeAttributeLengthOffset = attributeLengthOffset;
        codeAttributeLength = attributeLength;
        codeLengthOffset = dataStart + 4;
        codeLength = readU4(bytes, codeLengthOffset);
        codeStart = dataStart + 8;
      }

      offset = dataStart + attributeLength;
    }

    methods.push({
      name: methodName,
      descriptor,
      codeAttributeLengthOffset,
      codeAttributeLength,
      codeLengthOffset,
      codeStart,
      codeLength,
    });
  }

  return {
    cpCount,
    cpEnd,
    cp,
    utf8,
    methods,
  };
}

function decodeModifiedUtf8(raw: Uint8Array): string {
  let result = '';

  for (let i = 0; i < raw.length; ) {
    const a = raw[i++];

    if ((a & 0x80) === 0) {
      result += String.fromCharCode(a);
    } else if ((a & 0xe0) === 0xc0) {
      if (i >= raw.length) throw new Error('MUTF-8 2-byte bị cắt.');
      const b = raw[i++];
      result += String.fromCharCode(((a & 0x1f) << 6) | (b & 0x3f));
    } else if ((a & 0xf0) === 0xe0) {
      if (i + 1 >= raw.length) throw new Error('MUTF-8 3-byte bị cắt.');
      const b = raw[i++];
      const c = raw[i++];
      result += String.fromCharCode(
        ((a & 0x0f) << 12) |
          ((b & 0x3f) << 6) |
          (c & 0x3f)
      );
    } else {
      throw new Error('MUTF-8 có byte sequence không hợp lệ.');
    }
  }

  return result;
}

function resolveClassIndex(parsed: ParsedClass, internalName: string): number {
  for (let index = 1; index < parsed.cp.length; index++) {
    const entry = parsed.cp[index];
    if (
      entry?.tag === 7 &&
      entry.nameIndex &&
      parsed.utf8.get(entry.nameIndex) === internalName
    ) {
      return index;
    }
  }
  throw new Error(`Không tìm thấy CONSTANT_Class ${internalName}.`);
}

function resolveFieldRefIndex(
  parsed: ParsedClass,
  fieldName: string,
  descriptor: string
): number {
  for (let index = 1; index < parsed.cp.length; index++) {
    const entry = parsed.cp[index];
    if (
      !entry ||
      entry.tag !== 9 ||
      !entry.nameAndTypeIndex
    ) {
      continue;
    }

    const nt = parsed.cp[entry.nameAndTypeIndex];
    if (
      nt?.tag === 12 &&
      nt.nameIndex &&
      nt.descriptorIndex &&
      parsed.utf8.get(nt.nameIndex) === fieldName &&
      parsed.utf8.get(nt.descriptorIndex) === descriptor
    ) {
      return index;
    }
  }

  throw new Error(`Không resolve được Fieldref ${fieldName}:${descriptor}.`);
}

function readOuterArrayLength(
  bytes: Uint8Array,
  codeStart: number
): { value: number; operandOffset: number; width: 1 | 2 } {
  const opcode = bytes[codeStart];

  if (opcode === 0x10) {
    const raw = bytes[codeStart + 1];
    const value = raw >= 128 ? raw - 256 : raw;
    return {
      value,
      operandOffset: codeStart + 1,
      width: 1,
    };
  }

  if (opcode === 0x11) {
    return {
      value: readI2(bytes, codeStart + 1),
      operandOffset: codeStart + 1,
      width: 2,
    };
  }

  throw new Error(
    `Bảng item không bắt đầu bằng bipush/sipush array length (opcode 0x${opcode.toString(16)}).`
  );
}

function writeOuterArrayLength(
  bytes: Uint8Array,
  target: ReturnType<typeof readOuterArrayLength>,
  nextValue: number
): void {
  if (target.width === 1) {
    if (nextValue < -128 || nextValue > 127) {
      throw new Error(
        `Array length ${nextValue} không còn vừa bipush; writer phase này không đổi độ dài opcode.`
      );
    }
    bytes[target.operandOffset] = nextValue & 0xff;
    return;
  }

  if (nextValue < -32768 || nextValue > 32767) {
    throw new Error(`Array length ${nextValue} vượt sipush.`);
  }
  writeU2(bytes, target.operandOffset, nextValue & 0xffff);
}

function pushInteger(value: number): Uint8Array {
  if (value >= -1 && value <= 5) {
    return new Uint8Array([value === -1 ? 0x02 : 0x03 + value]);
  }

  if (value >= -128 && value <= 127) {
    return new Uint8Array([0x10, value & 0xff]);
  }

  if (value >= -32768 && value <= 32767) {
    return new Uint8Array([
      0x11,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  throw new Error(`Không push được integer ${value} trong writer item hiện tại.`);
}

function appendStringConstants(
  original: Uint8Array,
  parsed: ParsedClass,
  values: string[]
): {
  bytes: Uint8Array;
  stringIndexes: number[];
} {
  const unique = new Map<string, number>();
  const parts: Uint8Array[] = [];
  let nextIndex = parsed.cpCount;

  for (const value of values) {
    if (unique.has(value)) continue;

    const utf8Index = nextIndex++;
    const stringIndex = nextIndex++;

    parts.push(utf8Constant(value));
    parts.push(stringConstant(utf8Index));
    unique.set(value, stringIndex);
  }

  if (nextIndex > 65535) {
    throw new Error('Constant Pool không còn đủ chỗ để thêm item.');
  }

  const appended = concatBytes(parts);
  const prefix = original.slice(0, 8);
  const newCpCount = new Uint8Array(2);
  writeU2(newCpCount, 0, nextIndex);

  return {
    bytes: concatBytes([
      prefix,
      newCpCount,
      original.slice(10, parsed.cpEnd),
      appended,
      original.slice(parsed.cpEnd),
    ]),
    stringIndexes: values.map((value) => unique.get(value)!),
  };
}

function buildRowBytecode(
  rowIndex: number,
  stringClassIndex: number,
  stringIndexes: number[]
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Outer String[][] vẫn đang nằm trên operand stack trước putstatic.
  parts.push(new Uint8Array([0x59])); // dup
  parts.push(pushInteger(rowIndex));
  parts.push(pushInteger(stringIndexes.length));
  parts.push(
    new Uint8Array([
      0xbd,
      (stringClassIndex >>> 8) & 0xff,
      stringClassIndex & 0xff,
    ])
  );

  stringIndexes.forEach((stringIndex, columnIndex) => {
    parts.push(new Uint8Array([0x59])); // dup inner row
    parts.push(pushInteger(columnIndex));
    parts.push(
      new Uint8Array([
        0x13, // ldc_w
        (stringIndex >>> 8) & 0xff,
        stringIndex & 0xff,
      ])
    );
    parts.push(new Uint8Array([0x53])); // aastore
  });

  parts.push(new Uint8Array([0x53])); // aastore outer[row] = inner
  return concatBytes(parts);
}

function findPutstaticOffset(
  bytes: Uint8Array,
  method: ParsedMethod,
  fieldRefIndex: number
): number {
  const hi = (fieldRefIndex >>> 8) & 0xff;
  const lo = fieldRefIndex & 0xff;
  const end = method.codeStart + method.codeLength;
  const matches: number[] = [];

  for (let offset = method.codeStart; offset + 2 < end; offset++) {
    if (
      bytes[offset] === 0xb3 &&
      bytes[offset + 1] === hi &&
      bytes[offset + 2] === lo
    ) {
      matches.push(offset);
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `Cần đúng 1 putstatic u trong <clinit>, nhận ${matches.length}.`
    );
  }

  return matches[0];
}

export function appendItemRowToClass(
  originalBuffer: ArrayBuffer,
  values: string[]
): {
  bytes: ArrayBuffer;
  originalRowCount: number;
  newRowCount: number;
  insertedBytes: number;
} {
  if (values.length !== ITEM_CREATE_SCHEMA.length) {
    throw new Error(
      `Item mới cần đúng ${ITEM_CREATE_SCHEMA.length} cột, nhận ${values.length}.`
    );
  }

  const original = new Uint8Array(originalBuffer);
  const parsedOriginal = parseClass(original);

  const appendedConstants = appendStringConstants(
    original,
    parsedOriginal,
    values.map((value) => String(value ?? ''))
  );

  const withConstants = appendedConstants.bytes;
  const parsed = parseClass(withConstants);
  const clinit = parsed.methods.find(
    (method) => method.name === '<clinit>' && method.descriptor === '()V'
  );

  if (
    !clinit ||
    clinit.codeStart < 0 ||
    clinit.codeLengthOffset < 0 ||
    clinit.codeAttributeLengthOffset < 0
  ) {
    throw new Error('Không tìm thấy Code của <clinit>.');
  }

  const arrayLength = readOuterArrayLength(withConstants, clinit.codeStart);
  if (arrayLength.value <= 0) {
    throw new Error(`Array length hiện tại không hợp lệ: ${arrayLength.value}.`);
  }

  const stringClassIndex = resolveClassIndex(parsed, 'java/lang/String');
  const fieldRefIndex = resolveFieldRefIndex(
    parsed,
    'u',
    '[[Ljava/lang/String;'
  );
  const putstaticOffset = findPutstaticOffset(
    withConstants,
    clinit,
    fieldRefIndex
  );

  const rowCode = buildRowBytecode(
    arrayLength.value,
    stringClassIndex,
    appendedConstants.stringIndexes
  );

  const patched = concatBytes([
    withConstants.slice(0, putstaticOffset),
    rowCode,
    withConstants.slice(putstaticOffset),
  ]);

  // Header/Code offsets nằm trước insertion nên giữ nguyên.
  writeOuterArrayLength(
    patched,
    arrayLength,
    arrayLength.value + 1
  );
  writeU4(
    patched,
    clinit.codeLengthOffset,
    clinit.codeLength + rowCode.length
  );
  writeU4(
    patched,
    clinit.codeAttributeLengthOffset,
    clinit.codeAttributeLength + rowCode.length
  );

  // Verify lại class và array length.
  const verified = parseClass(patched);
  const verifiedClinit = verified.methods.find(
    (method) => method.name === '<clinit>' && method.descriptor === '()V'
  );
  if (!verifiedClinit || verifiedClinit.codeStart < 0) {
    throw new Error('Verify <clinit> sau patch thất bại.');
  }
  const verifiedLength = readOuterArrayLength(
    patched,
    verifiedClinit.codeStart
  );

  if (verifiedLength.value !== arrayLength.value + 1) {
    throw new Error(
      `Verify row count thất bại: ${verifiedLength.value} != ${arrayLength.value + 1}.`
    );
  }

  return {
    bytes: patched.buffer.slice(
      patched.byteOffset,
      patched.byteOffset + patched.byteLength
    ),
    originalRowCount: arrayLength.value,
    newRowCount: verifiedLength.value,
    insertedBytes: rowCode.length,
  };
}

function normalizeSourceClass(sourceClass: string): string {
  return sourceClass
    .trim()
    .replace(/\.class$/i, '')
    .replace(/\./g, '/');
}

function validateNewItemInput(input: NewItemRowInput): NewItemRowInput {
  const sourceClass = normalizeSourceClass(input.sourceClass);
  const values = input.values.map((value) => String(value ?? ''));

  if (!/^a\/a\/a\/[i-u]$/.test(sourceClass)) {
    throw new Error(
      `Nguồn item '${sourceClass}' không nằm trong 13 bảng a/a/a/i..u.`
    );
  }

  if (values.length !== ITEM_CREATE_SCHEMA.length) {
    throw new Error(
      `Item mới cần đúng ${ITEM_CREATE_SCHEMA.length} field.`
    );
  }

  const id = Number(values[0]);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error('Item ID phải là số nguyên không âm.');
  }

  return {
    sourceClass,
    values,
  };
}

function outputFileName(name: string): string {
  const safe = name || 'game.jar';
  return safe.toLowerCase().endsWith('.jar')
    ? `${safe.slice(0, -4)}_new_item.jar`
    : `${safe}_new_item.jar`;
}

export async function buildNewItemCandidate(
  session: LoadedJarSession,
  rawInput: NewItemRowInput,
  baseBlob?: Blob
): Promise<CandidateOutputJar> {
  const input = validateNewItemInput(rawInput);

  const existingIds = new Set(
    session.itemAnalysis?.items.map((item) => item.id) ?? []
  );
  if (existingIds.has(input.values[0])) {
    throw new Error(
      `Item ID ${input.values[0]} đã tồn tại trong JAR. Hãy chọn ID khác.`
    );
  }

  const baseBytes = baseBlob
    ? await baseBlob.arrayBuffer()
    : await session.originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(baseBytes.slice(0));
  const classPath = `${input.sourceClass}.class`;
  const entry = zip.file(classPath);

  if (!entry) {
    throw new Error(`Không tìm thấy ${classPath} trong JAR.`);
  }

  const originalClass = await entry.async('arraybuffer');
  const patched = appendItemRowToClass(originalClass, input.values);

  zip.file(classPath, new Uint8Array(patched.bytes));

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const reopened = await JSZip.loadAsync(await blob.arrayBuffer());
  const verifyEntry = reopened.file(classPath);
  if (!verifyEntry) {
    throw new Error(`JAR sau build bị thiếu ${classPath}.`);
  }

  const verifyClass = await verifyEntry.async('arraybuffer');
  const verifyParsed = parseClass(new Uint8Array(verifyClass));
  const clinit = verifyParsed.methods.find(
    (method) => method.name === '<clinit>' && method.descriptor === '()V'
  );

  if (!clinit || clinit.codeStart < 0) {
    throw new Error('Không verify được <clinit> sau khi đóng JAR.');
  }

  const rowCount = readOuterArrayLength(
    new Uint8Array(verifyClass),
    clinit.codeStart
  ).value;

  if (rowCount !== patched.newRowCount) {
    throw new Error(
      `JAR verify row count sai: ${rowCount} != ${patched.newRowCount}.`
    );
  }

  return {
    blob,
    fileName: outputFileName(session.jarInfo.fileName),
    status: 'VALIDATED',
    validatedAt: Date.now(),
    expectedModifiedCount: 1,
    metrics: {
      source: 'ITEM_CREATION',
      newItem: {
        sourceClass: input.sourceClass,
        id: input.values[0],
        name: input.values[3],
        originalRowCount: patched.originalRowCount,
        newRowCount: patched.newRowCount,
      },
    },
  };
}

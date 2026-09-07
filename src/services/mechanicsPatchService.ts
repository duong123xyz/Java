import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import {
  analyzeGameMechanics,
  GameMechanicsDraft,
  getGameMechanicsDraft,
  getGameMechanicsDirtyCount,
} from './gameMechanicsService';
import { getSessionClassInfo, normalizeClassEntryPath } from './patchPlannerService';
import { parseClassFile } from './classFileParser';

export interface MechanicsPatchBlocker {
  field: string;
  message: string;
}

export interface MechanicsPatchResult {
  status: 'NO_CHANGES' | 'READY' | 'BLOCKED' | 'FAILED';
  rewrittenClasses: Map<string, ArrayBuffer>;
  appliedDraftCount: number;
  appliedPatchCount: number;
  unsupportedDraftCount: number;
  blockers: MechanicsPatchBlocker[];
  diagnostics: string[];
  errorMessage?: string;
}

interface CpLayoutEntry {
  index: number;
  tag: number;
  tagOffset: number;
  payloadOffset: number;
  value?: number | bigint | string;
}

interface MethodLayout {
  name: string;
  descriptor: string;
  attributeStart: number;
  attributeLengthOffset: number;
  attributeLength: number;
  maxStackOffset: number;
  maxLocalsOffset: number;
  codeLengthOffset: number;
  codeStart: number;
  codeLength: number;
  codeEnd: number;
  exceptionTableLength: number;
  nestedAttributeCount: number;
}

interface ClassLayout {
  constantPool: Array<CpLayoutEntry | null>;
  utf8: Map<number, string>;
  methods: MethodLayout[];
}

interface MutableClass {
  path: string;
  bytes: Uint8Array;
  layout: ClassLayout;
  classInfo: ClassFileInfo | null;
}

const TAG_UTF8 = 1;
const TAG_INTEGER = 3;
const TAG_FLOAT = 4;
const TAG_LONG = 5;
const TAG_DOUBLE = 6;
const TAG_CLASS = 7;
const TAG_STRING = 8;
const TAG_FIELDREF = 9;
const TAG_METHODREF = 10;
const TAG_INTERFACE_METHODREF = 11;
const TAG_NAME_AND_TYPE = 12;
const TAG_METHOD_HANDLE = 15;
const TAG_METHOD_TYPE = 16;
const TAG_DYNAMIC = 17;
const TAG_INVOKE_DYNAMIC = 18;
const TAG_MODULE = 19;
const TAG_PACKAGE = 20;

function readU2(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readU4(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function writeU2(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, false);
}

function writeU4(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return Array.from(bytes)
      .map((value) => String.fromCharCode(value))
      .join('');
  }
}

function skipAttributes(view: DataView, offset: number, count: number): number {
  let cursor = offset;
  for (let index = 0; index < count; index++) {
    cursor += 2; // attribute_name_index
    const length = readU4(view, cursor);
    cursor += 4 + length;
  }
  return cursor;
}

function parseRawClassLayout(buffer: ArrayBuffer): ClassLayout {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (view.getUint32(0, false) !== 0xcafebabe) {
    throw new Error('Class không có magic CAFEBABE.');
  }

  const cpCount = readU2(view, 8);
  const constantPool: Array<CpLayoutEntry | null> = new Array(cpCount).fill(null);
  const utf8 = new Map<number, string>();

  let cursor = 10;

  for (let index = 1; index < cpCount; index++) {
    const tagOffset = cursor;
    const tag = view.getUint8(cursor++);
    const payloadOffset = cursor;

    switch (tag) {
      case TAG_UTF8: {
        const length = readU2(view, cursor);
        cursor += 2;
        const raw = bytes.slice(cursor, cursor + length);
        const value = decodeUtf8(raw);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        utf8.set(index, value);
        cursor += length;
        break;
      }
      case TAG_INTEGER: {
        const value = view.getInt32(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 4;
        break;
      }
      case TAG_FLOAT: {
        const value = view.getFloat32(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 4;
        break;
      }
      case TAG_LONG: {
        const value = view.getBigInt64(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 8;
        index++;
        if (index < cpCount) constantPool[index] = null;
        break;
      }
      case TAG_DOUBLE: {
        const value = view.getFloat64(cursor, false);
        constantPool[index] = { index, tag, tagOffset, payloadOffset, value };
        cursor += 8;
        index++;
        if (index < cpCount) constantPool[index] = null;
        break;
      }
      case TAG_CLASS:
      case TAG_STRING:
      case TAG_METHOD_TYPE:
      case TAG_MODULE:
      case TAG_PACKAGE:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 2;
        break;
      case TAG_FIELDREF:
      case TAG_METHODREF:
      case TAG_INTERFACE_METHODREF:
      case TAG_NAME_AND_TYPE:
      case TAG_DYNAMIC:
      case TAG_INVOKE_DYNAMIC:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 4;
        break;
      case TAG_METHOD_HANDLE:
        constantPool[index] = { index, tag, tagOffset, payloadOffset };
        cursor += 3;
        break;
      default:
        throw new Error(`Constant Pool tag ${tag} chưa hỗ trợ tại offset ${tagOffset}.`);
    }
  }

  // class header
  cursor += 2 + 2 + 2;

  const interfacesCount = readU2(view, cursor);
  cursor += 2 + interfacesCount * 2;

  const fieldsCount = readU2(view, cursor);
  cursor += 2;
  for (let index = 0; index < fieldsCount; index++) {
    cursor += 2 + 2 + 2;
    const attributesCount = readU2(view, cursor);
    cursor += 2;
    cursor = skipAttributes(view, cursor, attributesCount);
  }

  const methodsCount = readU2(view, cursor);
  cursor += 2;
  const methods: MethodLayout[] = [];

  for (let index = 0; index < methodsCount; index++) {
    cursor += 2; // access_flags
    const nameIndex = readU2(view, cursor);
    cursor += 2;
    const descriptorIndex = readU2(view, cursor);
    cursor += 2;
    const attributesCount = readU2(view, cursor);
    cursor += 2;

    const name = utf8.get(nameIndex) ?? '';
    const descriptor = utf8.get(descriptorIndex) ?? '';

    for (let attrIndex = 0; attrIndex < attributesCount; attrIndex++) {
      const attributeStart = cursor;
      const attributeNameIndex = readU2(view, cursor);
      cursor += 2;
      const attributeLengthOffset = cursor;
      const attributeLength = readU4(view, cursor);
      cursor += 4;
      const dataStart = cursor;
      const attributeName = utf8.get(attributeNameIndex) ?? '';

      if (attributeName === 'Code') {
        const maxStackOffset = dataStart;
        const maxLocalsOffset = dataStart + 2;
        const codeLengthOffset = dataStart + 4;
        const codeLength = readU4(view, codeLengthOffset);
        const codeStart = dataStart + 8;
        const codeEnd = codeStart + codeLength;
        let codeCursor = codeEnd;
        const exceptionTableLength = readU2(view, codeCursor);
        codeCursor += 2 + exceptionTableLength * 8;
        const nestedAttributeCount = readU2(view, codeCursor);

        methods.push({
          name,
          descriptor,
          attributeStart,
          attributeLengthOffset,
          attributeLength,
          maxStackOffset,
          maxLocalsOffset,
          codeLengthOffset,
          codeStart,
          codeLength,
          codeEnd,
          exceptionTableLength,
          nestedAttributeCount,
        });
      }

      cursor = dataStart + attributeLength;
    }
  }

  return { constantPool, utf8, methods };
}

function methodKey(name: string, descriptor: string): string {
  return `${name}${descriptor}`;
}

function findMethod(
  layout: ClassLayout,
  name: string,
  descriptor: string
): MethodLayout {
  const method = layout.methods.find(
    (candidate) =>
      candidate.name === name && candidate.descriptor === descriptor
  );
  if (!method) {
    throw new Error(`Không tìm thấy method ${methodKey(name, descriptor)}.`);
  }
  return method;
}

function codeBytes(target: MutableClass, method: MethodLayout): Uint8Array {
  return target.bytes.slice(method.codeStart, method.codeEnd);
}

function signedByte(value: number): number {
  return value & 0xff;
}

function signedShortBytes(value: number): [number, number] {
  const normalized = value & 0xffff;
  return [(normalized >> 8) & 0xff, normalized & 0xff];
}

function shortestPush(value: number): number[] | null {
  if (!Number.isInteger(value)) return null;
  if (value === -1) return [0x02];
  if (value >= 0 && value <= 5) return [0x03 + value];
  if (value >= -128 && value <= 127) return [0x10, signedByte(value)];
  if (value >= -32768 && value <= 32767) {
    const [hi, lo] = signedShortBytes(value);
    return [0x11, hi, lo];
  }
  return null;
}

function decodeImmediatePush(code: Uint8Array, offset: number): {
  value: number;
  length: number;
} | null {
  const opcode = code[offset];
  if (opcode === 0x02) return { value: -1, length: 1 };
  if (opcode >= 0x03 && opcode <= 0x08) {
    return { value: opcode - 0x03, length: 1 };
  }
  if (opcode === 0x10) {
    const raw = code[offset + 1];
    return { value: raw >= 0x80 ? raw - 0x100 : raw, length: 2 };
  }
  if (opcode === 0x11) {
    const raw = (code[offset + 1] << 8) | code[offset + 2];
    return { value: raw >= 0x8000 ? raw - 0x10000 : raw, length: 3 };
  }
  return null;
}

function exactPushForLength(value: number, length: number): number[] | null {
  if (!Number.isInteger(value)) return null;
  if (length === 1) {
    if (value === -1) return [0x02];
    if (value >= 0 && value <= 5) return [0x03 + value];
    return null;
  }
  if (length === 2 && value >= -128 && value <= 127) {
    return [0x10, signedByte(value)];
  }
  if (length === 3 && value >= -32768 && value <= 32767) {
    const [hi, lo] = signedShortBytes(value);
    return [0x11, hi, lo];
  }
  return null;
}

function patchSameLengthPush(
  target: MutableClass,
  method: MethodLayout,
  relativeOffset: number,
  expectedValue: number,
  nextValue: number
): void {
  const code = codeBytes(target, method);
  const current = decodeImmediatePush(code, relativeOffset);
  if (!current || current.value !== expectedValue) {
    throw new Error(
      `${method.name}${method.descriptor} @${relativeOffset}: expected push ${expectedValue}.`
    );
  }

  const replacement = exactPushForLength(nextValue, current.length);
  if (!replacement) {
    throw new Error(
      `${method.name}${method.descriptor} @${relativeOffset}: ${nextValue} không vừa opcode ${current.length} byte.`
    );
  }

  target.bytes.set(replacement, method.codeStart + relativeOffset);
}

function readCpIndexFromLoad(
  target: MutableClass,
  method: MethodLayout,
  relativeOffset: number
): number {
  const code = codeBytes(target, method);
  const opcode = code[relativeOffset];
  if (opcode === 0x12) return code[relativeOffset + 1];
  if (opcode === 0x13 || opcode === 0x14) {
    return (code[relativeOffset + 1] << 8) | code[relativeOffset + 2];
  }
  throw new Error(
    `${method.name}${method.descriptor} @${relativeOffset}: không phải ldc/ldc_w/ldc2_w.`
  );
}

function patchCpNumeric(
  target: MutableClass,
  cpIndex: number,
  nextValue: number | bigint,
  expectedTag?: number
): void {
  const entry = target.layout.constantPool[cpIndex];
  if (!entry) throw new Error(`Constant Pool #${cpIndex} không tồn tại.`);
  if (expectedTag !== undefined && entry.tag !== expectedTag) {
    throw new Error(
      `Constant Pool #${cpIndex} tag ${entry.tag}, expected ${expectedTag}.`
    );
  }

  const view = new DataView(
    target.bytes.buffer,
    target.bytes.byteOffset,
    target.bytes.byteLength
  );

  switch (entry.tag) {
    case TAG_INTEGER:
      view.setInt32(entry.payloadOffset, Number(nextValue), false);
      entry.value = Number(nextValue);
      return;
    case TAG_FLOAT:
      view.setFloat32(entry.payloadOffset, Number(nextValue), false);
      entry.value = Number(nextValue);
      return;
    case TAG_LONG: {
      const value =
        typeof nextValue === 'bigint'
          ? nextValue
          : BigInt(Math.trunc(Number(nextValue)));
      view.setBigInt64(entry.payloadOffset, value, false);
      entry.value = value;
      return;
    }
    case TAG_DOUBLE:
      view.setFloat64(entry.payloadOffset, Number(nextValue), false);
      entry.value = Number(nextValue);
      return;
    default:
      throw new Error(`Constant Pool #${cpIndex} không phải numeric.`);
  }
}

function cpValueEquals(
  value: number | bigint | string | undefined,
  target: number
): boolean {
  if (typeof value === 'bigint') return value === BigInt(Math.trunc(target));
  if (typeof value !== 'number') return false;
  const scale = Math.max(1, Math.abs(value), Math.abs(target));
  return Math.abs(value - target) <= Number.EPSILON * scale * 64;
}

function findCpNumericIndices(
  target: MutableClass,
  tag: number,
  expectedValue: number
): number[] {
  const result: number[] = [];
  for (const entry of target.layout.constantPool) {
    if (
      entry &&
      entry.tag === tag &&
      cpValueEquals(entry.value, expectedValue)
    ) {
      result.push(entry.index);
    }
  }
  return result;
}

function fraction(value: number, maxDenominator = 1000): {
  numerator: number;
  denominator: number;
} {
  let bestNumerator = Math.round(value);
  let bestDenominator = 1;
  let bestError = Math.abs(value - bestNumerator);

  for (let denominator = 1; denominator <= maxDenominator; denominator++) {
    const numerator = Math.round(value * denominator);
    const error = Math.abs(value - numerator / denominator);
    if (error < bestError - 1e-12) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
      if (error < 1e-12) break;
    }
  }

  const gcd = (a: number, b: number): number => {
    let x = Math.abs(Math.trunc(a));
    let y = Math.abs(Math.trunc(b));
    while (y) {
      const next = x % y;
      x = y;
      y = next;
    }
    return Math.max(1, x);
  };

  const divisor = gcd(bestNumerator, bestDenominator);
  return {
    numerator: Math.trunc(bestNumerator / divisor),
    denominator: Math.trunc(bestDenominator / divisor),
  };
}

function findProbabilityPair(
  chancePercent: number,
  rangePushLength: number,
  thresholdPushLength: number,
  maxRange = 32767
): {
  range: number;
  threshold: number;
  actualChancePercent: number;
  error: number;
} | null {
  if (chancePercent <= 0) {
    for (let range = 1; range <= maxRange; range++) {
      const rangePush = exactPushForLength(range, rangePushLength);
      const thresholdPush = exactPushForLength(0, thresholdPushLength);
      if (rangePush && thresholdPush) {
        return { range, threshold: 0, actualChancePercent: 0, error: 0 };
      }
    }
  }

  let best:
    | {
        range: number;
        threshold: number;
        actualChancePercent: number;
        error: number;
      }
    | null = null;

  const wanted = Math.max(0, Math.min(100, chancePercent));

  for (let range = 1; range <= maxRange; range++) {
    const rangePush = exactPushForLength(range, rangePushLength);
    if (!rangePush) continue;

    const threshold = Math.max(
      0,
      Math.min(range, Math.round((wanted / 100) * range))
    );
    const thresholdPush = exactPushForLength(
      threshold,
      thresholdPushLength
    );
    if (!thresholdPush) continue;

    const actual = (threshold / range) * 100;
    const error = Math.abs(actual - wanted);

    if (
      !best ||
      error < best.error - 1e-9 ||
      (Math.abs(error - best.error) < 1e-9 && range > best.range)
    ) {
      best = {
        range,
        threshold,
        actualChancePercent: actual,
        error,
      };
      if (error < 0.0005) break;
    }
  }

  return best;
}

function patchRngCompare(
  target: MutableClass,
  method: MethodLayout,
  rangeOffset: number,
  thresholdOffset: number,
  branchOffset: number,
  expectedRange: number,
  expectedThreshold: number,
  chancePercent: number
): number {
  const code = codeBytes(target, method);
  const rangePush = decodeImmediatePush(code, rangeOffset);
  const thresholdPush = decodeImmediatePush(code, thresholdOffset);

  if (
    !rangePush ||
    !thresholdPush ||
    rangePush.value !== expectedRange ||
    thresholdPush.value !== expectedThreshold
  ) {
    throw new Error(
      `${method.name}${method.descriptor}: RNG pattern @${rangeOffset}/${thresholdOffset} không khớp.`
    );
  }

  const callOffset = rangeOffset + rangePush.length;
  if (code[callOffset] !== 0xb8) {
    throw new Error(
      `${method.name}${method.descriptor} @${callOffset}: expected invokestatic RNG.`
    );
  }

  if (code[branchOffset] !== 0xa2) {
    throw new Error(
      `${method.name}${method.descriptor} @${branchOffset}: expected if_icmpge.`
    );
  }

  const expectedThresholdOffset = callOffset + 3;
  if (expectedThresholdOffset !== thresholdOffset) {
    throw new Error('RNG threshold không nằm ngay sau invokestatic.');
  }

  const expectedBranchOffset = thresholdOffset + thresholdPush.length;
  if (expectedBranchOffset !== branchOffset) {
    throw new Error('RNG branch không nằm ngay sau threshold.');
  }

  const requiredPushBytes = rangePush.length + thresholdPush.length;
  const maxRange =
    rangePush.length === 1 ? 5 :
    rangePush.length === 2 ? 127 :
    32767;

  const pair = findProbabilityPair(
    chancePercent,
    rangePush.length,
    thresholdPush.length,
    maxRange
  );

  if (!pair) {
    throw new Error(
      `Không biểu diễn được ${chancePercent}% với opcode gốc ` +
      `(range ${rangePush.length} byte + threshold ${thresholdPush.length} byte).`
    );
  }

  // Bytecode gốc chỉ dành đúng số byte cho hai số nguyên range/threshold.
  // Một số phần trăm (ví dụ 0.5% khi range tối đa là 127) không thể biểu diễn
  // tuyệt đối chính xác nếu không làm thay đổi độ dài method và toàn bộ branch.
  // Dùng cặp gần nhất để writer vẫn tạo được JAR; giá trị thực tế luôn được ghi
  // vào diagnostics để UI có thể thông báo thay vì chặn toàn bộ workspace.

  const newRangePush = exactPushForLength(
    pair.range,
    rangePush.length
  )!;
  const newThresholdPush = exactPushForLength(
    pair.threshold,
    thresholdPush.length
  )!;
  const originalCall = code.slice(callOffset, callOffset + 3);
  const originalBranch = code.slice(branchOffset, branchOffset + 3);

  const replacement = new Uint8Array(
    newRangePush.length +
      originalCall.length +
      newThresholdPush.length +
      originalBranch.length
  );
  let cursor = 0;
  replacement.set(newRangePush, cursor);
  cursor += newRangePush.length;
  replacement.set(originalCall, cursor);
  cursor += originalCall.length;
  replacement.set(newThresholdPush, cursor);
  cursor += newThresholdPush.length;
  replacement.set(originalBranch, cursor);

  const originalLength =
    rangePush.length + 3 + thresholdPush.length + 3;
  if (replacement.length !== originalLength) {
    throw new Error('RNG rewrite làm thay đổi bytecode length.');
  }

  target.bytes.set(replacement, method.codeStart + rangeOffset);
  return pair.actualChancePercent;
}

function findMethodRefCpIndex(
  classInfo: ClassFileInfo | null,
  owner: string,
  name: string
): number | null {
  if (!classInfo) return null;
  for (const method of classInfo.methods) {
    for (const instruction of method.code?.instructions ?? []) {
      if (
        instruction.methodRef?.owner === owner &&
        instruction.methodRef?.name === name &&
        typeof instruction.cpIndex === 'number'
      ) {
        return instruction.cpIndex;
      }
    }
  }
  return null;
}

function patchSpecialDragonChance(
  target: MutableClass,
  method: MethodLayout,
  chancePercent: number
): number {
  const code = codeBytes(target, method);
  for (let offset = 35; offset <= 56; offset++) {
    if (code[offset] !== 0x00) {
      throw new Error(`customDrop @${offset}: expected NOP room.`);
    }
  }

  const rngCp = findMethodRefCpIndex(target.classInfo, 'a/a/h', 'w');
  if (!rngCp) throw new Error('Không resolve được Methodref a/a/h.w(I)I.');

  let best:
    | {
        range: number;
        threshold: number;
        actualChancePercent: number;
        error: number;
      }
    | null = null;

  for (let range = 1; range <= 32767; range++) {
    const threshold = Math.max(
      0,
      Math.min(range, Math.round((chancePercent / 100) * range))
    );
    const rangePush = shortestPush(range);
    const thresholdPush = shortestPush(threshold);
    if (!rangePush || !thresholdPush) continue;

    const length = rangePush.length + 3 + thresholdPush.length + 3;
    if (length > 22) continue;

    const actual = (threshold / range) * 100;
    const error = Math.abs(actual - chancePercent);
    if (!best || error < best.error - 1e-9) {
      best = { range, threshold, actualChancePercent: actual, error };
      if (error < 0.0005) break;
    }
  }

  if (!best) throw new Error('Không dựng được RNG cho mob type -239.');

  const replacement = new Uint8Array(22).fill(0x00);
  const rangePush = shortestPush(best.range)!;
  const thresholdPush = shortestPush(best.threshold)!;
  let cursor = 0;
  replacement.set(rangePush, cursor);
  cursor += rangePush.length;
  replacement[cursor++] = 0xb8;
  replacement[cursor++] = (rngCp >> 8) & 0xff;
  replacement[cursor++] = rngCp & 0xff;
  replacement.set(thresholdPush, cursor);
  cursor += thresholdPush.length;
  replacement[cursor++] = 0xa2; // if_icmpge -> skip whole -239 branch
  const branchOpcodeOffset = 35 + cursor - 1;
  const displacement = 132 - branchOpcodeOffset;
  replacement[cursor++] = (displacement >> 8) & 0xff;
  replacement[cursor++] = displacement & 0xff;

  target.bytes.set(replacement, method.codeStart + 35);
  return best.actualChancePercent;
}

function patchGemChance(
  target: MutableClass,
  method: MethodLayout,
  chancePercent: number
): number {
  const code = codeBytes(target, method);
  if (
    code[410] !== 0x13 ||
    code[413] !== 0xb8 ||
    code[416] !== 0x00 ||
    code[417] !== 0x00 ||
    code[418] !== 0x00
  ) {
    throw new Error('Gem RNG pattern @410..418 không khớp JAR đã xác minh.');
  }

  if (chancePercent <= 0) {
    const displacement = 434 - 416;
    target.bytes.set(
      [0xa7, (displacement >> 8) & 0xff, displacement & 0xff],
      method.codeStart + 416
    );
    return 0;
  }

  const wantedRange = Math.max(1, Math.round(100 / chancePercent));
  const actualChance = 100 / wantedRange;
  const error = Math.abs(actualChance - chancePercent);
  const tolerance = Math.max(0.005, Math.min(0.1, chancePercent * 0.015));
  if (error > tolerance) {
    throw new Error(
      `Ngọc ${chancePercent}% cần threshold branch mới; dạng 1/N gần nhất là ${actualChance.toFixed(4)}%.`
    );
  }

  const cpIndex = readCpIndexFromLoad(target, method, 410);
  const cpEntry = target.layout.constantPool[cpIndex];
  if (
    !cpEntry ||
    cpEntry.tag !== TAG_INTEGER ||
    !cpValueEquals(cpEntry.value, 1_000_000)
  ) {
    throw new Error('Gem RNG Constant Pool 1.000.000 không còn đúng.');
  }

  patchCpNumeric(target, cpIndex, wantedRange, TAG_INTEGER);
  const displacement = 434 - 416;
  target.bytes.set(
    [0x9a, (displacement >> 8) & 0xff, displacement & 0xff],
    method.codeStart + 416
  );
  return actualChance;
}

function patchActivationChance(
  target: MutableClass,
  method: MethodLayout,
  chancePercent: number
): number {
  const baseThreshold = Math.max(
    0,
    Math.min(10000, Math.round(chancePercent * 100))
  );
  const cloverThreshold = Math.max(
    0,
    Math.min(10000, Math.round(baseThreshold * 1.2))
  );

  patchSameLengthPush(target, method, 87, 10, baseThreshold);
  patchSameLengthPush(target, method, 106, 12, cloverThreshold);

  const code = codeBytes(target, method);
  const denominator = decodeImmediatePush(code, 110);
  if (!denominator || denominator.value !== 10000) {
    throw new Error('Activation denominator 10000 không còn đúng.');
  }

  return baseThreshold / 100;
}

function replaceMethodCode(
  target: MutableClass,
  method: MethodLayout,
  nextCode: Uint8Array,
  requiredNoExceptions = true
): void {
  if (requiredNoExceptions && method.exceptionTableLength !== 0) {
    throw new Error(
      `${method.name}${method.descriptor} có exception table; không thay Code length tự động.`
    );
  }

  const delta = nextCode.length - method.codeLength;
  const nextBytes = new Uint8Array(target.bytes.length + delta);

  nextBytes.set(target.bytes.slice(0, method.codeStart), 0);
  nextBytes.set(nextCode, method.codeStart);
  nextBytes.set(
    target.bytes.slice(method.codeEnd),
    method.codeStart + nextCode.length
  );

  const nextView = new DataView(nextBytes.buffer);
  writeU4(nextView, method.codeLengthOffset, nextCode.length);
  writeU4(
    nextView,
    method.attributeLengthOffset,
    method.attributeLength + delta
  );

  target.bytes = nextBytes;
  target.layout = parseRawClassLayout(nextBytes.buffer);
}

function buildGoldWrapperCode(
  originalCode: Uint8Array,
  multiplier: number
): Uint8Array {
  if (
    originalCode.length !== 17 ||
    originalCode[0] !== 0x2a ||
    originalCode[1] !== 0x1b ||
    originalCode[2] !== 0x1c ||
    originalCode[3] !== 0xb8 ||
    originalCode[6] !== 0x3d ||
    originalCode[7] !== 0x2a ||
    originalCode[8] !== 0x1b ||
    originalCode[9] !== 0x1c ||
    originalCode[10] !== 0x1d ||
    originalCode[11] !== 0x15 ||
    originalCode[12] !== 0x04 ||
    originalCode[13] !== 0xb8 ||
    originalCode[16] !== 0xac
  ) {
    throw new Error(
      'a/a/h.a(La/m;IIII)I không còn đúng wrapper scaleGoldQty đã xác minh.'
    );
  }

  const ratio = fraction(multiplier, 10);
  const numeratorPush = shortestPush(ratio.numerator);
  const denominatorPush = shortestPush(ratio.denominator);
  if (!numeratorPush || !denominatorPush) {
    throw new Error(`Không encode được hệ số vàng x${multiplier}.`);
  }

  const scaleCall = originalCode.slice(3, 6);
  const dropCall = originalCode.slice(13, 16);

  const bytes = [
    0x2a, // aload_0
    0x1b, // iload_1
    0x1c, // iload_2
    ...scaleCall,
    ...numeratorPush,
    0x68, // imul
    ...denominatorPush,
    0x6c, // idiv
    0x3d, // istore_2
    0x2a,
    0x1b,
    0x1c,
    0x1d,
    0x15,
    0x04,
    ...dropCall,
    0xac,
  ];

  return new Uint8Array(bytes);
}

function bestTreasureRatio(multiplier: number): {
  numerator: number;
  denominator: number;
  error: number;
} {
  const targetRatio = (4 / 3) * multiplier;
  let best = { numerator: 4, denominator: 3, error: Infinity };

  for (let denominator = 1; denominator <= 127; denominator++) {
    const numerator = Math.max(1, Math.round(targetRatio * denominator));
    const numeratorPush = shortestPush(numerator);
    const denominatorPush = shortestPush(denominator);
    if (!numeratorPush || !denominatorPush) continue;
    if (numeratorPush.length + denominatorPush.length > 4) continue;

    const error = Math.abs(targetRatio - numerator / denominator);
    if (error < best.error - 1e-12) {
      best = { numerator, denominator, error };
      if (error < 1e-12) break;
    }
  }

  return best;
}

function patchTreasureMultiplier(
  target: MutableClass,
  method: MethodLayout,
  multiplier: number
): void {
  const code = codeBytes(target, method);
  const expected = [
    0x60, // iadd @23
    0x3b, // istore_0
    0x1a, // iload_0
    0x07, // iconst_4
    0x68, // imul
    0x04, // iconst_1
    0x60, // iadd
    0x06, // iconst_3
    0x6c, // idiv
    0xac, // ireturn
  ];

  for (let index = 0; index < expected.length; index++) {
    if (code[23 + index] !== expected[index]) {
      throw new Error(
        `patch/DR.rewardMultiplierPercent @${23 + index} không khớp bytecode gốc.`
      );
    }
  }

  const ratio = bestTreasureRatio(multiplier);
  const numeratorPush = shortestPush(ratio.numerator);
  const denominatorPush = shortestPush(ratio.denominator);
  if (!numeratorPush || !denominatorPush) {
    throw new Error('Không encode được multiplier BĐKB.');
  }

  const replacement: number[] = [
    0x60, // giữ iadd của base + interpolation
    ...numeratorPush,
    0x68, // imul
    0x04, // +1 giữ cách làm tròn gốc
    0x60,
    ...denominatorPush,
    0x6c,
    0xac,
  ];

  while (replacement.length < 10) {
    replacement.splice(replacement.length - 1, 0, 0x00);
  }

  if (replacement.length !== 10) {
    throw new Error(
      `Treasure rewrite dài ${replacement.length}, cần đúng 10 byte.`
    );
  }

  target.bytes.set(replacement, method.codeStart + 23);
}

async function loadMutableClass(
  session: LoadedJarSession,
  className: string
): Promise<MutableClass> {
  const path = normalizeClassEntryPath(className);
  const entry = session.zip.file(path);
  if (!entry) throw new Error(`Không tìm thấy ${path}.`);
  const buffer = await entry.async('arraybuffer');
  return {
    path,
    bytes: new Uint8Array(buffer.slice(0)),
    layout: parseRawClassLayout(buffer),
    classInfo: await getSessionClassInfo(session, className),
  };
}

function addBlocker(
  blockers: MechanicsPatchBlocker[],
  field: string,
  message: string
): void {
  blockers.push({ field, message });
}

function valueChanged(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) > Number.EPSILON * scale * 32;
}

const DEFAULT_CHANCE: Record<string, number> = {
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

const DEFAULT_QUANTITY: Record<string, number> = {
  gem: 2,
  purpleQuartz: 1,
  dragonBall5: 1,
  dragonBall7: 1,
  mabuEgg: 1,
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

function dirtyMechanicFields(draft: GameMechanicsDraft): number {
  return getGameMechanicsDirtyCount(draft);
}

export async function buildMechanicsPatches(
  session: LoadedJarSession
): Promise<MechanicsPatchResult> {
  const draft = getGameMechanicsDraft(session);
  const dirtyCount = dirtyMechanicFields(draft);
  const rewrittenClasses = new Map<string, ArrayBuffer>();
  const blockers: MechanicsPatchBlocker[] = [];
  const diagnostics: string[] = [];

  if (dirtyCount === 0) {
    return {
      status: 'NO_CHANGES',
      rewrittenClasses,
      appliedDraftCount: 0,
      appliedPatchCount: 0,
      unsupportedDraftCount: 0,
      blockers,
      diagnostics,
    };
  }

  try {
    const snapshot = await analyzeGameMechanics(session);
    const classes = new Map<string, MutableClass>();

    const getClass = async (name: string): Promise<MutableClass> => {
      const path = normalizeClassEntryPath(name);
      const existing = classes.get(path);
      if (existing) return existing;
      const loaded = await loadMutableClass(session, name);
      classes.set(path, loaded);
      return loaded;
    };

    let appliedDraftCount = 0;
    let appliedPatchCount = 0;

    // TNSM coefficient: unique CONSTANT_Double loaded by ldc2_w.
    if (valueChanged(draft.tnsmMultiplier, 1)) {
      try {
        if (!snapshot.tnsm.source.detected) {
          throw new Error('Source tm$reward chưa được xác minh.');
        }
        const target = await getClass('a/a/aa');
        const method = findMethod(
          target.layout,
          'tm$reward',
          '(La/a/H;La/m;I)V'
        );
        const cpIndex = readCpIndexFromLoad(target, method, 7);
        const entry = target.layout.constantPool[cpIndex];
        if (
          !entry ||
          entry.tag !== TAG_DOUBLE ||
          !cpValueEquals(entry.value, 0.0005)
        ) {
          throw new Error('Double 0.0005 không còn đúng tại tm$reward @7.');
        }
        patchCpNumeric(
          target,
          cpIndex,
          0.0005 * draft.tnsmMultiplier,
          TAG_DOUBLE
        );
        appliedDraftCount++;
        appliedPatchCount++;
        diagnostics.push(
          `TNSM: 0.0005 → ${0.0005 * draft.tnsmMultiplier}`
        );
      } catch (error: unknown) {
        addBlocker(
          blockers,
          'TNSM',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Power/potential cap: the intended 1e12 CP long is shared across a/a/V on purpose.
    if (valueChanged(draft.powerCapMultiplier, 1)) {
      try {
        const target = await getClass('a/a/V');
        const indices = findCpNumericIndices(
          target,
          TAG_LONG,
          1_000_000_000_000
        );
        if (indices.length !== 1) {
          throw new Error(
            `Expected đúng 1 CONSTANT_Long cap 1e12, nhận ${indices.length}.`
          );
        }

        const nextCap = BigInt(
          Math.max(
            1,
            Math.trunc(1_000_000_000_000 * draft.powerCapMultiplier)
          )
        );
        patchCpNumeric(target, indices[0], nextCap, TAG_LONG);
        appliedDraftCount++;
        appliedPatchCount++;
        diagnostics.push(`Power cap: 1e12 → ${nextCap.toString()}`);
      } catch (error: unknown) {
        addBlocker(
          blockers,
          'Power cap',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Treasure reward keeps control flow/stack-map offsets unchanged.
    if (valueChanged(draft.treasureRewardMultiplier, 1)) {
      try {
        if (!snapshot.treasureReward.source.detected) {
          throw new Error('rewardMultiplierPercent chưa được xác minh.');
        }
        const target = await getClass('patch/DR');
        const method = findMethod(
          target.layout,
          'rewardMultiplierPercent',
          '()I'
        );
        patchTreasureMultiplier(
          target,
          method,
          draft.treasureRewardMultiplier
        );
        appliedDraftCount++;
        appliedPatchCount++;
        diagnostics.push(
          `BĐKB reward multiplier: x${draft.treasureRewardMultiplier}`
        );
      } catch (error: unknown) {
        addBlocker(
          blockers,
          'Thưởng BĐKB',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Global gold: replace the branchless wrapper only; existing GTLFix/TM logic stays intact.
    if (valueChanged(draft.desiredGlobalGoldMultiplier, 1)) {
      try {
        if (!snapshot.gold.hookSource.detected) {
          throw new Error('Hook scaleGoldQty chưa được xác minh.');
        }
        const target = await getClass('a/a/h');
        const method = findMethod(
          target.layout,
          'a',
          '(La/m;IIII)I'
        );
        const originalCode = codeBytes(target, method);
        const nextCode = buildGoldWrapperCode(
          originalCode,
          draft.desiredGlobalGoldMultiplier
        );
        replaceMethodCode(target, method, nextCode, true);
        appliedDraftCount++;
        appliedPatchCount++;
        diagnostics.push(
          `Vàng global: wrapper a/a/h.a(...) x${draft.desiredGlobalGoldMultiplier}`
        );
      } catch (error: unknown) {
        addBlocker(
          blockers,
          'Vàng global',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Chance rules with existing RNG compare.
    const chanceRules: Array<{
      key: string;
      className: string;
      methodName: string;
      descriptor: string;
      rangeOffset: number;
      thresholdOffset: number;
      branchOffset: number;
      expectedRange: number;
      expectedThreshold: number;
    }> = [
      {
        key: 'purpleQuartz',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        rangeOffset: 133,
        thresholdOffset: 138,
        branchOffset: 140,
        expectedRange: 30,
        expectedThreshold: 1,
      },
      {
        key: 'dragonBall5',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        rangeOffset: 172,
        thresholdOffset: 177,
        branchOffset: 179,
        expectedRange: 100,
        expectedThreshold: 5,
      },
      {
        key: 'dragonBall7',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        rangeOffset: 211,
        thresholdOffset: 216,
        branchOffset: 218,
        expectedRange: 100,
        expectedThreshold: 2,
      },
      {
        key: 'mabuEgg',
        className: 'patch/SA',
        methodName: 'maybeDropMabuEgg',
        descriptor: '(La/m;)V',
        rangeOffset: 13,
        thresholdOffset: 18,
        branchOffset: 19,
        expectedRange: 100,
        expectedThreshold: 5,
      },
      {
        key: 'upgradeStoneU',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        rangeOffset: 506,
        thresholdOffset: 511,
        branchOffset: 513,
        expectedRange: 100,
        expectedThreshold: 20,
      },
      {
        key: 'foodFullDivine',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        rangeOffset: 567,
        thresholdOffset: 572,
        branchOffset: 573,
        expectedRange: 100,
        expectedThreshold: 5,
      },
      {
        key: 'rareU',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        rangeOffset: 715,
        thresholdOffset: 721,
        branchOffset: 722,
        expectedRange: 1000,
        expectedThreshold: 1,
      },
      {
        key: 'crystalStar',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        rangeOffset: 749,
        thresholdOffset: 754,
        branchOffset: 756,
        expectedRange: 100,
        expectedThreshold: 5,
      },
      {
        key: 'specialMinus239Gear',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        rangeOffset: 75,
        thresholdOffset: 80,
        branchOffset: 82,
        expectedRange: 100,
        expectedThreshold: 10,
      },
    ];

    for (const rule of chanceRules) {
      const defaultChance = DEFAULT_CHANCE[rule.key];
      const nextChance =
        draft.dropChancePercent[rule.key] ?? defaultChance;
      if (!valueChanged(nextChance, defaultChance)) continue;

      try {
        const target = await getClass(rule.className);
        const method = findMethod(
          target.layout,
          rule.methodName,
          rule.descriptor
        );
        const actual = patchRngCompare(
          target,
          method,
          rule.rangeOffset,
          rule.thresholdOffset,
          rule.branchOffset,
          rule.expectedRange,
          rule.expectedThreshold,
          nextChance
        );
        appliedDraftCount++;
        appliedPatchCount++;
        diagnostics.push(
          `${rule.key}: chance ${defaultChance}% → ${actual.toFixed(4)}%`
        );
      } catch (error: unknown) {
        addBlocker(
          blockers,
          `${rule.key} chance`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Activation level 1: threshold is stored in locals (10/12) and denominator is fixed 10000.
    {
      const key = 'activationLevel1';
      const defaultChance = DEFAULT_CHANCE[key];
      const nextChance = draft.dropChancePercent[key] ?? defaultChance;
      if (valueChanged(nextChance, defaultChance)) {
        try {
          const target = await getClass('patch/SA');
          const method = findMethod(
            target.layout,
            'maybeDropLevel1Activation',
            '(La/m;)V'
          );
          const actual = patchActivationChance(target, method, nextChance);
          appliedDraftCount++;
          appliedPatchCount += 2;
          diagnostics.push(
            `${key}: ${defaultChance}% → ${actual.toFixed(3)}%`
          );
        } catch (error: unknown) {
          addBlocker(
            blockers,
            `${key} chance`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    // Gem: existing RNG result is discarded but has exactly 3 NOP bytes for a branch.
    {
      const key = 'gem';
      const defaultChance = DEFAULT_CHANCE[key];
      const nextChance = draft.dropChancePercent[key] ?? defaultChance;
      if (valueChanged(nextChance, defaultChance)) {
        try {
          const target = await getClass('a/a/aa');
          const method = findMethod(
            target.layout,
            'a',
            '(La/m;La/a/H;Z)[I'
          );
          const actual = patchGemChance(target, method, nextChance);
          appliedDraftCount++;
          appliedPatchCount += 2;
          diagnostics.push(
            `${key}: ${defaultChance}% → ${actual.toFixed(4)}%`
          );
        } catch (error: unknown) {
          addBlocker(
            blockers,
            `${key} chance`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    // -239 guaranteed dragon branch has 22 NOP bytes reserved before the drop.
    {
      const key = 'specialMinus239Dragon';
      const defaultChance = DEFAULT_CHANCE[key];
      const nextChance = draft.dropChancePercent[key] ?? defaultChance;
      if (valueChanged(nextChance, defaultChance)) {
        try {
          const target = await getClass('a/a/aa');
          const method = findMethod(
            target.layout,
            'customDrop',
            '(La/m;)V'
          );
          const actual = patchSpecialDragonChance(
            target,
            method,
            nextChance
          );
          appliedDraftCount++;
          appliedPatchCount++;
          diagnostics.push(
            `${key}: ${defaultChance}% → ${actual.toFixed(4)}%`
          );
        } catch (error: unknown) {
          addBlocker(
            blockers,
            `${key} chance`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    // Guaranteed branches that do not have enough bytecode room for safe in-place RNG.
    for (const key of ['mysteryCapsule', 'questDragon7', 'campGold']) {
      const defaultChance = DEFAULT_CHANCE[key];
      const nextChance = draft.dropChancePercent[key] ?? defaultChance;
      if (valueChanged(nextChance, defaultChance)) {
        addBlocker(
          blockers,
          `${key} chance`,
          key === 'mysteryCapsule'
            ? 'Capsule có hơn một đường drop guaranteed; chưa chèn RNG cho tất cả đường một cách an toàn.'
            : key === 'questDragon7'
            ? 'Drop nhiệm vụ hiện guaranteed và không có khoảng byte trống đủ để chèn RNG mà không rebuild StackMap.'
            : 'Vàng doanh trại được drop guaranteed trước RNG Ngọc Rồng; chance <100% cần branch writer riêng.'
        );
      }
    }

    // Quantity rules. Most qty=1/2 use iconst, so safe range is 1..5.
    const quantityRules: Array<{
      key: string;
      className: string;
      methodName: string;
      descriptor: string;
      offsets: number[];
      expected: number;
    }> = [
      {
        key: 'gem',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        offsets: [429],
        expected: 2,
      },
      {
        key: 'purpleQuartz',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        offsets: [147],
        expected: 1,
      },
      {
        key: 'dragonBall5',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        offsets: [186],
        expected: 1,
      },
      {
        key: 'dragonBall7',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        offsets: [225],
        expected: 1,
      },
      {
        key: 'mabuEgg',
        className: 'patch/SA',
        methodName: 'maybeDropMabuEgg',
        descriptor: '(La/m;)V',
        offsets: [26],
        expected: 1,
      },
      {
        key: 'upgradeStoneU',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        offsets: [536],
        expected: 1,
      },
      {
        key: 'foodFullDivine',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        offsets: [592],
        expected: 1,
      },
      {
        key: 'rareU',
        className: 'a/a/aa',
        methodName: 'c',
        descriptor: '(La/m;)I',
        offsets: [328],
        expected: 1,
      },
      {
        key: 'crystalStar',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        offsets: [776],
        expected: 1,
      },
      {
        key: 'mysteryCapsule',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        offsets: [71, 821],
        expected: 1,
      },
      {
        key: 'questDragon7',
        className: 'a/a/aa',
        methodName: 'a',
        descriptor: '(La/m;La/a/H;Z)[I',
        offsets: [167],
        expected: 1,
      },
      {
        key: 'specialMinus239Dragon',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        offsets: [66],
        expected: 1,
      },
      {
        key: 'specialMinus239Gear',
        className: 'a/a/aa',
        methodName: 'customDrop',
        descriptor: '(La/m;)V',
        offsets: [103, 115, 127],
        expected: 1,
      },
    ];

    for (const rule of quantityRules) {
      const defaultQuantity = DEFAULT_QUANTITY[rule.key];
      const nextQuantity =
        draft.dropQuantity[rule.key] ?? defaultQuantity;
      if (!valueChanged(nextQuantity, defaultQuantity)) continue;

      try {
        const target = await getClass(rule.className);
        const method = findMethod(
          target.layout,
          rule.methodName,
          rule.descriptor
        );

        for (const offset of rule.offsets) {
          patchSameLengthPush(
            target,
            method,
            offset,
            rule.expected,
            nextQuantity
          );
        }

        appliedDraftCount++;
        appliedPatchCount += rule.offsets.length;
        diagnostics.push(
          `${rule.key}: quantity ${defaultQuantity} → ${nextQuantity}`
        );
      } catch (error: unknown) {
        addBlocker(
          blockers,
          `${rule.key} quantity`,
          `${error instanceof Error ? error.message : String(error)} Với opcode hiện tại, quantity phổ biến chỉ sửa an toàn trong 1..5.`
        );
      }
    }

    // Camp gold quantity is an ldc_w Integer and can be replaced in CP safely.
    {
      const key = 'campGold';
      const defaultQuantity = DEFAULT_QUANTITY[key];
      const nextQuantity =
        draft.dropQuantity[key] ?? defaultQuantity;

      if (valueChanged(nextQuantity, defaultQuantity)) {
        try {
          const target = await getClass('patch/TM');
          const method = findMethod(
            target.layout,
            'dropCampMobLoot',
            '(La/m;)V'
          );
          const cpIndex = readCpIndexFromLoad(target, method, 8);
          const entry = target.layout.constantPool[cpIndex];
          if (
            !entry ||
            entry.tag !== TAG_INTEGER ||
            !cpValueEquals(entry.value, 100000)
          ) {
            throw new Error('Camp gold CONSTANT_Integer 100000 không còn đúng.');
          }
          patchCpNumeric(
            target,
            cpIndex,
            Math.trunc(nextQuantity),
            TAG_INTEGER
          );
          appliedDraftCount++;
          appliedPatchCount++;
          diagnostics.push(
            `${key}: quantity ${defaultQuantity} → ${nextQuantity}`
          );
        } catch (error: unknown) {
          addBlocker(
            blockers,
            `${key} quantity`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    // Validate all modified classes with the repo parser before returning bytes.
    for (const target of classes.values()) {
      const buffer = target.bytes.buffer.slice(
        target.bytes.byteOffset,
        target.bytes.byteOffset + target.bytes.byteLength
      ) as ArrayBuffer;
      const parsed = parseClassFile(buffer);
      if (
        parsed.status !== 'valid' ||
        parsed.remainingBytes !== 0 ||
        parsed.magic !== 0xcafebabe
      ) {
        throw new Error(`${target.path} không parse hợp lệ sau mechanics patch.`);
      }
      rewrittenClasses.set(target.path, buffer);
    }

    const unsupportedDraftCount = blockers.length;

    return {
      status: blockers.length > 0 ? 'BLOCKED' : 'READY',
      rewrittenClasses,
      appliedDraftCount,
      appliedPatchCount,
      unsupportedDraftCount,
      blockers,
      diagnostics,
    };
  } catch (error: unknown) {
    return {
      status: 'FAILED',
      rewrittenClasses,
      appliedDraftCount: 0,
      appliedPatchCount: 0,
      unsupportedDraftCount: dirtyCount,
      blockers,
      diagnostics,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

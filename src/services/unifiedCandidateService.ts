import JSZip from 'jszip';
import { CandidateOutputJar, LoadedJarSession } from '../types/jar';
import { parseClassFile } from './classFileParser';
import {
  buildDraftTestCandidate,
  DraftTestBuildResult,
  DraftTestProgress,
  DraftTestSummary,
  getDraftStateFingerprint,
} from './draftTestService';
import { buildNewItemCandidate } from './itemCreationService';
import { buildQuestPatchCandidate } from './questDataService';
import {
  buildMultiplayerCandidate,
  MultiplayerLiteConfig,
} from './multiplayerPatchService';
import {
  getPatchWorkspaceFingerprint,
  getPatchWorkspaceOperations,
  WorkspaceMultiplayerOperation,
  WorkspaceNewItemOperation,
  WorkspaceQuestPatchOperation,
  WorkspaceNewBossOperation,
} from './patchWorkspaceStateService';

const SMALL_IMAGE_INDEX_PATH = 'x1/smallimage.idx';
const SMALL_IMAGE_MAGIC = 0x53495032; // SIP2
const SMALL_IMAGE_HEADER_SIZE = 10;
const SMALL_IMAGE_RECORD_SIZE = 12;

function emptySummary(): DraftTestSummary {
  return {
    itemDrafts: 0,
    npcDrafts: 0,
    mapDrafts: 0,
    mobDrafts: 0,
    skillDrafts: 0,
    bossDrafts: 0,
    mechanicDrafts: 0,
    characterDrafts: 0,
    supportedDrafts: 0,
    unsupportedDrafts: 0,
    modifiedCells: 0,
    rewrittenClasses: 0,
  };
}

function outputName(name: string): string {
  const safe = name || 'game.jar';
  return safe.toLowerCase().endsWith('.jar')
    ? `${safe.slice(0, -4)}_workspace.jar`
    : `${safe}_workspace.jar`;
}

async function originalBlob(session: LoadedJarSession): Promise<Blob> {
  return session.originalFile.slice(
    0,
    session.originalFile.size,
    session.originalFile.type || 'application/java-archive'
  );
}

function splitOperations(operations: ReturnType<typeof getPatchWorkspaceOperations>) {
  return {
    newItems: operations.filter(
      (operation): operation is WorkspaceNewItemOperation => operation.kind === 'NEW_ITEM'
    ),
    multiplayer: operations.find(
      (operation): operation is WorkspaceMultiplayerOperation =>
        operation.kind === 'MULTIPLAYER_LITE'
    ),
    questPatch: operations.find(
      (operation): operation is WorkspaceQuestPatchOperation =>
        operation.kind === 'QUEST_PATCH'
    ),
    newBosses: operations.filter(
      (operation): operation is WorkspaceNewBossOperation => operation.kind === 'NEW_BOSS'
    ),
  };
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = String(value || '').replace(/^data:image\/png;base64,/i, '').trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

function assertPng(bytes: Uint8Array): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Custom item icon không phải PNG hợp lệ.');
  }
}

async function appendCustomSmallImage(
  inputBlob: Blob,
  pngBase64: string
): Promise<{ blob: Blob; imageId: number; pack: number; packPath: string }> {
  const png = base64ToBytes(pngBase64);
  assertPng(png);
  if (png.byteLength > 2 * 1024 * 1024) {
    throw new Error('Custom item icon vượt 2 MB.');
  }

  const zip = await JSZip.loadAsync(await inputBlob.arrayBuffer());
  const idxEntry = zip.file(SMALL_IMAGE_INDEX_PATH);
  if (!idxEntry) throw new Error(`Không tìm thấy ${SMALL_IMAGE_INDEX_PATH}.`);

  const idx = await idxEntry.async('uint8array');
  if (idx.byteLength < SMALL_IMAGE_HEADER_SIZE) {
    throw new Error('smallimage.idx quá ngắn.');
  }
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
  if (view.getUint32(0, false) !== SMALL_IMAGE_MAGIC) {
    throw new Error('smallimage.idx không phải SIP2.');
  }

  const count = view.getUint16(4, false);
  const recordsEnd = SMALL_IMAGE_HEADER_SIZE + count * SMALL_IMAGE_RECORD_SIZE;
  if (idx.byteLength < recordsEnd) {
    throw new Error(`smallimage.idx thiếu record: count=${count}, bytes=${idx.byteLength}.`);
  }
  if (count >= 0xffff) throw new Error('smallimage.idx đã đạt giới hạn 65535 record.');

  let maxId = -1;
  let maxPack = -1;
  let previousId = -1;
  for (let i = 0; i < count; i++) {
    const offset = SMALL_IMAGE_HEADER_SIZE + i * SMALL_IMAGE_RECORD_SIZE;
    const id = view.getUint16(offset, false);
    const pack = view.getUint16(offset + 2, false);
    if (id <= previousId) {
      throw new Error(`smallimage.idx không sort tăng dần tại record ${i}; writer không tự chèn mù.`);
    }
    previousId = id;
    if (id > maxId) maxId = id;
    if (pack > maxPack) maxPack = pack;
  }

  const imageId = maxId + 1;
  const pack = maxPack + 1;
  if (imageId > 0xffff) throw new Error('Không còn SmallImage ID trống sau max ID hiện tại.');
  if (pack > 0xffff) throw new Error('Không còn pack ID trống cho SmallImage.');

  const nextIdx = new Uint8Array(recordsEnd + SMALL_IMAGE_RECORD_SIZE);
  nextIdx.set(idx.slice(0, recordsEnd), 0);
  const nextView = new DataView(nextIdx.buffer);
  nextView.setUint16(4, count + 1, false);
  const recordOffset = recordsEnd;
  nextView.setUint16(recordOffset, imageId, false);
  nextView.setUint16(recordOffset + 2, pack, false);
  nextView.setUint32(recordOffset + 4, 0, false);
  nextView.setUint32(recordOffset + 8, png.byteLength, false);

  const packPath = `x1/smallimage-${pack}.pack`;
  if (zip.file(packPath)) {
    throw new Error(`${packPath} đã tồn tại dù pack ID được xác định là mới.`);
  }

  zip.file(SMALL_IMAGE_INDEX_PATH, nextIdx);
  zip.file(packPath, png);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // Re-open và xác minh record vừa ghi trước khi cho phép build item tiếp.
  const verifyZip = await JSZip.loadAsync(await blob.arrayBuffer());
  const verifyIdx = await verifyZip.file(SMALL_IMAGE_INDEX_PATH)?.async('uint8array');
  const verifyPack = await verifyZip.file(packPath)?.async('uint8array');
  if (!verifyIdx || !verifyPack || verifyPack.byteLength !== png.byteLength) {
    throw new Error('Không verify được SmallImage asset vừa thêm.');
  }
  const verifyView = new DataView(verifyIdx.buffer, verifyIdx.byteOffset, verifyIdx.byteLength);
  const last = SMALL_IMAGE_HEADER_SIZE + count * SMALL_IMAGE_RECORD_SIZE;
  if (
    verifyView.getUint16(4, false) !== count + 1 ||
    verifyView.getUint16(last, false) !== imageId ||
    verifyView.getUint16(last + 2, false) !== pack ||
    verifyView.getUint32(last + 4, false) !== 0 ||
    verifyView.getUint32(last + 8, false) !== png.byteLength
  ) {
    throw new Error('Record SmallImage mới không khớp sau khi đóng JAR.');
  }

  return { blob, imageId, pack, packPath };
}



const BOSS_MANAGER_CLASS_PATH = 'a/a/d.class';
const BOSS_GATE_HELPER_PATH = 'patch/PanelBossCreatorRuntime.class';
const BOSS_GATE_HELPER_BASE64 = 'yv66vgAAAC8AXAoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWCQAIAAkHAAoMAAsADAEAHXBhdGNoL1BhbmVsQm9zc0NyZWF0b3JSdW50aW1lAQAGbG9hZGVkAQABWggADgEADy9ib3NzLXBhbmVsLmNmZwoAEAARBwASDAATABQBAA9qYXZhL2xhbmcvQ2xhc3MBABNnZXRSZXNvdXJjZUFzU3RyZWFtAQApKExqYXZhL2xhbmcvU3RyaW5nOylMamF2YS9pby9JbnB1dFN0cmVhbTsHABYBABZqYXZhL2xhbmcvU3RyaW5nQnVmZmVyCgAVAAMKABkAGgcAGwwAHAAdAQATamF2YS9pby9JbnB1dFN0cmVhbQEABHJlYWQBAAMoKUkKABUAHwwAIAAhAQAGYXBwZW5kAQAbKEMpTGphdmEvbGFuZy9TdHJpbmdCdWZmZXI7CgAZACMMACQABgEABWNsb3NlCgAVACYMACcAKAEACHRvU3RyaW5nAQAUKClMamF2YS9sYW5nL1N0cmluZzsKACoAKwcALAwALQAdAQAQamF2YS9sYW5nL1N0cmluZwEABmxlbmd0aAoAKgAvDAAwADEBAAdpbmRleE9mAQAFKElJKUkKACoAMwwANAA1AQAJc3Vic3RyaW5nAQAWKElJKUxqYXZhL2xhbmcvU3RyaW5nOwoAKgA3DAA4ACgBAAR0cmltCgAqADoMADAAOwEABChJKUkJAAgAPQwAPgA/AQADaWRzAQACW0kJAAgAQQwAQgA/AQAEbWFwcwoARABFBwBGDABHAEgBABFqYXZhL2xhbmcvSW50ZWdlcgEACHBhcnNlSW50AQAVKExqYXZhL2xhbmcvU3RyaW5nOylJCgAqAEoMADQASwEAFShJKUxqYXZhL2xhbmcvU3RyaW5nOwcATQEAE2phdmEvbGFuZy9UaHJvd2FibGUKAAgATwwAUAAGAQAEbG9hZAoAUgBTBwBUDABVADEBAAhwYXRjaC9DSAEAB2FsbG93ZWQBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQANU3RhY2tNYXBUYWJsZQEACDxjbGluaXQ+AQAKU291cmNlRmlsZQEAHFBhbmVsQm9zc0NyZWF0b3JSdW50aW1lLmphdmEAMQAIAAIAAAADAAoACwAMAAAACgA+AD8AAAAKAEIAPwAAAAQAAgAFAAYAAQBWAAAAHQABAAEAAAAFKrcAAbEAAAABAFcAAAAGAAEAAAAKACoAUAAGAAEAVgAAAiYABQAKAAABJbIAB5kABLEEswAHEggSDbYAD0sqxwAEsbsAFVm3ABdMKrYAGFk9mwANKxyStgAeV6f/8Cq2ACIrtgAlTgM2BAM2BRUFLbYAKaIAQy0QChUFtgAuNgYVBpwACS22ACk2Bi0VBRUGtgAytgA2OgcZB7YAKZ4AEBkHECy2ADmeAAaEBAEVBgRgNgWn/7oVBLwKswA8FQS8CrMAQAM2BgM2BRUFLbYAKaIAbxUGFQSiAGgtEAoVBbYALjYHFQecAAkttgApNgctFQUVB7YAMrYANjoIGQgQLLYAOTYJFQmeAC+yADwVBhkIAxUJtgAytgA2uABDT7IAQBUGGQgVCQRgtgBJtgA2uABDT4QGARUHBGA2Baf/jqcAEEsDvAqzADwDvAqzAECxAAIACwAXARcATAAYARQBFwBMAAIAVwAAAJYAJQAAAA0ABwAOAAsAEAATABEAGAASACAAFAAzABUANwAWADwAFwA/ABgAQgAZAEsAGgBVABsAYAAcAG0AHQCCAB4AiAAfAIsAIACSACEAmQAiAJwAIwCfACQArwAlALkAJgDEACcA0QAoANoAKQDfACoA8wArAQgALAELAC4BEQAvARQAMwEXADABGAAxAR4AMgEkADQAWAAAAEMADgf8ABAHABn8AAcHABX8ABIB/gAOBwAqAQH8AB0B/AAhBwAq+QAI/AATAfwAJAH9AEYHACoB/wAIAAAAAEIHAEwMAAkAVQAxAAEAVgAAAGwAAgADAAAAMbgATgM9HLIAPL6iACGyADwcLhqgABKyAEAcLhugAAcEpwAEA6yEAgGn/90aG7gAUawAAAACAFcAAAAWAAUAAAA3AAMAOAANADkAJQA4ACsAOwBYAAAADQAF/AAFAR1AAQD6AAUACABZAAYAAQBWAAAAKQABAAAAAAANA7wKswA8A7wKswBAsQAAAAEAVwAAAAoAAgAAAAcABgAIAAEAWgAAAAIAWw==';
const BOSS_GATE_CONFIG_PATH = 'boss-panel.cfg';

type RawCp = { tag: number; a?: number; b?: number; value?: string } | null;
type RawMethod = { name: string; descriptor: string; attributeStart: number; maxStackOffset: number; codeStart: number; codeLength: number; codeEnd: number };
type RawLayout = { cpCount: number; cpEnd: number; cp: RawCp[]; methods: RawMethod[] };

function readU2Raw(view: DataView, offset: number): number { return view.getUint16(offset, false); }
function readU4Raw(view: DataView, offset: number): number { return view.getUint32(offset, false); }
function writeU2Raw(view: DataView, offset: number, value: number): void { view.setUint16(offset, value & 0xffff, false); }
function writeU4Raw(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, false); }

function parseBossRawLayout(input: Uint8Array): RawLayout {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(0, false) !== 0xcafebabe) throw new Error('a/a/d.class không hợp lệ.');
  const cpCount = readU2Raw(view, 8);
  const cp: RawCp[] = new Array(cpCount).fill(null);
  let cursor = 10;
  for (let i = 1; i < cpCount; i++) {
    const tag = view.getUint8(cursor++);
    if (tag === 1) {
      const len = readU2Raw(view, cursor); cursor += 2;
      const value = new TextDecoder('utf-8', { fatal: false }).decode(input.slice(cursor, cursor + len));
      cp[i] = { tag, value }; cursor += len;
    } else if (tag === 3 || tag === 4) { cp[i] = { tag }; cursor += 4;
    } else if (tag === 5 || tag === 6) { cp[i] = { tag }; cursor += 8; i++;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) { cp[i] = { tag, a: readU2Raw(view, cursor) }; cursor += 2;
    } else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) { cp[i] = { tag, a: readU2Raw(view, cursor), b: readU2Raw(view, cursor + 2) }; cursor += 4;
    } else if (tag === 15) { cp[i] = { tag, a: view.getUint8(cursor), b: readU2Raw(view, cursor + 1) }; cursor += 3;
    } else throw new Error(`Constant Pool tag ${tag} chưa hỗ trợ khi tạo boss.`);
  }
  const cpEnd = cursor;
  cursor += 6;
  const interfaceCount = readU2Raw(view, cursor); cursor += 2 + interfaceCount * 2;
  const fieldCount = readU2Raw(view, cursor); cursor += 2;
  const skipAttrs = (count: number) => { for (let i = 0; i < count; i++) { cursor += 2; const len = readU4Raw(view, cursor); cursor += 4 + len; } };
  for (let i = 0; i < fieldCount; i++) { cursor += 6; const count = readU2Raw(view, cursor); cursor += 2; skipAttrs(count); }
  const methodCount = readU2Raw(view, cursor); cursor += 2;
  const methods: RawMethod[] = [];
  for (let i = 0; i < methodCount; i++) {
    cursor += 2;
    const nameIndex = readU2Raw(view, cursor); cursor += 2;
    const descIndex = readU2Raw(view, cursor); cursor += 2;
    const attrCount = readU2Raw(view, cursor); cursor += 2;
    const name = cp[nameIndex]?.value || '';
    const descriptor = cp[descIndex]?.value || '';
    for (let a = 0; a < attrCount; a++) {
      const attributeStart = cursor;
      const attrNameIndex = readU2Raw(view, cursor); cursor += 2;
      const attrLen = readU4Raw(view, cursor); cursor += 4;
      const dataStart = cursor;
      if ((cp[attrNameIndex]?.value || '') === 'Code') {
        const maxStackOffset = dataStart;
        const codeLength = readU4Raw(view, dataStart + 4);
        const codeStart = dataStart + 8;
        methods.push({ name, descriptor, attributeStart, maxStackOffset, codeStart, codeLength, codeEnd: codeStart + codeLength });
      }
      cursor = dataStart + attrLen;
    }
  }
  return { cpCount, cpEnd, cp, methods };
}

function resolveClassName(layout: RawLayout, classIndex: number): string {
  const cls = layout.cp[classIndex];
  return cls?.tag === 7 && cls.a ? (layout.cp[cls.a]?.value || '') : '';
}

function findRawMethodRef(layout: RawLayout, owner: string, name: string, descriptor: string): number {
  for (let i = 1; i < layout.cp.length; i++) {
    const ref = layout.cp[i];
    if (!ref || ref.tag !== 10 || !ref.a || !ref.b) continue;
    const nat = layout.cp[ref.b];
    if (!nat || nat.tag !== 12 || !nat.a || !nat.b) continue;
    if (resolveClassName(layout, ref.a) === owner && layout.cp[nat.a]?.value === name && layout.cp[nat.b]?.value === descriptor) return i;
  }
  return -1;
}

function rawUtf8(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > 0xffff) throw new Error('Tên boss quá dài cho CONSTANT_Utf8.');
  const out = new Uint8Array(3 + encoded.length); out[0] = 1;
  const view = new DataView(out.buffer); writeU2Raw(view, 1, encoded.length); out.set(encoded, 3); return out;
}
function rawU2(tag: number, a: number): Uint8Array { return new Uint8Array([tag, (a >> 8) & 255, a & 255]); }
function rawU2U2(tag: number, a: number, b: number): Uint8Array { return new Uint8Array([tag, (a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255]); }
function rawInteger(value: number): Uint8Array { const out = new Uint8Array(5); out[0] = 3; new DataView(out.buffer).setInt32(1, value, false); return out; }
function rawLong(value: number): Uint8Array { const out = new Uint8Array(9); out[0] = 5; new DataView(out.buffer).setBigInt64(1, BigInt(Math.round(value)), false); return out; }

function appendBossCp(bytes: Uint8Array, entry: Uint8Array, slots = 1): { bytes: Uint8Array; index: number } {
  const layout = parseBossRawLayout(bytes);
  if (layout.cpCount + slots > 0xffff) throw new Error('Constant Pool boss manager đã đầy.');
  const next = new Uint8Array(bytes.length + entry.length);
  next.set(bytes.slice(0, layout.cpEnd), 0); next.set(entry, layout.cpEnd); next.set(bytes.slice(layout.cpEnd), layout.cpEnd + entry.length);
  writeU2Raw(new DataView(next.buffer), 8, layout.cpCount + slots);
  return { bytes: next, index: layout.cpCount };
}

function addBossUtf8(state: { bytes: Uint8Array }, value: string): number { const r = appendBossCp(state.bytes, rawUtf8(value)); state.bytes = r.bytes; return r.index; }
function addBossInteger(state: { bytes: Uint8Array }, value: number): number { const r = appendBossCp(state.bytes, rawInteger(value)); state.bytes = r.bytes; return r.index; }
function addBossLong(state: { bytes: Uint8Array }, value: number): number { const r = appendBossCp(state.bytes, rawLong(value), 2); state.bytes = r.bytes; return r.index; }
function addBossString(state: { bytes: Uint8Array }, value: string): number { const utf = addBossUtf8(state, value); const r = appendBossCp(state.bytes, rawU2(8, utf)); state.bytes = r.bytes; return r.index; }
function addBossMethodRef(state: { bytes: Uint8Array }, owner: string, name: string, descriptor: string): number {
  const ownerUtf = addBossUtf8(state, owner); let r = appendBossCp(state.bytes, rawU2(7, ownerUtf)); state.bytes = r.bytes; const cls = r.index;
  const nameUtf = addBossUtf8(state, name); const descUtf = addBossUtf8(state, descriptor);
  r = appendBossCp(state.bytes, rawU2U2(12, nameUtf, descUtf)); state.bytes = r.bytes; const nat = r.index;
  r = appendBossCp(state.bytes, rawU2U2(10, cls, nat)); state.bytes = r.bytes; return r.index;
}

function cpPush(index: number, opcode = 0x13): number[] { return [opcode, (index >> 8) & 255, index & 255]; }

function patchBossManagerBytes(original: Uint8Array, bosses: WorkspaceNewBossOperation[]): Uint8Array {
  if (!bosses.length) return original;
  const state = { bytes: new Uint8Array(original) };
  let layout = parseBossRawLayout(state.bytes);
  const oldGateRef = findRawMethodRef(layout, 'patch/CH', 'allowed', '(II)I');
  if (oldGateRef < 0) throw new Error('Boss Creator: JAR này thiếu hook patch/CH.allowed(II)I đã xác minh trên v1.9.6f.');
  const addBossRef = findRawMethodRef(layout, 'a/a/d', 'a', '(IIIIIILjava/lang/String;IIIJII)V');
  if (addBossRef < 0) throw new Error('Boss Creator: không tìm thấy hàm đăng ký boss cố định trong a/a/d.');
  const newGateRef = addBossMethodRef(state, 'patch/PanelBossCreatorRuntime', 'allowed', '(II)I');
  layout = parseBossRawLayout(state.bytes);
  const gateMethod = layout.methods.find((m) => m.name === 'a' && m.descriptor === '(La/a/d$a;La/a/H;I)Z');
  if (!gateMethod) throw new Error('Boss Creator: không tìm thấy boss allow method.');
  let gatePatched = 0;
  for (let p = gateMethod.codeStart; p + 2 < gateMethod.codeEnd; p++) {
    if (state.bytes[p] === 0xb8 && ((state.bytes[p + 1] << 8) | state.bytes[p + 2]) === oldGateRef) {
      state.bytes[p + 1] = (newGateRef >> 8) & 255; state.bytes[p + 2] = newGateRef & 255; gatePatched++; break;
    }
  }
  if (gatePatched !== 1) throw new Error('Boss Creator: không retarget được CH.allowed trong boss gate.');

  const payload: number[] = [];
  for (const boss of bosses) {
    const family = addBossInteger(state, -999);
    const stage = addBossInteger(state, -999);
    const charId = addBossInteger(state, boss.charId);
    const mapId = addBossInteger(state, boss.mapId);
    const name = addBossString(state, boss.name);
    const head = addBossInteger(state, boss.head);
    const body = addBossInteger(state, boss.body);
    const leg = addBossInteger(state, boss.leg);
    const hp = addBossLong(state, boss.hp);
    const damage = addBossInteger(state, boss.damage);
    const spawnX = addBossInteger(state, boss.spawnX);
    payload.push(...cpPush(family), ...cpPush(stage), ...cpPush(charId), 0x03, ...cpPush(mapId), 0x05, ...cpPush(name), ...cpPush(head), ...cpPush(body), ...cpPush(leg), ...cpPush(hp, 0x14), ...cpPush(damage), ...cpPush(spawnX), 0xb8, (addBossRef >> 8) & 255, addBossRef & 255);
  }

  layout = parseBossRawLayout(state.bytes);
  const fm = layout.methods.find((m) => m.name === 'fm' && m.descriptor === '()V');
  if (!fm || state.bytes[fm.codeEnd - 1] !== 0xb1) throw new Error('Boss Creator: fm() không có return cuối an toàn để nối boss mới.');
  const insertAt = fm.codeEnd - 1;
  const next = new Uint8Array(state.bytes.length + payload.length);
  next.set(state.bytes.slice(0, insertAt), 0); next.set(payload, insertAt); next.set(state.bytes.slice(insertAt), insertAt + payload.length);
  const view = new DataView(next.buffer);
  writeU4Raw(view, fm.maxStackOffset + 4, fm.codeLength + payload.length);
  writeU2Raw(view, fm.maxStackOffset, Math.max(readU2Raw(view, fm.maxStackOffset), 16));
  writeU4Raw(view, fm.attributeStart + 2, readU4Raw(view, fm.attributeStart + 2) + payload.length);
  const parsed = parseClassFile(next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength));
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) throw new Error('Boss Creator: a/a/d.class sau khi ghi không parse lại được.');
  return next;
}

async function buildNewBossCandidate(inputBlob: Blob, bosses: WorkspaceNewBossOperation[]): Promise<Blob> {
  if (!bosses.length) return inputBlob;
  if (bosses.length > 23) throw new Error('Boss Creator: v1.9.6f còn tối đa 23 slot boss mới trong mảng 80 phần tử.');
  const unique = new Set<number>();
  for (const boss of bosses) {
    if (unique.has(boss.charId)) throw new Error(`Boss Creator: trùng char ID ${boss.charId} trong workspace.`);
    unique.add(boss.charId);
  }
  const zip = await JSZip.loadAsync(await inputBlob.arrayBuffer());
  const entry = zip.file(BOSS_MANAGER_CLASS_PATH);
  if (!entry) throw new Error(`Không tìm thấy ${BOSS_MANAGER_CLASS_PATH}.`);
  const original = await entry.async('uint8array');
  const patched = patchBossManagerBytes(original, bosses);
  zip.file(BOSS_MANAGER_CLASS_PATH, patched);
  zip.file(BOSS_GATE_HELPER_PATH, base64ToBytes(BOSS_GATE_HELPER_BASE64));
  zip.file(BOSS_GATE_CONFIG_PATH, bosses.map((boss) => `${boss.charId},${boss.mapId}`).join('\n') + '\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const verify = await JSZip.loadAsync(await blob.arrayBuffer());
  const check = await verify.file(BOSS_MANAGER_CLASS_PATH)?.async('uint8array');
  if (!check || !verify.file(BOSS_GATE_HELPER_PATH) || !verify.file(BOSS_GATE_CONFIG_PATH)) throw new Error('Boss Creator: verify JAR sau ghi thất bại.');
  const parsed = parseClassFile(check.buffer.slice(check.byteOffset, check.byteOffset + check.byteLength));
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) throw new Error('Boss Creator: class manager verify cuối thất bại.');
  return blob;
}

export async function buildUnifiedWorkspaceCandidate(
  session: LoadedJarSession,
  onProgress?: (progress: DraftTestProgress) => void
): Promise<DraftTestBuildResult> {
  const operations = getPatchWorkspaceOperations(session);
  const { newItems, multiplayer, questPatch, newBosses } = splitOperations(operations);
  let activeSummary = emptySummary();

  try {
    onProgress?.({
      phase: 'COLLECTING',
      label: `Đang gom nháp + ${operations.length} operation trong Patch Workspace...`,
      current: 1,
      total: 5,
    });

    const draftResult = await buildDraftTestCandidate(session, (progress) => {
      if (progress.phase === 'DONE') return;
      onProgress?.(progress);
    });

    if (draftResult.status === 'BLOCKED' || draftResult.status === 'FAILED') {
      return draftResult;
    }

    if (draftResult.status === 'NO_CHANGES' && operations.length === 0) {
      return draftResult;
    }

    let currentBlob =
      draftResult.status === 'VALIDATED' && draftResult.candidate
        ? draftResult.candidate.blob
        : await originalBlob(session);
    const summary = draftResult.summary ?? activeSummary;
    activeSummary = summary;
    const appliedOperations: Array<Record<string, unknown>> = [];

    onProgress?.({
      phase: 'REWRITING',
      label: `Đang áp ${newItems.length} item mới vào JAR nền...`,
      current: 3,
      total: 5,
    });

    for (const operation of newItems) {
      const effectiveValues = [...operation.values];
      let customIconMetric: Record<string, unknown> | undefined;

      if (operation.customIcon?.pngBase64) {
        const iconResult = await appendCustomSmallImage(currentBlob, operation.customIcon.pngBase64);
        currentBlob = iconResult.blob;
        while (effectiveValues.length < 15) effectiveValues.push('');
        effectiveValues[6] = String(iconResult.imageId);
        customIconMetric = {
          fileName: operation.customIcon.fileName,
          imageId: iconResult.imageId,
          pack: iconResult.pack,
          packPath: iconResult.packPath,
        };
      }

      const candidate = await buildNewItemCandidate(
        session,
        {
          sourceClass: operation.sourceClass,
          values: effectiveValues,
        },
        currentBlob
      );
      currentBlob = candidate.blob;
      appliedOperations.push({
        kind: operation.kind,
        sourceClass: operation.sourceClass,
        id: effectiveValues[0],
        name: effectiveValues[3],
        iconId: effectiveValues[6],
        customIcon: customIconMetric,
        metrics: candidate.metrics?.newItem,
      });
    }

    if (newBosses.length > 0) {
      onProgress?.({
        phase: 'REWRITING',
        label: `Đang ghi ${newBosses.length} boss mới vào boss manager...`,
        current: 4,
        total: 5,
      });
      currentBlob = await buildNewBossCandidate(currentBlob, newBosses);
      appliedOperations.push({
        kind: 'NEW_BOSS',
        count: newBosses.length,
        bosses: newBosses.map((boss) => ({ charId: boss.charId, mapId: boss.mapId, name: boss.name })),
      });
    }

    if (questPatch) {
      onProgress?.({
        phase: 'REWRITING',
        label: `Đang áp ${questPatch.edits.length} cell + ${questPatch.rewards.filter((reward) => reward.enabled).length} reward nhiệm vụ...`,
        current: 4,
        total: 5,
      });
      const questCandidate = await buildQuestPatchCandidate(
        session,
        questPatch.edits,
        currentBlob,
        questPatch.rewards
      );
      currentBlob = questCandidate.blob;
      appliedOperations.push({
        kind: questPatch.kind,
        editCount: questPatch.edits.length,
        rewardCount: questPatch.rewards.filter((reward) => reward.enabled).length,
        metrics: questCandidate.metrics,
      });
    }

    if (multiplayer) {
      onProgress?.({
        phase: 'PACKING',
        label: 'Đang áp Multiplayer Lite lên chính JAR đã chứa các chỉnh sửa trước...',
        current: 4,
        total: 5,
      });

      const candidate = await buildMultiplayerCandidate(
        session,
        multiplayer.config as MultiplayerLiteConfig,
        currentBlob
      );
      currentBlob = candidate.blob;
      appliedOperations.push({
        kind: multiplayer.kind,
        config: { ...multiplayer.config },
      });
    }

    onProgress?.({
      phase: 'VERIFYING',
      label: 'Đang mở lại JAR hợp nhất và kiểm tra manifest / ZIP...',
      current: 5,
      total: 5,
    });

    const reopened = await JSZip.loadAsync(await currentBlob.arrayBuffer());
    const originalManifest =
      (await session.zip.file('META-INF/MANIFEST.MF')?.async('string')) ?? '';
    const finalManifest =
      (await reopened.file('META-INF/MANIFEST.MF')?.async('string')) ?? '';

    if (originalManifest !== finalManifest) {
      return {
        status: 'FAILED',
        blockers: [],
        summary,
        errorMessage: 'Unified Patch Workspace làm thay đổi MANIFEST ngoài dự kiến.',
      };
    }

    for (const operation of newItems) {
      const classPath = `${operation.sourceClass}.class`;
      if (!reopened.file(classPath)) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `JAR hợp nhất bị thiếu ${classPath} sau operation Item #${operation.values[0]}.`,
        };
      }
    }

    if (newBosses.length > 0) {
      const requiredBossFiles = [BOSS_MANAGER_CLASS_PATH, BOSS_GATE_HELPER_PATH, BOSS_GATE_CONFIG_PATH];
      const missingBossFiles = requiredBossFiles.filter((path) => !reopened.file(path));
      if (missingBossFiles.length > 0) {
        return { status: 'FAILED', blockers: [], summary, errorMessage: `JAR hợp nhất thiếu Boss Creator asset: ${missingBossFiles.join(', ')}.` };
      }
    }

    if (questPatch) {
      const requiredQuestClasses = ['a/a/a/Z.class', 'a/a/a/ab.class'];
      const missingQuestClasses = requiredQuestClasses.filter((path) => !reopened.file(path));
      if (missingQuestClasses.length > 0) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `JAR hợp nhất thiếu class nhiệm vụ: ${missingQuestClasses.join(', ')}.`,
        };
      }
    }

    if (multiplayer) {
      const required = [
        'a/ai.class',
        'patch/MultiplayerLite.class',
        'patch/MultiplayerLite$RemotePlayer.class',
        'patch/MultiplayerLite$1.class',
        'multiplayer.cfg',
      ];
      const missing = required.filter((path) => !reopened.file(path));
      if (missing.length > 0) {
        return {
          status: 'FAILED',
          blockers: [],
          summary,
          errorMessage: `JAR hợp nhất thiếu asset Multiplayer: ${missing.join(', ')}.`,
        };
      }
    }

    const candidate: CandidateOutputJar = {
      blob: currentBlob,
      fileName: outputName(session.jarInfo.fileName),
      status: 'VALIDATED',
      validatedAt: Date.now(),
      expectedModifiedCount:
        (draftResult.candidate?.expectedModifiedCount ?? 0) + operations.length,
      metrics: {
        source: 'UNIFIED_WORKSPACE',
        draftFingerprint: getDraftStateFingerprint(session),
        workspaceFingerprint: getPatchWorkspaceFingerprint(session),
        summary,
        operations: appliedOperations,
        draftBase:
          draftResult.status === 'VALIDATED'
            ? 'DRAFT_TEST'
            : 'ORIGINAL',
        newItemCount: newItems.length,
        newBossCount: newBosses.length,
        questEditCount: questPatch?.edits.length ?? 0,
        questRewardCount: questPatch?.rewards.filter((reward) => reward.enabled).length ?? 0,
        multiplayerLite: Boolean(multiplayer),
        config: multiplayer ? { ...multiplayer.config } : undefined,
      },
    };

    onProgress?.({
      phase: 'DONE',
      label: `VALIDATED: ${operations.length} operation + toàn bộ draft đã được hợp nhất.`,
      current: 5,
      total: 5,
    });

    return {
      status: 'VALIDATED',
      candidate,
      blockers: [],
      summary,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      blockers: [],
      summary: activeSummary,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

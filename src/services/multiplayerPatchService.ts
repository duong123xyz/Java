import JSZip from 'jszip';
import { CandidateOutputJar, LoadedJarSession } from '../types/jar';

export interface MultiplayerLiteConfig {
  enabled: boolean;
  host: string;
  port: number;
  name: string;
}

export interface MultiplayerAuditCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface MultiplayerCompatibilityAudit {
  compatible: boolean;
  checks: MultiplayerAuditCheck[];
  hookCount: number;
}

interface CpEntry {
  tag: number;
  utf8?: string;
  nameIndex?: number;
  classIndex?: number;
  nameAndTypeIndex?: number;
  descriptorIndex?: number;
}

interface ParsedClass {
  cpCount: number;
  cpEnd: number;
  cp: Array<CpEntry | null>;
  utf8: Map<number, string>;
  methods: Array<{
    name: string;
    descriptor: string;
    codeStart: number;
    codeLength: number;
  }>;
}

const REQUIRED_ENTRIES = [
  'a/ai.class',
  'a/L.class',
  'a/Q.class',
  'a/c.class',
  'a/am.class',
  'a/ba.class',
  'a/bP.class',
];

const PAINT_NAME = 'paint';
const PAINT_DESC = '(Ljavax/microedition/lcdui/Graphics;)V';
const ORIGINAL_OWNER = 'a/L';
const ORIGINAL_METHOD = 'A';
const ORIGINAL_DESC = '(La/Q;)V';
const HOOK_OWNER = 'patch/MultiplayerLite';
const HOOK_METHOD = 'afterWorld';
const HOOK_DESC = '(La/Q;)V';

function readU2(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
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

function encodeU2(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function encodeUtf8(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > 65535) throw new Error('UTF8 constant quá dài.');
  return new Uint8Array([1, ...encodeU2(encoded.length), ...encoded]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function parseClass(bytes: Uint8Array): ParsedClass {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0xca ||
    bytes[1] !== 0xfe ||
    bytes[2] !== 0xba ||
    bytes[3] !== 0xbe
  ) {
    throw new Error('a/ai.class không có magic CAFEBABE.');
  }

  const cpCount = readU2(bytes, 8);
  const cp: Array<CpEntry | null> = new Array(cpCount).fill(null);
  const utf8 = new Map<number, string>();
  let offset = 10;

  for (let index = 1; index < cpCount; index++) {
    if (offset >= bytes.length) throw new Error('Constant Pool bị cắt.');
    const tag = bytes[offset++];

    if (tag === 1) {
      const length = readU2(bytes, offset);
      offset += 2;
      const raw = bytes.slice(offset, offset + length);
      offset += length;
      const value = new TextDecoder('utf-8').decode(raw);
      cp[index] = { tag, utf8: value };
      utf8.set(index, value);
    } else if (tag === 3 || tag === 4) {
      cp[index] = { tag };
      offset += 4;
    } else if (tag === 5 || tag === 6) {
      cp[index] = { tag };
      offset += 8;
      index++;
    } else if (tag === 7) {
      const nameIndex = readU2(bytes, offset);
      cp[index] = { tag, nameIndex };
      offset += 2;
    } else if (tag === 8 || tag === 16 || tag === 19 || tag === 20) {
      cp[index] = { tag };
      offset += 2;
    } else if (tag === 9 || tag === 10 || tag === 11) {
      const classIndex = readU2(bytes, offset);
      const nameAndTypeIndex = readU2(bytes, offset + 2);
      cp[index] = { tag, classIndex, nameAndTypeIndex };
      offset += 4;
    } else if (tag === 12) {
      const nameIndex = readU2(bytes, offset);
      const descriptorIndex = readU2(bytes, offset + 2);
      cp[index] = { tag, nameIndex, descriptorIndex };
      offset += 4;
    } else if (tag === 15) {
      cp[index] = { tag };
      offset += 3;
    } else if (tag === 17 || tag === 18) {
      cp[index] = { tag };
      offset += 4;
    } else {
      throw new Error(`Constant Pool tag ${tag} chưa được parser hỗ trợ.`);
    }
  }

  const cpEnd = offset;
  offset += 6; // access_flags + this_class + super_class
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
  const methods: ParsedClass['methods'] = [];

  for (let i = 0; i < methodCount; i++) {
    offset += 2; // access
    const nameIndex = readU2(bytes, offset);
    offset += 2;
    const descriptorIndex = readU2(bytes, offset);
    offset += 2;
    const attributeCount = readU2(bytes, offset);
    offset += 2;

    const methodName = utf8.get(nameIndex) ?? `#${nameIndex}`;
    const descriptor = utf8.get(descriptorIndex) ?? `#${descriptorIndex}`;
    let codeStart = -1;
    let codeLength = 0;

    for (let a = 0; a < attributeCount; a++) {
      const attributeNameIndex = readU2(bytes, offset);
      offset += 2;
      const attributeLength = readU4(bytes, offset);
      offset += 4;
      const dataStart = offset;

      if (utf8.get(attributeNameIndex) === 'Code') {
        codeLength = readU4(bytes, dataStart + 4);
        codeStart = dataStart + 8;
      }

      offset = dataStart + attributeLength;
    }

    methods.push({
      name: methodName,
      descriptor,
      codeStart,
      codeLength,
    });
  }

  return { cpCount, cpEnd, cp, utf8, methods };
}

function resolveMethodRef(
  parsed: ParsedClass,
  owner: string,
  name: string,
  descriptor: string
): number[] {
  const result: number[] = [];

  for (let index = 1; index < parsed.cp.length; index++) {
    const entry = parsed.cp[index];
    if (!entry || entry.tag !== 10 || !entry.classIndex || !entry.nameAndTypeIndex) continue;

    const classEntry = parsed.cp[entry.classIndex];
    const ntEntry = parsed.cp[entry.nameAndTypeIndex];
    if (!classEntry || classEntry.tag !== 7 || !classEntry.nameIndex) continue;
    if (!ntEntry || ntEntry.tag !== 12 || !ntEntry.nameIndex || !ntEntry.descriptorIndex) continue;

    const resolvedOwner = parsed.utf8.get(classEntry.nameIndex);
    const resolvedName = parsed.utf8.get(ntEntry.nameIndex);
    const resolvedDescriptor = parsed.utf8.get(ntEntry.descriptorIndex);

    if (
      resolvedOwner === owner &&
      resolvedName === name &&
      resolvedDescriptor === descriptor
    ) {
      result.push(index);
    }
  }

  return result;
}

function findInvokestaticCalls(
  bytes: Uint8Array,
  parsed: ParsedClass,
  methodRefIndex: number
): number[] {
  const paint = parsed.methods.find(
    (method) => method.name === PAINT_NAME && method.descriptor === PAINT_DESC
  );
  if (!paint || paint.codeStart < 0 || paint.codeLength <= 0) {
    throw new Error(`Không tìm thấy ${PAINT_NAME}${PAINT_DESC} trong a/ai.class.`);
  }

  const calls: number[] = [];
  const end = paint.codeStart + paint.codeLength;
  const hi = (methodRefIndex >>> 8) & 0xff;
  const lo = methodRefIndex & 0xff;

  for (let offset = paint.codeStart; offset + 2 < end; offset++) {
    if (bytes[offset] === 0xb8 && bytes[offset + 1] === hi && bytes[offset + 2] === lo) {
      calls.push(offset);
    }
  }

  return calls;
}

function appendHookMethodRef(
  original: Uint8Array,
  parsed: ParsedClass
): {
  bytes: Uint8Array;
  methodRefIndex: number;
  appendedLength: number;
} {
  const classNameUtf8Index = parsed.cpCount;
  const classIndex = parsed.cpCount + 1;
  const methodNameUtf8Index = parsed.cpCount + 2;
  const descriptorUtf8Index = parsed.cpCount + 3;
  const nameAndTypeIndex = parsed.cpCount + 4;
  const methodRefIndex = parsed.cpCount + 5;
  const newCpCount = parsed.cpCount + 6;

  if (newCpCount > 65535) {
    throw new Error('Constant Pool đã đầy, không thể chèn Multiplayer hook.');
  }

  const classNameUtf8 = encodeUtf8(HOOK_OWNER);
  const classEntry = new Uint8Array([7, ...encodeU2(classNameUtf8Index)]);
  const methodNameUtf8 = encodeUtf8(HOOK_METHOD);
  const descriptorUtf8 = encodeUtf8(HOOK_DESC);
  const ntEntry = new Uint8Array([
    12,
    ...encodeU2(methodNameUtf8Index),
    ...encodeU2(descriptorUtf8Index),
  ]);
  const methodEntry = new Uint8Array([
    10,
    ...encodeU2(classIndex),
    ...encodeU2(nameAndTypeIndex),
  ]);

  const appended = concatBytes([
    classNameUtf8,
    classEntry,
    methodNameUtf8,
    descriptorUtf8,
    ntEntry,
    methodEntry,
  ]);

  const prefix = original.slice(0, 8);
  const newCount = new Uint8Array(2);
  writeU2(newCount, 0, newCpCount);
  const cpBytes = original.slice(10, parsed.cpEnd);
  const tail = original.slice(parsed.cpEnd);

  return {
    bytes: concatBytes([prefix, newCount, cpBytes, appended, tail]),
    methodRefIndex,
    appendedLength: appended.length,
  };
}

export function patchMultiplayerHook(originalBuffer: ArrayBuffer): {
  bytes: ArrayBuffer;
  hookCount: number;
  alreadyPatched: boolean;
} {
  const original = new Uint8Array(originalBuffer);
  const parsed = parseClass(original);

  const existingHookRefs = resolveMethodRef(
    parsed,
    HOOK_OWNER,
    HOOK_METHOD,
    HOOK_DESC
  );
  for (const hookRef of existingHookRefs) {
    const calls = findInvokestaticCalls(original, parsed, hookRef);
    if (calls.length > 0) {
      return {
        bytes: original.slice().buffer,
        hookCount: calls.length,
        alreadyPatched: true,
      };
    }
  }

  const originalRefs = resolveMethodRef(
    parsed,
    ORIGINAL_OWNER,
    ORIGINAL_METHOD,
    ORIGINAL_DESC
  );
  if (originalRefs.length !== 1) {
    throw new Error(
      `Cần đúng 1 Methodref ${ORIGINAL_OWNER}.${ORIGINAL_METHOD}${ORIGINAL_DESC}, nhận ${originalRefs.length}.`
    );
  }

  const calls = findInvokestaticCalls(original, parsed, originalRefs[0]);
  if (calls.length !== 1) {
    throw new Error(
      `Cần đúng 1 hook site trong ai.paint, nhận ${calls.length}. Không patch để tránh phá render.`
    );
  }

  const appended = appendHookMethodRef(original, parsed);
  const patched = appended.bytes;
  const newCallOffset = calls[0] + appended.appendedLength;

  if (patched[newCallOffset] !== 0xb8) {
    throw new Error('Hook offset bị lệch sau khi mở rộng Constant Pool.');
  }

  writeU2(patched, newCallOffset + 1, appended.methodRefIndex);

  const verified = parseClass(patched);
  const hookRefs = resolveMethodRef(verified, HOOK_OWNER, HOOK_METHOD, HOOK_DESC);
  if (hookRefs.length !== 1) {
    throw new Error(`Verify hook Methodref thất bại: nhận ${hookRefs.length}.`);
  }
  const hookCalls = findInvokestaticCalls(patched, verified, hookRefs[0]);
  if (hookCalls.length !== 1) {
    throw new Error(`Verify invokestatic Multiplayer hook thất bại: ${hookCalls.length}.`);
  }

  return {
    bytes: patched.buffer.slice(
      patched.byteOffset,
      patched.byteOffset + patched.byteLength
    ),
    hookCount: hookCalls.length,
    alreadyPatched: false,
  };
}

export async function auditMultiplayerCompatibility(
  session: LoadedJarSession
): Promise<MultiplayerCompatibilityAudit> {
  const checks: MultiplayerAuditCheck[] = [];

  for (const path of REQUIRED_ENTRIES) {
    checks.push({
      label: path,
      ok: Boolean(session.zip.file(path)),
      detail: session.zip.file(path) ? 'Có trong JAR' : 'Thiếu class cần cho Multiplayer Lite',
    });
  }

  let hookCount = 0;
  const aiEntry = session.zip.file('a/ai.class');
  if (aiEntry) {
    try {
      const bytes = await aiEntry.async('arraybuffer');
      const parsed = parseClass(new Uint8Array(bytes));
      const existingHookRefs = resolveMethodRef(parsed, HOOK_OWNER, HOOK_METHOD, HOOK_DESC);
      if (existingHookRefs.length > 0) {
        hookCount = existingHookRefs.reduce(
          (sum, ref) => sum + findInvokestaticCalls(new Uint8Array(bytes), parsed, ref).length,
          0
        );
      } else {
        const refs = resolveMethodRef(parsed, ORIGINAL_OWNER, ORIGINAL_METHOD, ORIGINAL_DESC);
        hookCount = refs.length === 1
          ? findInvokestaticCalls(new Uint8Array(bytes), parsed, refs[0]).length
          : 0;
      }
      checks.push({
        label: 'Hook render ai.paint',
        ok: hookCount === 1,
        detail:
          hookCount === 1
            ? 'Xác định đúng 1 call site sau world render.'
            : `Không an toàn: tìm thấy ${hookCount} call site.`,
      });
    } catch (error) {
      checks.push({
        label: 'Hook render ai.paint',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  checks.push({
    label: 'J2ME Socket API',
    ok: Boolean(session.zip.file('a/aC.class')),
    detail: session.zip.file('a/aC.class')
      ? 'JAR có lớp SocketConnection/Connector gốc.'
      : 'Không thấy wrapper socket a/aC.class.',
  });

  return {
    compatible: checks.every((check) => check.ok),
    checks,
    hookCount,
  };
}

function validateConfig(config: MultiplayerLiteConfig): MultiplayerLiteConfig {
  const host = String(config.host ?? '').trim();
  const port = Math.round(Number(config.port));
  const name = String(config.name ?? '').trim();

  if (!host || host.length > 255 || /[\r\n=]/.test(host)) {
    throw new Error('Host multiplayer không hợp lệ.');
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('Port multiplayer phải nằm trong 1..65535.');
  }
  if (name.length > 40 || /[\r\n=]/.test(name)) {
    throw new Error('Tên multiplayer tối đa 40 ký tự và không được có xuống dòng/dấu =.');
  }

  return {
    enabled: Boolean(config.enabled),
    host,
    port,
    name,
  };
}

function configText(config: MultiplayerLiteConfig): string {
  return [
    'version=1',
    `enabled=${config.enabled ? 1 : 0}`,
    `host=${config.host}`,
    `port=${config.port}`,
    `name=${config.name}`,
    '',
  ].join('\n');
}

function outputName(input: string): string {
  const safe = input || 'game.jar';
  return safe.toLowerCase().endsWith('.jar')
    ? `${safe.slice(0, -4)}_multiplayer_lite.jar`
    : `${safe}_multiplayer_lite.jar`;
}

const CLIENT_CLASS_ASSETS = [
  'MultiplayerLite.class',
  'MultiplayerLite$RemotePlayer.class',
  'MultiplayerLite$1.class',
];

async function fetchClientClasses(): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();

  for (const fileName of CLIENT_CLASS_ASSETS) {
    const path = `/multiplayer/${fileName}`;
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Không tải được ${path} (HTTP ${response.status}).`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.length < 16 ||
      bytes[0] !== 0xca ||
      bytes[1] !== 0xfe ||
      bytes[2] !== 0xba ||
      bytes[3] !== 0xbe
    ) {
      throw new Error(`${fileName} asset không hợp lệ.`);
    }

    result.set(fileName, bytes);
  }

  return result;
}

export async function buildMultiplayerCandidate(
  session: LoadedJarSession,
  inputConfig: MultiplayerLiteConfig
): Promise<CandidateOutputJar> {
  const config = validateConfig(inputConfig);
  const audit = await auditMultiplayerCompatibility(session);
  if (!audit.compatible) {
    const failed = audit.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.label}: ${check.detail}`)
      .join('\n');
    throw new Error(`JAR không tương thích Multiplayer Lite:\n${failed}`);
  }

  const clientClasses = await fetchClientClasses();
  const originalBytes = await session.originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(originalBytes.slice(0));

  const aiEntry = zip.file('a/ai.class');
  if (!aiEntry) throw new Error('Không tìm thấy a/ai.class.');

  const aiBytes = await aiEntry.async('arraybuffer');
  const hook = patchMultiplayerHook(aiBytes);

  zip.file('a/ai.class', new Uint8Array(hook.bytes));
  for (const [fileName, bytes] of clientClasses) {
    zip.file(`patch/${fileName}`, bytes);
  }
  zip.file('multiplayer.cfg', configText(config));

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const reopened = await JSZip.loadAsync(await blob.arrayBuffer());
  const patchedAi = reopened.file('a/ai.class');
  const cfg = reopened.file('multiplayer.cfg');
  const missingClientClasses = CLIENT_CLASS_ASSETS.filter(
    (fileName) => !reopened.file(`patch/${fileName}`)
  );

  if (!patchedAi || !cfg || missingClientClasses.length > 0) {
    throw new Error(
      `JAR multiplayer sau build bị thiếu hook/client/config.` +
      (missingClientClasses.length
        ? ` Thiếu: ${missingClientClasses.join(', ')}`
        : '')
    );
  }

  const verifyHook = patchMultiplayerHook(await patchedAi.async('arraybuffer'));
  if (!verifyHook.alreadyPatched || verifyHook.hookCount !== 1) {
    throw new Error('JAR multiplayer không verify được hook ai.paint.');
  }

  const verifyConfig = await cfg.async('string');
  if (
    !verifyConfig.includes(`host=${config.host}`) ||
    !verifyConfig.includes(`port=${config.port}`)
  ) {
    throw new Error('multiplayer.cfg sau build không khớp cấu hình.');
  }

  return {
    blob,
    fileName: outputName(session.jarInfo.fileName),
    status: 'VALIDATED',
    validatedAt: Date.now(),
    expectedModifiedCount: 1,
    metrics: {
      source: 'MULTIPLAYER_LITE',
      multiplayerLite: true,
      protocol: 1,
      config: { ...config },
      hook: 'a/ai.paint(Graphics) -> patch/MultiplayerLite.afterWorld(a/Q)',
      hookCount: 1,
      features: [
        'TCP side-channel',
        'map',
        'x/y',
        'direction',
        'player name',
        'remote placeholder render',
        'admin chat bubble',
      ],
      limitations: [
        'remote sprite chưa dùng body/head/leg thật',
        'chưa sync combat',
        'chưa sync mob/boss/drop',
      ],
    },
  };
}

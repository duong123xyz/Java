import { LoadedJarSession } from '../types/jar';

const SMALL_IMAGE_INDEX_PATH = 'x1/smallimage.idx';
const SMALL_IMAGE_MAGIC = 0x53495032; // "SIP2"
const SMALL_IMAGE_HEADER_SIZE = 10;
const SMALL_IMAGE_RECORD_SIZE = 12;

export interface SmallImageLocation {
  id: number;
  pack: number;
  offset: number;
  length: number;
  packPath: string;
}

export interface SmallImageResult {
  blob: Blob;
  location: SmallImageLocation;
}

const indexCache = new WeakMap<LoadedJarSession, Promise<Map<number, SmallImageLocation>>>();
const packCache = new WeakMap<LoadedJarSession, Map<string, Promise<Uint8Array>>>();

function getZipEntry(session: LoadedJarSession, path: string) {
  return session.zip?.file(path) || session.entries.find((entry) => entry.path === path)?.zipEntry || null;
}

async function readEntryBytes(session: LoadedJarSession, path: string): Promise<Uint8Array> {
  const entry = getZipEntry(session, path);
  if (!entry) {
    throw new Error(`Không tìm thấy '${path}' trong JAR.`);
  }
  return entry.async('uint8array');
}

async function loadSmallImageIndex(
  session: LoadedJarSession
): Promise<Map<number, SmallImageLocation>> {
  const cached = indexCache.get(session);
  if (cached) return cached;

  const promise = (async () => {
    const bytes = await readEntryBytes(session, SMALL_IMAGE_INDEX_PATH);

    if (bytes.byteLength < SMALL_IMAGE_HEADER_SIZE) {
      throw new Error('smallimage.idx quá ngắn, không đủ header SIP2.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, false);
    if (magic !== SMALL_IMAGE_MAGIC) {
      throw new Error(
        `smallimage.idx sai magic: 0x${magic.toString(16).toUpperCase()} (cần SIP2 / 0x53495032).`
      );
    }

    const count = view.getUint16(4, false);
    const expectedLength = SMALL_IMAGE_HEADER_SIZE + count * SMALL_IMAGE_RECORD_SIZE;
    if (bytes.byteLength < expectedLength) {
      throw new Error(
        `smallimage.idx bị thiếu dữ liệu: ${bytes.byteLength} bytes, cần ít nhất ${expectedLength} bytes.`
      );
    }

    const result = new Map<number, SmallImageLocation>();
    let cursor = SMALL_IMAGE_HEADER_SIZE;

    for (let i = 0; i < count; i++) {
      const id = view.getUint16(cursor, false);
      const pack = view.getUint16(cursor + 2, false);
      const offset = view.getUint32(cursor + 4, false);
      const length = view.getUint32(cursor + 8, false);
      const packPath = `x1/smallimage-${pack}.pack`;

      result.set(id, {
        id,
        pack,
        offset,
        length,
        packPath,
      });

      cursor += SMALL_IMAGE_RECORD_SIZE;
    }

    return result;
  })();

  indexCache.set(session, promise);
  return promise;
}

async function readPackBytes(session: LoadedJarSession, packPath: string): Promise<Uint8Array> {
  let sessionPackCache = packCache.get(session);
  if (!sessionPackCache) {
    sessionPackCache = new Map<string, Promise<Uint8Array>>();
    packCache.set(session, sessionPackCache);
  }

  const cached = sessionPackCache.get(packPath);
  if (cached) return cached;

  const promise = readEntryBytes(session, packPath);
  sessionPackCache.set(packPath, promise);
  return promise;
}

function validatePng(bytes: Uint8Array, id: number): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length < signature.length ||
    signature.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error(`SmallImage #${id} không chứa chữ ký PNG hợp lệ.`);
  }
}

export async function getSmallImageLocation(
  session: LoadedJarSession,
  imageId: number
): Promise<SmallImageLocation | null> {
  if (!Number.isInteger(imageId) || imageId < 0 || imageId > 0xffff) {
    return null;
  }

  const index = await loadSmallImageIndex(session);
  return index.get(imageId) ?? null;
}

export async function loadSmallImage(
  session: LoadedJarSession,
  imageId: number
): Promise<SmallImageResult> {
  const location = await getSmallImageLocation(session, imageId);
  if (!location) {
    throw new Error(`Không có SmallImage #${imageId} trong x1/smallimage.idx.`);
  }

  const packBytes = await readPackBytes(session, location.packPath);
  const end = location.offset + location.length;

  if (location.offset > packBytes.byteLength || end > packBytes.byteLength) {
    throw new Error(
      `SmallImage #${imageId} vượt phạm vi ${location.packPath}: ` +
        `offset=${location.offset}, length=${location.length}, pack=${packBytes.byteLength}.`
    );
  }

  const imageBytes = packBytes.slice(location.offset, end);
  validatePng(imageBytes, imageId);

  return {
    blob: new Blob([imageBytes], { type: 'image/png' }),
    location,
  };
}

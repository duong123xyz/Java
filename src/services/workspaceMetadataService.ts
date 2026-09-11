import { LoadedJarSession } from '../types/jar';

export interface VersionHistoryEntry {
  id: string;
  version: string;
  action: 'EXPORT' | 'EDIT' | 'MANUAL';
  description: string;
  timestamp: number;
  fileName: string;
}

export type VersionIncrementStrategy = 'patch' | 'minor' | 'revision';

export interface WorkspaceMetadata {
  /** Tên file xuất cơ sở (không đuôi .jar) */
  exportFileName: string;
  /** Tác giả mod / MIDlet-Vendor */
  author: string;
  /** Tên hiển thị game / MIDlet-Name */
  gameName: string;
  /** Tên phiên bản hiện tại (ví dụ: 1.0.0, v1.0.1, mod-b2) */
  version: string;
  /** Mẫu đặt tên file xuất (e.g. "{name}_v{version}_{author}.jar") */
  namingPattern: string;
  /** Tự động tăng phiên bản khi tải file về (export) */
  autoIncrementOnDownload: boolean;
  /** Tự động tăng phiên bản khi sửa dữ liệu (drafts / workspace) */
  autoIncrementOnEdit: boolean;
  /** Chiến lược tăng phiên bản mặc định */
  incrementStrategy: VersionIncrementStrategy;
  /** Lịch sử các phiên bản đã tải hoặc sửa đổi */
  history: VersionHistoryEntry[];
}

const metadataStore = new WeakMap<LoadedJarSession, WorkspaceMetadata>();

/**
 * Tạo metadata mặc định dựa vào session jarInfo
 */
export function createDefaultMetadata(session: LoadedJarSession): WorkspaceMetadata {
  const originalFileName = session.jarInfo.fileName || 'game.jar';
  const baseName = originalFileName.replace(/\.jar$/i, '').replace(/[\s\-_]+workspace$/i, '') || 'game';
  const vendor = session.jarInfo.manifest.midletVendor;
  const initialAuthor = (!vendor || vendor === 'N/A' || vendor.trim() === '') ? 'NRO Modder' : vendor.trim();
  const name = session.jarInfo.manifest.midletName;
  const initialGameName = (!name || name === 'N/A' || name.trim() === '') ? baseName : name.trim();
  const ver = session.jarInfo.manifest.midletVersion;
  const initialVersion = (!ver || ver === 'N/A' || ver.trim() === '') ? '1.0.0' : ver.trim();

  return {
    exportFileName: baseName,
    author: initialAuthor,
    gameName: initialGameName,
    version: initialVersion,
    namingPattern: '{name}_v{version}_{author}.jar',
    autoIncrementOnDownload: true,
    autoIncrementOnEdit: false,
    incrementStrategy: 'patch',
    history: [],
  };
}

export function getWorkspaceMetadata(session: LoadedJarSession): WorkspaceMetadata {
  let meta = metadataStore.get(session);
  if (!meta) {
    meta = createDefaultMetadata(session);
    metadataStore.set(session, meta);
  }
  return meta;
}

export function setWorkspaceMetadata(
  session: LoadedJarSession,
  updater: Partial<WorkspaceMetadata> | ((prev: WorkspaceMetadata) => WorkspaceMetadata)
): WorkspaceMetadata {
  const current = getWorkspaceMetadata(session);
  const updated = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
  metadataStore.set(session, updated);
  return updated;
}

export function exportWorkspaceMetadata(session: LoadedJarSession): WorkspaceMetadata {
  return { ...getWorkspaceMetadata(session) };
}

export function importWorkspaceMetadata(session: LoadedJarSession, raw: Partial<WorkspaceMetadata>): void {
  const base = createDefaultMetadata(session);
  const safe: WorkspaceMetadata = {
    exportFileName: String(raw.exportFileName || base.exportFileName).trim() || base.exportFileName,
    author: String(raw.author || base.author).trim() || base.author,
    gameName: String(raw.gameName || base.gameName).trim() || base.gameName,
    version: String(raw.version || base.version).trim() || base.version,
    namingPattern: String(raw.namingPattern || base.namingPattern).trim() || base.namingPattern,
    autoIncrementOnDownload: raw.autoIncrementOnDownload !== false,
    autoIncrementOnEdit: Boolean(raw.autoIncrementOnEdit),
    incrementStrategy: (raw.incrementStrategy === 'minor' || raw.incrementStrategy === 'revision') ? raw.incrementStrategy : 'patch',
    history: Array.isArray(raw.history) ? raw.history.slice(-50) : [],
  };
  metadataStore.set(session, safe);
}

/**
 * Tự động tăng phiên bản theo các chiến lược phổ biến:
 * - 'patch': 1.0.0 -> 1.0.1, v1.2 -> v1.2.1, 1.4.9 -> 1.4.10
 * - 'minor': 1.0.0 -> 1.1.0, v1.2 -> v1.3.0
 * - 'revision': rev1 -> rev2, 1.0.0 -> 1.0.0.1, b1 -> b2
 */
export function bumpVersionString(
  currentVersion: string,
  strategy: VersionIncrementStrategy = 'patch'
): string {
  const raw = currentVersion.trim();
  if (!raw) return '1.0.1';

  const hasVPrefix = /^v/i.test(raw);
  const prefix = hasVPrefix ? raw.charAt(0) : '';
  const numPart = hasVPrefix ? raw.slice(1).trim() : raw;

  // Trường hợp chuẩn semver: X.Y.Z hoặc X.Y
  const semverMatch = numPart.match(/^(\d+)\.(\d+)(?:\.(\d+))?(.*)$/);
  if (semverMatch) {
    const major = parseInt(semverMatch[1], 10);
    const minor = parseInt(semverMatch[2], 10);
    const patch = semverMatch[3] !== undefined ? parseInt(semverMatch[3], 10) : 0;
    const suffix = semverMatch[4] || '';

    if (strategy === 'minor') {
      return `${prefix}${major}.${minor + 1}.0`;
    }
    if (strategy === 'revision') {
      if (semverMatch[3] !== undefined) {
        return `${prefix}${major}.${minor}.${patch}.1`;
      }
      return `${prefix}${major}.${minor}.0.1`;
    }
    // patch
    const nextPatch = semverMatch[3] !== undefined ? patch + 1 : 1;
    return `${prefix}${major}.${minor}.${nextPatch}`;
  }

  // Trường hợp kết thúc bằng số: e.g. "rev1" -> "rev2", "build-09" -> "build-10"
  const trailingNumMatch = raw.match(/^(.*?)(\d+)$/);
  if (trailingNumMatch) {
    const lead = trailingNumMatch[1];
    const digits = trailingNumMatch[2];
    const nextNum = (parseInt(digits, 10) + 1).toString().padStart(digits.length, '0');
    return `${lead}${nextNum}`;
  }

  // Nếu không có số, thêm đuôi phiên bản
  if (strategy === 'revision') return `${raw}-rev1`;
  if (strategy === 'minor') return `${raw}-1.1.0`;
  return `${raw}-1.0.1`;
}

/**
 * Xử lý chuỗi tên file an toàn (bỏ ký tự đặc biệt nguy hiểm)
 */
function sanitizeFileNamePart(val: string): string {
  return String(val || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_');
}

/**
 * Tính toán tên file JAR xuất ra theo pattern và metadata
 */
export function resolveExportFileName(
  metadata: WorkspaceMetadata,
  extension: string = '.jar'
): string {
  const cleanName = sanitizeFileNamePart(metadata.exportFileName) || 'game';
  const cleanAuthor = sanitizeFileNamePart(metadata.author) || 'Author';
  const cleanVersion = sanitizeFileNamePart(metadata.version).replace(/^v_/i, 'v') || '1.0.0';
  const cleanExt = extension.startsWith('.') ? extension : `.${extension}`;

  let pattern = metadata.namingPattern?.trim() || '{name}_v{version}_{author}.jar';
  // Nếu pattern không có .jar ở cuối, thêm vào
  if (!pattern.toLowerCase().endsWith('.jar')) {
    pattern = `${pattern}.jar`;
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const revStr = `r${(metadata.history?.length || 0) + 1}`;

  let result = pattern
    .replace(/\{name\}/gi, cleanName)
    .replace(/\{author\}/gi, cleanAuthor)
    .replace(/\{version\}/gi, cleanVersion)
    .replace(/\{timestamp\}/gi, dateStr)
    .replace(/\{rev\}/gi, revStr);

  result = sanitizeFileNamePart(result.replace(/\.jar$/i, '')) + cleanExt;
  return result;
}

/**
 * Ghi nhận một mục vào lịch sử phiên bản
 */
export function recordVersionHistory(
  session: LoadedJarSession,
  entry: Omit<VersionHistoryEntry, 'id' | 'timestamp'>
): VersionHistoryEntry {
  const meta = getWorkspaceMetadata(session);
  const fullEntry: VersionHistoryEntry = {
    id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...entry,
  };

  meta.history = [fullEntry, ...(meta.history || [])].slice(0, 50);
  return fullEntry;
}

let lastEditBumpTimestamp = 0;

/**
 * Tăng phiên bản cho workspace session và ghi nhận thay đổi
 */
export function bumpSessionVersion(
  session: LoadedJarSession,
  strategy?: VersionIncrementStrategy,
  reason: 'EXPORT' | 'EDIT' | 'MANUAL' = 'MANUAL'
): { oldVersion: string; newVersion: string } {
  const meta = getWorkspaceMetadata(session);
  const oldVersion = meta.version;

  // Throttle automatic bump on EDIT to avoid rapid bumps while typing continuously
  if (reason === 'EDIT') {
    const now = Date.now();
    if (now - lastEditBumpTimestamp < 2500) {
      return { oldVersion, newVersion: oldVersion };
    }
    lastEditBumpTimestamp = now;
  }

  const useStrategy = strategy || meta.incrementStrategy || 'patch';
  const newVersion = bumpVersionString(oldVersion, useStrategy);

  meta.version = newVersion;
  recordVersionHistory(session, {
    version: newVersion,
    action: reason,
    description: reason === 'EXPORT'
      ? `Tự động tăng phiên bản sau khi tải file (từ ${oldVersion} lên ${newVersion})`
      : reason === 'EDIT'
      ? `Tự động tăng phiên bản khi sửa đổi nội dung (từ ${oldVersion} lên ${newVersion})`
      : `Tăng phiên bản thủ công (${useStrategy}: ${oldVersion} -> ${newVersion})`,
    fileName: resolveExportFileName(meta),
  });

  return { oldVersion, newVersion };
}

/**
 * Cập nhật nội dung file META-INF/MANIFEST.MF
 * Giữ nguyên cấu trúc, chỉ ghi đè hoặc bổ sung MIDlet-Name, MIDlet-Vendor, MIDlet-Version
 */
export function updateManifestContent(
  originalRawManifest: string,
  metadata: {
    gameName?: string;
    author?: string;
    version?: string;
  }
): string {
  const crlf = '\r\n';
  // Chuẩn hóa dòng
  const lines = (originalRawManifest || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let foundName = false;
  let foundVendor = false;
  let foundVersion = false;
  let foundMidlet1 = false;

  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Dòng trống
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      newLines.push(line);
      continue;
    }

    const key = line.slice(0, colonIndex).trim();

    if (key.toLowerCase() === 'midlet-name' && metadata.gameName) {
      newLines.push(`MIDlet-Name: ${metadata.gameName}`);
      foundName = true;
    } else if (key.toLowerCase() === 'midlet-vendor' && metadata.author) {
      newLines.push(`MIDlet-Vendor: ${metadata.author}`);
      foundVendor = true;
    } else if (key.toLowerCase() === 'midlet-version' && metadata.version) {
      newLines.push(`MIDlet-Version: ${metadata.version}`);
      foundVersion = true;
    } else if (key.toLowerCase() === 'midlet-1') {
      foundMidlet1 = true;
      if (metadata.gameName) {
        // Cú pháp MIDlet-1: <Name>, <Icon>, <MainClass>
        const val = line.slice(colonIndex + 1).trim();
        const parts = val.split(',');
        if (parts.length >= 3) {
          parts[0] = metadata.gameName;
          newLines.push(`MIDlet-1: ${parts.join(',')}`);
        } else {
          newLines.push(line);
        }
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  // Nếu thiếu header nào thì bổ sung
  if (!foundName && metadata.gameName) {
    newLines.push(`MIDlet-Name: ${metadata.gameName}`);
  }
  if (!foundVendor && metadata.author) {
    newLines.push(`MIDlet-Vendor: ${metadata.author}`);
  }
  if (!foundVersion && metadata.version) {
    newLines.push(`MIDlet-Version: ${metadata.version}`);
  }

  // Đảm bảo kết thúc bằng \r\n
  return newLines.join(crlf) + crlf;
}

import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { getSessionClassInfo } from './patchPlannerService';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';

export interface PartFrameDefinition {
  imageId: number;
  dx: number;
  dy: number;
}

export interface PartDefinition {
  id: number;
  type: number;
  frames: PartFrameDefinition[];
  sourceClass: string;
  sourceRow: number;
}

export interface NpcStandingPartPlacement {
  partId: number;
  role: 'head' | 'body' | 'leg';
  frameIndex: number;
  imageId: number;
  drawX: number;
  drawY: number;
  dx: number;
  dy: number;
  sourceClass: string;
  sourceRow: number;
}

export interface NpcStandingComposition {
  head: NpcStandingPartPlacement;
  body: NpcStandingPartPlacement;
  leg: NpcStandingPartPlacement;
}

const PART_SOURCE_CLASSES = [
  'a/a/a/F',
  'a/a/a/G',
  'a/a/a/H',
  'a/a/a/I',
  'a/a/a/J',
  'a/a/a/K',
  'a/a/a/L',
  'a/a/a/M',
  'a/a/a/N',
  'a/a/a/O',
  'a/a/a/P',
  'a/a/a/Q',
  'a/a/a/R',
  'a/a/a/S',
] as const;

// Trích đúng từ renderer a.bV của client, trạng thái đứng mặc định S=0:
// a/c.a[0][0] = [0, -13, 34]  -> head
// a/c.a[0][1] = [1, -8, 10]   -> leg
// a/c.a[0][2] = [1, -9, 16]   -> body
// Renderer tính Y = baseY - offsetY + partFrame.dy.
const DEFAULT_STANDING_POSE = {
  head: { frameIndex: 0, baseX: -13, baseY: -34 },
  leg: { frameIndex: 1, baseX: -8, baseY: -10 },
  body: { frameIndex: 1, baseX: -9, baseY: -16 },
} as const;

const catalogCache = new WeakMap<LoadedJarSession, Promise<Map<number, PartDefinition>>>();

function parseFrames(encoded: string): PartFrameDefinition[] {
  const frames: PartFrameDefinition[] = [];
  const matcher = /\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(encoded)) !== null) {
    frames.push({
      imageId: Number.parseInt(match[1], 10),
      dx: Number.parseInt(match[2], 10),
      dy: Number.parseInt(match[3], 10),
    });
  }

  return frames;
}

async function readPartTable(
  session: LoadedJarSession,
  sourceClass: string
): Promise<PartDefinition[]> {
  const classInfo: ClassFileInfo | null = await getSessionClassInfo(session, sourceClass);
  if (!classInfo) {
    throw new Error(`Không tìm thấy ${sourceClass}.class khi đọc dữ liệu part.`);
  }

  const clinit = classInfo.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) {
    throw new Error(`Không giải mã được <clinit> của ${sourceClass}.class.`);
  }

  const sourceField = classInfo.fields.find((field) => field.name === 'u');
  if (!sourceField) {
    throw new Error(`Không tìm thấy field u trong ${sourceClass}.class.`);
  }

  const reconstructed = reconstructStringArrayTable(
    sourceClass,
    'u',
    sourceField.descriptor,
    0,
    clinit.code.instructions,
    classInfo.constantPool,
    3
  );

  if (reconstructed.parseError) {
    throw new Error(
      `Không phục dựng được bảng part ${sourceClass}.u: ${reconstructed.parseError}`
    );
  }

  return reconstructed.rows
    .map((row) => {
      const id = Number.parseInt(row.values[0] ?? '', 10);
      const type = Number.parseInt(row.values[1] ?? '', 10);
      const frames = parseFrames(row.values[2] ?? '');

      if (!Number.isInteger(id) || !Number.isInteger(type) || frames.length === 0) {
        return null;
      }

      return {
        id,
        type,
        frames,
        sourceClass,
        sourceRow: row.rowIndex,
      } satisfies PartDefinition;
    })
    .filter((part): part is PartDefinition => part !== null);
}

export async function loadPartCatalog(
  session: LoadedJarSession
): Promise<Map<number, PartDefinition>> {
  const cached = catalogCache.get(session);
  if (cached) return cached;

  const promise = (async () => {
    const result = new Map<number, PartDefinition>();
    const tables = await Promise.all(
      PART_SOURCE_CLASSES.map((sourceClass) => readPartTable(session, sourceClass))
    );

    for (const table of tables) {
      for (const part of table) {
        result.set(part.id, part);
      }
    }

    return result;
  })();

  catalogCache.set(session, promise);
  return promise;
}

function getRequiredFrame(
  part: PartDefinition,
  role: 'head' | 'body' | 'leg',
  frameIndex: number
): PartFrameDefinition {
  const frame = part.frames[frameIndex];
  if (!frame || frame.imageId < 0) {
    throw new Error(
      `Part ${part.id} (${role}) không có frame đứng hợp lệ tại index ${frameIndex}.`
    );
  }
  return frame;
}

export async function resolveNpcStandingComposition(
  session: LoadedJarSession,
  headPartId: number,
  bodyPartId: number,
  legPartId: number
): Promise<NpcStandingComposition> {
  const catalog = await loadPartCatalog(session);

  const headPart = catalog.get(headPartId);
  const bodyPart = catalog.get(bodyPartId);
  const legPart = catalog.get(legPartId);

  if (!headPart) throw new Error(`Không tìm thấy head part #${headPartId}.`);
  if (!bodyPart) throw new Error(`Không tìm thấy body part #${bodyPartId}.`);
  if (!legPart) throw new Error(`Không tìm thấy leg part #${legPartId}.`);

  const headFrame = getRequiredFrame(headPart, 'head', DEFAULT_STANDING_POSE.head.frameIndex);
  const bodyFrame = getRequiredFrame(bodyPart, 'body', DEFAULT_STANDING_POSE.body.frameIndex);
  const legFrame = getRequiredFrame(legPart, 'leg', DEFAULT_STANDING_POSE.leg.frameIndex);

  return {
    head: {
      partId: headPartId,
      role: 'head',
      frameIndex: DEFAULT_STANDING_POSE.head.frameIndex,
      imageId: headFrame.imageId,
      drawX: DEFAULT_STANDING_POSE.head.baseX + headFrame.dx,
      drawY: DEFAULT_STANDING_POSE.head.baseY + headFrame.dy,
      dx: headFrame.dx,
      dy: headFrame.dy,
      sourceClass: headPart.sourceClass,
      sourceRow: headPart.sourceRow,
    },
    body: {
      partId: bodyPartId,
      role: 'body',
      frameIndex: DEFAULT_STANDING_POSE.body.frameIndex,
      imageId: bodyFrame.imageId,
      drawX: DEFAULT_STANDING_POSE.body.baseX + bodyFrame.dx,
      drawY: DEFAULT_STANDING_POSE.body.baseY + bodyFrame.dy,
      dx: bodyFrame.dx,
      dy: bodyFrame.dy,
      sourceClass: bodyPart.sourceClass,
      sourceRow: bodyPart.sourceRow,
    },
    leg: {
      partId: legPartId,
      role: 'leg',
      frameIndex: DEFAULT_STANDING_POSE.leg.frameIndex,
      imageId: legFrame.imageId,
      drawX: DEFAULT_STANDING_POSE.leg.baseX + legFrame.dx,
      drawY: DEFAULT_STANDING_POSE.leg.baseY + legFrame.dy,
      dx: legFrame.dx,
      dy: legFrame.dy,
      sourceClass: legPart.sourceClass,
      sourceRow: legPart.sourceRow,
    },
  };
}

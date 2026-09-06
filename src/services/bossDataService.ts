import { LoadedJarSession } from '../types/jar';
import { ItemAnalysisSessionData } from '../types/item';
import { getSessionClassInfo } from './patchPlannerService';
import { analyzeItemTables } from './itemDataService';

export type BossStatMode =
  | 'fixed'
  | 'broly'
  | 'superBroly'
  | 'campRuntime'
  | 'treasureRuntime'
  | 'cloneRuntime';

export interface BossDefinition {
  index: number;
  name: string;
  family: number;
  stage: number;
  charId: number;
  variant: number;
  mapId: number;
  head: number;
  body: number;
  leg: number;
  hp: number;
  damage: number;
  spawnX: number;
  slot: number;
  statMode: BossStatMode;
}

export interface BossItemRef {
  id: string;
  name: string;
  iconId: string;
}

export interface BossDropRule {
  key: string;
  title: string;
  itemIds: number[];
  chancePercent: number;
  quantity: number;
  condition: string;
  source: string;
  scope: 'boss' | 'char' | 'map' | 'mode';
  editable: boolean;
  itemRefs: BossItemRef[];
  note?: string;
}

export interface BossCustomDrop {
  id: string;
  itemId: string;
  chancePercent: number;
  quantity: number;
}

export interface BossDraft {
  bossIndex: number;
  name: string;
  head: number;
  body: number;
  leg: number;
  hpOverride: number | null;
  damageOverride: number | null;
  spawnX: number;
  dropChanceOverrides: Record<string, number>;
  dropQuantityOverrides: Record<string, number>;
  customDrops: BossCustomDrop[];
}

export interface BossRuntimeDescription {
  hpText: string;
  damageText: string;
  detail: string;
}

export interface BossAnalysisSnapshot {
  bosses: BossDefinition[];
  verified: boolean;
  verificationDetail: string;
  itemAnalysis: ItemAnalysisSessionData | null;
}

const BOSS_DEFINITIONS: BossDefinition[] = [
  { index: 0, name: "Kuku", family: 19, stage: 0, charId: -20, variant: 0, mapId: 68, head: 159, body: 160, leg: 161, hp: 500000, damage: 30000, spawnX: 760, slot: -1, statMode: 'fixed' },
  { index: 1, name: "Mập Đầu Đinh", family: 19, stage: 1, charId: -21, variant: 0, mapId: 63, head: 165, body: 166, leg: 167, hp: 1000000, damage: 40000, spawnX: 760, slot: -1, statMode: 'fixed' },
  { index: 2, name: "Rambo", family: 19, stage: 2, charId: -22, variant: 0, mapId: 74, head: 162, body: 163, leg: 164, hp: 1500000, damage: 50000, spawnX: 760, slot: -1, statMode: 'fixed' },
  { index: 3, name: "Số 4", family: 20, stage: 1, charId: -23, variant: 0, mapId: 79, head: 168, body: 169, leg: 170, hp: 25000000, damage: 50000, spawnX: 680, slot: -1, statMode: 'fixed' },
  { index: 4, name: "Số 3", family: 20, stage: 2, charId: -24, variant: 0, mapId: 79, head: 174, body: 175, leg: 176, hp: 30000000, damage: 50000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 5, name: "Số 2", family: 20, stage: 3, charId: -25, variant: 0, mapId: 79, head: 171, body: 172, leg: 173, hp: 30500000, damage: 50000, spawnX: 760, slot: -1, statMode: 'fixed' },
  { index: 6, name: "Số 1", family: 20, stage: 4, charId: -26, variant: 0, mapId: 79, head: 177, body: 178, leg: 179, hp: 40000000, damage: 50000, spawnX: 800, slot: -1, statMode: 'fixed' },
  { index: 7, name: "Tiểu đội trưởng", family: 20, stage: 5, charId: -27, variant: 0, mapId: 79, head: 180, body: 181, leg: 182, hp: 50000000, damage: 50000, spawnX: 840, slot: -1, statMode: 'fixed' },
  { index: 8, name: "Fide Đại ca 1", family: 21, stage: 1, charId: -28, variant: 0, mapId: 80, head: 183, body: 184, leg: 185, hp: 10000000, damage: 100000, spawnX: 800, slot: -1, statMode: 'fixed' },
  { index: 9, name: "Fide Đại ca 2", family: 21, stage: 2, charId: -28, variant: 1, mapId: 80, head: 186, body: 187, leg: 188, hp: 20000000, damage: 100000, spawnX: 800, slot: -1, statMode: 'fixed' },
  { index: 10, name: "Fide Đại ca 3", family: 21, stage: 3, charId: -28, variant: 2, mapId: 80, head: 189, body: 190, leg: 191, hp: 30000000, damage: 100000, spawnX: 800, slot: -1, statMode: 'fixed' },
  { index: 11, name: "Android 19", family: 23, stage: 1, charId: -30, variant: 0, mapId: 93, head: 249, body: 250, leg: 251, hp: 1000000, damage: 200000, spawnX: 700, slot: -1, statMode: 'fixed' },
  { index: 12, name: "Dr. Kôrê", family: 23, stage: 2, charId: -31, variant: 0, mapId: 93, head: 255, body: 256, leg: 257, hp: 100000000, damage: 200000, spawnX: 760, slot: -1, statMode: 'fixed' },
  { index: 13, name: "Android 15", family: 24, stage: 1, charId: -34, variant: 0, mapId: 104, head: 261, body: 262, leg: 263, hp: 180000000, damage: 240000, spawnX: 650, slot: -1, statMode: 'fixed' },
  { index: 14, name: "Android 14", family: 24, stage: 2, charId: -33, variant: 0, mapId: 104, head: 246, body: 247, leg: 248, hp: 220000000, damage: 270000, spawnX: 730, slot: -1, statMode: 'fixed' },
  { index: 15, name: "Android 13", family: 24, stage: 3, charId: -32, variant: 0, mapId: 104, head: 252, body: 253, leg: 254, hp: 260000000, damage: 300000, spawnX: 810, slot: -1, statMode: 'fixed' },
  { index: 16, name: "Póc", family: 25, stage: 1, charId: -36, variant: 0, mapId: 97, head: 240, body: 241, leg: 242, hp: 300000000, damage: 320000, spawnX: 700, slot: -1, statMode: 'fixed' },
  { index: 17, name: "Póc", family: 25, stage: 2, charId: -35, variant: 0, mapId: 97, head: 237, body: 238, leg: 239, hp: 340000000, damage: 350000, spawnX: 760, slot: -1, statMode: 'fixed' },
  { index: 18, name: "King Kong", family: 25, stage: 3, charId: -37, variant: 0, mapId: 97, head: 243, body: 244, leg: 245, hp: 400000000, damage: 400000, spawnX: 820, slot: -1, statMode: 'fixed' },
  { index: 19, name: "Xên Bọ Hung cấp 1", family: 26, stage: 1, charId: -100, variant: 0, mapId: 100, head: 228, body: 229, leg: 230, hp: 460000000, damage: 450000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 20, name: "Xên Bọ Hung cấp 2", family: 26, stage: 2, charId: -100, variant: 1, mapId: 100, head: 231, body: 232, leg: 233, hp: 550000000, damage: 520000, spawnX: 760, slot: -1, statMode: 'fixed' },
  { index: 21, name: "Xên Bọ Hung hoàn thiện", family: 26, stage: 3, charId: -100, variant: 2, mapId: 100, head: 234, body: 235, leg: 236, hp: 680000000, damage: 650000, spawnX: 800, slot: -1, statMode: 'fixed' },
  { index: 22, name: "Xên con 1", family: 27, stage: 3, charId: -102, variant: 0, mapId: 103, head: 264, body: 265, leg: 266, hp: 400000000, damage: 420000, spawnX: 430, slot: -1, statMode: 'fixed' },
  { index: 23, name: "Xên con 2", family: 27, stage: 3, charId: -103, variant: 0, mapId: 103, head: 264, body: 265, leg: 266, hp: 400000000, damage: 420000, spawnX: 530, slot: -1, statMode: 'fixed' },
  { index: 24, name: "Xên con 3", family: 27, stage: 3, charId: -104, variant: 0, mapId: 103, head: 264, body: 265, leg: 266, hp: 400000000, damage: 420000, spawnX: 630, slot: -1, statMode: 'fixed' },
  { index: 25, name: "Xên con 4", family: 27, stage: 3, charId: -105, variant: 0, mapId: 103, head: 264, body: 265, leg: 266, hp: 400000000, damage: 420000, spawnX: 730, slot: -1, statMode: 'fixed' },
  { index: 26, name: "Xên con 5", family: 27, stage: 3, charId: -106, variant: 0, mapId: 103, head: 264, body: 265, leg: 266, hp: 400000000, damage: 420000, spawnX: 830, slot: -1, statMode: 'fixed' },
  { index: 27, name: "Xên con 6", family: 27, stage: 3, charId: -107, variant: 0, mapId: 103, head: 264, body: 265, leg: 266, hp: 400000000, damage: 420000, spawnX: 930, slot: -1, statMode: 'fixed' },
  { index: 28, name: "Xên con 7", family: 27, stage: 3, charId: -108, variant: 0, mapId: 103, head: 264, body: 265, leg: 266, hp: 400000000, damage: 420000, spawnX: 1030, slot: -1, statMode: 'fixed' },
  { index: 29, name: "Siêu Bọ Hung", family: 27, stage: 4, charId: -101, variant: 1, mapId: 103, head: 234, body: 235, leg: 236, hp: 820000000, damage: 750000, spawnX: 800, slot: -1, statMode: 'fixed' },
  { index: 30, name: "Drabura", family: 28, stage: 1, charId: -233, variant: 0, mapId: 114, head: 418, body: 419, leg: 420, hp: 700000000, damage: 650000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 31, name: "Pui Pui", family: 28, stage: 2, charId: -234, variant: 0, mapId: 115, head: 451, body: 452, leg: 453, hp: 620000000, damage: 560000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 32, name: "Pui Pui", family: 28, stage: 3, charId: -238, variant: 0, mapId: 117, head: 451, body: 452, leg: 453, hp: 700000000, damage: 620000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 33, name: "Yacôn", family: 28, stage: 4, charId: -235, variant: 0, mapId: 118, head: 415, body: 416, leg: 417, hp: 780000000, damage: 700000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 34, name: "Drabura", family: 28, stage: 5, charId: -237, variant: 0, mapId: 119, head: 418, body: 419, leg: 420, hp: 920000000, damage: 850000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 35, name: "Mabư", family: 28, stage: 6, charId: -236, variant: 0, mapId: 120, head: 297, body: 298, leg: 299, hp: 1200000000, damage: 1050000, spawnX: 720, slot: -1, statMode: 'fixed' },
  { index: 36, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 6, head: 291, body: 292, leg: 293, hp: 67600, damage: 676, spawnX: 0, slot: 0, statMode: 'broly' },
  { index: 37, name: "RIMLL Thiên Đạo", family: -1, stage: -1, charId: -239, variant: 0, mapId: 6, head: 1851, body: 1854, leg: 1855, hp: 1000000000, damage: 100000, spawnX: 0, slot: 0, statMode: 'fixed' },
  { index: 38, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 27, head: 291, body: 292, leg: 293, hp: 14747, damage: 147, spawnX: 0, slot: 3, statMode: 'broly' },
  { index: 39, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 27, head: 294, body: 295, leg: 296, hp: 14231913, damage: 142319, spawnX: 0, slot: 3, statMode: 'superBroly' },
  { index: 40, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 28, head: 291, body: 292, leg: 293, hp: 40434, damage: 404, spawnX: 0, slot: 4, statMode: 'broly' },
  { index: 41, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 28, head: 294, body: 295, leg: 296, hp: 9150240, damage: 91502, spawnX: 0, slot: 4, statMode: 'superBroly' },
  { index: 42, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 30, head: 291, body: 292, leg: 293, hp: 78926, damage: 789, spawnX: 0, slot: 6, statMode: 'broly' },
  { index: 43, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 30, head: 294, body: 295, leg: 296, hp: 15112835, damage: 151128, spawnX: 0, slot: 6, statMode: 'superBroly' },
  { index: 44, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 31, head: 291, body: 292, leg: 293, hp: 58873, damage: 588, spawnX: 0, slot: 7, statMode: 'broly' },
  { index: 45, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 31, head: 294, body: 295, leg: 296, hp: 5153341, damage: 51533, spawnX: 0, slot: 7, statMode: 'superBroly' },
  { index: 46, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 32, head: 291, body: 292, leg: 293, hp: 82398, damage: 823, spawnX: 0, slot: 8, statMode: 'broly' },
  { index: 47, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 32, head: 294, body: 295, leg: 296, hp: 12947360, damage: 129473, spawnX: 0, slot: 8, statMode: 'superBroly' },
  { index: 48, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 34, head: 291, body: 292, leg: 293, hp: 82857, damage: 828, spawnX: 0, slot: 10, statMode: 'broly' },
  { index: 49, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 34, head: 294, body: 295, leg: 296, hp: 9732820, damage: 97328, spawnX: 0, slot: 10, statMode: 'superBroly' },
  { index: 50, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 35, head: 291, body: 292, leg: 293, hp: 90496, damage: 904, spawnX: 0, slot: 11, statMode: 'broly' },
  { index: 51, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 35, head: 294, body: 295, leg: 296, hp: 15771754, damage: 157717, spawnX: 0, slot: 11, statMode: 'superBroly' },
  { index: 52, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 36, head: 291, body: 292, leg: 293, hp: 96247, damage: 962, spawnX: 0, slot: 12, statMode: 'broly' },
  { index: 53, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 36, head: 294, body: 295, leg: 296, hp: 11893197, damage: 118931, spawnX: 0, slot: 12, statMode: 'superBroly' },
  { index: 54, name: "Broly", family: -1, stage: -1, charId: -1822, variant: 0, mapId: 38, head: 291, body: 292, leg: 293, hp: 13041, damage: 130, spawnX: 0, slot: 14, statMode: 'broly' },
  { index: 55, name: "Super Broly", family: -1, stage: -1, charId: -82282, variant: 0, mapId: 38, head: 294, body: 295, leg: 296, hp: 12756387, damage: 127563, spawnX: 0, slot: 14, statMode: 'superBroly' },
  { index: 56, name: "Trung úy Trắng", family: -1, stage: -1, charId: -10003, variant: 0, mapId: 59, head: 141, body: 142, leg: 143, hp: 1, damage: 1, spawnX: 900, slot: -1, statMode: 'campRuntime' },
  { index: 57, name: "Trung úy Xanh Lơ", family: -1, stage: -1, charId: -10004, variant: 0, mapId: 62, head: 135, body: 136, leg: 137, hp: 1, damage: 1, spawnX: 1210, slot: -1, statMode: 'campRuntime' },
  { index: 58, name: "Trung úy Thép", family: -1, stage: -1, charId: -10005, variant: 0, mapId: 55, head: 129, body: 130, leg: 131, hp: 1, damage: 1, spawnX: 900, slot: -1, statMode: 'campRuntime' },
  { index: 59, name: "Ninja Áo Tím", family: -1, stage: -1, charId: -10006, variant: 0, mapId: 54, head: 123, body: 124, leg: 125, hp: 1, damage: 1, spawnX: 190, slot: -1, statMode: 'campRuntime' },
  { index: 60, name: "Ninja Áo Tím", family: -1, stage: -1, charId: -10007, variant: 0, mapId: 54, head: 123, body: 124, leg: 125, hp: 1, damage: 1, spawnX: 70, slot: -1, statMode: 'campRuntime' },
  { index: 61, name: "Ninja Áo Tím", family: -1, stage: -1, charId: -10008, variant: 0, mapId: 54, head: 123, body: 124, leg: 125, hp: 1, damage: 1, spawnX: 130, slot: -1, statMode: 'campRuntime' },
  { index: 62, name: "Ninja Áo Tím", family: -1, stage: -1, charId: -10009, variant: 0, mapId: 54, head: 123, body: 124, leg: 125, hp: 1, damage: 1, spawnX: 190, slot: -1, statMode: 'campRuntime' },
  { index: 63, name: "Ninja Áo Tím", family: -1, stage: -1, charId: -100010, variant: 0, mapId: 54, head: 123, body: 124, leg: 125, hp: 1, damage: 1, spawnX: 250, slot: -1, statMode: 'campRuntime' },
  { index: 64, name: "Ninja Áo Tím", family: -1, stage: -1, charId: -100011, variant: 0, mapId: 54, head: 123, body: 124, leg: 125, hp: 1, damage: 1, spawnX: 310, slot: -1, statMode: 'campRuntime' },
  { index: 65, name: "Ninja Áo Tím", family: -1, stage: -1, charId: -100012, variant: 0, mapId: 54, head: 123, body: 124, leg: 125, hp: 1, damage: 1, spawnX: 370, slot: -1, statMode: 'campRuntime' },
  { index: 66, name: "Rôbốt Vệ Sĩ", family: -1, stage: -1, charId: -100013, variant: 0, mapId: 57, head: 138, body: 139, leg: 140, hp: 1, damage: 1, spawnX: 350, slot: -1, statMode: 'campRuntime' },
  { index: 67, name: "Rôbốt Vệ Sĩ", family: -1, stage: -1, charId: -100014, variant: 0, mapId: 57, head: 138, body: 139, leg: 140, hp: 1, damage: 1, spawnX: 650, slot: -1, statMode: 'campRuntime' },
  { index: 68, name: "Rôbốt Vệ Sĩ", family: -1, stage: -1, charId: -100015, variant: 0, mapId: 57, head: 138, body: 139, leg: 140, hp: 1, damage: 1, spawnX: 950, slot: -1, statMode: 'campRuntime' },
  { index: 69, name: "Rôbốt Vệ Sĩ", family: -1, stage: -1, charId: -100016, variant: 0, mapId: 57, head: 138, body: 139, leg: 140, hp: 1, damage: 1, spawnX: 1250, slot: -1, statMode: 'campRuntime' },
  { index: 70, name: "Trung úy Xanh Lơ", family: -1, stage: -1, charId: -10004, variant: 0, mapId: 137, head: 135, body: 136, leg: 137, hp: 1, damage: 1, spawnX: 1210, slot: -1, statMode: 'treasureRuntime' },
  { index: 71, name: "Bản sao", family: -9999, stage: -9999, charId: -20001, variant: 0, mapId: 140, head: 285, body: 286, leg: 287, hp: 1, damage: 1, spawnX: 700, slot: -1, statMode: 'cloneRuntime' },
];

// Danh sách này được ánh xạ từ a/a/d.fm + constructor a/a/d$a của đúng cấu trúc JAR hiện tại.
// Runtime boss đặc biệt được đánh dấu riêng, không dùng giá trị random từ một lần khởi tạo làm “HP gốc”.
export function getBossDefinitions(): BossDefinition[] {
  return BOSS_DEFINITIONS.map((boss) => ({ ...boss }));
}

const draftStore = new WeakMap<LoadedJarSession, Map<number, BossDraft>>();

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function ensureItemAnalysis(session: LoadedJarSession): Promise<ItemAnalysisSessionData | null> {
  if (session.itemAnalysis) return session.itemAnalysis;
  try {
    return await analyzeItemTables(session);
  } catch (err) {
    console.warn('Không phân tích được Item Template khi dựng panel Boss:', err);
    return null;
  }
}

function fallbackItemName(id: number): string {
  const names: Record<number, string> = {
    14: 'Ngọc Rồng 1 sao',
    15: 'Ngọc Rồng 2 sao',
    16: 'Ngọc Rồng 3 sao',
    17: 'Ngọc Rồng 4 sao',
    18: 'Ngọc Rồng 5 sao',
    19: 'Ngọc Rồng 6 sao',
    20: 'Ngọc Rồng 7 sao',
    611: 'Bản đồ kho báu',
    651: 'Quần Hủy Diệt',
    653: 'Quần Hủy Diệt',
    655: 'Quần Hủy Diệt',
  };
  return names[id] || `Item #${id}`;
}

export function resolveBossItem(
  itemAnalysis: ItemAnalysisSessionData | null,
  id: number
): BossItemRef {
  const idText = String(id);
  const item = itemAnalysis?.items.find((candidate: any) => candidate.id === idText);
  return {
    id: idText,
    name: item?.name || fallbackItemName(id),
    iconId: item?.rawValues?.[6] ?? '',
  };
}

export async function analyzeBosses(session: LoadedJarSession): Promise<BossAnalysisSnapshot> {
  const [managerClass, itemAnalysis] = await Promise.all([
    getSessionClassInfo(session, 'a/a/d'),
    ensureItemAnalysis(session),
  ]);

  const fm = managerClass?.methods.find((method: any) => method.name === 'fm');
  const spawn = managerClass?.methods.find(
    (method: any) => method.name === 'c' && method.descriptor === '(La/a/d$a;)V'
  );
  const rimDrop = managerClass?.methods.find((method: any) => method.name === 'rimDropAndFinish');

  const verified = Boolean(fm?.code && spawn?.code && rimDrop?.code);
  const verificationDetail = verified
    ? 'Đã xác minh a/a/d.fm, spawn c(d$a) và rimDropAndFinish trong JAR.'
    : 'Cấu trúc boss manager khác dự kiến; danh sách vẫn hiển thị nhưng cần kiểm tra trước khi viết bytecode.';

  return {
    bosses: BOSS_DEFINITIONS.map((boss) => ({ ...boss })),
    verified,
    verificationDetail,
    itemAnalysis,
  };
}

export function describeBossRuntime(boss: BossDefinition): BossRuntimeDescription {
  switch (boss.statMode) {
    case 'broly':
      return {
        hpText: '500 → 100.000 (random mỗi lần tạo)',
        damageText: 'HP / 100, tối thiểu 1',
        detail: 'a/a/d.b(d$a): Broly thường random HP 500..100000; tên cũng được thêm số ngẫu nhiên.',
      };
    case 'superBroly':
      return {
        hpText: '1.500.000 → 16.070.777 (random)',
        damageText: 'HP / 100',
        detail: 'a/a/d.b(d$a): Super Broly random HP 1.500.000..16.070.777.',
      };
    case 'campRuntime':
      return {
        hpText: 'Runtime từ a/a/b.c()',
        damageText: 'Runtime từ a/a/b.A()',
        detail: 'Boss doanh trại có gq=true; a/a/d.c(d$a) ghi đè HP/damage khi spawn.',
      };
    case 'treasureRuntime':
      return {
        hpText: 'patch/TM.treasureBossHp()',
        damageText: 'patch/TM.treasureBossDamage()',
        detail: 'Trung úy Xanh Lơ map 137 dùng chỉ số theo Bản đồ kho báu khi mode đang active.',
      };
    case 'cloneRuntime':
      return {
        hpText: 'Sao chép HP người chơi',
        damageText: 'Sao chép damage người chơi',
        detail: 'startPotageClone() tạo Bản sao dựa trên chỉ số người chơi runtime.',
      };
    default:
      return {
        hpText: boss.hp.toLocaleString('vi-VN'),
        damageText: boss.damage.toLocaleString('vi-VN'),
        detail: 'HP/damage cố định được truyền trực tiếp từ a/a/d.fm vào constructor boss record.',
      };
  }
}

function withItems(
  rule: Omit<BossDropRule, 'itemRefs'>,
  itemAnalysis: ItemAnalysisSessionData | null
): BossDropRule {
  return {
    ...rule,
    itemRefs: rule.itemIds.map((id) => resolveBossItem(itemAnalysis, id)),
  };
}

export function getBossDropRules(
  boss: BossDefinition,
  itemAnalysis: ItemAnalysisSessionData | null
): BossDropRule[] {
  const rules: BossDropRule[] = [];

  if (boss.charId === -239) {
    rules.push(
      withItems(
        {
          key: 'rim-dragon-ball',
          title: 'Ngọc Rồng ngẫu nhiên 1–7 sao',
          itemIds: [14, 15, 16, 17, 18, 19, 20],
          chancePercent: 100,
          quantity: 1,
          condition: 'rimDropAndFinish: item = 14 + random(7). Luôn rơi 1 viên khi nhánh RIM chạy.',
          source: 'a/a/d.rimDropAndFinish',
          scope: 'char',
          editable: true,
          note: 'Pool 7 item dùng chung một RNG. Đổi cấu trúc từng sao riêng cần writer phức tạp hơn.',
        },
        itemAnalysis
      ),
      withItems(
        {
          key: 'rim-destroyer-pants',
          title: 'Quần Hủy Diệt ngẫu nhiên',
          itemIds: [651, 653, 655],
          chancePercent: 10,
          quantity: 1,
          condition: 'random(100) < 10; item = 651 + random(3) × 2.',
          source: 'a/a/d.rimDropAndFinish',
          scope: 'char',
          editable: true,
        },
        itemAnalysis
      )
    );
  }

  if (boss.mapId === 57) {
    rules.push(
      withItems(
        {
          key: 'camp-map57-db4',
          title: 'Ngọc Rồng 4 sao',
          itemIds: [17],
          chancePercent: 50,
          quantity: 1,
          condition: 'patch/TM.dropCampBossLoot: map 57, random(100) < 50.',
          source: 'patch/TM.dropCampBossLoot',
          scope: 'map',
          editable: true,
          note: 'Rule dùng chung cho mọi boss phù hợp ở map 57.',
        },
        itemAnalysis
      )
    );
  }

  if ([54, 55, 59, 62].includes(boss.mapId)) {
    rules.push(
      withItems(
        {
          key: 'camp-db3',
          title: 'Ngọc Rồng 3 sao',
          itemIds: [16],
          chancePercent: 10,
          quantity: 1,
          condition: 'roll 0..99: <10.',
          source: 'patch/TM.dropCampBossLoot',
          scope: 'map',
          editable: true,
          note: 'Phân phối dùng chung: DB3 10% / DB4 40% / DB5 50%.',
        },
        itemAnalysis
      ),
      withItems(
        {
          key: 'camp-db4',
          title: 'Ngọc Rồng 4 sao',
          itemIds: [17],
          chancePercent: 40,
          quantity: 1,
          condition: 'roll 0..99: 10..49.',
          source: 'patch/TM.dropCampBossLoot',
          scope: 'map',
          editable: true,
        },
        itemAnalysis
      ),
      withItems(
        {
          key: 'camp-db5',
          title: 'Ngọc Rồng 5 sao',
          itemIds: [18],
          chancePercent: 50,
          quantity: 1,
          condition: 'roll 0..99: >=50.',
          source: 'patch/TM.dropCampBossLoot',
          scope: 'map',
          editable: true,
        },
        itemAnalysis
      )
    );
  }

  if (boss.charId === -10004 && boss.mapId === 62) {
    rules.push(
      withItems(
        {
          key: 'camp-treasure-map',
          title: 'Bản đồ kho báu',
          itemIds: [611],
          chancePercent: 100,
          quantity: 1,
          condition: 'onBossKilled: Trung úy Xanh Lơ map 62 → drop item #611.',
          source: 'patch/TM.onBossKilled',
          scope: 'boss',
          editable: true,
        },
        itemAnalysis
      )
    );
  }

  if (boss.charId === -10004 && boss.mapId === 137) {
    rules.push(
      withItems(
        {
          key: 'treasure-boss-db1',
          title: 'BĐKB: Ngọc Rồng 1 sao',
          itemIds: [14],
          chancePercent: 1,
          quantity: 1,
          condition: 'Tỷ lệ tăng nhẹ theo level BĐKB; mốc level 1 bắt đầu khoảng 1%.',
          source: 'patch/TM.dropTreasureBossLoot',
          scope: 'mode',
          editable: false,
          note: 'Đây là công thức theo level, không phải một hằng số chance duy nhất.',
        },
        itemAnalysis
      ),
      withItems(
        {
          key: 'treasure-boss-db2',
          title: 'BĐKB: Ngọc Rồng 2 sao',
          itemIds: [15],
          chancePercent: 3,
          quantity: 1,
          condition: 'Nhánh thứ hai trong công thức level-dependent.',
          source: 'patch/TM.dropTreasureBossLoot',
          scope: 'mode',
          editable: false,
        },
        itemAnalysis
      ),
      withItems(
        {
          key: 'treasure-boss-db3',
          title: 'BĐKB: Ngọc Rồng 3 sao',
          itemIds: [16],
          chancePercent: 5,
          quantity: 1,
          condition: 'Nhánh thứ ba trong công thức level-dependent.',
          source: 'patch/TM.dropTreasureBossLoot',
          scope: 'mode',
          editable: false,
        },
        itemAnalysis
      ),
      withItems(
        {
          key: 'treasure-boss-db4',
          title: 'BĐKB: Ngọc Rồng 4 sao',
          itemIds: [17],
          chancePercent: 81,
          quantity: 1,
          condition: 'Phần còn lại dưới ngưỡng 90%; tỷ lệ thực tế giảm khi các nhánh DB1–3 tăng theo level.',
          source: 'patch/TM.dropTreasureBossLoot',
          scope: 'mode',
          editable: false,
        },
        itemAnalysis
      )
    );
  }

  return rules;
}

function defaultDraft(boss: BossDefinition): BossDraft {
  return {
    bossIndex: boss.index,
    name: boss.name,
    head: boss.head,
    body: boss.body,
    leg: boss.leg,
    hpOverride: boss.statMode === 'fixed' ? boss.hp : null,
    damageOverride: boss.statMode === 'fixed' ? boss.damage : null,
    spawnX: boss.spawnX,
    dropChanceOverrides: {},
    dropQuantityOverrides: {},
    customDrops: [],
  };
}

export function getBossDraft(
  session: LoadedJarSession,
  boss: BossDefinition
): BossDraft {
  let map = draftStore.get(session);
  if (!map) {
    map = new Map<number, BossDraft>();
    draftStore.set(session, map);
  }

  let draft = map.get(boss.index);
  if (!draft) {
    draft = defaultDraft(boss);
    map.set(boss.index, draft);
  }

  return {
    ...draft,
    dropChanceOverrides: { ...draft.dropChanceOverrides },
    dropQuantityOverrides: { ...draft.dropQuantityOverrides },
    customDrops: draft.customDrops.map((drop) => ({ ...drop })),
  };
}

export function setBossDraft(
  session: LoadedJarSession,
  boss: BossDefinition,
  draft: BossDraft
): void {
  let map = draftStore.get(session);
  if (!map) {
    map = new Map<number, BossDraft>();
    draftStore.set(session, map);
  }

  map.set(boss.index, {
    ...draft,
    name: draft.name.slice(0, 80),
    head: Math.max(0, Math.round(draft.head)),
    body: Math.max(0, Math.round(draft.body)),
    leg: Math.max(0, Math.round(draft.leg)),
    hpOverride:
      draft.hpOverride === null
        ? null
        : Math.round(clampNumber(draft.hpOverride, 1, Number.MAX_SAFE_INTEGER)),
    damageOverride:
      draft.damageOverride === null
        ? null
        : Math.round(clampNumber(draft.damageOverride, 1, 2_100_000_000)),
    spawnX: Math.round(clampNumber(draft.spawnX, 0, 100000)),
    dropChanceOverrides: Object.fromEntries(
      Object.entries(draft.dropChanceOverrides).map(([key, value]) => [
        key,
        clampNumber(value, 0, 100),
      ])
    ),
    dropQuantityOverrides: Object.fromEntries(
      Object.entries(draft.dropQuantityOverrides).map(([key, value]) => [
        key,
        Math.round(clampNumber(value, 1, 999999)),
      ])
    ),
    customDrops: draft.customDrops.map((drop) => ({
      ...drop,
      itemId: String(Math.max(0, Math.round(Number(drop.itemId) || 0))),
      chancePercent: clampNumber(drop.chancePercent, 0, 100),
      quantity: Math.round(clampNumber(drop.quantity, 1, 999999)),
    })),
  });
}

function numbersEqual(a: number | null, b: number | null): boolean {
  return a === b;
}

export function isBossDraftDirty(
  boss: BossDefinition,
  draft: BossDraft
): boolean {
  const base = defaultDraft(boss);
  return (
    draft.name !== base.name ||
    draft.head !== base.head ||
    draft.body !== base.body ||
    draft.leg !== base.leg ||
    !numbersEqual(draft.hpOverride, base.hpOverride) ||
    !numbersEqual(draft.damageOverride, base.damageOverride) ||
    draft.spawnX !== base.spawnX ||
    Object.keys(draft.dropChanceOverrides).length > 0 ||
    Object.keys(draft.dropQuantityOverrides).length > 0 ||
    draft.customDrops.length > 0
  );
}

export function getDirtyBossCount(session: LoadedJarSession): number {
  const map = draftStore.get(session);
  if (!map) return 0;

  let count = 0;
  for (const boss of BOSS_DEFINITIONS) {
    const draft = map.get(boss.index);
    if (draft && isBossDraftDirty(boss, draft)) count++;
  }
  return count;
}

export function resetBossDraft(
  session: LoadedJarSession,
  boss: BossDefinition
): BossDraft {
  let map = draftStore.get(session);
  if (!map) {
    map = new Map<number, BossDraft>();
    draftStore.set(session, map);
  }

  const draft = defaultDraft(boss);
  map.set(boss.index, draft);
  return { ...draft, customDrops: [] };
}

function cloneBossDraftForPersistence(draft: BossDraft): BossDraft {
  return {
    ...draft,
    dropChanceOverrides: { ...draft.dropChanceOverrides },
    dropQuantityOverrides: { ...draft.dropQuantityOverrides },
    customDrops: draft.customDrops.map((drop) => ({ ...drop })),
  };
}

export function exportBossDrafts(session: LoadedJarSession): Array<[number, BossDraft]> {
  const store = draftStore.get(session);
  if (!store) return [];
  return Array.from(store.entries()).map(([index, draft]) => [
    index,
    cloneBossDraftForPersistence(draft),
  ]);
}

export function importBossDrafts(
  session: LoadedJarSession,
  entries: Array<[number, BossDraft]>
): void {
  const store = new Map<number, BossDraft>();
  for (const [index, draft] of entries || []) {
    store.set(index, cloneBossDraftForPersistence(draft));
  }
  draftStore.set(session, store);
}

export function getBossDraftFingerprint(session: LoadedJarSession): string {
  const store = draftStore.get(session);
  if (!store) return '[]';

  const byIndex = new Map(BOSS_DEFINITIONS.map((boss) => [boss.index, boss]));
  const rows = Array.from(store.entries())
    .filter(([index, draft]) => {
      const boss = byIndex.get(index);
      return Boolean(boss && isBossDraftDirty(boss, draft));
    })
    .sort(([a], [b]) => a - b)
    .map(([index, draft]) => [index, draft]);

  return JSON.stringify(rows);
}

export function resetAllBossDrafts(session: LoadedJarSession): void {
  draftStore.delete(session);
}

export function createCustomBossDrop(): BossCustomDrop {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId: '14',
    chancePercent: 10,
    quantity: 1,
  };
}

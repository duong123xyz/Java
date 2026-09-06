import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import { StringTableResult, ItemRecord, ItemAnalysisSessionData } from '../types/item';
import { getSessionClassInfo } from './patchPlannerService';
import { analyzeStaticInitializer } from './staticInitializerAnalyzer';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { analyzeItemTables } from './itemDataService';

export interface GameDataTable {
  key: 'npc' | 'npcShop' | 'shopTab' | 'shopItem';
  title: string;
  sourceClass: string;
  sourceField: string;
  schema: string[];
  rows: StringTableResult['rows'];
}

export interface GameResolvedItemTemplate {
  itemId: string;
  name: string;
  description: string;
  sourceClass: string;
  sourceField: string;
  sourceRow: number;
  iconId: string;
  part: string;
  head: string;
  body: string;
  leg: string;
}

export interface GameShopItem {
  rowIndex: number;
  id: string;
  tabId: string;
  tempId: string;
  isNew: string;
  isSell: string;
  typeSell: string;
  cost: string;
  iconSpec: string;
  createTime: string;
  template: GameResolvedItemTemplate | null;
}

export interface GameNpcShopTab {
  rowIndex: number;
  id: string;
  shopId: string;
  name: string;
  items: GameShopItem[];
}

export interface GameNpcShop {
  rowIndex: number;
  id: string;
  npcId: string;
  tagName: string;
  typeShop: string;
  tabs: GameNpcShopTab[];
}

export interface GameNpc {
  rowIndex: number;
  id: string;
  name: string;
  head: string;
  body: string;
  leg: string;
  avatar: string;
  shops: GameNpcShop[];
}

export interface GameDataDiagnostics {
  orphanNpcShops: number;
  orphanShopTabs: number;
  orphanShopItems: number;
  missingItemTemplates: number;
  duplicateNpcIds: string[];
  duplicateShopIds: string[];
  duplicateTabIds: string[];
  duplicateShopItemIds: string[];
}

export interface GameDataSnapshot {
  npcTable: GameDataTable;
  npcShopTable: GameDataTable;
  shopTabTable: GameDataTable;
  shopItemTable: GameDataTable;
  npcs: GameNpc[];
  shops: GameNpcShop[];
  tabs: GameNpcShopTab[];
  shopItems: GameShopItem[];
  diagnostics: GameDataDiagnostics;
  itemAnalysis: ItemAnalysisSessionData | null;
}

interface TableSpec {
  key: GameDataTable['key'];
  title: string;
  sourceClass: string;
  expectedSchema: string[];
}

const TABLE_SPECS: TableSpec[] = [
  {
    key: 'npc',
    title: 'NPC',
    sourceClass: 'a/a/a/B',
    expectedSchema: ['id', 'NAME', 'head', 'body', 'leg', 'avatar'],
  },
  {
    key: 'npcShop',
    title: 'Cửa hàng gắn với NPC',
    sourceClass: 'a/a/a/T',
    expectedSchema: ['id', 'npc_id', 'tag_name', 'type_shop'],
  },
  {
    key: 'shopTab',
    title: 'Tab cửa hàng',
    sourceClass: 'a/a/a/X',
    expectedSchema: ['id', 'shop_id', 'NAME'],
  },
  {
    key: 'shopItem',
    title: 'Vật phẩm trong tab cửa hàng',
    sourceClass: 'a/a/a/w',
    expectedSchema: [
      'id',
      'tab_id',
      'temp_id',
      'is_new',
      'is_sell',
      'type_sell',
      'cost',
      'icon_spec',
      'create_time',
    ],
  },
];

function normalizeColumn(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '');
}

function assertSchema(actual: string[], expected: string[], sourceClass: string): void {
  const actualNormalized = actual.map(normalizeColumn);
  const expectedNormalized = expected.map(normalizeColumn);

  if (
    actualNormalized.length !== expectedNormalized.length ||
    actualNormalized.some((value, index) => value !== expectedNormalized[index])
  ) {
    throw new Error(
      `Schema ${sourceClass}.aF không khớp cấu trúc dự kiến. ` +
        `Nhận được [${actual.join(', ')}], dự kiến [${expected.join(', ')}].`
    );
  }
}

async function readStaticStringTable(
  session: LoadedJarSession,
  spec: TableSpec
): Promise<GameDataTable> {
  const classInfo: ClassFileInfo | null = await getSessionClassInfo(session, spec.sourceClass);
  if (!classInfo) {
    throw new Error(`Không tìm thấy ${spec.sourceClass}.class trong JAR.`);
  }

  const clinit = classInfo.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) {
    throw new Error(`Không giải mã được <clinit> của ${spec.sourceClass}.class.`);
  }

  const staticAnalysis = analyzeStaticInitializer(
    clinit,
    clinit.code.instructions,
    classInfo.fields,
    classInfo.constantPool
  );

  const schemaArray = staticAnalysis.detectedArrays.find((array) => array.fieldName === 'aF');
  if (!schemaArray) {
    throw new Error(`Không tìm thấy schema aF trong ${spec.sourceClass}.class.`);
  }

  const schema = schemaArray.elements
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((element) => element.stringValue ?? '');

  assertSchema(schema, spec.expectedSchema, spec.sourceClass);

  const sourceField = classInfo.fields.find((field) => field.name === 'u');
  if (!sourceField) {
    throw new Error(`Không tìm thấy field u trong ${spec.sourceClass}.class.`);
  }

  const reconstructed = reconstructStringArrayTable(
    spec.sourceClass,
    'u',
    sourceField.descriptor,
    0,
    clinit.code.instructions,
    classInfo.constantPool,
    schema.length
  );

  if (reconstructed.parseError) {
    throw new Error(
      `Không phục dựng được ${spec.title} từ ${spec.sourceClass}.class: ${reconstructed.parseError}`
    );
  }

  return {
    key: spec.key,
    title: spec.title,
    sourceClass: spec.sourceClass,
    sourceField: 'u',
    schema,
    rows: reconstructed.rows,
  };
}

function duplicateIds(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([value, count]) => value !== '' && count > 1)
    .map(([value]) => value);
}

function resolveItemTemplate(item: ItemRecord): GameResolvedItemTemplate {
  return {
    itemId: item.id,
    name: item.name,
    description: item.description,
    sourceClass: item.sourceClass,
    sourceField: item.sourceField,
    sourceRow: item.sourceRow,
    iconId: item.rawValues[6] ?? '',
    part: item.rawValues[7] ?? '',
    head: item.rawValues[12] ?? '',
    body: item.rawValues[13] ?? '',
    leg: item.rawValues[14] ?? '',
  };
}

async function ensureItemAnalysis(session: LoadedJarSession): Promise<ItemAnalysisSessionData | null> {
  if (session.itemAnalysis) return session.itemAnalysis;
  try {
    const data = await analyzeItemTables(session);
    return data;
  } catch (err) {
    console.warn('Không phân tích được bảng Item Template cho panel Dữ liệu game:', err);
    return null;
  }
}

export async function analyzeGameData(session: LoadedJarSession): Promise<GameDataSnapshot> {
  const [npcTable, npcShopTable, shopTabTable, shopItemTable, itemAnalysis] = await Promise.all([
    readStaticStringTable(session, TABLE_SPECS[0]),
    readStaticStringTable(session, TABLE_SPECS[1]),
    readStaticStringTable(session, TABLE_SPECS[2]),
    readStaticStringTable(session, TABLE_SPECS[3]),
    ensureItemAnalysis(session),
  ]);

  const itemTemplatesById = new Map<string, GameResolvedItemTemplate>();
  if (itemAnalysis) {
    for (const item of itemAnalysis.items) {
      itemTemplatesById.set(item.id, resolveItemTemplate(item));
    }
  }

  const shopItems: GameShopItem[] = shopItemTable.rows.map((row) => ({
    rowIndex: row.rowIndex,
    id: row.values[0] ?? '',
    tabId: row.values[1] ?? '',
    tempId: row.values[2] ?? '',
    isNew: row.values[3] ?? '',
    isSell: row.values[4] ?? '',
    typeSell: row.values[5] ?? '',
    cost: row.values[6] ?? '',
    iconSpec: row.values[7] ?? '',
    createTime: row.values[8] ?? '',
    template: itemTemplatesById.get(row.values[2] ?? '') ?? null,
  }));

  const itemsByTabId = new Map<string, GameShopItem[]>();
  for (const shopItem of shopItems) {
    const list = itemsByTabId.get(shopItem.tabId) ?? [];
    list.push(shopItem);
    itemsByTabId.set(shopItem.tabId, list);
  }

  const tabs: GameNpcShopTab[] = shopTabTable.rows.map((row) => ({
    rowIndex: row.rowIndex,
    id: row.values[0] ?? '',
    shopId: row.values[1] ?? '',
    name: row.values[2] ?? '',
    items: itemsByTabId.get(row.values[0] ?? '') ?? [],
  }));

  const tabsByShopId = new Map<string, GameNpcShopTab[]>();
  for (const tab of tabs) {
    const list = tabsByShopId.get(tab.shopId) ?? [];
    list.push(tab);
    tabsByShopId.set(tab.shopId, list);
  }

  const shops: GameNpcShop[] = npcShopTable.rows.map((row) => {
    const id = row.values[0] ?? '';
    return {
      rowIndex: row.rowIndex,
      id,
      npcId: row.values[1] ?? '',
      tagName: row.values[2] ?? '',
      typeShop: row.values[3] ?? '',
      tabs: tabsByShopId.get(id) ?? [],
    };
  });

  const shopsByNpcId = new Map<string, GameNpcShop[]>();
  for (const shop of shops) {
    const list = shopsByNpcId.get(shop.npcId) ?? [];
    list.push(shop);
    shopsByNpcId.set(shop.npcId, list);
  }

  const npcs: GameNpc[] = npcTable.rows.map((row) => {
    const id = row.values[0] ?? '';
    return {
      rowIndex: row.rowIndex,
      id,
      name: row.values[1] ?? '',
      head: row.values[2] ?? '',
      body: row.values[3] ?? '',
      leg: row.values[4] ?? '',
      avatar: row.values[5] ?? '',
      shops: shopsByNpcId.get(id) ?? [],
    };
  });

  const npcIds = new Set(npcs.map((npc) => npc.id));
  const shopIds = new Set(shops.map((shop) => shop.id));
  const tabIds = new Set(tabs.map((tab) => tab.id));

  return {
    npcTable,
    npcShopTable,
    shopTabTable,
    shopItemTable,
    npcs,
    shops,
    tabs,
    shopItems,
    diagnostics: {
      orphanNpcShops: shops.filter((shop) => !npcIds.has(shop.npcId)).length,
      orphanShopTabs: tabs.filter((tab) => !shopIds.has(tab.shopId)).length,
      orphanShopItems: shopItems.filter((shopItem) => !tabIds.has(shopItem.tabId)).length,
      missingItemTemplates: shopItems.filter((shopItem) => !shopItem.template).length,
      duplicateNpcIds: duplicateIds(npcs.map((npc) => npc.id)),
      duplicateShopIds: duplicateIds(shops.map((shop) => shop.id)),
      duplicateTabIds: duplicateIds(tabs.map((tab) => tab.id)),
      duplicateShopItemIds: duplicateIds(shopItems.map((shopItem) => shopItem.id)),
    },
    itemAnalysis,
  };
}

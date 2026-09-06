import React, { useEffect, useMemo, useState } from 'react';
import {
  Database,
  Search,
  RefreshCw,
  Users,
  Store,
  Rows3,
  CheckCircle2,
  AlertTriangle,
  FileCode2,
  ChevronRight,
  Info,
  Coins,
  Gem,
  ShoppingBag,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeGameData,
  GameDataSnapshot,
  GameNpc,
  GameNpcShop,
  GameNpcShopTab,
  GameShopItem,
} from '../../services/gameDataService';
import { SmallImagePreview } from './SmallImagePreview';
import { NpcBodyPreview } from './NpcBodyPreview';

interface GameDataPanelProps {
  session: LoadedJarSession;
  onNpcDraftsUpdated?: (count: number) => void;
}

type ShopFilter = 'all' | 'with-shop' | 'without-shop';

interface NpcQuickDraft {
  name: string;
  head: string;
  body: string;
  leg: string;
  avatar: string;
}


type GameDataSession = LoadedJarSession & {
  gameNpcDrafts?: Record<string, NpcQuickDraft>;
};

function npcToDraft(npc: GameNpc): NpcQuickDraft {
  return {
    name: npc.name,
    head: npc.head,
    body: npc.body,
    leg: npc.leg,
    avatar: npc.avatar,
  };
}

function typeShopLabel(value: string): string {
  return `Mã ${value || '-'}`;
}

function formatCurrency(typeSell: string, cost: string): string {
  if (typeSell === '0') return `${Number(cost || 0).toLocaleString('vi-VN')} vàng`;
  if (typeSell === '1') return `${Number(cost || 0).toLocaleString('vi-VN')} ngọc`;
  if (typeSell === '2') return `${Number(cost || 0).toLocaleString('vi-VN')} ruby`;
  return `${cost || 0} (type_sell=${typeSell || '-'})`;
}

function getFirstShopItemKey(npc: GameNpc | null): string | null {
  if (!npc) return null;
  for (const shop of npc.shops) {
    for (const tab of shop.tabs) {
      for (const item of tab.items) {
        return `${item.id}|${item.rowIndex}`;
      }
    }
  }
  return null;
}

export function GameDataPanel({ session, onNpcDraftsUpdated }: GameDataPanelProps) {
  const [snapshot, setSnapshot] = useState<GameDataSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [shopFilter, setShopFilter] = useState<ShopFilter>('all');
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const sessionWithGameDrafts = session as GameDataSession;
  const [npcDrafts, setNpcDrafts] = useState<Record<string, NpcQuickDraft>>(
    () => sessionWithGameDrafts.gameNpcDrafts ?? {}
  );


  useEffect(() => {
    sessionWithGameDrafts.gameNpcDrafts = npcDrafts;
    onNpcDraftsUpdated?.(Object.keys(npcDrafts).length);
  }, [npcDrafts, session, onNpcDraftsUpdated]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await analyzeGameData(session);
      setSnapshot(result);

      if (!selectedNpcId && result.npcs.length > 0) {
        setSelectedNpcId(result.npcs[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [session]);

  const filteredNpcs = useMemo(() => {
    if (!snapshot) return [];

    const normalized = query.trim().toLowerCase();

    return snapshot.npcs.filter((npc) => {
      if (shopFilter === 'with-shop' && npc.shops.length === 0) return false;
      if (shopFilter === 'without-shop' && npc.shops.length > 0) return false;

      if (!normalized) return true;

      return (
        npc.id.toLowerCase().includes(normalized) ||
        npc.name.toLowerCase().includes(normalized) ||
        npc.shops.some(
          (shop) =>
            shop.id.toLowerCase().includes(normalized) ||
            shop.tagName.toLowerCase().includes(normalized) ||
            shop.tabs.some(
              (tab) =>
                tab.name.toLowerCase().includes(normalized) ||
                tab.items.some(
                  (item) =>
                    item.tempId.toLowerCase().includes(normalized) ||
                    item.template?.name.toLowerCase().includes(normalized)
                )
            )
        )
      );
    });
  }, [snapshot, query, shopFilter]);

  const selectedNpc: GameNpc | null = useMemo(() => {
    if (!snapshot || !selectedNpcId) return null;
    return snapshot.npcs.find((npc) => npc.id === selectedNpcId) ?? null;
  }, [snapshot, selectedNpcId]);

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center space-y-3">
        <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
        <h2 className="text-sm font-bold text-zinc-100">Đang đọc dữ liệu game từ bytecode...</h2>
        <p className="text-xs text-zinc-500 font-mono">
          Đang phục dựng NPC, shop, tab cửa hàng, vật phẩm bán trong shop và nối với Item Template.
        </p>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="bg-red-950/30 border border-red-800 rounded-xl p-5 space-y-3">
        <div className="flex items-start gap-2 text-red-300">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <h2 className="font-bold text-sm">Không đọc được dữ liệu game</h2>
            <p className="text-xs font-mono mt-1 whitespace-pre-wrap">{error}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 rounded bg-red-900/70 hover:bg-red-800 text-red-100 text-xs font-mono cursor-pointer"
        >
          Thử đọc lại
        </button>
      </div>
    );
  }

  const diagnostics = snapshot.diagnostics;
  const hasRelationshipWarning =
    diagnostics.orphanNpcShops > 0 ||
    diagnostics.orphanShopTabs > 0 ||
    diagnostics.orphanShopItems > 0 ||
    diagnostics.missingItemTemplates > 0 ||
    diagnostics.duplicateNpcIds.length > 0 ||
    diagnostics.duplicateShopIds.length > 0 ||
    diagnostics.duplicateTabIds.length > 0 ||
    diagnostics.duplicateShopItemIds.length > 0;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-cyan-400" />
              <h2 className="text-base font-bold text-zinc-100">Dữ liệu game</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-800/60">
                NPC + Shop + Vật phẩm
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-3xl leading-relaxed">
              Panel này đang đọc dữ liệu thật trong JAR: NPC → shop → tab cửa hàng → vật phẩm shop đang bán.
              Ngoài ID kỹ thuật và nguồn class/row, avatar NPC và icon vật phẩm được giải mã đúng theo
              smallimage.idx → smallimage-*.pack, cùng chi tiết Item Template của món đồ khi bấm vào.
            </p>
          </div>

          <div
            className={`px-3 py-2 rounded-lg border text-xs font-mono flex items-center gap-2 ${
              hasRelationshipWarning
                ? 'bg-amber-950/30 border-amber-800/60 text-amber-300'
                : 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
            }`}
          >
            {hasRelationshipWarning ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>
              {hasRelationshipWarning
                ? 'Có liên kết / template cần kiểm tra'
                : 'Liên kết NPC / shop / tab / item hợp lệ'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
          <MetricCard
            icon={<Users className="w-4 h-4 text-cyan-400" />}
            label="NPC"
            value={snapshot.npcs.length}
            source="a/a/a/B.class"
          />
          <MetricCard
            icon={<Store className="w-4 h-4 text-amber-400" />}
            label="Cấu hình shop NPC"
            value={snapshot.shops.length}
            source="a/a/a/T.class"
          />
          <MetricCard
            icon={<Rows3 className="w-4 h-4 text-purple-400" />}
            label="Tab cửa hàng"
            value={snapshot.tabs.length}
            source="a/a/a/X.class"
          />
          <MetricCard
            icon={<ShoppingBag className="w-4 h-4 text-emerald-400" />}
            label="Dòng bán trong shop"
            value={snapshot.shopItems.length}
            source="a/a/a/w.class"
          />
          <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
              Kiểm tra quan hệ
            </div>
            <div className="mt-1 text-xs text-zinc-300 font-mono space-y-0.5">
              <div>
                Shop mồ côi:{' '}
                <strong className={diagnostics.orphanNpcShops ? 'text-amber-400' : 'text-emerald-400'}>
                  {diagnostics.orphanNpcShops}
                </strong>
              </div>
              <div>
                Tab mồ côi:{' '}
                <strong className={diagnostics.orphanShopTabs ? 'text-amber-400' : 'text-emerald-400'}>
                  {diagnostics.orphanShopTabs}
                </strong>
              </div>
              <div>
                Item mồ côi:{' '}
                <strong className={diagnostics.orphanShopItems ? 'text-amber-400' : 'text-emerald-400'}>
                  {diagnostics.orphanShopItems}
                </strong>
              </div>
              <div>
                Thiếu template:{' '}
                <strong className={diagnostics.missingItemTemplates ? 'text-amber-400' : 'text-emerald-400'}>
                  {diagnostics.missingItemTemplates}
                </strong>
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 text-[11px] font-mono text-zinc-400">
          <div className="flex items-center gap-1.5 text-zinc-300 font-semibold mb-1.5">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>Schema đã xác minh trong JAR</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <SchemaBadge
              label="NPC"
              value={`${snapshot.npcTable.sourceClass}.u → ${snapshot.npcTable.schema.join(' | ')}`}
            />
            <SchemaBadge
              label="SHOP"
              value={`${snapshot.npcShopTable.sourceClass}.u → ${snapshot.npcShopTable.schema.join(' | ')}`}
            />
            <SchemaBadge
              label="TAB"
              value={`${snapshot.shopTabTable.sourceClass}.u → ${snapshot.shopTabTable.schema.join(' | ')}`}
            />
            <SchemaBadge
              label="SHOP ITEM"
              value={`${snapshot.shopItemTable.sourceClass}.u → ${snapshot.shopItemTable.schema.join(' | ')}`}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-4 bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-zinc-800 bg-zinc-950/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Danh sách NPC</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500">
                {filteredNpcs.length} / {snapshot.npcs.length}
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm theo ID, tên NPC, tên item shop..."
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-600 font-mono"
              />
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-mono">
              <FilterButton
                active={shopFilter === 'all'}
                onClick={() => setShopFilter('all')}
                label="Tất cả"
              />
              <FilterButton
                active={shopFilter === 'with-shop'}
                onClick={() => setShopFilter('with-shop')}
                label="Có shop"
              />
              <FilterButton
                active={shopFilter === 'without-shop'}
                onClick={() => setShopFilter('without-shop')}
                label="Không shop"
              />
            </div>
          </div>

          <div className="max-h-[820px] overflow-y-auto">
            {filteredNpcs.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500 font-mono">
                Không tìm thấy NPC phù hợp.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-950 text-zinc-500 font-mono text-[10px] uppercase z-10">
                  <tr>
                    <th className="px-3 py-2 text-left w-14">ID</th>
                    <th className="px-3 py-2 text-left">NPC</th>
                    <th className="px-3 py-2 text-center w-16">Shop</th>
                    <th className="px-3 py-2 text-center w-20">Món bán</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredNpcs.map((npc) => {
                    const selected = npc.id === selectedNpcId;
                    const totalItems = npc.shops.reduce(
                      (shopAcc, shop) =>
                        shopAcc + shop.tabs.reduce((tabAcc, tab) => tabAcc + tab.items.length, 0),
                      0
                    );
                    return (
                      <tr
                        key={`${npc.id}-${npc.rowIndex}`}
                        onClick={() => setSelectedNpcId(npc.id)}
                        className={`cursor-pointer transition-colors ${
                          selected
                            ? 'bg-cyan-500/10 border-l-2 border-cyan-400'
                            : 'hover:bg-zinc-800/60'
                        }`}
                      >
                        <td className="px-3 py-2 font-mono font-bold text-cyan-400">
                          {npc.id}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
                            <span>{npcDrafts[npc.id]?.name || npc.name || '(không tên)'}</span>
                            {npcDrafts[npc.id] && (
                              <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-[9px] font-mono">
                                NHÁP
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono">
                            row {npc.rowIndex} · avatar {npc.avatar}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {npc.shops.length > 0 ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono text-[10px]">
                              {npc.shops.length}
                            </span>
                          ) : (
                            <span className="text-zinc-700">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {totalItems > 0 ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono text-[10px]">
                              {totalItems}
                            </span>
                          ) : (
                            <span className="text-zinc-700">—</span>
                          )}
                        </td>
                        <td className="pr-2 text-zinc-600">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="xl:col-span-8 bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
          {selectedNpc ? (
            <NpcDetail
              npc={selectedNpc}
              session={session}
              savedDraft={npcDrafts[selectedNpc.id]}
              onSaveDraft={(draft) =>
                setNpcDrafts((current) => ({ ...current, [selectedNpc.id]: draft }))
              }
              onDiscardDraft={() =>
                setNpcDrafts((current) => {
                  const next = { ...current };
                  delete next[selectedNpc.id];
                  return next;
                })
              }
            />
          ) : (
            <div className="min-h-[420px] flex items-center justify-center text-xs text-zinc-500 font-mono">
              Chọn một NPC để xem chi tiết.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  source,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  source: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl font-bold text-zinc-100 mt-1">{value.toLocaleString('vi-VN')}</div>
      <div className="text-[10px] text-zinc-600 font-mono mt-0.5">{source}</div>
    </div>
  );
}

function SchemaBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
      <strong className="text-cyan-400">{label}:</strong> {value}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md border cursor-pointer transition-colors ${
        active
          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
          : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );
}

function NpcDetail({
  npc,
  session,
  savedDraft,
  onSaveDraft,
  onDiscardDraft,
}: {
  npc: GameNpc;
  session: LoadedJarSession;
  savedDraft?: NpcQuickDraft;
  onSaveDraft: (draft: NpcQuickDraft) => void;
  onDiscardDraft: () => void;
}) {
  const [selectedShopItemKey, setSelectedShopItemKey] = useState<string | null>(getFirstShopItemKey(npc));
  const [draft, setDraft] = useState<NpcQuickDraft>(savedDraft ?? npcToDraft(npc));

  useEffect(() => {
    setSelectedShopItemKey(getFirstShopItemKey(npc));
  }, [npc.id]);

  useEffect(() => {
    setDraft(savedDraft ?? npcToDraft(npc));
  }, [npc.id, savedDraft?.name, savedDraft?.head, savedDraft?.body, savedDraft?.leg, savedDraft?.avatar]);

  const selectedShopItem = useMemo(() => {
    for (const shop of npc.shops) {
      for (const tab of shop.tabs) {
        for (const item of tab.items) {
          const key = `${item.id}|${item.rowIndex}`;
          if (key === selectedShopItemKey) return item;
        }
      }
    }
    return null;
  }, [npc, selectedShopItemKey]);

  const totalTabs = npc.shops.reduce((sum, shop) => sum + shop.tabs.length, 0);
  const totalItems = npc.shops.reduce(
    (shopAcc, shop) =>
      shopAcc + shop.tabs.reduce((tabAcc, tab) => tabAcc + tab.items.length, 0),
    0
  );

  const originalDraft = npcToDraft(npc);
  const isDirty =
    draft.name !== originalDraft.name ||
    draft.head !== originalDraft.head ||
    draft.body !== originalDraft.body ||
    draft.leg !== originalDraft.leg ||
    draft.avatar !== originalDraft.avatar;

  const numericFields: Array<keyof Pick<NpcQuickDraft, 'head' | 'body' | 'leg' | 'avatar'>> = [
    'head',
    'body',
    'leg',
    'avatar',
  ];
  const invalidNumericFields = numericFields.filter(
    (field) => !/^\d+$/.test(draft[field].trim())
  );
  const canSaveDraft = draft.name.trim().length > 0 && invalidNumericFields.length === 0;

  const updateDraft = (field: keyof NpcQuickDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="p-4 space-y-4 max-h-[900px] overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-xs font-mono font-bold">
              NPC #{npc.id}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              a/a/a/B.class · u[row {npc.rowIndex}]
            </span>
            {savedDraft && (
              <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 text-[10px] font-mono font-bold">
                CÓ NHÁP RAM
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold text-zinc-100 mt-1">{draft.name || '(không tên)'}</h3>
        </div>

        <div className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-500 font-mono flex items-center gap-1">
          <FileCode2 className="w-3.5 h-3.5" />
          <span>Nguồn bytecode đã xác định</span>
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
        <div className="2xl:col-span-2 space-y-3">
          <NpcBodyPreview
            session={session}
            head={draft.head}
            body={draft.body}
            leg={draft.leg}
            alt={`Toàn thân NPC ${draft.name}`}
            showTechnicalInfo
          />

          <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80">
              <div className="text-sm font-bold text-zinc-100">Avatar hội thoại</div>
              <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                avatar={draft.avatar} → SmallImage
              </div>
            </div>
            <div className="p-3">
              <SmallImagePreview
                session={session}
                imageId={draft.avatar}
                alt={`Avatar NPC ${draft.name}`}
                variant="hero"
                showTechnicalInfo
              />
            </div>
          </div>
        </div>

        <div className="2xl:col-span-3 space-y-3">
          <div className="rounded-xl border border-cyan-900/60 bg-cyan-950/10 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-cyan-900/50 bg-cyan-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-zinc-100">Sửa nhanh NPC</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Preview toàn thân và avatar cập nhật ngay khi thay part. ID NPC tạm khóa để không làm đứt liên kết shop.
                </div>
              </div>
              <div className="text-[10px] font-mono text-amber-300 px-2 py-1 rounded border border-amber-800/50 bg-amber-950/30">
                Nháp RAM · chưa ghi JAR
              </div>
            </div>

            <div className="p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <QuickEditField
                  label="ID NPC"
                  technical="id"
                  value={npc.id}
                  disabled
                  helper="Khóa để bảo toàn liên kết shop / map"
                />
                <QuickEditField
                  label="Tên NPC"
                  technical="NAME"
                  value={draft.name}
                  onChange={(value) => updateDraft('name', value)}
                  invalid={draft.name.trim().length === 0}
                />
                <QuickEditField
                  label="Part đầu"
                  technical="head"
                  value={draft.head}
                  onChange={(value) => updateDraft('head', value)}
                  invalid={invalidNumericFields.includes('head')}
                  helper="Preview dùng Part Data thật"
                  numeric
                />
                <QuickEditField
                  label="Part thân"
                  technical="body"
                  value={draft.body}
                  onChange={(value) => updateDraft('body', value)}
                  invalid={invalidNumericFields.includes('body')}
                  numeric
                />
                <QuickEditField
                  label="Part chân"
                  technical="leg"
                  value={draft.leg}
                  onChange={(value) => updateDraft('leg', value)}
                  invalid={invalidNumericFields.includes('leg')}
                  numeric
                />
                <QuickEditField
                  label="Avatar"
                  technical="avatar"
                  value={draft.avatar}
                  onChange={(value) => updateDraft('avatar', value)}
                  invalid={invalidNumericFields.includes('avatar')}
                  helper="SmallImage dùng trong hội thoại"
                  numeric
                />
              </div>

              {!canSaveDraft && (
                <div className="px-3 py-2 rounded-lg bg-red-950/30 border border-red-900/60 text-[11px] text-red-300 font-mono">
                  Tên không được trống; head/body/leg/avatar phải là số nguyên không âm.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-[10px] text-zinc-500 font-mono">
                  {isDirty ? 'Có thay đổi so với JAR gốc.' : 'Dữ liệu đang khớp JAR gốc.'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(originalDraft);
                      onDiscardDraft();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-mono cursor-pointer transition-colors"
                  >
                    Hoàn tác về gốc
                  </button>
                  <button
                    type="button"
                    disabled={!canSaveDraft || !isDirty}
                    onClick={() => onSaveDraft({ ...draft })}
                    className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:border-zinc-700 text-white border border-cyan-500 text-xs font-bold font-mono cursor-pointer disabled:cursor-not-allowed transition-colors"
                  >
                    Lưu nháp (RAM)
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <FieldBox label="Số shop" technical="derived" value={String(npc.shops.length)} />
            <FieldBox label="Số tab shop" technical="derived" value={String(totalTabs)} />
            <FieldBox label="Tổng món đang bán" technical="derived" value={String(totalItems)} />
          </div>
        </div>
      </div>

      {selectedShopItem && (
        <SelectedItemDetail item={selectedShopItem} session={session} />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-bold">
            Cửa hàng liên kết ({npc.shops.length})
          </div>
          {npc.shops.length === 0 && (
            <span className="text-[10px] text-zinc-600 font-mono">NPC này không có shop trong bảng T.u</span>
          )}
        </div>

        {npc.shops.map((shop) => (
          <ShopCard
            key={`${shop.id}-${shop.rowIndex}`}
            shop={shop}
            session={session}
            onSelectItem={(item) => setSelectedShopItemKey(`${item.id}|${item.rowIndex}`)}
            selectedItemKey={selectedShopItemKey}
          />
        ))}
      </div>
    </div>
  );
}

function QuickEditField({
  label,
  technical,
  value,
  onChange,
  disabled = false,
  invalid = false,
  helper,
  numeric = false,
}: {
  label: string;
  technical: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  helper?: string;
  numeric?: boolean;
}) {
  return (
    <label className="block rounded-lg bg-zinc-950/70 border border-zinc-800 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-mono font-semibold">
          {label}
        </span>
        <span className="text-[9px] text-zinc-700 font-mono">{technical}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {numeric && !disabled && (
          <button
            type="button"
            onClick={() => {
              const current = /^\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : 0;
              onChange?.(String(Math.max(0, current - 1)));
            }}
            className="w-7 h-7 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono cursor-pointer"
            title={`Giảm ${label} 1 đơn vị`}
          >
            −
          </button>
        )}
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
          className={`min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none border ${
            invalid
              ? 'bg-red-950/30 border-red-700 text-red-200 focus:border-red-500'
              : disabled
              ? 'bg-zinc-900/70 border-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-cyan-500'
          }`}
        />
        {numeric && !disabled && (
          <button
            type="button"
            onClick={() => {
              const current = /^\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : 0;
              onChange?.(String(current + 1));
            }}
            className="w-7 h-7 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono cursor-pointer"
            title={`Tăng ${label} 1 đơn vị`}
          >
            +
          </button>
        )}
      </div>
      {helper && <div className="text-[9px] text-zinc-600 font-mono">{helper}</div>}
    </label>
  );
}

function SelectedItemDetail({
  item,
  session,
}: {
  item: GameShopItem;
  session: LoadedJarSession;
}) {
  const template = item.template;

  return (
    <div className="rounded-xl bg-zinc-950/80 border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-mono font-bold">
            Vật phẩm đang chọn
          </div>
          <div className="text-base font-bold text-zinc-100">
            {template?.name || `Template #${item.tempId}`}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
            shop_item row {item.rowIndex} · id={item.id} · tab_id={item.tabId}
          </div>
        </div>

        <div className="text-xs font-mono flex items-center gap-2">
          <span className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 flex items-center gap-1">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            {formatCurrency(item.typeSell, item.cost)}
          </span>
          {item.isNew === '1' && (
            <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              Mới
            </span>
          )}
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-2">
          <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80">
              <div className="text-sm font-bold text-zinc-100">Icon vật phẩm</div>
              <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                temp_id={item.tempId} → icon_id={template?.iconId ?? '?'} → SmallImage
              </div>
            </div>
            <div className="p-3">
              <SmallImagePreview
                session={session}
                imageId={template?.iconId}
                alt={template?.name || `Vật phẩm #${item.tempId}`}
                variant="hero"
                showTechnicalInfo
              />
            </div>
          </div>
        </div>

        <div className="xl:col-span-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <FieldBox label="Template ID" technical="temp_id" value={item.tempId} />
            <FieldBox label="Icon ID" technical="icon_id" value={template?.iconId ?? '—'} />
            <FieldBox label="Giá" technical="cost" value={item.cost} />
            <FieldBox label="Loại tiền" technical="type_sell" value={item.typeSell} />
            <FieldBox label="is_sell" technical="is_sell" value={item.isSell} />
            <FieldBox label="icon_spec" technical="icon_spec" value={item.iconSpec} />
          </div>

          <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-bold mb-1.5">
              Thông tin Item Template
            </div>

            {template ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-bold text-zinc-100">{template.name || '(chưa có tên)'}</div>
                  <div className="text-[11px] text-zinc-400 leading-relaxed mt-1 whitespace-pre-wrap">
                    {template.description || 'Không có mô tả'}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <FieldBox label="Nguồn class" technical="sourceClass" value={template.sourceClass} />
                  <FieldBox label="Dòng nguồn" technical="sourceRow" value={String(template.sourceRow)} />
                  <FieldBox label="Field nguồn" technical="sourceField" value={template.sourceField} />
                  <FieldBox label="Part" technical="part" value={template.part} />
                  <FieldBox label="Head" technical="head" value={template.head} />
                  <FieldBox label="Body / Leg" technical="body · leg" value={`${template.body} / ${template.leg}`} />
                </div>
              </div>
            ) : (
              <div className="text-xs text-amber-300 font-mono">
                Không tìm thấy Item Template tương ứng với temp_id={item.tempId}.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldBox({
  label,
  technical,
  value,
}: {
  label: string;
  technical: string;
  value: string;
}) {
  return (
    <div className="p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-800 min-w-0">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-zinc-500 uppercase font-mono">{label}</span>
        <span className="text-[9px] text-zinc-700 font-mono">{technical}</span>
      </div>
      <div className="text-xs text-zinc-100 font-mono font-semibold mt-1 break-all">
        {value || '—'}
      </div>
    </div>
  );
}

function ShopCard({
  shop,
  session,
  onSelectItem,
  selectedItemKey,
}: {
  shop: GameNpcShop;
  session: LoadedJarSession;
  onSelectItem: (item: GameShopItem) => void;
  selectedItemKey: string | null;
}) {
  const totalItems = shop.tabs.reduce((sum, tab) => sum + tab.items.length, 0);

  return (
    <div className="rounded-lg bg-zinc-950/70 border border-zinc-800 overflow-hidden">
      <div className="p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2 border-b border-zinc-800/70">
        <div className="flex items-center gap-2 flex-wrap">
          <Store className="w-4 h-4 text-amber-400" />
          <span className="font-bold text-zinc-100 font-mono">Shop #{shop.id}</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-mono">
            {shop.tagName || '(không tag)'}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 text-[10px] font-mono">
            {totalItems} món
          </span>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono">
          a/a/a/T.class · row {shop.rowIndex} · type_shop={typeShopLabel(shop.typeShop)}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {shop.tabs.length === 0 ? (
          <div className="text-[11px] text-zinc-600 font-mono">
            Không tìm thấy tab nào trong a/a/a/X.class cho shop này.
          </div>
        ) : (
          shop.tabs.map((tab) => (
            <ShopTabCard
              key={`${tab.id}-${tab.rowIndex}`}
              tab={tab}
              session={session}
              onSelectItem={onSelectItem}
              selectedItemKey={selectedItemKey}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ShopTabCard({
  tab,
  session,
  onSelectItem,
  selectedItemKey,
}: {
  tab: GameNpcShopTab;
  session: LoadedJarSession;
  onSelectItem: (item: GameShopItem) => void;
  selectedItemKey: string | null;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rows3 className="w-4 h-4 text-purple-400" />
          <span className="font-semibold text-zinc-100">{tab.name || '(không tên tab)'}</span>
          <span className="text-[10px] font-mono text-zinc-500">tab #{tab.id}</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/25">
          {tab.items.length} món
        </span>
      </div>

      <div className="p-3">
        {tab.items.length === 0 ? (
          <div className="text-[11px] text-zinc-600 font-mono">
            Tab này hiện chưa có dòng bán hàng trong a/a/a/w.class.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {tab.items.map((item) => {
              const key = `${item.id}|${item.rowIndex}`;
              const active = key === selectedItemKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectItem(item)}
                  className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-zinc-950/80 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-950'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0">
                      <SmallImagePreview
                        session={session}
                        imageId={item.template?.iconId}
                        alt={item.template?.name || `Vật phẩm #${item.tempId}`}
                        variant="icon"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold text-zinc-100 truncate">
                          {item.template?.name || `Template #${item.tempId}`}
                        </div>
                        {item.isNew === '1' && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-300 font-mono">
                            Mới
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                        shop_item #{item.id} · temp_id={item.tempId} · icon_id={item.template?.iconId ?? '?'}
                      </div>
                      <div className="text-[11px] text-zinc-300 font-mono mt-1 flex items-center gap-1.5">
                        {item.typeSell === '1' ? (
                          <Gem className="w-3.5 h-3.5 text-cyan-400" />
                        ) : (
                          <Coins className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        <span>{formatCurrency(item.typeSell, item.cost)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

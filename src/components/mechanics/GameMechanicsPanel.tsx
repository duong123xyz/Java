import React, { useEffect, useMemo, useState } from 'react';
import {
  SlidersHorizontal,
  Zap,
  Shield,
  Coins,
  Map,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Info,
  Link2,
  PackageSearch,
  Search,
  Target,
  Plus,
  Trash2,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeGameMechanics,
  DropMechanic,
  GameMechanicsDraft,
  GameMechanicsSnapshot,
  GenericMobDropRule,
  getGameMechanicsDraft,
  getGameMechanicsDirtyCount,
  normalizeChance,
  normalizeMultiplier,
  normalizeQuantity,
  resetGameMechanicsDraft,
  setGameMechanicsDraft,
} from '../../services/gameMechanicsService';
import { SmallImagePreview } from '../game-data/SmallImagePreview';

interface GameMechanicsPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type PanelView = 'core' | 'drops';
type DropGroup = 'all' | 'common' | 'conditional' | 'special';

const PRESETS = [0.5, 1, 2, 5, 10, 100, 1000];

export function GameMechanicsPanel({ session, onDraftsUpdated }: GameMechanicsPanelProps) {
  const [snapshot, setSnapshot] = useState<GameMechanicsSnapshot | null>(null);
  const [draft, setDraft] = useState<GameMechanicsDraft>(() => getGameMechanicsDraft(session));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>('drops');
  const [dropGroup, setDropGroup] = useState<DropGroup>('all');
  const [dropQuery, setDropQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeGameMechanics(session);
      setSnapshot(result);
      setDraft(getGameMechanicsDraft(session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [session]);

  const dirtyCount = useMemo(() => getGameMechanicsDirtyCount(draft), [draft]);

  useEffect(() => {
    setGameMechanicsDraft(session, draft);
    onDraftsUpdated?.(dirtyCount);
  }, [session, draft, dirtyCount, onDraftsUpdated]);

  const updateMultiplier = (
    key: keyof Pick<GameMechanicsDraft, 'tnsmMultiplier' | 'powerCapMultiplier' | 'treasureRewardMultiplier' | 'desiredGlobalGoldMultiplier'>,
    value: number
  ) => {
    setDraft((current) => ({ ...current, [key]: normalizeMultiplier(value) }));
  };

  const updateTnsmLevelLimit = (enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      tnsmLevelLimitEnabled: enabled,
    }));
  };

  const updateDropChance = (key: string, value: number) => {
    setDraft((current) => ({
      ...current,
      dropChancePercent: { ...current.dropChancePercent, [key]: normalizeChance(value) },
    }));
  };

  const updateDropQuantity = (key: string, value: number) => {
    setDraft((current) => ({
      ...current,
      dropQuantity: { ...current.dropQuantity, [key]: normalizeQuantity(value) },
    }));
  };

  const addCustomMobDrop = () => {
    const rule: GenericMobDropRule = {
      id: `custom-drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      enabled: true,
      itemId: 77,
      quantity: 1,
      chancePercent: 100,
      mobType: null,
      mapId: null,
    };
    setDraft((current) => ({
      ...current,
      customMobDrops: [...(current.customMobDrops ?? []), rule],
    }));
  };

  const updateCustomMobDrop = (id: string, patch: Partial<GenericMobDropRule>) => {
    setDraft((current) => ({
      ...current,
      customMobDrops: (current.customMobDrops ?? []).map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule
      ),
    }));
  };

  const removeCustomMobDrop = (id: string) => {
    setDraft((current) => ({
      ...current,
      customMobDrops: (current.customMobDrops ?? []).filter((rule) => rule.id !== id),
    }));
  };

  const handleReset = () => {
    resetGameMechanicsDraft(session);
    setDraft(getGameMechanicsDraft(session));
  };

  const filteredDrops = useMemo(() => {
    if (!snapshot) return [];
    const q = dropQuery.trim().toLowerCase();
    return snapshot.mobDrops.filter((drop) => {
      if (dropGroup !== 'all' && drop.group !== dropGroup) return false;
      if (!q) return true;
      return (
        drop.title.toLowerCase().includes(q) ||
        drop.description.toLowerCase().includes(q) ||
        drop.condition.toLowerCase().includes(q) ||
        drop.items.some((item) => item.id.toLowerCase().includes(q) || item.name.toLowerCase().includes(q))
      );
    });
  }, [snapshot, dropGroup, dropQuery]);

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center space-y-3">
        <RefreshCw className="w-6 h-6 text-violet-400 animate-spin mx-auto" />
        <div className="text-sm font-bold text-zinc-100">Đang rà toàn bộ cơ chế reward / drop...</div>
        <div className="text-xs font-mono text-zinc-500">Đang resolve Constant Pool, luồng quái chết, RNG, item drop, TNSM, power cap và các patch đặc biệt.</div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="bg-red-950/30 border border-red-800 rounded-xl p-5 space-y-3">
        <div className="flex items-start gap-2 text-red-300">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <div className="font-bold text-sm">Không đọc được cơ chế game</div>
            <div className="text-xs font-mono mt-1 whitespace-pre-wrap">{error}</div>
          </div>
        </div>
        <button type="button" onClick={load} className="px-3 py-1.5 rounded bg-red-900/70 hover:bg-red-800 text-red-100 text-xs font-mono cursor-pointer">Thử lại</button>
      </div>
    );
  }

  const verifiedDrops = snapshot.mobDrops.filter((drop) => drop.source.detected).length;
  const editableDrops = snapshot.mobDrops.filter((drop) => drop.editableChance).length;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <SlidersHorizontal className="w-5 h-5 text-violet-400" />
              <h2 className="text-base font-bold text-zinc-100">Cơ chế game</h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 font-mono">{dirtyCount} cấu hình nháp</span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-4xl leading-relaxed">
              Multiplier không còn bị giới hạn giả ở x100. Panel giữ nguyên giá trị bạn nhập và writer sẽ chỉ chặn khi vượt giới hạn thật của kiểu JVM đang được patch.
            </p>
          </div>
          <button type="button" onClick={handleReset} disabled={dirtyCount === 0} className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-zinc-200 flex items-center gap-1.5 cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" />Hoàn tác tất cả
          </button>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
          <SummaryMetric label="Rule drop đã đọc" value={snapshot.mobDrops.length} detail={`${verifiedDrops} đã xác minh bytecode`} />
          <SummaryMetric label="Drop cho chỉnh nháp" value={editableDrops} detail="chance / quantity" />
          <SummaryMetric label="TNSM coefficient" value={snapshot.tnsm.baseHpCoefficient} detail={snapshot.tnsm.source.detected ? 'Đã resolve Constant Pool' : 'Chưa xác minh'} />
          <SummaryMetric label="Power cap" value={snapshot.powerCap.baseCap.toLocaleString('vi-VN')} detail={`${snapshot.powerCap.sources.filter((source) => source.detected).length} method tham chiếu`} />
        </div>

        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-zinc-950 border border-zinc-800 w-fit">
          <ViewButton active={view === 'drops'} onClick={() => setView('drops')} icon={<PackageSearch className="w-3.5 h-3.5" />} label={`Drop quái & Ngọc (${snapshot.mobDrops.length})`} />
          <ViewButton active={view === 'core'} onClick={() => setView('core')} icon={<Zap className="w-3.5 h-3.5" />} label="Hệ số & trần kỹ thuật" />
        </div>
      </div>

      {view === 'drops' ? (
        <DropMechanicsView session={session} drops={filteredDrops} allDrops={snapshot.mobDrops} draft={draft} dropGroup={dropGroup} setDropGroup={setDropGroup} query={dropQuery} setQuery={setDropQuery} onChanceChange={updateDropChance} onQuantityChange={updateDropQuantity} onAddCustomDrop={addCustomMobDrop} onUpdateCustomDrop={updateCustomMobDrop} onRemoveCustomDrop={removeCustomMobDrop} />
      ) : (
        <CoreMechanicsView
          snapshot={snapshot}
          draft={draft}
          updateMultiplier={updateMultiplier}
          onTnsmLevelLimitChange={updateTnsmLevelLimit}
        />
      )}
    </div>
  );
}

function DropMechanicsView({ session, drops, allDrops, draft, dropGroup, setDropGroup, query, setQuery, onChanceChange, onQuantityChange, onAddCustomDrop, onUpdateCustomDrop, onRemoveCustomDrop }: {
  session: LoadedJarSession;
  drops: DropMechanic[];
  allDrops: DropMechanic[];
  draft: GameMechanicsDraft;
  dropGroup: DropGroup;
  setDropGroup: (group: DropGroup) => void;
  query: string;
  setQuery: (query: string) => void;
  onChanceChange: (key: string, value: number) => void;
  onQuantityChange: (key: string, value: number) => void;
  onAddCustomDrop: () => void;
  onUpdateCustomDrop: (id: string, patch: Partial<GenericMobDropRule>) => void;
  onRemoveCustomDrop: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-emerald-950/20 border border-emerald-800/50 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="font-bold text-zinc-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />Drop item custom
            </div>
            <div className="text-[11px] text-zinc-500 mt-1 max-w-3xl leading-relaxed">
              Thêm item ID bất kỳ vào hook quái chết. Quantity dùng Java int32, không còn giới hạn iconst 1..5. Để trống Mob type / Map ID = áp dụng cho tất cả.
            </div>
          </div>
          <button type="button" onClick={onAddCustomDrop} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
            <Plus className="w-3.5 h-3.5" />Thêm drop
          </button>
        </div>

        {(draft.customMobDrops ?? []).length === 0 ? (
          <div className="text-xs font-mono text-zinc-500 border border-dashed border-zinc-700 rounded-lg p-4 text-center">Chưa có drop custom.</div>
        ) : (
          <div className="space-y-2">
            {(draft.customMobDrops ?? []).map((rule, index) => (
              <div key={rule.id} className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end bg-zinc-950/70 border border-zinc-800 rounded-lg p-3">
                <label className="text-[10px] text-zinc-500 font-mono">
                  Item ID
                  <input type="number" min={0} max={2147483647} value={rule.itemId} onChange={(e) => onUpdateCustomDrop(rule.id, { itemId: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 font-mono" />
                </label>
                <label className="text-[10px] text-zinc-500 font-mono">
                  Số lượng
                  <input type="number" min={1} max={2147483647} value={rule.quantity} onChange={(e) => onUpdateCustomDrop(rule.id, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 font-mono" />
                </label>
                <label className="text-[10px] text-zinc-500 font-mono">
                  Tỷ lệ %
                  <input type="number" min={0} max={100} step={0.001} value={rule.chancePercent} onChange={(e) => onUpdateCustomDrop(rule.id, { chancePercent: normalizeChance(Number(e.target.value)) })} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 font-mono" />
                </label>
                <label className="text-[10px] text-zinc-500 font-mono">
                  Mob type
                  <input type="number" placeholder="Tất cả" value={rule.mobType ?? ''} onChange={(e) => onUpdateCustomDrop(rule.id, { mobType: e.target.value === '' ? null : Math.round(Number(e.target.value)) })} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 font-mono placeholder-zinc-600" />
                </label>
                <label className="text-[10px] text-zinc-500 font-mono">
                  Map ID
                  <input type="number" placeholder="Tất cả" value={rule.mapId ?? ''} onChange={(e) => onUpdateCustomDrop(rule.id, { mapId: e.target.value === '' ? null : Math.round(Number(e.target.value)) })} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 font-mono placeholder-zinc-600" />
                </label>
                <button type="button" onClick={() => onUpdateCustomDrop(rule.id, { enabled: !rule.enabled })} className={`px-2 py-1.5 rounded border text-xs font-bold cursor-pointer ${rule.enabled ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-zinc-900 border-zinc-700 text-zinc-500'}`}>
                  {rule.enabled ? 'BẬT' : 'TẮT'}
                </button>
                <button type="button" onClick={() => onRemoveCustomDrop(rule.id)} className="px-2 py-1.5 rounded border border-red-900/70 bg-red-950/30 hover:bg-red-900/40 text-red-300 text-xs flex items-center justify-center gap-1 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />Xóa #{index + 1}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="font-bold text-zinc-100 flex items-center gap-2"><Target className="w-4 h-4 text-emerald-400" />Tỷ lệ rơi đồ khi đánh quái</div>
            <div className="text-[11px] text-zinc-500 mt-1 max-w-3xl leading-relaxed">Mỗi rule có điều kiện, item ID, ảnh item, nguồn method và tỷ lệ thực tế của bytecode hiện tại.</div>
          </div>
          <div className="relative min-w-[280px]">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm Ngọc, item ID, Capsule..." className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 font-mono focus:outline-none focus:border-emerald-500" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <GroupButton active={dropGroup === 'all'} onClick={() => setDropGroup('all')} label={`Tất cả ${allDrops.length}`} />
          <GroupButton active={dropGroup === 'common'} onClick={() => setDropGroup('common')} label={`Phổ thông ${allDrops.filter((d) => d.group === 'common').length}`} />
          <GroupButton active={dropGroup === 'conditional'} onClick={() => setDropGroup('conditional')} label={`Có điều kiện ${allDrops.filter((d) => d.group === 'conditional').length}`} />
          <GroupButton active={dropGroup === 'special'} onClick={() => setDropGroup('special')} label={`Đặc biệt ${allDrops.filter((d) => d.group === 'special').length}`} />
        </div>
        <div className="p-3 rounded-lg bg-cyan-950/20 border border-cyan-800/40 text-[11px] text-cyan-200 leading-relaxed">
          <strong>Ngọc #77:</strong> JAR gốc đang rơi 100% ở luồng chính vì kết quả RNG bị bỏ. Writer hiện tại đã có logic phục hồi branch RNG khi bạn đổi tỷ lệ; nếu cấu trúc JAR không đúng pattern đã xác minh thì export sẽ bị chặn, không giả vờ thành công.
        </div>
      </div>

      {drops.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center text-xs text-zinc-500 font-mono">Không có rule drop phù hợp bộ lọc.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {drops.map((drop) => (
            <DropCard key={drop.key} session={session} drop={drop} chance={draft.dropChancePercent[drop.key] ?? drop.baseChancePercent} quantity={draft.dropQuantity[drop.key] ?? drop.quantity ?? 1} onChanceChange={(value) => onChanceChange(drop.key, value)} onQuantityChange={(value) => onQuantityChange(drop.key, value)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DropCard({ session, drop, chance, quantity, onChanceChange, onQuantityChange }: {
  session: LoadedJarSession;
  drop: DropMechanic;
  chance: number;
  quantity: number;
  onChanceChange: (value: number) => void;
  onQuantityChange: (value: number) => void;
}) {
  const changedChance = Math.abs(chance - drop.baseChancePercent) > 0.000001;
  const changedQuantity = drop.quantity !== undefined && quantity !== drop.quantity;
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-bold text-zinc-100">{drop.title}</div>
              <DropGroupBadge group={drop.group} />
              {(changedChance || changedQuantity) && <span className="px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 text-[10px] font-mono">Đã chỉnh nháp</span>}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{drop.description}</div>
          </div>
          <VerificationBadge detected={drop.source.detected} />
        </div>
      </div>
      <div className="p-4 space-y-3">
        {drop.items.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {drop.items.map((item) => (
              <div key={item.id} className="min-w-[150px] p-2 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center gap-2">
                <SmallImagePreview session={session} imageId={item.iconId} alt={item.name} variant="icon" />
                <div className="min-w-0"><div className="text-xs font-semibold text-zinc-100 truncate" title={item.name}>{item.name}</div><div className="text-[10px] text-zinc-500 font-mono">item #{item.id} · icon {item.iconId || '?'}</div></div>
              </div>
            ))}
          </div>
        )}
        {drop.editableChance ? <ChanceEditor original={drop.baseChancePercent} value={chance} onChange={onChanceChange} /> : (
          <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono flex items-center justify-between gap-2"><span className="text-zinc-500">Tổng xác suất nhánh</span><strong className="text-emerald-300">{formatPercent(drop.baseChancePercent)}</strong></div>
        )}
        {drop.editableQuantity && drop.quantity !== undefined && (
          <div className="grid grid-cols-[1fr_150px] gap-2 items-center">
            <div className="text-[11px] text-zinc-500 font-mono">Số lượng mỗi lần rơi <span className="ml-2 text-zinc-700">gốc {drop.quantity}</span></div>
            <input type="number" min="1" value={quantity} onChange={(event) => onQuantityChange(Number(event.target.value))} className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-violet-500" />
          </div>
        )}
        {drop.distribution && (
          <div className="rounded-lg overflow-hidden border border-zinc-800">
            {drop.distribution.map((entry) => <div key={entry.label} className="px-3 py-2 bg-zinc-950/70 border-b last:border-b-0 border-zinc-800 flex items-center justify-between gap-2 text-xs"><span className="text-zinc-300">{entry.label}</span><strong className="text-amber-300 font-mono">{formatPercent(entry.chancePercent)}</strong></div>)}
          </div>
        )}
        <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1"><div className="text-[10px] uppercase tracking-wider text-zinc-600 font-mono">Điều kiện thật</div><div className="text-[11px] text-zinc-300 leading-relaxed">{drop.condition}</div></div>
        <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-mono"><div className={drop.source.detected ? 'text-emerald-300' : 'text-amber-300'}>{drop.source.className}.{drop.source.methodName}{drop.source.offset !== undefined ? ` @ ${drop.source.offset}` : ''}</div><div className="text-zinc-600 mt-0.5 leading-relaxed">{drop.source.detail}</div></div>
        {drop.notes?.map((note) => <div key={note} className="text-[10px] text-zinc-500 font-mono leading-relaxed">• {note}</div>)}
      </div>
    </div>
  );
}

function ChanceEditor({ original, value, onChange }: { original: number; value: number; onChange: (value: number) => void }) {
  const changed = Math.abs(original - value) > 0.000001;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2"><span className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">Tỷ lệ rơi</span><div className="text-xs font-mono"><span className="text-zinc-500">{formatPercent(original)}</span><span className="text-zinc-700 mx-1.5">→</span><strong className={changed ? 'text-violet-300' : 'text-emerald-300'}>{formatPercent(value)}</strong></div></div>
      <div className="flex items-center gap-2">
        <input type="range" min="0" max="100" step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value))} className="flex-1 accent-violet-500" />
        <div className="relative w-24"><input type="number" min="0" max="100" step="0.001" value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pr-6 pl-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-violet-500" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 text-xs">%</span></div>
      </div>
    </div>
  );
}

function CoreMechanicsView({
  snapshot,
  draft,
  updateMultiplier,
  onTnsmLevelLimitChange,
}: {
  snapshot: GameMechanicsSnapshot;
  draft: GameMechanicsDraft;
  updateMultiplier: (
    key: 'tnsmMultiplier' | 'powerCapMultiplier' | 'treasureRewardMultiplier' | 'desiredGlobalGoldMultiplier',
    value: number
  ) => void;
  onTnsmLevelLimitChange: (enabled: boolean) => void;
}) {
  const effectiveTnsmCoefficient = snapshot.tnsm.baseHpCoefficient * draft.tnsmMultiplier;
  const effectivePowerCap = snapshot.powerCap.baseCap * draft.powerCapMultiplier;
  const treasureLevel1 = snapshot.treasureReward.basePercentAtLevel1 * draft.treasureRewardMultiplier;
  const treasureLevel110 = snapshot.treasureReward.basePercentAtLevel110 * draft.treasureRewardMultiplier;
  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/50 flex items-start gap-2 text-xs text-amber-200"><Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /><div className="leading-relaxed"><strong>Không còn hard-cap multiplier.</strong> Trần còn lại chỉ là giới hạn thật của kiểu dữ liệu/game bytecode khi writer build JAR.</div></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <MechanicCard icon={<Zap className="w-5 h-5 text-emerald-400" />} title="TNSM khi hạ quái" status={snapshot.tnsm.source.detected ? 'verified' : 'warning'} description="Điều chỉnh phần TNSM sinh ra từ HP quái trong tm$reward." source={`${snapshot.tnsm.source.className}.${snapshot.tnsm.source.methodName}`} sourceDetail={formatSource(snapshot.tnsm.source)}>
          <MultiplierEditor label="Hệ số" value={draft.tnsmMultiplier} onChange={(value) => updateMultiplier('tnsmMultiplier', value)} />
          <CompareRow label="Hệ số HP → TNSM" original={String(snapshot.tnsm.baseHpCoefficient)} edited={formatDecimal(effectiveTnsmCoefficient)} />

          <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-zinc-200">Giới hạn TNSM theo chênh lệch cấp</div>
                <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                  Bật = logic game gốc. Tắt = bỏ cả nhánh +1 và hệ số chia theo level.
                </div>
              </div>
              <button
                type="button"
                onClick={() => onTnsmLevelLimitChange(!draft.tnsmLevelLimitEnabled)}
                className={`min-w-[72px] px-3 py-1.5 rounded-lg border text-xs font-bold font-mono cursor-pointer transition-colors ${
                  draft.tnsmLevelLimitEnabled
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                    : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                }`}
              >
                {draft.tnsmLevelLimitEnabled ? 'BẬT' : 'TẮT'}
              </button>
            </div>
            <div className={`text-[10px] leading-relaxed ${
              draft.tnsmLevelLimitEnabled ? 'text-amber-300/80' : 'text-emerald-300/80'
            }`}>
              {draft.tnsmLevelLimitEnabled
                ? 'Reward vẫn bị giảm theo chênh level và có thể về +1 khi người chơi cao hơn quái quá 5 cấp.'
                : 'Reward không còn phụ thuộc level; sức mạnh và tiềm năng nhận cùng một giá trị reward sau multiplier/cap.'}
            </div>
          </div>

          <div className="space-y-1.5">{snapshot.tnsm.details.map((detail) => <div key={detail} className="text-[11px] font-mono text-zinc-500">• {detail}</div>)}</div>
        </MechanicCard>
        <MechanicCard icon={<Shield className="w-5 h-5 text-cyan-400" />} title="Trần sức mạnh / tiềm năng" status={snapshot.powerCap.sources.some((source) => source.detected) ? 'verified' : 'warning'} description="Mốc cap được dùng trong logic player và disciple." source="a/a/V.class" sourceDetail={`${snapshot.powerCap.sources.filter((source) => source.detected).length} method có tham chiếu cap`}>
          <MultiplierEditor label="Nhân trần" value={draft.powerCapMultiplier} onChange={(value) => updateMultiplier('powerCapMultiplier', value)} />
          <CompareRow label="Cap" original={snapshot.powerCap.baseCap.toLocaleString('vi-VN')} edited={Number.isFinite(effectivePowerCap) ? Math.trunc(effectivePowerCap).toLocaleString('vi-VN') : 'vượt Number'} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">{snapshot.powerCap.sources.slice(0, 8).map((source, index) => <SourceMini key={`${source.methodName}-${source.offset}-${index}`} source={source} />)}</div>
        </MechanicCard>
        <MechanicCard icon={<Map className="w-5 h-5 text-amber-400" />} title="Thưởng Bản đồ kho báu" status={snapshot.treasureReward.source.detected ? 'verified' : 'warning'} description="Hệ số reward của mode Bản đồ kho báu, gồm cả nhánh scale vàng." source="patch/DR.rewardMultiplierPercent" sourceDetail={formatSource(snapshot.treasureReward.source)}>
          <MultiplierEditor label="Nhân thưởng" value={draft.treasureRewardMultiplier} onChange={(value) => updateMultiplier('treasureRewardMultiplier', value)} />
          <div className="grid grid-cols-2 gap-2"><CompareRow label="Cấp 1" original={`${snapshot.treasureReward.basePercentAtLevel1}%`} edited={`${Math.round(treasureLevel1)}%`} /><CompareRow label="Cấp 110" original={`${snapshot.treasureReward.basePercentAtLevel110}%`} edited={`${Math.round(treasureLevel110)}%`} /></div>
          <div className="text-[11px] font-mono text-zinc-500">Hằng số đã dò: <span className="text-zinc-300">{snapshot.treasureReward.rawBase} / {snapshot.treasureReward.rawRange} / {snapshot.treasureReward.interpolationDivisor} / {snapshot.treasureReward.boostNumerator} / {snapshot.treasureReward.boostDivisor}</span></div>
        </MechanicCard>
        <MechanicCard icon={<Coins className="w-5 h-5 text-yellow-400" />} title="Vàng quái thường" status={snapshot.gold.hookSource.detected ? 'verified' : 'danger'} description="Writer thay wrapper scaleGoldQty khi hook đã được xác minh." source="a/a/h → patch/GTLFix.scaleGoldQty" sourceDetail={formatSource(snapshot.gold.hookSource)}>
          <MultiplierEditor label="Hệ số mong muốn" value={draft.desiredGlobalGoldMultiplier} onChange={(value) => updateMultiplier('desiredGlobalGoldMultiplier', value)} />
          <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/50 text-[11px] text-emerald-200 leading-relaxed"><div className="flex items-center gap-1.5 font-bold text-emerald-300 mb-1"><Link2 className="w-3.5 h-3.5" />Writer đã có</div>Nếu wrapper đúng pattern đã xác minh, hệ số vàng sẽ được ghi vào JAR. Nếu không encode được giá trị hoặc bytecode lệch, export bị chặn.</div>
          <SourceMini source={snapshot.gold.treasureOnlySource} />
        </MechanicCard>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800"><div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">{label}</div><div className="text-lg font-bold text-zinc-100 mt-1">{value}</div><div className="text-[10px] text-zinc-600 font-mono mt-0.5">{detail}</div></div>; }
function ViewButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button type="button" onClick={onClick} className={`px-3 py-1.5 rounded-md text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors ${active ? 'bg-zinc-800 border border-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>{icon}{label}</button>; }
function GroupButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) { return <button type="button" onClick={onClick} className={`px-2.5 py-1 rounded-md border text-[11px] font-mono cursor-pointer ${active ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>{label}</button>; }
function DropGroupBadge({ group }: { group: DropMechanic['group'] }) { const ui = group === 'common' ? ['Phổ thông','bg-emerald-500/10 text-emerald-300 border-emerald-500/25'] : group === 'conditional' ? ['Có điều kiện','bg-amber-500/10 text-amber-300 border-amber-500/25'] : ['Đặc biệt','bg-purple-500/10 text-purple-300 border-purple-500/25']; return <span className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${ui[1]}`}>{ui[0]}</span>; }
function VerificationBadge({ detected }: { detected: boolean }) { return <span className={`px-2 py-1 rounded border text-[10px] font-mono flex items-center gap-1 shrink-0 ${detected ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>{detected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{detected ? 'Đã xác minh' : 'Cần kiểm tra'}</span>; }

function MechanicCard({ icon, title, status, description, source, sourceDetail, children }: { icon: React.ReactNode; title: string; status: 'verified' | 'warning' | 'danger'; description: string; source: string; sourceDetail: string; children: React.ReactNode }) {
  const statusUi = status === 'verified' ? { text:'Đã xác minh', className:'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', icon:<CheckCircle2 className="w-3.5 h-3.5" /> } : status === 'warning' ? { text:'Cần lưu ý', className:'bg-amber-500/10 border-amber-500/30 text-amber-300', icon:<AlertTriangle className="w-3.5 h-3.5" /> } : { text:'Chưa hỗ trợ', className:'bg-red-500/10 border-red-500/30 text-red-300', icon:<AlertTriangle className="w-3.5 h-3.5" /> };
  return <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden"><div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/50"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2.5"><div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">{icon}</div><div><div className="font-bold text-zinc-100">{title}</div><div className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{description}</div></div></div><span className={`px-2 py-1 rounded border text-[10px] font-mono flex items-center gap-1 shrink-0 ${statusUi.className}`}>{statusUi.icon}{statusUi.text}</span></div></div><div className="p-4 space-y-3"><div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-mono"><div className="text-zinc-300">{source}</div><div className="text-zinc-600 mt-0.5">{sourceDetail}</div></div>{children}</div></div>;
}

function MultiplierEditor({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const sliderMax = Math.max(10, Math.min(1000, Number.isFinite(value) ? value : 10));
  return <div className="space-y-2"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><label className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">{label}</label><div className="flex items-center gap-1.5 overflow-x-auto">{PRESETS.map((preset) => <button key={preset} type="button" onClick={() => onChange(preset)} className={`px-2 py-1 rounded border text-[10px] font-mono cursor-pointer transition-colors ${value === preset ? 'bg-violet-500/15 border-violet-500/40 text-violet-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>x{preset}</button>)}</div></div><div className="flex items-center gap-2"><input type="range" min="0.1" max={sliderMax} step="0.1" value={Math.min(sliderMax, Math.max(0.1, value))} onChange={(event) => onChange(Number(event.target.value))} className="flex-1 accent-violet-500" /><div className="relative w-32"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 font-mono">x</span><input type="number" min="0.000001" step="any" value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-6 pr-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-violet-500" /></div></div><div className="text-[9px] text-zinc-600 font-mono">Ô số không có max. Slider chỉ là điều khiển nhanh; có thể gõ trực tiếp giá trị lớn hơn.</div></div>;
}

function CompareRow({ label, original, edited }: { label: string; original: string; edited: string }) { return <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-800 text-xs font-mono"><span className="text-zinc-500">{label}</span><span className="text-zinc-400">{original}</span><span className="text-violet-300 font-bold">→ {edited}</span></div>; }
function SourceMini({ source }: { source: { detected: boolean; methodName: string; descriptor?: string; offset?: number; detail: string } }) { return <div className="p-2 rounded bg-zinc-950/70 border border-zinc-800 text-[10px] font-mono"><div className={source.detected ? 'text-emerald-300' : 'text-amber-300'}>{source.methodName}{source.offset !== undefined ? ` @ ${source.offset}` : ''}</div><div className="text-zinc-600 truncate" title={source.detail}>{source.detail}</div></div>; }
function formatSource(source: { detected: boolean; offset?: number; detail: string }): string { if (!source.detected) return source.detail; return `${source.detail}${source.offset !== undefined ? ` · bytecode offset ${source.offset}` : ''}`; }
function formatDecimal(value: number): string { if (!Number.isFinite(value)) return String(value); return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, ''); }
function formatPercent(value: number): string { if (value >= 10) return `${Number(value.toFixed(2))}%`; if (value >= 1) return `${Number(value.toFixed(3))}%`; return `${Number(value.toFixed(4))}%`; }

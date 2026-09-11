import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Dices,
  PackageSearch,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeGameMechanics,
  DropMechanic,
  GameMechanicsDraft,
  GameMechanicsSnapshot,
  GenericMobDropRule,
  getGameMechanicsDirtyCount,
  getGameMechanicsDraft,
  normalizeChance,
  normalizeMultiplier,
  normalizeQuantity,
  resetGameMechanicsDraft,
  setGameMechanicsDraft,
} from '../../services/gameMechanicsService';
import {
  ADVANCED_DEFAULTS,
  AdvancedMechanicsDraft,
  getAdvancedMechanicsDirtyCount,
  getAdvancedMechanicsDraft,
  resetAdvancedMechanicsDraft,
  setAdvancedMechanicsDraft,
} from '../../services/advancedMechanicsService';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import { analyzeSkills } from '../../services/skillDataService';

interface GameMechanicsPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type PanelView = 'advanced' | 'drops' | 'core';
type DropGroup = 'all' | 'common' | 'conditional' | 'special';

const DISCIPLE_SKILL_GROUPS = [
  {
    title: 'Skill đầu khi nhận Đệ tử',
    note: 'Game gốc w(3): 3 nhánh ngang nhau.',
    labels: ['Đấm Dragon · #0', 'Đấm Demon · #14', 'Đấm Galick · #28'],
  },
  {
    title: 'Mốc 150 triệu sức mạnh',
    note: 'Slot kỹ năng tiếp theo.',
    labels: ['Skill #7', 'Skill #21', 'Skill #35'],
  },
  {
    title: 'Mốc 1,5 tỷ sức mạnh',
    note: 'Slot kỹ năng tiếp theo.',
    labels: ['Skill #42', 'Skill #56', 'Skill #63'],
  },
  {
    title: 'Mốc 20 tỷ sức mạnh',
    note: 'Slot kỹ năng tiếp theo.',
    labels: ['Skill #91', 'Skill #84', 'Skill #121'],
  },
] as const;

function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function pct(value: number): string {
  return `${Number(value.toFixed(3))}%`;
}

export function GameMechanicsPanel({ session, onDraftsUpdated }: GameMechanicsPanelProps) {
  const [snapshot, setSnapshot] = useState<GameMechanicsSnapshot | null>(null);
  const [draft, setDraft] = useState<GameMechanicsDraft>(() => getGameMechanicsDraft(session));
  const [advanced, setAdvanced] = useState<AdvancedMechanicsDraft>(() => getAdvancedMechanicsDraft(session));
  const [view, setView] = useState<PanelView>('advanced');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dropQuery, setDropQuery] = useState('');
  const [skillNames, setSkillNames] = useState<Record<number, string>>({});
  const [dropGroup, setDropGroup] = useState<DropGroup>('all');
  const onDraftsUpdatedRef = useRef(onDraftsUpdated);
  onDraftsUpdatedRef.current = onDraftsUpdated;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mechanicsSnapshot, skillSnapshot] = await Promise.all([
        analyzeGameMechanics(session),
        analyzeSkills(session).catch(() => null),
      ]);
      setSnapshot(mechanicsSnapshot);
      if (skillSnapshot) {
        const names: Record<number, string> = {};
        for (const skill of skillSnapshot.skills) names[skill.id] = skill.name;
        setSkillNames(names);
      } else {
        setSkillNames({});
      }
      setDraft(getGameMechanicsDraft(session));
      setAdvanced(getAdvancedMechanicsDraft(session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session]);

  const normalDirty = useMemo(() => getGameMechanicsDirtyCount(draft), [draft]);
  const advancedDirty = useMemo(() => getAdvancedMechanicsDirtyCount(session), [session, advanced]);
  const totalDirty = normalDirty + advancedDirty;

  useEffect(() => {
    setGameMechanicsDraft(session, draft);
    setAdvancedMechanicsDraft(session, advanced);
    onDraftsUpdatedRef.current?.(
      getGameMechanicsDirtyCount(draft) + getAdvancedMechanicsDirtyCount(session)
    );
  }, [session, draft, advanced]);

  const filteredDrops = useMemo(() => {
    if (!snapshot) return [];
    const query = dropQuery.trim().toLowerCase();
    return snapshot.mobDrops.filter((drop) => {
      if (dropGroup !== 'all' && drop.group !== dropGroup) return false;
      if (!query) return true;
      return [drop.title, drop.description, drop.condition, ...drop.items.map((item) => `${item.id} ${item.name}`)]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [snapshot, dropGroup, dropQuery]);

  const patchAdvanced = (patch: Partial<AdvancedMechanicsDraft>) => {
    setAdvanced((current) => ({ ...current, ...patch }));
  };

  const resetAll = () => {
    resetGameMechanicsDraft(session);
    resetAdvancedMechanicsDraft(session);
    setDraft(getGameMechanicsDraft(session));
    setAdvanced(getAdvancedMechanicsDraft(session));
  };

  if (loading) {
    return (
      <div className="min-h-[280px] rounded-2xl border border-zinc-200 bg-white flex items-center justify-center">
        <div className="text-center space-y-2">
          <RefreshCw className="w-5 h-5 text-violet-500 animate-spin mx-auto" />
          <div className="text-xs text-zinc-500 font-mono">Đang đọc RNG / drop / upgrade / skill...</div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
        <div className="flex items-center gap-2 font-bold"><AlertTriangle className="w-4 h-4" />Không đọc được Cơ chế</div>
        <div className="mt-2 text-xs font-mono whitespace-pre-wrap">{error}</div>
        <button type="button" onClick={() => void load()} className="mt-3 px-3 py-2 rounded-xl bg-white border border-red-200 text-xs font-semibold">Thử lại</button>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-3 pb-24 md:pb-4 overflow-x-hidden">
      <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 sm:p-4 space-y-3 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <SlidersHorizontal className="w-5 h-5 text-violet-600 shrink-0" />
              <h2 className="text-lg font-bold text-zinc-900">Cơ chế game</h2>
              {totalDirty > 0 && <Badge>{totalDirty} cấu hình nháp</Badge>}
            </div>
            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
              Tỷ lệ RNG đọc từ JAR và writer kiểm tra bytecode trước khi xuất.
            </p>
          </div>
          <button
            type="button"
            onClick={resetAll}
            disabled={totalDirty === 0}
            className="self-start px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 disabled:opacity-40 text-xs font-semibold text-zinc-700 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />Hoàn tác tất cả
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Metric label="Drop đã đọc" value={snapshot.mobDrops.length} />
          <Metric label="RNG nâng cấp" value="2 bảng" />
          <Metric label="RNG skill Đệ tử" value="4 mốc" />
          <Metric label="Power cap" value={snapshot.powerCap.baseCap.toLocaleString('vi-VN')} />
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          <TabButton active={view === 'advanced'} onClick={() => setView('advanced')} icon={<Dices className="w-4 h-4" />} label="Tỷ lệ RNG" />
          <TabButton active={view === 'drops'} onClick={() => setView('drops')} icon={<PackageSearch className="w-4 h-4" />} label="Drop" />
          <TabButton active={view === 'core'} onClick={() => setView('core')} icon={<Zap className="w-4 h-4" />} label="Hệ số" />
        </div>
      </section>

      {view === 'advanced' && (
        <AdvancedMechanicsView advanced={advanced} skillNames={skillNames} onChange={patchAdvanced} onReset={() => setAdvanced(resetAdvancedMechanicsDraft(session))} />
      )}
      {view === 'drops' && (
        <DropView
          session={session}
          snapshot={snapshot}
          draft={draft}
          setDraft={setDraft}
          drops={filteredDrops}
          query={dropQuery}
          setQuery={setDropQuery}
          group={dropGroup}
          setGroup={setDropGroup}
        />
      )}
      {view === 'core' && <CoreView snapshot={snapshot} draft={draft} setDraft={setDraft} advanced={advanced} onAdvancedChange={patchAdvanced} />}
    </div>
  );
}

function AdvancedMechanicsView({
  advanced,
  skillNames,
  onChange,
  onReset,
}: {
  advanced: AdvancedMechanicsDraft;
  skillNames: Record<number, string>;
  onChange: (patch: Partial<AdvancedMechanicsDraft>) => void;
  onReset: () => void;
}) {
  const updateUpgrade = (key: 'gearUpgradeRates' | 'crystalUpgradeRates', index: number, value: number) => {
    const next = [...advanced[key]];
    next[index] = normalizeChance(value);
    onChange({ [key]: next } as Partial<AdvancedMechanicsDraft>);
  };
  const updateDisciple = (row: number, column: number, value: number) => {
    const next = advanced.discipleSkillRates.map((group) => [...group]);
    next[row][column] = normalizeChance(value);
    onChange({ discipleSkillRates: next });
  };
  const updateWheelRate = (index: number, value: number) => {
    const next = [...advanced.godWheelRates];
    next[index] = normalizeChance(value);
    onChange({ godWheelRates: next });
  };
  const updateWheelReward = (index: number, value: number) => {
    const next = [...advanced.godWheelRewards];
    next[index] = Math.max(0, Math.round(Number(value) || 0));
    onChange({ godWheelRewards: next });
  };

  return (
    <div className="space-y-3 min-w-0">
      <Section
        icon={<WandSparkles className="w-4 h-4 text-fuchsia-600" />}
        title="Vòng quay Thượng Đế"
        subtitle="Bản offline gốc đang báo chưa có chức năng; bật mục này để gắn runtime quay custom vào NPC Thượng Đế."
        right={
          <button
            type="button"
            onClick={() => onChange({ godWheelEnabled: !advanced.godWheelEnabled })}
            className={`px-3 py-2 rounded-xl border text-xs font-bold ${advanced.godWheelEnabled ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-300 text-zinc-600'}`}
          >
            {advanced.godWheelEnabled ? 'ĐANG BẬT' : 'BẬT VÒNG QUAY'}
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] gap-3">
          <NumberField
            label="Phí mỗi lượt (Ngọc)"
            value={advanced.godWheelCost}
            min={0}
            step={1}
            disabled={!advanced.godWheelEnabled}
            onChange={(value) => onChange({ godWheelCost: Math.max(0, Math.round(value)) })}
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {advanced.godWheelRates.map((rate, index) => (
              <div key={index} className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Phần thưởng {index + 1}</div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <NumberField compact label="Tỷ lệ %" value={rate} min={0} max={100} step={1} disabled={!advanced.godWheelEnabled} onChange={(value) => updateWheelRate(index, value)} />
                  <NumberField compact label="Ngọc nhận" value={advanced.godWheelRewards[index]} min={0} step={1} disabled={!advanced.godWheelEnabled} onChange={(value) => updateWheelReward(index, value)} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <TotalRate total={sum(advanced.godWheelRates)} enabled={advanced.godWheelEnabled} />
      </Section>

      <Section icon={<Sparkles className="w-4 h-4 text-amber-500" />} title="Đập đồ" subtitle="Tỷ lệ thành công theo cấp nâng hiện tại (+0 → +8).">
        <RateGrid values={advanced.gearUpgradeRates} defaults={ADVANCED_DEFAULTS.gearUpgradeRates} onChange={(index, value) => updateUpgrade('gearUpgradeRates', index, value)} prefix="+" />
      </Section>

      <Section icon={<Star className="w-4 h-4 text-sky-500" />} title="Đập đồ sao" subtitle="Tỷ lệ đập sao / option 107 theo số sao hiện tại.">
        <RateGrid values={advanced.crystalUpgradeRates} defaults={ADVANCED_DEFAULTS.crystalUpgradeRates} onChange={(index, value) => updateUpgrade('crystalUpgradeRates', index, value)} prefix="★" />
      </Section>

      <Section icon={<Dices className="w-4 h-4 text-violet-600" />} title="Tỷ lệ ra skill Đệ tử" subtitle="Chỉnh trực tiếp nhánh RNG Đấm Dragon / Demon / Galick và 3 mốc sức mạnh.">
        <div className="space-y-2.5">
          {DISCIPLE_SKILL_GROUPS.map((group, row) => {
            const rates = advanced.discipleSkillRates[row];
            const total = sum(rates);
            const ok = Math.abs(total - 100) < 0.011;
            return (
              <div key={group.title} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                  <div>
                    <div className="text-sm font-bold text-zinc-900">{group.title}</div>
                    <div className="text-[10px] text-zinc-500">{group.note}</div>
                  </div>
                  <span className={`text-[10px] font-bold ${ok ? 'text-emerald-600' : 'text-red-600'}`}>Tổng {Number(total.toFixed(2))}%</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    [0, 14, 28],
                    [7, 21, 35],
                    [42, 56, 63],
                    [91, 84, 121],
                  ][row]).map((skillId, column) => {
                    const fallback = group.labels[column];
                    const resolved = skillNames[skillId];
                    const label = resolved ? `${resolved} · #${skillId}` : fallback;
                    return (
                      <NumberField key={skillId} label={label} value={rates[column]} min={0} max={100} step={1} suffix="%" onChange={(value) => updateDisciple(row, column, value)} />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onReset} className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />Khôi phục tỷ lệ RNG gốc
          </button>
        </div>
      </Section>
    </div>
  );
}

function RateGrid({ values, defaults, onChange, prefix }: { values: number[]; defaults: number[]; onChange: (index: number, value: number) => void; prefix: string }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9 gap-2">
      {values.map((value, index) => (
        <div key={index} className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-xs font-bold text-zinc-800">{prefix}{index}</span>
            <span className="text-[9px] text-zinc-400 font-mono">gốc {pct(defaults[index])}</span>
          </div>
          <NumberField compact label="Thành công" value={value} min={0} max={100} step={1} suffix="%" onChange={(next) => onChange(index, next)} />
        </div>
      ))}
    </div>
  );
}

function DropView({
  session,
  snapshot,
  draft,
  setDraft,
  drops,
  query,
  setQuery,
  group,
  setGroup,
}: {
  session: LoadedJarSession;
  snapshot: GameMechanicsSnapshot;
  draft: GameMechanicsDraft;
  setDraft: React.Dispatch<React.SetStateAction<GameMechanicsDraft>>;
  drops: DropMechanic[];
  query: string;
  setQuery: (value: string) => void;
  group: DropGroup;
  setGroup: (value: DropGroup) => void;
}) {
  const updateChance = (key: string, value: number) => setDraft((current) => ({ ...current, dropChancePercent: { ...current.dropChancePercent, [key]: normalizeChance(value) } }));
  const updateQuantity = (key: string, value: number) => setDraft((current) => ({ ...current, dropQuantity: { ...current.dropQuantity, [key]: normalizeQuantity(value) } }));
  const addCustom = () => setDraft((current) => ({
    ...current,
    customMobDrops: [...(current.customMobDrops ?? []), { id: `custom-${Date.now()}`, enabled: true, itemId: 77, quantity: 1, chancePercent: 100, mobType: null, mapId: null }],
  }));
  const updateCustom = (id: string, patch: Partial<GenericMobDropRule>) => setDraft((current) => ({ ...current, customMobDrops: (current.customMobDrops ?? []).map((rule) => rule.id === id ? { ...rule, ...patch } : rule) }));
  const deleteCustom = (id: string) => setDraft((current) => ({ ...current, customMobDrops: (current.customMobDrops ?? []).filter((rule) => rule.id !== id) }));

  return (
    <div className="space-y-3 min-w-0">
      <Section icon={<Plus className="w-4 h-4 text-emerald-600" />} title="Drop item custom" subtitle="Hook quái chết: Item ID, số lượng, tỷ lệ, mob type và map." right={<button type="button" onClick={addCustom} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Thêm drop</button>}>
        {(draft.customMobDrops ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center text-xs text-zinc-500">Chưa có drop custom.</div>
        ) : (
          <div className="space-y-2">
            {(draft.customMobDrops ?? []).map((rule, index) => (
              <div key={rule.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-2 items-end">
                <NumberField label="Item ID" value={rule.itemId} min={0} step={1} onChange={(value) => updateCustom(rule.id, { itemId: Math.max(0, Math.round(value)) })} />
                <NumberField label="Số lượng" value={rule.quantity} min={1} step={1} onChange={(value) => updateCustom(rule.id, { quantity: normalizeQuantity(value) })} />
                <NumberField label="Tỷ lệ %" value={rule.chancePercent} min={0} max={100} step={0.1} onChange={(value) => updateCustom(rule.id, { chancePercent: normalizeChance(value) })} />
                <NullableNumberField label="Mob type" value={rule.mobType} onChange={(value) => updateCustom(rule.id, { mobType: value })} />
                <NullableNumberField label="Map ID" value={rule.mapId} onChange={(value) => updateCustom(rule.id, { mapId: value })} />
                <button type="button" onClick={() => updateCustom(rule.id, { enabled: !rule.enabled })} className={`h-11 rounded-xl border text-xs font-bold ${rule.enabled ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-zinc-200 text-zinc-500'}`}>{rule.enabled ? 'BẬT' : 'TẮT'}</button>
                <button type="button" onClick={() => deleteCustom(rule.id)} className="h-11 rounded-xl border border-red-200 bg-red-50 text-red-600 text-xs font-bold flex items-center justify-center gap-1"><Trash2 className="w-3.5 h-3.5" />Xóa #{index + 1}</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-3 sm:p-4 space-y-3 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2"><PackageSearch className="w-4 h-4 text-emerald-600" /><span className="font-bold text-zinc-900">Drop có sẵn ({snapshot.mobDrops.length})</span></div>
          <div className="relative w-full sm:w-72"><Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên / item ID..." className="w-full h-11 pl-9 pr-3 rounded-xl border border-zinc-300 bg-white text-[16px] sm:text-sm text-zinc-900 outline-none focus:border-violet-500" /></div>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {(['all', 'common', 'conditional', 'special'] as DropGroup[]).map((value) => <button key={value} type="button" onClick={() => setGroup(value)} className={`px-2 py-2 rounded-lg text-[10px] sm:text-xs font-semibold ${group === value ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{value === 'all' ? 'Tất cả' : value === 'common' ? 'Phổ thông' : value === 'conditional' ? 'Điều kiện' : 'Đặc biệt'}</button>)}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {drops.map((drop) => (
          <div key={drop.key} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden min-w-0">
            <div className="p-3 border-b border-zinc-200 bg-zinc-50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="text-sm font-bold text-zinc-900 break-words">{drop.title}</div><div className="text-[10px] text-zinc-500 mt-1 break-words">{drop.description}</div></div>
                <span className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-bold border ${drop.source.detected ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>{drop.source.detected ? 'Đã xác minh' : 'Cần kiểm tra'}</span>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {drop.items.length > 0 && <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1">{drop.items.map((item) => <div key={item.id} className="shrink-0 min-w-[150px] rounded-xl border border-zinc-200 bg-zinc-50 p-2 flex items-center gap-2"><SmallImagePreview session={session} imageId={item.iconId} alt={item.name} variant="icon" /><div className="min-w-0"><div className="text-xs font-semibold text-zinc-800 truncate">{item.name}</div><div className="text-[9px] text-zinc-500 font-mono">#{item.id}</div></div></div>)}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {drop.editableChance ? <NumberField label={`Tỷ lệ · gốc ${pct(drop.baseChancePercent)}`} value={draft.dropChancePercent[drop.key] ?? drop.baseChancePercent} min={0} max={100} step={0.1} suffix="%" onChange={(value) => updateChance(drop.key, value)} /> : <ReadOnly label="Tỷ lệ" value={pct(drop.baseChancePercent)} />}
                {drop.editableQuantity && drop.quantity !== undefined ? <NumberField label={`Số lượng · gốc ${drop.quantity}`} value={draft.dropQuantity[drop.key] ?? drop.quantity} min={1} step={1} onChange={(value) => updateQuantity(drop.key, value)} /> : drop.quantity !== undefined ? <ReadOnly label="Số lượng" value={String(drop.quantity)} /> : null}
              </div>
              {drop.distribution && <div className="rounded-xl border border-zinc-200 overflow-hidden">{drop.distribution.map((entry) => <div key={entry.label} className="px-3 py-2 flex items-center justify-between gap-2 border-b last:border-b-0 border-zinc-200 text-xs"><span className="text-zinc-600">{entry.label}</span><strong className="text-zinc-900">{pct(entry.chancePercent)}</strong></div>)}</div>}
              <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-2.5 text-[10px] text-zinc-600 leading-relaxed break-words"><strong>Điều kiện:</strong> {drop.condition}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoreView({
  snapshot,
  draft,
  setDraft,
  advanced,
  onAdvancedChange,
}: {
  snapshot: GameMechanicsSnapshot;
  draft: GameMechanicsDraft;
  setDraft: React.Dispatch<React.SetStateAction<GameMechanicsDraft>>;
  advanced: AdvancedMechanicsDraft;
  onAdvancedChange: (patch: Partial<AdvancedMechanicsDraft>) => void;
}) {
  const update = (
    key: 'tnsmMultiplier' | 'powerCapMultiplier' | 'treasureRewardMultiplier' | 'desiredGlobalGoldMultiplier',
    value: number
  ) => setDraft((current) => ({ ...current, [key]: normalizeMultiplier(value) }));
  const toBonusPercent = (multiplier: number) => Number(((multiplier - 1) * 100).toFixed(3));
  const fromBonusPercent = (percent: number) => Math.max(0.000001, 1 + Number(percent || 0) / 100);
  const powerCapText = advanced.unlimitedPower
    ? 'Long.MAX_VALUE · 9.22e18'
    : Math.trunc(snapshot.powerCap.baseCap * draft.powerCapMultiplier).toLocaleString('vi-VN');

  return (
    <div className="space-y-3">
      <Section
        icon={<Zap className="w-4 h-4 text-violet-600" />}
        title="Hệ số gameplay"
        subtitle="Giữ nguyên toàn bộ hệ số cũ và bổ sung % trực quan + sức mạnh không giới hạn."
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div>
                <div className="text-xs font-bold text-zinc-900">TNSM toàn game</div>
                <div className="text-[10px] text-zinc-500">Writer áp dụng đồng thời cho Sư phụ và Đệ tử.</div>
              </div>
              <span className="px-2 py-1 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-bold">SƯ PHỤ + ĐỆ TỬ</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <NumberField label="TNSM multiplier (giữ tính năng cũ)" value={draft.tnsmMultiplier} min={0.000001} step={0.1} onChange={(value) => update('tnsmMultiplier', value)} />
              <NumberField label="Điều chỉnh TNSM (%) · âm = giảm" value={toBonusPercent(draft.tnsmMultiplier)} min={-99.999} step={10} suffix="%" onChange={(value) => update('tnsmMultiplier', fromBonusPercent(value))} />
            </div>
            <MultiplierPresets value={draft.tnsmMultiplier} onChange={(value) => update('tnsmMultiplier', value)} />
            <div className="mt-1 text-[10px] text-violet-700">Ví dụ: x0.5 = giảm 50% TNSM · x0.25 = còn 25% · x2 = tăng 100%.</div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="text-xs font-bold text-zinc-900 mb-2">Vàng toàn game</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <NumberField label="Vàng global multiplier (giữ tính năng cũ)" value={draft.desiredGlobalGoldMultiplier} min={0.000001} step={0.1} onChange={(value) => update('desiredGlobalGoldMultiplier', value)} />
              <NumberField label="Điều chỉnh vàng (%) · âm = giảm" value={toBonusPercent(draft.desiredGlobalGoldMultiplier)} min={-99.999} step={10} suffix="%" onChange={(value) => update('desiredGlobalGoldMultiplier', fromBonusPercent(value))} />
            </div>
            <MultiplierPresets value={draft.desiredGlobalGoldMultiplier} onChange={(value) => update('desiredGlobalGoldMultiplier', value)} />
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-900">Giới hạn sức mạnh / tiềm năng</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Bật không giới hạn sẽ dùng Java Long.MAX_VALUE thay cap 1.000 tỷ.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !advanced.unlimitedPower;
                  onAdvancedChange({ unlimitedPower: next });
                  if (next && Math.abs(draft.powerCapMultiplier - 1) > 1e-12) {
                    setDraft((current) => ({ ...current, powerCapMultiplier: 1 }));
                  }
                }}
                className={`px-3 py-2 rounded-xl border text-xs font-bold ${advanced.unlimitedPower ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-300 text-zinc-700'}`}
              >
                {advanced.unlimitedPower ? 'KHÔNG GIỚI HẠN: BẬT' : 'BẬT KHÔNG GIỚI HẠN SM'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
              <NumberField label="Power cap multiplier (tính năng cũ)" value={draft.powerCapMultiplier} min={0.000001} step={1} disabled={advanced.unlimitedPower} onChange={(value) => update('powerCapMultiplier', value)} />
              <ReadOnly label="Cap hiệu lực" value={powerCapText} />
            </div>
          </div>

          <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
            <div className="text-xs font-bold text-zinc-900 mb-2">Bản đồ kho báu</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <NumberField label="BĐKB reward multiplier (tính năng cũ)" value={draft.treasureRewardMultiplier} min={0.000001} step={0.1} onChange={(value) => update('treasureRewardMultiplier', value)} />
              <NumberField label="Điều chỉnh BĐKB (%) · âm = giảm" value={toBonusPercent(draft.treasureRewardMultiplier)} min={-99.999} step={10} suffix="%" onChange={(value) => update('treasureRewardMultiplier', fromBonusPercent(value))} />
            </div>
            <MultiplierPresets value={draft.treasureRewardMultiplier} onChange={(value) => update('treasureRewardMultiplier', value)} />
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 cursor-pointer">
          <input type="checkbox" checked={draft.tnsmLevelLimitEnabled} onChange={(e) => setDraft((current) => ({ ...current, tnsmLevelLimitEnabled: e.target.checked }))} className="w-4 h-4" />
          <div><div className="text-xs font-bold text-zinc-800">Giữ giới hạn TNSM theo chênh level</div><div className="text-[10px] text-zinc-500">Tắt để bỏ penalty level trong tm$reward. Tính năng cũ được giữ nguyên.</div></div>
        </label>
      </Section>

      <Section
        icon={<PackageSearch className="w-4 h-4 text-emerald-600" />}
        title="Item #521 · Tự động luyện tập"
        subtitle="Vá item auto thành buff có thời hạn; khi nhiệm vụ hiện tại có mục tiêu quái đã xác minh, auto ưu tiên đúng loại quái đó."
        right={
          <button
            type="button"
            onClick={() => onAdvancedChange({ autoTrainingPatchEnabled: !advanced.autoTrainingPatchEnabled })}
            className={`px-3 py-2 rounded-xl border text-xs font-bold ${advanced.autoTrainingPatchEnabled ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-300 text-zinc-700'}`}
          >
            {advanced.autoTrainingPatchEnabled ? 'ĐANG VÁ ITEM #521' : 'BẬT VÁ AUTO'}
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <NumberField
              label="Thời hạn mỗi lần bật (phút)"
              value={advanced.autoTrainingDurationMinutes}
              min={1}
              max={10080}
              step={1}
              disabled={!advanced.autoTrainingPatchEnabled}
              onChange={(value) => onAdvancedChange({ autoTrainingDurationMinutes: Math.max(1, Math.min(10080, Math.round(value || 1))) })}
            />
            <div className="mt-2 flex gap-1.5 flex-wrap">
              {[30, 60, 120, 300, 1440].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  disabled={!advanced.autoTrainingPatchEnabled}
                  onClick={() => onAdvancedChange({ autoTrainingDurationMinutes: minutes })}
                  className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-40 ${advanced.autoTrainingDurationMinutes === minutes ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-200 text-zinc-600'}`}
                >
                  {minutes < 60 ? `${minutes}p` : minutes === 1440 ? '24h' : `${minutes / 60}h`}
                </button>
              ))}
            </div>
          </div>

          <label className={`rounded-xl border p-3 flex items-start gap-2 ${advanced.autoTrainingPatchEnabled ? 'border-emerald-200 bg-emerald-50/60 cursor-pointer' : 'border-zinc-200 bg-zinc-50 opacity-60'}`}>
            <input
              type="checkbox"
              checked={advanced.autoTrainingQuestAware}
              disabled={!advanced.autoTrainingPatchEnabled}
              onChange={(event) => onAdvancedChange({ autoTrainingQuestAware: event.target.checked })}
              className="w-4 h-4 mt-0.5"
            />
            <div>
              <div className="text-xs font-bold text-zinc-800">Đánh quái theo nhiệm vụ hiện tại</div>
              <div className="text-[10px] text-zinc-500 mt-1 leading-relaxed">Đọc main quest + sub-step runtime. Các nhiệm vụ quái đã map sẽ chỉ chọn đúng mob; nhiệm vụ boss/điều kiện chưa chắc chắn giữ cách chọn target cũ để không phá auto.</div>
            </div>
          </label>
        </div>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800 leading-relaxed">
          Item không còn bật vĩnh viễn: hết thời gian sẽ tự tắt <strong>Tự động luyện tập</strong>. Bật lại item sẽ tạo một phiên thời gian mới.
        </div>
      </Section>

      <Section icon={<Coins className="w-4 h-4 text-amber-600" />} title="Thông tin nguồn" subtitle="Giá trị đọc trực tiếp từ bytecode hiện tại.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ReadOnly label="TNSM coefficient gốc" value={String(snapshot.tnsm.baseHpCoefficient)} />
          <ReadOnly label="Power cap gốc" value={snapshot.powerCap.baseCap.toLocaleString('vi-VN')} />
          <ReadOnly label="BĐKB Lv1" value={`${snapshot.treasureReward.basePercentAtLevel1}%`} />
          <ReadOnly label="BĐKB Lv110" value={`${snapshot.treasureReward.basePercentAtLevel110}%`} />
        </div>
      </Section>
    </div>
  );
}

function MultiplierPresets({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const presets = [0.1, 0.25, 0.5, 0.75, 1, 2, 5, 10];
  return (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-zinc-500 mr-0.5">Nhanh:</span>
      {presets.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onChange(preset)}
          className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold ${Math.abs(value - preset) < 1e-9 ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-violet-300'}`}
        >
          x{preset}
        </button>
      ))}
    </div>
  );
}

function Section({ icon, title, subtitle, right, children }: { icon: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden min-w-0"><div className="p-3 sm:p-4 border-b border-zinc-200 bg-zinc-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div className="flex items-start gap-2 min-w-0">{icon}<div className="min-w-0"><div className="text-sm font-bold text-zinc-900">{title}</div>{subtitle && <div className="text-[10px] text-zinc-500 leading-relaxed mt-0.5">{subtitle}</div>}</div></div>{right}</div><div className="p-3 sm:p-4 min-w-0">{children}</div></section>;
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix, disabled, compact }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean; compact?: boolean }) {
  return <label className="block min-w-0"><span className="block text-[10px] font-medium text-zinc-500 mb-1 truncate" title={label}>{label}</span><div className="relative"><input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className={`w-full ${compact ? 'h-9' : 'h-11'} rounded-xl border border-zinc-300 bg-white px-3 ${suffix ? 'pr-8' : ''} text-[16px] sm:text-sm font-mono text-zinc-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-zinc-100 disabled:text-zinc-400`} />{suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">{suffix}</span>}</div></label>;
}

function NullableNumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return <label className="block min-w-0"><span className="block text-[10px] font-medium text-zinc-500 mb-1">{label}</span><input type="number" value={value ?? ''} placeholder="Tất cả" onChange={(e) => onChange(e.target.value === '' ? null : Math.round(Number(e.target.value)))} className="w-full h-11 rounded-xl border border-zinc-300 bg-white px-3 text-[16px] sm:text-sm font-mono text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-violet-500" /></label>;
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"><div className="text-[10px] text-zinc-500">{label}</div><div className="text-sm font-bold text-zinc-900 mt-0.5 break-all">{value}</div></div>;
}

function TotalRate({ total, enabled = true }: { total: number; enabled?: boolean }) {
  if (!enabled) return null;
  const ok = Math.abs(total - 100) < 0.011;
  return <div className={`mt-3 rounded-xl border px-3 py-2 text-xs flex items-center gap-2 ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}Tổng tỷ lệ: <strong>{Number(total.toFixed(2))}%</strong>{!ok && <span>· Phải = 100% mới Test/Export.</span>}</div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 min-w-0"><div className="text-[9px] uppercase tracking-wide text-zinc-500 truncate">{label}</div><div className="text-base sm:text-lg font-bold text-zinc-900 truncate" title={String(value)}>{value}</div></div>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 text-[10px] font-mono">{children}</span>;
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" onClick={onClick} className={`min-w-0 px-2 sm:px-3 py-2 rounded-lg text-[10px] sm:text-xs font-semibold flex items-center justify-center gap-1.5 ${active ? 'bg-white border border-violet-200 text-violet-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>{icon}<span className="truncate">{label}</span></button>;
}

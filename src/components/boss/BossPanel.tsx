import React, { useEffect, useMemo, useState } from 'react';
import {
  Crown,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Plus,
  Trash2,
  PackageOpen,
  ChevronRight,
  Info,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { NpcBodyPreview } from '../game-data/NpcBodyPreview';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import {
  analyzeBosses,
  BossAnalysisSnapshot,
  BossDefinition,
  BossDraft,
  BossDropRule,
  BossCustomDrop,
  createCustomBossDrop,
  describeBossRuntime,
  getBossDraft,
  getBossDropRules,
  getDirtyBossCount,
  isBossDraftDirty,
  resetBossDraft,
  resolveBossItem,
  setBossDraft,
} from '../../services/bossDataService';

interface BossPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type BossFilter = 'all' | 'fixed' | 'dynamic' | 'with-drop';

const QUICK_MULTIPLIERS = [0.5, 1, 2, 5, 10];

export function BossPanel({ session, onDraftsUpdated }: BossPanelProps) {
  const [snapshot, setSnapshot] = useState<BossAnalysisSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BossFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeBosses(session);
      setSnapshot(result);
      if (selectedIndex === null && result.bosses.length > 0) {
        setSelectedIndex(result.bosses[0].index);
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

  useEffect(() => {
    void revision;
    onDraftsUpdated?.(getDirtyBossCount(session));
  }, [session, revision, onDraftsUpdated]);

  const filteredBosses = useMemo(() => {
    if (!snapshot) return [];
    void revision;
    const normalized = query.trim().toLowerCase();

    return snapshot.bosses.filter((boss) => {
      const drops = getBossDropRules(boss, snapshot.itemAnalysis);
      if (filter === 'fixed' && boss.statMode !== 'fixed') return false;
      if (filter === 'dynamic' && boss.statMode === 'fixed') return false;
      if (filter === 'with-drop' && drops.length === 0) return false;

      if (!normalized) return true;
      return (
        boss.name.toLowerCase().includes(normalized) ||
        String(boss.index).includes(normalized) ||
        String(boss.charId).includes(normalized) ||
        String(boss.mapId).includes(normalized) ||
        drops.some(
          (drop) =>
            drop.title.toLowerCase().includes(normalized) ||
            drop.itemRefs.some(
              (item) =>
                item.id.includes(normalized) ||
                item.name.toLowerCase().includes(normalized)
            )
        )
      );
    });
  }, [snapshot, query, filter, revision]);

  const selectedBoss = useMemo(() => {
    if (!snapshot || selectedIndex === null) return null;
    return snapshot.bosses.find((boss) => boss.index === selectedIndex) ?? null;
  }, [snapshot, selectedIndex]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="text-center space-y-2">
          <RefreshCw className="w-5 h-5 text-rose-400 animate-spin mx-auto" />
          <div className="text-xs font-mono text-zinc-500">Đang dựng danh sách boss...</div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="h-full flex items-center justify-center bg-red-950/20 border border-red-900/60 rounded-lg">
        <div className="max-w-xl p-4 text-red-300 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold mb-2">
            <AlertTriangle className="w-4 h-4" />
            Không đọc được dữ liệu boss
          </div>
          <div className="whitespace-pre-wrap">{error}</div>
          <button
            type="button"
            onClick={load}
            className="mt-3 px-3 py-1.5 rounded bg-red-900/70 hover:bg-red-800 cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const fixedCount = snapshot.bosses.filter((boss) => boss.statMode === 'fixed').length;
  const dynamicCount = snapshot.bosses.length - fixedCount;
  const withDropCount = snapshot.bosses.filter(
    (boss) => getBossDropRules(boss, snapshot.itemAnalysis).length > 0
  ).length;
  const dirtyCount = getDirtyBossCount(session);

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="shrink-0 h-11 px-3 bg-zinc-900/90 border border-zinc-800 rounded-lg flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="text-sm font-bold text-zinc-100">Boss</span>
          <StatChip text={`${snapshot.bosses.length} tổng`} />
          <StatChip text={`${fixedCount} cố định`} />
          <StatChip text={`${dynamicCount} runtime`} />
          <StatChip text={`${withDropCount} có drop`} />
          {dirtyCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 text-[10px] font-mono">
              {dirtyCount} nháp
            </span>
          )}
        </div>

        <div
          className={`shrink-0 flex items-center gap-1.5 text-[10px] font-mono ${
            snapshot.verified ? 'text-emerald-400' : 'text-amber-400'
          }`}
          title={snapshot.verificationDetail}
        >
          {snapshot.verified ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5" />
          )}
          <span className="hidden 2xl:inline">{snapshot.verified ? 'Đã xác minh cấu trúc' : 'Cần kiểm tra cấu trúc'}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[350px_minmax(0,1fr)] gap-2">
        <aside className="min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
          <div className="shrink-0 p-2 border-b border-zinc-800 bg-zinc-950/50 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tên, map, char ID, item..."
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md pl-8 pr-2 py-1.5 text-[11px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-rose-500 font-mono"
              />
            </div>

            <div className="flex gap-1 overflow-x-auto">
              <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} label="Tất cả" />
              <FilterButton active={filter === 'fixed'} onClick={() => setFilter('fixed')} label="Cố định" />
              <FilterButton active={filter === 'dynamic'} onClick={() => setFilter('dynamic')} label="Runtime" />
              <FilterButton active={filter === 'with-drop'} onClick={() => setFilter('with-drop')} label="Có drop" />
              <span className="ml-auto px-1.5 py-1 text-[9px] text-zinc-600 font-mono whitespace-nowrap">
                {filteredBosses.length}/{snapshot.bosses.length}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredBosses.map((boss) => {
              const selected = boss.index === selectedIndex;
              const draft = getBossDraft(session, boss);
              const dirty = isBossDraftDirty(boss, draft);
              const drops = getBossDropRules(boss, snapshot.itemAnalysis);
              const runtime = describeBossRuntime(boss);

              return (
                <button
                  key={boss.index}
                  type="button"
                  onClick={() => setSelectedIndex(boss.index)}
                  className={`w-full h-[58px] text-left px-2.5 border-b border-zinc-800/70 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-rose-500/10 border-l-2 border-l-rose-400'
                      : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="h-full flex items-center gap-2">
                    <span className="text-[9px] font-mono text-rose-400 w-6 shrink-0">
                      #{boss.index}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-zinc-100 truncate">
                          {draft.name}
                        </span>
                        {dirty && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" title="Có nháp" />}
                      </div>
                      <div className="text-[9px] text-zinc-500 font-mono mt-0.5 truncate">
                        map {boss.mapId} · char {boss.charId} · HP{' '}
                        {boss.statMode === 'fixed'
                          ? boss.hp.toLocaleString('vi-VN')
                          : runtime.hpText}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1">
                      {drops.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25 text-[8px] font-mono">
                          {drops.length}
                        </span>
                      )}
                      <ChevronRight className="w-3 h-3 text-zinc-600" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden">
          {selectedBoss ? (
            <BossDetail
              session={session}
              snapshot={snapshot}
              boss={selectedBoss}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-zinc-500 font-mono">
              Chọn một boss.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function BossDetail({
  session,
  snapshot,
  boss,
  onChanged,
}: {
  session: LoadedJarSession;
  snapshot: BossAnalysisSnapshot;
  boss: BossDefinition;
  onChanged: () => void;
}) {
  const [draft, setDraftState] = useState<BossDraft>(() => getBossDraft(session, boss));

  useEffect(() => {
    setDraftState(getBossDraft(session, boss));
  }, [session, boss.index]);

  const runtime = describeBossRuntime(boss);
  const dropRules = getBossDropRules(boss, snapshot.itemAnalysis);
  const dirty = isBossDraftDirty(boss, draft);

  const saveDraft = (next: BossDraft) => {
    setBossDraft(session, boss, next);
    setDraftState(getBossDraft(session, boss));
    onChanged();
  };

  const patchDraft = (patch: Partial<BossDraft>) => {
    saveDraft({ ...draft, ...patch });
  };

  const handleReset = () => {
    setDraftState(resetBossDraft(session, boss));
    onChanged();
  };

  const setStatByMultiplier = (
    field: 'hpOverride' | 'damageOverride',
    base: number,
    multiplier: number
  ) => {
    patchDraft({ [field]: Math.max(1, Math.round(base * multiplier)) } as Partial<BossDraft>);
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 h-12 px-3 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[9px] font-mono font-bold">
            #{boss.index}
          </span>
          <h3 className="text-sm font-bold text-zinc-100 truncate">{draft.name}</h3>
          <span className="hidden 2xl:inline text-[9px] text-zinc-600 font-mono">
            char {boss.charId} · map {boss.mapId} · family {boss.family}/{boss.stage}
          </span>
          {dirty && (
            <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/30 text-[9px] font-mono">
              nháp
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleReset}
          disabled={!dirty}
          className="shrink-0 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-35 disabled:cursor-not-allowed text-[10px] text-zinc-300 font-mono flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          Hoàn tác
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-1 xl:grid-cols-[250px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)] gap-3 items-start">
          <div className="space-y-2">
            <NpcBodyPreview
              session={session}
              head={draft.head}
              body={draft.body}
              leg={draft.leg}
              alt={draft.name}
              title="Toàn thân Boss"
              compact
            />

            <div className="grid grid-cols-3 gap-1">
              <MiniValue label="Map" value={boss.mapId} />
              <MiniValue label="Char" value={boss.charId} />
              <MiniValue label="Variant" value={boss.variant} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 2xl:grid-cols-4 gap-2">
              <TextEditor
                label="Tên boss"
                value={draft.name}
                onChange={(value) => patchDraft({ name: value })}
              />
              <NumberEditor
                label="Spawn X"
                value={draft.spawnX}
                min={0}
                onChange={(value) => patchDraft({ spawnX: value })}
              />
              <NullableNumberEditor
                label="Máu (HP)"
                value={draft.hpOverride}
                placeholder={boss.statMode === 'fixed' ? String(boss.hp) : 'Giữ runtime'}
                onChange={(value) => patchDraft({ hpOverride: value })}
                presets={
                  boss.statMode === 'fixed'
                    ? QUICK_MULTIPLIERS.map((multiplier) => ({
                        label: `x${multiplier}`,
                        onClick: () => setStatByMultiplier('hpOverride', boss.hp, multiplier),
                      }))
                    : undefined
                }
                onUseRuntime={
                  boss.statMode === 'fixed' ? undefined : () => patchDraft({ hpOverride: null })
                }
              />
              <NullableNumberEditor
                label="Sát thương"
                value={draft.damageOverride}
                placeholder={boss.statMode === 'fixed' ? String(boss.damage) : 'Giữ runtime'}
                onChange={(value) => patchDraft({ damageOverride: value })}
                presets={
                  boss.statMode === 'fixed'
                    ? QUICK_MULTIPLIERS.map((multiplier) => ({
                        label: `x${multiplier}`,
                        onClick: () => setStatByMultiplier('damageOverride', boss.damage, multiplier),
                      }))
                    : undefined
                }
                onUseRuntime={
                  boss.statMode === 'fixed' ? undefined : () => patchDraft({ damageOverride: null })
                }
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <PartEditor label="Head" value={draft.head} onChange={(value) => patchDraft({ head: value })} />
              <PartEditor label="Body" value={draft.body} onChange={(value) => patchDraft({ body: value })} />
              <PartEditor label="Leg" value={draft.leg} onChange={(value) => patchDraft({ leg: value })} />
            </div>

            <div className="flex flex-wrap gap-1.5 text-[9px] font-mono">
              <InfoChip label="HP gốc" value={runtime.hpText} />
              <InfoChip label="Damage gốc" value={runtime.damageText} />
              <InfoChip label="Part" value={`${boss.head}/${boss.body}/${boss.leg}`} />
              <InfoChip label="Spawn gốc" value={boss.spawnX} />
            </div>

            {boss.statMode !== 'fixed' && (
              <details className="rounded-md border border-amber-900/40 bg-amber-950/15">
                <summary className="px-2.5 py-1.5 cursor-pointer text-[10px] font-mono text-amber-300 select-none">
                  Cách tính HP runtime
                </summary>
                <div className="px-2.5 pb-2 text-[10px] text-zinc-500 leading-relaxed">
                  {runtime.detail}
                </div>
              </details>
            )}
          </div>
        </div>

        <BossDropsEditor
          session={session}
          snapshot={snapshot}
          boss={boss}
          draft={draft}
          dropRules={dropRules}
          onSave={saveDraft}
        />
      </div>
    </div>
  );
}

function BossDropsEditor({
  session,
  snapshot,
  boss,
  draft,
  dropRules,
  onSave,
}: {
  session: LoadedJarSession;
  snapshot: BossAnalysisSnapshot;
  boss: BossDefinition;
  draft: BossDraft;
  dropRules: BossDropRule[];
  onSave: (draft: BossDraft) => void;
}) {
  const updateRuleChance = (rule: BossDropRule, value: number) => {
    const next = { ...draft.dropChanceOverrides };
    const normalized = Math.max(0, Math.min(100, value));
    if (Math.abs(normalized - rule.chancePercent) < 0.000001) delete next[rule.key];
    else next[rule.key] = normalized;
    onSave({ ...draft, dropChanceOverrides: next });
  };

  const updateRuleQuantity = (rule: BossDropRule, value: number) => {
    const next = { ...draft.dropQuantityOverrides };
    const normalized = Math.max(1, Math.round(value));
    if (normalized === rule.quantity) delete next[rule.key];
    else next[rule.key] = normalized;
    onSave({ ...draft, dropQuantityOverrides: next });
  };

  const addCustom = () => {
    onSave({ ...draft, customDrops: [...draft.customDrops, createCustomBossDrop()] });
  };

  const updateCustom = (id: string, patch: Partial<BossCustomDrop>) => {
    onSave({
      ...draft,
      customDrops: draft.customDrops.map((drop) =>
        drop.id === id ? { ...drop, ...patch } : drop
      ),
    });
  };

  const removeCustom = (id: string) => {
    onSave({
      ...draft,
      customDrops: draft.customDrops.filter((drop) => drop.id !== id),
    });
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 overflow-hidden">
      <div className="h-10 px-3 border-b border-zinc-800 bg-zinc-900/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PackageOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs font-bold text-zinc-100">Vật phẩm rơi</span>
          <span className="text-[9px] text-zinc-600 font-mono">
            {dropRules.length} rule · {draft.customDrops.length} thêm
          </span>
        </div>

        <button
          type="button"
          onClick={addCustom}
          className="shrink-0 px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-mono flex items-center gap-1 cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          Thêm drop
        </button>
      </div>

      <div className="p-2.5 space-y-2">
        {dropRules.length === 0 && draft.customDrops.length === 0 && (
          <div className="py-3 text-center text-[10px] text-zinc-600 font-mono">
            Chưa có rule drop riêng được phát hiện.
          </div>
        )}

        {dropRules.map((rule) => {
          const chance = draft.dropChanceOverrides[rule.key] ?? rule.chancePercent;
          const quantity = draft.dropQuantityOverrides[rule.key] ?? rule.quantity;
          const changed =
            chance !== rule.chancePercent || quantity !== rule.quantity;

          return (
            <div
              key={rule.key}
              className="rounded-md border border-zinc-800 bg-zinc-900/55 p-2.5"
              title={`${rule.condition}\n${rule.source}`}
            >
              <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-2">
                <div className="min-w-0 2xl:w-[230px] shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-semibold text-zinc-100 truncate">{rule.title}</span>
                    <ScopeBadge scope={rule.scope} />
                    {changed && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                  </div>
                  <div className="text-[9px] text-zinc-600 font-mono truncate mt-0.5">
                    {rule.source}
                  </div>
                </div>

                <div className="min-w-0 flex-1 flex gap-1.5 overflow-x-auto">
                  {rule.itemRefs.map((item) => (
                    <div
                      key={item.id}
                      className="min-w-[135px] max-w-[180px] h-11 px-1.5 rounded-md bg-zinc-950 border border-zinc-800 flex items-center gap-1.5"
                    >
                      <SmallImagePreview
                        session={session}
                        imageId={item.iconId}
                        alt={item.name}
                        variant="icon"
                      />
                      <div className="min-w-0">
                        <div className="text-[10px] text-zinc-100 font-medium truncate" title={item.name}>
                          {item.name}
                        </div>
                        <div className="text-[8px] text-zinc-600 font-mono">#{item.id}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="shrink-0 grid grid-cols-[92px_72px] gap-1.5">
                  <CompactNumber
                    label="%"
                    value={Number(chance.toFixed(4))}
                    min={0}
                    max={100}
                    step={0.1}
                    disabled={!rule.editable}
                    onChange={(value) => updateRuleChance(rule, value)}
                  />
                  <CompactNumber
                    label="SL"
                    value={quantity}
                    min={1}
                    disabled={!rule.editable}
                    onChange={(value) => updateRuleQuantity(rule, value)}
                  />
                </div>
              </div>

              <details className="mt-1.5">
                <summary className="cursor-pointer select-none text-[9px] text-zinc-600 hover:text-zinc-400 font-mono">
                  Chi tiết kỹ thuật
                </summary>
                <div className="pt-1.5 text-[9px] text-zinc-500 leading-relaxed">
                  {rule.condition}
                  {rule.note && <div className="mt-1 text-amber-500/80">{rule.note}</div>}
                </div>
              </details>
            </div>
          );
        })}

        {draft.customDrops.length > 0 && (
          <div className="pt-1 space-y-1.5">
            <div className="text-[9px] uppercase tracking-wider text-violet-400 font-mono">
              Drop thêm
            </div>

            {draft.customDrops.map((drop) => {
              const item = resolveBossItem(snapshot.itemAnalysis, Number(drop.itemId) || 0);
              return (
                <div
                  key={drop.id}
                  className="min-h-12 p-2 rounded-md bg-violet-950/10 border border-violet-900/30 grid grid-cols-[42px_minmax(140px,1fr)_92px_72px_32px] gap-1.5 items-center"
                >
                  <SmallImagePreview
                    session={session}
                    imageId={item.iconId}
                    alt={item.name}
                    variant="icon"
                  />

                  <div className="min-w-0">
                    <input
                      type="number"
                      min="0"
                      value={drop.itemId}
                      onChange={(event) => updateCustom(drop.id, { itemId: event.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-100 font-mono focus:outline-none focus:border-violet-500"
                      placeholder="Item ID"
                    />
                    <div className="text-[8px] text-zinc-600 mt-0.5 truncate">{item.name}</div>
                  </div>

                  <CompactNumber
                    label="%"
                    value={drop.chancePercent}
                    min={0}
                    max={100}
                    step={0.1}
                    onChange={(value) => updateCustom(drop.id, { chancePercent: value })}
                  />

                  <CompactNumber
                    label="SL"
                    value={drop.quantity}
                    min={1}
                    onChange={(value) => updateCustom(drop.id, { quantity: value })}
                  />

                  <button
                    type="button"
                    onClick={() => removeCustom(drop.id)}
                    className="w-8 h-8 rounded-md border border-red-900/50 bg-red-950/20 hover:bg-red-950/50 text-red-400 flex items-center justify-center cursor-pointer"
                    title="Xóa"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {(dropRules.some((rule) => rule.scope !== 'boss') || draft.customDrops.length > 0) && (
          <details className="pt-1">
            <summary className="cursor-pointer select-none flex items-center gap-1 text-[9px] text-zinc-600 hover:text-zinc-400 font-mono">
              <Info className="w-3 h-3" />
              Lưu ý phạm vi chỉnh sửa
            </summary>
            <div className="pt-1.5 text-[9px] text-zinc-500 leading-relaxed">
              Rule theo char/map/mode có thể dùng chung cho nhiều boss. Drop thêm mới hiện là nháp và cần writer boss-specific để ghi xuống JAR.
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function StatChip({ text }: { text: string }) {
  return (
    <span className="hidden lg:inline px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[9px] text-zinc-500 font-mono whitespace-nowrap">
      {text}
    </span>
  );
}

function MiniValue({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 min-w-0">
      <div className="text-[8px] uppercase text-zinc-600 font-mono">{label}</div>
      <div className="text-[10px] text-zinc-200 font-mono truncate">{value}</div>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-500">
      {label}: <strong className="text-zinc-300 font-normal">{value}</strong>
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
      className={`px-2 py-1 rounded border text-[9px] font-mono whitespace-nowrap cursor-pointer ${
        active
          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );
}

function TextEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] uppercase text-zinc-600 font-mono">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[11px] text-zinc-100 focus:outline-none focus:border-violet-500"
      />
    </label>
  );
}

function NumberEditor({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] uppercase text-zinc-600 font-mono">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[11px] text-zinc-100 font-mono focus:outline-none focus:border-violet-500"
      />
    </label>
  );
}

function NullableNumberEditor({
  label,
  value,
  placeholder,
  onChange,
  presets,
  onUseRuntime,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  onChange: (value: number | null) => void;
  presets?: Array<{ label: string; onClick: () => void }>;
  onUseRuntime?: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[9px] uppercase text-zinc-600 font-mono">{label}</div>
      <input
        type="number"
        min="1"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? null : Number(raw));
        }}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[11px] text-zinc-100 font-mono placeholder-zinc-700 focus:outline-none focus:border-violet-500"
      />
      <div className="flex gap-0.5 overflow-x-auto">
        {presets?.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={preset.onClick}
            className="px-1.5 py-0.5 rounded border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-[8px] text-zinc-500 font-mono cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
        {onUseRuntime && (
          <button
            type="button"
            onClick={onUseRuntime}
            className="px-1.5 py-0.5 rounded border border-amber-900/40 bg-amber-950/15 text-[8px] text-amber-400 font-mono cursor-pointer whitespace-nowrap"
          >
            runtime
          </button>
        )}
      </div>
    </div>
  );
}

function PartEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[9px] uppercase text-zinc-600 font-mono">{label}</div>
      <div className="grid grid-cols-[28px_1fr_28px] gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 cursor-pointer"
        >
          −
        </button>
        <input
          type="number"
          min="0"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="bg-zinc-950 border border-zinc-700 rounded-md px-1 py-1.5 text-[10px] text-zinc-100 font-mono text-center focus:outline-none focus:border-cyan-500"
        />
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 cursor-pointer"
        >
          +
        </button>
      </div>
    </div>
  );
}

function CompactNumber({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="relative block">
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-zinc-600 font-mono pointer-events-none">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md pl-6 pr-1.5 py-1.5 text-[10px] text-zinc-100 font-mono focus:outline-none focus:border-violet-500 disabled:opacity-50"
      />
    </label>
  );
}

function ScopeBadge({ scope }: { scope: BossDropRule['scope'] }) {
  const labels: Record<BossDropRule['scope'], string> = {
    boss: 'boss',
    char: 'char',
    map: 'map',
    mode: 'mode',
  };
  return (
    <span className="px-1 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[8px] font-mono shrink-0">
      {labels[scope]}
    </span>
  );
}

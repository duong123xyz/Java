import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  AlertTriangle,
  Boxes,
  Bug,
  CheckCircle2,
  ChevronRight,
  Gauge,
  Heart,
  Loader2,
  MapPinned,
  PackagePlus,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Sparkles,
  Swords,
  Trash2,
  Zap,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { JarImagePreview } from '../map/JarImagePreview';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import { analyzeItemTables } from '../../services/itemDataService';
import {
  analyzeMobs,
  getDirtyMobCount,
  getMobDraft,
  getMobTypeLabel,
  isMobDraftDirty,
  MobDataSnapshot,
  MobDraft,
  MobMapUsage,
  resetMobDraft,
  setMobDraft,
} from '../../services/mobDataService';
import {
  deleteMobDropRule,
  getMobDropRules,
  getMobDropRuleCount,
  MobDropRule,
  upsertMobDropRule,
} from '../../services/mobDropDraftService';

interface MobPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (count: number) => void;
}

type SpawnFilter = 'all' | 'used' | 'unused';
type NumericMobDraftKey = Exclude<keyof MobDraft, 'name'>;

interface ItemLookupEntry {
  id: number;
  name: string;
  iconId: string;
  type: string;
}

const JAVA_INT_MAX = 2_147_483_647;

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('vi-VN') : '0';
}

function clampNumber(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .trim();
}

function createBlankDropRule(mobId: number): MobDropRule {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    sourceType: 'mob',
    sourceId: mobId,
    ruleId: `custom-${suffix}`,
    itemId: 14,
    chancePercent: 10,
    quantityMin: 1,
    quantityMax: 1,
    enabled: true,
    note: '',
  };
}

export function MobPanel({ session, onDraftsUpdated }: MobPanelProps) {
  const [snapshot, setSnapshot] = useState<MobDataSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dirtyOnly, setDirtyOnly] = useState(false);
  const [spawnFilter, setSpawnFilter] = useState<SpawnFilter>('all');
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<'list' | 'editor'>('list');
  const [mobSubTab, setMobSubTab] = useState<'stats' | 'drops' | 'maps' | 'sprite'>('stats');
  const [revision, setRevision] = useState(0);
  const [dropRules, setDropRules] = useState<MobDropRule[]>([]);
  const [savedRuleId, setSavedRuleId] = useState<string | null>(null);
  const [itemLookup, setItemLookup] = useState<Map<string, ItemLookupEntry>>(new Map());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeMobs(session);
      setSnapshot(result);
      setSelectedRow((current) => current ?? result.mobs[0]?.rowIndex ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const analysis = session.itemAnalysis ?? (await analyzeItemTables(session));
        session.itemAnalysis = analysis;
        if (cancelled) return;

        const lookup = new Map<string, ItemLookupEntry>();
        for (const item of analysis.items) {
          const rawId = String(item.id ?? '').trim();
          const parsedId = Number(rawId);
          if (!rawId || !Number.isInteger(parsedId) || parsedId < 0 || lookup.has(rawId)) continue;
          lookup.set(rawId, {
            id: parsedId,
            name: String(item.name || `Item #${rawId}`),
            iconId: String(item.iconId || ''),
            type: String(item.type || ''),
          });
        }
        setItemLookup(lookup);
      } catch (err) {
        console.warn('[MobPanel] Không dựng được item lookup:', err);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const onDraftsUpdatedRef = useRef(onDraftsUpdated);
  onDraftsUpdatedRef.current = onDraftsUpdated;

  useEffect(() => {
    if (!snapshot) return;
    void revision;
    // Saved mob-drop rules are real workspace changes too. Without counting
    // them here, App.totalDirtyDrafts stays 0 and 'Test workspace' remains
    // disabled even though V19's runtime writer can build these rules.
    const templateDrafts = getDirtyMobCount(session, snapshot.mobs);
    const dropRuleDrafts = getMobDropRuleCount(session);
    onDraftsUpdatedRef.current?.(templateDrafts + dropRuleDrafts);
  }, [session, snapshot, revision, dropRules]);

  const visibleMobs = useMemo(() => {
    if (!snapshot) return [];
    const q = normalizeSearch(query);
    return snapshot.mobs.filter((mob) => {
      const hasSpawn = mob.totalSpawnCount > 0;
      if (spawnFilter === 'used' && !hasSpawn) return false;
      if (spawnFilter === 'unused' && hasSpawn) return false;
      if (dirtyOnly && !isMobDraftDirty(mob, getMobDraft(session, mob))) return false;
      if (!q) return true;
      return (
        normalizeSearch(mob.name).includes(q) ||
        String(mob.id).includes(q) ||
        String(mob.type).includes(q) ||
        mob.maps.some(
          (usage) =>
            normalizeSearch(usage.mapName).includes(q) || String(usage.mapId).includes(q)
        )
      );
    });
  }, [snapshot, query, dirtyOnly, spawnFilter, session, revision]);

  const selectedMob = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.mobs.find((mob) => mob.rowIndex === selectedRow) ??
      visibleMobs[0] ??
      snapshot.mobs[0] ??
      null
    );
  }, [snapshot, selectedRow, visibleMobs]);

  useEffect(() => {
    if (!selectedMob) {
      setDropRules([]);
      return;
    }
    setDropRules(getMobDropRules(session, selectedMob.id));
    setSavedRuleId(null);
  }, [session, selectedMob?.id]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-500" />
          <div className="text-xs font-mono text-zinc-500">Đang đọc bảng quái a/a/a/A...</div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-red-200 bg-red-50">
        <div className="max-w-xl p-4 text-red-700 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold mb-2">
            <AlertTriangle className="w-4 h-4" />
            Không đọc được bảng quái
          </div>
          <div className="whitespace-pre-wrap">{error}</div>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const dirtyCount = getDirtyMobCount(session, snapshot.mobs);
  const draft = selectedMob ? getMobDraft(session, selectedMob) : null;
  const dirty = Boolean(selectedMob && draft && isMobDraftDirty(selectedMob, draft));
  const usedMobCount = snapshot.mobs.filter((mob) => mob.totalSpawnCount > 0).length;

  const saveDraft = (next: MobDraft) => {
    if (!selectedMob) return;
    setMobDraft(session, selectedMob, next);
    setRevision((value) => value + 1);
  };

  const applyNumber = (key: NumericMobDraftKey, value: number) => {
    if (!draft) return;
    saveDraft({ ...draft, [key]: value } as MobDraft);
  };

  const updateDropRule = (ruleId: string, patch: Partial<MobDropRule>) => {
    setSavedRuleId(null);
    setDropRules((current) =>
      current.map((rule) => (rule.ruleId === ruleId ? { ...rule, ...patch } : rule))
    );
  };

  const addDropRule = () => {
    if (!selectedMob) return;
    setSavedRuleId(null);
    setDropRules((current) => [...current, createBlankDropRule(selectedMob.id)]);
  };

  const saveDropRule = (rule: MobDropRule) => {
    if (!selectedMob) return;
    const normalized: MobDropRule = {
      ...rule,
      itemId: Math.max(0, Math.round(rule.itemId)),
      chancePercent: clampNumber(rule.chancePercent, 0, 100, 0),
      quantityMin: clampNumber(Math.round(rule.quantityMin || 1), 1, JAVA_INT_MAX, 1),
      quantityMax: clampNumber(Math.round(rule.quantityMax || rule.quantityMin || 1), 1, JAVA_INT_MAX, 1),
    };
    normalized.quantityMax = Math.max(normalized.quantityMin, normalized.quantityMax);

    const saved = upsertMobDropRule(session, selectedMob.id, normalized);
    setDropRules(getMobDropRules(session, selectedMob.id));
    setSavedRuleId(saved.ruleId);
    window.setTimeout(
      () => setSavedRuleId((current) => (current === saved.ruleId ? null : current)),
      1200
    );
  };

  const removeDropRule = (rule: MobDropRule) => {
    if (!selectedMob) return;
    deleteMobDropRule(session, selectedMob.id, rule.ruleId);
    setDropRules((current) => current.filter((item) => item.ruleId !== rule.ruleId));
    setSavedRuleId(null);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-1.5 sm:gap-2">
      {/* 1. Header Banner - Ẩn trên mobile khi đang ở chế độ Soạn thảo để tối đa hóa không gian nhìn */}
      <div className={`shrink-0 rounded-xl border border-zinc-200 bg-white shadow-2xs px-3 py-2 sm:py-2.5 items-center justify-between gap-3 ${
        mobileTab === 'editor' ? 'hidden xl:flex' : 'flex'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
            <Bug className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className="text-sm font-bold text-zinc-900">Quái</span>
              <Chip>{snapshot.mobs.length} template</Chip>
              <Chip>{usedMobCount} trên map</Chip>
              <Chip>{snapshot.totalSpawnCount} spawn</Chip>
              {dirtyCount > 0 && <Chip className="text-amber-700 bg-amber-50 border-amber-200">{dirtyCount} nháp</Chip>}
            </div>
            <div className="hidden sm:block text-[10px] text-zinc-500 mt-0.5">
              Chỉnh template quái + map xuất hiện + cấu hình vật phẩm rơi riêng từng mob.
            </div>
          </div>
        </div>
        <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-emerald-600 font-mono">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Template writer: a/a/a/A.u
        </div>
      </div>

      {/* Segmented bar trên Mobile - chỉ hiện khi ở chế độ danh sách */}
      <div className={`xl:hidden items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-xl shrink-0 ${
        mobileTab === 'editor' ? 'hidden' : 'flex'
      }`}>
        <button
          type="button"
          onClick={() => setMobileTab('list')}
          className="flex-1 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow-xs"
        >
          <Bug className="w-3.5 h-3.5" />
          <span>Danh sách quái ({visibleMobs.length})</span>
        </button>
        {selectedMob && (
          <button
            type="button"
            onClick={() => setMobileTab('editor')}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 text-zinc-400 hover:text-zinc-200"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="truncate max-w-[140px]">
              Sửa: {draft?.name || selectedMob.name}
            </span>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-2">
        <aside className={`min-h-0 rounded-xl border border-zinc-200 bg-white shadow-2xs overflow-hidden flex flex-col ${
          mobileTab === 'editor' ? 'hidden xl:flex' : 'flex'
        }`}>
          <div className="shrink-0 p-2.5 border-b border-zinc-200 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm tên, mob ID, type, map..."
                className="w-full pl-8 pr-7 py-2 sm:py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 text-[16px] sm:text-[11px] text-zinc-900 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 font-mono"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-xs p-1"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none touch-pan-x">
              <FilterButton active={spawnFilter === 'all'} onClick={() => setSpawnFilter('all')}>Tất cả</FilterButton>
              <FilterButton active={spawnFilter === 'used'} onClick={() => setSpawnFilter('used')}>Có spawn</FilterButton>
              <FilterButton active={spawnFilter === 'unused'} onClick={() => setSpawnFilter('unused')}>Chưa thấy map</FilterButton>
              <FilterButton active={dirtyOnly} onClick={() => setDirtyOnly((value) => !value)}>Có nháp</FilterButton>
            </div>
          </div>

          <div className="shrink-0 h-8 px-3 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 text-[9px] text-zinc-500 font-mono">
            <span>Danh sách quái ({visibleMobs.length}/{snapshot.mobs.length})</span>
            <span className="text-emerald-700 font-bold">Chạm để chỉnh sửa →</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1.5">
            {visibleMobs.map((mob) => {
              const rowDraft = getMobDraft(session, mob);
              const rowDirty = isMobDraftDirty(mob, rowDraft);
              const selected = selectedMob?.rowIndex === mob.rowIndex;
              return (
                <button
                  key={mob.rowIndex}
                  type="button"
                  onClick={() => {
                    setSelectedRow(mob.rowIndex);
                    setMobileTab('editor');
                    setMobSubTab('stats');
                  }}
                  className={`w-full rounded-xl border p-2.5 text-left transition-all cursor-pointer active:scale-[0.98] ${
                    selected
                      ? 'border-emerald-500 bg-emerald-50/90 ring-1 ring-emerald-400/50 shadow-xs'
                      : rowDirty
                        ? 'border-amber-300 bg-amber-50/60 hover:bg-amber-50'
                        : 'border-zinc-200 bg-white hover:bg-zinc-50 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <JarImagePreview
                      session={session}
                      path={`x1/mob/${mob.id}/img.png`}
                      alt={mob.name}
                      variant="icon"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <div className="font-bold text-[13px] text-zinc-900 truncate">{rowDraft.name}</div>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-600 shrink-0">#{mob.id}</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{getMobTypeLabel(mob.type)} · {mob.maps.length} map</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-zinc-700 font-mono">
                        <span className="bg-rose-50 px-1 py-0.2 rounded text-rose-800">HP {formatNumber(rowDraft.hp)}</span>
                        <span className="bg-blue-50 px-1 py-0.2 rounded text-blue-800">SPD {formatNumber(rowDraft.speed)}</span>
                        <span>Spawn: {mob.totalSpawnCount}</span>
                        <span>Map: {mob.maps.length}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className={`min-h-0 rounded-xl border border-zinc-200 bg-white shadow-2xs overflow-hidden flex flex-col ${
          mobileTab === 'list' ? 'hidden xl:flex' : 'flex'
        }`}>
          {!selectedMob || !draft ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-500 text-sm gap-2">
              <Bug className="w-8 h-8 text-zinc-300" />
              <span>Chọn một quái từ danh sách để xem và chỉnh sửa chi tiết.</span>
              <button
                type="button"
                onClick={() => setMobileTab('list')}
                className="xl:hidden px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
              >
                Mở danh sách quái
              </button>
            </div>
          ) : (
            <>
              {/* Header trình soạn thảo quái */}
              <div className="shrink-0 p-2.5 sm:p-3 border-b border-zinc-200 bg-white flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Nút quay lại danh sách trên mobile */}
                  <button
                    type="button"
                    onClick={() => setMobileTab('list')}
                    className="xl:hidden h-8.5 px-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0 border border-zinc-200"
                  >
                    <ChevronRight className="w-3.5 h-3.5 rotate-180 text-zinc-600" />
                    <span>Danh sách</span>
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className="text-sm sm:text-base font-bold text-zinc-900 truncate">{draft.name}</h2>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-600 border border-zinc-200">
                        #{selectedMob.id}
                      </span>
                      {dirty && (
                        <span className="px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[9px] font-bold border border-emerald-300 animate-pulse">
                          Đã sửa
                        </span>
                      )}
                    </div>
                    <div className="hidden sm:block text-[11px] text-zinc-500 font-mono">
                      {getMobTypeLabel(selectedMob.type)} · {selectedMob.maps.length} map · {dropRules.length} rule drop
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      resetMobDraft(session, selectedMob);
                      setRevision((value) => value + 1);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[11px] font-medium text-zinc-700 cursor-pointer flex items-center gap-1"
                    title="Khôi phục thông số quái này về bản gốc ban đầu của JAR"
                  >
                    <RotateCcw className="w-3 h-3 text-zinc-500" />
                    <span className="hidden xs:inline">Về gốc</span>
                  </button>
                </div>
              </div>

              {/* Subtabs trên Mobile & Tablet để dễ dàng truy cập từng nhóm tính năng */}
              <div className="2xl:hidden shrink-0 flex items-center gap-1 p-1.5 bg-zinc-100/80 border-b border-zinc-200 overflow-x-auto scrollbar-none touch-pan-x">
                <button
                  type="button"
                  onClick={() => setMobSubTab('stats')}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
                    mobSubTab === 'stats'
                      ? 'bg-zinc-900 text-white shadow-xs font-bold'
                      : 'bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-200'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Chỉ số quái</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobSubTab('drops')}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
                    mobSubTab === 'drops'
                      ? 'bg-zinc-900 text-white shadow-xs font-bold'
                      : 'bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-200'
                  }`}
                >
                  <PackagePlus className="w-3.5 h-3.5" />
                  <span>Vật phẩm rơi</span>
                  {dropRules.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[9px] font-mono font-bold">
                      {dropRules.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setMobSubTab('maps')}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
                    mobSubTab === 'maps'
                      ? 'bg-zinc-900 text-white shadow-xs font-bold'
                      : 'bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-200'
                  }`}
                >
                  <MapPinned className="w-3.5 h-3.5" />
                  <span>Map ({selectedMob.maps.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobSubTab('sprite')}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
                    mobSubTab === 'sprite'
                      ? 'bg-zinc-900 text-white shadow-xs font-bold'
                      : 'bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-200'
                  }`}
                >
                  <Bug className="w-3.5 h-3.5" />
                  <span>Sprite</span>
                </button>
              </div>

              {/* Vùng nội dung cuộn */}
              <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
                <div className="grid grid-cols-1 2xl:grid-cols-[320px_minmax(0,1fr)] gap-3">
                  {/* Cột trái (Sprite, Quick actions, Thống kê) - Trên 2xl luôn hiện, trên mobile hiện theo tab */}
                  <div className={`space-y-3 ${mobSubTab !== 'sprite' && mobSubTab !== 'stats' ? 'hidden 2xl:block' : ''}`}>
                    {/* Sprite preview */}
                    <div className={`rounded-xl border border-zinc-200 bg-zinc-50 p-3 ${
                      mobSubTab !== 'sprite' ? 'hidden 2xl:block' : 'block'
                    }`}>
                      <div className="text-[11px] font-semibold text-zinc-700 mb-2 flex items-center justify-between">
                        <span>Sprite quái</span>
                        <span className="text-[9px] font-mono text-zinc-400">mob/{selectedMob.id}/img.png</span>
                      </div>
                      <JarImagePreview
                        session={session}
                        path={`x1/mob/${selectedMob.id}/img.png`}
                        alt={draft.name}
                        variant="wide"
                        showPath
                      />
                    </div>

                    {/* Sửa nhanh chỉ số */}
                    <div className={`rounded-xl border border-zinc-200 bg-white p-3 shadow-2xs ${
                      mobSubTab !== 'stats' ? 'hidden 2xl:block' : 'block'
                    }`}>
                      <div className="text-[11px] font-semibold text-zinc-800 mb-2 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>Sửa nhanh tỉ lệ</span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-2 gap-1.5">
                        <QuickButton onClick={() => applyNumber('hp', Math.round(draft.hp * 2))}>HP x2</QuickButton>
                        <QuickButton onClick={() => applyNumber('hp', Math.round(draft.hp * 5))}>HP x5</QuickButton>
                        <QuickButton onClick={() => applyNumber('percentDamage', Math.round(draft.percentDamage * 2))}>Dmg x2</QuickButton>
                        <QuickButton onClick={() => applyNumber('percentTiemNang', Math.round(draft.percentTiemNang * 2))}>TNSM x2</QuickButton>
                        <QuickButton onClick={() => applyNumber('speed', Math.round(draft.speed * 1.5))}>Spd +50%</QuickButton>
                        <QuickButton onClick={() => applyNumber('rangeMove', Math.round(draft.rangeMove * 1.5))}>Range +50%</QuickButton>
                      </div>
                    </div>

                    {/* Thẻ hiển thị chỉ số gốc */}
                    <div className={`grid grid-cols-2 gap-2 ${
                      mobSubTab !== 'stats' ? 'hidden 2xl:grid' : 'grid'
                    }`}>
                      <StatCard icon={<Heart className="w-3.5 h-3.5 text-rose-500" />} label="HP gốc" value={formatNumber(selectedMob.hp)} />
                      <StatCard icon={<Swords className="w-3.5 h-3.5 text-amber-500" />} label="% Damage" value={formatNumber(draft.percentDamage)} />
                      <StatCard icon={<Gauge className="w-3.5 h-3.5 text-blue-500" />} label="Range move" value={formatNumber(draft.rangeMove)} />
                      <StatCard icon={<Zap className="w-3.5 h-3.5 text-violet-500" />} label="% Tiềm năng" value={formatNumber(draft.percentTiemNang)} />
                    </div>
                  </div>

                  {/* Cột phải (Template editor, Drop rules, Map spawns) */}
                  <div className="space-y-3 min-w-0">
                    {/* Nhóm thông số template */}
                    <div className={mobSubTab !== 'stats' ? 'hidden 2xl:block' : 'block'}>
                      <SectionCard title="Thông tin template quái" subtitle="Các chỉ số này áp dụng theo template. Spawn riêng từng map chỉnh trong panel Map.">
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                          <div className="sm:col-span-2 xl:col-span-1">
                            <LabeledInput label="Tên quái" value={draft.name} onChange={(value) => saveDraft({ ...draft, name: value })} />
                          </div>
                          <LabeledNumberInput label="HP" value={draft.hp} onChange={(value) => applyNumber('hp', value)} step={100} min={1} quickDeltas={[-100, 100, 1000]} />
                          <LabeledNumberInput label="Range move" value={draft.rangeMove} onChange={(value) => applyNumber('rangeMove', value)} step={5} min={0} quickDeltas={[-5, 5, 20]} />
                          <LabeledNumberInput label="Speed" value={draft.speed} onChange={(value) => applyNumber('speed', value)} step={1} min={1} quickDeltas={[-1, 1, 5]} />
                          <LabeledNumberInput label="Dart Type" value={draft.dartType} onChange={(value) => applyNumber('dartType', value)} step={1} min={0} />
                          <LabeledNumberInput label="% Damage" value={draft.percentDamage} onChange={(value) => applyNumber('percentDamage', value)} step={10} min={0} unit="%" quickDeltas={[-10, 10, 50]} />
                          <LabeledNumberInput label="% Tiềm năng" value={draft.percentTiemNang} onChange={(value) => applyNumber('percentTiemNang', value)} step={10} min={0} unit="%" quickDeltas={[-10, 10, 50]} />
                          <ReadOnlyField label="TYPE gốc" value={String(selectedMob.type)} />
                          <ReadOnlyField label="Tổng spawn" value={String(selectedMob.totalSpawnCount)} />
                        </div>
                      </SectionCard>
                    </div>

                    {/* Nhóm Vật phẩm rơi (Drop Rules) */}
                    <div className={mobSubTab !== 'drops' ? 'hidden 2xl:block' : 'block'}>
                      <SectionCard
                        title="Vật phẩm rơi"
                        subtitle={`Drop riêng cho mob #${selectedMob.id}. Mỗi item là một rule độc lập; một lần giết có thể trúng nhiều rule.`}
                      >
                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                          Gõ <strong>tên vật phẩm</strong> hoặc <strong>ID</strong>. Panel lấy tên + icon trực tiếp từ Item database của JAR.
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Boxes className="w-4 h-4 text-blue-600" />
                            <div>
                              <div className="text-[11px] font-semibold text-zinc-800">Danh sách item rơi</div>
                              <div className="text-[9px] text-zinc-500">{dropRules.length} rule · search tên/ID · có ảnh preview</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={addDropRule}
                            className="h-8 px-3 rounded-lg border border-blue-300 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-xs font-semibold text-white cursor-pointer flex items-center gap-1 shadow-xs"
                          >
                            <PackagePlus className="w-3.5 h-3.5" />
                            <span>Thêm item</span>
                          </button>
                        </div>

                        {dropRules.length === 0 ? (
                          <div className="mt-3 rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-6 text-center text-[11px] text-blue-700">
                            Mob #{selectedMob.id} chưa có custom drop. Nhấn "Thêm item" để tạo rule rơi đồ!
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {dropRules.map((rule) => (
                              <DropRuleEditor
                                key={rule.ruleId}
                                session={session}
                                rule={rule}
                                itemLookup={itemLookup}
                                saved={savedRuleId === rule.ruleId}
                                onChange={(patch) => updateDropRule(rule.ruleId, patch)}
                                onSave={() => saveDropRule(rule)}
                                onDelete={() => removeDropRule(rule)}
                              />
                            ))}
                          </div>
                        )}
                      </SectionCard>
                    </div>

                    {/* Nhóm Map xuất hiện */}
                    <div className={mobSubTab !== 'maps' ? 'hidden 2xl:block' : 'block'}>
                      <SectionCard title="Map xuất hiện" subtitle="Danh sách map đang có mob này spawn.">
                        {selectedMob.maps.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-[11px] text-zinc-500">Chưa thấy mob này trong dữ liệu spawn.</div>
                        ) : (
                          <div className="space-y-2">
                            {selectedMob.maps.map((usage) => (
                              <MapUsageCard key={`${selectedMob.id}-${usage.mapId}`} usage={usage} />
                            ))}
                          </div>
                        )}
                      </SectionCard>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function DropRuleEditor({
  session,
  rule,
  itemLookup,
  saved,
  onChange,
  onSave,
  onDelete,
}: {
  session: LoadedJarSession;
  rule: MobDropRule;
  itemLookup: Map<string, ItemLookupEntry>;
  saved: boolean;
  onChange: (patch: Partial<MobDropRule>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const item = itemLookup.get(String(rule.itemId));
  const quantityText =
    rule.quantityMin === rule.quantityMax
      ? `Mỗi lần trúng rule: ${formatNumber(rule.quantityMin)} vật phẩm`
      : `Mỗi lần trúng rule: ngẫu nhiên ${formatNumber(rule.quantityMin)}–${formatNumber(rule.quantityMax)} vật phẩm`;

  return (
    <div className={`rounded-xl border p-3 ${rule.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-zinc-200 bg-zinc-50 opacity-80'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {item ? (
            <SmallImagePreview session={session} imageId={item.iconId} alt={item.name} variant="icon" />
          ) : (
            <div className="w-12 h-12 shrink-0 rounded-lg border border-zinc-200 bg-white flex items-center justify-center text-zinc-400 text-xs">?</div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-zinc-900 truncate">{item?.name || `Item #${rule.itemId}`}</span>
              <span className="px-1.5 py-0.5 rounded-full border border-zinc-200 bg-white text-[9px] font-mono text-zinc-500">ID {rule.itemId}</span>
              <span className="px-1.5 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-[9px] font-mono text-blue-700">
                {rule.chancePercent}% · {rule.quantityMin === rule.quantityMax ? `x${rule.quantityMin}` : `x${rule.quantityMin}-${rule.quantityMax}`}
              </span>
            </div>
            <div className="text-[9px] text-zinc-500 mt-1 font-mono">{quantityText}</div>
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-[10px] text-zinc-600 cursor-pointer shrink-0">
          <input type="checkbox" checked={rule.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
          Bật rule
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,1.5fr)_minmax(120px,.65fr)_minmax(120px,.65fr)_minmax(120px,.65fr)] gap-2">
        <ItemPicker
          session={session}
          value={rule.itemId}
          itemLookup={itemLookup}
          onChange={(itemId) => onChange({ itemId })}
        />
        <LabeledNumberInput label="Tỷ lệ %" value={rule.chancePercent} step="0.01" onChange={(value) => onChange({ chancePercent: clampNumber(value, 0, 100, 0) })} />
        <LabeledNumberInput
          label="SL min"
          value={rule.quantityMin}
          onChange={(value) => {
            const nextMin = clampNumber(Math.round(value || 1), 1, JAVA_INT_MAX, 1);
            onChange({ quantityMin: nextMin, quantityMax: Math.max(nextMin, rule.quantityMax) });
          }}
        />
        <LabeledNumberInput
          label="SL max"
          value={rule.quantityMax}
          onChange={(value) => {
            const nextMax = clampNumber(Math.round(value || rule.quantityMin), rule.quantityMin, JAVA_INT_MAX, rule.quantityMin);
            onChange({ quantityMax: nextMax });
          }}
        />
      </div>

      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] text-emerald-800">
        {rule.quantityMin === 1 && rule.quantityMax === 1
          ? 'SL min = 1 và SL max = 1 → mỗi lần rule trúng chỉ tạo đúng 1 item. Không lấy multiplier vàng làm quantity.'
          : quantityText}
      </div>

      <div className="mt-2 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-2">
        <LabeledInput label="Ghi chú" value={rule.note || ''} onChange={(value) => onChange({ note: value })} placeholder="Ghi chú cho rule này" />
        <div className="flex items-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onSave}
            className="flex-1 sm:flex-none h-10 sm:h-8.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95"
          >
            {saved ? <CheckCircle2 className="w-4 h-4 text-white" /> : <Save className="w-4 h-4 text-white" />}
            <span>{saved ? 'Đã lưu rule' : 'Lưu rule'}</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="h-10 sm:h-8.5 px-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-700 text-xs font-semibold cursor-pointer flex items-center justify-center gap-1 transition-all active:scale-95"
            title="Xóa rule rơi này"
          >
            <Trash2 className="w-4 h-4" />
            <span className="sm:hidden">Xóa</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemPicker({
  session,
  value,
  itemLookup,
  onChange,
}: {
  session: LoadedJarSession;
  value: number;
  itemLookup: Map<string, ItemLookupEntry>;
  onChange: (itemId: number) => void;
}) {
  const selected = itemLookup.get(String(value));
  const [searchText, setSearchText] = useState(selected?.name || String(value));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) setSearchText(selected?.name || String(value));
  }, [selected?.name, value, open]);

  const results = useMemo(() => {
    const q = normalizeSearch(searchText);
    const all = Array.from(itemLookup.values());
    if (!q) return all.slice(0, 30);
    return all
      .filter((entry) => normalizeSearch(entry.name).includes(q) || String(entry.id).includes(q))
      .slice(0, 30);
  }, [itemLookup, searchText]);

  const choose = (entry: ItemLookupEntry) => {
    onChange(entry.id);
    setSearchText(entry.name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="text-[10px] text-zinc-500 mb-1 font-mono">Vật phẩm</div>
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
        {selected ? (
          <SmallImagePreview session={session} imageId={selected.iconId} alt={selected.name} variant="icon" />
        ) : (
          <div className="w-12 h-12 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 flex items-center justify-center text-zinc-400">?</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="relative">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={searchText}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setSearchText(event.target.value);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && results[0]) {
                  event.preventDefault();
                  choose(results[0]);
                }
                if (event.key === 'Escape') setOpen(false);
              }}
              placeholder="Gõ tên vật phẩm hoặc ID..."
              className="w-full bg-transparent pl-5 py-1 text-[16px] sm:text-[11px] text-zinc-900 placeholder-zinc-400 focus:outline-none font-mono"
            />
          </div>
          <div className="mt-0.5 text-[9px] text-zinc-500 font-mono truncate">
            {selected ? `ID ${selected.id} · icon ${selected.iconId || '?'}${selected.type ? ` · type ${selected.type}` : ''}` : `ID hiện tại ${value}`}
          </div>
        </div>
      </div>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-[10px] text-zinc-500">Không tìm thấy vật phẩm trong database JAR.</div>
          ) : (
            results.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(entry)}
                className={`w-full px-2.5 py-2 border-b last:border-b-0 border-zinc-100 hover:bg-blue-50 text-left flex items-center gap-2 cursor-pointer ${entry.id === value ? 'bg-blue-50' : 'bg-white'}`}
              >
                <SmallImagePreview session={session} imageId={entry.iconId} alt={entry.name} variant="icon" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-zinc-900 font-semibold truncate">{entry.name}</div>
                  <div className="text-[9px] text-zinc-500 font-mono">ID {entry.id} · icon {entry.iconId || '?'}{entry.type ? ` · type ${entry.type}` : ''}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MapUsageCard({ usage }: { usage: MobMapUsage }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-zinc-900 flex items-center gap-1.5">
            <MapPinned className="w-3.5 h-3.5 text-blue-500" />
            {usage.mapName}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            map #{usage.mapId} · {usage.spawnCount} spawn · cấp TB {usage.avgLevel} · HP spawn TB {usage.avgSpawnHp.toLocaleString('vi-VN')}
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-white border border-zinc-200 text-[10px] font-mono text-zinc-600">{usage.spawnCount} spawn</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {usage.spawns.slice(0, 8).map((spawn) => (
          <span key={`${usage.mapId}-${spawn.index}`} className="px-2 py-1 rounded-lg bg-white border border-zinc-200 text-[10px] font-mono text-zinc-600">
            #{spawn.index} · lv {spawn.level} · ({spawn.x}, {spawn.y})
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3">
      <div className="mb-3">
        <div className="text-[12px] font-semibold text-zinc-800">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-500 mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-zinc-700 font-mono">{label}</div>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full h-10 sm:h-8.5 px-3 pr-8 rounded-lg border border-zinc-300 bg-white text-[16px] sm:text-xs text-zinc-900 font-mono font-medium focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 shadow-2xs transition-colors"
        />
        {value !== '' && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 text-zinc-400 hover:text-zinc-700 text-sm font-bold p-1 cursor-pointer"
            title="Xóa nội dung"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function LabeledNumberInput({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = JAVA_INT_MAX,
  quickDeltas,
  unit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string | number;
  min?: number;
  max?: number;
  quickDeltas?: number[];
  unit?: string;
}) {
  const numStep = typeof step === 'string' ? parseFloat(step) || 1 : step;
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : '0'));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(Number.isFinite(value) ? String(value) : '0');
    }
  }, [value, isFocused]);

  const commitValue = (valStr: string) => {
    const trimmed = valStr.trim();
    if (trimmed === '' || trimmed === '-') {
      setText(String(min));
      onChange(min);
      return;
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, num));
    setText(String(clamped));
    onChange(clamped);
  };

  const adjustBy = (delta: number) => {
    const current = Number(text);
    const base = Number.isFinite(current) ? current : value;
    const next = Math.max(min, Math.min(max, Math.round((base + delta) * 100) / 100));
    setText(String(next));
    onChange(next);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold text-zinc-700 font-mono flex items-center gap-1">
          <span>{label}</span>
          {unit && <span className="text-[10px] text-zinc-400 font-normal">({unit})</span>}
        </label>
        {quickDeltas && quickDeltas.length > 0 && (
          <div className="flex items-center gap-1">
            {quickDeltas.map((delta) => (
              <button
                key={delta}
                type="button"
                onClick={() => adjustBy(delta)}
                className="px-1.5 py-0.2 rounded bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 text-[10px] font-mono font-medium cursor-pointer transition-colors active:scale-95"
              >
                {delta > 0 ? `+${delta}` : delta}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative flex items-center shadow-2xs rounded-lg overflow-hidden border border-zinc-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100">
        {/* Nút giảm */}
        <button
          type="button"
          onClick={() => adjustBy(-numStep)}
          disabled={value <= min}
          className="h-10 sm:h-8.5 px-3 bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 font-bold text-sm flex items-center justify-center cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0 select-none border-r border-zinc-300"
          title={`Giảm ${numStep}`}
        >
          -
        </button>

        {/* Input gõ trực tiếp */}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            commitValue(text);
          }}
          onChange={(e) => {
            const val = e.target.value;
            setText(val);
            const num = Number(val);
            if (val.trim() !== '' && Number.isFinite(num)) {
              onChange(Math.max(min, Math.min(max, num)));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-full h-10 sm:h-8.5 px-2 bg-white text-[16px] sm:text-xs text-zinc-900 font-mono font-semibold focus:outline-none text-center"
        />

        {/* Nút tăng */}
        <button
          type="button"
          onClick={() => adjustBy(numStep)}
          disabled={value >= max}
          className="h-10 sm:h-8.5 px-3 bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 font-bold text-sm flex items-center justify-center cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0 select-none border-l border-zinc-300"
          title={`Tăng ${numStep}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 mb-1 font-mono">{label}</div>
      <div className="px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-100 text-[11px] text-zinc-700">{value}</div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">{icon}{label}</div>
      <div className="mt-1 text-sm font-bold text-zinc-900">{value}</div>
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-600 text-[10px] font-mono ${className ?? ''}`}>{children}</span>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`px-2.5 py-1 rounded-full border text-[10px] font-medium whitespace-nowrap cursor-pointer ${active ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
      {children}
    </button>
  );
}

function QuickButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="px-3 py-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-[11px] font-medium text-zinc-700 cursor-pointer">
      {children}
    </button>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Bug,
  CheckCircle2,
  Gauge,
  Heart,
  Loader2,
  MapPinned,
  PackagePlus,
  Save,
  Search,
  Swords,
  Trash2,
  Zap,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { JarImagePreview } from '../map/JarImagePreview';
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
  name: string;
  iconId: string;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('vi-VN') : '0';
}

function clampNumber(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
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
          const id = String(item.id ?? '').trim();
          if (!id || lookup.has(id)) continue;
          lookup.set(id, {
            name: String(item.name || `Item #${id}`),
            iconId: String(item.iconId || ''),
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

  useEffect(() => {
    if (!snapshot) return;
    void revision;
    onDraftsUpdated?.(getDirtyMobCount(session, snapshot.mobs));
  }, [session, snapshot, revision, onDraftsUpdated]);


  const visibleMobs = useMemo(() => {
    if (!snapshot) return [];
    const q = query.trim().toLowerCase();
    return snapshot.mobs.filter((mob) => {
      const hasSpawn = mob.totalSpawnCount > 0;
      if (spawnFilter === 'used' && !hasSpawn) return false;
      if (spawnFilter === 'unused' && hasSpawn) return false;
      if (dirtyOnly && !isMobDraftDirty(mob, getMobDraft(session, mob))) return false;
      if (!q) return true;
      return (
        mob.name.toLowerCase().includes(q) ||
        String(mob.id).includes(q) ||
        String(mob.type).includes(q) ||
        mob.maps.some(
          (usage) =>
            usage.mapName.toLowerCase().includes(q) || String(usage.mapId).includes(q)
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
      current.map((rule) =>
        rule.ruleId === ruleId ? { ...rule, ...patch } : rule
      )
    );
  };

  const addDropRule = () => {
    if (!selectedMob) return;
    setSavedRuleId(null);
    setDropRules((current) => [...current, createBlankDropRule(selectedMob.id)]);
  };

  const saveDropRule = (rule: MobDropRule) => {
    if (!selectedMob) return;
    const saved = upsertMobDropRule(session, selectedMob.id, rule);
    setDropRules(getMobDropRules(session, selectedMob.id));
    setSavedRuleId(saved.ruleId);
    window.setTimeout(() => setSavedRuleId((current) => current === saved.ruleId ? null : current), 1200);
  };

  const removeDropRule = (rule: MobDropRule) => {
    if (!selectedMob) return;
    deleteMobDropRule(session, selectedMob.id, rule.ruleId);
    setDropRules((current) => current.filter((item) => item.ruleId !== rule.ruleId));
    setSavedRuleId(null);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="shrink-0 rounded-xl border border-zinc-200 bg-white shadow-sm px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <Bug className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-zinc-900">Quái</span>
              <Chip>{snapshot.mobs.length} template</Chip>
              <Chip>{usedMobCount} đang xuất hiện trên map</Chip>
              <Chip>{snapshot.totalSpawnCount} spawn</Chip>
              <Chip>a/a/a/A.u</Chip>
              {dirtyCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono">
                  {dirtyCount} nháp template
                </span>
              )}
              {selectedMob && (
                <span className="px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-mono">
                  {dropRules.length} rule drop
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Chỉnh template quái + map xuất hiện + cấu hình vật phẩm rơi riêng từng mob.
            </div>
          </div>
        </div>
        <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-emerald-600 font-mono">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Template writer: a/a/a/A.u
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
        Chọn một quái rồi vào <strong>Vật phẩm rơi</strong> để thêm Item ID, tỷ lệ và số lượng. Không cần tài khoản admin hay backend; rule được lưu riêng theo JAR trong trình duyệt.
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-2">
        <aside className="min-h-0 rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="shrink-0 p-2.5 border-b border-zinc-200 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm tên, mob ID, type, map..."
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              <FilterButton active={spawnFilter === 'all'} onClick={() => setSpawnFilter('all')}>Tất cả</FilterButton>
              <FilterButton active={spawnFilter === 'used'} onClick={() => setSpawnFilter('used')}>Có spawn</FilterButton>
              <FilterButton active={spawnFilter === 'unused'} onClick={() => setSpawnFilter('unused')}>Chưa thấy map</FilterButton>
              <FilterButton active={dirtyOnly} onClick={() => setDirtyOnly((value) => !value)}>Có nháp</FilterButton>
            </div>
          </div>

          <div className="shrink-0 h-8 px-3 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 text-[9px] text-zinc-500 font-mono">
            <span>Danh sách quái</span>
            <span>{visibleMobs.length}/{snapshot.mobs.length}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
            {visibleMobs.map((mob) => {
              const rowDraft = getMobDraft(session, mob);
              const rowDirty = isMobDraftDirty(mob, rowDraft);
              const selected = selectedMob?.rowIndex === mob.rowIndex;

              return (
                <button
                  key={mob.rowIndex}
                  type="button"
                  onClick={() => setSelectedRow(mob.rowIndex)}
                  className={`w-full rounded-xl border px-2 py-2 text-left transition cursor-pointer ${
                    selected
                      ? 'border-emerald-300 bg-emerald-50'
                      : rowDirty
                      ? 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50'
                      : 'border-zinc-200 bg-white hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <JarImagePreview
                      session={session}
                      path={`x1/mob/${mob.id}/img.png`}
                      alt={mob.name}
                      variant="icon"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-[12px] text-zinc-900 truncate">{rowDraft.name}</div>
                        {rowDirty && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-mono">
                            nháp
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        mob #{mob.id} · {getMobTypeLabel(mob.type)}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-zinc-600 font-mono">
                        <span>HP {formatNumber(rowDraft.hp)}</span>
                        <span>SPD {formatNumber(rowDraft.speed)}</span>
                        <span>Spawn {mob.totalSpawnCount}</span>
                        <span>Map {mob.maps.length}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {visibleMobs.length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-zinc-500">
                Không có quái phù hợp bộ lọc hiện tại.
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col">
          {!selectedMob || !draft ? (
            <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
              Chọn một quái ở cột trái để xem chi tiết.
            </div>
          ) : (
            <>
              <div className="shrink-0 p-3 border-b border-zinc-200">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-bold text-zinc-900 truncate">{draft.name}</h2>
                      <Chip>mob #{selectedMob.id}</Chip>
                      <Chip>{getMobTypeLabel(selectedMob.type)}</Chip>
                      <Chip>{selectedMob.maps.length} map</Chip>
                      <Chip>{dropRules.length} rule drop</Chip>
                      {dirty && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono">
                          Đang có nháp template
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">
                      Template: <strong>a/a/a/A.u</strong> · Sprite: <strong>x1/mob/{selectedMob.id}/img.png</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      resetMobDraft(session, selectedMob);
                      setRevision((value) => value + 1);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[11px] font-medium cursor-pointer"
                  >
                    Trả template về gốc
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-3 space-y-3">
                <div className="grid grid-cols-1 2xl:grid-cols-[320px_minmax(0,1fr)] gap-3">
                  <div className="space-y-3">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                      <div className="text-[11px] font-semibold text-zinc-700 mb-2">Sprite quái</div>
                      <JarImagePreview
                        session={session}
                        path={`x1/mob/${selectedMob.id}/img.png`}
                        alt={draft.name}
                        variant="wide"
                        showPath
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <StatCard icon={<Heart className="w-3.5 h-3.5 text-rose-500" />} label="HP gốc" value={formatNumber(selectedMob.hp)} />
                      <StatCard icon={<Swords className="w-3.5 h-3.5 text-amber-500" />} label="% Damage" value={formatNumber(draft.percentDamage)} />
                      <StatCard icon={<Gauge className="w-3.5 h-3.5 text-blue-500" />} label="Range move" value={formatNumber(draft.rangeMove)} />
                      <StatCard icon={<Zap className="w-3.5 h-3.5 text-violet-500" />} label="% Tiềm năng" value={formatNumber(draft.percentTiemNang)} />
                    </div>

                    <div className="rounded-xl border border-zinc-200 p-3">
                      <div className="text-[11px] font-semibold text-zinc-700 mb-2">Sửa nhanh</div>
                      <div className="grid grid-cols-2 gap-2">
                        <QuickButton onClick={() => applyNumber('hp', Math.round(draft.hp * 2))}>HP x2</QuickButton>
                        <QuickButton onClick={() => applyNumber('hp', Math.round(draft.hp * 5))}>HP x5</QuickButton>
                        <QuickButton onClick={() => applyNumber('percentDamage', Math.round(draft.percentDamage * 2))}>Damage x2</QuickButton>
                        <QuickButton onClick={() => applyNumber('percentTiemNang', Math.round(draft.percentTiemNang * 2))}>TNSM x2</QuickButton>
                        <QuickButton onClick={() => applyNumber('speed', Math.round(draft.speed * 1.5))}>Speed +50%</QuickButton>
                        <QuickButton onClick={() => applyNumber('rangeMove', Math.round(draft.rangeMove * 1.5))}>Range +50%</QuickButton>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <SectionCard
                      title="Thông tin template quái"
                      subtitle="Các chỉ số này áp dụng theo template. Spawn riêng từng map chỉnh trong panel Map."
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        <LabeledInput
                          label="Tên quái"
                          value={draft.name}
                          onChange={(value) => saveDraft({ ...draft, name: value })}
                        />
                        <LabeledNumberInput label="HP" value={draft.hp} onChange={(value) => applyNumber('hp', value)} />
                        <LabeledNumberInput label="Range move" value={draft.rangeMove} onChange={(value) => applyNumber('rangeMove', value)} />
                        <LabeledNumberInput label="Speed" value={draft.speed} onChange={(value) => applyNumber('speed', value)} />
                        <LabeledNumberInput label="Dart Type" value={draft.dartType} onChange={(value) => applyNumber('dartType', value)} />
                        <LabeledNumberInput label="% Damage" value={draft.percentDamage} onChange={(value) => applyNumber('percentDamage', value)} />
                        <LabeledNumberInput label="% Tiềm năng" value={draft.percentTiemNang} onChange={(value) => applyNumber('percentTiemNang', value)} />
                        <ReadOnlyField label="TYPE gốc" value={String(selectedMob.type)} />
                        <ReadOnlyField label="Tổng spawn" value={String(selectedMob.totalSpawnCount)} />
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Vật phẩm rơi"
                      subtitle={`Drop riêng cho mob #${selectedMob.id}. Mỗi item là một rule độc lập; một lần giết có thể trúng nhiều rule.`}
                    >
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
                        <strong>Mob Drop Editor:</strong> cấu hình bên dưới được lưu theo đúng JAR đang mở. Đây là dữ liệu drop riêng từng mob; writer runtime vào bytecode a/a/aa sẽ được nối ở bước tiếp theo, nên panel không đánh dấu giả là đã patch JAR.
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Boxes className="w-4 h-4 text-blue-600" />
                          <div>
                            <div className="text-[11px] font-semibold text-zinc-800">Danh sách item rơi</div>
                            <div className="text-[9px] text-zinc-500">{dropRules.length} rule · nhập Item ID, panel tự hiện tên từ Item database của JAR</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={addDropRule}
                          className="px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[10px] font-semibold text-blue-700 cursor-pointer flex items-center gap-1"
                        >
                          <PackagePlus className="w-3.5 h-3.5" />
                          Thêm vật phẩm rơi
                        </button>
                      </div>

                      {dropRules.length === 0 ? (
                        <div className="mt-3 rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-6 text-center text-[11px] text-blue-700">
                          Mob #{selectedMob.id} chưa có custom drop. Bấm <strong>Thêm vật phẩm rơi</strong> để tạo rule đầu tiên.
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {dropRules.map((rule) => (
                            <DropRuleEditor
                              key={rule.ruleId}
                              rule={rule}
                              item={itemLookup.get(String(rule.itemId))}
                              saved={savedRuleId === rule.ruleId}
                              onChange={(patch) => updateDropRule(rule.ruleId, patch)}
                              onSave={() => saveDropRule(rule)}
                              onDelete={() => removeDropRule(rule)}
                            />
                          ))}
                        </div>
                      )}
                    </SectionCard>

                    <SectionCard
                      title="Map xuất hiện"
                      subtitle="Danh sách map đang có mob này spawn. Spawn level/HP/vị trí vẫn chỉnh ở panel Map."
                    >
                      {selectedMob.maps.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-[11px] text-zinc-500">
                          Chưa thấy mob này trong dữ liệu spawn của các map đã parse.
                        </div>
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
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function DropRuleEditor({
  rule,
  item,
  saved,
  onChange,
  onSave,
  onDelete,
}: {
  rule: MobDropRule;
  item?: ItemLookupEntry;
  saved: boolean;
  onChange: (patch: Partial<MobDropRule>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`rounded-xl border p-3 ${rule.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-zinc-200 bg-zinc-50 opacity-80'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-zinc-900">
              {item?.name || `Item #${rule.itemId}`}
            </span>
            <span className="px-1.5 py-0.5 rounded-full border border-zinc-200 bg-white text-[9px] font-mono text-zinc-500">
              ID {rule.itemId}
            </span>
            <span className="px-1.5 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-[9px] font-mono text-blue-700">
              {rule.chancePercent}% · {rule.quantityMin === rule.quantityMax ? `x${rule.quantityMin}` : `x${rule.quantityMin}-${rule.quantityMax}`}
            </span>
          </div>
          <div className="text-[9px] text-zinc-500 mt-1 font-mono">ruleId: {rule.ruleId}</div>
        </div>

        <label className="flex items-center gap-1.5 text-[10px] text-zinc-600 cursor-pointer">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          Bật rule
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
        <LabeledNumberInput
          label="Item ID"
          value={rule.itemId}
          onChange={(value) => onChange({ itemId: Math.max(0, Math.round(value)) })}
        />
        <LabeledNumberInput
          label="Tỷ lệ %"
          value={rule.chancePercent}
          step="0.01"
          onChange={(value) => onChange({ chancePercent: clampNumber(value, 0, 100, 0) })}
        />
        <LabeledNumberInput
          label="SL min"
          value={rule.quantityMin}
          onChange={(value) =>
            onChange({
              quantityMin: Math.max(1, Math.round(value || 1)),
              quantityMax: Math.max(Math.max(1, Math.round(value || 1)), rule.quantityMax),
            })
          }
        />
        <LabeledNumberInput
          label="SL max"
          value={rule.quantityMax}
          onChange={(value) => onChange({ quantityMax: Math.max(rule.quantityMin, Math.round(value || rule.quantityMin)) })}
        />
      </div>

      <div className="mt-2 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-2">
        <LabeledInput
          label="Ghi chú"
          value={rule.note || ''}
          onChange={(value) => onChange({ note: value })}
          placeholder="Ghi chú cho rule này"
        />
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            onClick={onSave}
            className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[10px] font-semibold cursor-pointer flex items-center gap-1"
          >
            {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Đã lưu' : 'Lưu'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-40 text-red-700 text-[10px] font-semibold cursor-pointer flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Xóa
          </button>
        </div>
      </div>
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
        <span className="px-2 py-0.5 rounded-full bg-white border border-zinc-200 text-[10px] font-mono text-zinc-600">
          {usage.spawnCount} spawn
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {usage.spawns.slice(0, 8).map((spawn) => (
          <span
            key={`${usage.mapId}-${spawn.index}`}
            className="px-2 py-1 rounded-lg bg-white border border-zinc-200 text-[10px] font-mono text-zinc-600"
            title={`spawn #${spawn.index} · level ${spawn.level} · hp ${spawn.hp} · x ${spawn.x} · y ${spawn.y}`}
          >
            #{spawn.index} · lv {spawn.level} · ({spawn.x}, {spawn.y})
          </span>
        ))}
        {usage.spawns.length > 8 && (
          <span className="px-2 py-1 rounded-lg bg-white border border-zinc-200 text-[10px] font-mono text-zinc-500">
            +{usage.spawns.length - 8} spawn khác
          </span>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
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
    <label className="block">
      <div className="text-[10px] text-zinc-500 mb-1 font-mono">{label}</div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function LabeledNumberInput({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
}) {
  return (
    <label className="block">
      <div className="text-[10px] text-zinc-500 mb-1 font-mono">{label}</div>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 mb-1 font-mono">{label}</div>
      <div className="px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-100 text-[11px] text-zinc-700">
        {value}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-bold text-zinc-900">{value}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-600 text-[10px] font-mono">
      {children}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border text-[10px] font-medium whitespace-nowrap cursor-pointer ${
        active
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
  );
}

function QuickButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-[11px] font-medium text-zinc-700 cursor-pointer"
    >
      {children}
    </button>
  );
}

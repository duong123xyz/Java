import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Crown,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { NpcBodyPreview } from '../game-data/NpcBodyPreview';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import {
  analyzeBosses,
  BossAnalysisSnapshot,
  BossCustomDrop,
  BossDefinition,
  BossDraft,
  BossDropRule,
  createCustomBossDrop,
  getBossDraft,
  getBossDropRules,
  getDirtyBossCount,
  isBossDraftDirty,
  resetBossDraft,
  resolveBossItem,
  setBossDraft,
} from '../../services/bossDataService';
import {
  getQueuedNewBosses,
  queueNewBossOperation,
  removePatchWorkspaceOperation,
  WorkspaceNewBossOperation,
} from '../../services/patchWorkspaceStateService';

interface BossPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type BossFilter = 'all' | 'fixed' | 'dynamic' | 'with-drop';

function totalDirty(session: LoadedJarSession): number {
  return getDirtyBossCount(session) + getQueuedNewBosses(session).length;
}

export function BossPanel({ session, onDraftsUpdated }: BossPanelProps) {
  const [snapshot, setSnapshot] = useState<BossAnalysisSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BossFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedQueuedId, setSelectedQueuedId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'list' | 'detail'>('list');
  const [revision, setRevision] = useState(0);
  const [showCreator, setShowCreator] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeBosses(session);
      setSnapshot(result);
      if (selectedIndex === null && result.bosses.length > 0) setSelectedIndex(result.bosses[0].index);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  const onDraftsUpdatedRef = useRef(onDraftsUpdated);
  onDraftsUpdatedRef.current = onDraftsUpdated;

  useEffect(() => { void load(); }, [session]);
  useEffect(() => {
    void revision;
    onDraftsUpdatedRef.current?.(totalDirty(session));
  }, [session, revision]);

  const queued = useMemo(() => {
    void revision;
    return getQueuedNewBosses(session);
  }, [session, revision]);

  const filtered = useMemo(() => {
    if (!snapshot) return [];
    void revision;
    const q = query.trim().toLowerCase();
    return snapshot.bosses.filter((boss) => {
      const drops = getBossDropRules(boss, snapshot.itemAnalysis);
      if (filter === 'fixed' && boss.statMode !== 'fixed') return false;
      if (filter === 'dynamic' && boss.statMode === 'fixed') return false;
      if (filter === 'with-drop' && drops.length === 0) return false;
      if (!q) return true;
      return boss.name.toLowerCase().includes(q) || String(boss.index).includes(q) || String(boss.charId).includes(q) || String(boss.mapId).includes(q);
    });
  }, [snapshot, query, filter, revision]);

  const selectedBoss = snapshot && selectedIndex !== null
    ? snapshot.bosses.find((boss) => boss.index === selectedIndex) ?? null
    : null;
  const selectedQueued = queued.find((boss) => boss.id === selectedQueuedId) ?? null;

  if (loading) {
    return <div className="h-full flex items-center justify-center bg-zinc-900 border border-zinc-800 rounded-lg"><RefreshCw className="w-5 h-5 animate-spin text-rose-400" /></div>;
  }
  if (error || !snapshot) {
    return <div className="h-full flex items-center justify-center bg-red-950/20 border border-red-900/60 rounded-lg p-4 text-xs text-red-300"><AlertTriangle className="w-4 h-4 mr-2" />{error || 'Không đọc được boss'}</div>;
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <style>{`.Label{display:block;margin-bottom:4px;font-size:9px;text-transform:uppercase;color:#52525b;font-family:ui-monospace,monospace;font-weight:600}.Input{width:100%;border:1px solid #d4d4d8;background:#ffffff;border-radius:6px;padding:9px 10px;font-size:16px;color:#18181b;outline:none;color-scheme:light}.Input:focus{border-color:#f43f5e;box-shadow:0 0 0 2px rgba(244,63,94,.12)}.Input::placeholder{color:#a1a1aa}.Input:disabled,.Input[readonly]{background:#f4f4f5;color:#52525b;border-color:#e4e4e7;cursor:not-allowed}.Input option{background:#ffffff;color:#18181b}.CreatorLabel{display:block;margin-bottom:4px;font-size:9px;text-transform:uppercase;color:#52525b;font-family:ui-monospace,monospace;font-weight:600}.CreatorInput{width:100%;border:1px solid #d4d4d8;background:#fff;border-radius:6px;padding:9px 10px;font-size:16px;color:#18181b;outline:none;color-scheme:light}.CreatorInput::placeholder{color:#a1a1aa}.CreatorInput:focus{border-color:#f43f5e;box-shadow:0 0 0 2px rgba(244,63,94,.10)}.CreatorInput:disabled,.CreatorInput[readonly]{background:#f4f4f5;color:#52525b;border-color:#e4e4e7;cursor:not-allowed}.CreatorInput option{background:#fff;color:#18181b}@media(min-width:640px){.Input{padding:7px 9px;font-size:11px}.CreatorInput{padding:7px 9px;font-size:11px}}`}</style>
      <div className="shrink-0 min-h-11 px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-lg flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="w-4 h-4 text-rose-400" />
          <span className="text-sm font-bold text-zinc-100">Boss</span>
          <Chip>{snapshot.bosses.length} có sẵn</Chip>
          <Chip>{queued.length} boss mới</Chip>
          {totalDirty(session) > 0 && <span className="px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 text-[10px] font-mono">{totalDirty(session)} thay đổi</span>}
        </div>
        <button type="button" onClick={() => setShowCreator(true)} className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> Tạo boss mới
        </button>
      </div>

      {/* Segmented bar trên Mobile */}
      <div className="flex xl:hidden items-center gap-1 bg-zinc-950 border border-zinc-800 p-1 rounded-xl shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('list')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileTab === 'list'
              ? 'bg-rose-600 text-white font-bold shadow-xs'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Crown className="w-3.5 h-3.5" />
          <span>Danh sách ({filtered.length + queued.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('detail')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileTab === 'detail'
              ? 'bg-rose-600 text-white font-bold shadow-xs'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span className="truncate max-w-[150px]">
            {selectedQueued ? selectedQueued.name : selectedBoss ? selectedBoss.name : 'Chi tiết Boss'}
          </span>
        </button>
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[330px_minmax(0,1fr)] gap-2">
        <aside className={`min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden flex flex-col ${
          mobileTab === 'detail' ? 'hidden xl:flex' : 'flex'
        }`}>
          <div className="p-2 border-b border-zinc-800 bg-zinc-950/50 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên, map, char ID..." className="w-full bg-zinc-950 border border-zinc-700 rounded-md pl-8 pr-2 py-2 sm:py-1.5 text-[16px] sm:text-[11px] text-zinc-100 focus:outline-none focus:border-rose-500 font-mono" />
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {(['all','fixed','dynamic','with-drop'] as BossFilter[]).map((key) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={`px-2 py-1 rounded border text-[9px] font-mono cursor-pointer ${filter === key ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}>
                  {key === 'all' ? 'Tất cả' : key === 'fixed' ? 'Cố định' : key === 'dynamic' ? 'Runtime' : 'Có drop'}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {queued.length > 0 && <div className="px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-500 bg-emerald-950/10 border-b border-zinc-800">Boss mới trong Workspace</div>}
            {queued.map((boss) => (
              <button key={boss.id} type="button" onClick={() => { setSelectedQueuedId(boss.id); setSelectedIndex(null); setMobileTab('detail'); }} className={`w-full h-[58px] px-2.5 text-left border-b border-zinc-800/70 cursor-pointer ${selectedQueuedId === boss.id ? 'bg-emerald-500/10 border-l-2 border-l-emerald-400' : 'hover:bg-zinc-800/60'}`}>
                <div className="h-full flex items-center gap-2">
                  <Plus className="w-3 h-3 text-emerald-400" />
                  <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-zinc-100 truncate">{boss.name}</div><div className="text-[9px] text-zinc-500 font-mono">map {boss.mapId} · char {boss.charId}</div></div>
                  <ChevronRight className="w-3 h-3 text-zinc-600" />
                </div>
              </button>
            ))}

            {filtered.map((boss) => {
              const draft = getBossDraft(session, boss);
              const dirty = isBossDraftDirty(boss, draft);
              return (
                <button key={boss.index} type="button" onClick={() => { setSelectedIndex(boss.index); setSelectedQueuedId(null); setMobileTab('detail'); }} className={`w-full h-[58px] px-2.5 text-left border-b border-zinc-800/70 cursor-pointer ${selectedIndex === boss.index ? 'bg-rose-500/10 border-l-2 border-l-rose-400' : 'hover:bg-zinc-800/60'}`}>
                  <div className="h-full flex items-center gap-2"><span className="w-7 text-[9px] text-rose-400 font-mono">#{boss.index}</span><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-zinc-100 truncate">{draft.name}{dirty ? ' •' : ''}</div><div className="text-[9px] text-zinc-500 font-mono">map {boss.mapId} · char {boss.charId}</div></div><ChevronRight className="w-3 h-3 text-zinc-600" /></div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className={`min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden flex flex-col ${
          mobileTab === 'list' ? 'hidden xl:flex' : 'flex'
        }`}>
          {/* Header quay lại trên mobile */}
          <div className="xl:hidden px-3 py-2 bg-zinc-850 border-b border-zinc-800 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMobileTab('list')}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              <span>← Trở lại danh sách</span>
            </button>
            <span className="text-xs font-mono text-zinc-400 truncate max-w-[140px]">
              {selectedQueued?.name || selectedBoss?.name}
            </span>
          </div>
          {selectedQueued ? (
            <QueuedBossDetail session={session} boss={selectedQueued} onDelete={() => { removePatchWorkspaceOperation(session, selectedQueued.id); setSelectedQueuedId(null); setRevision((v) => v + 1); }} />
          ) : selectedBoss ? (
            <ExistingBossDetail session={session} snapshot={snapshot} boss={selectedBoss} onChanged={() => setRevision((v) => v + 1)} />
          ) : <div className="h-full flex items-center justify-center text-xs text-zinc-500">Chọn một boss.</div>}
        </section>
      </div>

      {showCreator && <BossCreatorModal session={session} snapshot={snapshot} onClose={() => setShowCreator(false)} onCreated={(op) => { setShowCreator(false); setSelectedQueuedId(op.id); setSelectedIndex(null); setRevision((v) => v + 1); }} />}
    </div>
  );
}

const inputClasses = "w-full h-10 sm:h-8.5 px-3 rounded-lg border border-zinc-700 bg-zinc-950 text-[16px] sm:text-xs text-zinc-100 font-mono focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 shadow-2xs transition-colors";
const labelClasses = "block text-[11px] font-semibold text-zinc-300 font-mono mb-1";
const modalInputClasses = "w-full h-10 sm:h-8.5 px-3 rounded-lg border border-zinc-300 bg-white text-[16px] sm:text-xs text-zinc-900 font-mono focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 shadow-2xs transition-colors";
const modalLabelClasses = "block text-[11px] font-semibold text-zinc-700 font-mono mb-1";

function BossCreatorModal({ session, snapshot, onClose, onCreated }: { session: LoadedJarSession; snapshot: BossAnalysisSnapshot; onClose: () => void; onCreated: (boss: WorkspaceNewBossOperation) => void }) {
  const [cloneIndex, setCloneIndex] = useState(snapshot.bosses[0]?.index ?? 0);
  const source = snapshot.bosses.find((boss) => boss.index === cloneIndex) ?? snapshot.bosses[0];
  const usedIds = useMemo(() => new Set([...snapshot.bosses.map((b) => b.charId), ...getQueuedNewBosses(session).map((b) => b.charId)]), [snapshot, session]);
  const allocateId = () => {
    let value = Math.min(-1, ...Array.from(usedIds).filter((id) => id < 0)) - 1;
    while (usedIds.has(value)) value--;
    return value;
  };
  const [charId, setCharId] = useState(allocateId());
  const [name, setName] = useState(`${source?.name || 'Boss'} mới`);
  const [mapId, setMapId] = useState(source?.mapId ?? 0);
  const [head, setHead] = useState(source?.head ?? 0);
  const [body, setBody] = useState(source?.body ?? 0);
  const [leg, setLeg] = useState(source?.leg ?? 0);
  const [hp, setHp] = useState(source?.hp || 1000000);
  const [damage, setDamage] = useState(source?.damage || 10000);
  const [spawnX, setSpawnX] = useState(source?.spawnX || 700);
  const [error, setError] = useState<string | null>(null);

  const applyClone = (index: number) => {
    setCloneIndex(index);
    const boss = snapshot.bosses.find((item) => item.index === index);
    if (!boss) return;
    setName(`${boss.name} mới`); setMapId(boss.mapId); setHead(boss.head); setBody(boss.body); setLeg(boss.leg); setHp(Math.max(1, boss.hp)); setDamage(Math.max(1, boss.damage)); setSpawnX(boss.spawnX);
  };
  const duplicated = usedIds.has(charId);

  const create = () => {
    try {
      setError(null);
      if (duplicated) throw new Error(`Char ID ${charId} đang bị trùng.`);
      const op = queueNewBossOperation(session, { cloneBossIndex: cloneIndex, charId, mapId, name, head, body, leg, hp, damage, spawnX });
      onCreated(op);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-4xl max-h-[94vh] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl flex flex-col">
        <div className="h-12 px-4 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-rose-500" />
            <strong className="text-sm text-zinc-900">Tạo boss thật</strong>
            <span className="text-[9px] text-emerald-600 font-mono">ghi vào a/a/d.class</span>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 sm:p-4 overflow-y-auto space-y-4 bg-zinc-50/60">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-800 leading-relaxed">
            Boss mới được thêm vào boss manager thật, không phải chỉ hiện trên panel. Writer tự hook map gate để char ID mới có thể spawn ở map đã chọn.
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-4">
            <div className="space-y-3">
              <NpcBodyPreview session={session} head={head} body={body} leg={leg} alt={name} title="Preview boss mới" compact />
              <div>
                <label className={modalLabelClasses}>Clone boss nền</label>
                <select value={cloneIndex} onChange={(e) => applyClone(Number(e.target.value))} className={modalInputClasses}>
                  {snapshot.bosses.map((boss) => <option key={boss.index} value={boss.index}>#{boss.index} · {boss.name}</option>)}
                </select>
              </div>
              <div className="text-[10px] text-zinc-500">Clone chỉ dùng để lấy nhanh ngoại hình / HP / damage / map. Boss mới vẫn có char ID riêng.</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
              <div>
                <label className={modalLabelClasses}>Tên boss</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={modalInputClasses} placeholder="VD: Broly Siêu Cấp" />
              </div>
              <div>
                <label className={modalLabelClasses}>Char ID mới (số âm)</label>
                <div className="flex gap-1.5">
                  <input type="number" value={charId} onChange={(e) => setCharId(Math.round(Number(e.target.value)))} className={`${modalInputClasses} ${duplicated ? '!border-red-500 !ring-red-200' : ''}`} />
                  <button type="button" onClick={() => setCharId(allocateId())} className="px-3 rounded-lg bg-zinc-100 border border-zinc-300 text-xs font-semibold text-zinc-700 whitespace-nowrap hover:bg-zinc-200 cursor-pointer">Tự cấp</button>
                </div>
                <div className={`mt-1 text-[10px] font-mono ${duplicated ? 'text-red-500 font-bold' : 'text-emerald-600'}`}>{duplicated ? 'ID đang bị trùng!' : 'ID hợp lệ'}</div>
              </div>
              <CreatorNum label="Map ID" value={mapId} onChange={setMapId} min={0} />
              <CreatorNum label="Spawn X" value={spawnX} onChange={setSpawnX} min={0} />
              <CreatorNum label="HP" value={hp} onChange={setHp} min={1} />
              <CreatorNum label="Sát thương" value={damage} onChange={setDamage} min={1} />
              <CreatorNum label="Head" value={head} onChange={setHead} min={0} />
              <CreatorNum label="Body" value={body} onChange={setBody} min={0} />
              <CreatorNum label="Leg" value={leg} onChange={setLeg} min={0} />
            </div>
          </div>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-600 font-mono">{error}</div>}
        </div>
        <div className="p-3 border-t border-zinc-200 bg-white flex justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer">Hủy</button>
          <button type="button" onClick={create} disabled={duplicated || !name.trim()} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs">
            <Plus className="w-3.5 h-3.5" />Thêm vào Workspace
          </button>
        </div>
      </div>
    </div>
  );
}

function QueuedBossDetail({ session, boss, onDelete }: { session: LoadedJarSession; boss: WorkspaceNewBossOperation; onDelete: () => void }) {
  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[10px] uppercase text-emerald-400 font-mono font-bold">Boss mới · chờ build</div>
          <h3 className="text-lg font-bold text-zinc-100">{boss.name}</h3>
          <div className="text-[11px] text-zinc-400 font-mono">char {boss.charId} · map {boss.mapId} · clone nền #{boss.cloneBossIndex}</div>
        </div>
        <button onClick={onDelete} className="h-9 px-3 rounded-lg border border-red-800/80 bg-red-950/40 hover:bg-red-900/60 text-red-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
          <Trash2 className="w-3.5 h-3.5" />Xóa boss này
        </button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-4">
        <NpcBodyPreview session={session} head={boss.head} body={boss.body} leg={boss.leg} alt={boss.name} title="Boss mới" compact />
        <div className="grid grid-cols-2 gap-2">
          <Box label="HP" value={boss.hp.toLocaleString('vi-VN')} />
          <Box label="Damage" value={boss.damage.toLocaleString('vi-VN')} />
          <Box label="Map" value={boss.mapId} />
          <Box label="Spawn X" value={boss.spawnX} />
          <Box label="Head / Body / Leg" value={`${boss.head} / ${boss.body} / ${boss.leg}`} />
          <Box label="Char ID" value={boss.charId} />
        </div>
      </div>
      <div className="rounded-xl border border-violet-900/40 bg-violet-950/20 p-3 text-xs text-zinc-300 leading-relaxed">
        Bấm <strong className="text-violet-300">Test Workspace</strong> để writer thêm definition boss vào <code className="text-violet-200">a/a/d.class</code> và hook map gate. Sau khi VALIDATED mới xuất JAR.
      </div>
    </div>
  );
}

function ExistingBossDetail({ session, snapshot, boss, onChanged }: { session: LoadedJarSession; snapshot: BossAnalysisSnapshot; boss: BossDefinition; onChanged: () => void }) {
  const [draft, setDraft] = useState<BossDraft>(() => getBossDraft(session, boss));
  useEffect(() => setDraft(getBossDraft(session, boss)), [session, boss.index]);
  const save = (next: BossDraft) => { setBossDraft(session, boss, next); setDraft(getBossDraft(session, boss)); onChanged(); };
  const patch = (value: Partial<BossDraft>) => save({ ...draft, ...value });
  const rules = getBossDropRules(boss, snapshot.itemAnalysis);

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-zinc-800">
        <div>
          <div className="text-[10px] text-rose-400 font-mono font-bold">Boss có sẵn #{boss.index}</div>
          <div className="text-base sm:text-lg font-bold text-zinc-100">{draft.name}</div>
        </div>
        <button
          disabled={!isBossDraftDirty(boss, draft)}
          onClick={() => { setDraft(resetBossDraft(session, boss)); onChanged(); }}
          className="h-9 px-3 rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-xs font-semibold text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />Hoàn tác
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[250px_1fr] gap-4">
        <NpcBodyPreview session={session} head={draft.head} body={draft.body} leg={draft.leg} alt={draft.name} title="Boss" compact />
        <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2.5">
          <Text label="Tên boss" value={draft.name} onChange={(v) => patch({ name: v })} />
          <Num label="Spawn X" value={draft.spawnX} onChange={(v) => patch({ spawnX: v })} min={0} step={10} />
          <NullableNum label="HP" value={draft.hpOverride} placeholder={String(boss.hp)} onChange={(v) => patch({ hpOverride: v })} step={10000} />
          <NullableNum label="Damage" value={draft.damageOverride} placeholder={String(boss.damage)} onChange={(v) => patch({ damageOverride: v })} step={1000} />
          <Num label="Head" value={draft.head} onChange={(v) => patch({ head: v })} min={0} />
          <Num label="Body" value={draft.body} onChange={(v) => patch({ body: v })} min={0} />
          <Num label="Leg" value={draft.leg} onChange={(v) => patch({ leg: v })} min={0} />
        </div>
      </div>

      <DropEditor session={session} snapshot={snapshot} draft={draft} rules={rules} onSave={save} />
    </div>
  );
}

function DropEditor({ session, snapshot, draft, rules, onSave }: { session: LoadedJarSession; snapshot: BossAnalysisSnapshot; draft: BossDraft; rules: BossDropRule[]; onSave: (draft: BossDraft) => void }) {
  const add = () => onSave({ ...draft, customDrops: [...draft.customDrops, createCustomBossDrop()] });
  const update = (id: string, patch: Partial<BossCustomDrop>) => onSave({ ...draft, customDrops: draft.customDrops.map((d) => d.id === id ? { ...d, ...patch } : d) });

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60">
        <div>
          <strong className="text-xs font-bold text-zinc-100">Drop của boss</strong>
          <span className="text-[10px] text-zinc-400 font-mono ml-2">({rules.length} mặc định, {draft.customDrops.length} custom)</span>
        </div>
        <button
          type="button"
          onClick={add}
          className="h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" /><span>Thêm drop</span>
        </button>
      </div>

      <div className="p-3 space-y-2.5">
        {rules.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono text-zinc-500 uppercase">Drop có sẵn từ bytecode</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {rules.map((r) => (
                <div key={r.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-xs text-zinc-400 flex items-center justify-between">
                  <span className="text-zinc-200 font-medium truncate">{r.title}</span>
                  <span className="font-mono text-amber-400 shrink-0 ml-2">{r.chancePercent}% · x{r.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {draft.customDrops.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-[10px] font-mono text-zinc-500 uppercase">Custom drop thêm mới ({draft.customDrops.length})</div>
            {draft.customDrops.map((drop) => {
              const item = resolveBossItem(snapshot.itemAnalysis, Number(drop.itemId) || 0);
              return (
                <div key={drop.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <SmallImagePreview session={session} imageId={item.iconId} alt={item.name} variant="icon" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-200 truncate">{item.name || `Item #${drop.itemId}`}</div>
                        <div className="text-[10px] text-zinc-500 font-mono">Icon ID: {item.iconId || '?'}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSave({ ...draft, customDrops: draft.customDrops.filter((d) => d.id !== drop.id) })}
                      className="h-8 px-2.5 rounded-lg border border-red-900/60 bg-red-950/30 hover:bg-red-900/50 text-red-400 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                      title="Xóa custom drop này"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="sm:inline">Xóa</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className={labelClasses}>Item ID</label>
                      <input
                        type="number"
                        value={drop.itemId}
                        onChange={(e) => update(drop.id, { itemId: e.target.value })}
                        className={inputClasses}
                        placeholder="VD: 190"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Tỷ lệ (%)</label>
                      <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => update(drop.id, { chancePercent: Math.max(0, drop.chancePercent - 5) })}
                          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold cursor-pointer shrink-0"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={drop.chancePercent}
                          min={0}
                          max={100}
                          onChange={(e) => update(drop.id, { chancePercent: Number(e.target.value) })}
                          className="w-full h-10 sm:h-8.5 px-2 bg-transparent text-center text-[16px] sm:text-xs text-zinc-100 font-mono focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => update(drop.id, { chancePercent: Math.min(100, drop.chancePercent + 5) })}
                          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold cursor-pointer shrink-0"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className={labelClasses}>Số lượng</label>
                      <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => update(drop.id, { quantity: Math.max(1, drop.quantity - 1) })}
                          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold cursor-pointer shrink-0"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={drop.quantity}
                          min={1}
                          onChange={(e) => update(drop.id, { quantity: Number(e.target.value) })}
                          className="w-full h-10 sm:h-8.5 px-2 bg-transparent text-center text-[16px] sm:text-xs text-zinc-100 font-mono focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => update(drop.id, { quantity: drop.quantity + 1 })}
                          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold cursor-pointer shrink-0"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) { return <span className="hidden lg:inline px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[9px] text-zinc-500 font-mono">{children}</span>; }
function Box({ label, value }: { label:string; value:string|number }) { return <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800"><div className="text-[9px] uppercase text-zinc-500 font-semibold">{label}</div><div className="text-xs text-zinc-200 font-mono font-bold mt-0.5">{value}</div></div>; }

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={labelClasses}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClasses} />
    </div>
  );
}

function Num({ label, value, onChange, min, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  const adjust = (delta: number) => {
    const next = (value || 0) + delta;
    onChange(min !== undefined ? Math.max(min, next) : next);
  };

  return (
    <div>
      <label className={labelClasses}>{label}</label>
      <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20">
        <button
          type="button"
          onClick={() => adjust(-step)}
          disabled={min !== undefined && value <= min}
          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0 border-r border-zinc-800 select-none"
        >
          -
        </button>
        <input
          type="number"
          min={min}
          value={value}
          onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))}
          className="w-full h-10 sm:h-8.5 px-2 bg-transparent text-center text-[16px] sm:text-xs text-zinc-100 font-mono font-semibold focus:outline-none"
        />
        <button
          type="button"
          onClick={() => adjust(step)}
          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 font-bold cursor-pointer shrink-0 border-l border-zinc-800 select-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

function CreatorNum({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div>
      <label className={modalLabelClasses}>{label}</label>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))}
        className={modalInputClasses}
      />
    </div>
  );
}

function NullableNum({ label, value, placeholder, onChange, step = 1000 }: { label: string; value: number | null; placeholder: string; onChange: (v: number | null) => void; step?: number }) {
  const currentVal = (value ?? Number(placeholder)) || 0;
  const adjust = (delta: number) => {
    const next = Math.max(1, currentVal + delta);
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-semibold text-zinc-300 font-mono">{label}</label>
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono cursor-pointer"
            title="Dùng lại giá trị gốc"
          >
            Dùng gốc ({placeholder})
          </button>
        )}
      </div>
      <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20">
        <button
          type="button"
          onClick={() => adjust(-step)}
          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 font-bold cursor-pointer shrink-0 border-r border-zinc-800 select-none"
        >
          -
        </button>
        <input
          type="number"
          min={1}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value) || 1)))}
          className="w-full h-10 sm:h-8.5 px-2 bg-transparent text-center text-[16px] sm:text-xs text-zinc-100 placeholder-zinc-500 font-mono font-semibold focus:outline-none"
        />
        <button
          type="button"
          onClick={() => adjust(step)}
          className="h-10 sm:h-8.5 px-3 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 font-bold cursor-pointer shrink-0 border-l border-zinc-800 select-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

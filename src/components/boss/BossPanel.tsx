import React, { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => { void load(); }, [session]);
  useEffect(() => {
    void revision;
    onDraftsUpdated?.(totalDirty(session));
  }, [session, revision, onDraftsUpdated]);

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
      <style>{`.Label{display:block;margin-bottom:4px;font-size:9px;text-transform:uppercase;color:#71717a;font-family:ui-monospace,monospace}.Input{width:100%;border:1px solid #3f3f46;background:#09090b;border-radius:6px;padding:7px 9px;font-size:11px;color:#f4f4f5;outline:none}.Input:focus{border-color:#f43f5e}`}</style>
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

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[330px_minmax(0,1fr)] gap-2">
        <aside className="min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
          <div className="p-2 border-b border-zinc-800 bg-zinc-950/50 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên, map, char ID..." className="w-full bg-zinc-950 border border-zinc-700 rounded-md pl-8 pr-2 py-1.5 text-[11px] text-zinc-100 focus:outline-none focus:border-rose-500" />
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
              <button key={boss.id} type="button" onClick={() => { setSelectedQueuedId(boss.id); setSelectedIndex(null); }} className={`w-full h-[58px] px-2.5 text-left border-b border-zinc-800/70 cursor-pointer ${selectedQueuedId === boss.id ? 'bg-emerald-500/10 border-l-2 border-l-emerald-400' : 'hover:bg-zinc-800/60'}`}>
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
                <button key={boss.index} type="button" onClick={() => { setSelectedIndex(boss.index); setSelectedQueuedId(null); }} className={`w-full h-[58px] px-2.5 text-left border-b border-zinc-800/70 cursor-pointer ${selectedIndex === boss.index ? 'bg-rose-500/10 border-l-2 border-l-rose-400' : 'hover:bg-zinc-800/60'}`}>
                  <div className="h-full flex items-center gap-2"><span className="w-7 text-[9px] text-rose-400 font-mono">#{boss.index}</span><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-zinc-100 truncate">{draft.name}{dirty ? ' •' : ''}</div><div className="text-[9px] text-zinc-500 font-mono">map {boss.mapId} · char {boss.charId}</div></div><ChevronRight className="w-3 h-3 text-zinc-600" /></div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden">
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col">
        <div className="h-12 px-4 border-b border-zinc-800 flex items-center justify-between"><div className="flex items-center gap-2"><Crown className="w-4 h-4 text-rose-400" /><strong className="text-sm text-zinc-100">Tạo boss thật</strong><span className="text-[9px] text-emerald-400 font-mono">ghi vào a/a/d.class</span></div><button onClick={onClose} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button></div>
        <div className="p-4 overflow-y-auto space-y-4">
          <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-3 text-[10px] text-emerald-300 leading-relaxed">Boss mới được thêm vào boss manager thật, không phải chỉ hiện trên panel. Writer tự hook map gate để char ID mới có thể spawn ở map đã chọn.</div>
          <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-4">
            <div className="space-y-3">
              <NpcBodyPreview session={session} head={head} body={body} leg={leg} alt={name} title="Preview boss mới" compact />
              <label className="block"><span className="Label">Clone boss nền</span><select value={cloneIndex} onChange={(e) => applyClone(Number(e.target.value))} className="Input">{snapshot.bosses.map((boss) => <option key={boss.index} value={boss.index}>#{boss.index} · {boss.name}</option>)}</select></label>
              <div className="text-[9px] text-zinc-500">Clone chỉ dùng để lấy nhanh ngoại hình / HP / damage / map. Boss mới vẫn có char ID riêng.</div>
            </div>
            <div className="grid grid-cols-2 gap-3 content-start">
              <label><span className="Label">Tên boss</span><input value={name} onChange={(e) => setName(e.target.value)} className="Input" /></label>
              <label><span className="Label">Char ID mới</span><div className="flex gap-1"><input type="number" value={charId} onChange={(e) => setCharId(Math.round(Number(e.target.value)))} className={`Input ${duplicated ? '!border-red-500' : ''}`} /><button type="button" onClick={() => setCharId(allocateId())} className="px-2 rounded bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-300 whitespace-nowrap">Tự cấp</button></div><div className={`mt-1 text-[9px] ${duplicated ? 'text-red-400' : 'text-emerald-400'}`}>{duplicated ? 'ID đang bị trùng' : 'ID đang trống'}</div></label>
              <Num label="Map ID" value={mapId} onChange={setMapId} min={0} />
              <Num label="Spawn X" value={spawnX} onChange={setSpawnX} min={0} />
              <Num label="HP" value={hp} onChange={setHp} min={1} />
              <Num label="Sát thương" value={damage} onChange={setDamage} min={1} />
              <Num label="Head" value={head} onChange={setHead} min={0} />
              <Num label="Body" value={body} onChange={setBody} min={0} />
              <Num label="Leg" value={leg} onChange={setLeg} min={0} />
            </div>
          </div>
          {error && <div className="rounded-lg border border-red-800 bg-red-950/20 p-2 text-[10px] text-red-300">{error}</div>}
        </div>
        <div className="p-3 border-t border-zinc-800 flex justify-end gap-2"><button onClick={onClose} className="px-3 py-1.5 rounded border border-zinc-700 text-[10px] text-zinc-300">Hủy</button><button onClick={create} disabled={duplicated || !name.trim()} className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-[10px] font-bold flex items-center gap-1.5"><Plus className="w-3 h-3" />Thêm vào Workspace</button></div>
      </div>
    </div>
  );
}

function QueuedBossDetail({ session, boss, onDelete }: { session: LoadedJarSession; boss: WorkspaceNewBossOperation; onDelete: () => void }) {
  return <div className="h-full overflow-y-auto p-4 space-y-4"><div className="flex items-center justify-between"><div><div className="text-[9px] uppercase text-emerald-400 font-mono">Boss mới · chờ build</div><h3 className="text-lg font-bold text-zinc-100">{boss.name}</h3><div className="text-[10px] text-zinc-500 font-mono">char {boss.charId} · map {boss.mapId} · clone nền #{boss.cloneBossIndex}</div></div><button onClick={onDelete} className="px-3 py-1.5 rounded border border-red-800 bg-red-950/20 text-red-400 text-[10px] flex items-center gap-1"><Trash2 className="w-3 h-3" />Xóa</button></div><div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-4"><NpcBodyPreview session={session} head={boss.head} body={boss.body} leg={boss.leg} alt={boss.name} title="Boss mới" compact /><div className="grid grid-cols-2 gap-2"><Box label="HP" value={boss.hp.toLocaleString('vi-VN')} /><Box label="Damage" value={boss.damage.toLocaleString('vi-VN')} /><Box label="Map" value={boss.mapId} /><Box label="Spawn X" value={boss.spawnX} /><Box label="Head / Body / Leg" value={`${boss.head} / ${boss.body} / ${boss.leg}`} /><Box label="Char ID" value={boss.charId} /></div></div><div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-3 text-[10px] text-zinc-400">Bấm <strong className="text-violet-300">Test Workspace</strong> để writer thêm definition boss vào <code>a/a/d.class</code> và hook map gate. Sau khi VALIDATED mới xuất JAR.</div></div>;
}

function ExistingBossDetail({ session, snapshot, boss, onChanged }: { session: LoadedJarSession; snapshot: BossAnalysisSnapshot; boss: BossDefinition; onChanged: () => void }) {
  const [draft, setDraft] = useState<BossDraft>(() => getBossDraft(session, boss));
  useEffect(() => setDraft(getBossDraft(session, boss)), [session, boss.index]);
  const save = (next: BossDraft) => { setBossDraft(session, boss, next); setDraft(getBossDraft(session, boss)); onChanged(); };
  const patch = (value: Partial<BossDraft>) => save({ ...draft, ...value });
  const rules = getBossDropRules(boss, snapshot.itemAnalysis);
  return <div className="h-full overflow-y-auto p-3 space-y-3"><div className="flex items-center justify-between"><div><div className="text-[9px] text-rose-400 font-mono">Boss có sẵn #{boss.index}</div><div className="text-sm font-bold text-zinc-100">{draft.name}</div></div><button disabled={!isBossDraftDirty(boss,draft)} onClick={() => { setDraft(resetBossDraft(session,boss)); onChanged(); }} className="px-2.5 py-1 rounded border border-zinc-700 text-[10px] text-zinc-400 disabled:opacity-30 flex items-center gap-1"><RotateCcw className="w-3 h-3" />Hoàn tác</button></div><div className="grid grid-cols-1 xl:grid-cols-[250px_1fr] gap-3"><NpcBodyPreview session={session} head={draft.head} body={draft.body} leg={draft.leg} alt={draft.name} title="Boss" compact /><div className="grid grid-cols-2 2xl:grid-cols-4 gap-2"><Text label="Tên" value={draft.name} onChange={(v)=>patch({name:v})}/><Num label="Spawn X" value={draft.spawnX} onChange={(v)=>patch({spawnX:v})} min={0}/><NullableNum label="HP" value={draft.hpOverride} placeholder={String(boss.hp)} onChange={(v)=>patch({hpOverride:v})}/><NullableNum label="Damage" value={draft.damageOverride} placeholder={String(boss.damage)} onChange={(v)=>patch({damageOverride:v})}/><Num label="Head" value={draft.head} onChange={(v)=>patch({head:v})} min={0}/><Num label="Body" value={draft.body} onChange={(v)=>patch({body:v})} min={0}/><Num label="Leg" value={draft.leg} onChange={(v)=>patch({leg:v})} min={0}/></div></div><DropEditor session={session} snapshot={snapshot} draft={draft} rules={rules} onSave={save}/></div>;
}

function DropEditor({ session, snapshot, draft, rules, onSave }: { session: LoadedJarSession; snapshot: BossAnalysisSnapshot; draft: BossDraft; rules: BossDropRule[]; onSave: (draft: BossDraft)=>void }) {
  const add = () => onSave({ ...draft, customDrops: [...draft.customDrops, createCustomBossDrop()] });
  const update = (id:string, patch:Partial<BossCustomDrop>) => onSave({ ...draft, customDrops: draft.customDrops.map((d)=>d.id===id?{...d,...patch}:d) });
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden"><div className="h-10 px-3 flex items-center justify-between border-b border-zinc-800"><strong className="text-xs text-zinc-100">Drop boss</strong><button onClick={add} className="px-2 py-1 rounded border border-amber-700 text-[9px] text-amber-300 flex items-center gap-1"><Plus className="w-3 h-3" />Thêm drop</button></div><div className="p-2 space-y-2">{rules.map((r)=><div key={r.key} className="rounded border border-zinc-800 p-2 text-[10px] text-zinc-400"><span className="text-zinc-200">{r.title}</span> · {r.chancePercent}% · SL {r.quantity}</div>)}{draft.customDrops.map((drop)=>{const item=resolveBossItem(snapshot.itemAnalysis,Number(drop.itemId)||0);return <div key={drop.id} className="grid grid-cols-[38px_1fr_90px_80px_30px] gap-1 items-center"><SmallImagePreview session={session} imageId={item.iconId} alt={item.name} variant="icon"/><input type="number" value={drop.itemId} onChange={(e)=>update(drop.id,{itemId:e.target.value})} className="Input" placeholder="Item ID"/><input type="number" value={drop.chancePercent} min={0} max={100} onChange={(e)=>update(drop.id,{chancePercent:Number(e.target.value)})} className="Input"/><input type="number" value={drop.quantity} min={1} onChange={(e)=>update(drop.id,{quantity:Number(e.target.value)})} className="Input"/><button onClick={()=>onSave({...draft,customDrops:draft.customDrops.filter((d)=>d.id!==drop.id)})} className="text-red-400"><Trash2 className="w-3.5 h-3.5"/></button></div>})}</div></div>;
}

function Chip({ children }: { children: React.ReactNode }) { return <span className="hidden lg:inline px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[9px] text-zinc-500 font-mono">{children}</span>; }
function Box({ label, value }: { label:string; value:string|number }) { return <div className="p-2 rounded bg-zinc-950 border border-zinc-800"><div className="text-[8px] uppercase text-zinc-600">{label}</div><div className="text-[11px] text-zinc-200 font-mono">{value}</div></div>; }
function Text({ label,value,onChange }:{label:string;value:string;onChange:(v:string)=>void}) { return <label><span className="Label">{label}</span><input value={value} onChange={(e)=>onChange(e.target.value)} className="Input"/></label>; }
function Num({ label,value,onChange,min }:{label:string;value:number;onChange:(v:number)=>void;min?:number}) { return <label><span className="Label">{label}</span><input type="number" min={min} value={value} onChange={(e)=>onChange(Math.round(Number(e.target.value)||0))} className="Input"/></label>; }
function NullableNum({label,value,placeholder,onChange}:{label:string;value:number|null;placeholder:string;onChange:(v:number|null)=>void}) { return <label><span className="Label">{label}</span><input type="number" min={1} value={value ?? ''} placeholder={placeholder} onChange={(e)=>onChange(e.target.value===''?null:Math.max(1,Math.round(Number(e.target.value)||1)))} className="Input"/></label>; }

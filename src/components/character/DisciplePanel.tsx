import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Backpack,
  CheckCircle2,
  Database,
  Gauge,
  HeartPulse,
  Package,
  RefreshCw,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  UserRound,
  Zap,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeDiscipleSchema,
  DiscipleDraft,
  DiscipleFieldGroup,
  DiscipleSchemaSnapshot,
  getDirtyDiscipleCount,
  getDiscipleDraft,
  resetDiscipleDraft,
  setDiscipleDraft,
} from '../../services/discipleDataService';

interface DisciplePanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type DiscipleView = 'stats' | 'skills' | 'schema';

const GROUP_LABELS: Record<DiscipleFieldGroup, string> = {
  identity: 'Danh tính & trạng thái',
  progress: 'Sức mạnh & tiến trình',
  combat: 'Chỉ số chiến đấu',
  runtime: 'Chỉ số hiện tại',
  skills: 'Kỹ năng',
  inventory: 'Trang bị & hành trang',
};

const PLANET_LABELS = ['Trái Đất', 'Namek', 'Xayda'];

export function DisciplePanel({ session, onDraftsUpdated }: DisciplePanelProps) {
  const [snapshot, setSnapshot] = useState<DiscipleSchemaSnapshot | null>(null);
  const [draft, setDraftState] = useState<DiscipleDraft | null>(null);
  const [view, setView] = useState<DiscipleView>('stats');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void analyzeDiscipleSchema(session)
      .then((result) => {
        if (!active) return;
        setSnapshot(result);
        setDraftState(getDiscipleDraft(session, result));
        onDraftsUpdated?.(getDirtyDiscipleCount(session));
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, onDraftsUpdated]);

  const grouped = useMemo(() => {
    const result = new Map<DiscipleFieldGroup, DiscipleSchemaSnapshot['fields']>();
    if (!snapshot) return result;
    for (const field of snapshot.fields) {
      const list = result.get(field.group) ?? [];
      list.push(field);
      result.set(field.group, list);
    }
    return result;
  }, [snapshot]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2 text-zinc-500 text-xs font-mono">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-cyan-500" />
          <div>Đang đọc schema + writer Đệ tử...</div>
        </div>
      </div>
    );
  }

  if (error || !snapshot || !draft) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        <AlertTriangle className="w-4 h-4 mr-2" />
        {error || 'Không đọc được schema Đệ tử.'}
      </div>
    );
  }

  const dirty = getDirtyDiscipleCount(session) > 0;
  const baseline = snapshot.resetDefaults;

  const save = (next: DiscipleDraft) => {
    const normalized = setDiscipleDraft(session, next);
    setDraftState(normalized);
    onDraftsUpdated?.(getDirtyDiscipleCount(session));
  };

  const patch = (value: Partial<DiscipleDraft>) => save({ ...draft, ...value });

  const patchSkill = (index: number, value: Partial<DiscipleDraft['skills'][number]>) => {
    const skills = draft.skills.map((skill, skillIndex) =>
      skillIndex === index ? { ...skill, ...value } : skill
    );
    patch({ skills });
  };

  const reset = () => {
    setDraftState(resetDiscipleDraft(session, snapshot));
    onDraftsUpdated?.(0);
  };

  const syncCurrent = () => patch({ hp: draft.baseHp, ki: draft.baseKi });
  const fullStamina = () => patch({ stamina: draft.maxStamina });
  const clearSkills = () => patch({
    skills: Array.from({ length: snapshot.skillSlots }, () => ({ id: -1, level: 0 })),
  });

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 sm:gap-3">
      <div className="shrink-0 rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-cyan-100 to-indigo-100 border border-cyan-200 flex items-center justify-center shrink-0">
            <UserRound className="w-5 h-5 text-cyan-600" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-bold text-zinc-900">Đệ tử</div>
              {dirty && (
                <span className="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[9px] font-mono">
                  đang sửa
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
              Chỉnh default/reset thật trong <code>a/a/H.gf()</code>. Save codec <code>a/a/N</code> giữ nguyên.
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap">
              <Chip text="writer READY" />
              <Chip text={`${snapshot.skillSlots} skill`} />
              <Chip text={`${snapshot.equipmentSlots} trang bị`} />
              <Chip text={`${snapshot.bagSlots} hành trang`} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <div
            className={`flex items-center gap-1.5 text-[10px] font-mono ${snapshot.verified ? 'text-emerald-600' : 'text-amber-600'}`}
            title={snapshot.verificationDetail}
          >
            {snapshot.verified ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {snapshot.verified ? 'Verified' : 'Cần kiểm tra'}
          </div>
          <button
            type="button"
            onClick={reset}
            disabled={!dirty}
            className="h-9 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] text-zinc-700 font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Hoàn tác
          </button>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1 p-1 rounded-xl bg-white border border-zinc-200 shadow-sm w-full sm:w-fit overflow-x-auto">
        <SectionButton active={view === 'stats'} onClick={() => setView('stats')} icon={<Gauge className="w-3.5 h-3.5" />} label="Chỉ số" />
        <SectionButton active={view === 'skills'} onClick={() => setView('skills')} icon={<Sparkles className="w-3.5 h-3.5" />} label="Kỹ năng" />
        <SectionButton active={view === 'schema'} onClick={() => setView('schema')} icon={<Database className="w-3.5 h-3.5" />} label="Schema" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0 sm:pr-1 pb-2">
        {view === 'stats' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <SummaryCard icon={<HeartPulse className="w-4 h-4 text-rose-500" />} label="HP gốc" value={draft.baseHp} original={baseline.baseHp} field="yq" />
              <SummaryCard icon={<Zap className="w-4 h-4 text-cyan-500" />} label="KI gốc" value={draft.baseKi} original={baseline.baseKi} field="yr" />
              <SummaryCard icon={<Swords className="w-4 h-4 text-orange-500" />} label="Sức đánh" value={draft.baseDamage} original={baseline.baseDamage} field="ys" />
              <SummaryCard icon={<Sparkles className="w-4 h-4 text-violet-500" />} label="Sức mạnh" value={draft.power} original={baseline.power} field="cj" />
            </div>

            <EditorSection title="Danh tính logic" subtitle="Giữ gN/tên do game quản lý; chỉ chỉnh các byte đã được save validator xác minh.">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <NumberEditor label="Loại đệ tử" technical="aZ" value={draft.type} min={0} max={1} onChange={(type) => patch({ type })} />
                <SelectEditor
                  label="Hành tinh"
                  technical="ba"
                  value={draft.planet}
                  options={PLANET_LABELS.map((label, value) => ({ value, label: `${value} · ${label}` }))}
                  onChange={(planet) => patch({ planet })}
                />
                <NumberEditor label="Trạng thái" technical="bb" value={draft.status} min={0} max={4} onChange={(status) => patch({ status })} />
              </div>
            </EditorSection>

            <EditorSection title="Sức mạnh & tiến trình">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NumberEditor label="Sức mạnh" technical="cj" value={draft.power} min={0} max={1_000_000_000_000} onChange={(power) => patch({ power })} />
                <NumberEditor label="Tiềm năng" technical="ck" value={draft.potential} min={0} max={1_000_000_000_000} onChange={(potential) => patch({ potential })} />
              </div>
            </EditorSection>

            <EditorSection title="Chỉ số chiến đấu">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <NumberEditor label="HP gốc" technical="yq" value={draft.baseHp} min={0} onChange={(baseHp) => patch({ baseHp })} />
                <NumberEditor label="KI gốc" technical="yr" value={draft.baseKi} min={0} onChange={(baseKi) => patch({ baseKi })} />
                <NumberEditor label="Sức đánh" technical="ys" value={draft.baseDamage} min={0} onChange={(baseDamage) => patch({ baseDamage })} />
                <NumberEditor label="Giáp" technical="yt" value={draft.armor} min={0} onChange={(armor) => patch({ armor })} />
                <NumberEditor label="Chí mạng %" technical="yu" value={draft.critical} min={0} max={100} onChange={(critical) => patch({ critical })} />
              </div>
            </EditorSection>

            <EditorSection title="HP / KI / thể lực hiện tại">
              <div className="flex gap-2 overflow-x-auto mb-3 pb-0.5">
                <QuickButton label="HP/KI hiện tại = gốc" onClick={syncCurrent} />
                <QuickButton label="Hồi đầy thể lực" onClick={fullStamina} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <NumberEditor label="HP hiện tại" technical="yv" value={draft.hp} min={0} onChange={(hp) => patch({ hp })} />
                <NumberEditor label="KI hiện tại" technical="yw" value={draft.ki} min={0} onChange={(ki) => patch({ ki })} />
                <NumberEditor label="Thể lực" technical="yx" value={draft.stamina} min={0} onChange={(stamina) => patch({ stamina })} />
                <NumberEditor label="Thể lực tối đa" technical="yy" value={draft.maxStamina} min={0} onChange={(maxStamina) => patch({ maxStamina })} />
              </div>
            </EditorSection>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-800 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 inline mr-1.5 align-[-2px]" />
              <strong>Writer thật đã bật.</strong> Test Workspace sẽ hook <code>a/a/H.gf()</code> sang helper major 47 và ghi các default trên. Logic save hiện tại không bị thay đổi.
            </div>
          </div>
        ) : view === 'skills' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
              <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-zinc-900">7 ô kỹ năng Đệ tử</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">cV = ID kỹ năng · cW = cấp kỹ năng</div>
                </div>
                <button type="button" onClick={clearSkills} className="self-start sm:self-auto h-9 px-3 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[11px] text-zinc-700 cursor-pointer">
                  Reset 7 skill
                </button>
              </div>
              <div className="p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
                {draft.skills.map((skill, index) => (
                  <div key={index} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <strong className="text-xs text-zinc-800">Slot {index + 1}</strong>
                      <span className="text-[9px] text-zinc-500 font-mono">cV[{index}] / cW[{index}]</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumberEditor compact label="Skill ID" technical="ID" value={skill.id} min={-1} onChange={(id) => patchSkill(index, { id })} />
                      <NumberEditor compact label="Cấp" technical="LV" value={skill.level} min={0} max={10_000} onChange={(level) => patchSkill(index, { level })} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <SchemaView snapshot={snapshot} grouped={grouped} />
        )}
      </div>
    </div>
  );
}

function SchemaView({
  snapshot,
  grouped,
}: {
  snapshot: DiscipleSchemaSnapshot;
  grouped: Map<DiscipleFieldGroup, DiscipleSchemaSnapshot['fields']>;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3">
      <div className="space-y-3">
        {(['identity', 'progress', 'combat', 'runtime', 'skills', 'inventory'] as DiscipleFieldGroup[]).map((group) => {
          const fields = grouped.get(group) ?? [];
          return (
            <div key={group} className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
              <div className="h-10 px-3 sm:px-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                <strong className="text-xs text-zinc-900">{GROUP_LABELS[group]}</strong>
                <span className="text-[9px] text-zinc-500 font-mono">{fields.length} field</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {fields.map((field) => (
                  <div key={field.field} className="px-3 sm:px-4 py-3 grid grid-cols-[46px_minmax(0,1fr)_70px] sm:grid-cols-[58px_minmax(0,1fr)_92px_auto] gap-2 items-center">
                    <code className="text-[10px] text-indigo-600 font-bold">{field.field}</code>
                    <div className="min-w-0">
                      <div className="text-[11px] sm:text-[12px] text-zinc-800">{field.label}</div>
                      {field.note && <div className="text-[9px] text-zinc-500 mt-0.5 leading-relaxed">{field.note}</div>}
                    </div>
                    <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono text-right">{field.type}</span>
                    <span className={`hidden sm:inline-flex justify-self-end px-1.5 py-0.5 rounded-full border text-[9px] font-mono ${field.editable ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'}`}>
                      {field.editable ? 'editable' : 'read-only'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="h-10 px-4 border-b border-zinc-200 bg-gradient-to-r from-cyan-50 to-white flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-600" />
            <strong className="text-xs text-zinc-900">Nguồn bytecode</strong>
          </div>
          <div className="p-3 space-y-2 text-[10px] font-mono">
            <SourceRow label="Player" value={snapshot.sourceClass} />
            <SourceRow label="Save codec" value={snapshot.codecClass} />
            <SourceRow label="Reset" value={`${snapshot.sourceClass}.${snapshot.resetMethod}`} />
            <SourceRow label="Helper" value={snapshot.helperClass} />
            <SourceRow label="Presence" value={snapshot.presenceField} />
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-1 gap-2">
          <Capacity icon={<Shield className="w-4 h-4 text-blue-500" />} label="Trang bị" value={snapshot.equipmentSlots} field="b" />
          <Capacity icon={<Backpack className="w-4 h-4 text-emerald-500" />} label="Hành trang" value={snapshot.bagSlots} field="c" />
        </div>
      </aside>
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return <span className="shrink-0 px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[9px] text-zinc-600 font-mono whitespace-nowrap">{text}</span>;
}

function SummaryCard({ icon, label, value, original, field }: { icon: React.ReactNode; label: string; value: number; original: number; field: string }) {
  const changed = value !== original;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 min-w-0">
      <div className="flex items-center justify-between">{icon}<code className="text-[9px] text-zinc-400">{field}</code></div>
      <div className={`text-lg sm:text-xl font-bold mt-2 truncate ${changed ? 'text-violet-600' : 'text-zinc-900'}`} title={String(value)}>{value.toLocaleString('vi-VN')}</div>
      <div className="text-[10px] text-zinc-500 truncate">{label}</div>
    </div>
  );
}

function EditorSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 bg-zinc-50">
        <div className="text-xs sm:text-sm font-bold text-zinc-900">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">{subtitle}</div>}
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </div>
  );
}

function NumberEditor({ label, technical, value, min, max, onChange, compact = false }: { label: string; technical: string; value: number; min?: number; max?: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] uppercase text-zinc-500 font-mono">
        <span className="truncate">{label}</span><span className="text-zinc-400 shrink-0">{technical}</span>
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        inputMode="numeric"
        onChange={(event) => onChange(Number(event.target.value))}
        className={`w-full min-w-0 bg-white border border-zinc-300 rounded-xl px-3 ${compact ? 'py-2' : 'py-2.5'} text-[12px] sm:text-[13px] text-zinc-900 font-mono placeholder:text-zinc-400 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 disabled:bg-zinc-100 disabled:text-zinc-500`}
      />
    </label>
  );
}

function SelectEditor({ label, technical, value, options, onChange }: { label: string; technical: string; value: number; options: Array<{ value: number; label: string }>; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] uppercase text-zinc-500 font-mono">
        <span>{label}</span><span className="text-zinc-400">{technical}</span>
      </span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2.5 text-[12px] sm:text-[13px] text-zinc-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="shrink-0 h-9 px-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-[10px] sm:text-[11px] text-zinc-700 font-medium cursor-pointer whitespace-nowrap">{label}</button>;
}

function SectionButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`shrink-0 h-9 px-3 rounded-lg text-[11px] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${active ? 'bg-cyan-50 border border-cyan-200 text-cyan-700' : 'border border-transparent text-zinc-600 hover:bg-zinc-50'}`}>
      {icon}{label}
    </button>
  );
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-2"><span className="text-zinc-500">{label}</span><code className="text-indigo-600 text-right break-all">{value}</code></div>;
}

function Capacity({ icon, label, value, field }: { icon: React.ReactNode; label: string; value: number; field: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3">
      <div className="flex items-center justify-between">{icon}<code className="text-[9px] text-zinc-400">{field}</code></div>
      <div className="text-2xl font-bold text-zinc-900 mt-2">{value}</div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}

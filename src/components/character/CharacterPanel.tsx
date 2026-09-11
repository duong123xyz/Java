import React, { useEffect, useMemo, useState, useRef } from 'react';
import './mobileLayoutFixes.css';
import {
  UserRound,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  HeartPulse,
  Zap,
  Swords,
  Shield,
  Target,
  Coins,
  Gem,
  Sparkles,
  MapPin,
  Package,
  Archive,
  BookOpen,
  ChevronRight,
  Database,
  Info,
  Stars,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeCharacterDefaults,
  CharacterAnalysisSnapshot,
  CharacterDraft,
  CharacterStarterProfile,
  getCharacterDraft,
  getDirtyCharacterCount,
  isCharacterDraftDirty,
  resetCharacterDraft,
  setCharacterDraft,
} from '../../services/characterDataService';
import { CharacterSpritePreview } from './CharacterSpritePreview';
import { DisciplePanel } from './DisciplePanel';

interface CharacterPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type CharacterView = 'starter' | 'disciple' | 'save';

export function CharacterPanel({
  session,
  onDraftsUpdated,
}: CharacterPanelProps) {
  const [snapshot, setSnapshot] = useState<CharacterAnalysisSnapshot | null>(null);
  const [selectedPlanet, setSelectedPlanet] = useState<0 | 1 | 2>(0);
  const [view, setView] = useState<CharacterView>('starter');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [discipleDirtyCount, setDiscipleDirtyCount] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeCharacterDefaults(session);
      setSnapshot(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  const onDraftsUpdatedRef = useRef(onDraftsUpdated);
  onDraftsUpdatedRef.current = onDraftsUpdated;

  useEffect(() => {
    load();
  }, [session]);

  useEffect(() => {
    if (!snapshot) return;
    void revision;
    onDraftsUpdatedRef.current?.(
      getDirtyCharacterCount(session, snapshot.profiles) + discipleDirtyCount
    );
  }, [session, snapshot, revision, discipleDirtyCount]);

  const selectedProfile = useMemo(() => {
    return snapshot?.profiles.find((profile) => profile.planet === selectedPlanet) ?? null;
  }, [snapshot, selectedPlanet]);

  if (loading) {
    return (
      <div className="min-h-[260px] xl:h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2">
          <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin mx-auto" />
          <div className="text-xs font-mono text-zinc-500">
            Đang đọc player class và schema save...
          </div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-[260px] xl:h-full flex items-center justify-center rounded-2xl border border-red-200 bg-red-50">
        <div className="max-w-xl p-4 text-red-700 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold mb-2">
            <AlertTriangle className="w-4 h-4" />
            Không đọc được dữ liệu nhân vật
          </div>
          <div className="whitespace-pre-wrap">{error}</div>
          <button
            type="button"
            onClick={load}
            className="mt-3 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const dirtyCount = getDirtyCharacterCount(session, snapshot.profiles) + discipleDirtyCount;

  return (
    <div className="nro-character-panel w-full min-w-0 flex flex-col gap-3 xl:h-full xl:min-h-0">
      <div className="shrink-0 rounded-2xl border border-zinc-200 bg-white shadow-sm px-3 sm:px-4 py-3 flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-indigo-100 to-cyan-100 border border-indigo-200 flex items-center justify-center shrink-0">
            <UserRound className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-zinc-900">Nhân vật</div>
            <div className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2 sm:line-clamp-none">
              Xem trực quan nhân vật khởi tạo theo hành tinh và chỉnh nhanh bộ chỉ số mặc định.
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap scrollbar-none touch-pan-x">
              <StatChip text="3 hành tinh" />
              <StatChip text="Sprite preview" />
              <StatChip text="H.p(byte)" />
              <StatChip text="Source-backed" />
              <StatChip text="Save a/a/N" />
              {dirtyCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 text-[10px] font-mono">
                  {dirtyCount} nháp
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className={`self-start sm:self-auto shrink-0 flex items-center gap-1.5 text-[10px] font-mono ${
            snapshot.verified ? 'text-emerald-600' : 'text-amber-600'
          }`}
          title={snapshot.verificationDetail}
        >
          {snapshot.verified ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5" />
          )}
          <span className="hidden 2xl:inline">
            {snapshot.verified ? 'Source-backed + writer READY' : 'Cần kiểm tra cấu trúc'}
          </span>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1 p-1 rounded-xl bg-white border border-zinc-200 shadow-sm w-full sm:w-fit overflow-x-auto scrollbar-none touch-pan-x">
        <ViewButton
          active={view === 'starter'}
          onClick={() => setView('starter')}
          icon={<Sparkles className="w-3 h-3" />}
          label="Nhân vật khởi tạo"
        />
        <ViewButton
          active={view === 'disciple'}
          onClick={() => setView('disciple')}
          icon={<UserRound className="w-3 h-3" />}
          label="Đệ tử"
        />
        <ViewButton
          active={view === 'save'}
          onClick={() => setView('save')}
          icon={<Database className="w-3 h-3" />}
          label="Schema save"
        />
      </div>

      <div className="min-w-0 xl:min-h-0 xl:flex-1">
        {view === 'starter' ? (
          <StarterEditor
            session={session}
            snapshot={snapshot}
            selectedPlanet={selectedPlanet}
            onSelectPlanet={setSelectedPlanet}
            selectedProfile={selectedProfile}
            onChanged={() => setRevision((value) => value + 1)}
          />
        ) : view === 'disciple' ? (
          <DisciplePanel
            session={session}
            onDraftsUpdated={setDiscipleDirtyCount}
          />
        ) : (
          <SaveSchemaView snapshot={snapshot} />
        )}
      </div>
    </div>
  );
}

function StarterEditor({
  session,
  snapshot,
  selectedPlanet,
  onSelectPlanet,
  selectedProfile,
  onChanged,
}: {
  session: LoadedJarSession;
  snapshot: CharacterAnalysisSnapshot;
  selectedPlanet: 0 | 1 | 2;
  onSelectPlanet: (planet: 0 | 1 | 2) => void;
  selectedProfile: CharacterStarterProfile | null;
  onChanged: () => void;
}) {
  if (!selectedProfile) return null;

  const [draft, setDraftState] = useState<CharacterDraft>(() =>
    getCharacterDraft(session, selectedProfile)
  );

  useEffect(() => {
    setDraftState(getCharacterDraft(session, selectedProfile));
  }, [session, selectedProfile.planet]);

  const dirty = isCharacterDraftDirty(selectedProfile, draft);

  const save = (next: CharacterDraft) => {
    setCharacterDraft(session, selectedProfile, next);
    setDraftState(getCharacterDraft(session, selectedProfile));
    onChanged();
  };

  const patch = (value: Partial<CharacterDraft>) => save({ ...draft, ...value });

  const reset = () => {
    setDraftState(resetCharacterDraft(session, selectedProfile));
    onChanged();
  };

  const multiplyCombat = (multiplier: number) => {
    patch({
      baseHp: Math.max(1, Math.round(selectedProfile.baseHp * multiplier)),
      baseKi: Math.max(1, Math.round(selectedProfile.baseKi * multiplier)),
      baseDamage: Math.max(1, Math.round(selectedProfile.baseDamage * multiplier)),
    });
  };

  const multiplyProgress = (multiplier: number) => {
    patch({
      power: Math.max(0, Math.round(selectedProfile.power * multiplier)),
      potential: Math.max(0, Math.round(selectedProfile.potential * multiplier)),
    });
  };

  return (
    <div className="nro-starter-editor grid grid-cols-1 gap-3 min-w-0 xl:h-full xl:min-h-0 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col xl:min-h-0">
        <div className="px-4 py-3 border-b border-zinc-200 bg-gradient-to-r from-indigo-50 to-cyan-50">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">
            Chọn mẫu nhân vật
          </div>
          <div className="text-sm font-bold text-zinc-900 mt-1">Hiển thị trực quan theo hành tinh</div>
        </div>

        <div className="p-3 flex gap-2 overflow-x-auto scrollbar-none touch-pan-x xl:min-h-0 xl:flex-1 xl:block xl:space-y-3 xl:overflow-y-auto">
          {snapshot.profiles.map((profile) => {
            const profileDraft = getCharacterDraft(session, profile);
            const profileDirty = isCharacterDraftDirty(profile, profileDraft);
            const selected = profile.planet === selectedPlanet;

            return (
              <button
                key={profile.planet}
                type="button"
                onClick={() => onSelectPlanet(profile.planet)}
                className={`min-w-[260px] sm:min-w-[300px] xl:min-w-0 xl:w-full rounded-2xl border text-left overflow-hidden cursor-pointer transition-all ${
                  selected
                    ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50'
                }`}
              >
                <div className="p-3 flex items-center gap-3">
                  <div className="w-[72px] sm:w-[92px] shrink-0">
                    <CharacterSpritePreview
                      session={session}
                      head={profile.previewHead}
                      body={profile.previewBody}
                      leg={profile.previewLeg}
                      name={profile.planetName}
                      compact
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-zinc-900">{profile.planetName}</span>
                      {profileDirty && (
                        <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[9px] font-mono">
                          nháp
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">{profile.archetype}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
                      <MiniBadge label="HP" value={profileDraft.baseHp} />
                      <MiniBadge label="KI" value={profileDraft.baseKi} />
                      <MiniBadge label="ATK" value={profileDraft.baseDamage} />
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-2">
                      map {profileDraft.mapId} · skill {profileDraft.selectedSkill}
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col xl:min-h-0">
        <div className="shrink-0 px-3 sm:px-4 py-3 border-b border-zinc-200 bg-gradient-to-r from-white via-indigo-50/40 to-cyan-50/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <PlanetPill planet={selectedProfile.planet} />
            <div className="min-w-0">
              <div className="text-lg font-bold text-zinc-900">{selectedProfile.planetName}</div>
              <div className="text-[11px] text-zinc-500">
                {selectedProfile.archetype} · source: a/a/H.p({selectedProfile.planet})
              </div>
            </div>
            {dirty && (
              <span className="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 text-[10px] font-mono">
                đang sửa
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={reset}
            disabled={!dirty}
            className="w-full sm:w-auto justify-center px-3 py-2 sm:py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] text-zinc-700 font-medium flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Hoàn tác
          </button>
        </div>

        <div className="p-3 sm:p-4 space-y-4 min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <div className="grid grid-cols-1 2xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
            <CharacterSpritePreview
              session={session}
              head={selectedProfile.previewHead}
              body={selectedProfile.previewBody}
              leg={selectedProfile.previewLeg}
              name={selectedProfile.planetName}
              subtitle="Preview trực quan cho panel nhân vật"
              showTechnicalInfo
            />

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <HeroStat
                icon={<HeartPulse className="w-4 h-4 text-rose-500" />}
                label="HP gốc"
                value={draft.baseHp}
                original={selectedProfile.baseHp}
              />
              <HeroStat
                icon={<Zap className="w-4 h-4 text-cyan-500" />}
                label="KI gốc"
                value={draft.baseKi}
                original={selectedProfile.baseKi}
              />
              <HeroStat
                icon={<Swords className="w-4 h-4 text-orange-500" />}
                label="Sức đánh"
                value={draft.baseDamage}
                original={selectedProfile.baseDamage}
              />
              <HeroStat
                icon={<Coins className="w-4 h-4 text-amber-500" />}
                label="Vàng"
                value={draft.gold}
                original={selectedProfile.gold}
              />
              <HeroStat
                icon={<Gem className="w-4 h-4 text-emerald-500" />}
                label="Ngọc"
                value={draft.gems}
                original={selectedProfile.gems}
              />
              <HeroStat
                icon={<Stars className="w-4 h-4 text-violet-500" />}
                label="Tiềm năng"
                value={draft.potential}
                original={selectedProfile.potential}
              />
              <HeroStat
                icon={<Sparkles className="w-4 h-4 text-indigo-500" />}
                label="Sức mạnh"
                value={draft.power}
                original={selectedProfile.power}
              />
              <HeroStat
                icon={<MapPin className="w-4 h-4 text-sky-500" />}
                label="Map khởi đầu"
                value={draft.mapId}
                original={selectedProfile.mapId}
              />
              <HeroStat
                icon={<Target className="w-4 h-4 text-fuchsia-500" />}
                label="Skill chọn"
                value={draft.selectedSkill}
                original={selectedProfile.selectedSkill}
              />
            </div>
          </div>

          <EditorSection title="Chỉ số chiến đấu" icon={<Swords className="w-4 h-4 text-orange-500" />}>
            <div className="flex flex-wrap gap-2 mb-3">
              <QuickButton label="Khôi phục gốc" onClick={() => multiplyCombat(1)} />
              <QuickButton label="HP/KI/ATK x2" onClick={() => multiplyCombat(2)} />
              <QuickButton label="HP/KI/ATK x5" onClick={() => multiplyCombat(5)} />
              <QuickButton label="HP/KI/ATK x10" onClick={() => multiplyCombat(10)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
              <NumberEditor label="HP gốc" technical="xx" value={draft.baseHp} min={1} onChange={(baseHp) => patch({ baseHp })} />
              <NumberEditor label="KI gốc" technical="xy" value={draft.baseKi} min={1} onChange={(baseKi) => patch({ baseKi })} />
              <NumberEditor label="Sức đánh gốc" technical="xz" value={draft.baseDamage} min={1} onChange={(baseDamage) => patch({ baseDamage })} />
              <NumberEditor label="Giáp gốc" technical="xA" value={draft.baseArmor} min={0} onChange={(baseArmor) => patch({ baseArmor })} />
              <NumberEditor label="Chí mạng %" technical="xB" value={draft.baseCritical} min={0} max={100} onChange={(baseCritical) => patch({ baseCritical })} />
              <NumberEditor label="Tốc độ" technical="xC" value={draft.speed} min={1} onChange={(speed) => patch({ speed })} />
            </div>
          </EditorSection>

          <EditorSection title="Kinh tế & tiến trình" icon={<Coins className="w-4 h-4 text-amber-500" />}>
            <div className="flex flex-wrap gap-2 mb-3">
              <QuickButton label="Tiến trình gốc" onClick={() => multiplyProgress(1)} />
              <QuickButton label="Power/Potential x2" onClick={() => multiplyProgress(2)} />
              <QuickButton label="Power/Potential x5" onClick={() => multiplyProgress(5)} />
              <QuickButton label="Power/Potential x10" onClick={() => multiplyProgress(10)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
              <NumberEditor label="Vàng" technical="bS" value={draft.gold} min={0} onChange={(gold) => patch({ gold })} />
              <NumberEditor label="Ngọc" technical="xv" value={draft.gems} min={0} onChange={(gems) => patch({ gems })} />
              <NumberEditor label="Hồng ngọc" technical="xw" value={draft.ruby} min={0} onChange={(ruby) => patch({ ruby })} />
              <NumberEditor label="Sức mạnh" technical="bT" value={draft.power} min={0} onChange={(power) => patch({ power })} />
              <NumberEditor label="Tiềm năng" technical="bU" value={draft.potential} min={0} onChange={(potential) => patch({ potential })} />
              <NumberEditor label="Cấp" technical="vO" value={draft.level} min={1} onChange={(level) => patch({ level })} />
            </div>
          </EditorSection>

          <EditorSection title="Vị trí & trạng thái khởi tạo" icon={<MapPin className="w-4 h-4 text-sky-500" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8 gap-3">
              <NumberEditor label="Map" technical="vP" value={draft.mapId} min={0} onChange={(mapId) => patch({ mapId })} />
              <NumberEditor label="X" technical="cp" value={draft.spawnX} min={0} onChange={(spawnX) => patch({ spawnX })} />
              <NumberEditor label="Y" technical="cq" value={draft.spawnY} min={0} onChange={(spawnY) => patch({ spawnY })} />
              <NumberEditor label="Điểm kỹ năng" technical="yf" value={draft.skillPoints} min={0} onChange={(skillPoints) => patch({ skillPoints })} />
              <NumberEditor label="Thể lực" technical="yg" value={draft.stamina} min={0} onChange={(stamina) => patch({ stamina })} />
              <NumberEditor label="Thể lực max" technical="yh" value={draft.maxStamina} min={1} onChange={(maxStamina) => patch({ maxStamina })} />
              <NumberEditor label="Skill đang chọn" technical="yi" value={draft.selectedSkill} min={-1} onChange={(selectedSkill) => patch({ selectedSkill })} />
              <ReadOnlyField label="Hành tinh" technical="aX" value={`${draft.planet} · ${draft.planetName}`} />
            </div>
          </EditorSection>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-700 leading-relaxed">
            <CheckCircle2 className="w-4 h-4 inline mr-1.5 align-[-2px]" />
            Các giá trị trên được <strong>đọc trực tiếp từ bytecode H.p(byte)</strong> và đã có writer cho Test Workspace.
            Những producer dùng chung trong game (vàng/ngọc/power/X/Y..., HP Namek-Xayda, KI Earth-Xayda, damage Earth-Namek)
            sẽ tự đồng bộ đúng phạm vi khi sửa. Map giữ công thức <code>baseMap + planet</code>; thể lực và thể lực max dùng chung một producer.
          </div>
        </div>
      </section>
    </div>
  );
}

function SaveSchemaView({ snapshot }: { snapshot: CharacterAnalysisSnapshot }) {
  const structure = snapshot.structure;

  return (
    <div className="w-full min-w-0 space-y-3 xl:h-full xl:min-h-0 xl:overflow-y-auto">
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        <CapacityCard icon={<Shield className="w-4 h-4 text-blue-500" />} label="Trang bị" value={structure.equipmentSlots} field="d" />
        <CapacityCard icon={<Package className="w-4 h-4 text-emerald-500" />} label="Hành trang" value={structure.bagSlots} field="e" />
        <CapacityCard icon={<Archive className="w-4 h-4 text-violet-500" />} label="Rương đồ" value={structure.chestSlots} field="f" />
        <CapacityCard icon={<Coins className="w-4 h-4 text-amber-500" />} label="Đồ đã bán" value={structure.saleSlots} field="g" />
        <CapacityCard icon={<UserRound className="w-4 h-4 text-cyan-500" />} label="Đệ tử: trang bị" value={structure.discipleEquipmentSlots} field="b" />
        <CapacityCard icon={<BookOpen className="w-4 h-4 text-rose-500" />} label="Slot kỹ năng" value={structure.skillSlots} field="y" />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="h-11 px-4 border-b border-zinc-200 bg-gradient-to-r from-indigo-50 to-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-bold text-zinc-900">Field nhân vật trong save</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">a/a/N → a/a/H</span>
        </div>

        <div className="grid grid-cols-1 2xl:grid-cols-2">
          {snapshot.saveFields.map((field) => (
            <div
              key={field.field}
              className="px-3 sm:px-4 py-3 border-b border-r border-zinc-200 grid grid-cols-[48px_minmax(0,1fr)] sm:grid-cols-[56px_minmax(0,1fr)_98px_auto] gap-2 items-center min-w-0"
            >
              <code className="text-[10px] text-indigo-600 font-bold">{field.field}</code>
              <span className="text-[12px] text-zinc-700">{field.label}</span>
              <span className="col-start-2 sm:col-start-auto text-[10px] text-zinc-500 font-mono break-words">{field.type}</span>
              <span
                className={`col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto px-1.5 py-0.5 rounded-full border text-[9px] font-mono w-fit ${
                  field.editableInStarter
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                }`}
              >
                {field.editableInStarter ? 'khởi tạo' : 'save'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-[11px] text-cyan-700 leading-relaxed">
        Schema này đã đối chiếu với reader <code>a/a/N.a(byte[], int)</code>: tên, hành tinh,
        map, tọa độ, vàng/ngọc, sức mạnh-tiềm năng, chỉ số gốc, cấp, kỹ năng, nhiệm vụ,
        trang bị, hành trang và rương đều nằm trong save nhân vật.
      </div>
    </div>
  );
}

function MiniBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1">
      <div className="text-[9px] text-zinc-500 font-mono">{label}</div>
      <div className="text-[11px] font-bold text-zinc-800">{value}</div>
    </div>
  );
}

function HeroStat({
  icon,
  label,
  value,
  original,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  original: string | number;
}) {
  const changed = String(value) !== String(original);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold ${changed ? 'text-violet-600' : 'text-zinc-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] text-zinc-500 font-mono">
        {changed ? `gốc ${original}` : 'đang giữ mặc định'}
      </div>
    </div>
  );
}

function PlanetPill({ planet }: { planet: 0 | 1 | 2 }) {
  const config =
    planet === 0
      ? { text: 'Trái Đất', className: 'bg-blue-50 border-blue-200 text-blue-700' }
      : planet === 1
      ? { text: 'Namek', className: 'bg-emerald-50 border-emerald-200 text-emerald-700' }
      : { text: 'Xayda', className: 'bg-rose-50 border-rose-200 text-rose-700' };

  return (
    <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold ${config.className}`}>
      {config.text}
    </div>
  );
}

function EditorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 overflow-hidden">
      <div className="h-11 px-4 border-b border-zinc-200 bg-white flex items-center gap-2">
        {icon}
        <span className="text-sm font-bold text-zinc-900">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function NumberEditor({
  label,
  technical,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  technical: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-1 text-[10px] uppercase text-zinc-500 font-mono">
        <span>{label}</span>
        <span className="text-zinc-400">{technical}</span>
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-[12px] text-zinc-900 font-mono focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}

function ReadOnlyField({
  label,
  technical,
  value,
}: {
  label: string;
  technical: string;
  value: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center justify-between gap-1 text-[10px] uppercase text-zinc-500 font-mono">
        <span>{label}</span>
        <span className="text-zinc-400">{technical}</span>
      </span>
      <div className="px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-100 text-[12px] text-zinc-700 font-mono">
        {value}
      </div>
    </div>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-[11px] text-zinc-700 font-medium cursor-pointer"
    >
      {label}
    </button>
  );
}

function CapacityCard({
  icon,
  label,
  value,
  field,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  field: string;
}) {
  return (
    <div className="p-3 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between">
        {icon}
        <code className="text-[9px] text-zinc-500">{field}</code>
      </div>
      <div className="mt-2 text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-[10px] text-zinc-500 font-mono">{label}</div>
    </div>
  );
}

function StatChip({ text }: { text: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] text-zinc-600 font-mono whitespace-nowrap">
      {text}
    </span>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 cursor-pointer ${
        active
          ? 'bg-indigo-50 border border-indigo-200 text-indigo-600'
          : 'text-zinc-600 hover:text-zinc-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

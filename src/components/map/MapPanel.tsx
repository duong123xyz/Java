import React, { useEffect, useMemo, useState } from 'react';
import {
  MapPinned,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Users,
  Bug,
  Signpost,
  Crown,
  Layers3,
  Maximize2,
  Image as ImageIcon,
  ChevronRight,
  Info,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeMaps,
  GameMapRecord,
  MapDataSnapshot,
  MapDraft,
  MapMobSpawn,
  MapNpcPlacement,
  MapWaypoint,
  getDirtyMapCount,
  getMapDraft,
  isMapDraftDirty,
  resetMapDraft,
  setMapDraft,
} from '../../services/mapDataService';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import { JarImagePreview } from './JarImagePreview';
import { MapWorldEditor } from './MapWorldEditor';
import {
  getBossDefinitions,
  getBossDraft,
  getDirtyBossCount as getDirtyBossDraftCount,
  setBossDraft,
} from '../../services/bossDataService';

interface MapPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
  onBossDraftsUpdated?: (dirtyCount: number) => void;
}

type MapFilter = 'all' | 'boss' | 'npc' | 'mob';
type EntityView = 'npc' | 'mob' | 'portal' | 'boss';

export function MapPanel({
  session,
  onDraftsUpdated,
  onBossDraftsUpdated,
}: MapPanelProps) {
  const [snapshot, setSnapshot] = useState<MapDataSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MapFilter>('all');
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeMaps(session);
      setSnapshot(result);
      if (selectedMapId === null && result.maps.length > 0) {
        setSelectedMapId(result.maps[0].id);
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
    if (!snapshot) return;
    void revision;
    onDraftsUpdated?.(getDirtyMapCount(session, snapshot.maps));
  }, [session, snapshot, revision, onDraftsUpdated]);

  const filteredMaps = useMemo(() => {
    if (!snapshot) return [];
    void revision;
    const q = query.trim().toLowerCase();

    return snapshot.maps.filter((map) => {
      if (filter === 'boss' && map.bosses.length === 0) return false;
      if (filter === 'npc' && map.npcs.length === 0) return false;
      if (filter === 'mob' && map.mobs.length === 0) return false;

      if (!q) return true;
      return (
        String(map.id).includes(q) ||
        map.name.toLowerCase().includes(q) ||
        String(map.planetId).includes(q) ||
        map.npcs.some((npc) => npc.name.toLowerCase().includes(q)) ||
        map.mobs.some((mob) => mob.name.toLowerCase().includes(q)) ||
        map.bosses.some((boss) => boss.name.toLowerCase().includes(q))
      );
    });
  }, [snapshot, query, filter, revision]);

  const selectedMap = useMemo(() => {
    if (!snapshot || selectedMapId === null) return null;
    return snapshot.maps.find((map) => map.id === selectedMapId) ?? null;
  }, [snapshot, selectedMapId]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="text-center space-y-2">
          <RefreshCw className="w-5 h-5 text-blue-400 animate-spin mx-auto" />
          <div className="text-xs font-mono text-zinc-500">
            Đang đọc 169 map, NPC, mob, cổng và boss...
          </div>
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
            Không đọc được dữ liệu map
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

  const dirtyCount = getDirtyMapCount(session, snapshot.maps);
  const cleanDiagnostics =
    snapshot.diagnostics.brokenWaypointTargets === 0 &&
    snapshot.diagnostics.missingMobTemplates === 0 &&
    snapshot.diagnostics.missingNpcTemplates === 0;

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="shrink-0 h-11 px-3 bg-zinc-900/90 border border-zinc-800 rounded-lg flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MapPinned className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-sm font-bold text-zinc-100">Map</span>
          <StatChip text={`${snapshot.maps.length} map`} />
          <StatChip text={`${snapshot.npcPlacementCount} NPC`} />
          <StatChip text={`${snapshot.mobCount} mob`} />
          <StatChip text={`${snapshot.waypointCount} cổng`} />
          <StatChip text={`${snapshot.bossPlacementCount} boss`} />
          {dirtyCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 text-[10px] font-mono">
              {dirtyCount} nháp
            </span>
          )}
        </div>

        <div
          className={`shrink-0 flex items-center gap-1.5 text-[10px] font-mono ${
            cleanDiagnostics ? 'text-emerald-400' : 'text-amber-400'
          }`}
          title={`Cổng lỗi: ${snapshot.diagnostics.brokenWaypointTargets}, mob thiếu template: ${snapshot.diagnostics.missingMobTemplates}, NPC thiếu template: ${snapshot.diagnostics.missingNpcTemplates}`}
        >
          {cleanDiagnostics ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5" />
          )}
          <span className="hidden 2xl:inline">
            {cleanDiagnostics ? 'Liên kết map hợp lệ' : 'Có dữ liệu cần kiểm tra'}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[350px_minmax(0,1fr)] gap-2">
        <aside className="min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
          <div className="shrink-0 p-2 border-b border-zinc-800 bg-zinc-950/50 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tên map, ID, NPC, mob, boss..."
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md pl-8 pr-2 py-1.5 text-[11px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div className="flex gap-1 overflow-x-auto">
              <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} label="Tất cả" />
              <FilterButton active={filter === 'npc'} onClick={() => setFilter('npc')} label="Có NPC" />
              <FilterButton active={filter === 'mob'} onClick={() => setFilter('mob')} label="Có mob" />
              <FilterButton active={filter === 'boss'} onClick={() => setFilter('boss')} label="Có boss" />
              <span className="ml-auto px-1.5 py-1 text-[9px] text-zinc-600 font-mono whitespace-nowrap">
                {filteredMaps.length}/{snapshot.maps.length}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredMaps.map((map) => {
              const selected = map.id === selectedMapId;
              const draft = getMapDraft(session, map);
              const dirty = isMapDraftDirty(map, draft);

              return (
                <button
                  key={map.id}
                  type="button"
                  onClick={() => setSelectedMapId(map.id)}
                  className={`w-full h-[62px] text-left px-2.5 border-b border-zinc-800/70 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-blue-500/10 border-l-2 border-l-blue-400'
                      : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="h-full flex items-center gap-2">
                    <span className="text-[9px] font-mono text-blue-400 w-7 shrink-0">
                      #{map.id}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-zinc-100 truncate">
                          {draft.name}
                        </span>
                        {dirty && (
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" title="Có nháp" />
                        )}
                      </div>
                      <div className="text-[9px] text-zinc-500 font-mono mt-0.5">
                        planet {map.planetId} · {map.zones} khu · max {map.maxPlayer}
                      </div>
                      <div className="text-[8px] text-zinc-600 font-mono mt-0.5">
                        {map.npcs.length} NPC · {map.mobs.length} mob · {map.waypoints.length} cổng · {map.bosses.length} boss
                      </div>
                    </div>

                    <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-h-0 bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden">
          {selectedMap ? (
            <MapDetail
              session={session}
              snapshot={snapshot}
              map={selectedMap}
              onChanged={() => setRevision((value) => value + 1)}
              onBossDraftsUpdated={onBossDraftsUpdated}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-zinc-500 font-mono">
              Chọn một map.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MapDetail({
  session,
  snapshot,
  map,
  onChanged,
  onBossDraftsUpdated,
}: {
  session: LoadedJarSession;
  snapshot: MapDataSnapshot;
  map: GameMapRecord;
  onChanged: () => void;
  onBossDraftsUpdated?: (dirtyCount: number) => void;
}) {
  const [draft, setDraftState] = useState<MapDraft>(() => getMapDraft(session, map));
  const [entityView, setEntityView] = useState<EntityView>('npc');

  useEffect(() => {
    setDraftState(getMapDraft(session, map));
    setEntityView('npc');
  }, [session, map.id]);

  const dirty = isMapDraftDirty(map, draft);

  const save = (next: MapDraft) => {
    setMapDraft(session, map, next);
    setDraftState(getMapDraft(session, map));
    onChanged();
  };

  const patch = (value: Partial<MapDraft>) => save({ ...draft, ...value });

  const reset = () => {
    setDraftState(resetMapDraft(session, map));
    onChanged();
  };

  const bossDefinitions = useMemo(() => getBossDefinitions(), []);

  const moveBossSpawnX = (bossIndex: number, spawnX: number) => {
    const definition = bossDefinitions.find((boss) => boss.index === bossIndex);
    if (!definition) return;

    const bossDraft = getBossDraft(session, definition);
    setBossDraft(session, definition, { ...bossDraft, spawnX });
    onBossDraftsUpdated?.(getDirtyBossDraftCount(session));
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 h-12 px-3 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[9px] font-mono font-bold">
            MAP #{map.id}
          </span>
          <h3 className="text-sm font-bold text-zinc-100 truncate">{draft.name}</h3>
          <span className="hidden 2xl:inline text-[9px] text-zinc-600 font-mono">
            a/a/a/z.u[row {map.rowIndex}] · planet {map.planetId}
          </span>
          {dirty && (
            <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/30 text-[9px] font-mono">
              nháp
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={reset}
          disabled={!dirty}
          className="shrink-0 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-35 disabled:cursor-not-allowed text-[10px] text-zinc-300 font-mono flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          Hoàn tác
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        <MapWorldEditor
          session={session}
          map={map}
          tileId={draft.tileId}
          npcs={draft.npcs}
          mobs={draft.mobs}
          waypoints={draft.waypoints}
          bosses={map.bosses.map((boss) => {
            const definition = bossDefinitions.find((candidate) => candidate.index === boss.bossIndex);
            const bossDraft = definition ? getBossDraft(session, definition) : null;
            return bossDraft ? { ...boss, spawnX: bossDraft.spawnX } : boss;
          })}
          onNpcsChange={(rows) => save({ ...draft, npcs: rows })}
          onMobsChange={(rows) => save({ ...draft, mobs: rows })}
          onWaypointsChange={(rows) => save({ ...draft, waypoints: rows })}
          onBossSpawnXChange={moveBossSpawnX}
        />

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-2.5">
          <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8 gap-2">
            <TextEditor label="Tên map" value={draft.name} onChange={(value) => patch({ name: value })} />
            <NumberEditor label="Số khu" value={draft.zones} min={1} onChange={(value) => patch({ zones: value })} />
            <NumberEditor label="Max người/khu" value={draft.maxPlayer} min={1} onChange={(value) => patch({ maxPlayer: value })} />
            <NumberEditor label="Planet ID" value={draft.planetId} onChange={(value) => patch({ planetId: value })} />
            <NumberEditor label="Type" value={draft.type} onChange={(value) => patch({ type: value })} />
            <NumberEditor label="BG type" value={draft.bgType} onChange={(value) => patch({ bgType: value })} />
            <NumberEditor label="Tile ID" value={draft.tileId} min={0} onChange={(value) => patch({ tileId: value })} />
            <NumberEditor label="BG ID" value={draft.bgId} min={-1} onChange={(value) => patch({ bgId: value })} />
          </div>
          <label className="mt-2 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-zinc-800 bg-zinc-950/50 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isMapDouble === 1}
              onChange={(event) => patch({ isMapDouble: event.target.checked ? 1 : 0 })}
            />
            <span className="text-[9px] font-mono text-zinc-500">Map double</span>
          </label>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 overflow-hidden">
          <div className="h-10 px-2.5 border-b border-zinc-800 flex items-center gap-1 overflow-x-auto">
            <EntityTab
              active={entityView === 'npc'}
              onClick={() => setEntityView('npc')}
              icon={<Users className="w-3 h-3" />}
              label={`NPC ${draft.npcs.length}`}
            />
            <EntityTab
              active={entityView === 'mob'}
              onClick={() => setEntityView('mob')}
              icon={<Bug className="w-3 h-3" />}
              label={`Mob ${draft.mobs.length}`}
            />
            <EntityTab
              active={entityView === 'portal'}
              onClick={() => setEntityView('portal')}
              icon={<Signpost className="w-3 h-3" />}
              label={`Cổng ${draft.waypoints.length}`}
            />
            <EntityTab
              active={entityView === 'boss'}
              onClick={() => setEntityView('boss')}
              icon={<Crown className="w-3 h-3" />}
              label={`Boss ${map.bosses.length}`}
            />
          </div>

          <div className="p-2.5">
            {entityView === 'npc' ? (
              <NpcPlacementTable
                session={session}
                rows={draft.npcs}
                onChange={(rows) => save({ ...draft, npcs: rows })}
              />
            ) : entityView === 'mob' ? (
              <MobPlacementTable
                session={session}
                rows={draft.mobs}
                onChange={(rows) => save({ ...draft, mobs: rows })}
              />
            ) : entityView === 'portal' ? (
              <WaypointTable
                rows={draft.waypoints}
                maps={snapshot.maps}
                onChange={(rows) => save({ ...draft, waypoints: rows })}
              />
            ) : (
              <BossList map={map} />
            )}
          </div>
        </div>

        <details className="rounded-md border border-zinc-800 bg-zinc-950/40">
          <summary className="px-2.5 py-1.5 cursor-pointer select-none text-[9px] text-zinc-600 hover:text-zinc-400 font-mono flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            Chi tiết kỹ thuật map
          </summary>
          <div className="px-2.5 pb-2 grid grid-cols-2 lg:grid-cols-4 gap-1.5 text-[9px] font-mono text-zinc-500">
            <InfoBox label="Source" value={`a/a/a/z.u[row ${map.rowIndex}]`} />
            <InfoBox label="Raw data" value={`[${map.rawData.join(', ')}]`} />
            <InfoBox label="Schema cols" value={snapshot.schema.length} />
            <InfoBox label="is_map_double" value={draft.isMapDouble} />
          </div>
        </details>
      </div>
    </div>
  );
}

function NpcPlacementTable({
  session,
  rows,
  onChange,
}: {
  session: LoadedJarSession;
  rows: MapNpcPlacement[];
  onChange: (rows: MapNpcPlacement[]) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState text="Map này không có NPC placement trong bảng z.u." />;
  }

  const update = (index: number, patch: Partial<MapNpcPlacement>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-2">
      {rows.map((row, index) => (
        <div key={`${row.npcId}-${index}`} className="p-2 rounded-md border border-zinc-800 bg-zinc-900/55 flex items-center gap-2">
          <SmallImagePreview session={session} imageId={row.avatar} alt={row.name} variant="icon" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-zinc-100 truncate">{row.name}</div>
            <div className="text-[8px] text-zinc-600 font-mono">
              NPC #{row.npcId} · part {row.head}/{row.body}/{row.leg}
              {row.extra !== null ? ` · extra ${row.extra}` : ''}
            </div>
          </div>
          <CoordinateInputs
            x={row.x}
            y={row.y}
            onX={(x) => update(index, { x })}
            onY={(y) => update(index, { y })}
          />
        </div>
      ))}
    </div>
  );
}

function MobPlacementTable({
  session,
  rows,
  onChange,
}: {
  session: LoadedJarSession;
  rows: MapMobSpawn[];
  onChange: (rows: MapMobSpawn[]) => void;
}) {
  if (rows.length === 0) return <EmptyState text="Map này không có mob spawn." />;

  const update = (index: number, patch: Partial<MapMobSpawn>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-2">
      {rows.map((row, index) => (
        <div key={`${row.mobId}-${index}`} className="p-2 rounded-md border border-zinc-800 bg-zinc-900/55 flex items-center gap-2">
          <JarImagePreview
            session={session}
            path={`x1/mob/${row.mobId}/img.png`}
            alt={row.name}
            variant="icon"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-zinc-100 truncate">{row.name}</div>
            <div className="text-[8px] text-zinc-600 font-mono">
              mob #{row.mobId} · HP template {row.templateHp.toLocaleString('vi-VN')}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 w-[170px] shrink-0">
            <TinyNumber label="Lv" value={row.level} min={1} onChange={(level) => update(index, { level })} />
            <TinyNumber label="HP" value={row.hp} min={1} onChange={(hp) => update(index, { hp })} />
            <TinyNumber label="X" value={row.x} onChange={(x) => update(index, { x })} />
            <TinyNumber label="Y" value={row.y} onChange={(y) => update(index, { y })} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WaypointTable({
  rows,
  maps,
  onChange,
}: {
  rows: MapWaypoint[];
  maps: GameMapRecord[];
  onChange: (rows: MapWaypoint[]) => void;
}) {
  if (rows.length === 0) return <EmptyState text="Map này không có waypoint/cổng." />;

  const names = new Map(maps.map((map) => [map.id, map.name]));
  const update = (index: number, patch: Partial<MapWaypoint>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={`${row.name}-${index}`} className="p-2 rounded-md border border-zinc-800 bg-zinc-900/55">
          <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-2">
            <div className="min-w-0 2xl:w-[220px] shrink-0">
              <div className="text-[11px] font-semibold text-zinc-100 truncate">{row.name}</div>
              <div className="text-[8px] text-zinc-600 font-mono">
                → map #{row.destinationMapId} {names.get(row.destinationMapId) ?? '(không tìm thấy)'}
              </div>
            </div>

            <div className="grid grid-cols-5 gap-1 flex-1">
              <TinyNumber label="X1" value={row.x1} onChange={(x1) => update(index, { x1 })} />
              <TinyNumber label="Y1" value={row.y1} onChange={(y1) => update(index, { y1 })} />
              <TinyNumber label="X2" value={row.x2} onChange={(x2) => update(index, { x2 })} />
              <TinyNumber label="Y2" value={row.y2} onChange={(y2) => update(index, { y2 })} />
              <TinyNumber label="Map" value={row.destinationMapId} onChange={(destinationMapId) => update(index, { destinationMapId })} />
            </div>

            <div className="grid grid-cols-2 gap-1 2xl:w-[180px] shrink-0">
              <TinyNumber label="Đích X" value={row.destinationX} onChange={(destinationX) => update(index, { destinationX })} />
              <TinyNumber label="Đích Y" value={row.destinationY} onChange={(destinationY) => update(index, { destinationY })} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BossList({ map }: { map: GameMapRecord }) {
  if (map.bosses.length === 0) return <EmptyState text="Không có boss record nào trỏ trực tiếp tới map này." />;

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-2">
      {map.bosses.map((boss) => (
        <div key={boss.bossIndex} className="p-2.5 rounded-md border border-zinc-800 bg-zinc-900/55 flex items-center gap-2">
          <Crown className="w-4 h-4 text-rose-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-zinc-100">{boss.name}</div>
            <div className="text-[8px] text-zinc-600 font-mono">
              boss #{boss.bossIndex} · char {boss.charId} · {boss.statMode === 'fixed' ? `HP ${boss.hp.toLocaleString('vi-VN')}` : 'HP runtime'}
            </div>
          </div>
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono">
            Boss panel
          </span>
        </div>
      ))}
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

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded border text-[9px] font-mono whitespace-nowrap cursor-pointer ${
        active
          ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
          : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );
}

function EntityTab({
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
      className={`px-2.5 py-1 rounded-md text-[10px] font-mono flex items-center gap-1 cursor-pointer whitespace-nowrap ${
        active
          ? 'bg-blue-500/10 border border-blue-500/30 text-blue-300'
          : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TextEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] uppercase text-zinc-600 font-mono">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[11px] text-zinc-100 focus:outline-none focus:border-blue-500"
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
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[11px] text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
      />
    </label>
  );
}

function CoordinateInputs({
  x,
  y,
  onX,
  onY,
}: {
  x: number;
  y: number;
  onX: (value: number) => void;
  onY: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 w-[135px] shrink-0">
      <TinyNumber label="X" value={x} onChange={onX} />
      <TinyNumber label="Y" value={y} onChange={onY} />
    </div>
  );
}

function TinyNumber({
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
    <label className="relative block min-w-0">
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[7px] text-zinc-600 font-mono pointer-events-none">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md pl-6 pr-1 py-1.5 text-[9px] text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
      />
    </label>
  );
}

function InfoBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-1.5 rounded bg-zinc-900 border border-zinc-800 min-w-0">
      <span className="text-zinc-600">{label}: </span>
      <span className="text-zinc-400 break-all">{value}</span>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="py-8 text-center text-[10px] text-zinc-600 font-mono">{text}</div>;
}

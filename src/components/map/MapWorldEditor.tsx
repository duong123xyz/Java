import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  Crown,
  Image as ImageIcon,
  Loader2,
  Lock,
  Move,
  Signpost,
  Unlock,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  GameMapRecord,
  MapBossPlacement,
  MapDecoration,
  MapMobSpawn,
  MapNpcPlacement,
  MapWaypoint,
  loadMapDecorations,
} from '../../services/mapDataService';
import { loadSmallImage } from '../../services/smallImageService';
import {
  NpcStandingComposition,
  NpcStandingPartPlacement,
  resolveNpcStandingComposition,
} from '../../services/partDataService';

interface MapWorldEditorProps {
  session: LoadedJarSession;
  map: GameMapRecord;
  tileId: number;
  npcs: MapNpcPlacement[];
  mobs: MapMobSpawn[];
  waypoints: MapWaypoint[];
  bosses: MapBossPlacement[];
  onNpcsChange: (rows: MapNpcPlacement[]) => void;
  onMobsChange: (rows: MapMobSpawn[]) => void;
  onWaypointsChange: (rows: MapWaypoint[]) => void;
  onBossSpawnXChange?: (bossIndex: number, spawnX: number) => void;
}

interface TileMapData {
  widthTiles: number;
  heightTiles: number;
  widthPx: number;
  heightPx: number;
  tiles: Uint8Array;
}

interface LoadedPart {
  placement: NpcStandingPartPlacement;
  url: string;
}

const TILE_SIZE = 24;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5];

function loadHtmlImage(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new window.Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không giải mã được ảnh PNG.'));
    };
    image.src = url;
  });
}

async function loadTileMap(session: LoadedJarSession, mapId: number): Promise<TileMapData> {
  const entry =
    session.zip.file(`mymap/${mapId}`) ??
    session.zip.file(`map/tile_map_data/${mapId}`);

  if (!entry) {
    throw new Error(`Không tìm thấy mymap/${mapId} trong JAR.`);
  }

  const bytes = await entry.async('uint8array');
  if (bytes.length < 3) throw new Error(`Tile-map #${mapId} quá ngắn.`);

  const widthTiles = bytes[0];
  const heightTiles = bytes[1];
  const expected = widthTiles * heightTiles;

  if (bytes.length < expected + 2) {
    throw new Error(
      `Tile-map #${mapId} thiếu dữ liệu: cần ${expected} tile, chỉ có ${bytes.length - 2}.`
    );
  }

  return {
    widthTiles,
    heightTiles,
    widthPx: widthTiles * TILE_SIZE,
    heightPx: heightTiles * TILE_SIZE,
    tiles: bytes.slice(2, 2 + expected),
  };
}

async function loadTileSheet(
  session: LoadedJarSession,
  tileId: number
): Promise<{ image: HTMLImageElement; url: string; path: string }> {
  const requested = `x1/t/${tileId}.png`;
  const fallback = 'x1/t/1.png';
  const entry = session.zip.file(requested) ?? session.zip.file(fallback);

  if (!entry) throw new Error(`Không tìm thấy tileset ${requested}.`);

  const path = session.zip.file(requested) ? requested : fallback;
  const blob = await entry.async('blob');
  const loaded = await loadHtmlImage(blob);
  return { ...loaded, path };
}

function drawTileMap(
  canvas: HTMLCanvasElement,
  mapData: TileMapData,
  sheet: HTMLImageElement
): void {
  canvas.width = mapData.widthPx;
  canvas.height = mapData.heightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không tạo được canvas map.');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < mapData.heightTiles; y++) {
    for (let x = 0; x < mapData.widthTiles; x++) {
      // Client a.ba lấy bB[...] - 1 trước khi render.
      const tileIndex = mapData.tiles[y * mapData.widthTiles + x] - 1;
      if (tileIndex < 0) continue;

      const sourceY = tileIndex * TILE_SIZE;
      if (sourceY + TILE_SIZE > sheet.naturalHeight) continue;

      ctx.drawImage(
        sheet,
        0,
        sourceY,
        TILE_SIZE,
        TILE_SIZE,
        x * TILE_SIZE,
        y * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE
      );
    }
  }
}

function worldPoint(
  clientX: number,
  clientY: number,
  worldElement: HTMLElement,
  zoom: number
): { x: number; y: number } {
  const rect = worldElement.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / zoom,
    y: (clientY - rect.top) / zoom,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function surfaceYAtX(mapData: TileMapData | null, x: number): number {
  if (!mapData) return 0;
  const tx = clamp(Math.floor(x / TILE_SIZE), 0, mapData.widthTiles - 1);

  // Tìm mặt trên của khối tile thấp nhất. Đây là cách gần nhất với cách boss
  // client được đặt xuống địa hình khi chỉ có spawnX.
  let lastNonEmpty = -1;
  for (let ty = 0; ty < mapData.heightTiles; ty++) {
    if (mapData.tiles[ty * mapData.widthTiles + tx] !== 0) {
      lastNonEmpty = ty;
    }
  }

  if (lastNonEmpty < 0) return mapData.heightPx - TILE_SIZE;
  while (
    lastNonEmpty > 0 &&
    mapData.tiles[(lastNonEmpty - 1) * mapData.widthTiles + tx] !== 0
  ) {
    lastNonEmpty--;
  }
  return lastNonEmpty * TILE_SIZE;
}

export function MapWorldEditor({
  session,
  map,
  tileId,
  npcs,
  mobs,
  waypoints,
  bosses,
  onNpcsChange,
  onMobsChange,
  onWaypointsChange,
  onBossSpawnXChange,
}: MapWorldEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [mapData, setMapData] = useState<TileMapData | null>(null);
  const [decorations, setDecorations] = useState<MapDecoration[]>([]);
  const [tilePath, setTilePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75);
  const [locked, setLocked] = useState(false);
  const [showDecorations, setShowDecorations] = useState(true);
  const [showNpc, setShowNpc] = useState(true);
  const [showMob, setShowMob] = useState(true);
  const [showPortal, setShowPortal] = useState(true);
  const [showBoss, setShowBoss] = useState(true);

  useEffect(() => {
    let active = true;
    let tileUrl: string | null = null;

    setLoading(true);
    setError(null);
    setMapData(null);
    setDecorations([]);

    const run = async () => {
      try {
        const [data, sheet, mapDecorations] = await Promise.all([
          loadTileMap(session, map.id),
          loadTileSheet(session, tileId),
          loadMapDecorations(session, map.id),
        ]);
        tileUrl = sheet.url;

        if (!active) {
          URL.revokeObjectURL(sheet.url);
          return;
        }

        if (!canvasRef.current) throw new Error('Canvas map chưa sẵn sàng.');
        drawTileMap(canvasRef.current, data, sheet.image);
        setMapData(data);
        setDecorations(mapDecorations);
        setTilePath(sheet.path);
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    run();

    return () => {
      active = false;
      if (tileUrl) URL.revokeObjectURL(tileUrl);
    };
  }, [session, map.id, tileId]);

  const nextZoom = (direction: 1 | -1) => {
    const currentIndex = ZOOMS.findIndex((value) => value === zoom);
    const index = clamp(currentIndex + direction, 0, ZOOMS.length - 1);
    setZoom(ZOOMS[index]);
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 overflow-hidden">
      <div className="h-10 px-2.5 border-b border-zinc-800 bg-zinc-900/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Move className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-[10px] font-bold text-zinc-200">Map trực quan</span>
          {mapData && (
            <span className="text-[8px] text-zinc-600 font-mono">
              {mapData.widthPx}×{mapData.heightPx}px · {mapData.widthTiles}×{mapData.heightTiles} tile
            </span>
          )}
          {tilePath && (
            <span className="hidden 2xl:inline text-[8px] text-zinc-600 font-mono truncate">
              {tilePath}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <LayerToggle active={showDecorations} onClick={() => setShowDecorations((v) => !v)} icon={<ImageIcon className="w-3 h-3" />} label="Trang trí" />
          <LayerToggle active={showNpc} onClick={() => setShowNpc((v) => !v)} icon={<Users className="w-3 h-3" />} label="NPC" />
          <LayerToggle active={showMob} onClick={() => setShowMob((v) => !v)} icon={<Bug className="w-3 h-3" />} label="Mob" />
          <LayerToggle active={showPortal} onClick={() => setShowPortal((v) => !v)} icon={<Signpost className="w-3 h-3" />} label="Cổng" />
          <LayerToggle active={showBoss} onClick={() => setShowBoss((v) => !v)} icon={<Crown className="w-3 h-3" />} label="Boss" />

          <div className="w-px h-5 bg-zinc-800 mx-0.5" />

          <button
            type="button"
            onClick={() => nextZoom(-1)}
            className="w-7 h-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200 flex items-center justify-center cursor-pointer"
            title="Thu nhỏ"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="w-9 text-center text-[9px] text-zinc-500 font-mono">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => nextZoom(1)}
            className="w-7 h-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200 flex items-center justify-center cursor-pointer"
            title="Phóng to"
          >
            <ZoomIn className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setLocked((value) => !value)}
            className={`h-7 px-2 rounded-md border text-[9px] font-mono flex items-center gap-1 cursor-pointer ${
              locked
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
            title={locked ? 'Bật kéo thả' : 'Khóa kéo thả'}
          >
            {locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            {locked ? 'Đã khóa' : 'Kéo thả'}
          </button>
        </div>
      </div>

      <div className="relative h-[540px] 2xl:h-[620px] overflow-auto bg-sky-100">
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/60">
            <div className="text-center text-[10px] text-zinc-400 font-mono">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-400" />
              Đang dựng tile-map thật...
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-red-950/20">
            <div className="max-w-lg p-3 rounded-md bg-zinc-900 border border-red-900/50 text-[10px] text-red-300 font-mono">
              <AlertTriangle className="w-4 h-4 inline mr-1.5" />
              {error}
            </div>
          </div>
        )}

        <div
          style={{
            width: (mapData?.widthPx ?? 1) * zoom,
            height: (mapData?.heightPx ?? 1) * zoom,
          }}
        >
          <div
            ref={worldRef}
            className="relative origin-top-left"
            style={{
              width: mapData?.widthPx ?? 1,
              height: mapData?.heightPx ?? 1,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0"
              style={{ imageRendering: 'pixelated' }}
            />

            {showDecorations &&
              decorations.map((decoration) => (
                <DecorationWorldImage
                  key={`decoration-${decoration.index}-${decoration.objectId}`}
                  session={session}
                  decoration={decoration}
                />
              ))}

            {showPortal &&
              waypoints.map((row, index) => (
                <DraggablePortal
                  key={`portal-${index}`}
                  row={row}
                  zoom={zoom}
                  locked={locked}
                  worldRef={worldRef}
                  maxX={mapData?.widthPx ?? 0}
                  maxY={mapData?.heightPx ?? 0}
                  onCommit={(next) =>
                    onWaypointsChange(
                      waypoints.map((value, i) => (i === index ? next : value))
                    )
                  }
                />
              ))}

            {showMob &&
              mobs.map((row, index) => (
                <DraggablePoint
                  key={`mob-${row.mobId}-${index}`}
                  x={row.x}
                  y={row.y}
                  zoom={zoom}
                  locked={locked}
                  worldRef={worldRef}
                  maxX={mapData?.widthPx ?? 0}
                  maxY={mapData?.heightPx ?? 0}
                  onCommit={(x, y) =>
                    onMobsChange(
                      mobs.map((value, i) => (i === index ? { ...value, x, y } : value))
                    )
                  }
                >
                  <MobWorldSprite
                    session={session}
                    mobId={row.mobId}
                    name={row.name}
                    level={row.level}
                  />
                </DraggablePoint>
              ))}

            {showNpc &&
              npcs.map((row, index) => (
                <DraggablePoint
                  key={`npc-${row.npcId}-${index}`}
                  x={row.x}
                  y={row.y}
                  zoom={zoom}
                  locked={locked}
                  worldRef={worldRef}
                  maxX={mapData?.widthPx ?? 0}
                  maxY={mapData?.heightPx ?? 0}
                  onCommit={(x, y) =>
                    onNpcsChange(
                      npcs.map((value, i) => (i === index ? { ...value, x, y } : value))
                    )
                  }
                >
                  <NpcWorldSprite
                    session={session}
                    head={row.head}
                    body={row.body}
                    leg={row.leg}
                    name={row.name}
                  />
                </DraggablePoint>
              ))}

            {showBoss &&
              bosses.map((boss) => {
                const y = surfaceYAtX(mapData, boss.spawnX);
                return (
                  <DraggablePoint
                    key={`boss-${boss.bossIndex}`}
                    x={boss.spawnX}
                    y={y}
                    zoom={zoom}
                    locked={locked || !onBossSpawnXChange}
                    worldRef={worldRef}
                    maxX={mapData?.widthPx ?? 0}
                    maxY={mapData?.heightPx ?? 0}
                    axis="x"
                    onCommit={(x) => onBossSpawnXChange?.(boss.bossIndex, x)}
                  >
                    <NpcWorldSprite
                      session={session}
                      head={boss.head}
                      body={boss.body}
                      leg={boss.leg}
                      name={boss.name}
                      boss
                    />
                  </DraggablePoint>
                );
              })}
          </div>
        </div>
      </div>

      <div className="h-8 px-2.5 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[8px] text-zinc-600 font-mono">
          <Legend className="bg-cyan-500" label="NPC" />
          <Legend className="bg-amber-500" label="Mob" />
          <Legend className="bg-blue-500" label="Cổng" />
          <Legend className="bg-rose-500" label="Boss" />
        </div>
        <span className="text-[8px] text-zinc-600 font-mono">
          {decorations.length} vật thể nền · Kéo NPC/mob/cổng để sửa tọa độ · Boss kéo ngang sửa spawnX
        </span>
      </div>
    </div>
  );
}

function DraggablePoint({
  x,
  y,
  zoom,
  locked,
  worldRef,
  maxX,
  maxY,
  axis = 'both',
  onCommit,
  children,
}: {
  x: number;
  y: number;
  zoom: number;
  locked: boolean;
  worldRef: React.RefObject<HTMLDivElement | null>;
  maxX: number;
  maxY: number;
  axis?: 'both' | 'x';
  onCommit: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const [preview, setPreview] = useState({ x, y });

  useEffect(() => setPreview({ x, y }), [x, y]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (locked || !worldRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const startWorld = worldPoint(event.clientX, event.clientY, worldRef.current, zoom);
    const offsetX = startWorld.x - preview.x;
    const offsetY = startWorld.y - preview.y;

    const move = (moveEvent: PointerEvent) => {
      if (!worldRef.current) return;
      const point = worldPoint(moveEvent.clientX, moveEvent.clientY, worldRef.current, zoom);
      setPreview({
        x: Math.round(clamp(point.x - offsetX, 0, maxX)),
        y:
          axis === 'x'
            ? preview.y
            : Math.round(clamp(point.y - offsetY, 0, maxY)),
      });
    };

    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!worldRef.current) return;
      const point = worldPoint(upEvent.clientX, upEvent.clientY, worldRef.current, zoom);
      const nextX = Math.round(clamp(point.x - offsetX, 0, maxX));
      const nextY =
        axis === 'x'
          ? y
          : Math.round(clamp(point.y - offsetY, 0, maxY));
      setPreview({ x: nextX, y: nextY });
      onCommit(nextX, nextY);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  return (
    <div
      className={`absolute z-20 ${locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
      style={{ left: preview.x, top: preview.y }}
      onPointerDown={startDrag}
      title={`X=${preview.x}, Y=${preview.y}`}
    >
      {children}
      {!locked && (
        <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-1 rounded bg-black/70 text-white text-[7px] font-mono whitespace-nowrap pointer-events-none">
          {preview.x},{preview.y}
        </span>
      )}
    </div>
  );
}

function DraggablePortal({
  row,
  zoom,
  locked,
  worldRef,
  maxX,
  maxY,
  onCommit,
}: {
  row: MapWaypoint;
  zoom: number;
  locked: boolean;
  worldRef: React.RefObject<HTMLDivElement | null>;
  maxX: number;
  maxY: number;
  onCommit: (row: MapWaypoint) => void;
}) {
  const [preview, setPreview] = useState(row);
  useEffect(() => setPreview(row), [row]);

  const width = Math.max(12, preview.x2 - preview.x1);
  const height = Math.max(12, preview.y2 - preview.y1);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (locked || !worldRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const start = worldPoint(event.clientX, event.clientY, worldRef.current, zoom);
    const offsetX = start.x - preview.x1;
    const offsetY = start.y - preview.y1;

    const makeNext = (clientX: number, clientY: number) => {
      if (!worldRef.current) return preview;
      const point = worldPoint(clientX, clientY, worldRef.current, zoom);
      const x1 = Math.round(clamp(point.x - offsetX, 0, Math.max(0, maxX - width)));
      const y1 = Math.round(clamp(point.y - offsetY, 0, Math.max(0, maxY - height)));
      return {
        ...preview,
        x1,
        y1,
        x2: x1 + width,
        y2: y1 + height,
      };
    };

    const move = (moveEvent: PointerEvent) => setPreview(makeNext(moveEvent.clientX, moveEvent.clientY));

    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const next = makeNext(upEvent.clientX, upEvent.clientY);
      setPreview(next);
      onCommit(next);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  return (
    <div
      className={`absolute z-10 border-2 border-blue-500/80 bg-blue-400/15 ${
        locked ? 'cursor-default' : 'cursor-move'
      }`}
      style={{
        left: preview.x1,
        top: preview.y1,
        width,
        height,
      }}
      onPointerDown={startDrag}
      title={`${preview.name} → map ${preview.destinationMapId}`}
    >
      <span className="absolute bottom-full left-0 mb-0.5 px-1 py-0.5 rounded bg-blue-600 text-white text-[7px] font-mono whitespace-nowrap pointer-events-none">
        {preview.name || `→ ${preview.destinationMapId}`}
      </span>
    </div>
  );
}

function DecorationWorldImage({
  session,
  decoration,
}: {
  session: LoadedJarSession;
  decoration: MapDecoration;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const entry = session.zip.file(`x1/mapBackGround/${decoration.imageId}.png`);

    if (!entry) {
      setUrl(null);
      return () => {
        active = false;
      };
    }

    entry.async('blob').then((blob: Blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, decoration.imageId]);

  if (!url) return null;

  const zIndex =
    decoration.layer >= 4 ? 35 :
    decoration.layer === 3 ? 16 :
    2;

  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className="absolute max-w-none pointer-events-none select-none"
      style={{
        left: decoration.x,
        top: decoration.y,
        zIndex,
        imageRendering: 'pixelated',
      }}
      title={`BgObject #${decoration.objectId} · image #${decoration.imageId} · layer ${decoration.layer}`}
    />
  );
}

function NpcWorldSprite({
  session,
  head,
  body,
  leg,
  name,
  boss = false,
}: {
  session: LoadedJarSession;
  head: number;
  body: number;
  leg: number;
  name: string;
  boss?: boolean;
}) {
  const [parts, setParts] = useState<LoadedPart[]>([]);
  const [composition, setComposition] = useState<NpcStandingComposition | null>(null);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];

    setParts([]);
    setComposition(null);

    const run = async () => {
      try {
        const resolved = await resolveNpcStandingComposition(session, head, body, leg);
        const placements = [resolved.head, resolved.leg, resolved.body];
        const loaded: LoadedPart[] = [];

        for (const placement of placements) {
          const image = await loadSmallImage(session, placement.imageId);
          const url = URL.createObjectURL(image.blob);
          urls.push(url);
          loaded.push({ placement, url });
        }

        if (!active) return;
        setComposition(resolved);
        setParts(loaded);
      } catch {
        // Entity vẫn còn hitbox/label nếu part không resolve được.
      }
    };

    run();
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [session, head, body, leg]);

  return (
    <div className="relative w-0 h-0 select-none">
      <div
        className={`absolute -left-[22px] -top-[58px] w-[44px] h-[62px] rounded border ${
          boss ? 'border-rose-400/60 bg-rose-400/5' : 'border-cyan-400/50 bg-cyan-400/5'
        }`}
      />
      {parts.map((part) => (
        <img
          key={`${part.placement.role}-${part.placement.imageId}`}
          src={part.url}
          alt=""
          draggable={false}
          className="absolute max-w-none pointer-events-none"
          style={{
            left: part.placement.drawX,
            top: part.placement.drawY,
            imageRendering: 'pixelated',
          }}
        />
      ))}
      <span
        className={`absolute left-1/2 -translate-x-1/2 -top-[72px] px-1 py-0.5 rounded text-[7px] font-semibold whitespace-nowrap pointer-events-none ${
          boss ? 'bg-rose-600 text-white' : 'bg-cyan-700 text-white'
        }`}
      >
        {name}
      </span>
      {!composition && (
        <span className="absolute -left-2 -top-2 w-4 h-4 rounded-full bg-cyan-500 border-2 border-white pointer-events-none" />
      )}
    </div>
  );
}

function MobWorldSprite({
  session,
  mobId,
  name,
  level,
}: {
  session: LoadedJarSession;
  mobId: number;
  name: string;
  level: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const entry = session.zip.file(`x1/mob/${mobId}/img.png`);
    if (!entry) {
      setUrl(null);
      return () => {
        active = false;
      };
    }

    entry.async('blob').then((blob: Blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, mobId]);

  return (
    <div className="relative w-0 h-0 select-none">
      <div className="absolute -left-[24px] -top-[48px] w-[48px] h-[52px] rounded border border-amber-400/60 bg-amber-400/5" />
      {url ? (
        <img
          src={url}
          alt={name}
          draggable={false}
          className="absolute -translate-x-1/2 -translate-y-full max-w-[64px] max-h-[64px] object-contain pointer-events-none"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <span className="absolute -left-2 -top-2 w-4 h-4 rounded-full bg-amber-500 border-2 border-white pointer-events-none" />
      )}
      <span className="absolute left-1/2 -translate-x-1/2 -top-[62px] px-1 py-0.5 rounded bg-amber-600 text-white text-[7px] font-semibold whitespace-nowrap pointer-events-none">
        {name} Lv{level}
      </span>
    </div>
  );
}

function LayerToggle({
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
      className={`h-7 px-2 rounded-md border text-[8px] font-mono flex items-center gap-1 cursor-pointer ${
        active
          ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
          : 'bg-zinc-950 border-zinc-800 text-zinc-600'
      }`}
    >
      {icon}
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

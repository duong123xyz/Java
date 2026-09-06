import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, UserRound } from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { loadSmallImage } from '../../services/smallImageService';
import {
  NpcStandingComposition,
  NpcStandingPartPlacement,
  resolveNpcStandingComposition,
} from '../../services/partDataService';

interface NpcBodyPreviewProps {
  session: LoadedJarSession;
  head: string | number;
  body: string | number;
  leg: string | number;
  alt: string;
  showTechnicalInfo?: boolean;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

interface LoadedPartImage {
  placement: NpcStandingPartPlacement;
  image: HTMLImageElement;
  objectUrl: string;
}

function parsePartId(value: string | number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} phải là Part ID nguyên không âm.`);
  }
  return parsed;
}

function loadHtmlImage(blob: Blob): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new window.Image();

    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không giải mã được PNG của part NPC.'));
    };
    image.src = objectUrl;
  });
}

async function loadPartImage(
  session: LoadedJarSession,
  placement: NpcStandingPartPlacement
): Promise<LoadedPartImage> {
  const result = await loadSmallImage(session, placement.imageId);
  const { image, objectUrl } = await loadHtmlImage(result.blob);
  return { placement, image, objectUrl };
}

async function renderNpcBody(
  session: LoadedJarSession,
  composition: NpcStandingComposition
): Promise<{ blob: Blob; urls: string[] }> {
  // Giữ đúng thứ tự vẽ của client a.bV: head -> leg -> body.
  const placements = [composition.head, composition.leg, composition.body];
  const loaded = await Promise.all(
    placements.map((placement) => loadPartImage(session, placement))
  );

  try {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const part of loaded) {
      minX = Math.min(minX, part.placement.drawX);
      minY = Math.min(minY, part.placement.drawY);
      maxX = Math.max(maxX, part.placement.drawX + part.image.naturalWidth);
      maxY = Math.max(maxY, part.placement.drawY + part.image.naturalHeight);
    }

    const logicalWidth = Math.max(1, maxX - minX);
    const logicalHeight = Math.max(1, maxY - minY);
    const scale = 4;
    const padding = 5;

    const canvas = document.createElement('canvas');
    canvas.width = (logicalWidth + padding * 2) * scale;
    canvas.height = (logicalHeight + padding * 2) * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Trình duyệt không tạo được canvas để ghép NPC.');

    ctx.imageSmoothingEnabled = false;

    for (const part of loaded) {
      const x = (part.placement.drawX - minX + padding) * scale;
      const y = (part.placement.drawY - minY + padding) * scale;
      ctx.drawImage(
        part.image,
        x,
        y,
        part.image.naturalWidth * scale,
        part.image.naturalHeight * scale
      );
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('Không xuất được ảnh full-body NPC từ canvas.'));
      }, 'image/png');
    });

    return {
      blob,
      urls: loaded.map((part) => part.objectUrl),
    };
  } catch (error) {
    for (const part of loaded) URL.revokeObjectURL(part.objectUrl);
    throw error;
  }
}

export function NpcBodyPreview({
  session,
  head,
  body,
  leg,
  alt,
  showTechnicalInfo = false,
  title = 'Toàn thân NPC',
  subtitle = 'Ghép đúng Part Data + SmallImage + offset đứng của client',
  compact = false,
}: NpcBodyPreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [composition, setComposition] = useState<NpcStandingComposition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let previewUrl: string | null = null;
    let partObjectUrls: string[] = [];

    setLoading(true);
    setError(null);
    setImageUrl(null);
    setComposition(null);

    const run = async () => {
      try {
        const headId = parsePartId(head, 'Head');
        const bodyId = parsePartId(body, 'Body');
        const legId = parsePartId(leg, 'Leg');

        const resolved = await resolveNpcStandingComposition(
          session,
          headId,
          bodyId,
          legId
        );
        const rendered = await renderNpcBody(session, resolved);
        partObjectUrls = rendered.urls;

        if (!active) {
          for (const url of partObjectUrls) URL.revokeObjectURL(url);
          return;
        }

        previewUrl = URL.createObjectURL(rendered.blob);
        setComposition(resolved);
        setImageUrl(previewUrl);
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
        for (const url of partObjectUrls) URL.revokeObjectURL(url);
        partObjectUrls = [];
      }
    };

    run();

    return () => {
      active = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      for (const url of partObjectUrls) URL.revokeObjectURL(url);
    };
  }, [session, head, body, leg]);

  return (
    <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 overflow-hidden">
      <div className={`${compact ? 'px-3 py-1.5' : 'px-3 py-2'} border-b border-zinc-800 bg-zinc-900/80`}>
        <div className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-zinc-100`}>{title}</div>
        {!compact && subtitle && (
          <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
            {subtitle}
          </div>
        )}
      </div>

      <div className={`${compact ? 'p-2 space-y-2' : 'p-3 space-y-3'}`}>
        <div className={`${compact ? 'min-h-[180px]' : 'min-h-[240px]'} rounded-lg border border-zinc-800 bg-zinc-900 flex items-center justify-center ${compact ? 'p-2' : 'p-4'}`}>
          {loading ? (
            <div className="text-center text-zinc-500 text-xs font-mono space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-cyan-400" />
              <div>Đang ghép head / body / leg...</div>
            </div>
          ) : error ? (
            <div className="max-w-sm text-center text-amber-300 text-xs font-mono space-y-2">
              <AlertTriangle className="w-6 h-6 mx-auto" />
              <div>{error}</div>
            </div>
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={alt}
              className="max-h-56 max-w-full object-contain"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <UserRound className="w-10 h-10 text-zinc-700" />
          )}
        </div>

        {showTechnicalInfo && composition && (
          <div className="grid grid-cols-1 gap-1 text-[10px] font-mono text-zinc-500">
            <div>
              head #{composition.head.partId} → SmallImage #{composition.head.imageId} · frame {composition.head.frameIndex}
            </div>
            <div>
              body #{composition.body.partId} → SmallImage #{composition.body.imageId} · frame {composition.body.frameIndex}
            </div>
            <div>
              leg #{composition.leg.partId} → SmallImage #{composition.leg.imageId} · frame {composition.leg.frameIndex}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

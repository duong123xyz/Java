import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, UserRound } from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { loadSmallImage } from '../../services/smallImageService';
import {
  NpcStandingComposition,
  NpcStandingPartPlacement,
  resolveNpcStandingComposition,
} from '../../services/partDataService';

interface CharacterSpritePreviewProps {
  session: LoadedJarSession;
  head: number;
  body: number;
  leg: number;
  name: string;
  subtitle?: string;
  compact?: boolean;
  showTechnicalInfo?: boolean;
}

interface LoadedPartImage {
  placement: NpcStandingPartPlacement;
  image: HTMLImageElement;
  objectUrl: string;
}

function loadHtmlImage(blob: Blob): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new window.Image();

    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không giải mã được PNG part nhân vật.'));
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

async function renderCharacter(
  session: LoadedJarSession,
  composition: NpcStandingComposition
): Promise<{ blob: Blob; urls: string[] }> {
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
    if (!ctx) throw new Error('Không tạo được canvas render nhân vật.');

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
        else reject(new Error('Không xuất được ảnh nhân vật.'));
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

export function CharacterSpritePreview({
  session,
  head,
  body,
  leg,
  name,
  subtitle,
  compact = false,
  showTechnicalInfo = false,
}: CharacterSpritePreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [composition, setComposition] = useState<NpcStandingComposition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let previewUrl: string | null = null;
    let tempUrls: string[] = [];

    setLoading(true);
    setError(null);
    setImageUrl(null);
    setComposition(null);

    const run = async () => {
      try {
        const resolved = await resolveNpcStandingComposition(session, head, body, leg);
        const rendered = await renderCharacter(session, resolved);
        tempUrls = rendered.urls;

        if (!active) {
          tempUrls.forEach((url) => URL.revokeObjectURL(url));
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
        tempUrls.forEach((url) => URL.revokeObjectURL(url));
        tempUrls = [];
      }
    };

    run();

    return () => {
      active = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      tempUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [session, head, body, leg]);

  return (
    <div className={`rounded-2xl border border-zinc-200 bg-white overflow-hidden ${compact ? '' : 'shadow-sm'}`}>
      {!compact && (
        <div className="px-4 py-3 border-b border-zinc-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <div>
              <div className="text-sm font-bold text-zinc-900">{name}</div>
              {subtitle && <div className="text-[11px] text-zinc-500">{subtitle}</div>}
            </div>
          </div>
        </div>
      )}

      <div className={`${compact ? 'p-2' : 'p-4'} space-y-2`}>
        <div className={`${compact ? 'h-[88px]' : 'h-[240px]'} rounded-xl border border-zinc-200 bg-[radial-gradient(circle_at_top,_#eef2ff,_#f8fafc_60%,_#ffffff)] flex items-center justify-center`}>
          {loading ? (
            <div className="text-center text-[10px] text-zinc-500 font-mono space-y-2">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-400" />
              <div>Đang ghép sprite...</div>
            </div>
          ) : error ? (
            <div className="max-w-[220px] text-center text-[10px] text-amber-700 space-y-1">
              <AlertTriangle className="w-5 h-5 mx-auto" />
              <div>{error}</div>
            </div>
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={name}
              className={compact ? 'max-h-[74px] max-w-full object-contain' : 'max-h-[200px] max-w-full object-contain'}
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <UserRound className="w-10 h-10 text-zinc-300" />
          )}
        </div>

        {showTechnicalInfo && composition && (
          <div className="grid gap-1 text-[10px] text-zinc-500 font-mono">
            <div>head #{composition.head.partId} → img #{composition.head.imageId}</div>
            <div>body #{composition.body.partId} → img #{composition.body.imageId}</div>
            <div>leg #{composition.leg.partId} → img #{composition.leg.imageId}</div>
          </div>
        )}
      </div>
    </div>
  );
}

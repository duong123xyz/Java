import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2, AlertTriangle } from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { loadSmallImage, SmallImageLocation } from '../../services/smallImageService';

interface SmallImagePreviewProps {
  session: LoadedJarSession;
  imageId: string | number | null | undefined;
  alt: string;
  variant?: 'icon' | 'medium' | 'hero';
  showTechnicalInfo?: boolean;
  className?: string;
}

function parseImageId(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function SmallImagePreview({
  session,
  imageId,
  alt,
  variant = 'icon',
  showTechnicalInfo = false,
  className = '',
}: SmallImagePreviewProps) {
  const parsedId = parseImageId(imageId);
  const [url, setUrl] = useState<string | null>(null);
  const [location, setLocation] = useState<SmallImageLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(parsedId !== null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setUrl(null);
    setLocation(null);
    setError(null);

    if (parsedId === null) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);

    loadSmallImage(session, parsedId)
      .then((result) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(result.blob);
        setUrl(objectUrl);
        setLocation(result.location);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, parsedId]);

  const wrapperClass =
    variant === 'hero'
      ? 'min-h-[210px] p-4'
      : variant === 'medium'
      ? 'w-24 h-24 p-2'
      : 'w-12 h-12 p-1.5';

  const imageClass =
    variant === 'hero'
      ? 'max-h-48 max-w-full'
      : variant === 'medium'
      ? 'max-h-20 max-w-20'
      : 'max-h-10 max-w-10';

  return (
    <div className={className}>
      <div
        className={`${wrapperClass} rounded-lg border border-zinc-800 bg-zinc-900 flex items-center justify-center overflow-hidden`}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
        ) : url ? (
          <img
            src={url}
            alt={alt}
            className={`${imageClass} object-contain`}
            style={{ imageRendering: 'pixelated' }}
          />
        ) : error ? (
          <div className="text-center px-2">
            <AlertTriangle className="w-5 h-5 text-amber-400 mx-auto" />
            {variant === 'hero' && (
              <div className="text-[10px] text-zinc-500 font-mono mt-2 max-w-xs">
                {error}
              </div>
            )}
          </div>
        ) : (
          <ImageIcon className="w-5 h-5 text-zinc-600" />
        )}
      </div>

      {showTechnicalInfo && (
        <div className="mt-2 text-[10px] text-zinc-500 font-mono break-all">
          {parsedId === null ? (
            'Không có SmallImage ID hợp lệ.'
          ) : location ? (
            <>
              SmallImage #{parsedId} → {location.packPath} @ {location.offset} + {location.length} bytes
            </>
          ) : (
            <>SmallImage #{parsedId}</>
          )}
        </div>
      )}
    </div>
  );
}

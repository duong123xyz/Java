import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2, AlertTriangle } from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';

interface JarImagePreviewProps {
  session: LoadedJarSession;
  path: string;
  alt: string;
  variant?: 'icon' | 'medium' | 'wide';
  showPath?: boolean;
  className?: string;
}

export function JarImagePreview({
  session,
  path,
  alt,
  variant = 'icon',
  showPath = false,
  className = '',
}: JarImagePreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setUrl(null);
    setError(false);
    setLoading(true);

    const entry = session.zip.file(path);
    if (!entry) {
      setLoading(false);
      setError(true);
      return () => {
        active = false;
      };
    }

    entry
      .async('blob')
      .then((blob: Blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, path]);

  const boxClass =
    variant === 'wide'
      ? 'w-full h-44 p-3'
      : variant === 'medium'
      ? 'w-24 h-24 p-2'
      : 'w-12 h-12 p-1.5';

  const imageClass =
    variant === 'wide'
      ? 'max-h-40 max-w-full'
      : variant === 'medium'
      ? 'max-h-20 max-w-20'
      : 'max-h-10 max-w-10';

  return (
    <div className={className}>
      <div
        className={`${boxClass} rounded-lg border border-zinc-800 bg-zinc-900 flex items-center justify-center overflow-hidden`}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
        ) : url ? (
          <img
            src={url}
            alt={alt}
            className={`${imageClass} object-contain`}
            style={{ imageRendering: 'pixelated' }}
          />
        ) : error ? (
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        ) : (
          <ImageIcon className="w-5 h-5 text-zinc-600" />
        )}
      </div>

      {showPath && (
        <div className="mt-1 text-[9px] text-zinc-600 font-mono truncate" title={path}>
          {path}
        </div>
      )}
    </div>
  );
}

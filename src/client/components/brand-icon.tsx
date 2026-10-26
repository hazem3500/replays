import { LinkIcon } from 'lucide-react';

import { cn } from '@/lib/utils.ts';

import { sourceLook } from '../source-looks.ts';

/*
 * Marks, 14 px by default, all drawn in currentColor so they follow the theme:
 * - `product`: the neutral mark of this app (a play triangle in a rounded square). A deployment replaces it with
 *   its own logo through `productLogo()` (config.ts) where the header shows one.
 * - `github`: Octicons `mark-github` (16 px grid), MIT licence, github.com/primer/octicons.
 * - `link`: a plain link glyph for every other source provider.
 * A provider that declares its own `icon` (source-looks.ts) is drawn as that image instead: an <img>, never inline markup.
 */

export type Brand = 'product' | 'github' | 'link';

/** The mark for a source provider (`github`, else a link glyph). */
export function brandForProvider(provider: string): Brand {
  return provider === 'github' ? 'github' : 'link';
}

export function BrandIcon({ brand = 'product', size = 14, className }: { brand?: Brand; size?: number; className?: string }) {
  const props = { width: size, height: size, className: cn('brand-icon', `brand-icon-${brand}`, className), 'aria-hidden': true as const };
  // A filled brand silhouette must not inherit the toolbar's outline stroke.
  if (brand === 'github')
    return (
      <svg viewBox="0 0 16 16" {...props}>
        <path
          fill="currentColor"
          stroke="none"
          d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
        />
      </svg>
    );
  if (brand === 'link') return <LinkIcon {...props} />;
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path fill="currentColor" d="M9.5 7.6v8.8a.6.6 0 0 0 .9.5l7.2-4.4a.6.6 0 0 0 0-1l-7.2-4.4a.6.6 0 0 0-.9.5Z" />
    </svg>
  );
}

/** The mark of a source's provider: its declared icon, else the built-in mark. */
export function SourceIcon({ provider, size, className }: { provider: string; size?: number; className?: string }) {
  const icon = sourceLook(provider)?.icon;
  if (icon)
    return (
      <img
        src={icon}
        alt=""
        width={size ?? 14}
        height={size ?? 14}
        className={cn('brand-icon brand-icon-image', className)}
        data-provider-icon={provider}
        referrerPolicy="no-referrer"
        decoding="async"
        draggable={false}
      />
    );
  return <BrandIcon brand={brandForProvider(provider)} {...(size ? { size } : {})} {...(className ? { className } : {})} />;
}

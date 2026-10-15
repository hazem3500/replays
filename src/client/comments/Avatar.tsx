import { useState } from 'react';

import { cn } from '@/lib/utils.ts';

/** Up to two initials; "?" for a name with none (anonymous). */
export function initialsOf(name: string) {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]!].slice(0, 2) : [[...words[0]!][0], [...words.at(-1)!][0]];
  return letters.join('').toLocaleUpperCase();
}

/** A stable hue (0–359) per name, so one person keeps one colour across the bar and the panel. */
export function hueOf(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % 360;
}

/**
 * A person's avatar image, or their initials on a tinted disc (also when the image does not load). Anonymous authors
 * get a neutral disc. Decorative: the name is always written next to it.
 */
export function Avatar({
  name,
  avatarUrl,
  anonymous = false,
  className,
}: {
  name: string;
  avatarUrl?: string | undefined;
  anonymous?: boolean | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = avatarUrl && !failed && !anonymous;
  return (
    <span
      className={cn('comment-avatar', className)}
      data-anonymous={anonymous || undefined}
      aria-hidden="true"
      style={image || anonymous ? undefined : ({ '--avatar-hue': hueOf(name) } as React.CSSProperties)}
    >
      {image ? (
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        initialsOf(anonymous ? '' : name)
      )}
    </span>
  );
}

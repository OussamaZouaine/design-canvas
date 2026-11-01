import type { ReactNode } from 'react';

// Empty-state illustration shared by the home and Comments pages: a fan of three project cards (the front one sketches a tiny board) with the state's
// icon in a badge. Inline SVG drawn with theme tokens via var(), so it follows light/dark without separate assets.
// Decorative only (aria-hidden): the title and description below carry the meaning.
export function EmptyArt({ icon }: { icon: ReactNode }) {
  // Back cards take the grey shell tone so the fan reads against the white sheet; in dark the shell is darker than
  // the sheet (they would look sunk), so they use the lighter muted tone there. The front card stays the card colour.
  const back = { className: 'fill-home dark:fill-muted', stroke: 'var(--border)' };
  const ink = { fill: 'var(--muted)' };
  return (
    <div aria-hidden className="relative">
      <svg width="168" height="112" viewBox="0 0 168 112" fill="none" className="overflow-visible">
        <defs>
          {/* Soft drop shadow lifts the front card off the fan (feDropShadow = SVG's box-shadow). */}
          <filter id="dc-empty-lift" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="black" floodOpacity="0.12" />
          </filter>
        </defs>
        {/* Back cards, rotated around their bottom centre so they fan out behind the front one. */}
        <rect x="34" y="18" width="100" height="72" rx="10" {...back} transform="rotate(-10 84 90)" />
        <rect x="34" y="18" width="100" height="72" rx="10" {...back} transform="rotate(10 84 90)" />
        <rect x="34" y="14" width="100" height="76" rx="10" fill="var(--card)" stroke="var(--border)" filter="url(#dc-empty-lift)" />
        {/* A tiny "board": header bar, two text lines, two tiles, in the brand colour at low strength for one accent. */}
        <rect x="44" y="24" width="80" height="8" rx="3" {...ink} />
        <rect x="44" y="38" width="52" height="5" rx="2.5" {...ink} />
        <rect x="44" y="47" width="36" height="5" rx="2.5" {...ink} />
        <rect x="44" y="60" width="38" height="20" rx="4" style={{ fill: 'var(--brand)', opacity: 0.12 }} />
        <rect x="86" y="60" width="38" height="20" rx="4" {...ink} />
      </svg>
      <span className="absolute right-6 -bottom-2 grid size-9 place-items-center rounded-full border bg-background text-muted-foreground shadow-float">{icon}</span>
    </div>
  );
}

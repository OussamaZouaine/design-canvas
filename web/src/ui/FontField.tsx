import { ChevronDown } from 'lucide-react';
import type { ProjectFont } from '@/api/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Common OS fonts an agent can use without use_font (mirrors SYSTEM_FAMILIES in src/fonts.mjs, minus emoji faces).
const SYSTEM = ['Segoe UI', 'Helvetica Neue', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino', 'Cambria', 'Menlo', 'Consolas', 'Courier New'];
const GENERIC = ['system-ui', 'sans-serif', 'serif', 'monospace'];

// The first family of a font-family stack, unquoted: that is the name a person thinks of as "the font".
export const primaryFamily = (stack: string) => (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');

// The font-family value to store for a picked name: the name plus a generic fallback guessed from it. The old
// stack's fallback is deliberately not reused (Fraunces to Inter must not keep a serif fallback). Known
// project fonts get a better guess from use_font's own stack, which the author can still edit in the Stack row.
function stackFor(name: string): string {
  if (GENERIC.includes(name)) return name;
  const generic = /mono|code|courier|consolas|menlo/i.test(name) ? 'monospace' : /georgia|times|palatino|cambria|fraunces|playfair|newsreader|serif/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif';
  return `"${name}", ${generic}`;
}

interface Props {
  value: string; // the raw font-family stack set on the node ('' when inherited)
  resolved: string; // `value` (or `inherited`) with a var(--token) replaced by its real stack; dimmed when inherited
  projectFonts: ProjectFont[];
  onChange: (stack: string) => void;
}

// Font picker: a trigger showing the real family name in its own face, and a menu whose rows are drawn in
// their own faces. Project fonts are already loaded in the document head (canvas/fonts.ts), and this panel
// lives in the same document, so a plain font-family style is enough: no extra @font-face needed here.
export function FontField({ value, resolved, projectFonts, onChange }: Props) {
  const name = primaryFamily(resolved);
  const own = value !== '';
  const loaded = new Set(projectFonts.map((f) => f.family));
  // A family used by the node but absent from every list (typed by Claude) must still be selectable/visible.
  const extra = name && !loaded.has(name) && !SYSTEM.includes(name) && !GENERIC.includes(name) ? [name] : [];

  const item = (n: string) => (
    <DropdownMenuItem key={n} onClick={() => onChange(stackFor(n))} className={cn('text-xs', n === name && 'bg-muted')}>
      <span style={{ fontFamily: GENERIC.includes(n) ? n : `"${n}", sans-serif` }}>{n}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Font family"
        title={resolved || 'Font family'}
        className="flex h-7 w-full min-w-0 items-center rounded-md bg-field text-xs outline-none transition-colors duration-150 pointer-hover:bg-field-hover focus-visible:ring-1 focus-visible:ring-selection"
      >
        <span className="min-w-6 shrink-0 select-none px-1.5 text-center text-muted-foreground">Font</span>
        <span className={cn('min-w-0 flex-1 truncate text-left', !own && 'text-muted-foreground')} style={resolved ? { fontFamily: resolved } : undefined}>
          {name || '—'}
        </span>
        <ChevronDown className="mr-1.5 size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72">
        {(projectFonts.length > 0 || extra.length > 0) && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Project fonts</DropdownMenuLabel>
            {[...projectFonts.map((f) => f.family), ...extra].map(item)}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>System</DropdownMenuLabel>
          {[...GENERIC, ...SYSTEM].map(item)}
        </DropdownMenuGroup>
        {own && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange('')} className="text-xs text-muted-foreground">Inherit</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

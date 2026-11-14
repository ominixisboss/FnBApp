// Card-text symbols ({r}, {p}, {d}, {h}, {i}, {t}, {u}, {c}) shown as small labelled icons, or as plain words.
import { Fragment } from 'react';

const SYMBOLS: Record<string, { icon: string; word: string; cls: string }> = {
  r: { icon: '⛀', word: 'resource', cls: 'res' },
  c: { icon: '◆', word: 'chi', cls: 'chi' },
  p: { icon: '⚔', word: 'power', cls: 'pow' },
  d: { icon: '🛡', word: 'defense', cls: 'def' },
  h: { icon: '♥', word: 'life', cls: 'life' },
  i: { icon: '✋', word: 'intellect', cls: 'int' },
  t: { icon: '⤵', word: 'tap', cls: 'tap' },
  u: { icon: '⤴', word: 'untap', cls: 'tap' },
  x: { icon: 'X', word: 'X', cls: 'x' },
};

/** Plain text for titles, screen readers and buttons: "Gain 1{h}" -> "Gain 1 life" */
export function readable(t: string): string {
  return t.replace(/\{([a-z])\}/g, (m, k: string) => (SYMBOLS[k] ? ` ${SYMBOLS[k].word} ` : m)).replace(/ {2,}/g, ' ').replace(/ ([.,:;)])/g, '$1').trim();
}

/** Text with its symbols drawn as icons (each with a word for screen readers). */
export function SymText({ text }: { text: string }) {
  const parts = text.split(/(\{[a-z]\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\{([a-z])\}$/);
        const sym = m && SYMBOLS[m[1]];
        if (!sym) return <Fragment key={i}>{part}</Fragment>;
        return <span key={i} className={`sym sym-${sym.cls}`} role="img" aria-label={sym.word} title={sym.word}>{sym.icon}</span>;
      })}
    </>
  );
}

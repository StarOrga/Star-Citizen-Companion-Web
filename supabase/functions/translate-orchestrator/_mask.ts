// Placeholder masking for game strings (contract: docs/translation/ARCHITECTURE.md § QA gates).
// Every in-string token (`~word(...)`, `<EM1>`, `<…>`, `%s`, literal `\n`, `[...]`) becomes
// `⟦n⟧` before a string reaches the model and is restored afterwards; the restored text must
// carry exactly the source's token multiset. Plain, erasable TypeScript (node --test + Deno).

const PLACEHOLDER_SRC = '~\\w+\\([^)]*\\)|<\\/?EM\\d>|<[^>]+>|%l?[sSdif]|\\\\n|\\[[^\\]]*\\]';

/** A fresh global regex per call — a shared /g regex keeps lastIndex between uses. */
export function placeholderRe(): RegExp {
  return new RegExp(PLACEHOLDER_SRC, 'g');
}

export interface Masked {
  /** Text with ⟦1⟧, ⟦2⟧ … in place of the tokens. */
  m: string;
  /** The original tokens, index n-1 for ⟦n⟧. */
  toks: string[];
}

export function mask(s: string): Masked {
  const toks: string[] = [];
  const m = s.replace(placeholderRe(), (x) => {
    toks.push(x);
    return `⟦${toks.length}⟧`;
  });
  return { m, toks };
}

/** Restores ⟦n⟧ to the original tokens; an unknown index stays visible (and fails the check). */
export function unmask(s: string, toks: string[]): string {
  return s.replace(/⟦(\d+)⟧/g, (_, n) => toks[Number(n) - 1] ?? `⟦${n}⟧`);
}

/** Every token of `s` (the multiset as a list), in order of appearance. */
export function tokensOf(s: string): string[] {
  return s.match(placeholderRe()) ?? [];
}

export function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

/** Masked output uses each ⟦n⟧ of the source exactly once and no real CR/LF. */
export function maskedOutputOk(out: string, toks: string[]): boolean {
  if (/[\r\n]/.test(out)) return false;
  const got = out.match(/⟦\d+⟧/g) ?? [];
  const want = toks.map((_, i) => `⟦${i + 1}⟧`);
  return sameMultiset(got, want);
}

/**
 * Text helpers safe to use anywhere (server, browser, sync jobs).
 * Kept free of heavy dependencies so client components can import them.
 */

/** Words kept lower-case inside a title (English and Spanish/Portuguese/French). */
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'with',
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para', 'por', 'con', 'al', 'da', 'do', 'dos', 'das', 'et', 'du', 'des', 'le',
]);
const ROMAN = /^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

/**
 * 'private university' -> 'Private University'; 'Public, 4-year or above' ->
 * 'Public, 4-Year or Above'. Keeps acronyms (IT, UPN), roman numerals and
 * tokens with digits or dots (A.C., 2-year) sensible.
 */
export function titleCase(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = text.trim().replace(/\s+/g, ' ').split(' ');
  return words
    .map((word, i) => {
      // Hyphenated parts are cased separately: '4-year' -> '4-Year'.
      return word
        .split('-')
        .map((part, j) => {
          const bare = part.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
          if (!bare) return part;
          if (ROMAN.test(bare) && bare.length > 1) return part.toUpperCase();
          if (/[.\d]/.test(bare)) return part; // 'A.C.', '5/1', '2nd': keep as written
          if (bare.length <= 4 && bare === bare.toUpperCase() && /\p{Lu}/u.test(bare)) return part; // acronym
          const lower = part.toLowerCase();
          const isFirst = i === 0 && j === 0;
          const afterParen = /^[(“"']/.test(part);
          if (!isFirst && !afterParen && SMALL_WORDS.has(bare.toLowerCase())) return lower;
          const k = lower.search(/\p{L}/u);
          return k < 0 ? lower : lower.slice(0, k) + lower.charAt(k).toUpperCase() + lower.slice(k + 1);
        })
        .join('-');
    })
    .join(' ');
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'at', 'for', 'of', 'and', 'with', 'to', 'in', 'on', 'my', 'our', 'from', 'by',
]);

/** Lowercase, strip punctuation/digits, drop stopwords and 1-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/'s$/, '').replace(/^'+|'+$/g, ''))
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  sa.forEach(t => {
    if (sb.has(t)) inter++;
  });
  return inter / (sa.size + sb.size - inter);
}

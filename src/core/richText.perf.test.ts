import { describe, expect, it } from 'vitest';
import { MAX_PARSED_LENGTH, parseRichText } from './richText';

// Worst cases for the link detector. Before the fix these took 0.2–1.3 s on V8 (more on Hermes).
const time = (s: string) => {
  const t = Date.now();
  parseRichText(s);
  return Date.now() - t;
};

describe('parseRichText stays fast on hostile input', () => {
  const n = MAX_PARSED_LENGTH - 1;
  it.each([
    ['one long word', 'a'.repeat(n)],
    ['dotted run', 'a.'.repeat(n / 2)],
    ['base64 blob', 'QUJD'.repeat(n / 4)],
    ['unclosed markers', ' *a'.repeat(n / 3)],
  ])('%s', (_name, text) => {
    expect(time(text)).toBeLessThan(150);
  });

  it('does not parse beyond the cap', () => {
    const big = 'see www.example.com '.repeat(2000);
    expect(big.length).toBeGreaterThan(MAX_PARSED_LENGTH);
    expect(parseRichText(big)).toEqual([{ text: big }]);
  });

  it('still links normal text', () => {
    const urls = parseRichText('mail sam@acme.com or visit acme.com/help, thanks').filter((s) => s.url).map((s) => s.url);
    expect(urls).toEqual(['mailto:sam@acme.com', 'https://acme.com/help']);
  });
});

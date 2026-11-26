import { describe, expect, it } from 'vitest';
import { isFlick, resisted } from './newChatPullMath';

describe('resisted', () => {
  it('follows the finger for the first 24px', () => {
    expect(resisted(0)).toBe(0);
    expect(resisted(12)).toBe(12);
    expect(resisted(24)).toBe(24);
  });

  it('lags behind the finger past the follow zone', () => {
    expect(resisted(48)).toBeLessThan(48);
    expect(resisted(48)).toBeGreaterThan(24);
  });

  it('reaches the commit threshold around 120px of finger travel', () => {
    expect(resisted(100)).toBeLessThan(76);
    expect(resisted(120)).toBeGreaterThanOrEqual(76);
    expect(resisted(120)).toBeLessThan(88);
  });

  it('gains less distance as the pull grows', () => {
    const early = resisted(60) - resisted(40);
    const late = resisted(160) - resisted(140);
    expect(late).toBeLessThan(early);
  });

  it('never goes negative', () => {
    expect(resisted(-20)).toBe(0);
  });
});

describe('isFlick', () => {
  it('treats slow upward moves as deliberate pulls', () => {
    expect(isFlick(16, 0.2)).toBe(false);
    expect(isFlick(40, 0.7)).toBe(false);
  });

  it('treats a fast upward move as a flick', () => {
    expect(isFlick(16, 0.71)).toBe(true);
    expect(isFlick(80, 1.5)).toBe(true);
  });
});

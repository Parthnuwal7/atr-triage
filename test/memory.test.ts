import { describe, it, expect } from 'vitest';
import { formatMemory, NOT_POINT_IN_TIME_NOTE } from '../src/extract/memory.js';

describe('formatMemory', () => {
  it('renders key: value lines', () => {
    expect(formatMemory([{ key: 'pref_currency', value: 'INR' }, { key: 'tone', value: 'concise' }]))
      .toBe('pref_currency: INR\ntone: concise');
  });
  it('handles value-only rows', () => {
    expect(formatMemory([{ value: 'user prefers Flipkart National' }])).toBe('user prefers Flipkart National');
  });
  it('returns empty string for no rows', () => {
    expect(formatMemory([])).toBe('');
  });
  it('exposes the point-in-time caveat', () => {
    expect(NOT_POINT_IN_TIME_NOTE).toMatch(/current/i);
  });
});

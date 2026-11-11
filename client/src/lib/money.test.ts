import { describe, expect, it } from 'vitest';
import { amountError, cleanAmount, formatMoney, isZero, monthRange, todayYmd } from './money';

describe('formatMoney', () => {
  it('formats decimal strings exactly, without float rounding', () => {
    // 0.1 + 0.2 style values and long amounts survive intact.
    expect(formatMoney('1234567890123.45', 'USD', { display: 'code' }).replace(/\s/g, ' ')).toContain('1,234,567,890,123.45');
    expect(formatMoney('0.30', 'USD')).toContain('0.30');
  });

  it('signs income and expenses and handles negatives', () => {
    expect(formatMoney('50.00', 'GHS', { sign: '+' }).startsWith('+')).toBe(true);
    expect(formatMoney('50.00', 'GHS', { sign: '-' }).startsWith('−')).toBe(true);
    expect(formatMoney('-12.50', 'GHS').startsWith('−')).toBe(true);
  });

  it('respects zero-decimal currencies', () => {
    expect(formatMoney('1500', 'JPY')).not.toContain('.');
  });
});

describe('amount validation', () => {
  it('checks format, zero and per-currency decimals', () => {
    expect(amountError('', 'GHS')).toMatch(/Enter an amount/);
    expect(amountError('12.5.0', 'GHS')).toMatch(/like/);
    expect(amountError('0.00', 'GHS')).toMatch(/more than zero/);
    expect(amountError('10.555', 'GHS')).toMatch(/at most 2/);
    expect(amountError('100.5', 'JPY')).toMatch(/no decimal/);
    expect(amountError('1.125', 'BHD')).toBeNull();
    expect(amountError('1250.50', 'GHS')).toBeNull();
  });

  it('cleans pasted grouping separators', () => {
    expect(cleanAmount('1,250.00')).toBe('1250.00');
    expect(cleanAmount(' 3 000 ')).toBe('3000');
  });

  it('detects zero', () => {
    expect(isZero('0.00')).toBe(true);
    expect(isZero('-0')).toBe(true);
    expect(isZero('0.01')).toBe(false);
  });
});

describe('dates', () => {
  it('uses the local calendar day and month bounds', () => {
    expect(todayYmd(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(monthRange(new Date(2026, 1, 10))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(new Date(2028, 1, 10)).to).toBe('2028-02-29');
  });
});

import { describe, expect, it } from 'vitest';
import { add, convert, fitsCurrency, invertRate, minorUnits, normalize } from '../utils/money.js';
import { csvCell, toCsv } from '../modules/transactions/csv.js';
import { sniffType } from '../modules/transactions/attachments.service.js';

describe('money arithmetic', () => {
  it('is exact where binary floating point is not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(add('0.1', '0.2').toString()).toBe('0.3');
    expect(add('1000000000000.01', '0.02').toString()).toBe('1000000000000.03');
  });

  it('knows each currency’s minor units', () => {
    expect(minorUnits('GHS')).toBe(2);
    expect(minorUnits('JPY')).toBe(0);
    expect(minorUnits('BHD')).toBe(3);
    expect(fitsCurrency('10.5', 'GHS')).toBe(true);
    expect(fitsCurrency('10.555', 'GHS')).toBe(false);
    expect(fitsCurrency('100.5', 'JPY')).toBe(false);
    expect(fitsCurrency('1.125', 'BHD')).toBe(true);
  });

  it('normalises to the currency’s decimal places', () => {
    expect(normalize('12', 'GHS')).toBe('12.00');
    expect(normalize('12', 'BHD')).toBe('12.000');
    expect(normalize('-4.5', 'USD')).toBe('-4.50');
  });

  it('converts and rounds half-up to the target currency', () => {
    expect(convert('100', '15.4321', 'GHS')).toBe('1543.21');
    expect(convert('0.01', '0.5', 'GHS')).toBe('0.01'); // 0.005 rounds up
    expect(convert('1999.99', '12.3456789012', 'GHS')).toBe('24691.23');
    expect(convert('10', '150.75', 'JPY')).toBe('1508');
  });

  it('inverts rates to 10 decimal places', () => {
    expect(invertRate('15')).toBe('0.0666666667');
    expect(invertRate('0.0625')).toBe('16');
  });
});

describe('CSV safety', () => {
  it('neutralises formula injection in text cells but not amounts', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+233 20 000 0000')).toBe(`'+233 20 000 0000`);
    expect(csvCell('-25.00', { numeric: true })).toBe('-25.00');
    expect(csvCell('Rice, oil')).toBe('"Rice, oil"');
  });

  it('starts with a BOM and header row', () => {
    expect(toCsv([]).startsWith('﻿Date,Type,')).toBe(true);
  });
});

describe('upload type sniffing', () => {
  it('recognises allowed formats from their bytes, not their names', () => {
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffType(Buffer.from('MZ\x90\0'))).toBeNull();
    expect(sniffType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('open.er-api provider adapter (mocked HTTP)', async () => {
  const { providers } = await import('../modules/exchange-rates/providers.js');
  const reply = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

  it('parses a rate and its update time', async () => {
    const r = await providers.open_er_api.fetchRate('USD', 'GHS', reply({ result: 'success', time_last_update_unix: 1793664000, rates: { GHS: 15.4321 } }));
    expect(r).toMatchObject({ rate: '15.4321', provider: 'open_er_api' });
    expect(r.effectiveDate.toISOString().slice(0, 10)).toBe('2026-11-03');
  });

  it('rejects missing pairs, bad values and HTTP errors', async () => {
    await expect(providers.open_er_api.fetchRate('USD', 'GHS', reply({ result: 'success', rates: {} }))).rejects.toThrow();
    await expect(providers.open_er_api.fetchRate('USD', 'GHS', reply({ result: 'success', rates: { GHS: -1 } }))).rejects.toThrow();
    await expect(providers.open_er_api.fetchRate('USD', 'GHS', reply({}, false))).rejects.toThrow();
  });
});

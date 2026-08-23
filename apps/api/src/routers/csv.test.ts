import { describe, expect, it } from 'vitest';
import { parseAmount, parseDate, parseTransactionCsv, splitCsvLine } from './csv.js';

describe('splitCsvLine', () => {
  it('honours quotes, embedded commas, and escaped quotes', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(splitCsvLine('"Smith, John",100,x')).toEqual(['Smith, John', '100', 'x']);
    expect(splitCsvLine('"He said ""hi""",1')).toEqual(['He said "hi"', '1']);
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

describe('parseAmount', () => {
  it('reads Indian and Western grouping, and currency symbols', () => {
    expect(parseAmount('1,20,000.00')).toBe(120000);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('₹ 45,000')).toBe(45000);
    expect(parseAmount('-2,500.50')).toBe(-2500.5);
  });

  it('reads comma-as-decimal when the comma comes last', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
  });

  it('returns null rather than zero for nothing', () => {
    // Zero would be silently importable as a real transaction.
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('  ')).toBeNull();
    expect(parseAmount('-')).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads ISO and day-first formats', () => {
    expect(parseDate('2026-03-15')).toBe(Date.UTC(2026, 2, 15));
    expect(parseDate('15/03/2026')).toBe(Date.UTC(2026, 2, 15));
    expect(parseDate('15-03-26')).toBe(Date.UTC(2026, 2, 15));
  });

  it('returns null for junk', () => {
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseTransactionCsv', () => {
  it('reads a separate debit/credit export', () => {
    const csv = [
      'Date,Narration,Withdrawal Amount,Deposit Amount',
      '01/03/2026,Client payment,,"1,20,000.00"',
      '05/03/2026,AWS bill,"4,500.00",',
    ].join('\n');

    const result = parseTransactionCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      occurredAt: Date.UTC(2026, 2, 1),
      amountMinor: 12_000_000,
      direction: 'in',
      description: 'Client payment',
    });
    expect(result.rows[1]?.direction).toBe('out');
    expect(result.rows[1]?.amountMinor).toBe(450_000);
  });

  it('reads a single signed-amount export', () => {
    const csv = ['date,description,amount', '2026-03-01,Retainer,50000', '2026-03-02,Hosting,-2000'].join('\n');
    const { rows } = parseTransactionCsv(csv);

    expect(rows[0]?.direction).toBe('in');
    expect(rows[1]?.direction).toBe('out');
    // Sign lives in `direction`; the amount is always positive.
    expect(rows[1]?.amountMinor).toBe(200_000);
  });

  it('uses an explicit type column over the sign', () => {
    const csv = ['date,amount,type,description', '2026-03-01,5000,DR,Fee'].join('\n');
    expect(parseTransactionCsv(csv).rows[0]?.direction).toBe('out');
  });

  it('reports bad rows instead of dropping them silently', () => {
    const csv = [
      'date,amount,description',
      '2026-03-01,1000,Good',
      'garbage,500,Bad date',
      '2026-03-03,,Missing amount',
    ].join('\n');

    const result = parseTransactionCsv(csv);

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.line).toBe(3);
    expect(result.errors[1]?.reason).toMatch(/no usable amount/);
  });

  it('refuses a file it cannot map, naming what is missing', () => {
    const noDate = parseTransactionCsv('foo,bar\n1,2');
    expect(noDate.rows).toEqual([]);
    expect(noDate.errors[0]?.reason).toMatch(/no date column/);

    const noAmount = parseTransactionCsv('date,notes\n2026-03-01,hello');
    expect(noAmount.errors[0]?.reason).toMatch(/no amount column/);
  });

  it('reports the header mapping so the import can be checked before writing', () => {
    const { mapping } = parseTransactionCsv('Date,Narration,Amount\n2026-03-01,x,1');
    expect(mapping['date']).toBe('date');
    expect(mapping['description']).toBe('narration');
    expect(mapping['credit']).toBeNull();
  });

  it('never emits a fractional minor unit', () => {
    const csv = ['date,amount', '2026-03-01,1234.567'].join('\n');
    const value = parseTransactionCsv(csv).rows[0]?.amountMinor ?? 0;
    expect(Number.isInteger(value)).toBe(true);
  });
});

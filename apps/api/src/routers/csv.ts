/**
 * Transaction CSV parsing.
 *
 * Deliberately in `apps/api` rather than `packages/intelligence`: the
 * intelligence package is the measurement engine, and bank-export quirks are
 * not measurement. Keeping them apart stops "parse this bank's date format"
 * from ever becoming something the progress engine has an opinion about.
 *
 * The parser is forgiving about *shape* and strict about *values*. A bank
 * export has unpredictable column names and predictable data; guessing at the
 * header is safe, guessing at an amount is not.
 */

export interface ParsedTransaction {
  occurredAt: number;
  /** Always positive. `direction` carries the sign (docs/09 finance rules). */
  amountMinor: number;
  direction: 'in' | 'out';
  description?: string | undefined;
}

export interface CsvParseResult {
  rows: ParsedTransaction[];
  /** Row-level problems, reported rather than silently dropped. */
  errors: Array<{ line: number; reason: string }>;
  /** Which header each field was matched to, so the UI can show the mapping. */
  mapping: Record<string, string | null>;
}

const HEADERS = {
  date: ['date', 'transaction date', 'txn date', 'value date', 'posted', 'time'],
  amount: ['amount', 'value', 'transaction amount', 'amt'],
  debit: ['debit', 'withdrawal', 'withdrawal amount', 'paid out', 'money out'],
  credit: ['credit', 'deposit', 'deposit amount', 'paid in', 'money in'],
  description: ['description', 'narration', 'particulars', 'details', 'remarks', 'memo'],
  type: ['type', 'direction', 'dr/cr', 'debit/credit'],
} as const;

/** Splits one CSV line, honouring double quotes and escaped quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field.trim());
      field = '';
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

const findColumn = (headers: string[], candidates: readonly string[]): number =>
  headers.findIndex((h) => candidates.includes(h));

/**
 * Indian bank exports commonly write `1,20,000.00`, and some locales use
 * `1.234,56`. Currency symbols and spaces are stripped; the decimal separator
 * is inferred from which mark appears last.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  /**
   * `45,000` and `1.234,56` are genuinely ambiguous on the separator alone.
   * What separates them is how many digits follow: a grouping separator is
   * always followed by exactly three, a decimal separator by one or two.
   * Getting this backwards turns ₹45,000 into ₹45, which is the kind of error
   * that imports cleanly and is noticed months later.
   */
  let normalised: string;
  if (lastComma > lastDot) {
    const digitsAfter = cleaned.length - lastComma - 1;
    normalised =
      digitsAfter === 3
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/** ISO first, then day-first, which is what Indian bank exports use. */
export function parseDate(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!);

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(trimmed);
  if (dmy) {
    const year = +dmy[3]!;
    return Date.UTC(year < 100 ? 2000 + year : year, +dmy[2]! - 1, +dmy[1]!);
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseTransactionCsv(csv: string): CsvParseResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const errors: CsvParseResult['errors'] = [];

  const headerLine = lines[0];
  if (headerLine === undefined) {
    return { rows: [], errors: [{ line: 0, reason: 'file is empty' }], mapping: {} };
  }

  const headers = splitCsvLine(headerLine).map((h) => h.toLowerCase());
  const col = {
    date: findColumn(headers, HEADERS.date),
    amount: findColumn(headers, HEADERS.amount),
    debit: findColumn(headers, HEADERS.debit),
    credit: findColumn(headers, HEADERS.credit),
    description: findColumn(headers, HEADERS.description),
    type: findColumn(headers, HEADERS.type),
  };

  const mapping: Record<string, string | null> = {};
  for (const [field, index] of Object.entries(col)) {
    mapping[field] = index >= 0 ? (headers[index] ?? null) : null;
  }

  if (col.date < 0) {
    return { rows: [], errors: [{ line: 1, reason: 'no date column found' }], mapping };
  }
  if (col.amount < 0 && col.debit < 0 && col.credit < 0) {
    return { rows: [], errors: [{ line: 1, reason: 'no amount column found' }], mapping };
  }

  const rows: ParsedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = splitCsvLine(lines[i]!);

    const occurredAt = parseDate(cells[col.date] ?? '');
    if (occurredAt === null) {
      errors.push({ line: lineNo, reason: `unreadable date: ${cells[col.date] ?? ''}` });
      continue;
    }

    // Separate debit/credit columns are unambiguous, so they win over a single
    // signed amount column when a file has both.
    let amount: number | null = null;
    let direction: 'in' | 'out' | null = null;

    if (col.debit >= 0 || col.credit >= 0) {
      const debit = col.debit >= 0 ? parseAmount(cells[col.debit] ?? '') : null;
      const credit = col.credit >= 0 ? parseAmount(cells[col.credit] ?? '') : null;
      if (debit !== null && debit !== 0) {
        amount = Math.abs(debit);
        direction = 'out';
      } else if (credit !== null && credit !== 0) {
        amount = Math.abs(credit);
        direction = 'in';
      }
    }

    if (amount === null && col.amount >= 0) {
      const signed = parseAmount(cells[col.amount] ?? '');
      if (signed !== null && signed !== 0) {
        amount = Math.abs(signed);
        const marker = (cells[col.type] ?? '').toLowerCase();
        direction =
          marker.startsWith('d') || marker.includes('debit')
            ? 'out'
            : marker.startsWith('c') || marker.includes('credit')
              ? 'in'
              : signed < 0
                ? 'out'
                : 'in';
      }
    }

    if (amount === null || direction === null) {
      errors.push({ line: lineNo, reason: 'no usable amount on this row' });
      continue;
    }

    const description = col.description >= 0 ? cells[col.description] : undefined;

    rows.push({
      occurredAt,
      // Money is integer minor units everywhere. Rounding here, once, is what
      // keeps a float from ever reaching storage.
      amountMinor: Math.round(amount * 100),
      direction,
      ...(description === undefined || description === '' ? {} : { description }),
    });
  }

  return { rows, errors, mapping };
}

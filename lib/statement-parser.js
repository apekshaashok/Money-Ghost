// Pure parsing logic: raw statement (CSV/JSON) + bank profile -> clean debit rows.
// No database access here, so it is easy to unit-test.
import Papa from 'papaparse';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function pad(n) {
  return String(n).padStart(2, '0');
}

function validDate(y, m, d) {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parse a date string according to a profile date format. Returns 'YYYY-MM-DD' or null. */
export function parseDate(value, format = 'auto') {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  let m;
  const tryIso = () => ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)) ? validDate(+m[1], +m[2], +m[3]) : null);
  const tryDMY = () => ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)) ? validDate(+m[3], +m[2], +m[1]) : null);
  const tryMDY = () => ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)) ? validDate(+m[3], +m[1], +m[2]) : null);
  const tryDMonY = () => {
    m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,4})[\s-](\d{2}|\d{4})$/);
    return m && MONTHS[m[2].toLowerCase()] ? validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : null;
  };
  switch (format) {
    case 'ISO': return tryIso();
    case 'DD/MM/YY': case 'DD/MM/YYYY': case 'DD-MM-YYYY': return tryDMY();
    case 'MM/DD/YYYY': return tryMDY();
    case 'DD MMM YYYY': return tryDMonY();
    default: return tryIso() || tryDMY() || tryDMonY();
  }
}

/** "₹1,200.50" -> 1200.5, "(450)" -> -450, "" -> null */
export function parseAmount(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[₹$€£,\s]|INR|Rs\.?/gi, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return negative ? -n : n;
}

/** Read "a.b.c" from a nested object. */
export function getPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Decide whether text is JSON or CSV and parse it into records + header list. */
export function parseFile(text, filename = '') {
  const trimmed = text.trim();
  if (filename.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('The file looks like JSON but could not be parsed.');
    }
    return { format: 'json', data };
  }
  const parsed = Papa.parse(trimmed, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  if (!parsed.meta.fields?.length) throw new Error('The CSV file has no header row.');
  return { format: 'csv', data: parsed.data, headers: parsed.meta.fields };
}

/** Find the bank profile that fits the parsed file (most specific match first). */
export function detectProfile(parsed, profiles) {
  const candidates = profiles.filter((p) => p.format === parsed.format);
  if (parsed.format === 'csv') {
    const have = new Set(parsed.headers.map((h) => h.toLowerCase()));
    return candidates
      .filter((p) => p.match_headers.every((h) => have.has(h.toLowerCase())))
      .sort((a, b) => b.match_headers.length - a.match_headers.length)[0] || null;
  }
  return candidates
    .filter((p) => {
      const recs = p.records_path ? getPath(parsed.data, p.records_path) : parsed.data;
      return Array.isArray(recs) && recs.length > 0 && getPath(recs[0], p.columns.date) !== undefined;
    })
    .sort((a, b) => (b.records_path || '').length - (a.records_path || '').length)[0] || null;
}

/** Records (array of objects) for a profile. */
export function recordsFor(parsed, profile) {
  if (parsed.format === 'csv') return parsed.data;
  const recs = profile.records_path ? getPath(parsed.data, profile.records_path) : parsed.data;
  return Array.isArray(recs) ? recs : [];
}

/**
 * Normalise records with a profile. Returns { rows, errors, credits }.
 * rows: [{ row, date, description, amount }] - debits only, amount > 0.
 */
export function normaliseRecords(records, profile) {
  const c = profile.columns;
  const pick = (rec, col) => {
    if (!col) return undefined;
    if (col in rec) return rec[col];                       // exact column name (may contain dots)
    const key = Object.keys(rec).find((k) => k.toLowerCase() === col.toLowerCase());
    if (key !== undefined) return rec[key];
    return col.includes('.') ? getPath(rec, col) : undefined; // nested JSON path, e.g. amount.value
  };
  const debitWords = (profile.debit_values || []).map((v) => v.toLowerCase());
  const rows = [];
  const errors = [];
  let credits = 0;

  records.forEach((rec, i) => {
    const rowNo = i + 1;
    const date = parseDate(pick(rec, c.date), profile.date_format);
    const description = String(pick(rec, c.description) ?? '').replace(/\s+/g, ' ').trim();
    if (!date) return errors.push({ row: rowNo, reason: 'invalid or missing date' });
    if (!description) return errors.push({ row: rowNo, reason: 'missing description' });

    let amount = null;
    if (c.debit || c.credit) {
      const debit = parseAmount(pick(rec, c.debit));
      const credit = parseAmount(pick(rec, c.credit));
      if (debit && debit !== 0) amount = Math.abs(debit);
      else if (credit) { credits++; return; }
    } else {
      const value = parseAmount(pick(rec, c.amount));
      if (value === null) return errors.push({ row: rowNo, reason: 'invalid or missing amount' });
      if (c.direction) {
        const dir = String(pick(rec, c.direction) ?? '').trim().toLowerCase();
        if (!debitWords.includes(dir)) { credits++; return; }
        amount = Math.abs(value);
      } else if (profile.amount_sign === 'debit_negative') {
        if (value >= 0) { credits++; return; }
        amount = -value;
      } else {
        amount = Math.abs(value);
      }
    }
    if (!amount || amount <= 0) return errors.push({ row: rowNo, reason: 'invalid or missing amount' });
    if (amount >= 1e10) return errors.push({ row: rowNo, reason: 'amount too large' });
    rows.push({ row: rowNo, date, description: description.slice(0, 300), amount: Math.round(amount * 100) / 100 });
  });
  return { rows, errors, credits };
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseCsvRows } from './csv';

/** Lower-case, non-alphanumerics to '_': 'Name of the Institution' -> 'name_of_the_institution'. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    if ('error' in v) return '';
  }
  return String(v);
}

async function readRawRows(filePath: string): Promise<string[][]> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') return parseCsvRows(await readFile(filePath, 'utf8'));

  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as ExcelJS.CellValue[]; // 1-based
      rows.push(values.slice(1).map((v) => cellText(v).trim()));
    });
    return rows.filter((r) => r.some((c) => c !== ''));
  }
  throw new Error(`Unsupported file type '${ext}' (use .csv or .xlsx)`);
}

/**
 * Reads a .csv or .xlsx (first sheet) into objects keyed by NORMALIZED header.
 * Government exports often have title lines above the table, so the header is
 * the first row for which `isHeader` returns true (default: the first row).
 */
export async function readTableFile(
  filePath: string,
  isHeader: (normalizedCells: string[]) => boolean = () => true,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const raw = await readRawRows(filePath);
  const headerIdx = raw.findIndex((r) => isHeader(r.map(normalizeHeader)));
  if (headerIdx < 0) return { headers: [], rows: [] };

  const headers = raw[headerIdx].map(normalizeHeader);
  const rows = raw.slice(headerIdx + 1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h && !(h in obj && obj[h])) obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows };
}

/** First non-empty value among several possible column names. */
export function pick(row: Record<string, string>, names: string[]): string | null {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== '' && v.toLowerCase() !== 'null' && v !== '-') return v;
  }
  return null;
}

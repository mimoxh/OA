import { activeProperties, cellText } from "./engine";
import type { DatabaseRow, PersonOption, PropertyDefinition } from "./types";

/** RFC 4180 CSV parser handling quotes, escaped quotes, embedded newlines, and UTF-8 BOM */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"' && field.length === 0) {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += text[i + 1] === "\n" ? 2 : 1;
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing empty lines
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return rows;
}

function escapeCsvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

export function serializeDatabaseCsv(
  properties: readonly PropertyDefinition[],
  rows: readonly DatabaseRow[],
  members: readonly PersonOption[] = [],
): string {
  const cols = activeProperties(properties);
  const membersById = new Map(members.map((m) => [m.id, m]));
  const lines: string[] = [];
  lines.push(cols.map((c) => escapeCsvCell(c.name)).join(","));
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCsvCell(cellText(row, c, membersById))).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}

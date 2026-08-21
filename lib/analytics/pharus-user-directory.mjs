/**
 * Enriquecimento opcional de usuários do App Pharus via CSV auxiliar.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PRE_REG_CSV = "pre_registrations_rows.csv";
const PERSONAL_CSV = "personal_info_rows.csv";

function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function parseCsvLine(line) {
  const cols = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      q = !q;
      continue;
    }
    if (ch === "," && !q) {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function foldHeader(h) {
  return String(h || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_");
}

function pickCol(headers, ...candidates) {
  const folded = headers.map((h) => foldHeader(h));
  for (const cand of candidates) {
    const i = folded.indexOf(foldHeader(cand));
    if (i >= 0) return i;
  }
  return -1;
}

function findCsvPath(fileName) {
  const candidates = [
    resolve(ROOT, fileName),
    resolve(process.cwd(), fileName),
    resolve(ROOT, "..", "pharus", "core", fileName),
    process.env.PHARUS_USER_CSV_DIR ? resolve(String(process.env.PHARUS_USER_CSV_DIR).trim(), fileName) : null,
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

function readCsvRows(fileName) {
  const path = findCsvPath(fileName);
  if (!path) return { available: false, path: null, rows: [], headers: [] };
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { available: true, path, rows: [], headers: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    rows.push(obj);
  }
  return { available: true, path, rows, headers };
}

function upsertUser(map, userId, patch, source) {
  const id = blankToNull(userId);
  if (!id) return;
  const key = String(id);
  const cur = map.get(key) || { id: key, name: null, email: null, sources: [] };
  map.set(key, {
    ...cur,
    name: blankToNull(patch.name) || cur.name,
    email: blankToNull(patch.email) || cur.email,
    sources: cur.sources.includes(source) ? cur.sources : [...cur.sources, source],
  });
}

export function loadPharusUserDirectoryFromCsv() {
  const byId = new Map();
  const pre = readCsvRows(PRE_REG_CSV);
  const personal = readCsvRows(PERSONAL_CSV);
  const meta = {
    preRegistrationsCsv: { available: pre.available, file: PRE_REG_CSV, rows: pre.rows.length },
    personalInfoCsv: { available: personal.available, file: PERSONAL_CSV, rows: personal.rows.length },
  };

  if (pre.available && pre.rows.length) {
    const uidIdx = pickCol(pre.headers, "user_id", "userid", "id_usuario", "usuario_id");
    const emailIdx = pickCol(pre.headers, "email", "e_mail", "mail");
    const nameIdx = pickCol(pre.headers, "name", "nome", "full_name", "display_name");
    for (const row of pre.rows) {
      upsertUser(
        byId,
        uidIdx >= 0 ? row[pre.headers[uidIdx]] : null,
        {
          email: emailIdx >= 0 ? row[pre.headers[emailIdx]] : null,
          name: nameIdx >= 0 ? row[pre.headers[nameIdx]] : null,
        },
        "csv:pre_registrations",
      );
    }
  }

  if (personal.available && personal.rows.length) {
    const uidIdx = pickCol(personal.headers, "user_id", "userid", "id_usuario", "usuario_id");
    const emailIdx = pickCol(personal.headers, "email", "alternative_email", "e_mail", "mail");
    const nameIdx = pickCol(personal.headers, "name", "nome", "full_name", "display_name");
    for (const row of personal.rows) {
      upsertUser(
        byId,
        uidIdx >= 0 ? row[personal.headers[uidIdx]] : null,
        {
          email: emailIdx >= 0 ? row[personal.headers[emailIdx]] : null,
          name: nameIdx >= 0 ? row[personal.headers[nameIdx]] : null,
        },
        "csv:personal_info",
      );
    }
  }

  return { byId, metadata: meta };
}

export function mergeUserDirectories(...maps) {
  const out = new Map();
  for (const map of maps) {
    if (!map) continue;
    for (const [id, row] of map.entries()) {
      const cur = out.get(id) || { id, name: null, email: null, sources: [] };
      out.set(id, {
        id,
        name: blankToNull(row.name) || cur.name,
        email: blankToNull(row.email) || cur.email,
        sources: [...new Set([...(cur.sources || []), ...(row.sources || [])])],
      });
    }
  }
  return out;
}

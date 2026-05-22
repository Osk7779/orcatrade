'use strict';

// Parsers that turn official public sanctions-list files into the engine's
// entry shape { externalId, type, name, aliases, programme } (Sprint
// sanctions-lists-v1). Pure + defensive: malformed rows are skipped, never
// thrown on, so one bad line can't abort a refresh of tens of thousands.

// Split a single CSV line respecting double-quoted fields (which may contain
// commas and "" escapes). Returns an array of field strings.
function splitCsvLine(line) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(field); field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

// OFAC uses the literal "-0-" as the empty/no-value placeholder.
function ofacField(v) {
  const s = String(v == null ? '' : v).trim();
  return (!s || s === '-0-') ? '' : s;
}

function mapOfacType(sdnType) {
  const t = ofacField(sdnType).toLowerCase();
  if (t === 'individual') return 'individual';
  if (t === 'vessel') return 'vessel';
  if (t === 'aircraft') return 'aircraft';
  if (t === 'entity') return 'entity';
  return 'entity';
}

// Parse OFAC's SDN.CSV. The file has NO header row; documented column order:
//   0 ent_num, 1 SDN_Name, 2 SDN_Type, 3 Program, 4 Title, 5 Call_Sign,
//   6 Vess_type, 7 Tonnage, 8 GRT, 9 Vess_flag, 10 Vess_owner, 11 Remarks
// Aliases live in a separate ALT.CSV (not parsed here) — entries get [].
function parseOfacSdnCsv(text) {
  const entries = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let cols;
    try { cols = splitCsvLine(line); } catch (_) { continue; }
    const name = ofacField(cols[1]);
    if (!name) continue; // a row with no name is useless to a name screen
    entries.push({
      externalId: ofacField(cols[0]) || null,
      type: mapOfacType(cols[2]),
      name,
      aliases: [],
      programme: ofacField(cols[3]) || null,
    });
  }
  return { source: 'OFAC-SDN', entries };
}

// A simple OrcaTrade CSV format (WITH a header row) so any list — a manually
// prepared EU/UK extract, a test fixture — can be loaded without a bespoke
// adapter. Header (any order): external_id,type,name,aliases,programme.
// `aliases` is pipe-separated.
function parseSimpleCsv(text, { source = 'CUSTOM' } = {}) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { source, entries: [] };
  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const ni = idx('name');
  if (ni === -1) return { source, entries: [] };
  const entries = [];
  for (let i = 1; i < lines.length; i += 1) {
    let cols;
    try { cols = splitCsvLine(lines[i]); } catch (_) { continue; }
    const name = (cols[ni] || '').trim();
    if (!name) continue;
    const aliasRaw = idx('aliases') >= 0 ? (cols[idx('aliases')] || '') : '';
    entries.push({
      externalId: idx('external_id') >= 0 ? (cols[idx('external_id')] || '').trim() || null : null,
      type: (idx('type') >= 0 ? (cols[idx('type')] || '').trim() : '') || 'entity',
      name,
      aliases: aliasRaw ? aliasRaw.split('|').map(s => s.trim()).filter(Boolean) : [],
      programme: idx('programme') >= 0 ? (cols[idx('programme')] || '').trim() || null : null,
    });
  }
  return { source, entries };
}

module.exports = {
  splitCsvLine,
  parseOfacSdnCsv,
  parseSimpleCsv,
};

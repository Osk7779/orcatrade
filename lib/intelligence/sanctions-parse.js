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

// Parse the UK OFSI consolidated list (ConList.csv). Its real shape: a first
// metadata/date line, then a header row, then data rows. A designated party's
// name is split across "Name 1".."Name 6" columns; "Group Type" gives the type
// and "Regime" the programme. We locate columns BY HEADER NAME (not position)
// so the parser survives column reordering, and skip any row we can't read.
function mapOfsiType(groupType) {
  const t = String(groupType || '').toLowerCase();
  if (t.includes('individual')) return 'individual';
  if (t.includes('ship') || t.includes('vessel')) return 'vessel';
  if (t.includes('entity')) return 'entity';
  return 'entity';
}

function parseOfsiCsv(text) {
  const lines = String(text || '').split(/\r?\n/);
  // Find the header row: the line whose fields include "Group Type" + a "Name 1".
  let headerIdx = -1;
  let header = null;
  for (let i = 0; i < lines.length && i < 10; i += 1) {
    if (!lines[i].trim()) continue;
    let cols;
    try { cols = splitCsvLine(lines[i]).map(c => c.trim().toLowerCase()); } catch (_) { continue; }
    if (cols.includes('group type') && cols.some(c => /^name 1$/.test(c))) {
      headerIdx = i; header = cols; break;
    }
  }
  if (headerIdx === -1) return { source: 'UK-OFSI', entries: [] };

  const col = name => header.indexOf(name);
  const nameCols = [];
  for (let n = 1; n <= 6; n += 1) {
    const idx = col('name ' + n);
    if (idx >= 0) nameCols.push(idx);
  }
  const typeIdx = col('group type');
  const regimeIdx = col('regime');
  const idIdx = col('group id');

  const entries = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    let cols;
    try { cols = splitCsvLine(lines[i]); } catch (_) { continue; }
    const name = nameCols.map(ci => (cols[ci] || '').trim()).filter(Boolean).join(' ').trim();
    if (!name) continue;
    entries.push({
      externalId: idIdx >= 0 ? (cols[idIdx] || '').trim() || null : null,
      type: mapOfsiType(typeIdx >= 0 ? cols[typeIdx] : ''),
      name,
      aliases: [],
      programme: regimeIdx >= 0 ? (cols[regimeIdx] || '').trim() || null : null,
    });
  }
  return { source: 'UK-OFSI', entries };
}

// Parse the UN Security Council consolidated list (consolidated.xml). The file
// is <INDIVIDUAL>…</INDIVIDUAL> and <ENTITY>…</ENTITY> blocks; an individual's
// name is split across FIRST/SECOND/THIRD/FOURTH_NAME, an entity's name is in
// FIRST_NAME. Aliases live in <ALIAS_NAME> tags. We extract by tag with
// defensive regex (no XML dep) and skip any block without a name.
function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function firstTag(block, tag) {
  const m = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? decodeXmlEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function allTags(block, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'gi');
  let m;
  while ((m = re.exec(block))) {
    const v = decodeXmlEntities(m[1]).replace(/\s+/g, ' ').trim();
    if (v) out.push(v);
  }
  return out;
}

function parseUnXml(text) {
  const xml = String(text || '');
  const entries = [];
  const grab = (blockTag, type) => {
    const re = new RegExp('<' + blockTag + '\\b[^>]*>([\\s\\S]*?)</' + blockTag + '>', 'gi');
    let m;
    while ((m = re.exec(xml))) {
      const b = m[1];
      const name = [firstTag(b, 'FIRST_NAME'), firstTag(b, 'SECOND_NAME'), firstTag(b, 'THIRD_NAME'), firstTag(b, 'FOURTH_NAME')]
        .filter(Boolean).join(' ').trim();
      if (!name) continue;
      entries.push({
        externalId: firstTag(b, 'DATAID') || firstTag(b, 'REFERENCE_NUMBER') || null,
        type,
        name,
        aliases: allTags(b, 'ALIAS_NAME'),
        programme: firstTag(b, 'UN_LIST_TYPE') || 'UN',
      });
    }
  };
  grab('INDIVIDUAL', 'individual');
  grab('ENTITY', 'entity');
  return { source: 'UN', entries };
}

// Parse the EU consolidated financial-sanctions list (xmlFullSanctionsList).
// Structure differs from the UN file: names live in ATTRIBUTES, not element
// text. Each <sanctionEntity euReferenceNumber="…"> has a <subjectType
// code="person|enterprise"/>, a <regulation programme="…">, and one or more
// <nameAlias wholeName="…" …> — the first wholeName is the primary name, the
// rest are aliases. Defensive regex (no XML dep); skips any entity with no name.
function attrFrom(attrString, name) {
  const m = String(attrString).match(new RegExp('\\b' + name + '="([^"]*)"', 'i'));
  return m ? decodeXmlEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function mapEuType(code) {
  const c = String(code || '').toLowerCase();
  if (c === 'person') return 'individual';
  if (c === 'enterprise') return 'entity';
  if (c.includes('vessel') || c.includes('ship')) return 'vessel';
  if (c.includes('aircraft')) return 'aircraft';
  return 'entity';
}

function parseEuXml(text) {
  const xml = String(text || '');
  const entries = [];
  const re = /<sanctionEntity\b([^>]*)>([\s\S]*?)<\/sanctionEntity>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const open = m[1];
    const body = m[2];

    // Every <nameAlias …>'s wholeName attribute, in document order.
    const names = [];
    const na = /<nameAlias\b([^>]*?)\/?>/gi;
    let a;
    while ((a = na.exec(body))) {
      const wn = attrFrom(a[1], 'wholeName');
      if (wn) names.push(wn);
    }
    if (!names.length) continue; // no screenable name

    const typeCode = (body.match(/<subjectType\b[^>]*\bcode="([^"]*)"/i) || [])[1] || '';
    const programme = (body.match(/<regulation\b[^>]*\bprogramme="([^"]*)"/i) || [])[1] || '';
    // De-dupe aliases that equal the primary name.
    const primary = names[0];
    const aliases = [];
    for (const n of names.slice(1)) { if (n !== primary && !aliases.includes(n)) aliases.push(n); }

    entries.push({
      externalId: attrFrom(open, 'euReferenceNumber') || attrFrom(open, 'logicalId') || null,
      type: mapEuType(typeCode),
      name: primary,
      aliases,
      programme: decodeXmlEntities(programme) || 'EU',
    });
  }
  return { source: 'EU', entries };
}

module.exports = {
  splitCsvLine,
  parseOfacSdnCsv,
  parseOfsiCsv,
  parseUnXml,
  parseEuXml,
  parseSimpleCsv,
};

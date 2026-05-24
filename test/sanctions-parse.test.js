const test = require('node:test');
const assert = require('node:assert/strict');

const { splitCsvLine, parseOfacSdnCsv, parseOfsiCsv, parseSimpleCsv, parseUnXml } = require('../lib/intelligence/sanctions-parse');

// ── CSV line splitting ──────────────────────────────────

test('splitCsvLine handles quoted fields with commas and escaped quotes', () => {
  assert.deepEqual(splitCsvLine('1,"ACME, INC.",entity'), ['1', 'ACME, INC.', 'entity']);
  assert.deepEqual(splitCsvLine('"a ""b"" c",x'), ['a "b" c', 'x']);
});

// ── OFAC SDN.CSV (no header; documented column order) ───

const OFAC_FIXTURE = [
  '36,"AEROCARIBBEAN AIRLINES","-0-","CUBA","-0-","-0-","-0-","-0-","-0-","-0-","-0-","Linked To: X."',
  '7157,"PETROV, Ivan","individual","UKRAINE-EO13662","-0-","-0-","-0-","-0-","-0-","-0-","-0-","-0-"',
  '12345,"MV NORTHERN STAR","vessel","SDGT","-0-","-0-","Cargo","-0-","-0-","-0-","-0-","-0-"',
  '', // blank line — skipped
  '999,"-0-","entity","X","-0-"', // no name — skipped
].join('\n');

test('parseOfacSdnCsv maps name, type, programme and skips nameless/blank rows', () => {
  const { source, entries } = parseOfacSdnCsv(OFAC_FIXTURE);
  assert.equal(source, 'OFAC-SDN');
  assert.equal(entries.length, 3);

  const air = entries[0];
  assert.equal(air.name, 'AEROCARIBBEAN AIRLINES');
  assert.equal(air.type, 'entity');
  assert.equal(air.programme, 'CUBA');
  assert.equal(air.externalId, '36');
  assert.deepEqual(air.aliases, []);

  assert.equal(entries[1].type, 'individual');
  assert.equal(entries[1].name, 'PETROV, Ivan');
  assert.equal(entries[2].type, 'vessel');
});

test('parseOfacSdnCsv is defensive — empty input → no entries', () => {
  assert.deepEqual(parseOfacSdnCsv('').entries, []);
  assert.deepEqual(parseOfacSdnCsv(null).entries, []);
});

// ── simple OrcaTrade CSV (with header) ──────────────────

test('parseSimpleCsv reads a headered file with pipe-separated aliases', () => {
  const text = [
    'external_id,type,name,aliases,programme',
    'E1,entity,"Globex Corporation","Globex|Globex Corp",EU-CFSP',
    'I1,individual,Jane Roe,,UK-OFSI',
  ].join('\n');
  const { entries } = parseSimpleCsv(text, { source: 'EU-CFSP' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'Globex Corporation');
  assert.deepEqual(entries[0].aliases, ['Globex', 'Globex Corp']);
  assert.equal(entries[0].programme, 'EU-CFSP');
  assert.deepEqual(entries[1].aliases, []);
});

test('parseSimpleCsv with no name column → no entries', () => {
  assert.deepEqual(parseSimpleCsv('id,foo\n1,bar').entries, []);
});

// ── UK OFSI ConList.csv (metadata line, then header, header-keyed) ──

const OFSI_FIXTURE = [
  '"Date Generated","18/05/2026"',
  '"Name 1","Name 2","Name 3","Name 4","Name 5","Name 6","Title","Group Type","Regime","Group ID"',
  '"VOLCANO","TRADING","COMPANY","","","","","Entity","Russia","12345"',
  '"PETROV","Ivan","","","","","Mr","Individual","Russia","67890"',
  '', // blank — skipped
  '"","","","","","","","Entity","X","999"', // no name — skipped
].join('\n');

test('parseOfsiCsv finds the header row, joins Name 1..6, maps type + regime', () => {
  const { source, entries } = parseOfsiCsv(OFSI_FIXTURE);
  assert.equal(source, 'UK-OFSI');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'VOLCANO TRADING COMPANY');
  assert.equal(entries[0].type, 'entity');
  assert.equal(entries[0].programme, 'Russia');
  assert.equal(entries[0].externalId, '12345');
  assert.equal(entries[1].name, 'PETROV Ivan');
  assert.equal(entries[1].type, 'individual');
});

test('parseOfsiCsv is column-order independent (header-keyed)', () => {
  const reordered = [
    '"Group Type","Regime","Name 1","Name 2","Group ID"',
    '"Individual","Iran","SMITH","John","42"',
  ].join('\n');
  const { entries } = parseOfsiCsv(reordered);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'SMITH John');
  assert.equal(entries[0].type, 'individual');
});

test('parseOfsiCsv returns no entries when no header row is found', () => {
  assert.deepEqual(parseOfsiCsv('just,some,random\ncsv,data,here').entries, []);
  assert.deepEqual(parseOfsiCsv('').entries, []);
});

// ── UN Security Council consolidated.xml (INDIVIDUAL/ENTITY blocks) ──

const UN_FIXTURE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<CONSOLIDATED_LIST dateGenerated="2026-05-18">',
  '  <INDIVIDUALS>',
  '    <INDIVIDUAL>',
  '      <DATAID>6908555</DATAID>',
  '      <FIRST_NAME>Ivan</FIRST_NAME>',
  '      <SECOND_NAME>Petrov</SECOND_NAME>',
  '      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>',
  '      <INDIVIDUAL_ALIAS><ALIAS_NAME>Ivan the Trader</ALIAS_NAME></INDIVIDUAL_ALIAS>',
  '      <INDIVIDUAL_ALIAS><ALIAS_NAME>I. Petrov</ALIAS_NAME></INDIVIDUAL_ALIAS>',
  '    </INDIVIDUAL>',
  '    <INDIVIDUAL>',
  '      <DATAID>7000001</DATAID>',
  '      <UN_LIST_TYPE>Taliban</UN_LIST_TYPE>',
  '    </INDIVIDUAL>',
  '  </INDIVIDUALS>',
  '  <ENTITIES>',
  '    <ENTITY>',
  '      <DATAID>20001</DATAID>',
  '      <FIRST_NAME>Volcano Trading Company &amp; Sons</FIRST_NAME>',
  '      <UN_LIST_TYPE>DPRK</UN_LIST_TYPE>',
  '      <ENTITY_ALIAS><ALIAS_NAME>Vulkan Handel</ALIAS_NAME></ENTITY_ALIAS>',
  '    </ENTITY>',
  '  </ENTITIES>',
  '</CONSOLIDATED_LIST>',
].join('\n');

test('parseUnXml extracts individuals + entities, joins name parts, decodes entities', () => {
  const { source, entries } = parseUnXml(UN_FIXTURE);
  assert.equal(source, 'UN');
  // the nameless individual block is skipped
  assert.equal(entries.length, 2);

  const ivan = entries[0];
  assert.equal(ivan.name, 'Ivan Petrov');
  assert.equal(ivan.type, 'individual');
  assert.equal(ivan.externalId, '6908555');
  assert.equal(ivan.programme, 'Al-Qaida');
  assert.deepEqual(ivan.aliases, ['Ivan the Trader', 'I. Petrov']);

  const ent = entries[1];
  assert.equal(ent.name, 'Volcano Trading Company & Sons'); // &amp; decoded
  assert.equal(ent.type, 'entity');
  assert.equal(ent.programme, 'DPRK');
  assert.deepEqual(ent.aliases, ['Vulkan Handel']);
});

test('parseUnXml is defensive — empty/garbage input → no entries', () => {
  assert.deepEqual(parseUnXml('').entries, []);
  assert.deepEqual(parseUnXml(null).entries, []);
  assert.deepEqual(parseUnXml('<not-the-right-tags/>').entries, []);
});

test('UN-parsed entries screen correctly through the engine', () => {
  const { screen } = require('../lib/intelligence/sanctions-screening');
  const list = { source: 'UN', authoritative: true, entries: parseUnXml(UN_FIXTURE).entries };
  const r = screen({ name: 'Ivan Petrov', list });
  assert.equal(r.status, 'potential_match');
  assert.equal(r.matches[0].programme, 'Al-Qaida');
});

// ── parsed entries are screen-ready ─────────────────────

test('OFAC-parsed entries screen correctly through the engine', () => {
  const { screen } = require('../lib/intelligence/sanctions-screening');
  const list = { source: 'OFAC-SDN', authoritative: true, entries: parseOfacSdnCsv(OFAC_FIXTURE).entries };
  const r = screen({ name: 'Aerocaribbean Airlines', list });
  assert.equal(r.status, 'potential_match');
  assert.equal(r.authoritative, true);
  assert.equal(r.matches[0].name, 'AEROCARIBBEAN AIRLINES');
});

#!/usr/bin/env node
// Build a real multi-resolution favicon.ico from favicon-{16,32,48}.png.
//
// The previous favicon.ico was a 32x32 PNG renamed to .ico. Chrome tolerates
// it; Google's favicon crawler, older Safari/Firefox, and several embed
// scrapers do not. They check ICO magic bytes (00 00 01 00) and reject PNGs.
//
// This produces a valid ICO containing three PNG-encoded entries (16, 32, 48).
// Modern browsers, crawlers, and OS shells handle PNG-in-ICO fine.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = [
  { size: 16, file: 'favicon-16x16.png' },
  { size: 32, file: 'favicon-32x32.png' },
  { size: 48, file: 'favicon-48x48.png' },
];
const OUT = path.join(ROOT, 'favicon.ico');

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

function buildIco(entries) {
  const header = Buffer.alloc(ICONDIR_SIZE);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: 1 = ICO
  header.writeUInt16LE(entries.length, 4); // image count

  const directory = Buffer.alloc(ICONDIRENTRY_SIZE * entries.length);
  let offset = ICONDIR_SIZE + directory.length;

  entries.forEach((entry, i) => {
    const base = i * ICONDIRENTRY_SIZE;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base);     // width
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1); // height
    directory.writeUInt8(0, base + 2);  // palette colors (0 = none)
    directory.writeUInt8(0, base + 3);  // reserved
    directory.writeUInt16LE(1, base + 4);   // color planes
    directory.writeUInt16LE(32, base + 6);  // bits per pixel
    directory.writeUInt32LE(entry.data.length, base + 8);  // bytes in resource
    directory.writeUInt32LE(offset, base + 12);            // offset
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
}

function main() {
  const entries = SOURCES.map(({ size, file }) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) throw new Error(`Missing source: ${file}`);
    return { size, data: fs.readFileSync(full) };
  });

  const ico = buildIco(entries);
  fs.writeFileSync(OUT, ico);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${ico.length} bytes, ${entries.length} entries: ${entries.map((e) => `${e.size}px`).join(', ')})`);
}

if (require.main === module) {
  try { main(); }
  catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}

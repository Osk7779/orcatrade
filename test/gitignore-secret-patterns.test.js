// .gitignore secret-pattern contract.
//
// The .gitignore file is one git-add away from being the last line of
// defence against a credentials.json or id_rsa landing in a public PR.
// This test pins the secret-class patterns so a well-meaning rewrite
// can't strip them silently, and asserts that no file currently tracked
// in the repo matches one of those patterns (catches the case where the
// rules were added too late to stop a slip-up).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GITIGNORE_PATH = path.join(ROOT, '.gitignore');

// Required entries. Each entry must appear as a standalone line (not
// inside a comment). Order doesn't matter; presence does.
const REQUIRED_PATTERNS = Object.freeze([
  // Environment files (every common dotenv convention).
  '.env',
  '.env.*',
  '.envrc',
  // The example file is the public scaffold — it must stay tracked.
  '!.env.example',
  // Cryptographic material — generic file extensions used by openssl,
  // ssh-keygen, AWS, Google Cloud service accounts, etc.
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.cer',
  '*.crt',
  // SSH keys at their conventional paths.
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'id_ed25519.pub',
  '.ssh/',
  // Generic secret stores.
  'secrets/',
  'credentials.json',
  'service-account*.json',
]);

function readLines() {
  const txt = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  return txt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

test('.gitignore exists', () => {
  assert.ok(fs.existsSync(GITIGNORE_PATH), '.gitignore must exist at repo root');
});

test('.gitignore contains every required secret-class pattern', () => {
  const present = new Set(readLines());
  const missing = REQUIRED_PATTERNS.filter(p => !present.has(p));
  assert.deepEqual(missing, [],
    `.gitignore is missing required secret patterns:\n  ${missing.join('\n  ')}\n` +
    'Re-add them — they exist to keep credentials.json / id_rsa / *.pem / *.key out of git history.');
});

test('.env.example stays tracked (the public scaffold must remain visible)', () => {
  // git check-ignore exits 0 when the path IS ignored; 1 when it is NOT.
  // We want NOT-ignored — the example file is the public-facing template
  // for every required env var.
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', '.env.example'], { cwd: ROOT });
    ignored = true;   // exit 0 → ignored
  } catch (_) {
    ignored = false;  // exit 1 → not ignored (what we want)
  }
  assert.equal(ignored, false,
    '.env.example must NOT be gitignored (it is the public scaffold of required env vars). ' +
    'If you see this failure, the !.env.example re-include line was removed.');
});

test('no currently-tracked file matches a secret-class pattern', () => {
  // If a credentials.json was committed before the pattern was added,
  // gitignore alone won't remove it. Surface any existing tracked file
  // that LOOKS like a secret so it can be deliberately rotated + removed.
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  const SECRET_FILE_RE = /(^|\/)(\.env(\.[^/]+)?|\.envrc|id_rsa(\.pub)?|id_ed25519(\.pub)?|credentials\.json|service-account[^/]*\.json)$|\.(pem|key|p12|pfx|cer|crt)$/;
  // .env.example is the public scaffold — explicitly allowed.
  const ALLOWED = new Set(['.env.example']);

  const offenders = tracked.filter(f => SECRET_FILE_RE.test(f) && !ALLOWED.has(f));
  assert.deepEqual(offenders, [],
    `Files matching a secret-class pattern are tracked in git:\n  ${offenders.join('\n  ')}\n` +
    'These must be ROTATED (assume compromised) and removed from history (git filter-branch / BFG), ' +
    'not just deleted from the latest commit.');
});

test('.gitignore patterns are documented in this test (single source of truth)', () => {
  // Defensive symmetry: any pattern in the test's REQUIRED list must
  // appear in .gitignore (covered above) AND vice versa for the secret
  // section — we don't want a future commit silently removing the
  // documentation while keeping the .gitignore line, or vice versa.
  // This is a soft check: we only enforce that the file mentions the
  // "Secret material" sentinel comment, which signals the section's
  // intent to future readers.
  const txt = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  assert.match(txt, /#\s*Secret material/i,
    '.gitignore must carry the "# Secret material" sentinel comment that introduces the pinned section. ' +
    'It explains to future readers why these patterns can\'t be casually removed.');
});

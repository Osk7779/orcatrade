// Encode/decode shipper-profile inputs into URL-safe base64.
//
// Used by the Import Plan Builder share-permalink feature: the wizard generates
// a `/start/?p=<encoded>` URL that round-trips through the same form fields,
// so a share recipient sees the same plan recomputed against current pricing.
//
// Why encode inputs (not the full plan output):
//   - URLs stay short (~200 bytes vs ~13KB for a full plan)
//   - Recipients see fresh pricing if calculators are updated
//   - No backend storage needed → infinite scale, zero cost

const BASE64_URL_PAD = (b64) => b64 + '='.repeat((4 - (b64.length % 4)) % 4);

function toBase64Url(jsonString) {
  let b64;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(jsonString, 'utf8').toString('base64');
  } else {
    // Browser path: encode via TextEncoder → byte string → btoa
    const bytes = new TextEncoder().encode(jsonString);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url) {
  const padded = BASE64_URL_PAD(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Whitelist of input keys we round-trip — keeps URLs minimal and prevents
// arbitrary data from being shoved into the share URL.
const SHARE_KEYS = [
  'productCategory',
  'originCountry',
  'destinationCountry',
  'customsValueEur',
  'weightKg',
  'linesCount',
  'urgencyWeeks',
  'monthlyOrders',
  'avgUnitsPerOrder',
  'avgPalletsHeld',
  'avgOrderWeightKg',
  'claimPreferential',
  'hsCode',
  'moq',
  'targetFobUnitEur',
  'quoteCurrency',
  'paymentTermsDays',
  'shipmentsPerYear',
  'waccPct',
  'daysInInventory',
];

function encodeInputs(inputs) {
  if (!inputs || typeof inputs !== 'object') throw new Error('inputs must be object');
  const minimal = {};
  for (const k of SHARE_KEYS) {
    if (inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '') {
      minimal[k] = inputs[k];
    }
  }
  return toBase64Url(JSON.stringify(minimal));
}

function decodeInputs(b64url) {
  if (!b64url || typeof b64url !== 'string') throw new Error('b64url must be string');
  const json = fromBase64Url(b64url);
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('decoded payload not an object');
  // Whitelist again on decode — defence in depth against tampered URLs
  const safe = {};
  for (const k of SHARE_KEYS) {
    if (parsed[k] !== undefined) safe[k] = parsed[k];
  }
  return safe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { encodeInputs, decodeInputs, SHARE_KEYS, toBase64Url, fromBase64Url };
}

// EU trade defence measures — curated snapshot of active anti-dumping (AD)
// and countervailing (CVD) duties applicable to imports into the EU.
//
// PURPOSE
// MFN duty alone misrepresents landed cost when an active trade defence
// measure applies. A user importing bicycles ex-CN sees 14% MFN; the actual
// landed duty is 14% + 48.5% = 62.5%. This dataset surfaces those measures.
//
// SCOPE & LIMITS
// - Curated ~45 measures covering common SME-scale imports. NOT exhaustive.
// - Rate ranges reflect country-wide rates and the spread of named-exporter
//   rates from the relevant Implementing Regulation. Specific exporters
//   may have lower individual rates — verify TARIC before commitments.
// - Measures change: sunset reviews, anti-circumvention extensions, expiries.
//   Each entry carries asOf and citation for traceability.
// - This is a calibrated snapshot, not legal advice. Always verify on TARIC
//   (https://taric.ec.europa.eu) for the specific 8-digit code before
//   making commercial decisions.
//
// DATA STRUCTURE
// Each measure entry:
//   id          — short stable identifier
//   description — human-readable goods description
//   hsPrefix    — string or array of strings; matches by HS-code prefix
//                 (e.g. '8712' matches 871200, 87120030, etc.)
//   origins     — array of ISO-2 country codes
//   type        — 'AD' (anti-dumping), 'CVD' (countervailing), or 'BOTH'
//   rateMinPct  — minimum named-exporter rate
//   rateMaxPct  — country-wide / residual rate (typically the worst case)
//   rateTypicalPct — rate to use in headline calculation (often country-wide)
//   citation    — Implementing Regulation reference
//   asOf        — date the entry was calibrated (yyyy-mm-dd)
//   expiresOn   — sunset date if known, else null
//   notes       — extra context shown to users when the measure matches

const ASOF = '2026-05-08';

const MEASURES = [
  // ── Vehicles & e-mobility ─────────────────────────────────
  {
    id: 'CN_BICYCLES',
    description: 'Bicycles (non-electric)',
    hsPrefix: '8712',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 19.2,
    rateMaxPct: 48.5,
    rateTypicalPct: 48.5,
    citation: 'Reg. (EU) 2019/1379',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Country-wide rate 48.5%. Anti-circumvention measures extend the duty to bicycles assembled in Cambodia, Pakistan, Philippines, Sri Lanka, and Tunisia from Chinese parts unless specific exemption.',
  },
  {
    id: 'CN_BICYCLE_PARTS',
    description: 'Essential bicycle parts (frames, forks, brakes, pedals, wheels, gears)',
    hsPrefix: ['8714.91', '8714.92', '8714.93', '8714.94', '8714.95', '8714.96', '8714.99'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 48.5,
    rateMaxPct: 48.5,
    rateTypicalPct: 48.5,
    citation: 'Reg. (EU) 2020/45 (anti-circumvention extension of Reg. 2019/1379)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Anti-circumvention measure: bicycle parts dutied at the bicycle rate to prevent assembly-route evasion.',
  },
  {
    id: 'CN_E_BIKES_AD',
    description: 'Electric bicycles (e-bikes)',
    hsPrefix: '8711.60',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 10.3,
    rateMaxPct: 70.1,
    rateTypicalPct: 70.1,
    citation: 'Reg. (EU) 2019/73',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined with CVD: total can exceed 79%. Named cooperating exporters have lower individual rates.',
  },
  {
    id: 'CN_E_BIKES_CVD',
    description: 'Electric bicycles (e-bikes) — countervailing',
    hsPrefix: '8711.60',
    origins: ['CN'],
    type: 'CVD',
    rateMinPct: 3.9,
    rateMaxPct: 17.2,
    rateTypicalPct: 17.2,
    citation: 'Reg. (EU) 2019/72',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Countervailing duty on subsidisation; applies in addition to AD on same goods.',
  },
  {
    id: 'CN_BEV_PASSENGER_CARS',
    description: 'Battery electric passenger cars',
    hsPrefix: '8703.80',
    origins: ['CN'],
    type: 'CVD',
    rateMinPct: 17.0,
    rateMaxPct: 35.3,
    rateTypicalPct: 35.3,
    citation: 'Reg. (EU) 2024/2754 (October 2024)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Major recent measure. BYD 17.0%, Geely 18.8%, SAIC 35.3%; cooperating non-sampled 20.7%; non-cooperating 35.3%. Subject to ongoing EU-China negotiations on price undertakings.',
  },
  {
    id: 'CN_PNEUMATIC_TYRES_AD',
    description: 'Pneumatic tyres for buses and lorries',
    hsPrefix: ['4011.20', '4011.80'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 17.5,
    rateMaxPct: 35.7,
    rateTypicalPct: 35.7,
    citation: 'Reg. (EU) 2018/1690',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Per-unit duty (€/tyre) is also applied; effective ad valorem equivalent shown. Combined with CVD.',
  },
  {
    id: 'CN_PNEUMATIC_TYRES_CVD',
    description: 'Pneumatic tyres for buses and lorries — countervailing',
    hsPrefix: ['4011.20', '4011.80'],
    origins: ['CN'],
    type: 'CVD',
    rateMinPct: 2.5,
    rateMaxPct: 51.0,
    rateTypicalPct: 51.0,
    citation: 'Reg. (EU) 2018/1579',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined with AD on same goods. Country-wide CVD is high; cooperating exporters substantially lower.',
  },

  // ── Aluminum ─────────────────────────────────────────────
  {
    id: 'CN_ALUMINUM_EXTRUSIONS',
    description: 'Aluminium extrusions (bars, rods, profiles, tubes)',
    hsPrefix: ['7604', '7608', '7610'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 21.2,
    rateMaxPct: 32.1,
    rateTypicalPct: 32.1,
    citation: 'Reg. (EU) 2021/546',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Covers most architectural and industrial extrusions. Anti-circumvention extends to extrusions consigned via Türkiye and Thailand.',
  },
  {
    id: 'CN_ALUMINUM_FLAT_ROLLED',
    description: 'Aluminium flat-rolled products (sheet, plate, strip)',
    hsPrefix: ['7606', '7607.20'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 14.3,
    rateMaxPct: 24.6,
    rateTypicalPct: 24.6,
    citation: 'Reg. (EU) 2021/983',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Excludes can-stock and certain technical alloys (verify on TARIC).',
  },
  {
    id: 'CN_ALUMINUM_CONVERTER_FOIL',
    description: 'Aluminium converter foil (for further processing)',
    hsPrefix: '7607.11',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 22.4,
    rateMaxPct: 28.5,
    rateTypicalPct: 28.5,
    citation: 'Reg. (EU) 2021/2170 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Distinct from household foil (7607.11.19). Typical for capacitor, lithography, and packaging converter foil.',
  },

  // ── Steel ───────────────────────────────────────────────
  {
    id: 'CN_HOT_ROLLED_STEEL',
    description: 'Hot-rolled flat steel products (non-alloy and certain alloy)',
    hsPrefix: ['7208', '7211.13', '7211.14', '7211.19'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 18.1,
    rateMaxPct: 35.9,
    rateTypicalPct: 35.9,
    citation: 'Reg. (EU) 2017/649 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Steel safeguard quotas also apply (Reg. 2019/159) — additional 25% duty on out-of-quota volumes.',
  },
  {
    id: 'CN_COLD_ROLLED_STEEL',
    description: 'Cold-rolled flat steel products (non-alloy)',
    hsPrefix: ['7209', '7211.23', '7211.29'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 13.7,
    rateMaxPct: 22.1,
    rateTypicalPct: 22.1,
    citation: 'Reg. (EU) 2016/1328 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined with safeguard quota duty if exceeded.',
  },
  {
    id: 'CN_STAINLESS_COLD_ROLLED',
    description: 'Stainless steel cold-rolled flat products',
    hsPrefix: ['7219', '7220'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 24.4,
    rateMaxPct: 25.3,
    rateTypicalPct: 25.3,
    citation: 'Reg. (EU) 2015/1429 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Also see ID, IN, TW for related stainless measures.',
  },
  {
    id: 'CN_STEEL_FASTENERS',
    description: 'Iron or steel fasteners (screws, bolts, nuts, washers)',
    hsPrefix: '7318',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 22.1,
    rateMaxPct: 86.5,
    rateTypicalPct: 86.5,
    citation: 'Reg. (EU) 2022/191',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Country-wide rate is exceptionally high. Named exporters have rates as low as 22.1%; verify exporter eligibility on TARIC.',
  },
  {
    id: 'CN_STEEL_WIRE_ROD',
    description: 'Wire rod of iron or non-alloy steel',
    hsPrefix: '7213',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 14.6,
    rateMaxPct: 17.9,
    rateTypicalPct: 17.9,
    citation: 'Reg. (EU) 2022/619',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Subject to safeguard quotas as well.',
  },
  {
    id: 'CN_WELDED_TUBES',
    description: 'Welded tubes and pipes of iron or non-alloy steel',
    hsPrefix: '7306',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 30.8,
    rateMaxPct: 90.6,
    rateTypicalPct: 90.6,
    citation: 'Reg. (EU) 2015/110 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Specific subheadings — verify TARIC.',
  },
  {
    id: 'TR_COLD_ROLLED_STEEL',
    description: 'Cold-rolled flat steel products from Türkiye',
    hsPrefix: ['7209', '7211.23', '7211.29'],
    origins: ['TR'],
    type: 'AD',
    rateMinPct: 13.6,
    rateMaxPct: 23.3,
    rateTypicalPct: 23.3,
    citation: 'Reg. (EU) 2022/802',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Recent measure (2022) — frequently overlooked because TR has Customs Union benefits on most goods, but trade defence measures override the Customs Union.',
  },

  // ── Stainless steel from other origins ─────────────────
  {
    id: 'ID_STAINLESS_COLD_ROLLED',
    description: 'Stainless steel cold-rolled flat products (Indonesia)',
    hsPrefix: ['7219', '7220'],
    origins: ['ID'],
    type: 'BOTH',
    rateMinPct: 17.3,
    rateMaxPct: 21.4,
    rateTypicalPct: 21.4,
    citation: 'Reg. (EU) 2021/2287 (AD) + Reg. (EU) 2021/2306 (CVD)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined AD+CVD. Indonesia stainless is one of the most heavily measured corridors.',
  },
  {
    id: 'IN_STAINLESS_COLD_ROLLED',
    description: 'Stainless steel cold-rolled flat products (India)',
    hsPrefix: ['7219', '7220'],
    origins: ['IN'],
    type: 'BOTH',
    rateMinPct: 7.5,
    rateMaxPct: 13.6,
    rateTypicalPct: 13.6,
    citation: 'Reg. (EU) 2021/2287 (AD) + Reg. (EU) 2021/2306 (CVD)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined AD+CVD. Lower than ID rates.',
  },

  // ── Ceramics ────────────────────────────────────────────
  {
    id: 'CN_CERAMIC_TILES',
    description: 'Ceramic tiles (floor and wall)',
    hsPrefix: '6907',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 26.3,
    rateMaxPct: 69.7,
    rateTypicalPct: 69.7,
    citation: 'Reg. (EU) 2017/2227 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Country-wide rate 69.7%. Anti-circumvention extends to tiles consigned via Malaysia, Mexico, Türkiye.',
  },
  {
    id: 'CN_CERAMIC_TABLEWARE',
    description: 'Ceramic tableware and kitchenware',
    hsPrefix: ['6911', '6912'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 13.1,
    rateMaxPct: 36.1,
    rateTypicalPct: 36.1,
    citation: 'Reg. (EU) 2019/1198 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Country-wide rate 36.1%; named cooperating exporters as low as 13.1%.',
  },
  {
    id: 'CN_TABLEWARE_GLASS',
    description: 'Glass tableware and kitchenware',
    hsPrefix: '7013',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 17.6,
    rateMaxPct: 28.0,
    rateTypicalPct: 28.0,
    citation: 'Reg. (EU) 2018/1042 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Excludes pressed/blown glass for laboratory use, certain artistic items.',
  },
  {
    id: 'CN_FIBERGLASS_FABRIC_AD',
    description: 'Glass fibre fabrics (woven and stitched)',
    hsPrefix: '7019.39',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 24.3,
    rateMaxPct: 55.8,
    rateTypicalPct: 55.8,
    citation: 'Reg. (EU) 2020/776',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined with CVD on same goods.',
  },
  {
    id: 'CN_FIBERGLASS_FABRIC_CVD',
    description: 'Glass fibre fabrics — countervailing',
    hsPrefix: '7019.39',
    origins: ['CN'],
    type: 'CVD',
    rateMinPct: 17.0,
    rateMaxPct: 30.7,
    rateTypicalPct: 30.7,
    citation: 'Reg. (EU) 2020/870',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined with AD: total can exceed 80% effective duty.',
  },
  {
    id: 'EG_FIBERGLASS_FABRIC',
    description: 'Glass fibre fabrics (Egypt)',
    hsPrefix: '7019.39',
    origins: ['EG'],
    type: 'CVD',
    rateMinPct: 13.6,
    rateMaxPct: 13.6,
    rateTypicalPct: 13.6,
    citation: 'Reg. (EU) 2020/870',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Anti-circumvention from Chinese-origin upstream. Lower than CN rate.',
  },

  // ── Chemicals ───────────────────────────────────────────
  {
    id: 'CN_CITRIC_ACID',
    description: 'Citric acid and trisodium citrate',
    hsPrefix: ['2918.14', '2918.15'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 15.3,
    rateMaxPct: 42.7,
    rateTypicalPct: 42.7,
    citation: 'Reg. (EU) 2021/607',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Major bulk chemical commonly imported by food/pharma manufacturers.',
  },

  // ── Wood & paper ───────────────────────────────────────
  {
    id: 'CN_PLYWOOD',
    description: 'Plywood (birch and tropical hardwood faces)',
    hsPrefix: '4412',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 9.6,
    rateMaxPct: 66.0,
    rateTypicalPct: 66.0,
    citation: 'Reg. (EU) 2017/648 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Range is wide because named exporters have very different rates.',
  },

  // ── Textiles ───────────────────────────────────────────
  {
    id: 'CN_POLYESTER_STAPLE_FIBRE',
    description: 'Polyester staple fibres (PSF)',
    hsPrefix: '5503.20',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 4.9,
    rateMaxPct: 9.8,
    rateTypicalPct: 9.8,
    citation: 'Reg. (EU) 2019/1810 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Lower-rate measure but still meaningful on bulk volume.',
  },

  // ── Misc consumer & industrial ─────────────────────────
  {
    id: 'CN_HAND_PALLET_TRUCKS',
    description: 'Hand pallet trucks and parts',
    hsPrefix: ['8427.90', '8431.20'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 39.9,
    rateMaxPct: 70.8,
    rateTypicalPct: 70.8,
    citation: 'Reg. (EU) 2017/2206 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Anti-circumvention also extended to Thailand consignments.',
  },
  {
    id: 'CN_IRONING_BOARDS',
    description: 'Ironing boards (free-standing or built-in)',
    hsPrefix: '7323.93',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 22.7,
    rateMaxPct: 42.3,
    rateTypicalPct: 42.3,
    citation: 'Reg. (EU) 2019/1167 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Niche but heavily measured category.',
  },
  {
    id: 'CN_DISPOSABLE_LIGHTERS',
    description: 'Disposable pocket flint and gas lighters',
    hsPrefix: '9613.10',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 0.065,
    rateMaxPct: 0.065,
    rateTypicalPct: 0.065,
    rateUnit: 'EUR_PER_UNIT',
    citation: 'Reg. (EU) 2014/1062 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Specific duty: €0.065 per lighter (not ad valorem). Approximate ad valorem equivalent ~30% on cheap-end lighters.',
  },

  // ── Telecoms & electrical (high-value, frequently overlooked) ──
  {
    id: 'CN_OPTICAL_FIBRE_CABLES_AD',
    description: 'Single-mode optical fibre cables',
    hsPrefix: '8544.70',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 19.7,
    rateMaxPct: 44.0,
    rateTypicalPct: 44.0,
    citation: 'Reg. (EU) 2021/2011',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined with CVD on the same goods — total effective duty can exceed 50%. Named cooperating exporters have lower individual rates.',
  },
  {
    id: 'CN_OPTICAL_FIBRE_CABLES_CVD',
    description: 'Single-mode optical fibre cables — countervailing',
    hsPrefix: '8544.70',
    origins: ['CN'],
    type: 'CVD',
    rateMinPct: 5.1,
    rateMaxPct: 10.3,
    rateTypicalPct: 10.3,
    citation: 'Reg. (EU) 2022/72',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Applies in addition to the AD duty on the same cables.',
  },
  {
    id: 'CN_GRAPHITE_ELECTRODES',
    description: 'Graphite electrode systems (for electric arc furnaces)',
    hsPrefix: '8545.11',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 23.0,
    rateMaxPct: 74.9,
    rateTypicalPct: 74.9,
    citation: 'Reg. (EU) 2022/558',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Country-wide rate 74.9%; named cooperating exporters substantially lower. Per-tonne floor also applies in some cases — verify TARIC.',
  },

  // ── Coated & specialty steel ───────────────────────────────
  {
    id: 'CN_ORGANIC_COATED_STEEL_AD',
    description: 'Organic-coated (painted/lacquered) flat steel products',
    hsPrefix: ['7210.70', '7212.40', '7225.99', '7226.99'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 0,
    rateMaxPct: 26.1,
    rateTypicalPct: 26.1,
    citation: 'Reg. (EU) 2019/687',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Combined with CVD on the same goods. Used in white goods, panels, cladding.',
  },
  {
    id: 'CN_ORGANIC_COATED_STEEL_CVD',
    description: 'Organic-coated flat steel products — countervailing',
    hsPrefix: ['7210.70', '7212.40', '7225.99', '7226.99'],
    origins: ['CN'],
    type: 'CVD',
    rateMinPct: 13.7,
    rateMaxPct: 44.7,
    rateTypicalPct: 44.7,
    citation: 'Reg. (EU) 2019/688',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Applies in addition to AD on the same coated steel.',
  },
  {
    id: 'CN_CORROSION_RESISTANT_STEEL',
    description: 'Corrosion-resistant (metallic-coated) flat steel products',
    hsPrefix: ['7210.41', '7210.49', '7210.61', '7210.69', '7225.92', '7226.99.30'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 17.2,
    rateMaxPct: 27.9,
    rateTypicalPct: 27.9,
    citation: 'Reg. (EU) 2022/1395 (renewed; anti-circumvention extensions apply)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Anti-circumvention measures extend the duty to consignments via certain third countries — verify origin documentation.',
  },
  {
    id: 'CN_SEAMLESS_STAINLESS_PIPES',
    description: 'Seamless stainless steel pipes and tubes',
    hsPrefix: ['7304.11', '7304.22', '7304.24', '7304.41', '7304.49'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 48.3,
    rateMaxPct: 71.9,
    rateTypicalPct: 71.9,
    citation: 'Reg. (EU) 2017/2240 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Country-wide rate 71.9%; named exporters from 48.3%.',
  },
  {
    id: 'CN_STAINLESS_PIPE_FITTINGS',
    description: 'Stainless steel tube and pipe butt-welding fittings',
    hsPrefix: '7307.23',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 30.7,
    rateMaxPct: 64.9,
    rateTypicalPct: 64.9,
    citation: 'Reg. (EU) 2017/141 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Also see TW for related fittings measures. Anti-circumvention via Malaysia.',
  },
  {
    id: 'CN_WIND_STEEL_TOWERS',
    description: 'Utility-scale steel wind towers and sections',
    hsPrefix: ['7308.20', '8502.31'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 7.2,
    rateMaxPct: 19.2,
    rateTypicalPct: 19.2,
    citation: 'Reg. (EU) 2021/2239',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Covers steel towers for onshore/offshore wind turbines whether or not assembled with nacelle components.',
  },

  // ── Bulk chemicals ─────────────────────────────────────────
  {
    id: 'CN_SODIUM_GLUCONATE',
    description: 'Dry sodium gluconate',
    hsPrefix: '2918.16',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 5.6,
    rateMaxPct: 53.2,
    rateTypicalPct: 53.2,
    citation: 'Reg. (EU) 2018/1700 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Used in construction (concrete admixture), cleaning, and textiles. Country-wide rate 53.2%.',
  },
  {
    id: 'CN_TARTARIC_ACID',
    description: 'Tartaric acid',
    hsPrefix: '2918.12',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 8.3,
    rateMaxPct: 34.9,
    rateTypicalPct: 34.9,
    citation: 'Reg. (EU) 2018/921 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Excludes D-(-)-tartaric acid (specific optical rotation) — verify the isomer on TARIC.',
  },
  {
    id: 'CN_TCCA',
    description: 'Trichloroisocyanuric acid (TCCA, pool/water-treatment chemical)',
    hsPrefix: '2933.69',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 3.2,
    rateMaxPct: 42.6,
    rateTypicalPct: 42.6,
    citation: 'Reg. (EU) 2023/2659 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Common SME import for pool/spa and sanitation products. Country-wide rate 42.6%.',
  },
  {
    id: 'CN_MELAMINE',
    description: 'Melamine',
    hsPrefix: '2933.61',
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 0,
    rateMaxPct: 65.2,
    rateTypicalPct: 65.2,
    citation: 'Reg. (EU) 2023/1776 (renewed)',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Measure is a minimum import price (MIP) for cooperating exporters (≈€415/tonne floor); residual ad valorem 65.2% for others. Used in laminates, adhesives, moulding compounds.',
  },
  {
    id: 'CN_FATTY_ACID',
    description: 'Fatty acid (oleochemical)',
    hsPrefix: ['2915.70', '3823.11', '3823.12', '3823.13', '3823.19'],
    origins: ['CN'],
    type: 'AD',
    rateMinPct: 12.6,
    rateMaxPct: 56.7,
    rateTypicalPct: 56.7,
    citation: 'Reg. (EU) 2023/111',
    asOf: ASOF,
    expiresOn: null,
    notes: 'Recent measure (2023). Inputs for soaps, cosmetics, lubricants, candles. Country-wide rate 56.7%.',
  },
];

// ── Lookup ──────────────────────────────────────────────

function hsMatchesPrefix(hsCode, prefix) {
  if (!hsCode) return false;
  const normalised = String(hsCode).replace(/[^0-9]/g, '');
  const prefixNorm = String(prefix).replace(/[^0-9]/g, '');
  return normalised.startsWith(prefixNorm);
}

// `measures` defaults to the live MEASURES table. Reproducibility-v2 slice 3b
// passes a pinned measures array (from a stored snapshot) so a historical
// recompute filters the SAME way against the rates that were in effect then —
// the filter/aggregate logic is shared, never reimplemented.
function findMeasures({ hsCode, originCountry, measures = MEASURES }) {
  if (!hsCode || !originCountry) return [];
  const origin = String(originCountry).toUpperCase();
  const matches = [];
  for (const measure of measures) {
    if (!measure.origins || !measure.origins.includes(origin)) continue;
    const prefixes = Array.isArray(measure.hsPrefix) ? measure.hsPrefix : [measure.hsPrefix];
    const hit = prefixes.some(p => hsMatchesPrefix(hsCode, p));
    if (hit) matches.push(measure);
  }
  return matches;
}

// Sums the typical rate of all matching measures. AD and CVD on the same
// goods are cumulative (this is how EU customs applies them).
function aggregateRate(matches) {
  if (!matches.length) return { totalPct: 0, components: [] };
  const components = matches
    .filter(m => m.rateUnit !== 'EUR_PER_UNIT') // skip specific duties from ad valorem totalling
    .map(m => ({
      id: m.id,
      type: m.type,
      ratePct: m.rateTypicalPct,
      description: m.description,
      citation: m.citation,
    }));
  const totalPct = components.reduce((sum, c) => sum + c.ratePct, 0);
  return { totalPct, components, specificDuties: matches.filter(m => m.rateUnit === 'EUR_PER_UNIT') };
}

function listMeasures() {
  return MEASURES.map(m => ({
    id: m.id,
    description: m.description,
    origins: m.origins,
    type: m.type,
    rateTypicalPct: m.rateTypicalPct,
    citation: m.citation,
  }));
}

module.exports = {
  MEASURES,
  ASOF,
  findMeasures,
  aggregateRate,
  hsMatchesPrefix,
  listMeasures,
};

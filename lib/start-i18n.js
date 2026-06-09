// Backend i18n strings for the Import Plan Builder email summary.
//
// Used by lib/handlers/start.js. Each locale provides:
//   - subject(inputs) → string
//   - userBody({ inputs, plan, totals, name, shareUrl, siteOrigin }) → string
//   - founderBody({ inputs, plan, totals, name, email, companyName, shareUrl }) → string
//   - leadSubject({ inputs }) → string (LEAD prefix)

// ── Tier-A badge block (ADR 0020) ────────────────────────────────────
//
// Inserted into the userBody when plan.customs.tier_a.eligible === true.
// Wording is careful:
//   - Names exactly what eligibility MEANS (primary-regulator sources,
//     ≤30 days, regression-tested calculator, no manual overrides).
//   - Calls out the liability-bearing accuracy guarantee as
//     FORTHCOMING (Q1 2027 target per docs/strategic-plan-2026-2031.md
//     §5.1) — never claims a guarantee that isn't bound yet. The
//     [feedback_corp_standard] + [pre_revenue_stage] memory rules
//     forbid shipping a promise without its enforcement.

function tierABlockEn(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE CALCULATION
This duty calculation cited primary-regulator sources (EU TARIC live
rates) snapshotted within the last 30 days, was produced by our
regression-tested customs calculator, and carried no manual overrides.
Our liability-bearing accuracy guarantee for Tier-A calculations
launches in Q1 2027 (covered by E&O insurance, subject to binding).
Until then, Tier-A is a transparency signal you can audit, not a
financial guarantee.`;
}

function tierABlockPl(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · KALKULACJA POZIOMU UNDERWRITERSKIEGO
Ta kalkulacja cła została oparta wyłącznie na źródłach regulatora
pierwotnego (stawki TARIC pobierane na żywo), pochodzących z ostatnich
30 dni, wyprodukowana przez nasz kalkulator celny pokryty regresjami
i nie zawierała żadnych manualnych nadpisów. Nasza gwarancja
poprawności kalkulacji Tier-A (z odpowiedzialnością odszkodowawczą)
wystartuje w Q1 2027 (zabezpieczona ubezpieczeniem E&O, w trakcie
wiązania). Do tego czasu Tier-A to sygnał przejrzystości, który
można audytować — a nie zobowiązanie finansowe.`;
}

function tierABlockDe(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE-KALKULATION
Diese Zollberechnung basierte ausschließlich auf primärregulatorischen
Quellen (EU-TARIC-Live-Sätze), die innerhalb der letzten 30 Tage
gepinnt wurden, wurde von unserem regressionsgetesteten Zollkalkulator
erstellt und enthielt keine manuellen Übersteuerungen. Unsere haftungs-
tragende Genauigkeitsgarantie für Tier-A-Berechnungen startet im
Q1 2027 (durch E&O-Versicherung gedeckt, vorbehaltlich der Bindung).
Bis dahin ist Tier-A ein auditierbares Transparenzsignal — keine
finanzielle Garantie.`;
}

// ── Sourcing Tier-A blocks (PR #109/#110) ─────────────────────────────
//
// Parallel to the customs blocks above. Same wording discipline:
// describes what eligibility MEANS for sourcing (primary trade-data
// sources, 30-day snapshot freshness, regression-tested sourcing
// calculator, no manual overrides) and calls out the accuracy
// guarantee as FORTHCOMING — never claims an active guarantee. A
// drift-guard test enforces both rules across all three locales.

function tierABlockSourcingEn(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE SOURCING COMPARISON
This sourcing recommendation cited primary-regulator sources
(international trade indices) snapshotted within the last 30 days,
was produced by our regression-tested sourcing calculator, and
carried no manual overrides.
Our liability-bearing accuracy guarantee for Tier-A calculations
launches in Q1 2027 (covered by E&O insurance, subject to binding).
Until then, Tier-A is a transparency signal you can audit, not a
financial guarantee.`;
}

function tierABlockSourcingPl(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · PORÓWNANIE ŹRÓDEŁ POZIOMU UNDERWRITERSKIEGO
Ta rekomendacja sourcingowa została oparta wyłącznie na źródłach
regulatora pierwotnego (międzynarodowe indeksy handlowe),
pochodzących z ostatnich 30 dni, wyprodukowana przez nasz kalkulator
sourcingu pokryty regresjami i nie zawierała żadnych manualnych
nadpisów. Nasza gwarancja poprawności kalkulacji Tier-A
(z odpowiedzialnością odszkodowawczą) wystartuje w Q1 2027
(zabezpieczona ubezpieczeniem E&O, w trakcie wiązania). Do tego
czasu Tier-A to sygnał przejrzystości, który można audytować —
a nie zobowiązanie finansowe.`;
}

function tierABlockSourcingDe(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE-SOURCING-VERGLEICH
Diese Sourcing-Empfehlung basierte ausschließlich auf
primärregulatorischen Quellen (internationale Handelsindizes), die
innerhalb der letzten 30 Tage gepinnt wurden, wurde von unserem
regressionsgetesteten Sourcing-Kalkulator erstellt und enthielt
keine manuellen Übersteuerungen. Unsere haftungstragende
Genauigkeitsgarantie für Tier-A-Berechnungen startet im Q1 2027
(durch E&O-Versicherung gedeckt, vorbehaltlich der Bindung). Bis
dahin ist Tier-A ein auditierbares Transparenzsignal — keine
finanzielle Garantie.`;
}

// ── Routing Tier-A blocks (PR #114) ───────────────────────────────────
//
// Parallel to the customs + sourcing blocks. Same wording discipline:
// describes what eligibility MEANS for routing (carrier-published rate
// indices, 30-day snapshot freshness, regression-tested routing
// calculator, no manual overrides) and calls out the accuracy
// guarantee as FORTHCOMING — never claims an active guarantee. A
// drift-guard test enforces both rules across all three locales.

function tierABlockRoutingEn(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE FREIGHT QUOTE
This routing recommendation cited primary-regulator sources
(carrier-published rate indices) snapshotted within the last 30
days, was produced by our regression-tested routing calculator, and
carried no manual overrides.
Our liability-bearing accuracy guarantee for Tier-A calculations
launches in Q1 2027 (covered by E&O insurance, subject to binding).
Until then, Tier-A is a transparency signal you can audit, not a
financial guarantee.`;
}

function tierABlockRoutingPl(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · WYCENA FRACHTU POZIOMU UNDERWRITERSKIEGO
Ta rekomendacja routingu została oparta wyłącznie na źródłach
regulatora pierwotnego (indeksy stawek opublikowane przez
przewoźników), pochodzących z ostatnich 30 dni, wyprodukowana
przez nasz kalkulator routingu pokryty regresjami i nie zawierała
żadnych manualnych nadpisów. Nasza gwarancja poprawności
kalkulacji Tier-A (z odpowiedzialnością odszkodowawczą)
wystartuje w Q1 2027 (zabezpieczona ubezpieczeniem E&O, w trakcie
wiązania). Do tego czasu Tier-A to sygnał przejrzystości, który
można audytować — a nie zobowiązanie finansowe.`;
}

function tierABlockRoutingDe(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE-FRACHTANGEBOT
Diese Routing-Empfehlung basierte ausschließlich auf
primärregulatorischen Quellen (von Spediteuren veröffentlichte
Frachtraten-Indizes), die innerhalb der letzten 30 Tage gepinnt
wurden, wurde von unserem regressionsgetesteten Routing-Kalkulator
erstellt und enthielt keine manuellen Übersteuerungen. Unsere
haftungstragende Genauigkeitsgarantie für Tier-A-Berechnungen
startet im Q1 2027 (durch E&O-Versicherung gedeckt, vorbehaltlich
der Bindung). Bis dahin ist Tier-A ein auditierbares
Transparenzsignal — keine finanzielle Garantie.`;
}

// ── Finance (PR #116 wiring + this PR's email surface) ──────────────
//
// Parallel to the customs + sourcing + routing blocks. Same wording
// discipline: describes what eligibility MEANS for the financing
// recommendation (central-bank rate tables for FX, 30-day snapshot
// freshness, regression-tested finance calculator, no manual
// overrides) and calls out the accuracy guarantee as FORTHCOMING.
// Note: today's calculator carries a partner-bank PRICING_SNAPSHOT
// (mirror only) so TA-2 fails and these helpers reliably return ''.
// When ECB FX lands and Tier-A starts passing for finance quotes,
// the badge will start appearing in the email and pill. The wording
// is locked in now so the surface lights up the moment the upstream
// data flips primary.

function tierABlockFinanceEn(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE FINANCING RECOMMENDATION
This financing recommendation cited primary-regulator sources
(central-bank rate tables) snapshotted within the last 30 days,
was produced by our regression-tested finance calculator, and
carried no manual overrides.
Our liability-bearing accuracy guarantee for Tier-A calculations
launches in Q1 2027 (covered by E&O insurance, subject to binding).
Until then, Tier-A is a transparency signal you can audit, not a
financial guarantee.`;
}

function tierABlockFinancePl(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · REKOMENDACJA FINANSOWANIA POZIOMU UNDERWRITERSKIEGO
Ta rekomendacja finansowania została oparta wyłącznie na źródłach
regulatora pierwotnego (tabele kursowe banków centralnych),
pochodzących z ostatnich 30 dni, wyprodukowana przez nasz
kalkulator finansowy pokryty regresjami i nie zawierała żadnych
manualnych nadpisów. Nasza gwarancja poprawności kalkulacji
Tier-A (z odpowiedzialnością odszkodowawczą) wystartuje w Q1
2027 (zabezpieczona ubezpieczeniem E&O, w trakcie wiązania). Do
tego czasu Tier-A to sygnał przejrzystości, który można
audytować — a nie zobowiązanie finansowe.`;
}

function tierABlockFinanceDe(verdict) {
  if (!verdict || verdict.eligible !== true) return '';
  return `\nTIER-A · UNDERWRITER-GRADE-FINANZIERUNGSEMPFEHLUNG
Diese Finanzierungsempfehlung basierte ausschließlich auf
primärregulatorischen Quellen (zentralbankseitige Kurstabellen),
die innerhalb der letzten 30 Tage gepinnt wurden, wurde von
unserem regressionsgetesteten Finanzkalkulator erstellt und
enthielt keine manuellen Übersteuerungen. Unsere haftungstragende
Genauigkeitsgarantie für Tier-A-Berechnungen startet im Q1 2027
(durch E&O-Versicherung gedeckt, vorbehaltlich der Bindung). Bis
dahin ist Tier-A ein auditierbares Transparenzsignal — keine
finanzielle Garantie.`;
}

const STRINGS = {
  en: {
    subject: ({ inputs }) =>
      `Your import plan: ${inputs.productCategory} ${inputs.originCountry} → ${inputs.destinationCountry}`,
    leadSubject: ({ inputs }) =>
      `LEAD · Your import plan: ${inputs.productCategory} ${inputs.originCountry} → ${inputs.destinationCountry}`,
    userBody: ({ inputs, plan, totals: t, name, shareUrl, siteOrigin }) => `Hello${name ? ' ' + name : ''},

Your personalised OrcaTrade import plan is ready.

SHIPMENT
- Category: ${inputs.productCategory}
- Route: ${inputs.originCountry} → ${inputs.destinationCountry}
- Customs value: €${inputs.customsValueEur.toLocaleString('en-IE')}
- Weight: ${inputs.weightKg} kg

RECOMMENDATION
- Sourcing: ${plan.sourcing?.recommendation?.primary || 'see report'} ${plan.sourcing?.recommendation?.primary === inputs.originCountry ? '(matches your origin)' : '(consider this alternative)'}
- Transport: ${plan.routing?.recommendation?.primary?.toUpperCase() || 'see report'}
- Clearance: ${plan.customs?.recommendation?.primary?.replace('_', ' ') || 'standard'}
${plan.warehouse?.recommendation ? `- 3PL hub: ${plan.warehouse.recommendation.primary}` : ''}
${(plan.customs?.tradeDefenceMeasures || []).length ? `\nTRADE DEFENCE ALERT (additional duties already in figures above)\n${plan.customs.tradeDefenceMeasures.map(m => `- ${m.type} ${m.rateTypicalPct}% on ${m.description} — ${m.citation}`).join('\n')}\nVerify exporter eligibility on TARIC (https://taric.ec.europa.eu) — named exporters may have lower individual rates.` : ''}
${plan.customs?.preferentialApplied ? `\nPREFERENTIAL ORIGIN APPLIED\n- Regime: ${plan.customs.preferentialApplied.name}\n- Required document: ${plan.customs.preferentialApplied.document}` : ''}
${(plan.customs?.preferentialAvailable && plan.customs?.preferentialAvailable.mfnReplaced && (plan.customs?.preferentialSavingEur || 0) > 0) ? `\nDUTY-SAVING OPPORTUNITY\nYou may qualify for ${plan.customs.preferentialAvailable.name} which would save approximately €${plan.customs.preferentialSavingEur.toLocaleString('en-IE')} on this shipment.\nRequired document: ${plan.customs.preferentialAvailable.document}\nAsk your supplier to provide it, then re-run with "preferential origin: yes".` : ''}
${(plan.compliance?.regimes || []).length ? `\nEU COMPLIANCE OVERLAY (${plan.compliance.regimes.length} regime${plan.compliance.regimes.length > 1 ? 's' : ''})\n${plan.compliance.regimes.map(r => `- [${r.severity.toUpperCase()}] ${r.name} — ${r.importerObligation}`).join('\n')}` : ''}
${plan.originSensitivity?.savingEurVsUserOrigin > 0 && plan.originSensitivity?.savingPctVsUserOrigin >= 5 ? `\nORIGIN SENSITIVITY\nSourcing from ${plan.originSensitivity.cheapestOrigin} instead of ${plan.originSensitivity.userOrigin} would save ~€${plan.originSensitivity.savingEurVsUserOrigin.toLocaleString('en-IE')}/shipment (${plan.originSensitivity.savingPctVsUserOrigin}%).\nFull matrix:\n${plan.originSensitivity.matrix.map(e => `- ${e.origin}${e.isUserChoice ? ' (your pick)' : ''}: duty ${e.dutyRatePct.toFixed(1)}%, transport ${Math.round(e.transportEur)}€, landed €${Math.round(e.perShipmentLandedTotal).toLocaleString('en-IE')}/shipment${e.preferentialApplied ? ` [${e.preferentialApplied}]` : ''}`).join('\n')}` : ''}
${plan.fx && plan.fx.ok && !plan.fx.noFxRisk ? `\nFX RISK (supplier quotes in ${plan.fx.currency}, ${plan.fx.paymentTermsDays}-day terms)\n- Spot: 1 EUR = ${plan.fx.spotRateForeignPerEur.toFixed(4)} ${plan.fx.currency}\n- 1-sigma 90-day adverse move: +€${plan.fx.riskEur1Sigma90d.toLocaleString('en-IE')} on this shipment\n- Forward hedge cost: ~€${plan.fx.hedgeCostEur.toLocaleString('en-IE')} (${plan.fx.hedgeCostBp} bp)\n- Recommendation: ${plan.fx.recommendation.toUpperCase()} — ${plan.fx.rationale}` : ''}
${plan.tco && plan.tco.ok ? `\nANNUAL TCO (${plan.tco.inputs.shipmentsPerYear} shipments/year, ${plan.tco.inputs.waccPct}% WACC, ${plan.tco.inputs.daysInInventory}d avg inventory)\n- Annual customs throughput: €${plan.tco.main.annualCustomsValueEur.toLocaleString('en-IE')}\n- Annual net cost (duty + freight + brokerage + 3PL + carrying): €${plan.tco.main.annualNetCostWithWarehouse.toLocaleString('en-IE')}\n- Annual cash-flow cost (incl. VAT): €${plan.tco.main.annualCashFlowCostWithWarehouse.toLocaleString('en-IE')}\n- Inventory carrying cost: €${plan.tco.main.inventoryCarryingCostEur.toLocaleString('en-IE')}\n- Cost per €1 throughput: ${plan.tco.costPerEurThroughputBp} bp${plan.tco.bonded.worthExploring ? `\n- Bonded warehouse could defer up to €${plan.tco.bonded.potentialDeferralValueEur.toLocaleString('en-IE')}/year of working capital tied up in duty + VAT.` : ''}` : ''}
${plan.workingCapital && plan.workingCapital.ok ? `\nCASH CONVERSION CYCLE\n- CCC: ${plan.workingCapital.ccc} days = ${plan.workingCapital.dio} (inventory) + ${plan.workingCapital.dso} (receivable) − ${plan.workingCapital.dpo} (payable)\n- Working capital tied up at any moment: €${plan.workingCapital.workingCapitalEur.toLocaleString('en-IE')}\n- Annual cost of working capital: €${plan.workingCapital.annualCapitalCostEur.toLocaleString('en-IE')} (${plan.workingCapital.inputs.waccPct}% WACC)\n- Each day shaved frees €${plan.workingCapital.dayValueEur.toLocaleString('en-IE')} of capital. Best lever: ${plan.workingCapital.levers[0].label} → save €${Math.abs(plan.workingCapital.levers[0].annualCostDelta).toLocaleString('en-IE')}/year.` : ''}
${tierABlockEn(plan.customs && plan.customs.tier_a)}${tierABlockSourcingEn(plan.sourcing && plan.sourcing.tier_a)}${tierABlockRoutingEn(plan.routing && plan.routing.tier_a)}${tierABlockFinanceEn(plan.finance && plan.finance.tier_a)}
LANDED COST (per shipment)
- Transport: €${Math.round(t.transportEur).toLocaleString('en-IE')}
- Customs duty: €${Math.round(t.dutyEur).toLocaleString('en-IE')}
- Import VAT: €${Math.round(t.vatEur).toLocaleString('en-IE')}
- Brokerage: €${Math.round(t.brokerageEur).toLocaleString('en-IE')}
- TOTAL LANDED: €${Math.round(t.perShipmentLandedTotal).toLocaleString('en-IE')}

REVISIT YOUR PLAN
Open this link any time — it stays linked to live pricing, so you'll see fresh
duty rates and freight numbers when our calculators update.
${shareUrl}

NEXT STEPS
- Open the Operations Orchestrator to refine: ${siteOrigin}/agent/orchestrator/
- Browse our calculator-grounded guides: ${siteOrigin}/guides/
- Reply to this email for a 15-minute call with our HK office.

— OrcaTrade Group
  Warsaw · London · Hong Kong`,
    founderBody: ({ inputs, plan, totals: t, name, email, companyName, shareUrl }) => `New import-plan lead from /start/

CONTACT
- Email: ${email}
- Name: ${name || '(not provided)'}
- Company: ${companyName || '(not provided)'}

INPUTS
${JSON.stringify(inputs, null, 2)}

RECOMMENDATION (per shipment)
- Total landed: €${Math.round(t.perShipmentLandedTotal).toLocaleString('en-IE')}
- Transport: ${plan.routing?.recommendation?.primary} · €${Math.round(t.transportEur)}
- Clearance: ${plan.customs?.recommendation?.primary}
${plan.warehouse?.recommendation ? `- 3PL: ${plan.warehouse.recommendation.primary} · €${plan.totals.warehouseMonthlyEur}/mo` : '- 3PL: not in scope'}

PERMALINK (open the lead's plan): ${shareUrl}

Reach out within 24h for high-quality intent.`,
  },

  pl: {
    subject: ({ inputs }) =>
      `Twój plan importu: ${inputs.productCategory} ${inputs.originCountry} → ${inputs.destinationCountry}`,
    leadSubject: ({ inputs }) =>
      `LEAD · Plan importu: ${inputs.productCategory} ${inputs.originCountry} → ${inputs.destinationCountry}`,
    userBody: ({ inputs, plan, totals: t, name, shareUrl, siteOrigin }) => `Witaj${name ? ' ' + name : ''},

Twój spersonalizowany plan importu OrcaTrade jest gotowy.

PRZESYŁKA
- Kategoria: ${inputs.productCategory}
- Trasa: ${inputs.originCountry} → ${inputs.destinationCountry}
- Wartość celna: €${inputs.customsValueEur.toLocaleString('pl-PL')}
- Waga: ${inputs.weightKg} kg

REKOMENDACJA
- Sourcing: ${plan.sourcing?.recommendation?.primary || 'zobacz raport'} ${plan.sourcing?.recommendation?.primary === inputs.originCountry ? '(zgadza się z Twoim wyborem)' : '(rozważ tę alternatywę)'}
- Transport: ${plan.routing?.recommendation?.primary?.toUpperCase() || 'zobacz raport'}
- Odprawa: ${plan.customs?.recommendation?.primary?.replace('_', ' ') || 'standardowa'}
${plan.warehouse?.recommendation ? `- Hub 3PL: ${plan.warehouse.recommendation.primary}` : ''}
${tierABlockPl(plan.customs && plan.customs.tier_a)}${tierABlockSourcingPl(plan.sourcing && plan.sourcing.tier_a)}${tierABlockRoutingPl(plan.routing && plan.routing.tier_a)}${tierABlockFinancePl(plan.finance && plan.finance.tier_a)}
KOSZT LANDED (za przesyłkę)
- Transport: €${Math.round(t.transportEur).toLocaleString('pl-PL')}
- Cło importowe: €${Math.round(t.dutyEur).toLocaleString('pl-PL')}
- VAT importowy: €${Math.round(t.vatEur).toLocaleString('pl-PL')}
- Agencja celna: €${Math.round(t.brokerageEur).toLocaleString('pl-PL')}
- ŁĄCZNY KOSZT LANDED: €${Math.round(t.perShipmentLandedTotal).toLocaleString('pl-PL')}

WRÓĆ DO PLANU
Otwórz ten link w dowolnym momencie — jest powiązany z aktualnymi cenami,
więc zobaczysz świeże stawki cła i frachtu, gdy nasze kalkulatory zostaną zaktualizowane.
${shareUrl}

CO DALEJ
- Otwórz Operations Orchestrator, by pogłębić plan: ${siteOrigin}/agent/orchestrator/
- Przeglądaj nasze poradniki oparte na kalkulatorach: ${siteOrigin}/guides/
- Odpisz na tę wiadomość, by umówić 15-minutową rozmowę z naszym biurem w HK.

— OrcaTrade Group
  Warszawa · Londyn · Hongkong`,
    founderBody: ({ inputs, plan, totals: t, name, email, companyName, shareUrl }) => `Nowy lead z /pl/start/

KONTAKT
- E-mail: ${email}
- Imię: ${name || '(nie podano)'}
- Firma: ${companyName || '(nie podano)'}

DANE WEJŚCIOWE
${JSON.stringify(inputs, null, 2)}

REKOMENDACJA (za przesyłkę)
- Łączny koszt landed: €${Math.round(t.perShipmentLandedTotal).toLocaleString('pl-PL')}
- Transport: ${plan.routing?.recommendation?.primary} · €${Math.round(t.transportEur)}
- Odprawa: ${plan.customs?.recommendation?.primary}
${plan.warehouse?.recommendation ? `- 3PL: ${plan.warehouse.recommendation.primary} · €${plan.totals.warehouseMonthlyEur}/mc` : '- 3PL: poza zakresem'}

PERMALINK (otwórz plan leada): ${shareUrl}

Skontaktuj się w ciągu 24h — wysoka intencja zakupowa.`,
  },

  de: {
    subject: ({ inputs }) =>
      `Ihr Importplan: ${inputs.productCategory} ${inputs.originCountry} → ${inputs.destinationCountry}`,
    leadSubject: ({ inputs }) =>
      `LEAD · Importplan: ${inputs.productCategory} ${inputs.originCountry} → ${inputs.destinationCountry}`,
    userBody: ({ inputs, plan, totals: t, name, shareUrl, siteOrigin }) => `Hallo${name ? ' ' + name : ''},

Ihr personalisierter OrcaTrade-Importplan ist bereit.

SENDUNG
- Kategorie: ${inputs.productCategory}
- Route: ${inputs.originCountry} → ${inputs.destinationCountry}
- Zollwert: €${inputs.customsValueEur.toLocaleString('de-DE')}
- Gewicht: ${inputs.weightKg} kg

EMPFEHLUNG
- Sourcing: ${plan.sourcing?.recommendation?.primary || 'siehe Bericht'} ${plan.sourcing?.recommendation?.primary === inputs.originCountry ? '(passt zu Ihrer Wahl)' : '(als Alternative prüfen)'}
- Transport: ${plan.routing?.recommendation?.primary?.toUpperCase() || 'siehe Bericht'}
- Abfertigung: ${plan.customs?.recommendation?.primary?.replace('_', ' ') || 'standard'}
${plan.warehouse?.recommendation ? `- 3PL-Hub: ${plan.warehouse.recommendation.primary}` : ''}
${tierABlockDe(plan.customs && plan.customs.tier_a)}${tierABlockSourcingDe(plan.sourcing && plan.sourcing.tier_a)}${tierABlockRoutingDe(plan.routing && plan.routing.tier_a)}${tierABlockFinanceDe(plan.finance && plan.finance.tier_a)}
LANDED COST (pro Sendung)
- Transport: €${Math.round(t.transportEur).toLocaleString('de-DE')}
- Einfuhrzoll: €${Math.round(t.dutyEur).toLocaleString('de-DE')}
- Einfuhrumsatzsteuer: €${Math.round(t.vatEur).toLocaleString('de-DE')}
- Verzollung: €${Math.round(t.brokerageEur).toLocaleString('de-DE')}
- LANDED COST GESAMT: €${Math.round(t.perShipmentLandedTotal).toLocaleString('de-DE')}

PLAN ERNEUT ÖFFNEN
Öffnen Sie diesen Link jederzeit — er bleibt mit Live-Preisen verknüpft, sodass Sie
aktuelle Zollsätze und Frachtkosten sehen, wenn unsere Kalkulatoren aktualisiert werden.
${shareUrl}

NÄCHSTE SCHRITTE
- Operations Orchestrator öffnen, um den Plan zu vertiefen: ${siteOrigin}/agent/orchestrator/
- Unsere kalkulator-basierten Leitfäden ansehen: ${siteOrigin}/guides/
- Antworten Sie auf diese E-Mail für ein 15-minütiges Gespräch mit unserem HK-Büro.

— OrcaTrade Group
  Warschau · London · Hongkong`,
    founderBody: ({ inputs, plan, totals: t, name, email, companyName, shareUrl }) => `Neuer Lead aus /de/start/

KONTAKT
- E-Mail: ${email}
- Name: ${name || '(nicht angegeben)'}
- Firma: ${companyName || '(nicht angegeben)'}

EINGABEN
${JSON.stringify(inputs, null, 2)}

EMPFEHLUNG (pro Sendung)
- Landed Cost gesamt: €${Math.round(t.perShipmentLandedTotal).toLocaleString('de-DE')}
- Transport: ${plan.routing?.recommendation?.primary} · €${Math.round(t.transportEur)}
- Abfertigung: ${plan.customs?.recommendation?.primary}
${plan.warehouse?.recommendation ? `- 3PL: ${plan.warehouse.recommendation.primary} · €${plan.totals.warehouseMonthlyEur}/Monat` : '- 3PL: nicht im Umfang'}

PERMALINK (Plan des Leads öffnen): ${shareUrl}

Innerhalb von 24h melden — hohe Kaufabsicht.`,
  },
};

function pickLocale(locale) {
  return STRINGS[locale] ? locale : 'en';
}

module.exports = {
  STRINGS,
  pickLocale,
  tierABlockEn,
  tierABlockPl,
  tierABlockDe,
  tierABlockSourcingEn,
  tierABlockSourcingPl,
  tierABlockSourcingDe,
  tierABlockRoutingEn,
  tierABlockRoutingPl,
  tierABlockRoutingDe,
  tierABlockFinanceEn,
  tierABlockFinancePl,
  tierABlockFinanceDe,
};

// Generates localised agent landing pages from the English source.
//
// Reads each /agent/<name>/index.html (canonical EN), applies a translation
// dictionary, rewrites relative paths to absolute, sets window.LOCALE, and
// writes /pl/agent/<name>/index.html and /de/agent/<name>/index.html.
//
// Run: node scripts/build-agent-locales.js

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const AGENTS = ['orchestrator', 'sourcing', 'logistics', 'finance', 'compliance'];

// Map slug → directory under /agent/. Compliance lives at /agent/ (root).
const AGENT_DIR = {
  orchestrator: 'agent/orchestrator',
  sourcing: 'agent/sourcing',
  logistics: 'agent/logistics',
  finance: 'agent/finance',
  compliance: 'agent',
};

const AGENT_OUTDIR = {
  orchestrator: 'agent/orchestrator',
  sourcing: 'agent/sourcing',
  logistics: 'agent/logistics',
  finance: 'agent/finance',
  compliance: 'agent',
};

// ── Translations ───────────────────────────────────────

const TR = {
  pl: {
    orchestrator: {
      title: 'OrcaTrade Operations Orchestrator — Jeden agent, każda specjalność',
      description: 'Porozmawiaj z Operations Orchestrator OrcaTrade — agent AI z dostępem do wszystkich narzędzi specjalistów Compliance i Logistyki. Pyta o import do UE, dobiera odpowiednie narzędzia, łączy domeny w jednej odpowiedzi.',
      kicker: 'Operations Orchestrator · 16 narzędzi · Compliance + Logistyka',
      h1: 'Jeden agent, <em>każda specjalność</em>.',
      intro: 'Pytaj o cokolwiek związanego z importem do UE. Mam dostęp do każdego narzędzia, które mają specjaliści Compliance i Logistyki — wybiorę odpowiednie, nawet gdy Twoje pytanie przekracza domeny. Większość przydatnych pytań przekracza co najmniej dwie.',
      welcome: 'Powiedz mi, co importujesz — pochodzenie, kraj docelowy, jakie towary. Sprawdzę które regulacje obowiązują (CBAM, EUDR, REACH, CE), jak wygląda landed cost (cło, VAT, agencja celna, opcje składu) i gdzie towar powinien znajdować się w Europie (huby 3PL). Wszystko w jednej odpowiedzi.',
      send: 'Wyślij',
      placeholder: 'Pytaj o cokolwiek — import, compliance, transport, odprawa, magazyn…',
      disclaimer: 'Orchestrator korzysta z deterministycznych kalkulatorów (transport, cło, magazyn) i wyszukiwania BM25 w korpusie regulacji (CBAM, EUDR, REACH, CE). Każde wywołanie narzędzia oznaczone domeną. Ceny aktualizowane kwartalnie. Dla wiążących wycen, zgłoszeń regulacyjnych lub umów powyżej €50 000 Orchestrator automatycznie kieruje do zespołu ludzkiego.',
      legendCompliance: 'compliance',
      legendLogistics: 'logistyka',
    },
    sourcing: {
      title: 'OrcaTrade Sourcing Agent — Porównanie krajów + lista dostawców',
      description: 'Porozmawiaj z Sourcing Agentem OrcaTrade — porównuje CN/VN/IN/BD/TR dla dowolnej kategorii produktu, pokazuje koszt FOB, czas dostawy, ryzyko jakości i IP, oraz wybranych dostawców.',
      kicker: 'Sourcing Agent · Porównanie krajów · Lista dostawców',
      h1: 'Porozmawiaj ze <em>specjalistą sourcing</em>.',
      intro: 'Pytaj skąd sourcować. Porównuję CN/VN/IN/BD/TR dla Twojej kategorii i MOQ, pokazuję koszt FOB, czas dostawy, ryzyko jakości i IP, oraz wybranych dostawców z naszej bazy.',
      welcome: 'Powiedz mi co i w jakiej ilości sourcujesz — wskażę najlepszy kraj i konkretnych dostawców z udokumentowanymi specjalizacjami.',
      send: 'Wyślij',
      placeholder: 'Pytaj — kraj pochodzenia, dostawcy, MOQ, czas dostawy…',
      disclaimer: 'Sourcing Agent używa deterministycznych kalkulatorów cenowych i kuratorowanej bazy dostawców. Ceny aktualizowane kwartalnie.',
      legendCompliance: '',
      legendLogistics: '',
    },
    logistics: {
      title: 'OrcaTrade Logistics Agent — Transport, odprawa, magazyn',
      description: 'Porozmawiaj z Logistics Agentem OrcaTrade — porównuje morze/kolej/lotnictwo, liczy landed cost UE, benchmarkuje huby 3PL, komponuje pełne plany dostaw Azja → Europa. Liczby z deterministycznych kalkulatorów.',
      kicker: 'Logistics Agent · Transport · Odprawa · Magazyn',
      h1: 'Porozmawiaj ze <em>specjalistą logistyki</em>.',
      intro: 'Pytaj jak fizycznie przenieść towar między Azją a UE. Porównuję morze/kolej/lotnictwo, liczę landed cost, benchmarkuję huby 3PL, komponuję pełne plany dostaw.',
      welcome: 'Powiedz mi waga, wartość celna, trasa — przygotuję porównanie modów transportu i pełny plan landed cost.',
      send: 'Wyślij',
      placeholder: 'Pytaj — transport, cło, magazyn, plan przesyłki…',
      disclaimer: 'Logistics Agent używa deterministycznych kalkulatorów dla transportu, cła i 3PL. Ceny aktualizowane kwartalnie.',
      legendCompliance: '',
      legendLogistics: '',
    },
    finance: {
      title: 'OrcaTrade Finance Agent — Warunki płatności, LC, FX, kapitał obrotowy',
      description: 'Porozmawiaj z Finance Agentem OrcaTrade — porównuje instrumenty płatności, wycenia LC, hedguje FX, diagnozuje kapitał obrotowy. Każda liczba z deterministycznego benchmarku partnerów bankowych.',
      kicker: 'Finance Agent · Warunki płatności · LC · FX · Kapitał obrotowy',
      h1: 'Porozmawiaj ze <em>specjalistą finansów</em>.',
      intro: 'Pytaj jak płacić dostawcom, zarządzać ryzykiem FX, optymalizować kapitał obrotowy. Porównuję TT/LC/OA, wyceniam LC, hedguję FX, modeluję cykl konwersji gotówki.',
      welcome: 'Powiedz mi wartość kontraktu, walutę i warunki — wskażę najlepszy instrument płatności i koszty zabezpieczenia FX.',
      send: 'Wyślij',
      placeholder: 'Pytaj — TT/LC/OA, koszty LC, hedging FX, kapitał obrotowy…',
      disclaimer: 'Finance Agent używa benchmarków banków partnerskich i deterministycznych kalkulatorów. Wyceny aktualizowane miesięcznie.',
      legendCompliance: '',
      legendLogistics: '',
    },
    compliance: {
      title: 'OrcaTrade Compliance Agent — Specjalista zgodności importu UE',
      description: 'Porozmawiaj z Compliance Agentem OrcaTrade — agent AI uruchamiający kontrole CBAM i EUDR, pobierający tekst regulacji i cytujący każdą tezę. Człowiek w pętli przy każdej nieodwracalnej decyzji.',
      kicker: 'Compliance Agent · CBAM + EUDR + REACH + CE · Z narzędziami',
      h1: 'Porozmawiaj ze <em>specjalistą compliance</em>.',
      intro: 'Pytaj o regulacje UE. Uruchamiam kontrole CBAM/EUDR/REACH/CE, pobieram tekst regulacji i cytuję każdą tezę. Człowiek w pętli przy każdej nieodwracalnej decyzji.',
      welcome: 'Powiedz mi co importujesz — sprawdzę czy CBAM/EUDR/REACH/CE obowiązują i jakie masz konkretne obowiązki jako importer.',
      send: 'Wyślij',
      placeholder: 'Pytaj — CBAM, EUDR, REACH, CE, anti-dumping…',
      disclaimer: 'Compliance Agent używa wyszukiwania BM25 w korpusie regulacji + deterministycznych kontroli przepisów. Każde twierdzenie z cytatem [chunk-id].',
      legendCompliance: '',
      legendLogistics: '',
    },
    common: {
      switchOrchestrator: 'Orchestrator',
      switchSourcing: 'Sourcing',
      switchCompliance: 'Compliance',
      switchLogistics: 'Logistyka',
      switchFinance: 'Finanse',
      backToHome: 'Powrót do OrcaTrade Group',
      rights: 'Wszelkie prawa zastrzeżone.',
    },
  },
  de: {
    orchestrator: {
      title: 'OrcaTrade Operations Orchestrator — Ein Agent, jede Domäne',
      description: 'Sprechen Sie mit dem OrcaTrade Operations Orchestrator — KI-Agent mit Zugriff auf alle Tools der Compliance- und Logistik-Spezialisten. Fragt zu Importen in die EU, wählt die richtigen Tools, verbindet Domänen in einer Antwort.',
      kicker: 'Operations Orchestrator · 16 Tools · Compliance + Logistik',
      h1: 'Ein Agent, <em>jede Domäne</em>.',
      intro: 'Fragen Sie alles über Importe in die EU. Ich habe Zugriff auf jedes Tool der Compliance- und Logistik-Spezialisten und wähle die richtigen aus — auch wenn Ihre Frage Domänen überschreitet. Die meisten nützlichen Fragen tun das.',
      welcome: 'Sagen Sie mir, was Sie importieren — Ursprung, Ziel, Warenart. Ich prüfe, welche Vorschriften gelten (CBAM, EUDR, REACH, CE), wie die Landed Costs aussehen (Zoll, EUSt, Verzollung, Zolllager-Optionen) und wo die Ware in Europa stehen sollte (3PL-Hubs). Alles in einer Antwort.',
      send: 'Senden',
      placeholder: 'Fragen Sie alles — Import, Compliance, Transport, Zoll, Lagerung…',
      disclaimer: 'Der Orchestrator nutzt deterministische Kalkulatoren (Transport, Zoll, Lager) und BM25-Retrieval über das Verordnungs-Korpus (CBAM, EUDR, REACH, CE). Jeder Tool-Call ist mit der Domäne getaggt. Preise quartalsweise aktualisiert. Für verbindliche Angebote, Behördenmeldungen oder Verträge über €50.000 leitet der Orchestrator automatisch an das menschliche Operations-Team weiter.',
      legendCompliance: 'Compliance',
      legendLogistics: 'Logistik',
    },
    sourcing: {
      title: 'OrcaTrade Sourcing Agent — Länder-Vergleich + Lieferanten-Shortlist',
      description: 'Sprechen Sie mit dem OrcaTrade Sourcing Agent — vergleicht CN/VN/IN/BD/TR für jede Produktkategorie, zeigt FOB-Kosten, Lieferzeit, Qualitäts- und IP-Risiko sowie kuratierte Lieferanten.',
      kicker: 'Sourcing Agent · Länder-Vergleich · Lieferanten-Shortlist',
      h1: 'Mit dem <em>Sourcing-Spezialisten</em> sprechen.',
      intro: 'Fragen Sie, woher Sie beziehen sollen. Ich vergleiche CN/VN/IN/BD/TR für Ihre Kategorie und MOQ, zeige FOB-Kosten, Lieferzeit, Qualitäts- und IP-Risiko sowie kuratierte Lieferanten aus unserer Datenbank.',
      welcome: 'Sagen Sie mir, was Sie in welcher Menge sourcen — ich nenne das beste Land und konkrete Lieferanten mit dokumentierten Spezialisierungen.',
      send: 'Senden',
      placeholder: 'Fragen Sie — Ursprungsland, Lieferanten, MOQ, Lieferzeit…',
      disclaimer: 'Sourcing Agent nutzt deterministische Preis-Kalkulatoren und kuratierte Lieferantendatenbank. Preise quartalsweise aktualisiert.',
      legendCompliance: '',
      legendLogistics: '',
    },
    logistics: {
      title: 'OrcaTrade Logistics Agent — Transport, Zoll, Lager',
      description: 'Sprechen Sie mit dem OrcaTrade Logistics Agent — vergleicht See/Schiene/Luft, berechnet EU Landed Cost, benchmarkt 3PL-Hubs, erstellt vollständige Asien → Europa Pläne. Zahlen aus deterministischen Kalkulatoren.',
      kicker: 'Logistics Agent · Transport · Zoll · Lager',
      h1: 'Mit dem <em>Logistik-Spezialisten</em> sprechen.',
      intro: 'Fragen Sie, wie Sie die Ware zwischen Asien und der EU bewegen. Ich vergleiche See/Schiene/Luft, berechne Landed Cost, benchmarke 3PL-Hubs, erstelle vollständige Pläne.',
      welcome: 'Sagen Sie mir Gewicht, Zollwert, Route — ich erstelle einen Modus-Vergleich und vollständigen Landed-Cost-Plan.',
      send: 'Senden',
      placeholder: 'Fragen Sie — Transport, Zoll, Lager, Sendungsplan…',
      disclaimer: 'Logistics Agent nutzt deterministische Kalkulatoren für Transport, Zoll und 3PL. Preise quartalsweise aktualisiert.',
      legendCompliance: '',
      legendLogistics: '',
    },
    finance: {
      title: 'OrcaTrade Finance Agent — Zahlungsbedingungen, LC, FX, Working Capital',
      description: 'Sprechen Sie mit dem OrcaTrade Finance Agent — vergleicht Zahlungsinstrumente, bewertet LC, hedgt FX, diagnostiziert Working Capital. Jede Zahl aus deterministischen Bank-Partner-Benchmarks.',
      kicker: 'Finance Agent · Zahlungsbedingungen · LC · FX · Working Capital',
      h1: 'Mit dem <em>Finance-Spezialisten</em> sprechen.',
      intro: 'Fragen Sie, wie Sie Lieferanten bezahlen, FX-Risiko managen, Working Capital optimieren. Ich vergleiche TT/LC/OA, bewerte LC, hedge FX, modelliere den Cash-Conversion-Cycle.',
      welcome: 'Sagen Sie mir Vertragswert, Währung und Bedingungen — ich nenne das beste Zahlungsinstrument und FX-Hedging-Kosten.',
      send: 'Senden',
      placeholder: 'Fragen Sie — TT/LC/OA, LC-Kosten, FX-Hedging, Working Capital…',
      disclaimer: 'Finance Agent nutzt Benchmarks von Partnerbanken und deterministische Kalkulatoren. Preise monatlich aktualisiert.',
      legendCompliance: '',
      legendLogistics: '',
    },
    compliance: {
      title: 'OrcaTrade Compliance Agent — EU-Importcompliance-Spezialist',
      description: 'Sprechen Sie mit dem OrcaTrade Compliance Agent — KI-Agent, der CBAM- und EUDR-Prüfungen durchführt, Verordnungstext abruft und jede These zitiert. Mensch im Loop bei jeder unumkehrbaren Entscheidung.',
      kicker: 'Compliance Agent · CBAM + EUDR + REACH + CE · Tool-using',
      h1: 'Mit dem <em>Compliance-Spezialisten</em> sprechen.',
      intro: 'Fragen Sie zu EU-Vorschriften. Ich führe CBAM/EUDR/REACH/CE-Prüfungen durch, rufe Verordnungstext ab und zitiere jede These. Mensch im Loop bei jeder unumkehrbaren Entscheidung.',
      welcome: 'Sagen Sie mir, was Sie importieren — ich prüfe, ob CBAM/EUDR/REACH/CE gelten und welche konkreten Importeur-Pflichten Sie haben.',
      send: 'Senden',
      placeholder: 'Fragen Sie — CBAM, EUDR, REACH, CE, Anti-Dumping…',
      disclaimer: 'Compliance Agent nutzt BM25-Retrieval über das Verordnungs-Korpus + deterministische Vorschriftsprüfungen. Jede These mit Zitat [chunk-id].',
      legendCompliance: '',
      legendLogistics: '',
    },
    common: {
      switchOrchestrator: 'Orchestrator',
      switchSourcing: 'Sourcing',
      switchCompliance: 'Compliance',
      switchLogistics: 'Logistik',
      switchFinance: 'Finance',
      backToHome: 'Zurück zu OrcaTrade Group',
      rights: 'Alle Rechte vorbehalten.',
    },
  },
};

// ── Build ─────────────────────────────────────────────

function buildLocale(agent, locale) {
  const sourceDir = AGENT_DIR[agent];
  const sourcePath = path.join(ROOT, sourceDir, 'index.html');
  let html = fs.readFileSync(sourcePath, 'utf8');

  const t = TR[locale][agent];
  const c = TR[locale].common;

  // 1. lang attribute
  html = html.replace(/<html lang="en">/i, `<html lang="${locale}">`);

  // 2. title + meta description
  html = html.replace(/<title>[^<]+<\/title>/i, `<title>${t.title}</title>`);
  html = html.replace(/(<meta name="description" content=)"[^"]+"/i, `$1"${t.description}"`);
  html = html.replace(/(<meta property="og:title" content=)"[^"]+"/i, `$1"${t.title}"`);

  // 3. Rewrite relative asset paths to absolute (so /pl/agent/<x>/ can load them).
  // Two cases: nested agents (orchestrator/sourcing/logistics/finance) use ../../, while
  // compliance at /agent/ uses ../. Handle both.
  html = html.replace(/href="\.\.\/\.\.\/css\//g, 'href="/css/');
  html = html.replace(/src="\.\.\/\.\.\/js\//g, 'src="/js/');
  html = html.replace(/src="\.\.\/\.\.\//g, 'src="/');
  html = html.replace(/href="\.\.\/\.\.\/index\.html"/g, 'href="/"');
  // Single-level fallbacks for compliance agent
  html = html.replace(/href="\.\.\/css\//g, 'href="/css/');
  html = html.replace(/src="\.\.\/js\//g, 'src="/js/');
  html = html.replace(/href="\.\.\/index\.html"/g, 'href="/"');
  html = html.replace(/src="app\.js"/g, `src="/${sourceDir}/app.js"`);

  // 4. Rewrite agent-switch links to locale-prefixed equivalents
  if (agent === 'orchestrator') {
    html = html.replace(/href="\.\/"/g, `href="/${locale}/agent/orchestrator/"`);
    html = html.replace(/href="\.\.\/sourcing\/"/g, `href="/${locale}/agent/sourcing/"`);
    html = html.replace(/href="\.\.\/" role="tab">Compliance/g, `href="/${locale}/agent/" role="tab">${c.switchCompliance}`);
    html = html.replace(/href="\.\.\/logistics\/"/g, `href="/${locale}/agent/logistics/"`);
    html = html.replace(/href="\.\.\/finance\/"/g, `href="/${locale}/agent/finance/"`);
  } else if (agent === 'compliance') {
    html = html.replace(/href="orchestrator\/"/g, `href="/${locale}/agent/orchestrator/"`);
    html = html.replace(/href="sourcing\/"/g, `href="/${locale}/agent/sourcing/"`);
    html = html.replace(/href="logistics\/"/g, `href="/${locale}/agent/logistics/"`);
    html = html.replace(/href="finance\/"/g, `href="/${locale}/agent/finance/"`);
    html = html.replace(/href="\.\/" class="active"/g, `href="/${locale}/agent/" class="active"`);
  } else {
    // sourcing, logistics, finance — links to siblings
    html = html.replace(/href="\.\.\/orchestrator\/"/g, `href="/${locale}/agent/orchestrator/"`);
    html = html.replace(/href="\.\.\/sourcing\/"/g, `href="/${locale}/agent/sourcing/"`);
    html = html.replace(/href="\.\.\/logistics\/"/g, `href="/${locale}/agent/logistics/"`);
    html = html.replace(/href="\.\.\/finance\/"/g, `href="/${locale}/agent/finance/"`);
    html = html.replace(/href="\.\.\/" role="tab">Compliance/g, `href="/${locale}/agent/" role="tab">${c.switchCompliance}`);
    html = html.replace(/href="\.\/" class="active"/g, `href="/${locale}/agent/${agent}/" class="active"`);
  }

  // Translate visible switch labels (only the un-active ones — active was handled above
  // for compliance, but for others we need to walk the labels).
  html = html.replace(/role="tab"( aria-selected="true")?>Orchestrator/g, `role="tab"$1>${c.switchOrchestrator}`);
  html = html.replace(/role="tab"( aria-selected="true")?>Sourcing/g, `role="tab"$1>${c.switchSourcing}`);
  html = html.replace(/role="tab"( aria-selected="true")?>Logistics/g, `role="tab"$1>${c.switchLogistics}`);
  html = html.replace(/role="tab"( aria-selected="true")?>Finance/g, `role="tab"$1>${c.switchFinance}`);
  html = html.replace(/role="tab"( aria-selected="true")?>Compliance/g, `role="tab"$1>${c.switchCompliance}`);

  // 5. kicker, h1, intro paragraph
  html = html.replace(/<p class="kicker">[^<]+<\/p>/i, `<p class="kicker">${t.kicker}</p>`);
  html = html.replace(/<h1>[\s\S]*?<\/h1>/i, `<h1>${t.h1}</h1>`);

  // Replace the intro <p> after h1 (the third <p> in the agent-hero div, generally the longest).
  // We do this via a focused replacement: the <p> immediately after the agent-switch closing div.
  // Simpler approach: replace by matching against existing English intro substring.
  const introMarkers = {
    orchestrator: 'Ask anything about importing into the EU.',
    sourcing: 'Ask where to source from.',
    logistics: 'Ask how to physically move goods between Asia and the EU.',
    finance: 'Ask how to pay suppliers, manage FX risk, optimise working capital.',
    compliance: 'Ask anything about EU regulations.',
  };
  // Generic: locate the agent-hero <p> that contains a long sentence and replace.
  // We do this by capturing <p>...long sentence...</p> immediately preceding agent-switch
  html = html.replace(/(<h1>[\s\S]*?<\/h1>\s*)<p>[\s\S]*?<\/p>/, `$1<p>${t.intro}</p>`);

  // 6. Welcome message in conversation initial bubble
  html = html.replace(
    /(<div class="msg-content">)[\s\S]*?(<\/div>)/,
    `$1${t.welcome}$2`
  );

  // 7. Domain legend labels (only orchestrator has these visible)
  if (agent === 'orchestrator' && t.legendCompliance) {
    html = html.replace(/(<span class="swatch compliance"><\/span>)compliance/, `$1${t.legendCompliance}`);
    html = html.replace(/(<span class="swatch logistics"><\/span>)logistics/, `$1${t.legendLogistics}`);
  }

  // 8. Send button + textarea placeholder + disclaimer
  html = html.replace(/<button id="send">Send<\/button>/i, `<button id="send">${t.send}</button>`);
  html = html.replace(/(<textarea id="input" placeholder=)"[^"]+"/i, `$1"${t.placeholder}"`);
  html = html.replace(/<p class="agent-disclaimer">[\s\S]*?<\/p>/i, `<p class="agent-disclaimer">${t.disclaimer}</p>`);

  // 9. Footer
  html = html.replace(/All rights reserved\./g, c.rights);
  html = html.replace(/Back to OrcaTrade Group/g, c.backToHome);

  // 10. Inject window.LOCALE before the app.js script tag (matches either
  //     /agent/<name>/app.js for nested agents or /agent/app.js for compliance).
  html = html.replace(
    /(<script src="\/agent\/(?:[^"\/]+\/)?app\.js")/,
    `<script>window.LOCALE='${locale}';</script>\n  $1`
  );

  // 11. Translate suggestion-btn LABELS only (not data-prompt — those are user input examples
  //     and translating them would change the demo). Actually, prompts in PL/DE work better
  //     too. But let's keep prompts in English for now to avoid broken examples; only
  //     translate visible labels would require button-by-button strings which we don't have.
  // (Skip — labels stay in English on PL/DE for now. Suggestion is an MVP shortcut.)

  return html;
}

function build() {
  let written = 0;
  for (const locale of ['pl', 'de']) {
    for (const agent of AGENTS) {
      const outDir = path.join(ROOT, locale, AGENT_OUTDIR[agent]);
      fs.mkdirSync(outDir, { recursive: true });
      const html = buildLocale(agent, locale);
      fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
      written++;
    }
  }
  console.log(`Generated ${written} localised agent pages.`);
}

if (require.main === module) build();

module.exports = { buildLocale, build, AGENTS, TR };

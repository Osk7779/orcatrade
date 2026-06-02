// Locale-specific copy for the homepage. EN is the editorial source;
// PL and DE mirror it so /pl/ and /de/ replicate the same one-scroll
// editorial composition (hero → manifesto → story → examples → pillars
// → leadership → news → final CTA) in the visitor's language.
//
// Translations aim for the same voice: confident, calculator-grounded,
// not marketing-fluffy. Capitalisation, italics and dingbats are
// preserved verbatim — these are typographic, not language-specific.

export type Locale = 'en' | 'pl' | 'de';

export type HomepageCopy = {
  hero: {
    kicker: string;
    headline: [string, string, string, string];
    body: string;
    ctaPrimary: string;
    ctaSecondary: string;
    footer: string;
    globeCaption: string;
    globeSubCaption: string;
  };
  manifesto: {
    eyebrow: string;
    bodyAfterDropCap: string; // begins after the drop-cap "E" / "U" / "E"
    dropCap: string;
    colophon: string;
  };
  chapters: {
    composition: string;
    examples: string;
    stages: string;
    leadership: string;
    news: string;
  };
  storyBeam: {
    title: [string, string]; // two lines around a <br/>
    body: string;
  };
  examplesSection: {
    title: string;
    viewAll: string;
    readBreakdown: string;
    items: Array<{
      tag: string;
      lane: string;
      headline: string; // numeric, kept as-is across locales
      headlineCaption: string;
      summary: string;
    }>;
  };
  pillarsSection: {
    title: string;
    intelligence: {
      kicker: string;
      title: string;
      description: string;
      cta: string;
    };
    search: { kicker: string; title: string; description: string; cta: string };
    sourcing: { kicker: string; title: string; description: string; cta: string };
    logistics: { kicker: string; title: string; description: string; cta: string };
    finance: { kicker: string; title: string; description: string; cta: string };
  };
  leadershipSection: {
    title: string;
    lead: string;
    members: Array<{
      // name + photo + location are locale-agnostic; role/quote/bio translate
      role: string;
      quote: string;
      bio: string;
    }>;
  };
  newsSection: {
    title: string;
    viewAll: string;
    minSuffix: string;
    readGuide: string;
    items: Array<{
      tag: string;
      regime: string;
      title: string;
      excerpt: string;
    }>;
  };
  finalCta: {
    eyebrow: string;
    title: string;
    body: string;
    ctaPrimary: string;
    ctaSecondary: string;
    footer: [string, string, string];
  };
};

// ─────────────────────────────────────────────────────────────
//  EN — source of truth
// ─────────────────────────────────────────────────────────────
export const EN_COPY: HomepageCopy = {
  hero: {
    kicker: 'One platform · Asia → Europe',
    headline: ['Source it.', 'Clear it.', 'Move it.', 'Finance it.'],
    body:
      'OrcaTrade is the import operations team available 24/7 for European businesses sourcing from Asia. Search, sourcing, compliance, logistics and finance — on one calculator-grounded platform, with citations on every recommendation.',
    ctaPrimary: 'Build my import plan',
    ctaSecondary: 'Read the prospectus',
    footer: 'Operating across the EU, the UK and Asia.',
    globeCaption: 'Lanes observed between Asia and Europe — live.',
    globeSubCaption: 'From Shanghai and Ho Chi Minh to Warsaw, Berlin and Amsterdam.',
  },
  manifesto: {
    eyebrow: 'On principle',
    dropCap: 'E',
    bodyAfterDropCap:
      'uropean businesses deserve import operations that are calculated, cited, and explained — not estimated, not assumed, not lost to the next intermediary. OrcaTrade exists to make the next container a known quantity — landed cost, every regime, end to end — before it leaves the factory.',
    colophon: 'OrcaTrade Group · MMXXVI',
  },
  chapters: {
    composition: 'The composition',
    examples: 'Worked examples',
    stages: 'Five stages',
    leadership: 'Leadership',
    news: 'From the desk',
  },
  storyBeam: {
    title: ['One platform between six origins', 'and your European market.'],
    body:
      'Every lane is priced end-to-end — HS classification, duty, anti-dumping, CBAM, REACH, freight, last mile, FX and working capital — surfaced from one calculator-grounded engine.',
  },
  examplesSection: {
    title: 'Recently calculated, by lane.',
    viewAll: 'See all examples',
    readBreakdown: 'Read the breakdown',
    items: [
      {
        tag: 'Anti-dumping · CVD',
        lane: 'e-bikes · CN → PL',
        headline: '87%',
        headlineCaption: 'combined AD + CVD on Chinese e-bikes',
        summary:
          '€97,300 of duty per €100,000 shipment. AD 70.1% plus CVD 17.2% layered on top of 10% MFN. Importers planning against MFN-only numbers go bankrupt at the port.',
      },
      {
        tag: 'CBAM · Anti-dumping',
        lane: 'aluminium · CN → DE',
        headline: '38%',
        headlineCaption: 'duty plus CBAM declarant status',
        summary:
          'Aluminium extrusions from China carry 32% AD on top of 6% MFN — and CBAM declarant status from January 2026. Importer must register, file emissions reports, and buy CBAM certificates.',
      },
      {
        tag: 'EVFTA · compliance stack',
        lane: 'electronics · VN → DE',
        headline: '0%',
        headlineCaption: 'duty with four compliance regimes',
        summary:
          'EU–Vietnam FTA gives 0% duty with a REX origin declaration on the invoice. But chapter 85 triggers CE LVD/EMC/RED + RoHS + WEEE producer registration — four parallel compliance regimes alongside the duty saving.',
      },
    ],
  },
  pillarsSection: {
    title: 'Five stages. One platform.',
    intelligence: {
      kicker: 'Stage 03 · Verify it · Flagship',
      title: 'OrcaTrade Intelligence.',
      description:
        'EU/UK customs, CBAM, EUDR, REACH, CE-marking, anti-dumping and countervailing duties — surfaced from one calculator-grounded engine, with citations and confidence tiers on every claim.',
      cta: 'Open Intelligence',
    },
    search: {
      kicker: 'Stage 01 · Find it',
      title: 'OrcaTrade Search.',
      description: 'Type any HS code, product, supplier or lane. Get every regime that touches it.',
      cta: 'Open Search',
    },
    sourcing: {
      kicker: 'Stage 02 · Source it',
      title: 'OrcaTrade Sourcing.',
      description: 'Six Asia origins, supplier screening, factory-risk feeds, sample-quote rebranding.',
      cta: 'Open Sourcing',
    },
    logistics: {
      kicker: 'Stage 04 · Ship it',
      title: 'OrcaTrade Logistics.',
      description: 'Lane routing across DE, NL, PL, ES, IT, FR and beyond. Door-to-door priced end-to-end.',
      cta: 'Open Logistics',
    },
    finance: {
      kicker: 'Stage 05 · Finance it',
      title: 'OrcaTrade Finance.',
      description: 'Working capital, FX hedging windows, total cost of ownership — for orders of €50k–€500k.',
      cta: 'Open Finance',
    },
  },
  leadershipSection: {
    title: 'Built by people who’ve imported.',
    lead:
      'Founded by University College London students who lived the gap between European buyers and Asian manufacturing.',
    members: [
      {
        role: 'CEO · Co-Founder',
        quote: 'A factory you can ring at 2 a.m. is worth ten you can only email.',
        bio: 'Leads sourcing strategy and supplier partnerships across Asia — quality, clear communication, dependable timelines.',
      },
      {
        role: 'Chief Operating Officer',
        quote: 'A plan is a hypothesis. Execution is the only thing that prices itself.',
        bio: 'Runs OrcaTrade’s operations — turning the platform’s recommendations into executed imports. Owns supply-chain delivery, carriers and partners.',
      },
      {
        role: 'Head of Logistics',
        quote: 'A container arrives on time because of a hundred small decisions you will never see.',
        bio: 'Oversees shipment planning across sea and air routes, keeping schedules and handovers aligned from factory to destination.',
      },
      {
        role: 'Co-Founder · CFO',
        quote: 'The cheapest decision is the one you can model before you make it.',
        bio: 'Oversees European operations and financial planning, keeping commercial decisions and cross-border execution aligned.',
      },
    ],
  },
  newsSection: {
    title: 'From the desk — the reference library.',
    viewAll: 'All compliance guides',
    minSuffix: 'min',
    readGuide: 'Read the guide',
    items: [
      {
        tag: 'Compliance · CBAM',
        regime: 'Carbon Border Adjustment Mechanism',
        title: 'CBAM — what changes in the definitive period.',
        excerpt:
          'Reporting closes 31 December 2025. From January 2026 financial obligations begin: registration, embedded-emissions declarations, and CBAM certificate purchase for steel, cement, aluminium, fertilisers, electricity and hydrogen.',
      },
      {
        tag: 'Compliance · EUDR',
        regime: 'EU Deforestation Regulation',
        title: 'EUDR — due diligence statements and the geolocation file.',
        excerpt:
          'Soy, palm oil, cattle, coffee, cocoa, rubber, wood — and many derived products. Importers file due-diligence statements with plot-level geolocations. Includes textiles in the next rollout window.',
      },
      {
        tag: 'Compliance · GPSR',
        regime: 'General Product Safety Regulation',
        title: 'GPSR — why every non-EU seller now needs an EU responsible person.',
        excerpt:
          'Effective 13 December 2024 for consumer products. Article 4 forces non-EU sellers to appoint an EU-established economic operator before placing goods on the market.',
      },
    ],
  },
  finalCta: {
    eyebrow: 'One last thing',
    title: 'Your next import, priced to the cent.',
    body:
      'Tell us what you’re sourcing, where it’s coming from, and where it’s going. We’ll cost the lane end-to-end, surface every regime that touches it, and hand you a plan you can ship from.',
    ctaPrimary: 'Build my import plan',
    ctaSecondary: 'Talk to a person',
    footer: ['No payment to apply', 'Calculator-grounded, with citations', 'UK English · EUR · ISO-2'],
  },
};

// ─────────────────────────────────────────────────────────────
//  PL — polski
// ─────────────────────────────────────────────────────────────
export const PL_COPY: HomepageCopy = {
  hero: {
    kicker: 'Jedna platforma · Azja → Europa',
    headline: ['Pozyskaj.', 'Odpraw.', 'Przewieź.', 'Sfinansuj.'],
    body:
      'OrcaTrade to zespół operacji importowych dostępny 24/7 dla europejskich firm sprowadzających z Azji. Wyszukiwanie, sourcing, compliance, logistyka i finansowanie — na jednej platformie opartej na kalkulatorach, z cytowaniami przy każdej rekomendacji.',
    ctaPrimary: 'Zbuduj mój plan importu',
    ctaSecondary: 'Przeczytaj prospekt',
    footer: 'Działamy w UE, Wielkiej Brytanii i Azji.',
    globeCaption: 'Trasy obserwowane między Azją a Europą — na żywo.',
    globeSubCaption: 'Z Szanghaju i Ho Chi Minh do Warszawy, Berlina i Amsterdamu.',
  },
  manifesto: {
    eyebrow: 'Z zasady',
    dropCap: 'E',
    bodyAfterDropCap:
      'uropejskie firmy zasługują na operacje importowe, które są policzone, udokumentowane i wyjaśnione — nie szacowane, nie zakładane, nie tracone na kolejnym pośredniku. OrcaTrade istnieje po to, by kolejny kontener był wielkością znaną — koszt landed, każdy reżim, od początku do końca — zanim opuści fabrykę.',
    colophon: 'OrcaTrade Group · MMXXVI',
  },
  chapters: {
    composition: 'Kompozycja',
    examples: 'Przykłady policzone',
    stages: 'Pięć etapów',
    leadership: 'Zespół',
    news: 'Z biura',
  },
  storyBeam: {
    title: ['Jedna platforma między sześcioma źródłami', 'a Twoim europejskim rynkiem.'],
    body:
      'Każda trasa wyceniana od początku do końca — klasyfikacja HS, cło, anti-dumping, CBAM, REACH, fracht, ostatnia mila, FX i kapitał obrotowy — z jednego silnika opartego na kalkulatorach.',
  },
  examplesSection: {
    title: 'Niedawno policzone, według trasy.',
    viewAll: 'Zobacz wszystkie przykłady',
    readBreakdown: 'Przeczytaj rozbiór',
    items: [
      {
        tag: 'Anti-dumping · CVD',
        lane: 'e-rowery · CN → PL',
        headline: '87%',
        headlineCaption: 'łączne AD + CVD na chińskie e-rowery',
        summary:
          '97 300 € cła na każde 100 000 € wysyłki. AD 70,1% plus CVD 17,2% nałożone na 10% MFN. Importerzy planujący wyłącznie na podstawie MFN bankrutują w porcie.',
      },
      {
        tag: 'CBAM · Anti-dumping',
        lane: 'aluminium · CN → DE',
        headline: '38%',
        headlineCaption: 'cło plus status zgłaszającego CBAM',
        summary:
          'Profile aluminiowe z Chin obarczone są 32% AD ponad 6% MFN — oraz statusem zgłaszającego CBAM od stycznia 2026. Importer musi się zarejestrować, składać raporty emisji i kupować certyfikaty CBAM.',
      },
      {
        tag: 'EVFTA · stos compliance',
        lane: 'elektronika · VN → DE',
        headline: '0%',
        headlineCaption: 'cło z czterema reżimami compliance',
        summary:
          'Umowa UE–Wietnam daje 0% cła z deklaracją pochodzenia REX na fakturze. Ale rozdział 85 uruchamia CE LVD/EMC/RED + RoHS + rejestrację producenta WEEE — cztery równoległe reżimy compliance obok oszczędności na cle.',
      },
    ],
  },
  pillarsSection: {
    title: 'Pięć etapów. Jedna platforma.',
    intelligence: {
      kicker: 'Etap 03 · Zweryfikuj · Flagowy',
      title: 'OrcaTrade Intelligence.',
      description:
        'Cła UE/UK, CBAM, EUDR, REACH, oznakowanie CE, anti-dumping i cła wyrównawcze — z jednego silnika opartego na kalkulatorach, z cytowaniami i poziomami pewności przy każdym twierdzeniu.',
      cta: 'Otwórz Intelligence',
    },
    search: {
      kicker: 'Etap 01 · Znajdź',
      title: 'OrcaTrade Search.',
      description: 'Wpisz dowolny kod HS, produkt, dostawcę lub trasę. Zobacz każdy reżim, który ich dotyczy.',
      cta: 'Otwórz Search',
    },
    sourcing: {
      kicker: 'Etap 02 · Pozyskaj',
      title: 'OrcaTrade Sourcing.',
      description: 'Sześć źródeł azjatyckich, weryfikacja dostawców, dane o ryzyku fabrycznym, rebranding wycen.',
      cta: 'Otwórz Sourcing',
    },
    logistics: {
      kicker: 'Etap 04 · Wyślij',
      title: 'OrcaTrade Logistics.',
      description: 'Trasy przez DE, NL, PL, ES, IT, FR i dalej. Door-to-door wycenione od początku do końca.',
      cta: 'Otwórz Logistics',
    },
    finance: {
      kicker: 'Etap 05 · Sfinansuj',
      title: 'OrcaTrade Finance.',
      description: 'Kapitał obrotowy, okna hedgingu FX, całkowity koszt posiadania — dla zamówień 50 tys.–500 tys. €.',
      cta: 'Otwórz Finance',
    },
  },
  leadershipSection: {
    title: 'Zbudowane przez ludzi, którzy importowali.',
    lead:
      'Założone przez studentów University College London, którzy z bliska zobaczyli lukę między europejskimi kupującymi a azjatycką produkcją.',
    members: [
      {
        role: 'CEO · Współzałożyciel',
        quote: 'Fabryka, do której zadzwonisz o 2 w nocy, jest warta dziesięciu, do których możesz tylko napisać.',
        bio: 'Prowadzi strategię sourcingu i partnerstwa z dostawcami w Azji — jakość, jasna komunikacja, niezawodne terminy.',
      },
      {
        role: 'Dyrektor Operacyjny',
        quote: 'Plan to hipoteza. Wykonanie to jedyne, co wycenia samo siebie.',
        bio: 'Kieruje operacjami OrcaTrade — zamieniając rekomendacje platformy w zrealizowane importy. Odpowiada za dostawy łańcucha dostaw, przewoźników i partnerów.',
      },
      {
        role: 'Szef Logistyki',
        quote: 'Kontener dociera na czas dzięki setce małych decyzji, których nigdy nie zobaczysz.',
        bio: 'Nadzoruje planowanie wysyłek na trasach morskich i lotniczych, utrzymując harmonogramy i przekazania zsynchronizowane od fabryki do celu.',
      },
      {
        role: 'Współzałożyciel · CFO',
        quote: 'Najtańsza decyzja to taka, którą możesz zamodelować, zanim ją podejmiesz.',
        bio: 'Nadzoruje operacje europejskie i planowanie finansowe, utrzymując decyzje komercyjne i wykonanie transgraniczne w jednej linii.',
      },
    ],
  },
  newsSection: {
    title: 'Z biura — biblioteka referencyjna.',
    viewAll: 'Wszystkie przewodniki compliance',
    minSuffix: 'min',
    readGuide: 'Przeczytaj przewodnik',
    items: [
      {
        tag: 'Compliance · CBAM',
        regime: 'Carbon Border Adjustment Mechanism',
        title: 'CBAM — co zmienia się w okresie definitywnym.',
        excerpt:
          'Sprawozdawczość zamyka się 31 grudnia 2025. Od stycznia 2026 zaczynają się obowiązki finansowe: rejestracja, deklaracje emisji wbudowanych i zakup certyfikatów CBAM dla stali, cementu, aluminium, nawozów, elektryczności i wodoru.',
      },
      {
        tag: 'Compliance · EUDR',
        regime: 'EU Deforestation Regulation',
        title: 'EUDR — oświadczenia due diligence i plik geolokalizacji.',
        excerpt:
          'Soja, olej palmowy, bydło, kawa, kakao, kauczuk, drewno — i wiele produktów pochodnych. Importerzy składają oświadczenia due diligence z geolokalizacjami na poziomie działki. Tekstylia w następnym oknie wdrożeniowym.',
      },
      {
        tag: 'Compliance · GPSR',
        regime: 'General Product Safety Regulation',
        title: 'GPSR — dlaczego każdy sprzedawca spoza UE potrzebuje teraz odpowiedzialnej osoby w UE.',
        excerpt:
          'Obowiązuje od 13 grudnia 2024 dla produktów konsumenckich. Artykuł 4 zmusza sprzedawców spoza UE do wyznaczenia podmiotu gospodarczego z siedzibą w UE przed wprowadzeniem towarów na rynek.',
      },
    ],
  },
  finalCta: {
    eyebrow: 'Jeszcze jedno',
    title: 'Twój następny import, wyceniony co do centa.',
    body:
      'Powiedz nam, co kupujesz, skąd przychodzi i dokąd jedzie. Wycenimy trasę od początku do końca, pokażemy każdy reżim, który jej dotyczy, i przekażemy plan, z którego możesz ruszyć.',
    ctaPrimary: 'Zbuduj mój plan importu',
    ctaSecondary: 'Porozmawiaj z człowiekiem',
    footer: ['Bez opłaty na start', 'Oparte na kalkulatorach, z cytowaniami', 'Polski · EUR · ISO-2'],
  },
};

// ─────────────────────────────────────────────────────────────
//  DE — Deutsch
// ─────────────────────────────────────────────────────────────
export const DE_COPY: HomepageCopy = {
  hero: {
    kicker: 'Eine Plattform · Asien → Europa',
    headline: ['Beschaffen.', 'Verzollen.', 'Verschiffen.', 'Finanzieren.'],
    body:
      'OrcaTrade ist das 24/7-Importteam für europäische Unternehmen, die aus Asien beziehen. Suche, Beschaffung, Compliance, Logistik und Finanzierung — auf einer kalkulator-fundierten Plattform, mit Quellenangaben bei jeder Empfehlung.',
    ctaPrimary: 'Meinen Importplan erstellen',
    ctaSecondary: 'Prospekt lesen',
    footer: 'Tätig in der EU, im Vereinigten Königreich und in Asien.',
    globeCaption: 'Routen zwischen Asien und Europa — live beobachtet.',
    globeSubCaption: 'Von Shanghai und Ho-Chi-Minh nach Warschau, Berlin und Amsterdam.',
  },
  manifesto: {
    eyebrow: 'Aus Prinzip',
    dropCap: 'E',
    bodyAfterDropCap:
      'uropäische Unternehmen verdienen Importoperationen, die berechnet, belegt und erklärt sind — nicht geschätzt, nicht angenommen, nicht an den nächsten Zwischenhändler verloren. OrcaTrade existiert, um den nächsten Container zu einer bekannten Größe zu machen — landed cost, jedes Regime, durchgehend — bevor er die Fabrik verlässt.',
    colophon: 'OrcaTrade Group · MMXXVI',
  },
  chapters: {
    composition: 'Die Komposition',
    examples: 'Durchgerechnete Beispiele',
    stages: 'Fünf Stufen',
    leadership: 'Führung',
    news: 'Vom Schreibtisch',
  },
  storyBeam: {
    title: ['Eine Plattform zwischen sechs Quellen', 'und Ihrem europäischen Markt.'],
    body:
      'Jede Route wird durchgehend bepreist — HS-Klassifikation, Zoll, Anti-Dumping, CBAM, REACH, Fracht, letzte Meile, FX und Working Capital — aus einer kalkulator-fundierten Engine.',
  },
  examplesSection: {
    title: 'Kürzlich berechnet, nach Route.',
    viewAll: 'Alle Beispiele ansehen',
    readBreakdown: 'Aufschlüsselung lesen',
    items: [
      {
        tag: 'Anti-Dumping · CVD',
        lane: 'E-Bikes · CN → PL',
        headline: '87%',
        headlineCaption: 'kombinierter AD + CVD auf chinesische E-Bikes',
        summary:
          '97.300 € Zoll je 100.000 € Lieferung. AD 70,1 % plus CVD 17,2 %, geschichtet auf 10 % MFN. Importeure, die nur mit MFN-Zahlen planen, gehen am Hafen pleite.',
      },
      {
        tag: 'CBAM · Anti-Dumping',
        lane: 'Aluminium · CN → DE',
        headline: '38%',
        headlineCaption: 'Zoll plus CBAM-Anmelderstatus',
        summary:
          'Aluminiumprofile aus China tragen 32 % AD über 6 % MFN — und CBAM-Anmelderstatus ab Januar 2026. Importeur muss sich registrieren, Emissionsberichte einreichen und CBAM-Zertifikate kaufen.',
      },
      {
        tag: 'EVFTA · Compliance-Stack',
        lane: 'Elektronik · VN → DE',
        headline: '0%',
        headlineCaption: 'Zoll mit vier Compliance-Regimes',
        summary:
          'EU–Vietnam-FTA bringt 0 % Zoll mit REX-Ursprungserklärung auf der Rechnung. Aber Kapitel 85 löst CE LVD/EMC/RED + RoHS + WEEE-Herstellerregistrierung aus — vier parallele Compliance-Regimes neben der Zollersparnis.',
      },
    ],
  },
  pillarsSection: {
    title: 'Fünf Stufen. Eine Plattform.',
    intelligence: {
      kicker: 'Stufe 03 · Verifizieren · Flaggschiff',
      title: 'OrcaTrade Intelligence.',
      description:
        'EU/UK-Zoll, CBAM, EUDR, REACH, CE-Kennzeichnung, Anti-Dumping und Ausgleichszölle — aus einer kalkulator-fundierten Engine, mit Quellenangaben und Konfidenzstufen bei jeder Aussage.',
      cta: 'Intelligence öffnen',
    },
    search: {
      kicker: 'Stufe 01 · Finden',
      title: 'OrcaTrade Search.',
      description: 'HS-Code, Produkt, Lieferant oder Route eingeben. Jedes Regime, das es betrifft, sehen.',
      cta: 'Search öffnen',
    },
    sourcing: {
      kicker: 'Stufe 02 · Beschaffen',
      title: 'OrcaTrade Sourcing.',
      description: 'Sechs Asien-Quellen, Lieferanten-Screening, Fabrik-Risiko-Feeds, Sample-Angebot-Rebranding.',
      cta: 'Sourcing öffnen',
    },
    logistics: {
      kicker: 'Stufe 04 · Verschiffen',
      title: 'OrcaTrade Logistics.',
      description: 'Routen durch DE, NL, PL, ES, IT, FR und darüber hinaus. Tür-zu-Tür durchgehend bepreist.',
      cta: 'Logistics öffnen',
    },
    finance: {
      kicker: 'Stufe 05 · Finanzieren',
      title: 'OrcaTrade Finance.',
      description: 'Working Capital, FX-Hedging-Fenster, Total Cost of Ownership — für Bestellungen von 50.000–500.000 €.',
      cta: 'Finance öffnen',
    },
  },
  leadershipSection: {
    title: 'Gebaut von Leuten, die importiert haben.',
    lead:
      'Gegründet von Studierenden des University College London, die die Lücke zwischen europäischen Käufern und asiatischer Fertigung selbst erlebt haben.',
    members: [
      {
        role: 'CEO · Mitgründer',
        quote: 'Eine Fabrik, die Sie um 2 Uhr morgens anrufen können, ist zehn wert, denen Sie nur mailen können.',
        bio: 'Verantwortet Beschaffungsstrategie und Lieferantenpartnerschaften in Asien — Qualität, klare Kommunikation, verlässliche Zeitpläne.',
      },
      {
        role: 'Chief Operating Officer',
        quote: 'Ein Plan ist eine Hypothese. Nur die Ausführung bepreist sich selbst.',
        bio: 'Leitet die OrcaTrade-Operationen — verwandelt Plattformempfehlungen in ausgeführte Importe. Verantwortlich für Lieferketten-Delivery, Carrier und Partner.',
      },
      {
        role: 'Head of Logistics',
        quote: 'Ein Container kommt pünktlich an wegen hundert kleiner Entscheidungen, die Sie nie sehen werden.',
        bio: 'Steuert die Lieferplanung über See- und Luftrouten und hält Zeitpläne und Übergaben von der Fabrik bis zum Ziel im Takt.',
      },
      {
        role: 'Mitgründer · CFO',
        quote: 'Die günstigste Entscheidung ist die, die Sie modellieren können, bevor Sie sie treffen.',
        bio: 'Verantwortet europäische Operationen und Finanzplanung — hält kommerzielle Entscheidungen und grenzüberschreitende Ausführung in einer Linie.',
      },
    ],
  },
  newsSection: {
    title: 'Vom Schreibtisch — die Referenzbibliothek.',
    viewAll: 'Alle Compliance-Leitfäden',
    minSuffix: 'Min.',
    readGuide: 'Leitfaden lesen',
    items: [
      {
        tag: 'Compliance · CBAM',
        regime: 'Carbon Border Adjustment Mechanism',
        title: 'CBAM — was sich in der definitiven Periode ändert.',
        excerpt:
          'Berichterstattung schließt am 31. Dezember 2025. Ab Januar 2026 beginnen die finanziellen Pflichten: Registrierung, Erklärungen zu eingebetteten Emissionen und Kauf von CBAM-Zertifikaten für Stahl, Zement, Aluminium, Düngemittel, Strom und Wasserstoff.',
      },
      {
        tag: 'Compliance · EUDR',
        regime: 'EU Deforestation Regulation',
        title: 'EUDR — Sorgfaltspflichterklärungen und die Geolokalisierungsdatei.',
        excerpt:
          'Soja, Palmöl, Rind, Kaffee, Kakao, Kautschuk, Holz — und viele abgeleitete Produkte. Importeure reichen Sorgfaltspflichterklärungen mit Parzellen-Geolokalisierungen ein. Textilien folgen im nächsten Rollout-Fenster.',
      },
      {
        tag: 'Compliance · GPSR',
        regime: 'General Product Safety Regulation',
        title: 'GPSR — warum jeder Nicht-EU-Verkäufer jetzt eine EU-verantwortliche Person braucht.',
        excerpt:
          'Wirksam ab 13. Dezember 2024 für Verbraucherprodukte. Artikel 4 zwingt Nicht-EU-Verkäufer, einen in der EU ansässigen Wirtschaftsakteur zu benennen, bevor sie Waren auf den Markt bringen.',
      },
    ],
  },
  finalCta: {
    eyebrow: 'Eine letzte Sache',
    title: 'Ihr nächster Import, bis auf den Cent bepreist.',
    body:
      'Sagen Sie uns, was Sie beschaffen, woher es kommt und wohin es geht. Wir bepreisen die Route durchgehend, zeigen jedes Regime, das sie berührt, und übergeben Ihnen einen Plan, mit dem Sie loslegen können.',
    ctaPrimary: 'Meinen Importplan erstellen',
    ctaSecondary: 'Mit einem Menschen sprechen',
    footer: ['Keine Zahlung für die Anfrage', 'Kalkulator-fundiert, mit Quellenangaben', 'Deutsch · EUR · ISO-2'],
  },
};

export function copyFor(locale: Locale): HomepageCopy {
  if (locale === 'pl') return PL_COPY;
  if (locale === 'de') return DE_COPY;
  return EN_COPY;
}

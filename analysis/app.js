const API_ENDPOINT = '/api/analysis';

const SCENARIOS = {
  steel: {
    company: 'Acme Imports GmbH',
    productCategory: 'Iron and steel',
    productDescription: 'Hot-rolled rebar and structural beams',
    originCountry: 'CN',
    hsCode: '7214 99',
    supplier: 'Hangzhou Steel Co.',
    importValueEur: '1200000',
    importVolumeTonnes: '1200',
  },
  aluminium: {
    company: 'Nordic Components AS',
    productCategory: 'Aluminium',
    productDescription: 'Extrusions and unwrought ingot',
    originCountry: 'VN',
    hsCode: '7601 20',
    supplier: 'Saigon Light Metals Co.',
    importValueEur: '800000',
    importVolumeTonnes: '320',
  },
  cement: {
    company: 'BetonBau Holding',
    productCategory: 'Cement',
    productDescription: 'Portland cement and clinker',
    originCountry: 'TR',
    hsCode: '2523 29',
    supplier: 'Cimsa Çimento',
    importValueEur: '3000000',
    importVolumeTonnes: '28000',
  },
  fertiliser: {
    company: 'AgriDistrib NV',
    productCategory: 'Fertilisers',
    productDescription: 'Urea and ammonium nitrate',
    originCountry: 'IN',
    hsCode: '3102 10',
    supplier: 'IFFCO Ltd.',
    importValueEur: '600000',
    importVolumeTonnes: '1400',
    globalTurnoverEur: '12000000',
  },
  'eudr-wood': {
    company: 'Nordica Wood Products GmbH',
    productCategory: 'Wood furniture and plywood',
    productDescription: 'Plywood panels and finished furniture',
    originCountry: 'VN',
    hsCode: '4412 10',
    supplier: 'Saigon Timber Co.',
    importValueEur: '850000',
    globalTurnoverEur: '6500000',
  },
  'eudr-coffee': {
    company: 'Roastery Berlin AG',
    productCategory: 'Coffee, green and roasted',
    productDescription: 'Arabica green coffee, single-origin',
    originCountry: 'ET',
    hsCode: '0901 11',
    supplier: 'Sidamo Coffee Cooperative',
    importValueEur: '400000',
    globalTurnoverEur: '2500000',
  },
  'reach-electronics': {
    company: 'EuroSensor BV',
    productCategory: 'Electronic components',
    productDescription: 'Circuit boards, sensors, connectors',
    originCountry: 'CN',
    hsCode: '8542 31',
    supplier: 'Shenzhen Precision Electronics Co.',
    importValueEur: '1100000',
    globalTurnoverEur: '14000000',
  },
  'reach-textiles': {
    company: 'NordicWear OY',
    productCategory: 'Textiles and apparel',
    productDescription: 'Denim and cotton garments',
    originCountry: 'BD',
    hsCode: '6203 42',
    supplier: 'Dhaka Garments Ltd.',
    importValueEur: '650000',
    globalTurnoverEur: '8500000',
  },
  'ce-wireless': {
    company: 'AudioCraft GmbH',
    productCategory: 'Wireless audio equipment',
    productDescription: 'Bluetooth and Wi-Fi smart speaker with battery',
    originCountry: 'CN',
    hsCode: '8518 22',
    supplier: 'Shenzhen Audio Tech Co.',
    importValueEur: '1800000',
    globalTurnoverEur: '22000000',
  },
  'ce-machinery': {
    company: 'PrecisionTools BV',
    productCategory: 'Industrial machinery',
    productDescription: 'CNC milling machine with electrical control panel',
    originCountry: 'CN',
    hsCode: '8459 51',
    supplier: 'Shanghai Machine Tools Co.',
    importValueEur: '950000',
    globalTurnoverEur: '12000000',
  },
};

const els = {
  form: document.getElementById('form'),
  submit: document.getElementById('submit'),
  report: document.getElementById('report'),
  intro: document.getElementById('intro'),
  scenarios: document.querySelectorAll('.scenario-btn'),
  metaBlock: document.getElementById('meta-block'),
  blocks: {
    applicability: document.getElementById('block-applicability'),
    exposure: document.getElementById('block-exposure'),
    evidence: document.getElementById('block-evidence'),
    'eudr-applicability': document.getElementById('block-eudr-applicability'),
    'eudr-exposure': document.getElementById('block-eudr-exposure'),
    'eudr-evidence': document.getElementById('block-eudr-evidence'),
    'reach-applicability': document.getElementById('block-reach-applicability'),
    'reach-evidence': document.getElementById('block-reach-evidence'),
    'ce-applicability': document.getElementById('block-ce-applicability'),
    'ce-evidence': document.getElementById('block-ce-evidence'),
    timeline: document.getElementById('block-timeline'),
    actions: document.getElementById('block-actions'),
    citations: document.getElementById('block-citations'),
  },
  narratives: {
    executive: document.getElementById('narr-executive'),
    applicabilityNarrative: document.getElementById('narr-applicabilityNarrative'),
    exposureNarrative: document.getElementById('narr-exposureNarrative'),
    evidenceNarrative: document.getElementById('narr-evidenceNarrative'),
  },
  confidence: {
    executive: document.getElementById('conf-executive'),
    applicability: document.getElementById('conf-applicability'),
    exposure: document.getElementById('conf-exposure'),
    evidence: document.getElementById('conf-evidence'),
    'eudr-applicability': document.getElementById('conf-eudr-applicability'),
    'eudr-exposure': document.getElementById('conf-eudr-exposure'),
    'eudr-evidence': document.getElementById('conf-eudr-evidence'),
    'reach-applicability': document.getElementById('conf-reach-applicability'),
    'reach-evidence': document.getElementById('conf-reach-evidence'),
    'ce-applicability': document.getElementById('conf-ce-applicability'),
    'ce-evidence': document.getElementById('conf-ce-evidence'),
    actions: document.getElementById('conf-actions'),
  },
  footnote: document.getElementById('confidence-footnote'),
};

const state = {
  citationsById: new Map(),
  narrativeBuffers: {},
  actionsBuffer: '',
  meta: null,
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

function formatCurrency(value, currency = 'EUR') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value));
}

function formatNumber(value, opts = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IE', opts).format(Number(value));
}

function setConfidence(id, level, label) {
  const el = els.confidence[id];
  if (!el) return;
  el.classList.remove('green', 'amber', 'red');
  el.classList.add(level || 'amber');
  el.textContent = label;
}

function renderCitationChip(chunkId) {
  const card = state.citationsById.get(chunkId);
  if (!card) {
    return `<span class="cite" title="Unknown source">${escapeHtml(chunkId)}</span>`;
  }
  const ref = `${card.regulationLabel} · ${card.article}`;
  const sourceLink = card.sourceUrl ? `<a href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener" class="source-link">View on EUR-Lex →</a>` : '';
  return `<span class="cite-card-host">
    <span class="cite" data-cite="${escapeHtml(chunkId)}">${escapeHtml(ref)}</span>
    <span class="cite-card" hidden>
      <div class="ref">${escapeHtml(card.citation)}</div>
      <div class="title">${escapeHtml(card.title)}</div>
      <div>${escapeHtml(card.summary || '')}</div>
      ${sourceLink}
    </span>
  </span>`;
}

function processNarrativeText(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(/\[([a-z0-9][a-z0-9_\-]+)\]/gi, (_, id) => renderCitationChip(id));
}

function attachCitationHover(scope) {
  scope.querySelectorAll('.cite-card-host').forEach(host => {
    if (host.dataset.bound) return;
    host.dataset.bound = '1';
    const card = host.querySelector('.cite-card');
    if (!card) return;
    card.hidden = true;
    const open = () => { card.hidden = false; positionCard(host, card); };
    const close = () => { card.hidden = true; };
    host.addEventListener('mouseenter', open);
    host.addEventListener('mouseleave', close);
    host.addEventListener('focusin', open);
    host.addEventListener('focusout', close);
    host.addEventListener('click', e => { e.stopPropagation(); card.hidden = !card.hidden; if (!card.hidden) positionCard(host, card); });
  });
}

function positionCard(host, card) {
  const rect = host.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const overflowRight = rect.left + cardRect.width > window.innerWidth - 12;
  card.style.left = overflowRight ? 'auto' : '0';
  card.style.right = overflowRight ? '0' : 'auto';
}

function renderNarrative(sectionId) {
  const target = els.narratives[sectionId];
  if (!target) return;
  const text = state.narrativeBuffers[sectionId] || '';
  target.innerHTML = processNarrativeText(text);
  target.classList.remove('skeleton');
  attachCitationHover(target);
}

function handleNarrativeStart(sectionId) {
  state.narrativeBuffers[sectionId] = '';
  if (sectionId === 'actions') {
    state.actionsBuffer = '';
    return;
  }
  const target = els.narratives[sectionId];
  if (target) {
    target.classList.remove('skeleton');
    target.classList.add('streaming');
    target.innerHTML = '';
  }
}

function handleNarrativeDelta(sectionId, text) {
  if (sectionId === 'actions') {
    state.actionsBuffer += text;
    return;
  }
  state.narrativeBuffers[sectionId] = (state.narrativeBuffers[sectionId] || '') + text;
  renderNarrative(sectionId);
}

function handleNarrativeEnd(sectionId) {
  if (sectionId === 'actions') {
    renderActionsFromBuffer();
    setConfidence('actions', 'green', 'Final');
    return;
  }
  const target = els.narratives[sectionId];
  if (target) target.classList.remove('streaming');
  const confKey = sectionId === 'applicabilityNarrative' ? null : sectionId === 'exposureNarrative' ? null : sectionId === 'evidenceNarrative' ? null : sectionId;
  if (confKey === 'executive') setConfidence('executive', 'green', 'Final');
}

function renderActionsFromBuffer() {
  const buffer = state.actionsBuffer.trim();
  if (!buffer) {
    els.blocks.actions.innerHTML = '<div class="empty">No action plan returned. Review the evidence gaps section above.</div>';
    return;
  }
  const start = buffer.indexOf('[');
  const end = buffer.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    els.blocks.actions.innerHTML = '<div class="empty">Could not parse action plan. Check the report payload in DevTools.</div>';
    return;
  }
  let actions;
  try {
    actions = JSON.parse(buffer.slice(start, end + 1));
  } catch (error) {
    console.error('Action plan parse error', error, buffer);
    els.blocks.actions.innerHTML = '<div class="empty">Could not parse action plan JSON.</div>';
    return;
  }
  if (!Array.isArray(actions) || !actions.length) {
    els.blocks.actions.innerHTML = '<div class="empty">No actions provided.</div>';
    return;
  }
  els.blocks.actions.innerHTML = `<div class="action-list">${actions.map(action => {
    const citeIds = Array.isArray(action.citations) ? action.citations : [];
    const citeHtml = citeIds.map(id => renderCitationChip(id)).join(' ');
    return `<article class="action">
      <div class="action-rank">${escapeHtml(String(action.rank ?? '·'))}</div>
      <div>
        <div class="action-title">${escapeHtml(action.title || 'Action')}</div>
        <div class="action-why">${processNarrativeText(action.why || '')}</div>
        <div class="action-meta">
          <span><b>Owner:</b> ${escapeHtml(action.owner || 'Unassigned')}</span>
          <span><b>Deadline:</b> ${escapeHtml(action.deadline || '—')}</span>
          ${citeHtml ? `<span>${citeHtml}</span>` : ''}
        </div>
      </div>
    </article>`;
  }).join('')}</div>`;
  attachCitationHover(els.blocks.actions);
}

function renderApplicability(payload) {
  if (!payload) return;
  const conf = payload.confidence === 'green' ? 'green' : payload.confidence === 'red' ? 'red' : 'amber';
  setConfidence('applicability', conf, payload.applies ? 'Applies' : 'Does not apply');
  const card = state.citationsById.get(payload.citation);
  els.blocks.applicability.innerHTML = `
    <div class="card elev">
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">Verdict</span>
          <span class="meta-value">${payload.applies ? 'CBAM applies' : 'CBAM does not apply'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Annex I category</span>
          <span class="meta-value">${escapeHtml(payload.categoryKey ? payload.categoryKey.replace(/_/g, ' ') : '—')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Citation</span>
          <span class="meta-value mono">${escapeHtml(payload.citation || '—')}</span>
        </div>
      </div>
      <p style="margin-top:1rem; color: var(--text); font-size: 0.92rem; line-height: 1.7;">${escapeHtml(payload.reason || '')}</p>
      ${payload.confidenceNote ? `<p style="margin-top:0.6rem; font-size:0.78rem; color: var(--muted-2);">${escapeHtml(payload.confidenceNote)}</p>` : ''}
    </div>
  `;
}

function renderExposure(payload) {
  if (!payload || payload.unavailable) {
    els.blocks.exposure.innerHTML = `<div class="card"><div class="empty">${escapeHtml(payload && payload.reason ? payload.reason : 'Provide annual import value or tonnes to see exposure.')}</div></div>`;
    setConfidence('exposure', 'amber', 'Insufficient inputs');
    return;
  }
  const inferred = payload.tonnesGoodsInferred ? '<span style="color:var(--amber); font-size:0.74rem; margin-left:0.5rem;">(inferred from EUR)</span>' : '';
  const calcRows = (payload.calc || []).map(step => `
    <div class="calc-step">
      <span class="label">${escapeHtml(step.label)}</span>
      <span class="value">${escapeHtml(step.value)}</span>
      ${step.formula ? `<span class="calc-formula">${escapeHtml(step.formula)}</span><span></span>` : ''}
    </div>
  `).join('');

  els.blocks.exposure.innerHTML = `
    <div class="figure-row">
      <div class="figure">
        <div class="figure-label">Embedded emissions</div>
        <div class="figure-value">${formatNumber(Math.round(payload.tonnesEmissions.central))} <span style="font-size:0.7em; color: var(--muted);">tCO2e</span></div>
        <div class="figure-sub">Range ${formatNumber(Math.round(payload.tonnesEmissions.low))}–${formatNumber(Math.round(payload.tonnesEmissions.high))} based on intensity range.</div>
      </div>
      <div class="figure">
        <div class="figure-label">Annual certificate cost</div>
        <div class="figure-value">${formatCurrency(payload.certificateCostEur.central)}</div>
        <div class="figure-sub">Scenario ${formatCurrency(payload.certificateCostEur.low)}–${formatCurrency(payload.certificateCostEur.high)} on EUA price.</div>
      </div>
      <div class="figure">
        <div class="figure-label">Tonnes covered${inferred ? ' *' : ''}</div>
        <div class="figure-value">${formatNumber(payload.tonnesGoods)} <span style="font-size:0.7em; color: var(--muted);">t</span></div>
        <div class="figure-sub">Default intensity ${payload.intensity.value} ${payload.intensity.unit} (range ${payload.intensity.rangeLow}–${payload.intensity.rangeHigh}).</div>
      </div>
    </div>
    <div class="card">
      <div class="card-row">
        <h3 class="h3">Show the math</h3>
        <button class="calc-toggle" type="button" data-target="calc-body">Toggle calculation</button>
      </div>
      <div class="calc-body" id="calc-body">${calcRows}</div>
      <p style="margin-top:1rem; font-size:0.8rem; color: var(--muted-2); line-height:1.65;">
        Intensity source: ${escapeHtml(payload.intensity.source || '—')}.
        ETS price snapshot: ${escapeHtml(payload.etsPrice.source || '—')} (as of ${escapeHtml(payload.etsPrice.asOf)}).
        ${payload.tonnesGoodsInferred ? '<br/>* Tonnes inferred from EUR using indicative per-tonne reference values; provide tonnes directly for accuracy.' : ''}
      </p>
    </div>
  `;
  setConfidence('exposure', 'amber', 'Indicative · default values');

  const toggle = els.blocks.exposure.querySelector('.calc-toggle');
  const body = els.blocks.exposure.querySelector('.calc-body');
  if (toggle && body) {
    toggle.addEventListener('click', () => {
      body.classList.toggle('open');
      toggle.textContent = body.classList.contains('open') ? 'Hide calculation' : 'Show the math';
    });
  }
}

function renderPenalty(payload) {
  if (!payload) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.innerHTML = `
    <div class="card-row" style="align-items: baseline;">
      <h3 class="h3" style="color: var(--red);">If non-compliant</h3>
      <span class="conf red">Penalty exposure</span>
    </div>
    <p style="margin-top: 0.6rem; font-size: 0.92rem; color: var(--text); line-height: 1.7;">
      <b>${escapeHtml(payload.scenario)}.</b> Liability of <b>${formatCurrency(payload.penaltyEur)}</b>
      at €${payload.ratePerTonneEur}/tCO2e under <span class="cite">${escapeHtml(payload.citation)}</span>.
      ${payload.cumulativeWithCertificateObligation ? 'Penalty does not relieve the obligation to surrender certificates.' : ''}
    </p>
    <p style="margin-top: 0.5rem; font-size: 0.78rem; color: var(--muted-2);">${escapeHtml(payload.note || '')}</p>
  `;
  els.blocks.exposure.appendChild(wrapper);
}

function renderTimeline(payload) {
  const events = (payload && payload.events) || [];
  if (!events.length) {
    els.blocks.timeline.innerHTML = '<div class="empty">No timeline events.</div>';
    return;
  }
  els.blocks.timeline.innerHTML = `<div class="timeline">${events.map(ev => {
    const regBadge = ev.regulationId
      ? `<span style="font-size:0.62rem; letter-spacing:0.18em; text-transform:uppercase; color: var(--accent); padding: 0.15rem 0.4rem; border: 1px solid rgba(184,190,200,0.3); margin-right: 0.5rem;">${escapeHtml(ev.regulationId)}</span>`
      : '';
    const relevant = ev.relevantToImporter === false ? 'opacity: 0.55;' : '';
    return `<div class="tl-row ${ev.status}" style="${relevant}">
      <span class="tl-date">${escapeHtml(ev.date)}</span>
      <div>
        <div class="tl-milestone">${regBadge}${escapeHtml(ev.milestone)}</div>
        <div class="tl-detail">${escapeHtml(ev.detail || '')} ${ev.citation ? `<span class="cite">${escapeHtml(ev.citation)}</span>` : ''}</div>
      </div>
      <span class="tl-status">${escapeHtml(ev.status)}</span>
    </div>`;
  }).join('')}</div>`;
}

function renderEudrApplicability(payload) {
  if (!payload) return;
  const conf = payload.confidence === 'green' ? 'green' : payload.confidence === 'red' ? 'red' : 'amber';
  setConfidence('eudr-applicability', conf, payload.applies ? 'Applies' : 'Does not apply');
  els.blocks['eudr-applicability'].innerHTML = `
    <div class="card elev">
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">Verdict</span>
          <span class="meta-value">${payload.applies ? 'EUDR applies' : 'EUDR does not apply'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Annex I commodity</span>
          <span class="meta-value">${escapeHtml(payload.commodityLabel || (payload.commodityKey ? payload.commodityKey.replace(/_/g, ' ') : '—'))}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Cut-off date</span>
          <span class="meta-value mono">${escapeHtml(payload.cutOffDate || '—')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Citation</span>
          <span class="meta-value mono">${escapeHtml(payload.citation || '—')}</span>
        </div>
      </div>
      <p style="margin-top:1rem; color: var(--text); font-size: 0.92rem; line-height: 1.7;">${escapeHtml(payload.reason || '')}</p>
      ${payload.geolocationNote ? `<p style="margin-top:0.5rem; font-size:0.84rem; color: var(--muted);"><b>Geolocation note:</b> ${escapeHtml(payload.geolocationNote)}</p>` : ''}
      ${payload.confidenceNote ? `<p style="margin-top:0.6rem; font-size:0.78rem; color: var(--muted-2);">${escapeHtml(payload.confidenceNote)}</p>` : ''}
    </div>
  `;
}

function renderEudrExposure(payload) {
  if (!payload) return;
  const country = payload.countryRisk;
  const size = payload.sizeImplication;
  const penalty = payload.penalty;

  const figures = [];
  if (country) {
    figures.push(`
      <div class="figure">
        <div class="figure-label">Country signal</div>
        <div class="figure-value">${escapeHtml(country.code || '—')}</div>
        <div class="figure-sub">Likely classification: ${escapeHtml(country.likely || '—')}. ${escapeHtml(country.note || '')}</div>
      </div>
    `);
  }
  if (size) {
    figures.push(`
      <div class="figure">
        <div class="figure-label">Operator size</div>
        <div class="figure-value">${escapeHtml(size.size || '—')}</div>
        <div class="figure-sub">Application date: ${escapeHtml(size.applicationDate || '—')}. <span class="cite">${escapeHtml(size.citation || '')}</span></div>
      </div>
    `);
  } else {
    figures.push(`
      <div class="figure">
        <div class="figure-label">Operator size</div>
        <div class="figure-value" style="opacity:0.6;">—</div>
        <div class="figure-sub">Provide annual EU turnover to classify as SME vs non-SME and lock the application date.</div>
      </div>
    `);
  }
  if (penalty) {
    figures.push(`
      <div class="figure">
        <div class="figure-label">Penalty ceiling</div>
        <div class="figure-value">${formatCurrency(penalty.penaltyCeilingEur)}</div>
        <div class="figure-sub">${escapeHtml(penalty.rate || '4% of EU annual turnover')} · <span class="cite">${escapeHtml(penalty.citation || 'Reg. (EU) 2023/1115, Art. 25')}</span></div>
      </div>
    `);
  } else {
    figures.push(`
      <div class="figure">
        <div class="figure-label">Penalty ceiling</div>
        <div class="figure-value" style="opacity:0.6;">—</div>
        <div class="figure-sub">Provide annual turnover to compute 4%-of-turnover ceiling under Art. 25.</div>
      </div>
    `);
  }

  let nonFinancial = '';
  if (penalty && Array.isArray(penalty.nonFinancialConsequences) && penalty.nonFinancialConsequences.length) {
    nonFinancial = `
      <div class="card" style="margin-top: 1rem;">
        <h3 class="h3" style="color: var(--red); margin-bottom: 0.6rem;">Non-financial consequences</h3>
        <ul style="list-style: none; padding: 0; display: grid; gap: 0.4rem; font-size: 0.86rem; color: var(--text); line-height: 1.6;">
          ${penalty.nonFinancialConsequences.map(c => `<li style="display:flex; gap:0.6rem;"><span style="color: var(--red); flex-shrink:0;">▸</span><span>${escapeHtml(c)}</span></li>`).join('')}
        </ul>
        <p style="margin-top: 0.7rem; font-size: 0.78rem; color: var(--muted-2);">${escapeHtml(penalty.note || '')}</p>
      </div>
    `;
  }

  const conf = penalty && size ? 'amber' : 'amber';
  setConfidence('eudr-exposure', conf, penalty ? 'Indicative · ceiling' : 'Provide turnover');

  els.blocks['eudr-exposure'].innerHTML = `<div class="figure-row">${figures.join('')}</div>${nonFinancial}`;
}

function renderEudrEvidenceGaps(payload) {
  const items = (payload && payload.items) || [];
  if (!items.length) {
    els.blocks['eudr-evidence'].innerHTML = '<div class="card"><div class="empty">No EUDR evidence gaps detected for this scope.</div></div>';
    setConfidence('eudr-evidence', 'green', 'No gaps');
    return;
  }
  const blockerCount = items.filter(g => g.severity === 'blocker').length;
  setConfidence('eudr-evidence', blockerCount ? 'red' : 'amber', `${items.length} gap${items.length === 1 ? '' : 's'}`);

  els.blocks['eudr-evidence'].innerHTML = `<div class="gap-list">${items.map(gap => {
    const cite = gap.citation ? `<span class="cite">${escapeHtml(gap.citation)}</span>` : '';
    return `<article class="gap">
      <span class="gap-sev ${escapeHtml(gap.severity || 'medium')}">${escapeHtml(gap.severity || 'medium')}</span>
      <div class="gap-body">
        <div class="title">${escapeHtml(gap.title || '')}</div>
        <div class="desc">${escapeHtml(gap.description || '')} ${cite}</div>
      </div>
      <div class="gap-meta">
        <div><b>Owner:</b> ${escapeHtml(gap.owner || 'Unassigned')}</div>
        <div><b>Deadline:</b> ${escapeHtml(gap.deadline || '—')}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderCeApplicability(payload) {
  if (!payload) return;
  const verdict = payload.applies === true ? 'Applies' : payload.applies === 'maybe' ? 'Verify' : payload.applies === 'out_of_scope' ? 'Outside CE module' : 'Does not apply';
  const conf = payload.confidence === 'green' ? 'green' : 'amber';
  setConfidence('ce-applicability', conf, verdict);

  const directiveBadges = Array.isArray(payload.directives) && payload.directives.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:0.45rem; margin-top:0.9rem;">${payload.directives.map(d => `
        <span style="display:inline-flex; align-items:center; gap:0.35rem; padding:0.3rem 0.6rem; background: rgba(184,190,200,0.08); border:1px solid rgba(184,190,200,0.25); border-radius:2px; font-size:0.78rem;"><b>${escapeHtml(d.shortName)}</b><span style="opacity:0.65; font-family: var(--font-m); font-size:0.72rem;">${escapeHtml(d.instrument)}</span></span>`).join('')}</div>`
    : '';

  const moduleNotes = Array.isArray(payload.directives) && payload.directives.length
    ? `<div style="margin-top:1rem; display:grid; gap:0.5rem; font-size:0.84rem; line-height:1.6; color: var(--text);">${payload.directives.map(d => `<div><b>${escapeHtml(d.shortName)}:</b> ${escapeHtml(d.moduleNote || '')}</div>`).join('')}</div>`
    : '';

  els.blocks['ce-applicability'].innerHTML = `
    <div class="card elev">
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">Verdict</span>
          <span class="meta-value">${escapeHtml(verdict)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Product class</span>
          <span class="meta-value">${escapeHtml(payload.productClassLabel || '—')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Citation</span>
          <span class="meta-value mono">${escapeHtml(payload.citation || '—')}</span>
        </div>
      </div>
      <p style="margin-top:1rem; color: var(--text); font-size: 0.92rem; line-height: 1.7;">${escapeHtml(payload.reason || '')}</p>
      ${directiveBadges}
      ${moduleNotes}
      ${payload.confidenceNote ? `<p style="margin-top:0.7rem; font-size:0.78rem; color: var(--muted-2);">${escapeHtml(payload.confidenceNote)}</p>` : ''}
    </div>
  `;
}

function renderCeEvidenceGaps(payload) {
  const items = (payload && payload.items) || [];
  if (!items.length) {
    els.blocks['ce-evidence'].innerHTML = '<div class="card"><div class="empty">No CE evidence gaps detected for this scope.</div></div>';
    setConfidence('ce-evidence', 'green', 'No gaps');
    return;
  }
  const blockerCount = items.filter(g => g.severity === 'blocker').length;
  setConfidence('ce-evidence', blockerCount ? 'red' : 'amber', `${items.length} gap${items.length === 1 ? '' : 's'}`);

  els.blocks['ce-evidence'].innerHTML = `<div class="gap-list">${items.map(gap => {
    const cite = gap.citation ? `<span class="cite">${escapeHtml(gap.citation)}</span>` : '';
    return `<article class="gap">
      <span class="gap-sev ${escapeHtml(gap.severity || 'medium')}">${escapeHtml(gap.severity || 'medium')}</span>
      <div class="gap-body">
        <div class="title">${escapeHtml(gap.title || '')}</div>
        <div class="desc">${escapeHtml(gap.description || '')} ${cite}</div>
      </div>
      <div class="gap-meta">
        <div><b>Owner:</b> ${escapeHtml(gap.owner || 'Unassigned')}</div>
        <div><b>Deadline:</b> ${escapeHtml(gap.deadline || '—')}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderReachApplicability(payload) {
  if (!payload) return;
  const conf = payload.confidence === 'green' ? 'green' : 'amber';
  const verdict = payload.applies === true ? 'High relevance' : payload.applies === 'maybe' ? 'Verify' : 'Does not apply';
  setConfidence('reach-applicability', conf, verdict);
  const concerns = Array.isArray(payload.commonConcerns) && payload.commonConcerns.length
    ? `<p style="margin-top:0.7rem; font-size:0.86rem; color: var(--text); line-height: 1.65;"><b>Common substance concerns in this category:</b><br/>${payload.commonConcerns.map(c => escapeHtml(c)).join('<br/>')}</p>`
    : '';
  els.blocks['reach-applicability'].innerHTML = `
    <div class="card elev">
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">Verdict</span>
          <span class="meta-value">${escapeHtml(verdict)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Category</span>
          <span class="meta-value">${escapeHtml(payload.categoryLabel || (payload.categoryKey ? payload.categoryKey.replace(/_/g, ' ') : '—'))}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Citation</span>
          <span class="meta-value mono">${escapeHtml(payload.citation || '—')}</span>
        </div>
      </div>
      <p style="margin-top:1rem; color: var(--text); font-size: 0.92rem; line-height: 1.7;">${escapeHtml(payload.reason || '')}</p>
      ${concerns}
      ${payload.confidenceNote ? `<p style="margin-top:0.6rem; font-size:0.78rem; color: var(--muted-2);">${escapeHtml(payload.confidenceNote)}</p>` : ''}
    </div>
  `;
}

function renderReachEvidenceGaps(payload) {
  const items = (payload && payload.items) || [];
  if (!items.length) {
    els.blocks['reach-evidence'].innerHTML = '<div class="card"><div class="empty">No REACH evidence gaps detected for this scope.</div></div>';
    setConfidence('reach-evidence', 'green', 'No gaps');
    return;
  }
  const blockerCount = items.filter(g => g.severity === 'blocker').length;
  setConfidence('reach-evidence', blockerCount ? 'red' : 'amber', `${items.length} gap${items.length === 1 ? '' : 's'}`);

  els.blocks['reach-evidence'].innerHTML = `<div class="gap-list">${items.map(gap => {
    const cite = gap.citation ? `<span class="cite">${escapeHtml(gap.citation)}</span>` : '';
    return `<article class="gap">
      <span class="gap-sev ${escapeHtml(gap.severity || 'medium')}">${escapeHtml(gap.severity || 'medium')}</span>
      <div class="gap-body">
        <div class="title">${escapeHtml(gap.title || '')}</div>
        <div class="desc">${escapeHtml(gap.description || '')} ${cite}</div>
      </div>
      <div class="gap-meta">
        <div><b>Owner:</b> ${escapeHtml(gap.owner || 'Unassigned')}</div>
        <div><b>Deadline:</b> ${escapeHtml(gap.deadline || '—')}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderEvidenceGaps(payload) {
  const items = (payload && payload.items) || [];
  if (!items.length) {
    els.blocks.evidence.innerHTML = '<div class="card"><div class="empty">No evidence gaps detected for this scope.</div></div>';
    setConfidence('evidence', 'green', 'No gaps');
    return;
  }
  const blockerCount = items.filter(g => g.severity === 'blocker').length;
  setConfidence('evidence', blockerCount ? 'red' : 'amber', `${items.length} gap${items.length === 1 ? '' : 's'}`);

  els.blocks.evidence.innerHTML = `<div class="gap-list">${items.map(gap => {
    const cite = gap.citation ? `<span class="cite">${escapeHtml(gap.citation)}</span>` : '';
    return `<article class="gap">
      <span class="gap-sev ${escapeHtml(gap.severity || 'medium')}">${escapeHtml(gap.severity || 'medium')}</span>
      <div class="gap-body">
        <div class="title">${escapeHtml(gap.title || '')}</div>
        <div class="desc">${escapeHtml(gap.description || '')} ${cite}</div>
      </div>
      <div class="gap-meta">
        <div><b>Owner:</b> ${escapeHtml(gap.owner || 'Unassigned')}</div>
        <div><b>Deadline:</b> ${escapeHtml(gap.deadline || '—')}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderCitations(payload) {
  const items = (payload && payload.items) || [];
  for (const item of items) {
    state.citationsById.set(item.id, item);
    state.citationsById.set(item.citation, item);
  }
  if (!items.length) {
    els.blocks.citations.innerHTML = '<div class="empty">No citations bound to this analysis.</div>';
    return;
  }
  els.blocks.citations.innerHTML = items.map(card => `
    <div class="card">
      <div class="card-row">
        <div>
          <div style="font-family: var(--font-h); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent);">${escapeHtml(card.regulationLabel)} · ${escapeHtml(card.article)}</div>
          <div class="h3" style="margin-top: 0.3rem;">${escapeHtml(card.title)}</div>
        </div>
        <span class="conf ${card.confidence === 'verbatim' ? 'green' : 'amber'}">${escapeHtml(card.confidence)}</span>
      </div>
      <p style="margin-top: 0.7rem; font-size: 0.9rem; color: var(--text); line-height: 1.7;">${escapeHtml(card.summary || '')}</p>
      <p style="margin-top: 0.6rem; font-size: 0.78rem; color: var(--muted);">
        ${escapeHtml(card.citation)}
        ${card.sourceUrl ? ` · <a href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener" class="source-link">View on EUR-Lex →</a>` : ''}
      </p>
    </div>
  `).join('');
}

function renderMeta(payload) {
  state.meta = payload;
  if (!payload) return;
  els.metaBlock.innerHTML = `
    <div><b>Report</b> ${escapeHtml(payload.reportId || '')}</div>
    <div>Generated ${escapeHtml((payload.generatedAt || '').slice(0,16).replace('T', ' '))}</div>
    <div>As of ${escapeHtml(payload.asOfDate || '')}</div>
  `;

  const conf = payload.confidence || {};
  const note = `<b>Confidence:</b> regulation corpus is ${escapeHtml(conf.regulationCorpus || 'summary')}; default emissions intensities are ${escapeHtml(conf.defaultEmissions || 'indicative')}; ETS price is a ${escapeHtml(conf.etsPrice || 'snapshot')} (${escapeHtml(conf.etsPriceAsOf || '')}). ${escapeHtml(conf.regulationCorpusNote || '')}`;
  els.footnote.innerHTML = note;
}

function handleSection(id, payload) {
  switch (id) {
    case 'meta': renderMeta(payload); break;
    case 'inputs': /* echoed; not rendered */ break;
    case 'applicability': renderApplicability(payload); break;
    case 'exposure': renderExposure(payload); break;
    case 'penalty': renderPenalty(payload); break;
    case 'evidenceGaps': renderEvidenceGaps(payload); break;
    case 'carbonPriceCredit': /* surfaced via narrative */ break;
    case 'eudr-applicability': renderEudrApplicability(payload); break;
    case 'eudr-exposure': renderEudrExposure(payload); break;
    case 'eudr-evidenceGaps': renderEudrEvidenceGaps(payload); break;
    case 'reach-applicability': renderReachApplicability(payload); break;
    case 'reach-evidenceGaps': renderReachEvidenceGaps(payload); break;
    case 'reach-penalty': /* surfaced via narrative for now */ break;
    case 'ce-applicability': renderCeApplicability(payload); break;
    case 'ce-evidenceGaps': renderCeEvidenceGaps(payload); break;
    case 'ce-penalty': /* surfaced via narrative for now */ break;
    case 'timeline': renderTimeline(payload); break;
    case 'citations': renderCitations(payload); break;
    case 'narrative':
      if (payload && payload.fallback) {
        els.narratives.executive.innerHTML = escapeHtml(payload.fallback);
        els.narratives.executive.classList.remove('skeleton', 'streaming');
        setConfidence('executive', 'amber', 'Deterministic only');
      }
      break;
    default: break;
  }
}

function resetReport() {
  state.citationsById = new Map();
  state.narrativeBuffers = {};
  state.actionsBuffer = '';
  for (const key of Object.keys(els.narratives)) {
    const el = els.narratives[key];
    el.classList.remove('streaming');
    el.classList.add('skeleton');
    el.innerHTML = '';
  }
  for (const key of Object.keys(els.blocks)) {
    els.blocks[key].innerHTML = '<span class="skel w-80"></span><span class="skel w-70"></span>';
  }
  Object.keys(els.confidence).forEach(key => setConfidence(key, 'amber', 'Pending'));
  els.metaBlock.innerHTML = '';
  els.footnote.innerHTML = '';
}

async function streamAnalysis(payload) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error ${response.status}: ${text}`);
  }
  if (!response.body) {
    throw new Error('No response body for streaming.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');
      const dataLines = rawEvent.split('\n').filter(l => l.startsWith('data:'));
      if (!dataLines.length) continue;
      const text = dataLines.map(l => l.slice(5).trim()).join('\n');
      if (!text || text === '[DONE]') continue;
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        continue;
      }
      handleEvent(event);
    }
  }
}

function handleEvent(event) {
  switch (event.type) {
    case 'section': handleSection(event.id, event.payload); break;
    case 'narrative-start': handleNarrativeStart(event.id); break;
    case 'narrative-delta': handleNarrativeDelta(event.id, event.text); break;
    case 'narrative-end': handleNarrativeEnd(event.id); break;
    case 'narrative-error':
      console.warn('Narrative error', event);
      Object.keys(els.narratives).forEach(key => {
        if (!state.narrativeBuffers[key]) {
          els.narratives[key].classList.remove('skeleton', 'streaming');
          els.narratives[key].innerHTML = '<span style="color: var(--muted-2); font-style: italic;">Narrative unavailable. Deterministic sections above are unaffected.</span>';
        }
      });
      break;
    case 'done':
      els.submit.disabled = false;
      els.submit.textContent = 'Generate report';
      break;
    default: break;
  }
}

function applyScenario(key) {
  const scenario = SCENARIOS[key];
  if (!scenario) return;
  for (const [name, value] of Object.entries(scenario)) {
    const input = els.form.elements[name];
    if (input) input.value = value;
  }
}

function getFormPayload() {
  const formData = new FormData(els.form);
  const payload = {};
  for (const [k, v] of formData.entries()) {
    const value = String(v || '').trim();
    if (value) payload[k] = value;
  }
  return payload;
}

els.scenarios.forEach(btn => btn.addEventListener('click', () => applyScenario(btn.dataset.scenario)));

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = getFormPayload();
  if (!payload.productCategory && !payload.productDescription) {
    alert('Add at least a product category to begin.');
    return;
  }
  resetReport();
  els.report.classList.add('active');
  els.submit.disabled = true;
  els.submit.textContent = 'Generating…';
  els.report.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    await streamAnalysis(payload);
  } catch (error) {
    console.error('Analysis failed', error);
    els.submit.disabled = false;
    els.submit.textContent = 'Generate report';
    alert('Analysis failed: ' + error.message);
  }
});

// TOC scroll-spy
const tocLinks = document.querySelectorAll('.toc-list a');
const sections = Array.from(tocLinks).map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
function updateToc() {
  const fromTop = window.scrollY + 120;
  let current = sections[0];
  for (const section of sections) {
    if (section.offsetTop <= fromTop) current = section;
  }
  if (!current) return;
  tocLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + current.id));
}
window.addEventListener('scroll', updateToc, { passive: true });

const {
  CATEGORY_SPECIALITIES,
  COUNTRY_CITIES,
  COUNTRY_ROUTE_CONTEXT,
  cleanString,
  isCbamCategoryText,
  isEudrCategoryText,
  normaliseCountry,
} = require('./catalog');

const STATUS_SEQUENCE = ['IN TRANSIT', 'AT RISK', 'AT PORT', 'DELAYED'];
const JOURNEY_STEPS = [5, 4, 6, 2];
const STEP_PROGRESS_MAP = { 1: 8, 2: 18, 3: 30, 4: 42, 5: 60, 6: 78, 7: 90, 8: 99 };
const VALID_CONTAINER_TYPES = ['20ft', '40ft', '40ft HC', '45ft', 'Reefer'];
const VALID_INCOTERMS = ['FOB', 'CIF', 'EXW', 'DDP', 'DAP'];
const VALID_TRENDS = ['Worsening', 'Stable', 'Improving'];
const VALID_CONGESTION_LEVELS = ['LOW', 'MODERATE', 'HIGH', 'SEVERE'];
const VALID_IMPACTS = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_CS_DDD = ['Compliant', 'At Risk'];
const VALID_EUDR_CBAM = ['Compliant', 'At Risk', 'N/A'];
const VESSELS = [
  'MSC Gülsün',
  'Maersk Mc-Kinney Møller',
  'CMA CGM Jacques Saadé',
  'Ever Alot',
  'HMM Algeciras',
  'ONE Innovation',
];

function normalizeSupplyChainInput(input = {}) {
  const categories = Array.isArray(input.categories)
    ? input.categories.map(value => cleanString(value)).filter(Boolean)
    : [cleanString(input.categories)].filter(Boolean);

  return {
    company: cleanString(input.company) || 'Your Company',
    sourcingCountry: normaliseCountry(input.sourcingCountry, 'China'),
    categories: categories.length ? categories : ['Electronics & Components'],
    supplierCount: Math.max(1, Math.min(100, Math.round(Number(input.supplierCount) || 4))),
    destinationPort: cleanString(input.destinationPort) || 'Rotterdam',
    mainConcern: cleanString(input.mainConcern) || 'Port congestion',
  };
}

function formatDateFromNow(daysAhead) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function parseDateMaybe(value) {
  const parsed = Date.parse(cleanString(value));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function isFutureDateString(value) {
  const parsed = parseDateMaybe(value);
  if (!parsed) return false;
  return parsed.getTime() > Date.now() + (24 * 60 * 60 * 1000);
}

function productDescriptionForCategory(category, index) {
  const specialities = CATEGORY_SPECIALITIES[category] || CATEGORY_SPECIALITIES.Other;
  return specialities[index % specialities.length];
}

function routeContextForCountry(country) {
  return COUNTRY_ROUTE_CONTEXT[country] || COUNTRY_ROUTE_CONTEXT.China;
}

function buildSupplierName(city, category, index) {
  const stem = productDescriptionForCategory(category, index).replace(/(^\w)|(\s\w)/g, match => match.toUpperCase());
  const suffixes = ['Manufacturing Co.', 'Industrial Ltd.', 'Export Group', 'Production Works'];
  return `${city} ${stem} ${suffixes[index % suffixes.length]}`;
}

function billOfLading(line, index) {
  const prefix = cleanString(line).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'OTX';
  return `${prefix}-${String(841100 + (index * 317)).padStart(6, '0')}`;
}

function regulationStatusForShipment(category, status, factoryRiskScore) {
  const text = category.toLowerCase();
  const riskDrivenStatus = (status === 'AT RISK' || status === 'DELAYED' || factoryRiskScore < 60) ? 'At Risk' : 'Compliant';

  return {
    eudr: isEudrCategoryText(text) ? riskDrivenStatus : 'N/A',
    cbam: isCbamCategoryText(text) ? riskDrivenStatus : 'N/A',
    csddd: factoryRiskScore >= 65 ? 'Compliant' : 'At Risk',
  };
}

function buildRiskFlag(status, shipment, input) {
  if (status === 'IN TRANSIT' || status === 'AT PORT') return null;

  if (status === 'AT RISK') {
    return {
      title: `${input.mainConcern || 'Operational'} alert on ${shipment.id}`,
      estimatedDelayDays: 8,
      financialImpactEur: Math.round((shipment.orderValueEur || 180000) * 0.03),
      recommendedAction: `Escalate with ${shipment.shippingLine} and ${shipment.supplierName} to protect the ${shipment.destinationPort} delivery window.`,
    };
  }

  return {
    title: `${shipment.supplierCity} production delay`,
    estimatedDelayDays: 12,
    financialImpactEur: Math.round((shipment.orderValueEur || 180000) * 0.05),
    recommendedAction: `Request a revised production release from ${shipment.supplierName} and re-sequence the ${shipment.destinationPort} booking.`,
  };
}

function buildFallbackShipment(input, index) {
  const country = input.sourcingCountry;
  const category = input.categories[index % input.categories.length];
  const cities = COUNTRY_CITIES[country] || COUNTRY_CITIES.China;
  const city = cities[index % cities.length];
  const route = routeContextForCountry(country);
  const shippingLine = route.shippingLines[index % route.shippingLines.length];
  const status = STATUS_SEQUENCE[index % STATUS_SEQUENCE.length];
  const journeyStep = JOURNEY_STEPS[index % JOURNEY_STEPS.length];
  const progressPercent = STEP_PROGRESS_MAP[journeyStep];
  const etaDays = [18, 26, 12, 42][index % 4];
  const factoryRiskScore = [84, 58, 76, 44][index % 4];
  const shipment = {
    id: `OT-2026-${String(8401 + index).padStart(4, '0')}`,
    supplierName: buildSupplierName(city, category, index),
    supplierCity: city,
    supplierCountry: country,
    destinationPort: input.destinationPort,
    productCategory: category,
    productDescription: productDescriptionForCategory(category, index),
    status,
    eta: formatDateFromNow(etaDays),
    progressPercent,
    vesselName: VESSELS[index % VESSELS.length],
    currentPosition: [
      `Approaching ${route.transitHub} transshipment hub`,
      `Queued outside ${route.transitHub} for onward loading`,
      `Waiting at ${input.destinationPort} anchorage`,
      `Awaiting loading at ${city} export terminal`,
    ][index % 4],
    shippingLine,
    containerCount: 2 + index,
    containerType: VALID_CONTAINER_TYPES[index % VALID_CONTAINER_TYPES.length],
    orderValueEur: [420000, 210000, 610000, 295000][index % 4],
    incoterms: VALID_INCOTERMS[index % VALID_INCOTERMS.length],
    billOfLading: billOfLading(shippingLine, index),
    journeyStep,
    riskFlag: null,
    eudr: 'N/A',
    cbam: 'N/A',
    csddd: 'Compliant',
    factoryRiskScore,
  };

  shipment.riskFlag = buildRiskFlag(status, shipment, input);
  const regulation = regulationStatusForShipment(category, status, factoryRiskScore);
  shipment.eudr = regulation.eudr;
  shipment.cbam = regulation.cbam;
  shipment.csddd = regulation.csddd;
  return shipment;
}

function buildPortConditions(shipments, input) {
  const route = routeContextForCountry(input.sourcingCountry);
  return [
    {
      portName: input.destinationPort,
      congestionLevel: 'MODERATE',
      averageDelayDays: 3,
      trend: 'Stable',
    },
    {
      portName: `${route.transitHub} (Transit Hub)`,
      congestionLevel: shipments.some(shipment => shipment.status === 'AT RISK') ? 'HIGH' : 'MODERATE',
      averageDelayDays: shipments.some(shipment => shipment.status === 'AT RISK') ? 6 : 4,
      trend: shipments.some(shipment => shipment.status === 'AT RISK') ? 'Worsening' : 'Stable',
    },
  ];
}

function buildDisruptionForecast(input) {
  const route = routeContextForCountry(input.sourcingCountry);
  return [
    {
      title: route.disruptionThemes[0],
      affectedRegion: `${input.sourcingCountry} export corridor`,
      impact: 'HIGH',
      dateRange: 'Next 30-45 days',
      recommendedAction: `Build schedule buffer into ${input.destinationPort} arrivals and pre-alert customers for potential slippage.`,
    },
    {
      title: route.disruptionThemes[1],
      affectedRegion: `${route.transitHub} / Suez corridor`,
      impact: 'MEDIUM',
      dateRange: 'Next 45-60 days',
      recommendedAction: `Lock in space with the carrier early for shipments transiting ${route.transitHub}.`,
    },
  ];
}

function buildSupplierSummary(shipments) {
  return shipments.slice(0, 3).map(shipment => ({
    name: shipment.supplierName,
    riskScore: shipment.factoryRiskScore,
    status: shipment.status === 'DELAYED'
      ? 'Production delay is active and requires immediate supplier follow-up.'
      : shipment.status === 'AT RISK'
        ? 'Operational risk is elevated and should be monitored daily.'
        : 'Current operating profile is stable against the live shipment plan.',
  }));
}

function buildRecommendations(shipments, portConditions, disruptionForecast, input) {
  const delayed = shipments.find(shipment => shipment.status === 'DELAYED') || shipments[0];
  const atRisk = shipments.find(shipment => shipment.status === 'AT RISK') || shipments[1] || shipments[0];
  const destinationPort = portConditions[0];
  const highImpact = disruptionForecast.find(item => item.impact === 'HIGH') || disruptionForecast[0];

  return [
    `Prioritise escalation on ${delayed.id} with ${delayed.supplierName}; the current ${delayed.status.toLowerCase()} state threatens the ${input.destinationPort} arrival window.`,
    `Monitor ${destinationPort.portName} and ${atRisk.id} together: ${destinationPort.congestionLevel.toLowerCase()} congestion plus ${atRisk.status.toLowerCase()} status is the main near-term delivery risk.`,
    `Act on "${highImpact.title}" now by adding buffer to all ${input.sourcingCountry} shipments routed into ${input.destinationPort}.`,
  ];
}

function computeSummary(shipments, portConditions, disruptionForecast, company) {
  const atRiskCount = shipments.filter(shipment => shipment.status === 'AT RISK' || shipment.status === 'DELAYED').length;
  const highImpactCount = disruptionForecast.filter(item => item.impact === 'HIGH').length;

  let healthPenalty = 0;
  shipments.forEach(shipment => {
    if (shipment.status === 'AT RISK') healthPenalty += 15;
    if (shipment.status === 'DELAYED') healthPenalty += 8;
  });

  portConditions.forEach(port => {
    if (port.congestionLevel === 'MODERATE') healthPenalty += 3;
    if (port.congestionLevel === 'HIGH') healthPenalty += 5;
    if (port.congestionLevel === 'SEVERE') healthPenalty += 8;
  });

  disruptionForecast.forEach(item => {
    if (item.impact === 'HIGH') healthPenalty += 5;
  });

  return {
    activeShipments: shipments.length,
    portsMonitored: portConditions.length,
    disruptionAlerts: atRiskCount + highImpactCount,
    healthScore: Math.max(30, Math.min(100, 100 - healthPenalty)),
    companyName: company,
  };
}

function buildSupplyChainMock(input = {}) {
  const filters = normalizeSupplyChainInput(input);
  const shipments = Array.from({ length: 4 }, (_, index) => buildFallbackShipment(filters, index));
  const portConditions = buildPortConditions(shipments, filters);
  const disruptionForecast = buildDisruptionForecast(filters);
  const supplierSummary = buildSupplierSummary(shipments);
  const recommendations = buildRecommendations(shipments, portConditions, disruptionForecast, filters);
  const summary = computeSummary(shipments, portConditions, disruptionForecast, filters.company);

  return {
    summary,
    shipments,
    portConditions,
    disruptionForecast,
    supplierSummary,
    recommendations,
  };
}

function clampInteger(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function pickValid(value, validValues, fallback) {
  return validValues.includes(value) ? value : fallback;
}

function sanitiseShipment(candidate, fallback, input) {
  const shipment = candidate && typeof candidate === 'object' ? candidate : {};
  const cities = COUNTRY_CITIES[input.sourcingCountry] || COUNTRY_CITIES.China;
  const supplierCity = cities.includes(cleanString(shipment.supplierCity)) ? cleanString(shipment.supplierCity) : fallback.supplierCity;
  const productCategory = input.categories.includes(cleanString(shipment.productCategory))
    ? cleanString(shipment.productCategory)
    : fallback.productCategory;
  const status = pickValid(cleanString(shipment.status), STATUS_SEQUENCE, fallback.status);
  const journeyStep = clampInteger(shipment.journeyStep, 1, 8, fallback.journeyStep);
  const expectedProgress = STEP_PROGRESS_MAP[journeyStep];
  const progressPercent = clampInteger(shipment.progressPercent, 1, 100, expectedProgress);
  const factoryRiskScore = clampInteger(shipment.factoryRiskScore, 20, 95, fallback.factoryRiskScore);

  const cleaned = {
    id: cleanString(shipment.id) || fallback.id,
    supplierName: cleanString(shipment.supplierName) || fallback.supplierName,
    supplierCity,
    supplierCountry: input.sourcingCountry,
    destinationPort: input.destinationPort,
    productCategory,
    productDescription: cleanString(shipment.productDescription) || fallback.productDescription,
    status,
    eta: isFutureDateString(shipment.eta) ? cleanString(shipment.eta) : fallback.eta,
    progressPercent: Math.abs(progressPercent - expectedProgress) > 20 ? expectedProgress : progressPercent,
    vesselName: cleanString(shipment.vesselName) || fallback.vesselName,
    currentPosition: cleanString(shipment.currentPosition) || fallback.currentPosition,
    shippingLine: cleanString(shipment.shippingLine) || fallback.shippingLine,
    containerCount: clampInteger(shipment.containerCount, 1, 500, fallback.containerCount),
    containerType: pickValid(cleanString(shipment.containerType), VALID_CONTAINER_TYPES, fallback.containerType),
    orderValueEur: clampInteger(shipment.orderValueEur, 1000, 5000000, fallback.orderValueEur),
    incoterms: pickValid(cleanString(shipment.incoterms), VALID_INCOTERMS, fallback.incoterms),
    billOfLading: cleanString(shipment.billOfLading) || fallback.billOfLading,
    journeyStep,
    riskFlag: shipment.riskFlag && typeof shipment.riskFlag === 'object' ? shipment.riskFlag : null,
    eudr: pickValid(cleanString(shipment.eudr), VALID_EUDR_CBAM, fallback.eudr),
    cbam: pickValid(cleanString(shipment.cbam), VALID_EUDR_CBAM, fallback.cbam),
    csddd: pickValid(cleanString(shipment.csddd), VALID_CS_DDD, fallback.csddd),
    factoryRiskScore,
  };

  cleaned.riskFlag = buildRiskFlag(status, cleaned, input);
  const regulation = regulationStatusForShipment(productCategory, status, factoryRiskScore);
  cleaned.eudr = regulation.eudr;
  cleaned.cbam = regulation.cbam;
  cleaned.csddd = regulation.csddd;

  return cleaned;
}

function sanitisePortCondition(candidate, fallback, input, index) {
  const port = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    portName: index === 0 ? input.destinationPort : (cleanString(port.portName) || fallback.portName),
    congestionLevel: pickValid(cleanString(port.congestionLevel), VALID_CONGESTION_LEVELS, fallback.congestionLevel),
    averageDelayDays: clampInteger(port.averageDelayDays, 0, 30, fallback.averageDelayDays),
    trend: pickValid(cleanString(port.trend), VALID_TRENDS, fallback.trend),
  };
}

function sanitiseForecast(candidate, fallback) {
  const item = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    title: cleanString(item.title) || fallback.title,
    affectedRegion: cleanString(item.affectedRegion) || fallback.affectedRegion,
    impact: pickValid(cleanString(item.impact), VALID_IMPACTS, fallback.impact),
    dateRange: cleanString(item.dateRange) || fallback.dateRange,
    recommendedAction: cleanString(item.recommendedAction) || fallback.recommendedAction,
  };
}

function sanitizeSupplyChainResult(raw, input = {}) {
  const filters = normalizeSupplyChainInput(input);
  const fallback = buildSupplyChainMock(filters);
  const source = raw && typeof raw === 'object' ? raw : {};

  const shipments = Array.from({ length: 4 }, (_, index) =>
    sanitiseShipment(Array.isArray(source.shipments) ? source.shipments[index] : null, fallback.shipments[index], filters)
  );

  const portConditions = Array.from({ length: 2 }, (_, index) =>
    sanitisePortCondition(Array.isArray(source.portConditions) ? source.portConditions[index] : null, fallback.portConditions[index], filters, index)
  );

  const disruptionForecast = Array.from({ length: 2 }, (_, index) =>
    sanitiseForecast(Array.isArray(source.disruptionForecast) ? source.disruptionForecast[index] : null, fallback.disruptionForecast[index])
  );

  const supplierSummary = buildSupplierSummary(shipments);
  const recommendations = buildRecommendations(shipments, portConditions, disruptionForecast, filters);
  const summary = computeSummary(shipments, portConditions, disruptionForecast, filters.company);

  return {
    summary,
    shipments,
    portConditions,
    disruptionForecast,
    supplierSummary,
    recommendations,
  };
}

module.exports = {
  STEP_PROGRESS_MAP,
  buildSupplyChainMock,
  normalizeSupplyChainInput,
  sanitizeSupplyChainResult,
};

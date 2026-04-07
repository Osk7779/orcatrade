const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSupplyChainMock,
  sanitizeSupplyChainResult,
} = require('../lib/intelligence/supply-chain');

test('supply chain mock is aligned to the selected sourcing country and categories', () => {
  const data = buildSupplyChainMock({
    company: 'Acme Imports',
    sourcingCountry: 'India',
    categories: ['Steel & Metal Products'],
    supplierCount: 7,
    destinationPort: 'Rotterdam',
    mainConcern: 'Port congestion',
  });

  assert.equal(data.shipments.length, 4);
  assert.equal(data.portConditions.length, 2);
  assert.equal(data.disruptionForecast.length, 2);
  assert.equal(data.supplierSummary.length, 3);
  assert.equal(data.recommendations.length, 3);
  assert.equal(data.summary.activeShipments, 4);
  assert.equal(data.summary.portsMonitored, 2);

  data.shipments.forEach(shipment => {
    assert.equal(shipment.supplierCountry, 'India');
    assert.equal(shipment.destinationPort, 'Rotterdam');
    assert.equal(shipment.productCategory, 'Steel & Metal Products');
    assert.ok(Date.parse(shipment.eta) > Date.now());
    if (shipment.status === 'IN TRANSIT' || shipment.status === 'AT PORT') {
      assert.equal(shipment.riskFlag, null);
    } else {
      assert.ok(shipment.riskFlag);
    }
  });
});

test('supply chain sanitiser repairs invalid dashboard data', () => {
  const data = sanitizeSupplyChainResult({
    shipments: [
      {
        supplierCountry: 'China',
        supplierCity: 'Shenzhen',
        productCategory: 'Other',
        status: 'IN TRANSIT',
        eta: '01 Jan 2020',
        riskFlag: { title: 'Should not exist' },
        journeyStep: 8,
        progressPercent: 4,
      },
    ],
    portConditions: [{ portName: 'Wrong Port', congestionLevel: 'BROKEN', trend: 'Nope' }],
    disruptionForecast: [{ impact: 'BROKEN' }],
  }, {
    company: 'Nordic Buyer',
    sourcingCountry: 'Thailand',
    categories: ['Textiles & Apparel'],
    destinationPort: 'Hamburg',
    mainConcern: 'Delay risk',
  });

  assert.equal(data.shipments.length, 4);
  assert.equal(data.shipments[0].supplierCountry, 'Thailand');
  assert.equal(data.shipments[0].destinationPort, 'Hamburg');
  assert.equal(data.shipments[0].productCategory, 'Textiles & Apparel');
  assert.equal(data.shipments[0].riskFlag, null);
  assert.ok(Date.parse(data.shipments[0].eta) > Date.now());
  assert.equal(data.portConditions[0].portName, 'Hamburg');
  assert.equal(data.portConditions.length, 2);
  assert.equal(data.disruptionForecast.length, 2);
});

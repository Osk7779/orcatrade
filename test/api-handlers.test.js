const test = require('node:test');
const assert = require('node:assert/strict');

const evidenceHandler = require('../api/evidence');
const quickCheckHandler = require('../api/quick-check');
const reportHandler = require('../api/report');
const reportsHandler = require('../api/reports');
const workspaceHandler = require('../api/workspace');
const { buildDeterministicFallbackReport } = require('../lib/intelligence/compliance');
const { createAccountAccessToken, createReportAccessToken, createWorkspaceAccessToken } = require('../lib/intelligence/report-access');
const { persistComplianceReport } = require('../lib/intelligence/runtime-store');

function createMockResponse() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function invokeHandler(handler, options = {}) {
  const req = {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    query: options.query || {},
  };
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

function loadFactoryScoreHandlerWithThrowingModel() {
  const handlerPath = require.resolve('../api/factory-score');
  const runtimePath = require.resolve('../lib/intelligence/model-runtime');
  const originalRuntime = require(runtimePath);
  const originalExports = require.cache[runtimePath].exports;

  delete require.cache[handlerPath];
  require.cache[runtimePath].exports = {
    ...originalRuntime,
    requestAnthropicMessage: async () => {
      throw new Error('mock model unavailable');
    },
  };

  const handler = require(handlerPath);

  return {
    handler,
    restore() {
      delete require.cache[handlerPath];
      require.cache[runtimePath].exports = originalExports;
    },
  };
}

test('evidence endpoint persists and retrieves evidence bundles with signed workspace access', async () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const postResponse = await invokeHandler(evidenceHandler, {
    method: 'POST',
    headers: { 'x-request-id': 'req-evidence-001' },
    body: {
      company: 'Northline Imports',
      email: 'ops@northline.test',
      evidenceDocuments: [
        {
          name: 'CBAM supplier pack',
          type: 'text/plain',
          text: 'CN code: 7208.37. Authorised CBAM declarant status: yes. Supplier emissions data: available.',
        },
      ],
    },
  });

  assert.equal(postResponse.statusCode, 200);
  assert.equal(postResponse.getHeader('x-orcatrade-request-id'), 'req-evidence-001');
  assert.ok(postResponse.body.bundleId);
  assert.equal(postResponse.body.workspaceAccess.enabled, true);
  assert.equal(postResponse.body.workspaceAccess.mode, 'signed_workspace_token');
  assert.match(postResponse.body.workspaceAccess.retrievalPath, /\/api\/evidence\?bundleId=/);

  const getResponse = await invokeHandler(evidenceHandler, {
    method: 'GET',
    headers: { 'x-request-id': 'req-evidence-002' },
    query: {
      bundleId: postResponse.body.bundleId,
      workspaceToken: postResponse.body.workspaceAccess.token,
    },
  });

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.getHeader('x-orcatrade-request-id'), 'req-evidence-002');
  assert.equal(getResponse.body.bundleId, postResponse.body.bundleId);
  assert.equal(getResponse.body.requestMeta.route, 'evidence');

  const listResponse = await invokeHandler(evidenceHandler, {
    method: 'GET',
    query: {
      workspaceToken: postResponse.body.workspaceAccess.token,
    },
  });

  assert.equal(listResponse.statusCode, 200);
  assert.ok(Array.isArray(listResponse.body.bundles));
  assert.ok(listResponse.body.bundles.some(item => item.bundleId === postResponse.body.bundleId));
});

test('quick-check endpoint accepts evidence documents and returns request tracing headers', async () => {
  delete process.env.ORCATRADE_OS_API;
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const response = await invokeHandler(quickCheckHandler, {
    method: 'POST',
    headers: { 'x-request-id': 'req-quick-001' },
    body: {
      productCategory: 'Steel & Metal',
      origin: 'China',
      evidenceDocuments: [
        {
          name: 'Importer dossier',
          type: 'text/plain',
          text: 'HS code: 7318.15. Authorised CBAM declarant status: confirmed. Supplier emissions data: available.',
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.getHeader('x-orcatrade-request-id'), 'req-quick-001');
  assert.ok(response.getHeader('x-orcatrade-evidence-bundle'));
  assert.equal(response.body.documentEvidence.documentCount, 1);
  assert.ok(response.body.documentEvidence.bundleId);
});

test('report endpoints expose request metadata for stored reports', async () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const orderData = {
    company: 'Northline Imports',
    email: 'ops@northline.test',
    productCategory: 'Steel & Metal',
    productDescription: 'Steel fasteners',
    origin: 'China',
    importValue: 'Over €5M',
    companySize: '250–1000 employees',
    asOfDate: '2026-04-09',
  };
  const report = buildDeterministicFallbackReport(orderData, {
    reportId: 'OT-COMP-HANDLER-001',
    timestamp: '2026-04-09T10:00:00.000Z',
    reason: 'Handler test fallback',
  });
  await persistComplianceReport(report, orderData, {
    route: 'handler-test',
    reportId: report.reportId,
  }, 5000);

  const reportToken = createReportAccessToken(report.reportId);
  const accountToken = createAccountAccessToken(report.reportOwnership.ownerFingerprint);
  const workspaceToken = createWorkspaceAccessToken(report.reportOwnership.workspaceFingerprint);

  const reportResponse = await invokeHandler(reportHandler, {
    method: 'GET',
    headers: { 'x-request-id': 'req-report-001' },
    query: {
      reportId: report.reportId,
      accessToken: reportToken.token,
      workspaceToken: workspaceToken.token,
    },
  });

  assert.equal(reportResponse.statusCode, 200);
  assert.equal(reportResponse.getHeader('x-orcatrade-request-id'), 'req-report-001');
  assert.equal(reportResponse.body.reportId, report.reportId);
  assert.equal(reportResponse.body.requestMeta.route, 'report');

  const reportsResponse = await invokeHandler(reportsHandler, {
    method: 'GET',
    query: {
      workspaceToken: workspaceToken.token,
    },
  });

  assert.equal(reportsResponse.statusCode, 200);
  assert.ok(Array.isArray(reportsResponse.body.reports));
  assert.ok(reportsResponse.body.reports.some(item => item.reportId === report.reportId));
  assert.equal(reportsResponse.body.requestMeta.route, 'reports');
  assert.equal(accountToken.mode, 'signed_account_token');
});

test('workspace endpoint returns a unified workspace view for reports and evidence', async () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const setupResponse = await invokeHandler(workspaceHandler, {
    method: 'POST',
    body: {
      company: 'Northline Imports',
      email: 'ops@northline.test',
    },
  });

  assert.equal(setupResponse.statusCode, 200);
  assert.equal(setupResponse.body.workspace.workspaceLabel, 'Northline Imports');
  assert.equal(setupResponse.body.workspaceAccess.enabled, true);

  const workspaceView = await invokeHandler(workspaceHandler, {
    method: 'GET',
    query: {
      workspaceToken: setupResponse.body.workspaceAccess.token,
    },
  });

  assert.equal(workspaceView.statusCode, 200);
  assert.equal(workspaceView.body.requestMeta.route, 'workspace');
  assert.ok(Array.isArray(workspaceView.body.reports));
  assert.ok(Array.isArray(workspaceView.body.evidenceBundles));
  assert.ok(workspaceView.body.reportCount >= 1);
  assert.ok(workspaceView.body.evidenceCount >= 1);
});

test('factory-score endpoint does not claim a false directory match for unknown exact company names', async () => {
  process.env.ORCATRADE_OS_API = 'test-api-key';
  const originalConsoleError = console.error;
  const { handler, restore } = loadFactoryScoreHandlerWithThrowingModel();
  console.error = () => {};

  try {
    const response = await invokeHandler(handler, {
      method: 'POST',
      body: {
        query: 'Acme Plastics',
        category: 'Rubber & Plastics',
        country: 'China',
        riskTolerance: 'Any risk level',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.getHeader('x-orcatrade-generation-mode'), 'deterministic_fallback');
    assert.equal(response.body.queryMode, 'exact_factory');
    assert.equal(response.body.resultMode, 'provisional_exact_lookup');
    assert.equal(response.body.factories[0].name, 'Acme Plastics');
  } finally {
    console.error = originalConsoleError;
    restore();
    delete process.env.ORCATRADE_OS_API;
  }
});

test('factory-score endpoint returns verified directory network results for market scans without synthetic fallback', async () => {
  process.env.ORCATRADE_OS_API = 'test-api-key';
  const originalConsoleError = console.error;
  const { handler, restore } = loadFactoryScoreHandlerWithThrowingModel();
  console.error = () => {};

  try {
    const response = await invokeHandler(handler, {
      method: 'POST',
      body: {
        query: 'gift boxes',
        category: 'Packaging & Paper',
        country: 'China',
        riskTolerance: 'Any risk level',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.getHeader('x-orcatrade-generation-mode'), 'directory_network');
    assert.equal(response.body.queryMode, 'market_scan');
    assert.equal(response.body.resultMode, 'directory_only_market_scan');
    assert.equal(response.body.factories.length, 3);
    response.body.factories.forEach((factory) => {
      assert.match(factory.id, /^dir_/);
    });
  } finally {
    console.error = originalConsoleError;
    restore();
    delete process.env.ORCATRADE_OS_API;
  }
});

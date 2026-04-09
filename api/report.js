const { getStoredComplianceReportById } = require('../lib/intelligence/runtime-store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const reportId = String(req.query?.reportId || '').trim();
  if (!reportId) {
    return res.status(400).json({ error: 'reportId is required' });
  }

  try {
    const stored = await getStoredComplianceReportById(reportId);
    if (!stored || !stored.report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.setHeader('X-OrcaTrade-Storage-Mode', stored.storageMode || 'memory');
    return res.status(200).json(stored.report);
  } catch (error) {
    console.error('Report retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve report' });
  }
};

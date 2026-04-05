export const csdddRegulation = {
  name: "Corporate Sustainability Due Diligence Directive (CSDDD)",
  shortDescription: "Fosters sustainable and responsible corporate behavior throughout global value chains regarding human rights and environmental impacts.",
  coveredProducts: ["all sectors"],
  keyRequirements: [
    "Identify and address human rights and environmental impacts in the supply chain",
    "Must have due diligence policy",
    "Map value chain",
    "Implement prevention/remediation measures"
  ],
  applicableTo: "EU companies with 1000+ employees and €450M+ turnover (phased), and direct and indirect suppliers in the value chain",
  effectiveDate: "2027 (Phased implementation based on company size)",
  penaltiesText: "Financial penalties up to 5% of net worldwide turnover and 'naming and shaming' public measures.",
  checkRelevance: function(orderData) {
    const reasons = [];
    let relevant = false;

    if (!orderData) return { relevant, reasons };

    // Check if buyer meets thresholds
    if (orderData.buyerCompanySize >= 1000 && orderData.buyerRevenue >= 450000000) {
      reasons.push("Buyer company exceeds 1000 employees and €450M turnover thresholds.");
      relevant = true;
    }

    // Check if acting as supplier in value chain of CSDDD applicable company
    if (orderData.isSupplierInCsdddValueChain) {
      reasons.push("Supplier is part of a value chain governed by a CSDDD-applicable enterprise.");
      relevant = true;
    }

    return { relevant, reasons };
  }
};

export const cbamRegulation = {
  name: "Carbon Border Adjustment Mechanism (CBAM)",
  shortDescription: "Puts a fair price on the carbon emitted during the production of carbon intensive goods entering the EU.",
  coveredProducts: ["cement", "iron", "steel", "aluminium", "fertilisers", "electricity", "hydrogen"],
  keyRequirements: [
    "Importers must declare embedded carbon in imported goods",
    "Must purchase CBAM certificates to cover the carbon price",
    "Phase-in: reporting since Oct 2023, financial obligations from Jan 2026"
  ],
  applicableTo: "EU importers of covered goods from third countries",
  effectiveDate: "October 1, 2023 (Reporting phase) / January 1, 2026 (Financial obligations)",
  penaltiesText: "Penalties for failure to surrender CBAM certificates include fines between €10 to €50 per tonne of unreported emissions.",
  checkRelevance: function(orderData) {
    const reasons = [];
    let relevant = false;

    if (!orderData) return { relevant, reasons };

    // Example logic checking for EU import from non-EU origin
    if (orderData.importDestination === 'EU' && orderData.origin !== 'EU') {
      reasons.push("Goods are being imported into the EU from a third country.");
      
      const hasCoveredProduct = orderData.products && orderData.products.some(p => 
        this.coveredProducts.some(cp => p.toLowerCase().includes(cp))
      );

      if (hasCoveredProduct) {
        reasons.push("Order contains products covered by CBAM.");
        relevant = true;
      }
    }

    return { relevant, reasons };
  }
};

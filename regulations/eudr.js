export const eudrRegulation = {
  name: "EU Deforestation Regulation (EUDR)",
  shortDescription: "Ensures that products placed on the EU market do not contribute to global deforestation or forest degradation.",
  coveredProducts: ["cattle", "cocoa", "coffee", "palm oil", "soya", "wood", "rubber", "derived products"],
  keyRequirements: [
    "Suppliers must provide georeferenced data proving no deforestation after Dec 31 2020",
    "Due diligence statement required before placing products on the EU market"
  ],
  applicableTo: "All companies placing covered products on the EU market regardless of origin",
  effectiveDate: "December 30, 2024",
  penaltiesText: "Fines of up to 4% of the operator's EU-wide turnover, confiscation of revenues, and temporary exclusion from public procurement.",
  checkRelevance: function(orderData) {
    const reasons = [];
    let relevant = false;

    if (!orderData) return { relevant, reasons };

    // Example logic checking if order involves EU market and covered products
    if (orderData.destinationMarket === 'EU') {
      reasons.push("Product is being placed on the EU market.");
      
      const hasCoveredProduct = orderData.products && orderData.products.some(p => 
        this.coveredProducts.some(cp => p.toLowerCase().includes(cp))
      );

      if (hasCoveredProduct) {
        reasons.push("Order contains products covered by EUDR.");
        relevant = true;
      }
    }

    return { relevant, reasons };
  }
};

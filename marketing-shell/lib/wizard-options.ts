// Wizard dropdown options. Mirrors the existing /start wizard's
// product categories, origin countries and EU destinations.

export const PRODUCT_CATEGORIES = [
  { value: 'electronics', label: 'Electronics' },
  { value: 'apparel', label: 'Apparel & accessories' },
  { value: 'footwear', label: 'Footwear' },
  { value: 'cosmetics', label: 'Cosmetics & personal care' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'home-textiles', label: 'Home textiles' },
  { value: 'homeware', label: 'Homeware' },
  { value: 'machinery', label: 'Industrial machinery' },
  { value: 'toys', label: 'Toys & games' },
  { value: 'food', label: 'Food & beverage' },
  { value: 'other', label: 'Other — describe below' },
];

export const ORIGIN_COUNTRIES = [
  { value: 'CN', label: 'China' },
  { value: 'HK', label: 'Hong Kong' },
  { value: 'VN', label: 'Vietnam' },
  { value: 'IN', label: 'India' },
  { value: 'BD', label: 'Bangladesh' },
  { value: 'TR', label: 'Türkiye' },
  { value: 'KR', label: 'South Korea' },
  { value: 'JP', label: 'Japan' },
  { value: 'PK', label: 'Pakistan' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'TH', label: 'Thailand' },
  { value: 'MY', label: 'Malaysia' },
];

export const DESTINATIONS = [
  { value: 'DE', label: 'Germany' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'PL', label: 'Poland' },
  { value: 'FR', label: 'France' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'BE', label: 'Belgium' },
  { value: 'CZ', label: 'Czech Republic' },
  { value: 'AT', label: 'Austria' },
  { value: 'PT', label: 'Portugal' },
  { value: 'IE', label: 'Ireland' },
  { value: 'GB', label: 'United Kingdom' },
];

export const PREFERENTIAL_OPTIONS = [
  { value: 'yes-rex', label: 'Yes — REX statement available' },
  { value: 'yes-eur1', label: 'Yes — EUR.1 / movement certificate' },
  { value: 'yes-atr', label: 'Yes — A.TR movement document' },
  { value: 'no', label: 'No — full MFN rate' },
  { value: 'unsure', label: 'Not sure — please check for me' },
];

export const CURRENCIES = [
  { value: 'EUR', label: 'EUR · Euro' },
  { value: 'USD', label: 'USD · US dollar' },
  { value: 'GBP', label: 'GBP · British pound' },
  { value: 'CNY', label: 'CNY · Chinese yuan' },
  { value: 'TRY', label: 'TRY · Turkish lira' },
  { value: 'PLN', label: 'PLN · Polish złoty' },
];

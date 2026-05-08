// Agent locale directives — appended to each agent's system prompt to switch
// the reply language. The underlying tool calls and reasoning stay in English
// (regulation citations, HS codes, country codes are language-neutral); only
// the surface language of the answer changes.
//
// Used by lib/handlers/{orchestrator,agent,sourcing-agent,logistics-agent,finance-agent}.

const DIRECTIVES = {
  en: '',
  pl: `\n\nLOCALE OVERRIDE: Reply in Polish unless the user writes in another language. Use natural Polish business register (formal "Pan/Pani" only when clearly addressed; otherwise neutral B2B). Currency format: €179 100 (space thousands separator). Country codes (CN, VN, DE, PL) and regulation citations stay in their canonical Latin form.`,
  de: `\n\nLOCALE OVERRIDE: Reply in German (Sie-form, business register) unless the user writes in another language. Currency format: €179.100 (point thousands separator). Country codes (CN, VN, DE, PL) and regulation citations stay in their canonical Latin form.`,
};

function pickLocale(locale) {
  return DIRECTIVES[locale] !== undefined ? locale : 'en';
}

function applyLocaleDirective(systemPrompt, locale) {
  const lang = pickLocale(locale);
  return systemPrompt + DIRECTIVES[lang];
}

module.exports = {
  DIRECTIVES,
  pickLocale,
  applyLocaleDirective,
};

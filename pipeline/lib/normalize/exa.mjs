// monitorLabel format: "MA|DE", "CLEVEL|FR", "EXPAND|EU", etc.
const COUNTRY_MAP = {
  'DE': 'DE', 'DE7': 'DE', 'FR': 'FR', 'FR7': 'FR',
  'NL': 'NL', 'BE': 'BE', 'CH': 'CH',
  'EU': null,  // pan-European — no single country
};

export function normalize(item, monitorLabel, clientId) {
  const [signalType, countryCode] = monitorLabel.split('|');
  return {
    client_id: clientId,
    source: 'exa',
    source_type: 'news',
    external_id: item.id || item.url,   // Exa uses article URL as ID
    raw_data: { ...item, monitor_label: monitorLabel, signal_type: signalType },
    company_name: null,                  // extracted during enrichment stage
    source_url: item.url,
    pub_date: item.publishedDate ? item.publishedDate.substring(0, 10) : null,
    country: COUNTRY_MAP[countryCode] ?? null,
    status: 'pending',
  };
}

const COUNTRY_MAP = {
  'Germany': 'DE', 'Deutschland': 'DE', 'France': 'FR', 'Netherlands': 'NL',
  'Niederlande': 'NL', 'Belgium': 'BE', 'Belgien': 'BE',
  'Luxembourg': 'LU', 'Switzerland': 'CH', 'Schweiz': 'CH', 'Austria': 'AT',
};

function parseCountry(location) {
  if (!location) return null;
  for (const [name, code] of Object.entries(COUNTRY_MAP)) {
    if (location.includes(name)) return code;
  }
  return null;
}

export function normalize(item, clientId, countryFallback = null) {
  const url = item.url
    ? (item.url.startsWith('http') ? item.url : `https://www.stepstone.de${item.url}`)
    : null;

  return {
    client_id:    clientId,
    source:       'stepstone',
    source_type:  'hiring',
    external_id:  String(item.id),
    company_name: item.companyName || null,
    source_url:   url,
    pub_date:     item.datePosted ? item.datePosted.substring(0, 10) : null,
    country:      parseCountry(item.location) || countryFallback,
    status:       'pending',
    raw_data: {
      title:        item.title,
      companyName:  item.companyName,
      location:     item.location,
      datePosted:   item.datePosted,
      textSnippet:  item.textSnippet,
      salary:       item.salary,
      isAnonymous:  item.isAnonymous,
      companyUrl:   item.companyUrl,
    },
  };
}

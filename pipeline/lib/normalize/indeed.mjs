function parseCountryFromUrl(url) {
  if (!url) return null;
  const m = url.match(/^https?:\/\/(\w{2})\.indeed\.com/);
  return m ? m[1].toUpperCase() : null;
}

export function normalize(item, clientId, countryOverride = null) {
  // countryOverride: pass country from query config (DE/FR/NL/BE) since url-based
  // parsing only works for country-specific subdomains
  return {
    client_id:    clientId,
    source:       'indeed',
    source_type:  'hiring',
    external_id:  item.id,
    company_name: item.company || null,
    source_url:   item.url || null,
    pub_date:     item.postingDateParsed ? item.postingDateParsed.substring(0, 10) : null,
    country:      countryOverride || parseCountryFromUrl(item.url),
    status:       'pending',
    raw_data: {
      positionName:       item.positionName,
      company:            item.company,
      location:           item.location,
      postingDateParsed:  item.postingDateParsed,
      isExpired:          item.isExpired,
      salary:             item.salary,
    },
  };
}

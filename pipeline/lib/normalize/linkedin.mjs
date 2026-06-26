const COUNTRY_MAP = {
  'Germany': 'DE', 'France': 'FR', 'Netherlands': 'NL', 'Belgium': 'BE',
  'Luxembourg': 'LU', 'Switzerland': 'CH', 'Austria': 'AT',
  'Deutschland': 'DE', 'Frankreich': 'FR', 'Niederlande': 'NL', 'Belgien': 'BE',
  'Schweiz': 'CH', 'Österreich': 'AT',
};

function parseCountry(location) {
  if (!location) return null;
  const parts = location.split(',').map(s => s.trim());
  return COUNTRY_MAP[parts[parts.length - 1]] || null;
}

function parseCountryFromUrl(url) {
  if (!url) return null;
  const m = url.match(/^https?:\/\/(\w{2})\.linkedin\.com/);
  const code = m?.[1]?.toUpperCase();
  return ['DE','FR','NL','BE','LU','CH','AT'].includes(code) ? code : null;
}

export function normalize(item, clientId) {
  const country = item.companyAddress?.addressCountry
    || parseCountry(item.location)
    || parseCountryFromUrl(item.link);

  return {
    client_id:    clientId,
    source:       'linkedin',
    source_type:  'hiring',
    external_id:  String(item.id),
    company_name: item.companyName || null,
    source_url:   item.link || null,
    pub_date:     item.postedAt ? item.postedAt.substring(0, 10) : null,
    country:      country || null,
    status:       'pending',
    raw_data: {
      title:                 item.title,
      industries:            item.industries,
      companyLinkedinUrl:    item.companyLinkedinUrl,
      companyWebsite:        item.companyWebsite,
      companyEmployeesCount: item.companyEmployeesCount,
      companyDescription:    item.companyDescription,
      location:              item.location,
      applicantsCount:       item.applicantsCount,
      seniorityLevel:        item.seniorityLevel,
      postedAt:              item.postedAt,
      descriptionText:       item.descriptionText,
    },
  };
}

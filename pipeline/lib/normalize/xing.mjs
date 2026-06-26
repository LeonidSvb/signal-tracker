export function normalize(item, clientId) {
  return {
    client_id:    clientId,
    source:       'xing',
    source_type:  'hiring',
    external_id:  String(item.job_id),
    company_name: item.company || null,
    source_url:   item.url || item.apply_url || null,
    pub_date:     item.date_posted ? item.date_posted.substring(0, 10) : null,
    country:      item.location_country_code || null,
    status:       'pending',
    raw_data: {
      title:                  item.title,
      company:                item.company,
      company_industry:       item.company_industry,
      company_size:           item.company_size,
      company_public_profile: item.company_public_profile,
      location:               item.location,
      location_country_code:  item.location_country_code,
      date_posted:            item.date_posted,
      active_until:           item.active_until,
      salary:                 item.salary,
    },
  };
}

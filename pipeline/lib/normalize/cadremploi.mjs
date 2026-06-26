export function normalize(item, clientId) {
  // postedDate is null in ~95% of listings — use firstSeenAt as fallback
  const pubDate = item.postedDate || item.firstSeenAt || null;

  return {
    client_id:    clientId,
    source:       'cadremploi',
    source_type:  'hiring',
    external_id:  item.jobId,
    company_name: item.company || null,
    source_url:   item.canonicalUrl || item.portalUrl || null,
    pub_date:     pubDate ? pubDate.substring(0, 10) : null,
    country:      'FR',
    status:       'pending',
    raw_data: {
      title:       item.title,
      company:     item.company,
      location:    item.location,
      postedDate:  item.postedDate,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt:  item.lastSeenAt,
      expiredAt:   item.expiredAt,
      isRepost:    item.isRepost,
      // NOTE: company field = recruiter/headhunter, actual employer is in description
    },
  };
}

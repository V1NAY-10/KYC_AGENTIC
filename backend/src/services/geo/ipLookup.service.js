import axios from 'axios';

/**
 * Lookup geolocation data for an IP address using ip-api.com (free, no key needed).
 * Free tier: 1,500 requests per hour.
 */
export async function lookupIP(ip) {
  // Skip lookup for local/private IPs
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return {
      ip,
      city: 'Local', state: 'Local', country: 'Local',
      isp: 'Local', org: 'Local',
      isVPN: false, isProxy: false, isTor: false,
      lat: 0, lon: 0,
      status: 'local',
    };
  }

  try {
    const { data } = await axios.get(
      `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,isp,org,as,proxy,hosting`,
      { timeout: 3000 }
    );

    if (data.status !== 'success') {
      return { ip, status: 'failed', error: data.message };
    }

    return {
      ip,
      city:    data.city,
      state:   data.regionName,
      country: data.country,
      isp:     data.isp,
      org:     data.org,
      isVPN:   data.hosting || false,   // hosting flag often indicates VPN/datacenter
      isProxy: data.proxy || false,
      isTor:   false, // ip-api free doesn't detect Tor; can add MaxMind later
      lat:     data.lat,
      lon:     data.lon,
      status:  'success',
    };
  } catch (err) {
    console.error('[GeoIP] Lookup failed:', err.message);
    return { ip, status: 'error', error: err.message };
  }
}

/**
 * Calculate rough distance between two city/state combinations.
 * Returns a risk level based on mismatch.
 */
export function assessGeoRisk(geoData, statedCity, statedState) {
  if (!geoData || geoData.status !== 'success') return { riskLevel: 'unknown', reason: 'Geo lookup failed' };
  if (geoData.status === 'local') return { riskLevel: 'low', reason: 'Local development environment' };

  const flags = [];
  let score = 0;

  // VPN / Proxy flags
  if (geoData.isVPN) { flags.push({ type: 'VPN_DETECTED', description: 'User appears to be using a VPN or hosting provider', severity: 'medium' }); score += 35; }
  if (geoData.isProxy) { flags.push({ type: 'PROXY_DETECTED', description: 'Proxy server detected', severity: 'high' }); score += 50; }

  // City mismatch
  if (statedCity && geoData.city) {
    const ipCity    = geoData.city.toLowerCase().trim();
    const claimed   = statedCity.toLowerCase().trim();
    if (!ipCity.includes(claimed) && !claimed.includes(ipCity)) {
      flags.push({ type: 'CITY_MISMATCH', description: `IP location: ${geoData.city}. Stated city: ${statedCity}`, severity: 'medium' });
      score += 20;
    }
  }

  // State mismatch
  if (statedState && geoData.state) {
    const ipState  = geoData.state.toLowerCase().trim();
    const claimed  = statedState.toLowerCase().trim();
    if (!ipState.includes(claimed) && !claimed.includes(ipState)) {
      flags.push({ type: 'STATE_MISMATCH', description: `IP state: ${geoData.state}. Stated state: ${statedState}`, severity: 'medium' });
      score += 15;
    }
  }

  const riskLevel = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';
  return { riskLevel, score, flags };
}

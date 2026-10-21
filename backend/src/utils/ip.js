/**
 * True for loopback / private / link-local addresses — these have no public
 * geolocation (localhost dev, LAN, or a misconfigured proxy).
 */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const addr = String(ip).trim().toLowerCase().replace(/^::ffff:/, ''); // IPv4-mapped IPv6

  if (addr === '::1' || addr === 'localhost') return true;
  if (/^(fc|fd|fe80)/.test(addr)) return true; // IPv6 unique-local / link-local

  const m = addr.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254);
}

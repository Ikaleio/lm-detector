/** Local API targets must be reached from the user's browser rather than a cloud relay. */
export function isLocalApiUrl(url: URL): boolean {
  const hostname = url.hostname.replace(/\.$/, '')
  if (hostname.startsWith('[')) {
    const address = hostname.slice(1, -1)
    // URL normalizes IPv4-mapped IPv6 addresses to hexadecimal groups.
    if (address.startsWith('::ffff:')) {
      const groups = address.slice(7).split(':')
      if (groups.length !== 2) return false
      const high = Number.parseInt(groups[0], 16), low = Number.parseInt(groups[1], 16)
      return isLocalIpv4([high >> 8, high & 255, low >> 8, low & 255])
    }
    return address === '::1' || /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(address)
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return isLocalIpv4(hostname.split('.').map(Number))
  return !hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)$/.test(hostname)
}

function isLocalIpv4([a, b]: number[]): boolean {
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254)
}

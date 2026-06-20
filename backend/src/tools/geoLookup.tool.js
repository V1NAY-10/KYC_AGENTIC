import { lookupIP, assessGeoRisk } from '../services/geo/ipLookup.service.js';

/**
 * Geo Lookup Tool — wrapper around the existing ipLookup.service.js
 *
 * Exposes geo lookup as a registered tool so agents can invoke it
 * through the ToolRegistry (which handles logging automatically).
 */
export const geoLookupTool = {
  name: 'geo_lookup',
  description: 'Looks up geolocation for an IP address and assesses geo risk vs. stated location.',
  parameters: {
    ip:          { type: 'string', description: 'IP address to look up' },
    statedCity:  { type: 'string', description: 'City stated by the user during interview' },
    statedState: { type: 'string', description: 'State stated by the user during interview' },
  },

  execute: async ({ ip, statedCity, statedState }) => {
    const geoData       = await lookupIP(ip);
    const riskAssessment = assessGeoRisk(geoData, statedCity, statedState);
    return { geoData, riskAssessment };
  },
};

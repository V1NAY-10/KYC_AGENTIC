import { lookupIP } from '../services/geo/ipLookup.service.js';
import GeoLog from '../models/GeoLog.model.js';

export const geoCaptureMiddleware = async (req, res, next) => {
  // Try to get real IP if behind a proxy like Render/Vercel
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  req.clientIp = ip;

  try {
    // Lookup IP asynchronously so it doesn't block the request response
    lookupIP(ip).then(geoData => {
      req.geoData = geoData;
      
      // If user is authenticated (via Clerk requireAuth), save to GeoLog
      const auth = req.auth; // from @clerk/express
      if (auth && auth.userId) {
        GeoLog.create({
          userId: null, // We'll need to map clerkId to our User _id later if needed
          clerkId: auth.userId,
          ip: geoData.ip,
          city: geoData.city,
          state: geoData.state,
          country: geoData.country,
          isp: geoData.isp,
          org: geoData.org,
          isVPN: geoData.isVPN,
          isProxy: geoData.isProxy,
        }).catch(err => console.error('[GeoLog] Error saving geo log:', err.message));
      }
    });
  } catch (err) {
    console.error('[GeoCapture] Error:', err.message);
  }

  next();
};

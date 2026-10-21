import { clerkClient } from '@clerk/express';
import User from '../models/User.model.js';

// Records created before the Clerk webhook synced them carry these stand-ins
const isPlaceholder = (user) => !user?.email || /@(local\.dev|temp\.com)$/i.test(user.email);

async function fetchClerkProfile(clerkId) {
  try {
    const u = await clerkClient.users.getUser(clerkId);
    const primary = u.emailAddresses?.find(e => e.id === u.primaryEmailAddressId) || u.emailAddresses?.[0];
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || null;
    return { email: primary?.emailAddress?.toLowerCase() || null, name };
  } catch (err) {
    console.warn(`[userSync] Clerk lookup failed for ${clerkId}:`, err.message);
    return null;
  }
}

/**
 * Find the local user for a Clerk id, creating it if needed, and replace
 * placeholder name/email with the real Clerk profile when available.
 */
export async function findOrCreateUser(clerkId, defaults = {}) {
  let user = await User.findOne({ clerkId });
  if (user && !isPlaceholder(user)) return user;

  const profile = await fetchClerkProfile(clerkId);

  if (!user) {
    return User.create({
      clerkId,
      email: profile?.email || `${clerkId}@local.dev`,
      name:  profile?.name  || defaults.name || 'Applicant',
      ...(defaults.role ? { role: defaults.role } : {}),
    });
  }

  if (profile?.email) {
    user.email = profile.email;
    if (profile.name) user.name = profile.name;
    try {
      await user.save();
    } catch (err) {
      console.warn(`[userSync] Could not update profile for ${clerkId}:`, err.message); // e.g. email already used by another record
    }
  }
  return user;
}

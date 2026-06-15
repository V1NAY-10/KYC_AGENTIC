import { Webhook } from 'svix';
import User from '../models/User.model.js';

export const clerkWebhookHandler = async (req, res) => {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    console.error('Missing CLERK_WEBHOOK_SECRET in environment variables');
    return res.status(500).json({ error: 'Missing Webhook Secret' });
  }

  // Get the headers
  const svix_id = req.headers['svix-id'];
  const svix_timestamp = req.headers['svix-timestamp'];
  const svix_signature = req.headers['svix-signature'];

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return res.status(400).json({ error: 'Error occured -- no svix headers' });
  }

  // Get the body (req.body must be raw string/buffer, which is handled in server.js)
  const payload = req.body.toString('utf8');
  const headers = {
    'svix-id': svix_id,
    'svix-timestamp': svix_timestamp,
    'svix-signature': svix_signature,
  };

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt;

  // Verify the payload with the headers
  try {
    evt = wh.verify(payload, headers);
  } catch (err) {
    console.error('Error verifying webhook:', err.message);
    return res.status(400).json({ error: 'Error verifying webhook' });
  }

  // Handle the event
  const { id } = evt.data;
  const eventType = evt.type;

  console.log(`Webhook received: ${eventType} for Clerk User ID: ${id}`);

  if (eventType === 'user.created') {
    try {
      const email = evt.data.email_addresses?.[0]?.email_address || '';
      const firstName = evt.data.first_name || '';
      const lastName = evt.data.last_name || '';
      const name = `${firstName} ${lastName}`.trim() || 'New User';

      const newUser = await User.create({
        clerkId: id,
        email: email,
        name: name,
      });

      console.log('✅ User synced to MongoDB:', newUser._id);
    } catch (err) {
      console.error('❌ Error saving user to MongoDB:', err);
      // We don't throw 500 here to let Clerk know we received it, 
      // but maybe we should depending on reliability needs.
    }
  }

  if (eventType === 'user.updated') {
    // Handle updates if needed
  }

  if (eventType === 'user.deleted') {
    try {
      await User.findOneAndDelete({ clerkId: id });
      console.log('🗑️ User deleted from MongoDB:', id);
    } catch (err) {
      console.error('❌ Error deleting user from MongoDB:', err);
    }
  }

  return res.status(200).json({ success: true });
};

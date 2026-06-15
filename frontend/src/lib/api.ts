import axios from 'axios';

// Get API URL from env, fallback to localhost for local dev if missing
const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// We will add Clerk auth interceptor later if needed,
// but for now, we just pass requests directly to our backend.
// With @clerk/nextjs, we can also use useAuth().getToken() in components.

export default api;

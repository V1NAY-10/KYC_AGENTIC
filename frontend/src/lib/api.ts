import axios from 'axios';

// NEXT_PUBLIC_API_URL   → e.g. https://kyc-backend.onrender.com/api  (production)
//                         or   http://localhost:8000/api              (dev)
const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL,
  withCredentials: true,          // send Clerk auth cookies cross-origin
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;

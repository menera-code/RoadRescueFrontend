import axios from "axios"

// ✅ Read the backend URL from environment variable
// On Render: uses VITE_API_URL (your ngrok URL)
// On Local: falls back to localhost:8000
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE_URL,   // Now this will be your ngrok URL on Render!
  headers: { 
    "Content-Type": "application/json" 
  }
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem("access_token")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default api
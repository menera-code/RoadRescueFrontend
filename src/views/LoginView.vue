<script setup>
import { ref } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import calapanLogo from "@/assets/logos/calapan.png"
import axios from "axios"
import { jwtDecode } from "jwt-decode"
import api from "@/api/client"

const router = useRouter()

const email = ref("")
const password = ref("")
const error = ref("")
const loading = ref(false)
const showPassword = ref(false)

const togglePassword = () => {
  showPassword.value = !showPassword.value
}

const submit = async () => {
  error.value = ""
  loading.value = true

  try {
    const res = await api.post("/auth/login", {
      email: email.value,
      password: password.value,
    })

    const token = res.data.access_token
    localStorage.setItem("access_token", token)

    const decoded = jwtDecode(token)
    const role = decoded.role

    if (role === "admin") {
      router.push("/dashboard/admin")
    } else if (role === "responder") {
      router.push("/dashboard/responder")
    } else {
      router.push("/dashboard/user")
    }
  } catch (err) {
    error.value = "Invalid email or password"
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="seal-wrap">
            <img class="seal" :src="calapanLogo" alt="City Government of Calapan Seal" />
          </div>
          <div class="brand-text">
            <div class="brand-title">City Government of Calapan</div>
            <div class="brand-subtitle">Oriental Mindoro</div>
          </div>
        </div>

        <div class="top-actions">
          <button class="btn btn-outline btn-sm" @click="router.push('/')">Back</button>
        </div>
      </div>
    </header>

    <main class="main">
      <div class="card">
        <h1 class="h2">Login</h1>
        <p class="p">Sign in to access RESQAPP services.</p>

        <div v-if="error" class="alert alert-error">{{ error }}</div>

        <div class="form">
          <div class="form-group">
            <label class="label">Email</label>
            <input class="input" v-model="email" autocomplete="email" placeholder="you@example.com" />
          </div>

          <div class="form-group">
            <label class="label">Password</label>
            <div class="password-wrapper">
              <input
                class="input"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="••••••••"
              />
              <button type="button" class="toggle-password" @click="togglePassword" tabindex="-1">
                <span v-if="showPassword">🙈</span>
                <span v-else>👁️</span>
              </button>
            </div>
          </div>

          <button class="btn btn-primary" :disabled="loading" @click="submit">
            {{ loading ? "Signing in..." : "Login" }}
          </button>

          <p class="muted">
            No account? <router-link to="/register">Register</router-link>
          </p>
        </div>
      </div>
    </main>

    <footer class="footer">
      <div class="footer-inner">
        <span>© {{ new Date().getFullYear() }} RESQAPP • Calapan City, Oriental Mindoro</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ===== RESET & GLOBAL ===== */
:root {
  --topbar-height: 70px;
}
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.page {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #f5f7fa 0%, #e9ecf2 100%);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: #1e293b;
  line-height: 1.5;
  overflow: visible;
  height: auto;
}

/* ===== TYPOGRAPHY ===== */
.h2 {
  font-size: 1.75rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.p {
  font-size: 1rem;
  color: #475569;
  margin-bottom: 1.5rem;
}

.muted {
  color: #64748b;
  font-size: 0.9rem;
}

/* ===== BUTTONS ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s;
  cursor: pointer;
  border: none;
  outline: none;
  gap: 0.5rem;
}

.btn-primary {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #163a5c, #1e4b7a);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px -1px rgba(0, 0, 0, 0.15);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-outline {
  background: transparent;
  border: 2px solid #2a5298;
  color: #2a5298;
}

.btn-outline:hover {
  background: #2a5298;
  color: white;
}

.btn-sm {
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
}

/* ===== HEADER / TOPBAR ===== */
.topbar {
  background: white;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  position: sticky;
  top: 0;
  z-index: 40;
}

.topbar-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0.75rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 0.5rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1 1 auto;
}

.seal-wrap {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  flex-shrink: 0;
}

.seal {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-title {
  font-weight: 700;
  font-size: 1.25rem;
  background: linear-gradient(135deg, #1e3c72, #f97316);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-subtitle {
  font-size: 0.75rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* ===== MAIN LAYOUT ===== */
.main {
  flex: 1;
  max-width: 1400px;
  width: 100%;
  margin: 2rem auto;
  padding: 0 2rem;
}

.card {
  max-width: 520px;
  margin: 0 auto;
  background: white;
  border-radius: 1.5rem;
  padding: 2rem;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.03);
}

/* ===== FORM ===== */
.form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #334155;
}

.input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  font-size: 1rem;
  transition: all 0.2s;
  background: white;
}

.input:focus {
  outline: none;
  border-color: #2a5298;
  box-shadow: 0 0 0 3px rgba(42, 82, 152, 0.1);
}

.password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-wrapper .input {
  flex: 1;
  padding-right: 2.8rem; /* space for toggle button */
}

.toggle-password {
  position: absolute;
  right: 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
  color: #64748b;
  padding: 0.25rem;
  transition: color 0.2s;
}

.toggle-password:hover {
  color: #1e293b;
}

.alert {
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
  font-size: 0.9rem;
  border: 1px solid transparent;
}

.alert-error {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
}

/* ===== FOOTER ===== */
.footer {
  background: white;
  border-top: 1px solid #e9eef2;
  margin-top: auto;
}

.footer-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.5rem 2rem;
  text-align: center;
  color: #64748b;
  font-size: 0.9rem;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 767px) {
  .topbar-inner {
    padding: 0.5rem 1rem;
  }
  .seal-wrap {
    width: 40px;
    height: 40px;
  }
  .brand-title {
    font-size: 1rem;
  }
  .brand-subtitle {
    font-size: 0.65rem;
  }
  .btn-sm {
    padding: 0.2rem 0.5rem;
    font-size: 0.7rem;
  }
}

@media (max-width: 480px) {
  .brand-title {
    max-width: 140px;
  }
}
</style>
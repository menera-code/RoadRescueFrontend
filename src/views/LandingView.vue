<script setup>
import { useRouter } from "vue-router"
import calapanLogo from "@/assets/logos/calapan.png"
// import tmoLogo from "@/assets/logos/tmo.png" (if needed)

const router = useRouter()
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
          <button class="btn btn-outline btn-sm" @click="router.push('/login')">Login</button>
          <button class="btn btn-primary btn-sm" @click="router.push('/register')">Register</button>
        </div>
      </div>
    </header>

    <main class="main">
      <section class="hero">
        <div class="card hero-card">
          <div class="landing-badge">Official-style Public Safety Interface</div>

          <h1 class="app-title">Road Rescue</h1>
          <p class="app-tagline">Emergency Incident Reporting System</p>

          <p class="app-desc">
            Report incidents quickly, share accurate details, and support faster response coordination
            within Calapan City.
          </p>

          <div class="cta">
            <button class="btn btn-outline" @click="router.push('/login')">Login</button>
            <button class="btn btn-primary" @click="router.push('/register')">Register</button>
          </div>

          <div class="quick">
            <div class="quick-item">
              <div class="quick-label">Designed for</div>
              <div class="quick-value">Citizens • Responders • Admin</div>
            </div>
            <div class="quick-item">
              <div class="quick-label">Coverage</div>
              <div class="quick-value">Calapan City</div>
            </div>
            <div class="quick-item">
              <div class="quick-label">Platform</div>
              <div class="quick-value">PWA (Mobile-ready)</div>
            </div>
          </div>

          <div class="notice">
            <div class="notice-title">Reminder</div>
            <div class="notice-text">
              False or misleading reports may be subject to investigation. Please provide accurate information.
            </div>
          </div>
        </div>

        <aside class="panel">
          <h3 class="panel-title">Emergency Tips</h3>
          <ul class="panel-list">
            
            <li>Allow location access for faster response.</li>
            <li>Do not share false reports (traceable).</li>
          </ul>

          <div class="panel-divider"></div>

          <h3 class="panel-title">Hotlines</h3>
          <div class="hotlines">
            
            <div class="hotline">
              <span class="hotline-label">Calapan City Police Station (PNP):</span>
              <span class="hotline-value">0998-598-5813</span>
            </div>
             <div class="hotline">
              <span class="hotline-label">Calapan City Fire Station (BFP):</span>
              <span class="hotline-value">0915-603-1561</span>
            </div>
            <div class="hotline">
              <span class="hotline-label">CDRRMD Rescue Calapan:</span>
              <span class="hotline-value">0999-735-6447</span>
            </div>
            <div class="hotline">
              <span class="hotline-label">City Health and Sanitation:</span>
              <span class="hotline-value">0908-366-1556</span>
            </div>
            <div class="hotline">
              <span class="hotline-label">Tamaraw Fire Volunteer:</span>
              <span class="hotline-value">0917-534-2419</span>
            </div>
          </div>

          <div class="panel-divider"></div>

          <p class="panel-note">
            Data is processed in accordance with the Data Privacy Act of 2012 (RA 10173).
          </p>
        </aside>
      </section>
    </main>

    <footer class="footer">
      <div class="footer-inner">
        <span>© {{ new Date().getFullYear() }} Road Rescue • Calapan City, Oriental Mindoro</span>
        <span class="footer-right">Capstone Project • PWA-ready</span>
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

/* ===== BUTTONS ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-weight: 500;
  font-size: 1rem;
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
  font-size: 1rem;
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #163a5c, #1e4b7a);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px -1px rgba(0, 0, 0, 0.15);
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
  flex-wrap: nowrap;        /* prevent wrapping on mobile */
  gap: 0.5rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;             /* allow text to shrink */
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
  min-width: 0;             /* allow text truncation */
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
  flex-shrink: 0;           /* prevent buttons from shrinking */
}

/* ===== MAIN LAYOUT ===== */
.main {
  flex: 1;
  max-width: 1400px;
  width: 100%;
  margin: 2rem auto;
  padding: 0 2rem;
}

.hero {
  display: grid;
  grid-template-columns: 1.7fr 1fr;
  gap: 1.5rem;
  align-items: start;
}

.card {
  background: white;
  border-radius: 1.5rem;
  padding: 2rem;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.03);
}

/* ===== LANDING SPECIFIC STYLES ===== */
.landing-badge {
  display: inline-block;
  font-size: 0.75rem;
  background: #e9f1ff;
  color: #1e3c72;
  border: 1px solid #cfe0ff;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  margin-bottom: 1rem;
  font-weight: 600;
}

.app-title {
  margin: 0;
  font-size: clamp(2rem, 6vw, 2.75rem);
  color: #1e3c72;
  letter-spacing: 0.6px;
  line-height: 1.2;
}

.app-tagline {
  margin: 0.25rem 0 1rem;
  font-weight: 700;
  color: #2a5298;
}

.app-desc {
  margin: 0 0 1.5rem;
  color: #475569;
  line-height: 1.6;
}

.cta {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

.quick {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.quick-item {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 0.75rem;
}

.quick-label {
  font-size: 0.7rem;
  color: #1e3c72;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.quick-value {
  font-size: 0.85rem;
  color: #334155;
  margin-top: 0.2rem;
  font-weight: 500;
}

.notice {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 1rem;
  padding: 1rem;
}

.notice-title {
  font-weight: 800;
  color: #9a3412;
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
}

.notice-text {
  color: #7b341e;
  font-size: 0.85rem;
  line-height: 1.5;
}

.panel {
  background: white;
  border-radius: 1.5rem;
  padding: 1.5rem;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.03);
  border: 1px solid #e9eef2;
  position: sticky;
  top: 6rem;
}

.panel-title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  color: #1e3c72;
  font-weight: 700;
}

.panel-list {
  margin: 0;
  padding-left: 1.25rem;
  color: #475569;
  line-height: 1.6;
  font-size: 0.9rem;
}

.panel-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 1.25rem 0;
}

.panel-note {
  margin: 0;
  color: #64748b;
  font-size: 0.8rem;
  line-height: 1.5;
}

.hotlines {
  display: grid;
  gap: 0.5rem;
}

.hotline {
  display: flex;
  justify-content: space-between;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  padding: 0.5rem 1rem;
  border-radius: 0.75rem;
  font-size: 0.9rem;
}

.hotline-label {
  font-weight: 700;
  color: #9a3412;
}

.hotline-value {
  font-weight: 800;
  color: #1e3c72;
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #64748b;
  font-size: 0.9rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.footer-right {
  white-space: nowrap;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }
  .quick {
    grid-template-columns: 1fr;
  }
  .panel {
    position: static;
  }
  .footer-inner {
    flex-direction: column;
    align-items: flex-start;
  }
}

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
  .top-actions {
    gap: 0.25rem;
  }
}

@media (max-width: 480px) {
  .brand-title {
    max-width: 140px;       /* prevent overflow on very small screens */
  }
}
</style>
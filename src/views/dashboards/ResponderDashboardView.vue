<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch, onMounted } from "vue"
import { useRouter } from "vue-router"
import calapanLogo from "@/assets/logos/calapan.png"
import L from "leaflet"
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import axios from "axios"

const router = useRouter()
const active = ref("assignments")

const logout = async () => {
  try {
    await api.post("/auth/logout");
  } catch (error) {
    console.error("Logout API error:", error);
  } finally {
    localStorage.removeItem("access_token");
    localStorage.removeItem("admin_token");
    router.push("/");
  }
  stopLocationTracking()               // <-- stop tracking on logout
  localStorage.removeItem("access_token")
  router.push("/")
}

const role = "Responder"
const roleClass = computed(() => "role-responder")
const otherRespondersLocations = ref([])       // array of { id, name, lat, lng, last_update, accuracy }
let otherResponderMarkers = []     

// ================= API SETUP =================
const token = localStorage.getItem("access_token")
import api from "@/api/client"

// ================= ASSIGNMENTS (INCIDENTS ASSIGNED TO ME) =================
const assignedIncidents = ref([])
const assignmentsLoading = ref(false)
const assignmentsFilter = ref("all")
const currentResponderId = ref(null)

const getUserIdFromToken = () => {
  const token = localStorage.getItem("access_token")
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return Number(payload.sub)
  } catch (e) {
    console.error("Failed to parse token:", e)
    return null
  }
}
const loadAssignedIncidents = async () => {
  assignmentsLoading.value = true
  try {
    // Get responder ID from token instead of API call
    if (!currentResponderId.value || isNaN(currentResponderId.value)) {
      const id = getUserIdFromToken()
      if (!id || isNaN(id)) {
        throw new Error("Invalid responder ID from token")
      }
      currentResponderId.value = id
    }

    const params = { assigned_to: currentResponderId.value }
    const response = await api.get("/admin/incidents", { params })
    
    // Safety filter on frontend
    assignedIncidents.value = response.data.filter(inc => {
      return Number(inc.assigned_to) === currentResponderId.value && inc.status !== "resolved"
    })
  } catch (error) {
    console.error("Failed to load assigned incidents:", error)
    assignedIncidents.value = []
    showNotification("Could not load your assignments", "error")
  } finally {
    assignmentsLoading.value = false
  }
}
const updateOtherResponderMarkers = () => {
  if (!map) return
  // Clear old markers
  otherResponderMarkers.forEach(marker => map.removeLayer(marker))
  otherResponderMarkers = []
  
  otherRespondersLocations.value.forEach(resp => {
    const icon = L.divIcon({
      className: 'other-responder-marker',
      html: `<div style="background-color: #3b82f6; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 2px #3b82f6; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white;">🚑</div>`,
      iconSize: [24, 24],
      popupAnchor: [0, -12],
    })
    const marker = L.marker([resp.lat, resp.lng], { icon })
      .addTo(map)
      .bindPopup(`
        <b>${resp.name}</b><br>
        Last update: ${new Date(resp.last_update).toLocaleTimeString()}<br>
        Accuracy: ${Math.round(resp.accuracy)}m
      `)
    otherResponderMarkers.push(marker)
  })
}
const loadOtherResponderLocations = async () => {
  try {
    const response = await api.get("/admin/responder-locations")
    // Filter out the current responder (optional, but you may still show them)
    otherRespondersLocations.value = response.data.filter(r => r.id !== currentResponderId.value)
    updateOtherResponderMarkers()
  } catch (error) {
    console.error("Failed to load other responder locations:", error)
  }
}

const updateIncidentStatus = async (incidentId, newStatus) => {
  try {
    await api.put(`/admin/incidents/${incidentId}/status?status=${newStatus}`)
    showNotification(`Status updated to ${newStatus}`, "success")
    await loadAssignedIncidents()
    if (newStatus === "resolved") {
      await loadHistory()
      // If the history tab is currently active, refresh its view
      if (active.value === "history") await loadHistory()
    }
  } catch (error) {
    console.error("Failed to update status:", error)
    showNotification("Failed to update status", "error")
  }
}

const severityColors = {
  low: "#10b981",
  medium: "#3b82f6",
  high: "#f59e0b",
  critical: "#dc2626"
}

const statusColors = {
  pending: "#f59e0b",
  "in-progress": "#3b82f6",
  resolved: "#10b981"
}

const showNotification = (message, type = "info") => {
  const notification = document.createElement("div")
  notification.className = `admin-notification ${type}`
  notification.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()">×</button>`
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px;
    background: ${type === "success" ? "#10b981" : type === "error" ? "#dc2626" : "#0b4fa3"};
    color: white; padding: 12px 16px; border-radius: 8px;
    z-index: 9999; display: flex; align-items: center; gap: 10px;
    animation: slideIn 0.3s ease;
  `
  document.body.appendChild(notification)
  setTimeout(() => notification.remove(), 3000)
}

// ================= LOCATION TRACKING (every 3 minutes) =================
const currentLocation = ref(null)
const locationError = ref(null)
let locationInterval = null

const updateLocation = () => {
  if (!navigator.geolocation) {
    locationError.value = "Geolocation not supported."
    return
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentLocation.value = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      }
      locationError.value = null
      console.log("Location updated:", currentLocation.value)
      
      // 👇 ADD THIS LINE
      sendLocationToBackend(currentLocation.value)
      
      if (active.value === "map" && map && currentLocation.value) {
        updateResponderMarker()
      }
    },
    (err) => {
      console.error("Geolocation error:", err)
      locationError.value = `Location error: ${err.message}`
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  )
}

let watchId = null

const startLocationTracking = () => {
  if (!navigator.geolocation) return
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      currentLocation.value = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      }
      sendLocationToBackend(currentLocation.value)
      if (active.value === "map" && map) updateResponderMarker()
    },
    (err) => { locationError.value = err.message },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  )
}

const stopLocationTracking = () => {
  if (watchId) navigator.geolocation.clearWatch(watchId)
}

// ================= ACTIVE ALERTS =================
const activeAlerts = ref([])
const loadingAlerts = ref(false)
const showAlertMapModal = ref(false)
const alertMapGeometry = ref(null)
const showImageModal = ref(false)
const modalImageUrl = ref('')
let alertMapInstance = null

const fetchActiveAlerts = async () => {
  loadingAlerts.value = true
  try {
    const response = await api.get('/api/alerts/active')
    activeAlerts.value = response.data
  } catch (error) {
    console.error('Failed to fetch active alerts:', error)
  } finally {
    loadingAlerts.value = false
  }
}

const formatAlertTime = (isoString) => {
  const date = new Date(isoString)
  const now = new Date()
  const diffMins = Math.floor((now - date) / 60000)
  if (diffMins < 60) return `${diffMins} min ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  return date.toLocaleDateString()
}

const openAlertMap = (geometry) => {
  alertMapGeometry.value = geometry
  showAlertMapModal.value = true
  nextTick(() => initAlertMap())
}

const openImageModal = (url) => {
  modalImageUrl.value = url
  showImageModal.value = true
}

const initAlertMap = () => {
  const el = document.getElementById('alert-map')
  if (!el) return
  if (alertMapInstance) alertMapInstance.remove()
  let center = [13.411, 121.181]
  if (alertMapGeometry.value) {
    const coords = alertMapGeometry.value.geometry.coordinates
    if (alertMapGeometry.value.geometry.type === 'LineString' && coords.length > 0)
      center = [coords[0][1], coords[0][0]]
    else if (alertMapGeometry.value.geometry.type === 'Point')
      center = [coords[1], coords[0]]
  }
  alertMapInstance = L.map(el).setView(center, 13)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(alertMapInstance)
  if (alertMapGeometry.value) {
    L.geoJSON(alertMapGeometry.value, {
      style: { color: '#dc2626', weight: 6, opacity: 0.8 }
    }).addTo(alertMapInstance).bindPopup('Affected area')
  }
}

// ================= CHAT FUNCTIONALITY =================
const chatMessages = ref([])
const newMessage = ref("")
const chatLoading = ref(false)
const chatUsers = ref([])
const selectedChat = ref(null)
const userSearch = ref("")
const currentUserId = "responder1"

const filteredUsers = computed(() => {
  if (!userSearch.value) return chatUsers.value;
  const search = userSearch.value.toLowerCase();
  return chatUsers.value.filter(user => 
    user.name.toLowerCase().includes(search) || user.role.toLowerCase().includes(search)
  );
});

const mockChats = {
  user1: [
    { id: 1, sender_id: "user1", sender_name: "Juan Dela Cruz", message: "Hello, there's an accident on Main Street", timestamp: "10:30 AM", created_at: "2024-01-19 10:30:00" },
    { id: 2, sender_id: "responder1", sender_name: "Officer Reyes", message: "Understood. What's the exact location?", timestamp: "10:32 AM", created_at: "2024-01-19 10:32:00" }
  ],
  user2: [
    { id: 1, sender_id: "user2", sender_name: "Maria Santos", message: "Medical emergency at Barangay Hall", timestamp: "09:15 AM", created_at: "2024-01-19 09:15:00" },
    { id: 2, sender_id: "responder1", sender_name: "Officer Reyes", message: "Medical team is dispatched. ETA 5 minutes", timestamp: "09:16 AM", created_at: "2024-01-19 09:16:00" }
  ]
}

const loadChats = async () => {
  chatLoading.value = true
  try {
    chatUsers.value = [
      { id: "user1", name: "Juan Dela Cruz", role: "Citizen", online: true, last_message: "Near Tawagan Elementary School", last_message_time: "10:33 AM" },
      { id: "responder2", name: "Medical Team", role: "Responder", online: true, last_message: "Team dispatched", last_message_time: "09:30 AM" },
      { id: "user2", name: "Maria Santos", role: "Citizen", online: false, last_message: "Medical emergency", last_message_time: "09:15 AM" },
      { id: "admin1", name: "Admin User", role: "Admin", online: true, last_message: "System update", last_message_time: "Yesterday" }
    ]
    if (chatUsers.value.length && !selectedChat.value) selectChat(chatUsers.value[0].id)
  } catch (error) {
    console.error("Error loading chats:", error)
  } finally {
    chatLoading.value = false
  }
}

const loadMessages = async (userId) => {
  chatLoading.value = true
  try {
    chatMessages.value = mockChats[userId] || []
    setTimeout(() => scrollToBottom(), 100)
  } catch (error) {
    console.error("Error loading messages:", error)
  } finally {
    chatLoading.value = false
  }
}

const selectChat = (userId) => {
  selectedChat.value = userId
  loadMessages(userId)
}

const sendMessage = async () => {
  if (!newMessage.value.trim() || !selectedChat.value) return
  const message = {
    id: Date.now(),
    sender_id: currentUserId,
    sender_name: "Officer Reyes",
    message: newMessage.value.trim(),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    created_at: new Date().toISOString()
  }
  chatMessages.value.push(message)
  newMessage.value = ""
  const userIndex = chatUsers.value.findIndex(u => u.id === selectedChat.value)
  if (userIndex !== -1) {
    chatUsers.value[userIndex].last_message = message.message
    chatUsers.value[userIndex].last_message_time = message.timestamp
  }
  setTimeout(() => scrollToBottom(), 50)
}

const scrollToBottom = () => {
  const container = document.querySelector('.messages-container')
  if (container) container.scrollTop = container.scrollHeight
}

// ================= MAP (incident markers + responder location) =================
let map = null
let markersLayer = null
let responderMarker = null
const mapStatus = ref("Map ready. Loading incidents...")
const DEFAULT_CENTER = [13.411, 121.181]
const DEFAULT_ZOOM = 13

const ensureLeafletCssOnce = () => {
  if (document.getElementById("leaflet-css-scoped")) return
  const link = document.createElement("link")
  link.id = "leaflet-css-scoped"
  link.rel = "stylesheet"
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
  link.crossOrigin = ""
  document.head.appendChild(link)
}

const fixLeafletIcons = () => {
  delete L.Icon.Default.prototype._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  })
}

const initMap = async () => {
  if (map) return
  ensureLeafletCssOnce()
  fixLeafletIcons()
  const el = document.getElementById("responder-map")
  if (!el) return
  map = L.map(el).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map)
  markersLayer = L.layerGroup().addTo(map)
  await loadIncidentMarkers()
  if (currentLocation.value) {
    updateResponderMarker()
  }
  mapRef.value = map
  loadOtherResponderLocations()
}

const loadIncidentMarkers = async () => {
  try {
    const response = await api.get("/admin/incidents/heatmap", { params: { status: "all" } })
    const incidents = response.data
    markersLayer.clearLayers()
    incidents.forEach(inc => {
      if (inc.latitude && inc.longitude) {
        const color = severityColors[inc.severity?.toLowerCase()] || "#6b7280"
        const marker = L.circleMarker([inc.latitude, inc.longitude], {
          radius: 12, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.7
        }).addTo(markersLayer)
        marker.bindPopup(`
          <b>${inc.type}</b><br>
          Severity: ${inc.severity}<br>
          Status: ${inc.status}<br>
          Location: ${inc.barangay}<br>
          Reported: ${new Date(inc.created_at).toLocaleDateString()}
        `)
      }
    })
    mapStatus.value = `Showing ${incidents.length} incident markers.`
  } catch (error) {
    console.error("Failed to load map markers:", error)
    mapStatus.value = "Error loading incidents."
  }
}

const updateResponderMarker = () => {
  if (!map || !currentLocation.value) return
  if (!responderMarker) {
    const responderIcon = L.divIcon({
      className: 'responder-marker',
      html: '<div style="background-color: #f97316; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 2px #f97316;"></div>',
      iconSize: [20, 20],
      popupAnchor: [0, -10]
    })
    responderMarker = L.marker([currentLocation.value.lat, currentLocation.value.lng], { icon: responderIcon })
      .addTo(map)
      .bindPopup(`Your location (accuracy: ${Math.round(currentLocation.value.accuracy)}m)`)
      .openPopup()
  } else {
    responderMarker.setLatLng([currentLocation.value.lat, currentLocation.value.lng])
    responderMarker.getPopup().setContent(`Your location (accuracy: ${Math.round(currentLocation.value.accuracy)}m)`)
  }
}

const invalidateSoon = () => setTimeout(() => map?.invalidateSize(), 120)

// ================= LEGAL COMPLIANCE =================
const legalCompliances = ref([])
const legalLoading = ref(false)
const legalSearch = ref('')
const selectedLegal = ref(null)
const showLegalDetailModal = ref(false)

const loadLegalCompliances = async () => {
  legalLoading.value = true
  try {
    const res = await api.get('/api/legal-compliances')
    legalCompliances.value = res.data
  } catch (e) {
    console.error('Failed to load legal compliances', e)
    showNotification('Could not load legal information', 'error')
  } finally {
    legalLoading.value = false
  }
}

const filteredLegal = computed(() => {
  if (!legalSearch.value.trim()) return legalCompliances.value
  const q = legalSearch.value.toLowerCase()
  return legalCompliances.value.filter(e =>
    e.title.toLowerCase().includes(q) ||
    e.category.toLowerCase().includes(q) ||
    (e.law_number || '').toLowerCase().includes(q) ||
    e.description.toLowerCase().includes(q)
  )
})

const openLegalDetail = (entry) => {
  selectedLegal.value = entry
  showLegalDetailModal.value = true
}

const legalCategoryColor = (category) => {
  const map = {
    'Disaster Risk Reduction': { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' },
    'Emergency Response':      { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' },
    'Traffic & Road Safety':   { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' },
    'Public Health':           { bg: '#d1fae5', text: '#065f46', border: '#10b981' },
    'Environmental':           { bg: '#ecfdf5', text: '#065f46', border: '#34d399' },
    'Criminal Justice':        { bg: '#f3f4f6', text: '#1f2937', border: '#6b7280' },
    'Civil Protection':        { bg: '#ede9fe', text: '#4c1d95', border: '#8b5cf6' },
  }
  return map[category] || { bg: '#f0f9ff', text: '#0c4a6e', border: '#0ea5e9' }
}

// ================= NAVIGATION =================
const go = async (key) => {
  active.value = key
  await nextTick()
  if (key === "assignments") {
    await loadAssignedIncidents()
  } else if (key === "map") {
    await initMap()
    if (map) setTimeout(() => map.invalidateSize(), 100)
  } else if (key === "chat") {
    loadChats()
    scrollToBottom()
  } else if (key === "announcements") {
    fetchActiveAlerts()
  } else if (key === "legal") {
    await loadLegalCompliances()
  } else if (key === "history") {
    await loadHistory()
  }
}

// ================= LIFECYCLE =================
onMounted(() => {
  fetchActiveAlerts()
  loadAssignedIncidents().then(() => {
    previousCount.value = assignmentCount.value
    previousAlertIds.value = activeAlerts.value.map(a => a.id)
    startPolling()
  })
  startLocationTracking()          // <-- start tracking on dashboard load
  // Add notification styles
  if (!document.getElementById("notification-styles")) {
    const style = document.createElement("style")
    style.id = "notification-styles"
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      .admin-notification button {
        background: transparent;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0 0 0 10px;
      }
    `
    document.head.appendChild(style)
  }
})

onBeforeUnmount(() => {
  stopLocationTracking()           // <-- stop tracking when component is destroyed
  try { map?.remove() } catch {}
  map = null
  markersLayer = null
  responderMarker = null
  if (alertMapInstance) {
    alertMapInstance.remove()
    alertMapInstance = null
  }
  stopPolling()
  if (audioContext) audioContext.close()
})

const sendLocationToBackend = async (loc) => {
  try {
    await api.post("/admin/responder/location", {
      lat: loc.lat,
      lng: loc.lng,
      accuracy: loc.accuracy,   // ✅ ensure this exists
      timestamp: loc.timestamp
    });
  } catch (error) {
    console.warn("Could not send location to backend:", error);
  }
};

const historyIncidents = ref([])
const historyLoading = ref(false)

const selectedIncident = ref(null)
const showIncidentModal = ref(false)

const fetchMediaAnalysis = async (incidentId) => {
  try {
    const res = await api.get(`/admin/incidents/${incidentId}/media-analysis`);
    return res.data;
  } catch (e) {
    return {};
  }
};

const viewIncidentDetails = async (incident) => {
  selectedIncident.value = incident;
  showIncidentModal.value = true;
  const media = await fetchMediaAnalysis(incident.id);
  selectedIncident.value = { ...incident, ...media };
};

const loadHistory = async () => {
  historyLoading.value = true
  try {
    const response = await api.get("/api/responder/history")
    historyIncidents.value = response.data
  } catch (error) {
    console.error("Failed to load history:", error)
    showNotification("Could not load history", "error")
  } finally {
    historyLoading.value = false
  }
}

// Helper to parse image/video paths (in case they come as JSON strings)
const getMediaPaths = (paths) => {
  if (!paths) return []
  if (Array.isArray(paths)) return paths
  if (typeof paths === 'string') {
    try {
      const parsed = JSON.parse(paths)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }
  return []
}

const handleImageError = (event) => {
  event.target.style.display = 'none'
  const parent = event.target.parentElement
  if (parent) {
    const fallbackDiv = document.createElement('div')
    fallbackDiv.className = 'image-fallback'
    fallbackDiv.innerHTML = '📷 No image'
    fallbackDiv.style.cssText = 'display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #64748b; font-size: 0.8rem; height: 100%;'
    parent.appendChild(fallbackDiv)
  }
}

// ================= SOUND NOTIFICATION =================
let audioContext = null

const playBeep = () => {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)()
    }
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.frequency.value = 800
    gainNode.gain.value = 0.3
    oscillator.start()
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5)
    oscillator.stop(audioContext.currentTime + 0.5)
    // Resume if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }
  } catch (e) {
    console.warn("Could not play sound:", e)
  }
}

// ================= ASSIGNMENT POLLING WITH SOUND =================
const previousCount = ref(0)
let pollInterval = null

const assignmentCount = computed(() => assignedIncidents.value.length)

const checkForNewAssignments = async () => {
  const oldCount = previousCount.value
  await loadAssignedIncidents()
  const newCount = assignmentCount.value
  if (newCount > oldCount) {
    showNotification(`You have ${newCount - oldCount} new incident(s) assigned!`, "info")
    playBeep()  // 🔔 Sound alert
  }
  previousCount.value = newCount
}

// ================= ANNOUNCEMENT POLLING WITH SOUND =================
const previousAlertIds = ref([])

const checkForNewAnnouncements = async () => {
  const oldIds = previousAlertIds.value
  await fetchActiveAlerts()
  const newIds = activeAlerts.value.map(a => a.id)
  const newAlerts = newIds.filter(id => !oldIds.includes(id))
  if (newAlerts.length > 0) {
    showNotification(`📢 ${newAlerts.length} new announcement(s) received!`, "info")
    playBeep()  // 🔔 Sound alert
  }
  previousAlertIds.value = newIds
}

const getFullImageUrl = (path) => {
  if (!path) return ''
  if (path.startsWith('http')) return path
  let cleanPath = path.startsWith('/') ? path.slice(1) : path
  let base = api.defaults.baseURL || ''
  if (base.endsWith('/')) base = base.slice(0, -1)
  return `${base}/${cleanPath}`
}

// Start polling for both
const startPolling = () => {
  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(() => {
    if (active.value === "assignments") {
      checkForNewAssignments()
    }
    // Always check for new announcements (even if not on that tab)
    checkForNewAnnouncements()
  }, 30000) // 30 seconds
}

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}
const mapRef = ref(null)

// Refresh functions
const refreshAssignments = async () => {
  if (active.value !== 'assignments') return
  await loadAssignedIncidents()
}
const refreshMap = async () => {
  if (active.value !== 'map') return
  await loadIncidentMarkers()
}
const refreshAnnouncements = async () => {
  if (active.value !== 'announcements') return
  await fetchActiveAlerts()
}
const refreshLegal = async () => {
  if (active.value !== 'legal') return
  await loadLegalCompliances()
}
const refreshHistory = async () => {
  if (active.value !== 'history') return
  await loadHistory()
}

// Apply auto‑refresh
useAutoRefresh({ refreshFn: refreshAssignments, interval: 30000, enabled: true, preserveScroll: true, scrollContainerSelector: '.reports-table-container' })
useAutoRefresh({ refreshFn: refreshMap, interval: 30000, enabled: true, preserveMap: true, mapRef })
useAutoRefresh({ refreshFn: refreshAnnouncements, interval: 60000, enabled: true })   // announcements can be slower
useAutoRefresh({ refreshFn: refreshLegal, interval: 60000, enabled: true })
useAutoRefresh({ refreshFn: refreshHistory, interval: 30000, enabled: true, preserveScroll: true })
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="seal-wrap">
            <img class="seal" :src="calapanLogo" alt="Calapan City Seal" />
          </div>
          <div class="brand-text">
            <div class="brand-title">RESQAPP • Responder Console</div>
            <div class="brand-subtitle">Calapan City, Oriental Mindoro</div>
          </div>
        </div>
        <div class="right">
          <span class="role" :class="roleClass">{{ role }}</span>
          <button class="btn btn-outline btn-sm" @click="logout">Logout</button>
        </div>
      </div>
    </header>

    <main class="main">
      <div class="layout">
        <nav class="nav">
          <button class="navbtn" :class="{ on: active === 'assignments' }" @click="go('assignments')">
            My Assignments
            <span v-if="assignmentCount > 0" class="badge">{{ assignmentCount }}</span>
          </button>
          <button class="navbtn" :class="{ on: active === 'map' }" @click="go('map')">Incident Map</button>
          <button class="navbtn" :class="{ on: active === 'announcements' }" @click="go('announcements')">
            Announcements
            <span v-if="activeAlerts.length > 0" class="badge">{{ activeAlerts.length }}</span>
          </button>
          <button class="navbtn" :class="{ on: active === 'legal' }" @click="go('legal')">Legal Info</button>
          <button class="navbtn" :class="{ on: active === 'history' }" @click="go('history')">History</button>
        </nav>

        <section class="content">
          <!-- My Assignments Tab -->
          <div v-if="active === 'assignments'" class="card">
            <div class="section-header">
              <h2 class="h2">My Assigned Incidents</h2>
              <select v-model="assignmentsFilter" @change="loadAssignedIncidents" class="filter-select">
                <option value="all">All</option>
                <option value="in-progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <p class="p">Incidents assigned to you by the administrator. Update status as you respond.</p>

            <div v-if="assignmentsLoading" class="loading-skeleton">
              <div class="skeleton-row" v-for="i in 2" :key="i"><div class="skeleton-cell"></div></div>
            </div>
            <div v-else-if="assignedIncidents.length === 0" class="empty-state">
              <div class="empty-icon">✅</div>
              <h3>No assigned incidents</h3>
              <p>You have no incidents assigned at the moment.</p>
            </div>
            <div v-else class="reports-table-container">
              <table class="reports-table">
                <thead>
                  <tr><th>ID</th><th>Type</th><th>Severity</th><th>Barangay</th><th>Status</th><th>Reported</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  <tr v-for="inc in assignedIncidents" :key="inc.id" class="report-row">
                    <td class="report-id">#{{ inc.id.slice(0,8) }}</td>
                    <td>{{ inc.incident_type || inc.type }}</td>
                    <td><span class="severity-badge" :style="{ backgroundColor: severityColors[inc.severity?.toLowerCase()] }">{{ inc.severity }}</span></td>
                    <td>{{ inc.barangay }}</td>
                    <td><span class="status-badge" :style="{ backgroundColor: statusColors[inc.status] }">{{ inc.status }}</span></td>
                    <td>{{ new Date(inc.created_at).toLocaleDateString() }}</td>
                    <td class="action-buttons">
                      <button class="btn-view" @click="viewIncidentDetails(inc)">👁️ View</button>
                      <select @change="updateIncidentStatus(inc.id, $event.target.value)" class="status-select" :value="inc.status">
                        <option value="in-progress">Mark In Progress</option>
                        <option value="resolved">Mark Resolved</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Map Section -->
          <div v-else-if="active === 'map'" class="card">
            <div class="mapTop">
              <div><h2 class="h2">Incident Map</h2><p class="p">Live incident locations and your current position</p></div>
              <div class="mapActions"><span class="roleTag">Real-time markers</span></div>
            </div>
            <!-- Location status display -->
            <div v-if="currentLocation" class="location-status">
              📍 Your location: {{ currentLocation.lat.toFixed(5) }}, {{ currentLocation.lng.toFixed(5) }}
              (accuracy: {{ Math.round(currentLocation.accuracy) }}m)
            </div>
            <div v-if="locationError" class="location-error">{{ locationError }}</div>
            <div class="mapStatus">{{ mapStatus }}</div>
            <div class="mapFrame"><div id="responder-map" class="map"></div></div>
            <div class="mapHint">Your position (orange pulsing marker) updates every 3 minutes. Tap any marker for incident details.</div>
          </div>

          <!-- Announcements -->
<!-- Announcements -->
<div v-else-if="active === 'announcements'" class="card">
  <h2 class="h2">📢 Announcements</h2>
  <p class="p">Official announcements and active alerts from Calapan City.</p>

  <div v-if="loadingAlerts" class="loading-skeleton">
    <div class="skeleton-row" v-for="i in 2" :key="i"><div class="skeleton-cell"></div></div>
  </div>

  <div v-else-if="activeAlerts.length" class="announcements-list">
    <div v-for="alert in activeAlerts" :key="alert.id" class="announcement-card" :class="alert.severity">
      <div class="announcement-header">
        <span class="severity-badge" :class="alert.severity">{{ alert.severity }}</span>
        <span class="announcement-time">{{ formatAlertTime(alert.created_at) }}</span>
      </div>

      <div class="announcement-expiration">
        <span class="expiration-badge" :class="{ permanent: !alert.expires_at }">
          <span v-if="alert.expires_at">🕒 Expires: {{ new Date(alert.expires_at).toLocaleDateString() }}</span>
          <span v-else>🔷 Permanent</span>
        </span>
      </div>

      <p class="announcement-message">{{ alert.message }}</p>

      <!-- Action buttons row (instead of thumbnail) -->
      <div class="announcement-actions">
        <button
          v-if="alert.image_url"
          class="action-btn image-btn"
          @click="openImageModal(getFullImageUrl(alert.image_url))"
        >
          📷 View Image
        </button>
        <button
          v-if="alert.geometry"
          class="action-btn map-btn"
          @click="openAlertMap(alert.geometry)"
        >
          🗺️ View affected area
        </button>
      </div>
    </div>
  </div>

  <div v-else class="empty-announcements">
    <p>No active announcements at this time.</p>
  </div>
</div>

          <!-- Chat Section -->
          <div v-else-if="active === 'chat'" class="chat-layout">
            <div class="chat-contacts-sidebar">
              <div class="sidebar-header"><h3>Conversations</h3><span class="online-count">{{ chatUsers.filter(u => u.online).length }} online</span></div>
              <div class="search-box"><input v-model="userSearch" placeholder="Search contacts..." class="search-input" /></div>
              <div class="contacts-list">
                <div v-for="user in filteredUsers" :key="user.id" class="contact-item" :class="{ active: selectedChat === user.id }" @click="selectChat(user.id)">
                  <div class="contact-avatar"><div class="avatar-initial">{{ user.name.charAt(0) }}</div><span class="online-dot" :class="{ online: user.online }"></span></div>
                  <div class="contact-info"><div class="contact-name">{{ user.name }}</div><div class="contact-role">{{ user.role }}</div><div class="last-message">{{ user.last_message }}</div></div>
                  <div class="last-time">{{ user.last_message_time }}</div>
                </div>
                <div v-if="filteredUsers.length === 0" class="no-contacts">No contacts found</div>
              </div>
            </div>
            <div class="chat-main-area">
              <div class="chat-main-header">
                <div class="current-user" v-if="selectedChat">
                  <div class="current-user-avatar">{{ chatUsers.find(u => u.id === selectedChat)?.name.charAt(0) }}</div>
                  <div><div class="current-user-name">{{ chatUsers.find(u => u.id === selectedChat)?.name }}</div><div class="current-user-status"><span class="status-dot" :class="{ online: chatUsers.find(u => u.id === selectedChat)?.online }"></span>{{ chatUsers.find(u => u.id === selectedChat)?.online ? 'Online' : 'Offline' }}</div></div>
                </div>
              </div>
              <div class="messages-container">
                <div v-if="chatLoading && chatMessages.length === 0" class="loading-messages">Loading messages...</div>
                <div v-else-if="chatMessages.length === 0" class="no-messages">No messages yet. Start a conversation!</div>
                <div v-else>
                  <div v-for="msg in chatMessages" :key="msg.id" class="message" :class="{ 'message-sent': msg.sender_id === currentUserId, 'message-received': msg.sender_id !== currentUserId }">
                    <div class="message-content">{{ msg.message }}</div>
                    <div class="message-time">{{ msg.timestamp }}</div>
                  </div>
                </div>
              </div>
              <div class="chat-input-area">
                <div class="chat-input-wrapper">
                  <textarea v-model="newMessage" @keyup.enter="sendMessage" placeholder="Type your message..." rows="1" :disabled="!selectedChat || chatLoading"></textarea>
                  <button @click="sendMessage" class="btn-send" :disabled="!selectedChat || !newMessage.trim() || chatLoading">{{ chatLoading ? '...' : 'Send' }}</button>
                </div>
                <div class="input-hint">Press Enter to send • Shift+Enter for new line</div>
              </div>
            </div>
          </div>

          <!-- Legal Compliance Section -->
          <div v-else-if="active === 'legal'" class="card">
            <h2 class="h2">⚖️ Legal Information</h2>
            <p class="p">Applicable laws and official legal statements for emergency response operations.</p>

            <!-- Search -->
            <div class="legal-search-wrap">
              <span class="legal-search-icon">🔍</span>
              <input
                v-model="legalSearch"
                class="legal-search-input"
                placeholder="Search by title, law number, or category…"
              />
              <button v-if="legalSearch" @click="legalSearch = ''" class="legal-search-clear">✕</button>
            </div>

            <!-- Loading -->
            <div v-if="legalLoading" class="loading-skeleton">
              <div class="skeleton-row" v-for="i in 3" :key="i"><div class="skeleton-cell"></div></div>
            </div>

            <!-- Empty -->
            <div v-else-if="filteredLegal.length === 0" class="empty-state">
              <div class="empty-icon">⚖️</div>
              <h3>{{ legalSearch ? 'No results found' : 'No legal information available' }}</h3>
              <p>{{ legalSearch ? 'Try a different search term.' : 'Check back later for updates.' }}</p>
              <button v-if="legalSearch" @click="legalSearch = ''" class="legal-clear-btn">Clear Search</button>
            </div>

            <!-- Cards -->
            <div v-else class="legal-grid">
              <div
                v-for="entry in filteredLegal"
                :key="entry.id"
                class="legal-entry-card"
                :style="{ borderLeftColor: legalCategoryColor(entry.category).border }"
              >
                <div class="legal-entry-header">
                  <div class="legal-tags">
                    <span
                      class="legal-cat-tag"
                      :style="{
                        background: legalCategoryColor(entry.category).bg,
                        color: legalCategoryColor(entry.category).text,
                        borderColor: legalCategoryColor(entry.category).border
                      }"
                    >{{ entry.category }}</span>
                    <span v-if="entry.law_number" class="legal-num-tag">{{ entry.law_number }}</span>
                  </div>
                  <span v-if="entry.effective_date" class="legal-date-tag">📅 {{ entry.effective_date }}</span>
                </div>
                <h3 class="legal-entry-title">{{ entry.title }}</h3>
                <p class="legal-entry-desc">{{ entry.description }}</p>
                <button class="legal-view-btn" @click="openLegalDetail(entry)">📜 Read Official Statement</button>
              </div>
            </div>

            <!-- Detail Modal -->
            <div v-if="showLegalDetailModal && selectedLegal" class="modal-overlay" @click.self="showLegalDetailModal = false">
              <div class="modal-content legal-detail-modal">
                <div class="modal-header">
                  <div>
                    <div class="legal-modal-tags">
                      <span
                        class="legal-cat-tag"
                        :style="{
                          background: legalCategoryColor(selectedLegal.category).bg,
                          color: legalCategoryColor(selectedLegal.category).text,
                          borderColor: legalCategoryColor(selectedLegal.category).border
                        }"
                      >{{ selectedLegal.category }}</span>
                      <span v-if="selectedLegal.law_number" class="legal-num-tag">{{ selectedLegal.law_number }}</span>
                    </div>
                    <h3 style="margin-top:0.5rem;">{{ selectedLegal.title }}</h3>
                  </div>
                  <button class="modal-close" @click="showLegalDetailModal = false">×</button>
                </div>
                <div class="modal-body">
                  <p class="legal-modal-desc">{{ selectedLegal.description }}</p>
                  <div class="legal-statement-box">
                    <div class="legal-statement-label">📜 Official Statement</div>
                    <div class="legal-statement-text">{{ selectedLegal.official_statement }}</div>
                  </div>
                  <div v-if="selectedLegal.effective_date" class="legal-modal-meta">
                    📅 Effective Date: <strong>{{ selectedLegal.effective_date }}</strong>
                  </div>
                </div>
                <div class="modal-footer-actions">
                  <button class="btn-modal-close" @click="showLegalDetailModal = false">Close</button>
                </div>
              </div>
            </div>
          </div>

          <!-- History Section (placeholder) -->
          <!-- History Section -->
          <div v-else-if="active === 'history'" class="card">
            <h2 class="h2">History</h2>
            <p class="p">Resolved incidents and past assignments.</p>

            <div v-if="historyLoading" class="loading-skeleton">
              <div class="skeleton-row" v-for="i in 3" :key="i"><div class="skeleton-cell"></div></div>
            </div>
            <div v-else-if="historyIncidents.length === 0" class="empty-state">
              <div class="empty-icon">📋</div>
              <h3>No history yet</h3>
              <p>Resolved incidents will appear here.</p>
            </div>
            <div v-else class="reports-table-container">
              <table class="reports-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Barangay</th>
                    <th>Resolved At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="inc in historyIncidents" :key="inc.id" class="report-row">
                    <td class="report-id">#{{ inc.id.slice(0,8) }}</td>
                    <td>{{ inc.incident_type }}</td>
                    <td>
                      <span class="severity-badge" :style="{ backgroundColor: severityColors[inc.severity?.toLowerCase()] }">
                        {{ inc.severity }}
                      </span>
                    </td>
                    <td>{{ inc.barangay }}</td>
                    <td>{{ new Date(inc.resolved_at).toLocaleString() }}</td>
                    <td class="action-buttons">
                      <button class="btn-view" @click="viewIncidentDetails(inc)">👁️ View</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>

    <footer class="footer"><div class="footer-inner">© {{ new Date().getFullYear() }} RESQAPP • Calapan City</div></footer>

    <!-- Modals -->
    <div v-if="showAlertMapModal" class="modal-overlay" @click.self="showAlertMapModal = false">
      <div class="modal-content" style="max-width: 800px">
        <div class="modal-header"><h3>Alert Area</h3><button class="modal-close" @click="showAlertMapModal = false">×</button></div>
        <div class="modal-body"><div id="alert-map" style="height: 400px; width: 100%; border-radius: 8px"></div></div>
      </div>
    </div>
    <div v-if="showImageModal" class="modal-overlay" @click.self="showImageModal = false">
      <div class="modal-content" style="max-width: 600px">
        <div class="modal-header"><h3>Announcement Image</h3><button class="modal-close" @click="showImageModal = false">×</button></div>
        <div class="modal-body"><img :src="modalImageUrl" style="width: 100%; border-radius: 8px" /></div>
      </div>
    </div>

              <!-- Incident Detail Modal -->
      <!-- Incident Detail Modal -->
      <div v-if="showIncidentModal && selectedIncident" class="modal-overlay" @click.self="showIncidentModal = false">
        <div class="modal-content incident-detail-modal">
          <div class="modal-header">
            <div>
              <h3>Incident Details</h3>
              <div class="modal-badges">
                <span class="severity-badge" :style="{ backgroundColor: severityColors[selectedIncident.severity?.toLowerCase()] }">
                  {{ selectedIncident.severity }}
                </span>
                <span class="status-badge" :style="{ backgroundColor: statusColors[selectedIncident.status] }">
                  {{ selectedIncident.status }}
                </span>
              </div>
            </div>
            <button class="modal-close" @click="showIncidentModal = false">×</button>
          </div>
          <div class="modal-body">
            <!-- Two-column layout for basic info -->
            <div class="incident-detail-grid">
              <div class="detail-group">
                <label>Incident ID</label>
                <p class="mono">{{ selectedIncident.id.slice(0,8) }}...</p>
              </div>
              <div class="detail-group">
                <label>Type</label>
                <p>{{ selectedIncident.incident_type || selectedIncident.type }}</p>
              </div>
              <div class="detail-group">
                <label>Barangay</label>
                <p>{{ selectedIncident.barangay }}</p>
              </div>
              <div class="detail-group">
                <label>Reported At</label>
                <p>{{ new Date(selectedIncident.created_at).toLocaleString() }}</p>
              </div>
              <div class="detail-group" v-if="selectedIncident.resolved_at">
                <label>Resolved At</label>
                <p>{{ new Date(selectedIncident.resolved_at).toLocaleString() }}</p>
              </div>
              <div class="detail-group">
                <label>Contact</label>
                <p>{{ selectedIncident.contact_number || 'N/A' }}</p>
              </div>
              <div class="detail-group full-width">
                <label>Description</label>
                <div class="description-box">{{ selectedIncident.description }}</div>
              </div>
              <div class="detail-group">
                <label>Address</label>
                <p>{{ selectedIncident.address || 'N/A' }}</p>
              </div>
              <div class="detail-group">
                <label>Emergency Contact</label>
                <p>{{ selectedIncident.emergency_contact || 'N/A' }}</p>
              </div>
              <div class="detail-group">
                <label>Reported By</label>
                <p>{{ selectedIncident.user?.full_name || 'Anonymous' }}</p>
              </div>
            </div>

            <!-- Media Section with better grid -->
            <div v-if="getMediaPaths(selectedIncident.image_paths).length > 0" class="media-section">
              <h4>📸 Images</h4>
              <div class="media-grid">
                <div v-for="(imgPath, idx) in getMediaPaths(selectedIncident.image_paths)" :key="idx" class="media-card" @click="openImageModal(api.defaults.baseURL + imgPath)">
                  <img :src="getFullImageUrl(imgPath)" :alt="'Image ' + (idx+1)" @error="handleImageError" />
                  <div class="media-overlay">🔍</div>
                </div>
              </div>
            </div>

            <div v-if="getMediaPaths(selectedIncident.video_paths).length > 0" class="media-section">
              <h4>🎥 Videos</h4>
              <div class="media-grid">
                <div v-for="(vidPath, idx) in getMediaPaths(selectedIncident.video_paths)" :key="idx" class="media-card video-card">
                  <video controls :src="getFullImageUrl(vidPath)"></video>
                </div>
              </div>
            </div>

            <!-- AI Analysis (collapsible or styled) -->
            
          </div>
          <div class="modal-footer-actions">
            <button class="btn-modal-close" @click="showIncidentModal = false">Close</button>
          </div>
        </div>
      </div>
  </div>
</template>

<style scoped>
/* ===== Complete styles – same as original, plus new location styles ===== */
* { margin: 0; padding: 0; box-sizing: border-box; }
.page { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #f5f7fa 0%, #e9ecf2 100%); min-height: 100vh; display: flex; flex-direction: column; color: #1e293b; }
.topbar { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.05); position: sticky; top: 0; z-index: 40; }
.topbar-inner { max-width: 1400px; margin: 0 auto; padding: 0.75rem 2rem; display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 1rem; }
.seal-wrap { width: 48px; height: 48px; border-radius: 50%; overflow: hidden; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.seal { width: 100%; height: 100%; object-fit: cover; }
.brand-text { display: flex; flex-direction: column; }
.brand-title { font-weight: 700; font-size: 1.25rem; background: linear-gradient(135deg, #1e3c72, #f97316); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.brand-subtitle { font-size: 0.75rem; color: #64748b; }
.right { display: flex; align-items: center; gap: 1rem; }
.role { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; background: #e2e8f0; color: #334155; }
.role-responder { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 500; font-size: 0.875rem; transition: all 0.2s; cursor: pointer; border: none; gap: 0.5rem; }
.btn-outline { background: transparent; border: 2px solid #2a5298; color: #2a5298; }
.btn-outline:hover { background: #2a5298; color: white; }
.btn-sm { padding: 0.25rem 0.75rem; font-size: 0.75rem; }
.main { flex: 1; max-width: 1400px; width: 100%; margin: 2rem auto; padding: 0 2rem; }
.layout { display: flex; gap: 2rem; }
.nav { width: 220px; flex-shrink: 0; background: white; border-radius: 1rem; padding: 1.5rem 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 0.25rem; height: fit-content; position: sticky; top: 100px; }
.navbtn { width: 100%; text-align: left; padding: 0.75rem 1rem; border: none; background: transparent; border-radius: 0.5rem; font-weight: 500; color: #475569; transition: all 0.2s; cursor: pointer; font-size: 0.95rem; position: relative; }
.navbtn:hover { background: #f1f5f9; color: #1e293b; }
.navbtn.on { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; font-weight: 600; box-shadow: 0 4px 8px rgba(30,60,114,0.3); }
.badge { position: absolute; top: 8px; right: 12px; background: #f97316; color: white; font-size: 0.7rem; min-width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; }
.content { flex: 1; min-width: 0; }
.card { background: white; border-radius: 1.5rem; padding: 2rem; box-shadow: 0 8px 20px rgba(0,0,0,0.03); margin-bottom: 2rem; }
.h2 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.5rem; background: linear-gradient(135deg, #1e3c72, #2a5298); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.p { font-size: 1rem; color: #475569; margin-bottom: 1.5rem; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
.filter-select { padding: 0.5rem 1rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; background: white; }
.reports-table-container { overflow-x: auto; margin-top: 1rem; }
.reports-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.reports-table th { text-align: left; padding: 1rem 0.75rem; background: #f8fafc; color: #475569; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
.reports-table td { padding: 1rem 0.75rem; border-bottom: 1px solid #e9eef2; vertical-align: middle; }
.report-row:hover { background: #f1f5f9; }
.report-id { font-family: monospace; font-weight: 600; color: #1e3c72; }
.status-badge, .severity-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; color: white; }
.action-buttons { display: flex; gap: 0.5rem; }
.status-select { padding: 0.25rem 0.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: white; }
.empty-state { text-align: center; padding: 3rem; background: #f8fafc; border-radius: 1rem; }
.empty-icon { font-size: 3rem; margin-bottom: 1rem; }
.loading-skeleton { display: flex; flex-direction: column; gap: 1rem; }
.skeleton-row { padding: 1rem; background: #f1f5f9; border-radius: 0.5rem; animation: pulse 1.5s infinite; }
.skeleton-cell { height: 1rem; background: #e2e8f0; border-radius: 0.25rem; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
/* Map styles */
.mapTop { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; }
.mapStatus { background: #f1f5f9; padding: 0.5rem 1rem; border-radius: 0.5rem; margin-bottom: 1rem; font-size: 0.9rem; color: #475569; }
.mapFrame { height: 500px; border-radius: 1rem; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.map { width: 100%; height: 100%; z-index: 1; }
.mapHint { margin-top: 0.75rem; font-size: 0.85rem; color: #64748b; font-style: italic; }
.roleTag { font-size: 0.8rem; font-weight: 600; padding: 0.4rem 0.8rem; border-radius: 999px; background: #eef2ff; color: #1e3c72; }
/* Location status */
.location-status { background: #eef2ff; padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1rem; font-family: monospace; border-left: 4px solid #f97316; }
.location-error { background: #fee2e2; color: #b91c1c; padding: 0.5rem 1rem; border-radius: 0.5rem; margin-bottom: 1rem; }
.responder-marker div { animation: pulseMarker 1.5s infinite; }
@keyframes pulseMarker { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.7; } 100% { transform: scale(1); opacity: 1; } }
/* Announcements */
.announcements-list { display: flex; flex-direction: column; gap: 1rem; }
.announcement-card { background: #f8fafc; border-radius: 1rem; padding: 1.5rem; border-left: 4px solid #94a3b8; }
.announcement-card.low { border-left-color: #3b82f6; }
.announcement-card.medium { border-left-color: #f97316; }
.announcement-card.high { border-left-color: #ef4444; }
.announcement-card.critical { border-left-color: #7f1d1d; }
.announcement-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.announcement-time { font-size: 0.8rem; color: #64748b; }
.announcement-expiration { margin: 8px 0; }
.expiration-badge { display: inline-flex; align-items: center; gap: 4px; background: #f1f5f9; padding: 4px 10px; border-radius: 20px; font-size: 12px; color: #334155; }
.expiration-badge.permanent { background: #e9f1ff; color: #0b4fa3; }
.announcement-image { margin: 1rem 0; border-radius: 0.5rem; overflow: hidden; cursor: pointer; max-height: 200px; }
.announcement-image img { width: 100%; height: 100%; object-fit: cover; }
.announcement-map-btn { background: #eef2ff; padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.9rem; color: #1e3c72; border: 1px solid #cbd5e1; }
.empty-announcements { text-align: center; padding: 3rem; color: #94a3b8; background: #f8fafc; border-radius: 1rem; }
/* Chat styles – same as original */
.chat-layout { display: flex; gap: 1.5rem; height: calc(100vh - 200px); min-height: 600px; }
.chat-contacts-sidebar { width: 320px; background: white; border-radius: 1rem; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
.sidebar-header { padding: 1rem 1.5rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
.sidebar-header h3 { font-size: 1.1rem; font-weight: 600; color: #1e3c72; }
.online-count { font-size: 0.75rem; background: #eef2ff; padding: 0.25rem 0.6rem; border-radius: 999px; color: #1e3c72; }
.search-box { padding: 1rem; border-bottom: 1px solid #e2e8f0; }
.search-input { width: 100%; padding: 0.6rem 1rem; border: 1px solid #e2e8f0; border-radius: 999px; font-size: 0.9rem; outline: none; }
.contacts-list { flex: 1; overflow-y: auto; }
.contact-item { display: flex; align-items: center; padding: 1rem; gap: 0.75rem; cursor: pointer; transition: background 0.2s; border-bottom: 1px solid #f1f5f9; }
.contact-item:hover { background: #f8fafc; }
.contact-item.active { background: #eef2ff; border-left: 4px solid #f97316; }
.contact-avatar { position: relative; }
.avatar-initial { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.2rem; }
.online-dot { position: absolute; bottom: 2px; right: 2px; width: 12px; height: 12px; background: #cbd5e1; border-radius: 50%; border: 2px solid white; }
.online-dot.online { background: #10b981; }
.contact-info { flex: 1; min-width: 0; }
.contact-name { font-weight: 700; color: #1e293b; margin-bottom: 0.2rem; }
.contact-role { font-size: 0.7rem; color: #64748b; text-transform: capitalize; margin-bottom: 0.25rem; }
.last-message { font-size: 0.8rem; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.last-time { font-size: 0.7rem; color: #94a3b8; white-space: nowrap; }
.no-contacts { text-align: center; padding: 2rem; color: #94a3b8; }
.chat-main-area { flex: 1; background: white; border-radius: 1rem; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
.chat-main-header { padding: 1rem 1.5rem; border-bottom: 1px solid #e2e8f0; background: #fafcff; }
.current-user { display: flex; align-items: center; gap: 1rem; }
.current-user-avatar { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.2rem; }
.current-user-name { font-weight: 700; color: #1e293b; }
.current-user-status { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: #64748b; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
.status-dot.online { background: #10b981; }
.messages-container { flex: 1; padding: 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; background: #f8fafc; }
.message { max-width: 75%; animation: fadeIn 0.2s ease; }
.message-sent { align-self: flex-end; }
.message-received { align-self: flex-start; }
.message-content { padding: 0.75rem 1rem; border-radius: 1rem; font-size: 0.9rem; line-height: 1.4; word-wrap: break-word; }
.message-sent .message-content { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; border-bottom-right-radius: 4px; }
.message-received .message-content { background: #e9f1ff; color: #1e293b; border-bottom-left-radius: 4px; }
.message-time { font-size: 0.7rem; color: #94a3b8; margin-top: 0.25rem; padding: 0 0.5rem; }
.chat-input-area { padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: white; }
.chat-input-wrapper { display: flex; gap: 0.75rem; align-items: flex-end; }
.chat-input-wrapper textarea { flex: 1; padding: 0.75rem 1rem; border: 1px solid #e2e8f0; border-radius: 1.5rem; font-family: inherit; font-size: 0.9rem; resize: none; min-height: 44px; max-height: 120px; outline: none; }
.btn-send { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; border: none; padding: 0.6rem 1.5rem; border-radius: 1.5rem; font-weight: 600; cursor: pointer; }
.btn-send:disabled { opacity: 0.5; cursor: not-allowed; }
.input-hint { font-size: 0.7rem; color: #94a3b8; margin-top: 0.5rem; text-align: right; }
.loading-messages, .no-messages { text-align: center; padding: 2rem; color: #94a3b8; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
.modal-content { background: white; border-radius: 1.5rem; width: 90%; max-width: 500px; max-height: 90vh; overflow: auto; }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 2rem; border-bottom: 1px solid #e2e8f0; }
.modal-close { background: none; border: none; font-size: 2rem; line-height: 1; cursor: pointer; color: #94a3b8; }
.modal-body { padding: 2rem; }
.footer { background: white; border-top: 1px solid #e9eef2; margin-top: auto; }
.footer-inner { max-width: 1400px; margin: 0 auto; padding: 1.5rem 2rem; text-align: center; color: #64748b; font-size: 0.9rem; }
@media (max-width: 1023px) { .layout { flex-direction: column; } .nav { width: 100%; position: static; flex-direction: row; flex-wrap: wrap; padding: 1rem; } .navbtn { width: auto; } .chat-layout { flex-direction: column; height: auto; } .chat-contacts-sidebar { width: 100%; max-height: 300px; } }
@media (max-width: 767px) { .topbar-inner { padding: 0.75rem 1rem; } .brand-text { display: none; } .main { padding: 0 1rem; } .card { padding: 1rem; } .mapFrame { height: 350px; } }
@media (max-width: 479px) { .right .role { display: none; } .navbtn { font-size: 0.8rem; padding: 0.5rem 0.75rem; } }
.responder-marker div {
  animation: pulseMarker 1.5s infinite;
}

/* ===== LEGAL COMPLIANCE ===== */
.legal-search-wrap { position: relative; display: flex; align-items: center; margin-bottom: 1.5rem; }
.legal-search-icon { position: absolute; left: 1rem; color: #94a3b8; font-size: 1rem; }
.legal-search-input { width: 100%; padding: 0.75rem 1rem 0.75rem 2.75rem; border: 1.5px solid #e2e8f0; border-radius: 999px; font-size: 0.95rem; outline: none; transition: border-color 0.2s; background: white; }
.legal-search-input:focus { border-color: #2a5298; box-shadow: 0 0 0 3px rgba(42,82,152,0.08); }
.legal-search-clear { position: absolute; right: 1rem; background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 1.1rem; padding: 0; line-height: 1; }
.legal-grid { display: flex; flex-direction: column; gap: 1rem; }
.legal-entry-card { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #2a5298; border-radius: 1rem; padding: 1.25rem 1.5rem; transition: box-shadow 0.2s, transform 0.2s; }
.legal-entry-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-2px); }
.legal-entry-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.legal-tags { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.legal-cat-tag { display: inline-block; padding: 0.2rem 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; border: 1px solid; }
.legal-num-tag { display: inline-block; background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; padding: 0.2rem 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
.legal-date-tag { font-size: 0.75rem; color: #64748b; white-space: nowrap; padding-top: 0.2rem; }
.legal-entry-title { font-size: 1rem; font-weight: 700; color: #1e293b; margin-bottom: 0.4rem; }
.legal-entry-desc { font-size: 0.875rem; color: #475569; line-height: 1.6; margin-bottom: 1rem; }
.legal-view-btn { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; border: none; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
.legal-view-btn:hover { opacity: 0.9; }
.legal-clear-btn { margin-top: 1rem; background: none; border: 1.5px solid #2a5298; color: #2a5298; padding: 0.5rem 1.5rem; border-radius: 999px; cursor: pointer; font-size: 0.9rem; }
.legal-detail-modal { max-width: 700px !important; }
.legal-modal-tags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.25rem; }
.legal-modal-desc { font-size: 0.95rem; color: #475569; line-height: 1.6; margin-bottom: 1.5rem; }
.legal-statement-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1rem; }
.legal-statement-label { font-size: 0.8rem; font-weight: 700; color: #2a5298; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem; }
.legal-statement-text { font-size: 0.9rem; color: #374151; line-height: 1.8; white-space: pre-wrap; }
.legal-modal-meta { font-size: 0.85rem; color: #64748b; padding-top: 0.75rem; border-top: 1px solid #e2e8f0; }
.modal-footer-actions { display: flex; justify-content: flex-end; padding: 1rem 2rem 1.5rem; }
.btn-modal-close { background: #f1f5f9; border: 1.5px solid #e2e8f0; color: #334155; padding: 0.6rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
.btn-modal-close:hover { background: #e2e8f0; }

/* Incident Detail Modal */
.incident-detail-modal {
  max-width: 800px !important;
  width: 90%;
}
.incident-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}
.detail-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.detail-group.full-width {
  grid-column: span 2;
}
.detail-group label {
  font-weight: 700;
  font-size: 0.8rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.detail-group p {
  margin: 0;
  font-size: 0.95rem;
  color: #1e293b;
  word-break: break-word;
}
.media-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 0.5rem;
}
.media-item {
  cursor: pointer;
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  max-width: 200px;
}
.media-item img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
}
.analysis-text {
  background: #f8fafc;
  padding: 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.8rem;
  overflow-x: auto;
  white-space: pre-wrap;
}
.btn-view {
  background: #e2e8f0;
  border: none;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.8rem;
  cursor: pointer;
  margin-right: 0.5rem;
}
.btn-view:hover {
  background: #cbd5e1;
}

/* Improved Incident Detail Modal */
.incident-detail-modal {
  max-width: 900px !important;
  width: 95%;
  border-radius: 1.5rem;
  overflow: hidden;
}

.modal-header {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
  padding: 1.25rem 1.5rem;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 600;
}

.modal-badges {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.modal-badges .severity-badge,
.modal-badges .status-badge {
  font-size: 0.75rem;
  padding: 0.25rem 1rem;
}

.modal-close {
  color: white;
  opacity: 0.8;
  font-size: 2rem;
}

.modal-close:hover {
  opacity: 1;
}

.modal-body {
  padding: 1.5rem;
  max-height: 70vh;
  overflow-y: auto;
}

.incident-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem 1.5rem;
  margin-bottom: 1.5rem;
}

.detail-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-group.full-width {
  grid-column: span 2;
}

.detail-group label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
}

.detail-group p, .description-box {
  font-size: 0.9rem;
  color: #1e293b;
  margin: 0;
  word-break: break-word;
}

.mono {
  font-family: monospace;
  font-size: 0.85rem;
}

.description-box {
  background: #f8fafc;
  padding: 0.75rem;
  border-radius: 0.5rem;
  border-left: 3px solid #f97316;
  line-height: 1.5;
}

.media-section {
  margin-top: 1.5rem;
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
}

.media-section h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
}

.media-card {
  position: relative;
  border-radius: 0.75rem;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 1 / 1;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  transition: transform 0.2s, box-shadow 0.2s;
}

.media-card:hover {
  transform: scale(1.02);
  box-shadow: 0 8px 20px rgba(0,0,0,0.15);
}

.media-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.media-card.video-card {
  aspect-ratio: 16 / 9;
}

.media-card video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.6);
  color: white;
  text-align: center;
  padding: 0.25rem;
  font-size: 1rem;
  opacity: 0;
  transition: opacity 0.2s;
}

.media-card:hover .media-overlay {
  opacity: 1;
}

.ai-section {
  margin-top: 1.5rem;
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
}

.ai-section h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 0.75rem;
}

.ai-content {
  background: #f8fafc;
  border-radius: 0.75rem;
  padding: 1rem;
  max-height: 300px;
  overflow-y: auto;
}

.ai-content pre {
  font-size: 0.75rem;
  font-family: 'Monaco', 'Menlo', monospace;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
  color: #1e293b;
}

.modal-footer-actions {
  padding: 1rem 1.5rem;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
}

.btn-modal-close {
  background: white;
  border: 1px solid #cbd5e1;
  padding: 0.5rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-modal-close:hover {
  background: #e2e8f0;
}

/* Responsive */
@media (max-width: 640px) {
  .incident-detail-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .detail-group.full-width {
    grid-column: span 1;
  }
  .media-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
  .modal-body {
    padding: 1rem;
  }
}
.badge {
  position: absolute;
  top: 8px;
  right: 12px;
  background: #f97316;
  color: white;
  font-size: 0.7rem;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}
.other-responder-marker div {
  animation: pulseBlue 1.5s infinite;
}
@keyframes pulseBlue {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

.announcement-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.action-btn {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s;
}

.action-btn:hover {
  background: #eef2ff;
  border-color: #2a5298;
}

.image-btn {
  color: #1e3c72;
}

.map-btn {
  color: #2a5298;
}

.vehicle-tag {
  display: inline-block;
  background: #eef2ff;
  color: #1e40af;
  padding: 0.25rem 0.75rem;
  border-radius: 2rem;
  font-size: 0.75rem;
  font-weight: 500;
  margin-right: 0.5rem;
  margin-top: 0.5rem;
  border: 1px solid #dbeafe;
  transition: all 0.2s;
}
.vehicle-tag:hover {
  background: #e0e7ff;
  transform: translateY(-1px);
}
</style>
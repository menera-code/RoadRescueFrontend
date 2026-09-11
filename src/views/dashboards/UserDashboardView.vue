<script setup>
// ============================================================
//  IMPORTS
// ============================================================
import { computed, nextTick, onBeforeUnmount, ref, watch, onMounted, reactive } from "vue"
import { useRouter } from "vue-router"
import L from "leaflet"
import axios from "axios"
import 'leaflet-routing-machine'
import api from "@/api/client"
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import calapanLogo from "@/assets/logos/calapan.png"


// ============================================================
//  HELPERS: IMAGE URLS & FALLBACK
// ============================================================
const FALLBACK_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150' viewBox='0 0 200 150'%3E%3Crect width='200' height='150' fill='%23f1f5f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='14' fill='%23999'%3ENo image%3C/text%3E%3C/svg%3E"

function getFullImageUrl(path) {
  if (!path) return ''
  if (path.startsWith('http')) return path
  let base = api.defaults.baseURL || ''
  if (base.endsWith('/')) base = base.slice(0, -1)
  let cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `${base}/${cleanPath}`
}

// ============================================================
//  ROUTER, AUTH & GLOBAL STATE
// ============================================================
const router = useRouter()
const active = ref("overview")
const role = "Citizen"
const roleClass = computed(() => "role-user")
const token = localStorage.getItem("access_token")
const windowWidth = ref(0)
const mobileMenuOpen = ref(false)

const logout = async () => {
  try {
    await api.post("/auth/logout")
  } catch (error) {
    console.error("Logout API error:", error)
  } finally {
    localStorage.removeItem("access_token")
    localStorage.removeItem("admin_token")
    router.push("/")
  }
}

const go = async (key) => {
  active.value = key
  await nextTick()
  switch (key) {
    case "map":
      initMap()
      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 300);
      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 600);
      break
    case "report":
      await useCurrentLocationForReport()
      break
    case "chat":
      loadChatHistoryList()
      chatbotScrollToBottom()
      break
    case "myreports":
      await loadMyReports()
      break
    case "announcements":
      fetchActiveAlerts()
      break
    case "legal":
      await loadLegalCompliances()
      break
  }
}

// ============================================================
//  PROFILE
// ============================================================
const defaultAvatar = "https://ui-avatars.com/api/?background=0b4fa3&color=fff&size=256&name=User"
const avatarPreview = ref(null)

const avatarUrl = computed(() => {
  if (avatarPreview.value) return avatarPreview.value
  if (profile.value.profile_photo) {
    let base = api.defaults.baseURL || ""
    if (base.endsWith("/")) base = base.slice(0, -1)
    let photoPath = profile.value.profile_photo
    if (photoPath.startsWith("/")) photoPath = photoPath.slice(1)
    return `${base}/${photoPath}`
  }
  return defaultAvatar
})

const profile = ref({
  full_name: "",
  email: "",
  role: "",
  contact_number: "",
  barangay: "",
  address: "",
  emergency_contact_name: "",
  emergency_contact_number: "",
  profile_photo: null,
})

const loadProfile = async () => {
  try {
    const res = await api.get("/api/profile")
    profile.value = res.data
  } catch (error) {
    console.error("Failed to load profile from /api/profile:", error)
    try {
      const fallback = await api.get("/me")
      profile.value = {
        id: fallback.data.id,
        full_name: fallback.data.full_name,
        email: fallback.data.email,
        role: fallback.data.role,
        contact_number: "",
        barangay: "",
        address: "",
        emergency_contact_name: "",
        emergency_contact_number: "",
        profile_photo: null,
      }
    } catch (finalError) {
      console.error("All profile endpoints failed – using mock data")
      profile.value = {
        full_name: "Guest User",
        email: "guest@resqapp.local",
        role: "citizen",
        contact_number: "",
        barangay: "",
        address: "",
        emergency_contact_name: "",
        emergency_contact_number: "",
        profile_photo: null,
      }
    }
  }
}

const saveProfile = async () => {
  try {
    await api.put("/api/profile", {
      full_name: profile.value.full_name,
      contact_number: profile.value.contact_number,
      barangay: profile.value.barangay,
      address: profile.value.address,
      emergency_contact_name: profile.value.emergency_contact_name,
      emergency_contact_number: profile.value.emergency_contact_number,
    })
    alert("Profile updated successfully")
  } catch (error) {
    console.error("Profile update failed:", error)
    alert("Failed to update profile. Please try again.")
  }
}

const onAvatarChange = async (event) => {
  const file = event.target.files[0]
  if (!file) return
  avatarPreview.value = URL.createObjectURL(file)
  const formData = new FormData()
  formData.append("file", file)
  try {
    await api.post("/api/profile/avatar", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    await loadProfile()
  } catch (error) {
    console.error("Avatar upload failed:", error)
    alert("Failed to upload avatar. Please try again.")
  }
}

// ============================================================
//  MY REPORTS
// ============================================================
const myReports = ref([])
const loadingMyReports = ref(false)
const selectedReport = ref(null)
const showReportModal = ref(false)
const loadingReportDetails = ref(false)
const reportSearchQuery = ref("")
const reportStatusFilter = ref("all")

const incidentRouteData = ref(null)               // store route geometry and duration
let incidentRouteLayer = null                     // Leaflet layer for the route
const severityColors = {
  critical: "#dc2626",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#10b981",
}

const filteredReports = computed(() => {
  if (!myReports.value) return []
  let reports = myReports.value
  if (reportSearchQuery.value) {
    const q = reportSearchQuery.value.toLowerCase()
    reports = reports.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.incident_type?.toLowerCase().includes(q) ||
        r.barangay?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    )
  }
  if (reportStatusFilter.value !== "all") {
    reports = reports.filter((r) => r.status === reportStatusFilter.value)
  }
  return reports
})

const reportStats = computed(() => {
  const total = myReports.value.length
  const pending = myReports.value.filter((r) => r.status === "pending").length
  const inProgress = myReports.value.filter((r) => r.status === "in-progress").length
  const resolved = myReports.value.filter((r) => r.status === "resolved").length
  return { total, pending, inProgress, resolved }
})

const loadMyReports = async () => {
  loadingMyReports.value = true
  try {
    const response = await api.get("/api/reports/my")
    myReports.value = response.data
  } catch (error) {
    console.error("Failed to load my reports:", error)
  } finally {
    loadingMyReports.value = false
  }
}

// Incident detail map
let incidentMapInstance = null
let incidentMapMarkers = []
let responderLocationInterval = null

const etaText = (incident) => {
  // If we have route data, use its duration
  if (incidentRouteData.value?.duration) {
    const seconds = incidentRouteData.value.duration
    const mins = Math.ceil(seconds / 60)
    if (mins < 1) return 'Less than 1 min'
    if (mins < 60) return `${mins} min`
    const hours = Math.floor(mins / 60)
    const remMins = mins % 60
    return `${hours}h ${remMins}m`
  }
  // Fallback: straight‑line distance
  if (!incident?.responderLocation) return 'N/A'
  const dist = haversineDistance(
    incident.latitude,
    incident.longitude,
    incident.responderLocation.lat,
    incident.responderLocation.lng
  )
  const mins = Math.round(dist / 500)
  if (mins < 1) return 'Less than 1 min'
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hours}h ${remMins}m`
}

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000
  const toRad = (deg) => deg * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
const fetchRouteForIncident = async (startLat, startLng, endLat, endLng) => {
  try {
    const response = await api.post('/api/route/calculate', {
      start_lat: startLat,
      start_lng: startLng,
      dest_lat: endLat,
      dest_lng: endLng,
      profile: 'driving'   // use 'foot' if needed
    })
    if (response.data.success && response.data.geometry) {
      incidentRouteData.value = {
        geometry: response.data.geometry,
        distance: response.data.distance,
        duration: response.data.duration,
      }
      drawRouteOnMap(incidentRouteData.value)
      return true
    }
    return false
  } catch (e) {
    console.warn('Route fetch failed, using straight line:', e)
    return false
  }
}

const drawRouteOnMap = (routeData) => {
  if (!incidentMapInstance || !routeData?.geometry) return
  // Remove any existing route layer
  if (incidentRouteLayer) {
    incidentMapInstance.removeLayer(incidentRouteLayer)
    incidentRouteLayer = null
  }
  // Add the new route
  incidentRouteLayer = L.geoJSON(routeData.geometry, {
    style: {
      color: '#f97316',
      weight: 4,
      opacity: 0.8,
      dashArray: '10, 8'
    }
  }).addTo(incidentMapInstance)
}
const initIncidentMap = (retries = 3) => {
  const el = document.getElementById("incident-map")
  if (!el) {
    console.warn("⚠️ incident-map element not found")
    return
  }

  if (el.offsetParent === null && retries > 0) {
    console.warn("⚠️ Map container is hidden, retrying...")
    setTimeout(() => initIncidentMap(retries - 1), 200)
    return
  }
  if (el.offsetHeight === 0 && retries > 0) {
    console.warn("⚠️ Map container has zero height, retrying...")
    setTimeout(() => initIncidentMap(retries - 1), 200)
    return
  }

  // Destroy previous instance
  if (incidentMapInstance) {
    incidentMapInstance.remove()
    incidentMapInstance = null
    incidentMapMarkers = []
    incidentRouteLayer = null
    incidentRouteData.value = null
  }

  const incident = selectedReport.value
  const userLoc = currentLocation.value
  const respLoc = incident?.responderLocation

  if (!incident || !incident.latitude || !incident.longitude) {
    console.warn("⚠️ No incident coordinates")
    return
  }

  // Fix Leaflet icons
  delete L.Icon.Default.prototype._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  })

  incidentMapInstance = L.map(el, {
    center: [incident.latitude, incident.longitude],
    zoom: 14,
    zoomControl: true,
  })

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(incidentMapInstance)

  // Incident marker
  const incidentIcon = L.divIcon({
    className: "custom-marker",
    html: '<div style="background:#dc2626;width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 2px #dc2626;"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
  L.marker([incident.latitude, incident.longitude], { icon: incidentIcon })
    .addTo(incidentMapInstance)
    .bindPopup("Incident location")
    .openPopup()

  // User location
  if (userLoc && userLoc.lat && userLoc.lng) {
    const userIcon = L.divIcon({
      className: "custom-marker",
      html: '<div style="background:#10b981;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 2px #10b981;"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
    L.marker([userLoc.lat, userLoc.lng], { icon: userIcon })
      .addTo(incidentMapInstance)
      .bindPopup("Your current location")
  }

  // Responder location
  if (respLoc && respLoc.lat && respLoc.lng) {
    const respIcon = L.divIcon({
      className: "custom-marker",
      html: '<div style="background:#f97316;width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 2px #f97316;display:flex;align-items:center;justify-content:center;font-size:12px;">🚑</div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    })
    L.marker([respLoc.lat, respLoc.lng], { icon: respIcon })
      .addTo(incidentMapInstance)
      .bindPopup(`Responder (last update: ${new Date(respLoc.updated_at).toLocaleTimeString()})`)

    // 👉 NOW fetch the road route
    fetchRouteForIncident(
      respLoc.lat,
      respLoc.lng,
      incident.latitude,
      incident.longitude
    )
  }

  // Fit bounds
  const latlngs = []
  if (incident.latitude && incident.longitude) latlngs.push([incident.latitude, incident.longitude])
  if (userLoc?.lat && userLoc?.lng) latlngs.push([userLoc.lat, userLoc.lng])
  if (respLoc?.lat && respLoc?.lng) latlngs.push([respLoc.lat, respLoc.lng])
  if (latlngs.length > 1) {
    incidentMapInstance.fitBounds(latlngs, { padding: [50, 50] })
  }

  setTimeout(() => incidentMapInstance?.invalidateSize(), 200)
}
const viewReportDetails = async (reportId) => {
  loadingReportDetails.value = true
  showReportModal.value = true

  if (responderLocationInterval) {
    clearInterval(responderLocationInterval)
    responderLocationInterval = null
  }

  try {
    const [detailsRes, mediaRes] = await Promise.all([
      api.get(`/api/reports/${reportId}`),
      api.get(`/admin/incidents/${reportId}/media-analysis`),
    ])

    let responderLocation = null
    if (detailsRes.data.assigned_to) {
      console.log("🔍 Fetching responder location for ID:", detailsRes.data.assigned_to)
      try {
        const locRes = await api.get(`/api/responder/location/${detailsRes.data.assigned_to}`)
        console.log("📡 Responder location raw response:", locRes.data)
        if (locRes.data && locRes.data.exists !== false && locRes.data.lat && locRes.data.lng) {
          responderLocation = locRes.data
          console.log("✅ Responder location found:", responderLocation)
        } else {
          console.warn("⚠️ Responder location not available or incomplete")
        }
      } catch (e) {
        console.error("❌ Failed to fetch responder location:", e)
        // Show a more user-friendly message in the UI
        locationFetchError.value = true
      }
    }

    selectedReport.value = {
      ...detailsRes.data,
      ...mediaRes.data,
      responderLocation,
    }

    // Wait for the modal to be fully rendered and visible
    await nextTick()
    // Give the modal time to appear and the container to get dimensions
    setTimeout(() => {
      if (selectedReport.value) {
        initIncidentMap()
      }
    }, 350) // increased delay

    if (detailsRes.data.assigned_to) {
      responderLocationInterval = setInterval(async () => {
        try {
          const locRes = await api.get(`/api/responder/location/${detailsRes.data.assigned_to}`)
          if (locRes.data.exists !== false && locRes.data.lat && locRes.data.lng) {
            selectedReport.value.responderLocation = locRes.data
            initIncidentMap()   // this will re‑draw markers and fetch the new route
          }
        } catch (e) {
          // silent
        }
      }, 30000)
    }
  } catch (error) {
    console.error("Failed to load report details:", error)
    alert("Could not load report details")
    showReportModal.value = false
  } finally {
    loadingReportDetails.value = false
  }
}

const refreshingLocation = ref(false)
const locationFetchError = ref(false)

const refreshResponderLocation = async () => {
  if (!selectedReport.value?.assigned_to) {
    showNotification("No responder assigned to this incident", "warning")
    return
  }
  refreshingLocation.value = true
  try {
    const locRes = await api.get(`/api/responder/location/${selectedReport.value.assigned_to}`)
    console.log("🔄 Manual refresh response:", locRes.data)
    if (locRes.data && locRes.data.exists !== false && locRes.data.lat && locRes.data.lng) {
      selectedReport.value.responderLocation = locRes.data
      locationFetchError.value = false
      initIncidentMap()
      showNotification("✅ Responder location updated!", "success")
    } else {
      locationFetchError.value = true
      showNotification("⚠️ Responder has not shared location yet", "warning")
    }
  } catch (e) {
    console.error("❌ Refresh failed:", e)
    showNotification("Failed to refresh location", "error")
  } finally {
    refreshingLocation.value = false
  }
}
// Helper functions for reports
const severityIcon = (severity) => {
  const icons = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" }
  return icons[severity?.toLowerCase()] || "⚪"
}
const statusIcon = (status) => {
  const icons = { pending: "⏳", "in-progress": "🔄", resolved: "✅" }
  return icons[status] || "📋"
}
const formatDate = (dateString) => {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
const statusClass = (status) => {
  switch (status) {
    case "resolved":
      return "ok"
    case "in-progress":
      return "warn"
    default:
      return ""
  }
}

// ============================================================
//  CHATBOT
// ============================================================
const chatbotMessages = ref([])
const chatbotInput = ref("")
const chatbotLoading = ref(false)
const showQuickReplies = ref(true)
const quickReplies = ref(["How do I report an incident?", "Emergency contact numbers", "Traffic situation in Calapan"])
const chatHistoryList = ref([])
const selectedChatId = ref(null)
const showHistorySidebar = ref(false)
const chatInput = ref(null)
const isUserAtBottom = ref(true)

// Chat history helpers
const saveChatHistory = () => {
  try {
    localStorage.setItem("chatbotHistory", JSON.stringify(chatbotMessages.value))
  } catch (e) {
    console.warn("Could not save chat history:", e)
  }
}

const formatChatTime = (isoString) => {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString([], { month: "short", day: "numeric" })
  } catch (e) {
    return "Recently"
  }
}

const loadChatHistory = async () => {
  try {
    console.log("Loading chat history from backend...")
    const response = await api.get("/chat/history?limit=50")
    console.log("Backend response:", response.data)
    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      chatbotMessages.value = response.data.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }))
      showQuickReplies.value = chatbotMessages.value.length <= 1
    } else {
      const savedHistory = JSON.parse(localStorage.getItem("chatbotHistory"))
      if (savedHistory && savedHistory.length > 0) {
        chatbotMessages.value = savedHistory
        showQuickReplies.value = savedHistory.length <= 1
      } else {
        chatbotMessages.value = [
          {
            role: "assistant",
            content: "Hello 👋 I'm RESQAPP Assistant. How can I help you with emergency services in Calapan City today?",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]
        showQuickReplies.value = true
      }
    }
  } catch (error) {
    console.error("Failed to load chat history from backend:", error)
    const savedHistory = JSON.parse(localStorage.getItem("chatbotHistory"))
    if (savedHistory && savedHistory.length > 0) {
      chatbotMessages.value = savedHistory
      showQuickReplies.value = savedHistory.length <= 1
    } else {
      chatbotMessages.value = [
        {
          role: "assistant",
          content: "Hello 👋 I'm RESQAPP Assistant. How can I help you today?",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]
      showQuickReplies.value = true
    }
  }
}

const clearChatHistory = async () => {
  if (confirm("Clear all chat history (both local and server)?")) {
    try {
      await api.delete("/chat/history")
    } catch (error) {
      console.error("Could not clear server history:", error)
    }
    localStorage.removeItem("chatbotHistory")
    chatbotMessages.value = [
      {
        role: "assistant",
        content: "Chat history cleared. How can I help you today?",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]
    showQuickReplies.value = true
  }
}

const sendChatbotMessage = async () => {
  const userMessage = chatbotInput.value.trim()
  if (!userMessage || chatbotLoading.value) return

  const token = localStorage.getItem("access_token")
  if (!token) {
    alert("Please log in again")
    router.push("/")
    return
  }

  if (showQuickReplies.value) showQuickReplies.value = false

  chatbotMessages.value.push({
    role: "user",
    content: userMessage,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  })
  chatbotInput.value = ""
  chatbotLoading.value = true
  adjustTextareaHeight()
  chatbotScrollToBottom()

  try {
    console.log("Sending chat message with token:", token.substring(0, 20) + "...")
    const response = await api.post("/chat/message", {
      message: userMessage,
      conversation_history: chatbotMessages.value.slice(0, -1),
    })
    console.log("Chat response received:", response.data)

    chatbotMessages.value.push({
      role: "assistant",
      content: response.data.content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })

    if (response.data.quick_replies && response.data.quick_replies.length > 0) {
      quickReplies.value = response.data.quick_replies
    }
    saveToHistoryList()
    saveChatHistory()
  } catch (error) {
    console.error("Chatbot error details:", {
      status: error.response?.status,
      data: error.response?.data,
      headers: error.response?.headers,
    })

    let fallbackResponse = ""
    if (error.response?.status === 401) {
      fallbackResponse = "Session expired. Please log in again."
      setTimeout(() => {
        localStorage.removeItem("access_token")
        router.push("/")
      }, 2000)
    } else if (error.response?.status === 500) {
      fallbackResponse = "AI service is temporarily unavailable. Please try again later."
    } else {
      const lowerMessage = userMessage.toLowerCase()
      if (lowerMessage.includes("report") || lowerMessage.includes("incident")) {
        fallbackResponse =
          "To report an incident, go to 'Create Report' in your dashboard. For emergencies, call 911 or Calapan Rescue at 288-1111."
      } else if (lowerMessage.includes("emergency") || lowerMessage.includes("help")) {
        fallbackResponse =
          "Emergency contacts: 🚒 Fire (288-3333) | 🚓 Police (288-4444) | 🚑 Rescue (288-1111). For immediate danger, call 911."
      } else if (lowerMessage.includes("traffic") || lowerMessage.includes("road")) {
        fallbackResponse = "For traffic updates in Calapan, contact City Traffic Management at 288-2222."
      } else {
        fallbackResponse = "I'm having trouble connecting to the AI service. Please try again in a moment."
      }
    }

    chatbotMessages.value.push({
      role: "assistant",
      content: fallbackResponse,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })
    saveToHistoryList()
    saveChatHistory()
  } finally {
    chatbotLoading.value = false
    chatbotScrollToBottom()
  }
}

const useQuickReply = (text) => {
  chatbotInput.value = text
  sendChatbotMessage()
}

const adjustTextareaHeight = () => {
  nextTick(() => {
    const el = chatInput.value
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  })
}

const handleKeyDown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    sendChatbotMessage()
  }
}

const chatbotScrollToBottom = () => {
  if (!isUserAtBottom.value) return
  nextTick(() => {
    const el = document.querySelector(".chatbot-messages")
    if (el) el.scrollTop = el.scrollHeight
  })
}

const loadChatHistoryList = async () => {
  try {
    const savedList = JSON.parse(localStorage.getItem("chatHistoryList") || "[]")
    chatHistoryList.value = savedList
    if (selectedChatId.value) {
      loadSelectedChat()
    }
  } catch (error) {
    console.error("Error loading chat history list:", error)
  }
}

const saveToHistoryList = () => {
  try {
    if (chatbotMessages.value.length <= 1) return
    const existingList = JSON.parse(localStorage.getItem("chatHistoryList") || "[]")
    const firstUserMessage = chatbotMessages.value.find((msg) => msg.role === "user")
    const summary = firstUserMessage
      ? firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? "..." : "")
      : "New Chat"
    const timestamp = new Date().toISOString()

    if (selectedChatId.value) {
      const chatIndex = existingList.findIndex((chat) => chat.id === selectedChatId.value)
      if (chatIndex !== -1) {
        existingList[chatIndex] = {
          ...existingList[chatIndex],
          summary,
          timestamp,
          messageCount: chatbotMessages.value.length,
          messages: [...chatbotMessages.value],
        }
      }
    } else {
      const newChat = {
        id: Date.now().toString(),
        summary,
        timestamp,
        messageCount: chatbotMessages.value.length,
        messages: [...chatbotMessages.value],
      }
      existingList.unshift(newChat)
      selectedChatId.value = newChat.id
    }
    localStorage.setItem("chatHistoryList", JSON.stringify(existingList))
    chatHistoryList.value = existingList
  } catch (error) {
    console.error("Error saving to history list:", error)
  }
}

const loadSelectedChat = (chatId = null) => {
  try {
    if (chatId) selectedChatId.value = chatId
    const existingList = JSON.parse(localStorage.getItem("chatHistoryList") || "[]")
    const selectedChat = existingList.find((chat) => chat.id === selectedChatId.value)
    if (selectedChat && selectedChat.messages) {
      chatbotMessages.value = selectedChat.messages.map((msg) => ({
        ...msg,
        timestamp: msg.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }))
      showQuickReplies.value = chatbotMessages.value.length <= 1
    }
    if (windowWidth.value < 768) showHistorySidebar.value = false
    chatbotScrollToBottom()
  } catch (error) {
    console.error("Error loading selected chat:", error)
  }
}

const createNewChat = () => {
  selectedChatId.value = null
  chatbotMessages.value = [
    {
      role: "assistant",
      content: "Hello 👋 I'm RESQAPP Assistant. How can I help you with emergency services in Calapan City today?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]
  showQuickReplies.value = true
  quickReplies.value = ["How do I report an incident?", "Emergency contact numbers", "Traffic situation in Calapan"]
  if (windowWidth.value < 768) showHistorySidebar.value = false
}

const deleteChatFromHistory = (chatId, event) => {
  event.stopPropagation()
  if (confirm("Delete this chat from history?")) {
    try {
      const existingList = JSON.parse(localStorage.getItem("chatHistoryList") || "[]")
      const filteredList = existingList.filter((chat) => chat.id !== chatId)
      localStorage.setItem("chatHistoryList", JSON.stringify(filteredList))
      chatHistoryList.value = filteredList
      if (selectedChatId.value === chatId) createNewChat()
    } catch (error) {
      console.error("Error deleting chat:", error)
    }
  }
}

const setupScrollListener = () => {
  const el = document.querySelector(".chatbot-messages")
  if (el) {
    el.addEventListener("scroll", () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      isUserAtBottom.value = atBottom
    })
  }
}

// ============================================================
//  WEBSOCKET & REAL-TIME
// ============================================================
let ws = null
let pollingInterval = null
const wsConnected = ref(false)
const wsReconnectAttempts = ref(0)
const maxReconnectAttempts = 5
const reconnectDelay = ref(3000)
const lastPongTime = ref(null)
const pingInterval = ref(null)
const realTimeEnabled = ref(false)
const realTimeInterval = ref(null)
const trafficUpdates = ref([])
const liveTraffic = ref(null)
const userPosition = ref(null)
const positionWatchId = ref(null)
const alternativeRoutes = ref([])
const bestAlternative = ref(null)
const routeAlerts = ref([])
const eta = ref(null)
const etaUpdateTimer = ref(null)

const connectWebSocket = () => {
  const token = localStorage.getItem("access_token")
  if (!token) {
    console.warn("No access token available for WebSocket connection")
    return
  }
  const extractUserIdFromToken = (token) => {
    try {
      const base64Url = token.split(".")[1]
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
      const payload = JSON.parse(atob(base64))
      return payload.sub
    } catch (error) {
      console.error("Failed to decode token:", error)
      return null
    }
  }
  const userId = extractUserIdFromToken(token)
  if (!userId) {
    console.warn("Could not extract user ID from token")
    return
  }
  if (wsReconnectAttempts.value >= maxReconnectAttempts) {
    console.warn("Max WebSocket reconnection attempts reached")
    return
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "Reconnecting")
  }

  // ✅ CORRECT – use the backend host from api.defaults.baseURL
  const apiBase = api.defaults.baseURL              // e.g., 'https://roadrescue-api.onrender.com'
  const url = new URL(apiBase)
  const wsHost = url.host                           // e.g., 'roadrescue-api.onrender.com'
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${wsHost}/ws/route/${userId}?token=${token}`
  console.log("Connecting to WebSocket:", wsUrl)

  ws = new WebSocket(wsUrl)
  ws.onopen = () => {
    console.log("✅ WebSocket connected successfully")
    wsConnected.value = true
    wsReconnectAttempts.value = 0
    reconnectDelay.value = 3000
    lastPongTime.value = Date.now()
    sendWebSocketMessage("ping", { initial: true, timestamp: new Date().toISOString() })
  }
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log("WebSocket message received:", data)
      handleWebSocketMessage(data)
    } catch (error) {
      console.error("Failed to parse WebSocket message:", error)
    }
  }
  ws.onclose = (event) => {
    console.log("WebSocket disconnected. Code:", event.code, "Reason:", event.reason)
    wsConnected.value = false
    stopPingInterval()
    if (event.code === 1000) {
      console.log("WebSocket closed normally")
      return
    }
    wsReconnectAttempts.value++
    if (wsReconnectAttempts.value <= maxReconnectAttempts) {
      console.log(
        `Attempting to reconnect (${wsReconnectAttempts.value}/${maxReconnectAttempts}) in ${reconnectDelay.value}ms`
      )
      setTimeout(() => {
        reconnectDelay.value = Math.min(reconnectDelay.value * 2, 30000)
        connectWebSocket()
      }, reconnectDelay.value)
    } else {
      console.warn("Max reconnection attempts reached. Switching to HTTP polling.")
      startHTTPPolling()
    }
  }
  ws.onerror = (error) => {
    console.error("WebSocket error:", error)
    wsConnected.value = false
  }
}
const handleWebSocketMessage = (data) => {
  const messageType = data.type
  switch (messageType) {
    case "traffic_update":
      if (data.data) {
        liveTraffic.value = data.data
        if (data.data.ai_prediction) {
          console.log("AI traffic prediction received:", data.data.ai_prediction)
          if (data.data.ai_prediction.recommendations) {
            const newRecommendations = data.data.ai_prediction.recommendations
            aiRecommendations.value = [
              ...aiRecommendations.value,
              ...newRecommendations.filter((rec) => !aiRecommendations.value.includes(rec)),
            ]
          }
        }
        if (realTimeEnabled.value && routeLayer) {
          updateRouteWithLiveTraffic()
        }
        if (data.data.traffic_level === "high") {
          const aiTip = data.data.ai_prediction?.recommendations?.[0] || "Consider alternate route"
          showNotification(`🚨 Heavy traffic detected! Tip: ${aiTip}`, "warning")
        }
      }
      break
    case "ai_insights":
      console.log("AI insights received:", data.insights)
      if (data.insights) {
        const newRecommendations = data.insights.recommendations || []
        if (Array.isArray(newRecommendations) && newRecommendations.length > 0) {
          aiRecommendations.value = [
            ...aiRecommendations.value,
            ...newRecommendations.filter((rec) => !aiRecommendations.value.includes(rec)),
          ]
          showNotification("🤖 AI has new insights for your route", "info")
        }
      }
      break
    case "position_updated":
      console.log("Position updated:", data)
      break
    case "pong":
      lastPongTime.value = Date.now()
      break
    case "ping":
      sendWebSocketMessage("pong", { received_at: new Date().toISOString(), client_time: Date.now() })
      break
    case "connected":
      console.log("WebSocket connected:", data.message)
      showNotification(data.message, "success")
      startPingInterval()
      break
    case "subscribed":
      console.log("Subscribed to updates:", data.message)
      break
    case "nearby_users":
      console.log("Nearby users:", data.nearby)
      break
    default:
      console.log("Unknown WebSocket message type:", messageType, "data:", data)
  }
}

const startPingInterval = () => {
  if (pingInterval.value) clearInterval(pingInterval.value)
  pingInterval.value = setInterval(() => {
    if (ws && wsConnected.value && ws.readyState === WebSocket.OPEN) {
      sendWebSocketMessage("ping", { timestamp: new Date().toISOString(), client_id: "resqapp_frontend" })
    }
  }, 25000)
  const healthCheckInterval = setInterval(() => {
    if (!wsConnected.value) return
    if (lastPongTime.value && Date.now() - lastPongTime.value > 35000) {
      console.warn("No pong received, reconnecting WebSocket...")
      clearInterval(healthCheckInterval)
      connectWebSocket()
    }
  }, 30000)
}

const stopPingInterval = () => {
  if (pingInterval.value) {
    clearInterval(pingInterval.value)
    pingInterval.value = null
  }
}

const sendWebSocketMessage = (type, data = {}) => {
  if (ws && wsConnected.value && ws.readyState === WebSocket.OPEN) {
    const message = { type, ...data, timestamp: new Date().toISOString() }
    ws.send(JSON.stringify(message))
    return true
  }
  return false
}

const sendPositionUpdate = (lat, lng, accuracy = null) => {
  return sendWebSocketMessage("position_update", { lat, lng, accuracy })
}

const subscribeToTrafficUpdates = (routeId) => {
  return sendWebSocketMessage("subscribe_traffic", { route_id: routeId })
}

const startHTTPPolling = () => {
  if (pollingInterval) clearInterval(pollingInterval)
  console.log("Starting HTTP polling fallback")
  pollingInterval = setInterval(async () => {
    if (!realTimeEnabled.value || !routeStart.value || !routeDestination.value) return
    try {
      const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
      const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
      const response = await api.post("/api/route/live-traffic", {
        start_lat: startCoords[0],
        start_lng: startCoords[1],
        dest_lat: destCoords[0],
        dest_lng: destCoords[1],
      })
      if (response.data.success) {
        liveTraffic.value = response.data.traffic_data
        if (routeLayer) updateRouteWithLiveTraffic()
      }
    } catch (error) {
      console.error("HTTP polling error:", error)
    }
  }, 30000)
}

// Real-time functions
const enableRealTime = async () => {
  if (!routeStart.value || !routeDestination.value) {
    alert("Please set start and destination points first")
    return
  }
  realTimeEnabled.value = true
  mapStatus.value = "🔄 Starting real-time route monitoring..."
  try {
    if (wsConnected.value) {
      console.log("Using WebSocket for real-time updates")
      const routeId = `route_${Date.now()}`
      subscribeToTrafficUpdates(routeId)
    } else {
      console.log("WebSocket not available, using HTTP polling")
      startHTTPPolling()
    }
    if (routeStart.value.includes("Current")) {
      startPositionTracking()
    }
    showNotification("Real-time routing enabled!", "success")
  } catch (error) {
    console.error("Failed to enable real-time:", error)
    realTimeEnabled.value = false
    showNotification("Failed to enable real-time features", "error")
  }
}

const disableRealTime = () => {
  realTimeEnabled.value = false
  if (realTimeInterval.value) clearInterval(realTimeInterval.value)
  if (etaUpdateTimer.value) clearInterval(etaUpdateTimer.value)
  if (positionWatchId.value) navigator.geolocation.clearWatch(positionWatchId.value)
  if (wsConnected.value) sendWebSocketMessage("unsubscribe")
  if (pollingInterval) clearInterval(pollingInterval)
  mapStatus.value = "Real-time monitoring stopped"
  showNotification("Real-time updates disabled", "info")
}

const updateLiveTraffic = async () => {
  if (!realTimeEnabled.value || !routeStart.value || !routeDestination.value) return
  try {
    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    const response = await api.post("/api/route/live-traffic", {
      start_lat: startCoords[0],
      start_lng: startCoords[1],
      dest_lat: destCoords[0],
      dest_lng: destCoords[1],
    })
    if (response.data.success) {
      liveTraffic.value = response.data.traffic_data
      trafficUpdates.value.unshift({ ...response.data.traffic_data, timestamp: new Date().toISOString() })
      if (trafficUpdates.value.length > 10) trafficUpdates.value = trafficUpdates.value.slice(0, 10)
      updateRouteWithLiveTraffic()
      if (response.data.alerts && response.data.alerts.length > 0) {
        routeAlerts.value = response.data.alerts
        showTrafficAlerts(response.data.alerts)
      }
    }
  } catch (error) {
    console.error("Failed to update live traffic:", error)
  }
}

const updateRouteWithLiveTraffic = () => {
  if (!routeLayer || !liveTraffic.value) return
  let routeColor = "#0b4fa3"
  let dashArray = "10, 10"
  if (liveTraffic.value.traffic_level === "high") {
    routeColor = "#dc2626"
    dashArray = "5, 5"
  } else if (liveTraffic.value.traffic_level === "medium") {
    routeColor = "#f59e0b"
    dashArray = "10, 10"
  } else if (liveTraffic.value.traffic_level === "low") {
    routeColor = "#10b981"
    dashArray = "20, 10"
  }
  routeLayer.setStyle({ color: routeColor, weight: 6, opacity: 0.8, dashArray })
  mapStatus.value = `🚦 Live Traffic: ${liveTraffic.value.traffic_level.toUpperCase()} - Updated ${new Date().toLocaleTimeString()}`
}

const checkForBetterRoutes = async () => {
  if (!realTimeEnabled.value || !routeStart.value || !routeDestination.value) return
  try {
    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    const response = await api.post("/api/route/alternatives", {
      start_lat: startCoords[0],
      start_lng: startCoords[1],
      dest_lat: destCoords[0],
      dest_lng: destCoords[1],
      current_route_time: routeInfo.value?.duration || 0,
    })
    if (response.data.success && response.data.alternatives) {
      alternativeRoutes.value = response.data.alternatives
      const bestAlt = response.data.alternatives.find((alt) => alt.time_saving > 0)
      if (bestAlt) {
        bestAlternative.value = bestAlt
        if (bestAlt.time_saving > 60) {
          showNotification(`🚀 Better route found! Save ${Math.round(bestAlt.time_saving / 60)} minutes`, "success")
        }
      }
    }
  } catch (error) {
    console.error("Failed to check for better routes:", error)
  }
}

const updateETA = async () => {
  if (!realTimeEnabled.value || !routeInfo.value) return
  try {
    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    const response = await api.post("/api/route/eta", {
      start_lat: startCoords[0],
      start_lng: startCoords[1],
      dest_lat: destCoords[0],
      dest_lng: destCoords[1],
      original_duration: routeInfo.value.duration,
      traffic_level: liveTraffic.value?.traffic_level || "medium",
    })
    if (response.data.success) {
      eta.value = {
        original: routeInfo.value.duration,
        current: response.data.current_eta,
        delay: response.data.delay,
        updated_at: new Date().toISOString(),
      }
    }
  } catch (error) {
    console.error("Failed to update ETA:", error)
  }
}

const startPositionTracking = () => {
  if (!navigator.geolocation || positionWatchId.value) return
  positionWatchId.value = navigator.geolocation.watchPosition(
    (position) => {
      userPosition.value = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date().toISOString(),
      }
      if (marker) {
        marker.setLatLng([userPosition.value.lat, userPosition.value.lng])
        marker.bindPopup(`Your position<br>Accuracy: ${Math.round(userPosition.value.accuracy)}m`).openPopup()
      }
      sendPositionUpdate(userPosition.value.lat, userPosition.value.lng, userPosition.value.accuracy)
      if (realTimeEnabled.value) updateETA()
    },
    (error) => {
      console.error("Position tracking error:", error)
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
  )
}

const showTrafficAlerts = (alerts) => {
  alerts.forEach((alert) => {
    if (alert.severity === "high") {
      showNotification(`🚨 ${alert.message}`, "error")
    } else if (alert.severity === "medium") {
      showNotification(`⚠️ ${alert.message}`, "warning")
    }
  })
}

const stopRealTimeUpdates = () => {
  disableRealTime()
}

// ============================================================
//  LEGAL COMPLIANCE
// ============================================================
const legalCompliances = ref([])
const legalLoading = ref(false)
const legalSearch = ref("")
const selectedLegal = ref(null)
const showLegalDetailModal = ref(false)

const loadLegalCompliances = async () => {
  legalLoading.value = true
  try {
    const res = await api.get("/api/legal-compliances")
    legalCompliances.value = res.data
  } catch (e) {
    console.error("Failed to load legal compliances", e)
  } finally {
    legalLoading.value = false
  }
}

const filteredLegal = computed(() => {
  if (!legalSearch.value.trim()) return legalCompliances.value
  const q = legalSearch.value.toLowerCase()
  return legalCompliances.value.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      (e.law_number || "").toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q)
  )
})

const openLegalDetail = (entry) => {
  selectedLegal.value = entry
  showLegalDetailModal.value = true
}

const legalCategoryColor = (category) => {
  const map = {
    "Disaster Risk Reduction": { bg: "#fef3c7", text: "#92400e", border: "#f59e0b" },
    "Emergency Response": { bg: "#fee2e2", text: "#991b1b", border: "#ef4444" },
    "Traffic & Road Safety": { bg: "#dbeafe", text: "#1e40af", border: "#3b82f6" },
    "Public Health": { bg: "#d1fae5", text: "#065f46", border: "#10b981" },
    Environmental: { bg: "#ecfdf5", text: "#065f46", border: "#34d399" },
    "Criminal Justice": { bg: "#f3f4f6", text: "#1f2937", border: "#6b7280" },
    "Civil Protection": { bg: "#ede9fe", text: "#4c1d95", border: "#8b5cf6" },
  }
  return map[category] || { bg: "#f0f9ff", text: "#0c4a6e", border: "#0ea5e9" }
}

// ============================================================
//  MAP (MAIN)
// ============================================================
let map = null
let marker = null
let accuracyCircle = null
let routeLayer = null
let routingControl = ref(null)
const mapStatus = ref("Map ready.")
const locating = ref(false)
const DEFAULT_CENTER = [13.411, 121.181]
const DEFAULT_ZOOM = 13
const showRoutePanel = ref(false)
const routeStart = ref("")
const routeDestination = ref("")
const routeLoading = ref(false)
const routeError = ref("")
const routeInfo = ref(null)
const isSettingStart = ref(false)
const isSettingDestination = ref(false)
const autoCalculate = ref(true)
const debounceTimer = ref(null)
const useAI = ref(true)
const optimizationType = ref("fastest")
const routeInsights = ref(null)
const aiLoading = ref(false)
const showAIPanel = ref(false)
const aiInsights = ref(null)
const aiAvailable = ref(false)
const transportMode = ref("driving")
const availableModes = ref([
  { value: "driving", label: "🚗 Car", icon: "🚗", osrmProfile: "driving" },
  { value: "walking", label: "🚶 Walking", icon: "🚶", osrmProfile: "foot" },
  { value: "motorcycle", label: "🏍️ Motorcycle", icon: "🏍️", osrmProfile: "driving" },
])
const currentLocation = ref(null)
const mapRef = ref(null)

const calapanLocations = ref([
  { name: "Calapan City Hall", coords: [13.411, 121.181] },
  { name: "Calapan Port", coords: [13.415, 121.201] },
  { name: "Calapan Public Market", coords: [13.408, 121.189] },
  { name: "Oriental Mindoro Provincial Hospital", coords: [13.405, 121.175] },
  { name: "Calapan City Central School", coords: [13.412, 121.185] },
  { name: "Holy Infant Academy", coords: [13.409, 121.182] },
  { name: "Calapan City Plaza", coords: [13.410, 121.180] },
  { name: "SM City Calapan", coords: [13.418, 121.195] },
])

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

const invalidateSoon = () => {
  setTimeout(() => {
    try {
      map?.invalidateSize()
    } catch {}
  }, 120)
}

const setUserLocation = (lat, lng, accuracyMeters) => {
  if (!map) return
  const pos = [lat, lng]
  marker?.setLatLng(pos)
  marker?.bindPopup("Your location").openPopup()
  if (accuracyMeters && Number.isFinite(accuracyMeters)) {
    if (!accuracyCircle) {
      accuracyCircle = L.circle(pos, { radius: accuracyMeters }).addTo(map)
    } else {
      accuracyCircle.setLatLng(pos)
      accuracyCircle.setRadius(accuracyMeters)
    }
  }
  map.setView(pos, 17)
}

const useMyLocation = () => {
  if (!navigator.geolocation) {
    mapStatus.value = "Geolocation not supported on this device/browser."
    return
  }
  locating.value = true
  mapStatus.value = "Requesting location permission..."
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      const { latitude, longitude, accuracy } = pos.coords
      mapStatus.value = `Location found. Accuracy ~ ${Math.round(accuracy)}m.`
      setUserLocation(latitude, longitude, accuracy)
      setStartFromCoords(latitude, longitude)
    },
    (err) => {
      locating.value = false
      if (err.code === 1) mapStatus.value = "Location permission denied."
      else if (err.code === 2) mapStatus.value = "Location unavailable."
      else mapStatus.value = "Location request timed out."
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  )
}

// Route planning helper functions
const enableSetStartPoint = () => {
  isSettingStart.value = true
  isSettingDestination.value = false
  mapStatus.value = "Click on the map to set starting point"
}

const enableSetDestination = () => {
  isSettingDestination.value = true
  isSettingStart.value = false
  mapStatus.value = "Click on the map to set destination point"
}

const setupMapClickHandler = () => {
  if (!map) return
  map.on("click", (e) => {
    if (isSettingStart.value) {
      setStartFromCoords(e.latlng.lat, e.latlng.lng)
      isSettingStart.value = false
    } else if (isSettingDestination.value) {
      setDestinationFromCoords(e.latlng.lat, e.latlng.lng)
      isSettingDestination.value = false
    }
  })
}

const setStartFromCoords = (lat, lng) => {
  routeStart.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  if (window.startMarker) map.removeLayer(window.startMarker)
  window.startMarker = L.marker([lat, lng], {
    icon: L.icon({
      iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    }),
  })
    .addTo(map)
    .bindPopup("Start Point")
    .openPopup()
  mapStatus.value = "Start point set. Now set destination."
}

const setDestinationFromCoords = (lat, lng) => {
  routeDestination.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  if (window.destMarker) map.removeLayer(window.destMarker)
  window.destMarker = L.marker([lat, lng], {
    icon: L.icon({
      iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    }),
  })
    .addTo(map)
    .bindPopup("Destination")
    .openPopup()
  mapStatus.value = "Destination set. Click 'Calculate Route' to get directions."
}

const useCurrentLocationAsStart = async () => {
  if (!navigator.geolocation) {
    routeError.value = "Geolocation not supported"
    return
  }
  routeLoading.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords
      setStartFromCoords(latitude, longitude)
      routeLoading.value = false
    },
    (err) => {
      routeError.value = "Failed to get current location"
      routeLoading.value = false
    }
  )
}

const selectQuickLocation = (location, type) => {
  const coords = location.coords
  const coordString = `${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`
  if (type === "start") {
    routeStart.value = coordString
    setStartFromCoords(coords[0], coords[1])
  } else {
    routeDestination.value = coordString
    setDestinationFromCoords(coords[0], coords[1])
  }
}

const getRouteStyleForMode = (mode) => {
  const styles = {
    driving: { color: "#0b4fa3", weight: 6, dashArray: "10, 10" },
    walking: { color: "#10b981", weight: 4, dashArray: "5, 5" },
    motorcycle: { color: "#f59e0b", weight: 5, dashArray: "8, 8" },
    bus: { color: "#dc2626", weight: 6, dashArray: "15, 10" },
  }
  return styles[mode] || styles.driving
}

const formatDurationForMode = (seconds, mode) => {
  const minutes = Math.ceil(seconds / 60)
  if (mode === "walking") {
    if (minutes < 60) return `${minutes} min walk`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m walk`
  }
  return `${minutes} min`
}

const useOSRMFallback = (startCoords, destCoords, profile = "driving") => {
  try {
    if (routingControl.value) {
      map.removeControl(routingControl.value)
    }
    let osrmProfile = profile
    if (transportMode.value === "walking") osrmProfile = "foot"
    routingControl.value = L.Routing.control({
      waypoints: [L.latLng(startCoords[0], startCoords[1]), L.latLng(destCoords[0], destCoords[1])],
      router: L.Routing.osrmv1({
        serviceUrl: "https://router.project-osrm.org/route/v1",
        profile: osrmProfile,
      }),
      routeWhileDragging: false,
      showAlternatives: true,
      lineOptions: {
        styles: [{ color: getRouteStyleForMode(transportMode.value).color, weight: 5, opacity: 0.8 }],
      },
    }).addTo(map)
    const modeLabel = availableModes.value.find((m) => m.value === transportMode.value)?.label || "Route"
    mapStatus.value = `${modeLabel} (basic routing - live data unavailable)`
  } catch (error) {
    routeError.value = "Routing service unavailable"
  }
}

const calculateRoute = async (force = false) => {
  if ((!hasValidRoutePoints.value && !force) || routeLoading.value) return
  routeLoading.value = true
  routeError.value = ""
  routeInfo.value = null
  aiRecommendations.value = []
  aiInsights.value = null
  liveTraffic.value = null
  alternativeRoutes.value = []
  bestAlternative.value = null

  try {
    if (routingControl.value) {
      map.removeControl(routingControl.value)
      routingControl.value = null
    }
    if (routeLayer) {
      map.removeLayer(routeLayer)
      routeLayer = null
    }

    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    const selectedMode = availableModes.value.find((m) => m.value === transportMode.value)
    const osrmProfile = selectedMode?.osrmProfile || "driving"

    if (useAI.value && transportMode.value === "driving") {
      await calculateAIRoute()
    } else {
      const response = await api.post("/api/route/calculate", {
        start_lat: startCoords[0],
        start_lng: startCoords[1],
        dest_lat: destCoords[0],
        dest_lng: destCoords[1],
        profile: osrmProfile,
      })
      const routeData = response.data
      if (routeData.success && routeData.geometry) {
        const routeStyle = getRouteStyleForMode(transportMode.value)
        routeLayer = L.geoJSON(routeData.geometry, {
          style: {
            color: routeStyle.color,
            weight: routeStyle.weight,
            opacity: 0.8,
            dashArray: routeStyle.dashArray,
          },
        }).addTo(map)
        routeInfo.value = {
          distance: routeData.distance,
          duration: routeData.duration,
          trafficDelay: routeData.traffic_delay || 0,
          geometry: routeData.geometry,
        }
        const durationText = formatDurationForMode(routeInfo.value.duration, transportMode.value)
        mapStatus.value = `${selectedMode.label} route: ${(routeInfo.value.distance / 1000).toFixed(1)}km, ${durationText}`
        if (transportMode.value === "walking" && routeInfo.value.distance) {
          const walkingDuration = routeInfo.value.distance / 1.39
          routeInfo.value.duration = walkingDuration
          routeInfo.value.originalDuration = routeInfo.value.duration
          mapStatus.value = `${selectedMode.label} route: ${(routeInfo.value.distance / 1000).toFixed(1)}km, ${Math.ceil(
            walkingDuration / 60
          )} min (estimated walking time)`
        }
        const bounds = L.latLngBounds([
          [startCoords[0], startCoords[1]],
          [destCoords[0], destCoords[1]],
        ])
        map.fitBounds(bounds, { padding: [50, 50] })
        showNotification(`${selectedMode.label} route calculated!`, "success")
      } else {
        routeError.value = routeData.error || "Failed to calculate route"
        useOSRMFallback(startCoords, destCoords, osrmProfile)
      }
    }
  } catch (error) {
    console.error("Route calculation error:", error)
    routeError.value = `Failed to calculate ${transportMode.value} route. Please try again.`
    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    const selectedMode = availableModes.value.find((m) => m.value === transportMode.value)
    useOSRMFallback(startCoords, destCoords, selectedMode?.profile || "driving")
  } finally {
    routeLoading.value = false
  }
}

const clearRoute = () => {
  if (routingControl.value) {
    map.removeControl(routingControl.value)
    routingControl.value = null
  }
  if (routeLayer) {
    map.removeLayer(routeLayer)
    routeLayer = null
  }
  if (window.startMarker) {
    map.removeLayer(window.startMarker)
    window.startMarker = null
  }
  if (window.destMarker) {
    map.removeLayer(window.destMarker)
    window.destMarker = null
  }
  routeStart.value = ""
  routeDestination.value = ""
  routeInfo.value = null
  routeError.value = ""
  isSettingStart.value = false
  isSettingDestination.value = false
  aiRecommendations.value = []
  aiInsights.value = null
  liveTraffic.value = null
  alternativeRoutes.value = []
  bestAlternative.value = null
  eta.value = null
  routeAlerts.value = []
  disableRealTime()
  mapStatus.value = "Route cleared. Set new points to calculate route."
}

const initMap = () => {
  if (map) return
  ensureLeafletCssOnce()
  fixLeafletIcons()
  const el = document.getElementById("user-map")
  if (!el) return
  map = L.map(el, { zoomControl: true, attributionControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map)
  marker = L.marker(DEFAULT_CENTER).addTo(map).bindPopup("Calapan City (default)")
  mapStatus.value = "Showing Calapan City. Tap 'Use My Location' to pinpoint you."
  setupMapClickHandler()
}

// ============================================================
//  AI ROUTING (Gemini)
// ============================================================
const aiRecommendations = ref([])

const checkAIStatus = async () => {
  try {
    const response = await api.get("/api/map/ai-status")
    console.log("AI Status:", response.data)
    if (response.data.gemini_available) {
      aiAvailable.value = true
      showNotification("🤖 Gemini AI is available!", "success")
      return true
    } else {
      aiAvailable.value = false
      console.warn("Gemini AI not available")
      showNotification("AI features limited - using basic routing", "warning")
      return false
    }
  } catch (error) {
    console.error("AI status check failed:", error)
    aiAvailable.value = false
    return false
  }
}

const getAdditionalAIInsights = async (startCoords, destCoords) => {
  try {
    console.log("🔍 Getting additional AI insights...")
    const facilitiesResponse = await api.post(
      "/api/map/emergency-facilities",
      null,
      { params: { lat: startCoords[0], lng: startCoords[1], radius_km: 3 } }
    )
    if (facilitiesResponse.data && facilitiesResponse.data.success) {
      console.log("Emergency facilities found:", facilitiesResponse.data.facilities)
      const nearbyFacilities = facilitiesResponse.data.facilities
        .filter((f) => f.distance_km < 2)
        .map((f) => {
          const icon =
            f.type === "hospital"
              ? "🏥"
              : f.type === "fire_station"
              ? "🚒"
              : f.type === "police_station"
              ? "🚔"
              : "📍"
          return `${icon} ${f.name} (${f.distance_km.toFixed(1)}km away)`
        })
      if (nearbyFacilities.length > 0) {
        aiRecommendations.value = [...aiRecommendations.value, "📍 Nearby Emergency Services:", ...nearbyFacilities]
      }
    }
    const weatherResponse = await api.get("/api/map/weather-insights", {
      params: { lat: startCoords[0], lng: startCoords[1] },
    })
    if (weatherResponse.data && weatherResponse.data.success && weatherResponse.data.ai_insights) {
      const weatherInsights = weatherResponse.data.ai_insights
      const currentWeather = weatherResponse.data.current_weather
      if (currentWeather) {
        aiRecommendations.value.push(`🌤️ Current Weather: ${currentWeather.condition || "Normal conditions"}`)
      }
      if (weatherInsights.overall_risk > 5) {
        aiRecommendations.value.push("⚠️ Weather Alert: Conditions may affect driving")
        if (weatherInsights.precautions) {
          aiRecommendations.value.push(`   📝 ${weatherInsights.precautions}`)
        }
      }
    }
    console.log("✅ Additional AI insights loaded")
  } catch (error) {
    console.error("❌ Failed to get additional AI insights:", error)
    const fallbackRecommendations = [
      "📱 Keep your phone charged during travel",
      "🚗 Maintain safe following distance",
      "⛽ Ensure vehicle has sufficient fuel",
      "🆘 Save emergency contacts: 911",
    ]
    if (aiRecommendations.value.length < 3) {
      aiRecommendations.value = [...aiRecommendations.value, "💡 General Safety Tips:", ...fallbackRecommendations.slice(0, 2)]
    }
  }
}

const calculateDistanceFromCoordinates = (coordinates) => {
  if (!coordinates || coordinates.length < 2) return 5000
  let totalDistance = 0
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1]
    const [lon2, lat2] = coordinates[i]
    const R = 6371000
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    totalDistance += R * c
  }
  return totalDistance
}

const displayBasicRoute = (routeData) => {
  if (!routeData) return
  try {
    let coordinates = []
    if (routeData.geometry?.coordinates) {
      coordinates = routeData.geometry.coordinates.map((coord) => [coord[1], coord[0]])
    } else if (routeData.coordinates) {
      coordinates = routeData.coordinates.map((coord) => [coord[1], coord[0]])
    } else if (routeData.waypoints) {
      coordinates = routeData.waypoints.map((wp) => [wp.location[1], wp.location[0]])
    }
    if (coordinates.length > 0) {
      routeLayer = L.polyline(coordinates, {
        color: "#0b4fa3",
        weight: 6,
        opacity: 0.8,
        dashArray: "10, 10",
      }).addTo(map)
      console.log("Basic route displayed with", coordinates.length, "points")
    }
  } catch (error) {
    console.error("Failed to display basic route:", error)
  }
}

const displayAIEnhancedRoute = (aiResult) => {
  if (routeLayer) map.removeLayer(routeLayer)
  if (!aiResult || !aiResult.primary_route) {
    console.warn("Invalid AI result data:", aiResult)
    return
  }
  try {
    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    const trafficLevel =
      aiResult.traffic_prediction?.traffic_level || aiResult.realtime_data?.traffic_level || "medium"
    let routeColor = "#0b4fa3"
    let dashArray = "10, 10"
    switch (trafficLevel.toLowerCase()) {
      case "high":
        routeColor = "#dc2626"
        dashArray = "5, 5"
        break
      case "medium":
        routeColor = "#f59e0b"
        dashArray = "10, 10"
        break
      case "low":
        routeColor = "#10b981"
        dashArray = "20, 10"
        break
    }
    if (aiResult.primary_route.geometry) {
      routeLayer = L.geoJSON(aiResult.primary_route.geometry, {
        style: { color: routeColor, weight: 6, opacity: 0.8, dashArray },
      }).addTo(map)
      const popupContent = `
        <div class="ai-enhanced-popup">
          <h4>🤖 AI Enhanced Route Analysis</h4>
          <div class="ai-popup-section"><strong>Optimization:</strong> ${optimizationType.value.toUpperCase()}</div>
          ${
            trafficLevel
              ? `
          <div class="ai-popup-section">
            <strong>Traffic Prediction:</strong> ${trafficLevel.toUpperCase()}
            ${aiResult.traffic_prediction?.confidence ? `<br><small>Confidence: ${(aiResult.traffic_prediction.confidence * 100).toFixed(0)}%</small>` : ""}
          </div>
          `
              : ""
          }
          ${
            aiResult.realtime_data
              ? `
          <div class="ai-popup-section">
            <strong>Live Conditions:</strong>
            <br>${aiResult.realtime_data.weather_condition || "Normal"}
            ${aiResult.realtime_data.road_condition ? `<br>Road: ${aiResult.realtime_data.road_condition}` : ""}
          </div>
          `
              : ""
          }
          ${aiResult.safety_score ? `<div class="ai-popup-section"><strong>Safety Score:</strong> ${aiResult.safety_score}/10</div>` : ""}
          ${realTimeEnabled.value ? '<div class="ai-popup-section"><strong>🔴 Live Updates: ACTIVE</strong></div>' : ""}
        </div>
      `
      const midLat = (startCoords[0] + destCoords[0]) / 2
      const midLng = (startCoords[1] + destCoords[1]) / 2
      routeLayer.bindPopup(popupContent).openPopup()
    } else if (aiResult.primary_route.coordinates) {
      console.log("Using coordinates array instead of geometry")
      const latLngs = aiResult.primary_route.coordinates.map((coord) => [coord[1], coord[0]])
      routeLayer = L.polyline(latLngs, { color: routeColor, weight: 6, opacity: 0.8, dashArray }).addTo(map)
    } else {
      console.warn("No geometry or coordinates data in AI result:", aiResult.primary_route)
    }
  } catch (error) {
    console.error("Error displaying AI enhanced route:", error)
    displayBasicRoute(aiResult.primary_route)
  }
}

const calculateAIRoute = async () => {
  if (!routeStart.value || !routeDestination.value) {
    console.log("⚠️ Cannot calculate: Missing start or destination")
    return
  }
  console.log("🚀 Starting enhanced AI route calculation...")
  console.log("📍 Start:", routeStart.value)
  console.log("🎯 Destination:", routeDestination.value)
  aiLoading.value = true
  routeError.value = ""

  try {
    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    console.log("📡 Calling enhanced AI endpoint with:", { startCoords, destCoords })
    const aiAvailable = await checkAIStatus()
    if (aiAvailable) {
      const response = await api.post("/api/map/ai-route-analysis", {
        start_lat: startCoords[0],
        start_lng: startCoords[1],
        dest_lat: destCoords[0],
        dest_lng: destCoords[1],
        optimize_for: optimizationType.value,
        mode: transportMode.value,
        user_context: {
          mode: "driving",
          priority: optimizationType.value,
          live_traffic: realTimeEnabled.value,
          timestamp: new Date().toISOString(),
        },
      })
      console.log("🤖 Enhanced AI Response received:", response.data)
      if (response.data.success) {
        const aiResult = response.data
        aiRecommendations.value = aiResult.recommendations || aiResult.ai_insights?.recommendations || []
        aiInsights.value = aiResult.ai_insights || aiResult.analysis
        routeInsights.value = aiResult
        if (aiResult.primary_route || aiResult.route) {
          const routeData = aiResult.primary_route || aiResult.route
          displayAIEnhancedRoute(aiResult)
          let distance = routeData.distance || 5000
          let duration = routeData.duration || 600
          if (routeData.coordinates && routeData.coordinates.length > 1) {
            distance = calculateDistanceFromCoordinates(routeData.coordinates)
          }
          routeInfo.value = {
            distance,
            duration,
            geometry: routeData.geometry,
            coordinates: routeData.coordinates,
            trafficDelay: aiResult.traffic_prediction?.estimated_delay || aiResult.realtime_data?.estimated_delay || 0,
          }
          mapStatus.value = `🤖 AI Enhanced Route: ${(distance / 1000).toFixed(1)}km, ${Math.ceil(duration / 60)}min`
          if (aiAvailable) {
            await getAdditionalAIInsights(startCoords, destCoords)
          }
        } else {
          throw new Error("No route data in AI response")
        }
        if (realTimeEnabled.value) {
          enableRealTime()
        }
      } else {
        throw new Error(aiResult.error || "AI analysis failed")
      }
    } else {
      console.log("Using fallback AI routing")
      await calculateRoute(true)
    }
  } catch (error) {
    console.error("🔥 Enhanced AI route calculation error:", error)
    routeError.value = error.message || "AI service unavailable. Using standard routing."
    showNotification(`AI route calculation failed: ${error.message}`, "error")
    try {
      await calculateRoute(true)
    } catch (fallbackError) {
      console.error("Fallback also failed:", fallbackError)
      showNotification("All routing services unavailable", "error")
    }
  } finally {
    aiLoading.value = false
    console.log("🏁 AI calculation complete")
  }
}

const getRouteInsights = async () => {
  if (!routeStart.value || !routeDestination.value) return
  try {
    const startCoords = routeStart.value.split(",").map((coord) => parseFloat(coord.trim()))
    const destCoords = routeDestination.value.split(",").map((coord) => parseFloat(coord.trim()))
    const response = await api.post("/api/route/insights", {
      route_coords: [startCoords, destCoords],
    })
    if (response.data.success) {
      return response.data.insights
    }
  } catch (error) {
    console.error("Failed to get insights:", error)
  }
  return null
}

const hasValidRoutePoints = computed(() => {
  return routeStart.value && routeDestination.value && !isSettingStart.value && !isSettingDestination.value
})

// ============================================================
//  ACTIVE ALERTS
// ============================================================
const activeAlerts = ref([])
const loadingAlerts = ref(false)
const showAlertMapModal = ref(false)
const alertMapGeometry = ref(null)
const showImageModal = ref(false)
const modalImageUrl = ref("")
let alertMapInstance = null

const fetchActiveAlerts = async () => {
  try {
    const response = await api.get("/api/alerts/active")
    activeAlerts.value = response.data
  } catch (error) {
    console.error("Failed to fetch active alerts:", error)
  }
}

const formatAlertTime = (isoString) => {
  const dateUTC = new Date(isoString)
  const nowUTC = new Date()
  const diffMs = nowUTC.getTime() - dateUTC.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins} min ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`
  return dateUTC.toLocaleDateString()
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
  const el = document.getElementById("alert-map")
  if (!el) return
  if (alertMapInstance) alertMapInstance.remove()
  let center = [13.411, 121.181]
  if (alertMapGeometry.value) {
    const coords = alertMapGeometry.value.geometry.coordinates
    if (alertMapGeometry.value.geometry.type === "LineString" && coords.length > 0) {
      center = [coords[0][1], coords[0][0]]
    } else if (alertMapGeometry.value.geometry.type === "Point") {
      center = [coords[1], coords[0]]
    }
  }
  alertMapInstance = L.map(el).setView(center, 13)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(alertMapInstance)
  if (alertMapGeometry.value) {
    L.geoJSON(alertMapGeometry.value, {
      style: { color: "#dc2626", weight: 6, opacity: 0.8 },
    })
      .addTo(alertMapInstance)
      .bindPopup("Affected area")
  }
}

// ============================================================
//  REPORT CREATION
// ============================================================
const reportData = reactive({
  incident_type: "",
  description: "",
  barangay: "",
  address: "",
  latitude: "",
  longitude: "",
  contact_number: "",
  emergency_contact: "",
})

const incidentTypes = ref(["Accident", "Fire", "Medical", "Crime", "Natural Disaster", "Infrastructure", "Other"])
const barangayList = ref([
  "Balingayan",
  "Balite",
  "Baruyan",
  "Batino",
  "Bayanan I",
  "Bayanan II",
  "Biga",
  "Bondoc",
  "Bucayao",
  "Buhuan",
  "Bulusan",
  "Calero",
  "Camansihan",
  "Camilmil",
  "Canubing I",
  "Canubing II",
  "Comunal",
  "Guinobatan",
  "Gulod",
  "Gutad",
  "Ibaba East",
  "Ibaba West",
  "Ilaya",
  "Lalud",
  "Lazareto",
  "Libis",
  "Lumang Bayan",
  "Mahal na Pangalan",
  "Maidlang",
  "Malad",
  "Malamig",
  "Managpi",
  "Masipit",
  "Nag-iba I",
  "Nag-iba II",
  "Navotas",
  "Pachoca",
  "Palhi",
  "Panggalaan",
  "Parang",
  "Patas",
  "Personas",
  "Putingtubig",
  "Salong",
  "San Antonio",
  "San Vicente Central",
  "San Vicente East",
  "San Vicente North",
  "San Vicente South",
  "San Vicente West",
  "Santa Cruz",
  "Santa Isabel",
  "Santa Maria Village",
  "Santa Rita",
  "Santo Niño",
  "Sapul",
  "Silonay",
  "Suqui",
  "Tawagan",
  "Tawiran",
  "Tibag",
  "Wawa",
])
const aiAnalysisPreview = ref(null)
const uploadedMedia = ref([])
const isSubmitting = ref(false)
const submissionStatus = ref(null)
let analyzeTextDebounce = null
const editingIncidentType = ref(false)
const manualIncidentType = ref("")
const showLocationPicker = ref(false)
const tempLocation = reactive({ lat: null, lng: null })
let locationPickerMap = null
let locationPickerMarker = null
const locationPickerInitialized = ref(false)

const debouncedAnalyzeText = () => {
  clearTimeout(analyzeTextDebounce)
  if (reportData.description.length > 10) {
    analyzeTextDebounce = setTimeout(() => {
      analyzeText()
    }, 1000)
  }
}

const analyzeText = async () => {
  if (!reportData.description || reportData.description.length < 10) return
  try {
    const formData = new FormData()
    formData.append("text", reportData.description)
    const response = await api.post("/api/ml/analyze-text", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    if (response.data.success) {
      aiAnalysisPreview.value = response.data
      if (!reportData.incident_type || reportData.incident_type === manualIncidentType.value) {
        reportData.incident_type = response.data.type
      }
      if (response.data.recommendations) {
        aiRecommendations.value = response.data.recommendations
      }
    }
  } catch (error) {
    console.error("AI analysis failed:", error)
  }
}

const onManualTypeChange = () => {
  aiAnalysisPreview.value = null
}

const useCurrentLocation = async (coordType) => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser")
    return
  }
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
    })
    const lat = position.coords.latitude
    const lng = position.coords.longitude
    if (coordType === "latitude") {
      reportData.latitude = lat.toFixed(6)
    } else if (coordType === "longitude") {
      reportData.longitude = lng.toFixed(6)
    } else {
      reportData.latitude = lat.toFixed(6)
      reportData.longitude = lng.toFixed(6)
    }
  } catch (error) {
    console.error("Geolocation error:", error)
    alert("Unable to get your location. Please enable location services.")
  }
}

const handleImageUpload = (event) => {
  console.log("Upload started")
  try {
    const files = Array.from(event.target.files)
    files.forEach((file) => {
      if (!file.type.startsWith("image/")) {
        alert("Please upload image files only")
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        uploadedMedia.value.push({
          file: file,
          name: file.name,
          size: file.size,
          type: "image",
          preview: e.target.result,
        })
      }
      reader.readAsDataURL(file)
    })
  } catch (err) {
    console.error("Upload error:", err)
    alert("Error processing image: " + err.message)
  }
}

const handleVideoUpload = (event) => {
  const file = event.target.files[0]
  if (!file.type.startsWith("video/")) {
    alert("Please upload video files only")
    return
  }
  uploadedMedia.value.push({
    file: file,
    name: file.name,
    size: file.size,
    type: "video",
  })
}

const removeMedia = (index) => {
  uploadedMedia.value.splice(index, 1)
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

const submitReport = async () => {
  if (!reportData.description || reportData.description.length < 10) {
    submissionStatus.value = {
      type: "error",
      message: "Please provide a detailed description (at least 10 characters)",
    }
    return
  }
  if (!reportData.barangay) {
    submissionStatus.value = {
      type: "error",
      message: "Please select a barangay",
    }
    return
  }
  isSubmitting.value = true
  submissionStatus.value = { type: "info", message: "Submitting report..." }
  try {
    const formData = new FormData()
    Object.keys(reportData).forEach((key) => {
      if (reportData[key]) formData.append(key, reportData[key])
    })
    uploadedMedia.value.forEach((media, index) => {
      formData.append(`file_${index}`, media.file)
      formData.append(`file_type_${index}`, media.type)
    })
    const response = await api.post("/api/reports/submit", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    if (response.data.success) {
      submissionStatus.value = {
        type: "success",
        message: `✅ Report submitted successfully! Report ID: ${response.data.report_id}`,
      }
      clearForm()
      setTimeout(() => go("myreports"), 2000)
    } else {
      throw new Error(response.data.error || "Submission failed")
    }
  } catch (error) {
    console.error("Report submission error:", error)
    submissionStatus.value = {
      type: "error",
      message: `❌ Failed to submit report: ${error.message}`,
    }
  } finally {
    isSubmitting.value = false
  }
}

const clearForm = () => {
  Object.keys(reportData).forEach((key) => {
    reportData[key] = ""
  })
  aiAnalysisPreview.value = null
  aiRecommendations.value = []
  uploadedMedia.value = []
  submissionStatus.value = null
}

const startEditingIncidentType = () => {
  editingIncidentType.value = true
  manualIncidentType.value = reportData.incident_type
}

const saveIncidentType = () => {
  reportData.incident_type = manualIncidentType.value
  editingIncidentType.value = false
}

const cancelEditIncidentType = () => {
  editingIncidentType.value = false
  manualIncidentType.value = ""
}

const openLocationPicker = () => {
  showLocationPicker.value = true
  if (reportData.latitude && reportData.longitude) {
    tempLocation.lat = parseFloat(reportData.latitude)
    tempLocation.lng = parseFloat(reportData.longitude)
  } else {
    tempLocation.lat = 13.411
    tempLocation.lng = 121.181
  }
  nextTick(() => initLocationPickerMap())
}

const initLocationPickerMap = () => {
  if (locationPickerInitialized.value) return
  const el = document.getElementById("location-picker-map")
  if (!el) return
  delete L.Icon.Default.prototype._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  })
  locationPickerMap = L.map(el).setView([tempLocation.lat, tempLocation.lng], 15)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(locationPickerMap)
  locationPickerMarker = L.marker([tempLocation.lat, tempLocation.lng], { draggable: true }).addTo(locationPickerMap)
  locationPickerMarker.on("dragend", (e) => {
    const pos = e.target.getLatLng()
    tempLocation.lat = pos.lat
    tempLocation.lng = pos.lng
  })
  locationPickerMap.on("click", (e) => {
    const { lat, lng } = e.latlng
    locationPickerMarker.setLatLng([lat, lng])
    tempLocation.lat = lat
    tempLocation.lng = lng
  })
  locationPickerInitialized.value = true
}

const confirmLocation = () => {
  if (tempLocation.lat && tempLocation.lng) {
    reportData.latitude = tempLocation.lat.toFixed(6)
    reportData.longitude = tempLocation.lng.toFixed(6)
  }
  closeLocationPicker()
}

const closeLocationPicker = () => {
  showLocationPicker.value = false
  if (locationPickerMap) {
    locationPickerMap.remove()
    locationPickerMap = null
    locationPickerMarker = null
    locationPickerInitialized.value = false
  }
}

const useCurrentLocationForReport = async () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser")
    return
  }
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
    })
    const lat = position.coords.latitude
    const lng = position.coords.longitude
    reportData.latitude = lat.toFixed(6)
    reportData.longitude = lng.toFixed(6)

    try {
      const geoResponse = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=en`
      )
      const geoData = await geoResponse.json()
      if (geoData && geoData.address) {
        let detectedBarangay =
          geoData.address.village ||
          geoData.address.suburb ||
          geoData.address.neighbourhood ||
          geoData.address.city_district ||
          geoData.address.town ||
          geoData.address.city
        if (detectedBarangay) {
          const matched = barangayList.value.find((b) => b.toLowerCase() === detectedBarangay.toLowerCase())
          if (matched) {
            reportData.barangay = matched
          } else {
            reportData.barangay = detectedBarangay
            console.warn(`Detected barangay "${detectedBarangay}" not in official list`)
          }
        } else {
          console.warn("No barangay name found in reverse geocoding response")
        }
      }
    } catch (geoError) {
      console.error("Reverse geocoding failed:", geoError)
      reportData.barangay = ""
    }

    if (locationPickerMap && locationPickerMarker) {
      locationPickerMarker.setLatLng([lat, lng])
      locationPickerMap.setView([lat, lng], 15)
      tempLocation.lat = lat
      tempLocation.lng = lng
    }
    showNotification("Location detected – barangay automatically filled (you can change it)", "success")
  } catch (error) {
    console.error("Geolocation error:", error)
    alert("Unable to get your location. Please enable location services or select barangay manually.")
  }
}

const locationSummary = computed(() => {
  if (reportData.barangay) {
    return `📍 Barangay: ${reportData.barangay}`
  } else if (reportData.latitude && reportData.longitude) {
    return `📍 Coordinates: ${reportData.latitude}, ${reportData.longitude}`
  }
  return "📍 Location not set"
})

const getMediaArray = (paths) => {
  if (!paths) return []
  if (Array.isArray(paths)) return paths
  if (typeof paths === "string") {
    try {
      const parsed = JSON.parse(paths)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }
  return []
}

const parseMediaArray = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }
  return []
}


const handleImageError = (event) => {
  event.target.src = FALLBACK_IMAGE
}

// ============================================================
//  NOTIFICATIONS
// ============================================================
const showNotification = (message, type = "info") => {
  const notification = document.createElement("div")
  notification.className = `route-notification ${type}`
  notification.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()">×</button>`
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px;
    background: ${type === "success" ? "#10b981" : type === "error" ? "#ef4444" : type === "warning" ? "#f59e0b" : "#0b4fa3"};
    color: white; padding: 12px 16px; border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 9999;
    display: flex; align-items: center; gap: 10px;
    animation: slideIn 0.3s ease;
  `
  document.body.appendChild(notification)
  setTimeout(() => {
    if (notification.parentElement) notification.remove()
  }, 3000)
}

const addNotificationStyles = () => {
  if (!document.getElementById("notification-styles")) {
    const style = document.createElement("style")
    style.id = "notification-styles"
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      .route-notification button {
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
}

// ============================================================
//  WATCHERS
// ============================================================
watch(showReportModal, (newVal) => {
  if (!newVal && responderLocationInterval) {
    clearInterval(responderLocationInterval)
    responderLocationInterval = null
  }
  if (!newVal && incidentMapInstance) {
    incidentMapInstance.remove()
    incidentMapInstance = null
    incidentMapMarkers = []
  }
})

watch([routeStart, routeDestination], ([newStart, newDest], [oldStart, oldDest]) => {
  if (debounceTimer.value) clearTimeout(debounceTimer.value)
  if (newStart && newDest && autoCalculate.value && !isSettingStart.value && !isSettingDestination.value) {
    if (newStart !== oldStart || newDest !== oldDest) {
      debounceTimer.value = setTimeout(() => {
        if (useAI.value) {
          calculateAIRoute()
        } else {
          calculateRoute()
        }
      }, 500)
    }
  }
})

watch(active, async (val) => {
  if (val === "map") {
    await nextTick()
    initMap()
    invalidateSoon()
  } else if (val === "chat") {
    await nextTick()
  }
})

// ============================================================
//  LIFECYCLE
// ============================================================
onMounted(async () => {
  windowWidth.value = window.innerWidth
  addNotificationStyles()
  await loadProfile()
  fetchActiveAlerts()
  setInterval(fetchActiveAlerts, 30000)
  connectWebSocket()
  testAIEndpoint()
  showHistorySidebar.value = windowWidth.value >= 768
  loadChatHistoryList()
  loadChatHistory()
  setupScrollListener()
  chatbotScrollToBottom()
  window.addEventListener("resize", handleResize)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !wsConnected.value) {
      connectWebSocket()
    }
  })
})

const handleResize = () => {
  windowWidth.value = window.innerWidth
  if (windowWidth.value < 768) {
    showHistorySidebar.value = false
  } else {
    showHistorySidebar.value = true
  }
}

const testAIEndpoint = async () => {
  try {
    const geminiTest = await api.get("/api/test/gemini")
    console.log("Gemini AI test:", geminiTest.data)
    if (geminiTest.data.success) {
      showNotification("🤖 Gemini AI is connected and working!", "success")
    }
    const response = await api.post("/api/map/traffic-prediction", {
      start_lat: 13.411,
      start_lng: 121.181,
      dest_lat: 13.415,
      dest_lng: 121.201,
      hours_ahead: 2,
    })
    console.log("AI traffic prediction test:", response.data)
    return response.data.success
  } catch (error) {
    console.warn("AI endpoints not available:", error.message)
    showNotification("AI features not available - using standard routing", "warning")
    return false
  }
}

// Refresh functions for auto‑refresh
const refreshMyReports = async () => {
  if (active.value !== "myreports") return
  await loadMyReports()
}
const refreshMap = async () => {
  if (active.value !== "map") return
  if (typeof loadRouteMarkers === "function") await loadRouteMarkers()
}
const refreshAnnouncements = async () => {
  if (active.value !== "announcements") return
  await fetchActiveAlerts()
}
const refreshLegal = async () => {
  if (active.value !== "legal") return
  await loadLegalCompliances()
}

useAutoRefresh({ refreshFn: refreshMyReports, interval: 30000, enabled: true, preserveScroll: true, scrollContainerSelector: ".reports-table-container" })
useAutoRefresh({ refreshFn: refreshMap, interval: 30000, enabled: true, preserveMap: true, mapRef })
useAutoRefresh({ refreshFn: refreshAnnouncements, interval: 60000, enabled: true })
useAutoRefresh({ refreshFn: refreshLegal, interval: 60000, enabled: true })

onBeforeUnmount(() => {
  // Clear intervals
  if (responderLocationInterval) {
    clearInterval(responderLocationInterval)
    responderLocationInterval = null
  }
  if (responderLocationInterval) clearInterval(responderLocationInterval) // duplicate? removed

  window.removeEventListener("resize", handleResize)
  document.removeEventListener("visibilitychange", connectWebSocket)
  stopRealTimeUpdates()
  stopPingInterval()
  if (ws) {
    ws.close(1000, "Component unmounting")
    ws = null
  }
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
  try {
    map?.remove()
  } catch {}
  map = null
  marker = null
  accuracyCircle = null
  routingControl.value = null
  if (incidentMapInstance) {
    incidentMapInstance.remove()
    incidentMapInstance = null
  }
  if (alertMapInstance) {
    alertMapInstance.remove()
    alertMapInstance = null
  }
  if (locationPickerMap) {
    locationPickerMap.remove()
    locationPickerMap = null
  }
})
</script>

<template>
  <div class="page">
    <!-- ========== HEADER / TOPBAR ========== -->
    <header class="topbar">
      <div class="topbar-inner">
        <button
          v-if="windowWidth < 640"
          class="hamburger"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <span></span><span></span><span></span>
        </button>

        <div class="brand">
          <div class="seal-wrap">
            <img class="seal" :src="calapanLogo" alt="Calapan City Seal" />
          </div>
          <div class="brand-text">
            <div class="brand-title">RESQAPP • Dashboard</div>
            <div class="brand-subtitle">Calapan City, Oriental Mindoro</div>
          </div>
        </div>

        <div class="right">
          <span class="role" :class="roleClass">{{ role }}</span>
          <button class="btn btn-outline btn-sm" @click="logout">Logout</button>
        </div>
      </div>
    </header>

    <!-- ========== MAIN LAYOUT ========== -->
    <main class="main">
      <div class="layout">
        <!-- ========== SIDE NAVIGATION ========== -->
        <nav class="nav" :class="{ 'mobile-open': mobileMenuOpen }">
          <button
            class="navbtn"
            :class="{ on: active === 'overview' }"
            @click="go('overview')"
          >
            Overview
          </button>
          <button
            class="navbtn"
            :class="{ on: active === 'report' }"
            @click="go('report')"
          >
            Create Report
          </button>
          <button
            class="navbtn"
            :class="{ on: active === 'map' }"
            @click="go('map')"
          >
            Map
          </button>
          <button
            class="navbtn"
            :class="{ on: active === 'myreports' }"
            @click="go('myreports')"
          >
            My Reports
          </button>
          <button
            class="navbtn"
            :class="{ on: active === 'announcements' }"
            @click="go('announcements')"
          >
            Announcements
          </button>
          <button
            class="navbtn"
            :class="{ on: active === 'chat' }"
            @click="go('chat')"
          >
            Messages
          </button>
          <button
            class="navbtn"
            :class="{ on: active === 'legal' }"
            @click="go('legal')"
          >
            Legal Info
          </button>
          
          <button
            class="navbtn"
            :class="{ on: active === 'profile' }"
            @click="go('profile')"
          >
            Profile
          </button>
        </nav>

        <!-- Mobile backdrop -->
        <div
          v-if="mobileMenuOpen && windowWidth < 640"
          class="nav-backdrop"
          @click="mobileMenuOpen = false"
        ></div>

        <!-- ========== MAIN CONTENT AREA ========== -->
        <section class="content">
          <!-- ===== OVERVIEW ===== -->
          <div v-if="active === 'overview'" class="card">
            <h2 class="h2">Welcome</h2>
            <p class="p">
              Use RESQAPP to submit incident reports with accurate details and
              location to support faster response.
            </p>

            <div class="grid">
              <div class="mini">
                <div class="miniTitle">Quick Report</div>
                <div class="miniText">
                  Start a new incident report in under a minute.
                </div>
                <button class="btn btn-primary" @click="go('report')">
                  Create Report
                </button>
              </div>

              <div class="mini">
                <div class="miniTitle">Real-time Map</div>
                <div class="miniText">
                  Get live traffic updates and AI-optimized routes.
                </div>
                <button class="btn btn-outline-blue" @click="go('map')">
                  Open Map
                </button>
              </div>

              <div class="mini">
                <div class="miniTitle">Live Chat</div>
                <div class="miniText">
                  Chat directly with responders for urgent assistance.
                </div>
                <button class="btn btn-outline-blue" @click="go('chat')">
                  Open Chat
                </button>
              </div>
            </div>
          </div>

<div v-else-if="active === 'announcements'" class="card">
  <h2 class="h2">📢 Announcements</h2>
  <p class="p">
    Official announcements and active alerts from Calapan City
    responders.
  </p>

  <div v-if="activeAlerts.length" class="announcements-list">
    <div
      v-for="alert in activeAlerts"
      :key="alert.id"
      class="announcement-card"
      :class="alert.severity"
    >
      <div class="announcement-header">
        <span class="severity-badge" :class="alert.severity">{{
          alert.severity
        }}</span>
        <span class="announcement-time">{{
          formatAlertTime(alert.created_at)
        }}</span>
      </div>
      <p class="announcement-message">{{ alert.message }}</p>

      <!-- Action buttons row -->
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

  <!-- Empty state -->
  <div v-else class="empty-announcements">
    <p>No active announcements at this time.</p>
  </div>
</div>

          <!-- ===== CREATE REPORT ===== -->
          <div v-else-if="active === 'report'" class="card">
            <h2 class="h2">Create Incident Report</h2>
            <p class="p">
              AI‑powered analysis will auto‑detect the incident type and
              severity.
            </p>

            <!-- AI Analysis Preview -->
            <div v-if="aiAnalysisPreview" class="ai-analysis-preview">
              <div class="ai-header">
                <span class="ai-badge">🤖 AI Analysis</span>
                <span class="ai-confidence"
                  >Confidence:
                  {{ (aiAnalysisPreview.confidence * 100).toFixed(0) }}%</span
                >
              </div>
              <div class="ai-content">
                <!-- Incident Type Display/Edit -->
                <div class="ai-type-section">
                  <strong>Detected Incident:</strong>
                  <div
                    v-if="!editingIncidentType"
                    class="type-display"
                  >
                    <span class="ai-type-badge">{{
                      reportData.incident_type || aiAnalysisPreview.type
                    }}</span>
                    <button
                      class="btn-edit-type"
                      @click="startEditingIncidentType"
                    >
                      ✎
                    </button>
                  </div>
                  <div v-else class="type-edit">
                    <select
                      v-model="manualIncidentType"
                      class="input type-select"
                    >
                      <option
                        v-for="type in incidentTypes"
                        :key="type"
                        :value="type"
                      >
                        {{ type }}
                      </option>
                    </select>
                    <div class="edit-actions">
                      <button class="btn-save-type" @click="saveIncidentType">
                        ✓
                      </button>
                      <button
                        class="btn-cancel-type"
                        @click="cancelEditIncidentType"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
                <div class="ai-severity">
                  <strong>Severity:</strong>
                  <span
                    class="severity-badge"
                    :class="aiAnalysisPreview.severity.toLowerCase()"
                  >
                    {{ aiAnalysisPreview.severity }}
                  </span>
                </div>
                <div
                  v-if="
                    aiAnalysisPreview.keywords &&
                    aiAnalysisPreview.keywords.length
                  "
                  class="ai-keywords"
                >
                  <strong>Keywords:</strong>
                  <span
                    v-for="keyword in aiAnalysisPreview.keywords"
                    :key="keyword"
                    class="keyword-tag"
                  >
                    {{ keyword }}
                  </span>
                </div>
              </div>
            </div>

            <div class="form">
              <!-- Description -->
              <div>
                <label class="label"
                  >Detailed Description <span class="required">*</span></label
                >
                <textarea
                  v-model="reportData.description"
                  class="input"
                  rows="4"
                  placeholder="Describe what happened (at least 10 characters)..."
                  @input="debouncedAnalyzeText"
                ></textarea>
                <div class="word-count">
                  {{ reportData.description.length }} / 1000 characters
                </div>
              </div>

              <!-- Location: Barangay + Address -->
              <div class="two">
                <div>
                  <label class="label"
                    >Barangay <span class="required">*</span></label
                  >
                  <select v-model="reportData.barangay" class="input">
                    <option value="">Select Barangay</option>
                    <option
                      v-for="barangay in barangayList"
                      :key="barangay"
                      :value="barangay"
                    >
                      {{ barangay }}
                    </option>
                  </select>
                </div>
                <div>
                  <label class="label">Landmark/Address</label>
                  <input
                    v-model="reportData.address"
                    class="input"
                    placeholder="Nearest landmark or street"
                  />
                </div>
              </div>

              <!-- Hidden coordinates (still bound) -->
              <input type="hidden" v-model="reportData.latitude" />
              <input type="hidden" v-model="reportData.longitude" />

              <!-- Location picker controls -->
              <div class="location-picker">
                <div
                  class="location-summary"
                  :class="{ 'not-set': !reportData.latitude }"
                >
                  {{ locationSummary }}
                </div>
                <div class="location-actions">
                  <button
                    type="button"
                    class="btn-location"
                    @click="openLocationPicker"
                  >
                    🗺️ Pick on Map
                  </button>
                </div>
              </div>

              <!-- Contact Information -->
              <div class="two">
                <div>
                  <label class="label">Your Contact Number</label>
                  <input
                    v-model="reportData.contact_number"
                    class="input"
                    placeholder="0912 345 6789"
                  />
                </div>
                <div>
                  <label class="label">Emergency Contact</label>
                  <input
                    v-model="reportData.emergency_contact"
                    class="input"
                    placeholder="Emergency contact (optional)"
                  />
                </div>
              </div>

              <!-- Media Upload -->
              <div>
                <label class="label">Upload Media (Optional)</label>
                <div class="media-upload">
                  <div class="upload-buttons">
                    <label class="btn-upload">
                      📷 Add Image
                      <input
                        type="file"
                        accept="image/*"
                        @change.prevent="handleImageUpload"
                        @click.stop
                        
                        hidden
                        multiple
                      />
                    </label>
                    <label class="btn-upload">
                      🎥 Add Video
                      <input
                        type="file"
                        accept="video/*"
                        @change.prevent="handleVideoUpload"
                        @click.stop
                        hidden
                      />
                    </label>
                  </div>

                  <!-- Preview -->
                  <div v-if="uploadedMedia.length" class="media-preview">
                    <div
                      v-for="(media, index) in uploadedMedia"
                      :key="index"
                      class="media-item"
                    >
                      <div class="media-thumbnail">
                        <img
                          v-if="media.type === 'image'"
                          :src="media.preview"
                          alt="Preview"
                        />
                        <div v-else class="video-thumbnail">🎥</div>
                        <button
                          @click="removeMedia(index)"
                          class="btn-remove-media"
                        >
                          ×
                        </button>
                      </div>
                      <div class="media-info">
                        <span class="media-name">{{ media.name }}</span>
                        <span class="media-size">{{
                          formatFileSize(media.size)
                        }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- AI Recommendations -->
              <div
                v-if="aiRecommendations.length"
                class="ai-recommendations"
              >
                <h4>🤖 AI Recommendations:</h4>
                <ul>
                  <li
                    v-for="(rec, index) in aiRecommendations.slice(0, 5)"
                    :key="index"
                  >
                    {{ rec }}
                  </li>
                </ul>
              </div>

              <!-- Submit Actions -->
              <div class="actions">
                <button
                  @click="submitReport"
                  class="btn btn-primary"
                  :disabled="
                    isSubmitting ||
                    !reportData.description ||
                    !reportData.barangay ||
                    !reportData.latitude ||
                    !reportData.longitude
                  "
                >
                  <span v-if="isSubmitting">🔄 Submitting...</span>
                  <span v-else>🚨 Submit Report</span>
                </button>
                <button @click="clearForm" class="btn btn-outline-blue">
                  Clear Form
                </button>
              </div>

              <!-- Submission Status -->
              <div
                v-if="submissionStatus"
                class="submission-status"
                :class="submissionStatus.type"
              >
                {{ submissionStatus.message }}
              </div>
            </div>

            <!-- Location Picker Modal (inside report card) -->
            <div
              v-if="showLocationPicker"
              class="modal-overlay"
              @click.self="closeLocationPicker"
            >
              <div class="modal-content map-modal">
                <div class="modal-header">
                  <h3>Pick Location on Map</h3>
                  <button class="modal-close" @click="closeLocationPicker">
                    ×
                  </button>
                </div>
                <div class="modal-body">
                  <div id="location-picker-map" class="picker-map"></div>
                  <div class="selected-coords">
                    Selected: {{ tempLocation.lat?.toFixed(6) }},
                    {{ tempLocation.lng?.toFixed(6) }}
                  </div>
                </div>
                <div class="modal-actions">
                  <button class="btn btn-outline" @click="closeLocationPicker">
                    Cancel
                  </button>
                  <button class="btn btn-primary" @click="confirmLocation">
                    Confirm Location
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ===== MAP ===== -->
          <div v-else-if="active === 'map'" class="card">
            <div class="mapTop">
              <div>
                <h2 class="h2">Map & Directions</h2>
                <p class="p">
                  Plan your route with smart AI optimization and real-time
                  traffic.
                </p>
              </div>

              <div class="mapActions">
                <button
                  class="btn btn-outline-blue"
                  :disabled="locating"
                  @click="useMyLocation"
                >
                  {{ locating ? "Locating..." : "Use My Location" }}
                </button>
                <button
                  class="btn btn-outline-blue"
                  @click="showRoutePanel = !showRoutePanel"
                >
                  {{
                    showRoutePanel ? "Hide Route Planner" : "Show Route Planner"
                  }}
                </button>
              </div>
            </div>

            <!-- Route Planning Panel -->
            <div v-if="showRoutePanel" class="route-panel">
              <div class="route-header">
                <h3>Route Planner</h3>
                <button
                  class="btn-clear-route"
                  @click="clearRoute"
                  title="Clear Route"
                >
                  🗑️ Clear
                </button>
              </div>

              <div class="route-form">
                <div class="form-group">
                  <label class="label">Starting Point</label>
                  <div class="input-with-actions">
                    <input
                      v-model="routeStart"
                      class="input"
                      placeholder="Click map or use current location"
                      readonly
                    />
                    <div class="input-actions">
                      <button
                        class="btn-small"
                        @click="enableSetStartPoint"
                        :class="{ active: isSettingStart }"
                      >
                        {{ isSettingStart ? "Click Map..." : "Set on Map" }}
                      </button>
                      <button
                        class="btn-small"
                        @click="useCurrentLocationAsStart"
                      >
                        📍 Current
                      </button>
                    </div>
                  </div>
                </div>

                <div class="form-group">
                  <label class="label">Destination</label>
                  <div class="input-with-actions">
                    <input
                      v-model="routeDestination"
                      class="input"
                      placeholder="Click map to set destination"
                      readonly
                    />
                    <div class="input-actions">
                      <button
                        class="btn-small"
                        @click="enableSetDestination"
                        :class="{ active: isSettingDestination }"
                      >
                        {{
                          isSettingDestination ? "Click Map..." : "Set on Map"
                        }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- AI Controls (commented out) -->
                <!-- Real-time Controls (commented out) -->

                <!-- Route Actions -->
                <div class="route-actions">
                  <div class="action-buttons"></div>
                </div>

                <div class="form-group">
  <label class="label">Transport Mode</label>
  <div class="mode-selector">
    <button
      v-for="mode in availableModes"
      :key="mode.value"
      type="button"
      class="mode-btn"
      :class="{ active: transportMode === mode.value }"
      @click="transportMode = mode.value; if (routeStart && routeDestination) calculateRoute()"
    >
      <span class="mode-icon">{{ mode.icon }}</span>
      <span class="mode-label">{{ mode.label }}</span>
    </button>
  </div>
  <div v-if="transportMode === 'walking'" class="mode-hint">
    🚶 Walking routes use pedestrian paths. Times are estimates.
  </div>

  <div v-else-if="transportMode === 'motorcycle'" class="mode-hint">
    🏍️ Motorcycle routes optimized for two-wheelers.
  </div>
</div>

                <!-- AI Loading Indicator -->
                <div v-if="aiLoading" class="ai-loading">
                  <div class="ai-spinner"></div>
                  <span>🤖 AI is optimizing your route...</span>
                </div>

                <!-- Live Traffic Info -->
                <div v-if="realTimeEnabled && liveTraffic" class="live-traffic-info">
                  <div class="traffic-header">
                    <h5>🚦 Live Traffic Update</h5>
                    <span class="traffic-time">{{
                      new Date().toLocaleTimeString()
                    }}</span>
                  </div>
                  <div class="traffic-details">
                    <div class="traffic-level" :class="liveTraffic.traffic_level">
                      Traffic: {{ liveTraffic.traffic_level.toUpperCase() }}
                    </div>
                    <div v-if="eta" class="eta-info">
                      <span class="eta-label">Current ETA:</span>
                      <span class="eta-value">{{ Math.ceil(eta.current / 60) }} min</span>
                      <span v-if="eta.delay > 0" class="eta-delay"
                        >(+{{ Math.ceil(eta.delay / 60) }} min delay)</span
                      >
                    </div>
                  </div>
                </div>

                <!-- Route Alerts -->
                <div v-if="routeAlerts.length > 0" class="route-alerts">
                  <div class="alerts-header">
                    <h5>⚠️ Route Alerts</h5>
                  </div>
                  <div class="alerts-list">
                    <div
                      v-for="alert in routeAlerts"
                      :key="alert.id"
                      class="alert-item"
                      :class="alert.severity"
                    >
                      <span class="alert-icon">{{
                        alert.severity === "high" ? "🚨" : "⚠️"
                      }}</span>
                      <span class="alert-text">{{ alert.message }}</span>
                    </div>
                  </div>
                </div>

                <!-- Route Information -->
                <div v-if="routeInfo" class="route-info">
                  <div class="route-stats">
                    <div class="stat">
                      <div class="stat-label">Distance</div>
                      <div class="stat-value">
                        {{ (routeInfo.distance / 1000).toFixed(1) }} km
                      </div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Travel Time</div>
                      <div class="stat-value">
                        {{ Math.ceil(routeInfo.duration / 60) }} min
                      </div>
                    </div>
                    <div v-if="routeInfo.trafficDelay" class="stat">
                      <div class="stat-label">Traffic Delay</div>
                      <div class="stat-value warning">
                        +{{ Math.ceil(routeInfo.trafficDelay / 60) }} min
                      </div>
                    </div>
                  </div>

                  <div v-if="alternativeRoutes.length > 0" class="alternatives">
                    <p class="alt-title">Alternative Routes (Live):</p>
                    <div
                      v-for="(alt, index) in alternativeRoutes"
                      :key="index"
                      class="alt-route"
                      :class="{ best: alt.time_saving > 0 }"
                    >
                      {{ index + 1 }}. {{ (alt.distance / 1000).toFixed(1) }}km,
                      {{ Math.ceil(alt.duration / 60) }}min
                      <span v-if="alt.time_saving > 0" class="time-saving"
                        >(Save {{ Math.ceil(alt.time_saving / 60) }} min)</span
                      >
                    </div>
                  </div>
                </div>

                <div v-if="routeError" class="route-error">
                  {{ routeError }}
                </div>
              </div>
            </div>

            <div class="mapStatus">{{ mapStatus }}</div>

            <div class="mapFrame">
              <div id="user-map" class="map"></div>
            </div>

            <div class="mapHint">
              Tip: Enable real-time updates for live traffic monitoring and route
              optimization.
            </div>
          </div>

          <!-- ===== MY REPORTS ===== -->
          <div v-else-if="active === 'myreports'" class="reports-container">
            <!-- Header Section -->
            <div class="reports-header">
              <div>
                <h2 class="reports-title">My Incident Reports</h2>
                <p class="reports-subtitle">
                  Track and manage your submitted reports
                </p>
              </div>
              <button class="btn-new-report" @click="go('report')">
                <span class="btn-icon">+</span> New Report
              </button>
            </div>

            <!-- Stats Cards -->
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-icon total">📋</div>
                <div class="stat-content">
                  <div class="stat-value">{{ reportStats.total }}</div>
                  <div class="stat-label">Total Reports</div>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-icon resolved">✅</div>
                <div class="stat-content">
                  <div class="stat-value">{{ reportStats.resolved }}</div>
                  <div class="stat-label">Resolved</div>
                </div>
              </div>
            </div>

            <!-- Search and Filter Bar -->
            <div class="search-filter-bar">
              <div class="search-box">
                <span class="search-icon">🔍</span>
                <input
                  v-model="reportSearchQuery"
                  type="text"
                  placeholder="Search by ID, type, location..."
                  class="search-input"
                />
                <button
                  v-if="reportSearchQuery"
                  @click="reportSearchQuery = ''"
                  class="clear-search"
                >
                  ✕
                </button>
              </div>

            </div>

            <!-- Loading State -->
            <div v-if="loadingMyReports" class="loading-skeleton">
              <div v-for="i in 3" :key="i" class="skeleton-row">
                <div class="skeleton-cell" style="width: 20%"></div>
                <div class="skeleton-cell" style="width: 15%"></div>
                <div class="skeleton-cell" style="width: 10%"></div>
                <div class="skeleton-cell" style="width: 15%"></div>
                <div class="skeleton-cell" style="width: 20%"></div>
                <div class="skeleton-cell" style="width: 15%"></div>
              </div>
            </div>

            <!-- Empty State -->
            <div v-else-if="filteredReports.length === 0" class="empty-state">
              <div class="empty-icon">📭</div>
              <h3>No reports found</h3>
              <p v-if="reportSearchQuery || reportStatusFilter !== 'all'">
                Try adjusting your search or filters
              </p>
              <p v-else>You haven't submitted any reports yet</p>
              <button
                v-if="reportSearchQuery || reportStatusFilter !== 'all'"
                class="btn-clear-filters"
                @click="reportSearchQuery = ''; reportStatusFilter = 'all'"
              >
                Clear Filters
              </button>
            </div>

            <!-- Reports Table -->
            <div v-else class="reports-table-container">
              <table class="reports-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Location</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="report in filteredReports"
                    :key="report.id"
                    class="report-row"
                  >
                    <td class="report-id">#{{ report.id.substring(0, 8) }}</td>
                    <td class="report-type">{{ report.incident_type || 'Unknown' }}</td>
                    
                 
                    <td class="report-location">{{ report.barangay || 'Unknown' }}</td>
                    <td class="report-date">{{ formatDate(report.created_at) }}</td>
                    <td>
                      <button
                        class="btn-view"
                        @click="viewReportDetails(report.id)"
                        title="View Details"
                      >
                        <span class="btn-view-icon">👁️</span>
                        <span>Details</span>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- ===== LEGAL INFO ===== -->
          <div v-else-if="active === 'legal'" class="card">
            <h2 class="h2">⚖️ Legal Information</h2>
            <p class="p">Laws and official statements relevant to emergency reporting and public safety in Calapan City.</p>

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

          <!-- ===== CHAT ===== -->
          <div v-else-if="active === 'chat'" class="chat-layout">
            <!-- History Sidebar -->
            <div
              class="chat-history-sidebar"
              :class="{ hidden: !showHistorySidebar }"
            >
              <div class="sidebar-header">
                <h3>Chat History</h3>
                <button class="btn-new-chat" @click="createNewChat">
                  + New Chat
                </button>
              </div>

              <div class="chat-history-list">
                <div
                  v-for="chat in chatHistoryList"
                  :key="chat.id"
                  class="chat-history-item"
                  :class="{ active: selectedChatId === chat.id }"
                  @click="loadSelectedChat(chat.id)"
                >
                  <div class="chat-item-content">
                    <div class="chat-summary">{{ chat.summary }}</div>
                    <div class="chat-meta">
                      <span class="chat-time">{{ formatChatTime(chat.timestamp) }}</span>
                      <span class="chat-count">{{ chat.messageCount }} messages</span>
                    </div>
                  </div>
                  <button
                    class="btn-delete-chat"
                    @click="deleteChatFromHistory(chat.id, $event)"
                    title="Delete chat"
                  >
                    🗑️
                  </button>
                </div>

                <div v-if="chatHistoryList.length === 0" class="empty-history">
                  <p>No chat history yet</p>
                  <p>Start a new conversation!</p>
                </div>
              </div>
            </div>

            <!-- Main Chat Area -->
            <div class="chat-main-area">
              <!-- Chat Header -->
              <div class="chat-main-header">
                <button
                  class="btn-toggle-sidebar"
                  @click="showHistorySidebar = !showHistorySidebar"
                  v-if="windowWidth < 768"
                >
                  ≡ History
                </button>
                <h2 class="chat-title">RESQAPP Assistant</h2>
                <div class="chat-header-actions">
                  <button
                    v-if="chatbotMessages.length > 1"
                    @click="clearChatHistory"
                    class="btn-clear"
                    title="Clear current chat"
                  >
                    🗑️ Clear
                  </button>
                  <button
                    @click="createNewChat"
                    class="btn-new-chat-header"
                    title="New chat"
                  >
                    + New
                  </button>
                </div>
              </div>

              <!-- Chatbot Card -->
              <div class="card chatbot-card">
                <div class="chatbot-header">
                 
                </div>

                <div class="chatbot-body">
                  <div class="chatbot-messages">
                    <div
                      v-for="(msg, index) in chatbotMessages"
                      :key="index"
                      class="chatbot-message"
                      :class="msg.role"
                    >
                      <div class="message-content">{{ msg.content }}</div>
                      <div v-if="msg.timestamp" class="message-time">{{ msg.timestamp }}</div>
                    </div>

                    <!-- Quick Replies -->
                    <div v-if="showQuickReplies" class="chatbot-quick-replies">
                      <p class="quick-replies-title">Quick questions:</p>
                      <div class="quick-replies-buttons">
                        <button @click="useQuickReply('How do I report an incident?')">
                          📝 Report Incident
                        </button>
                        <button @click="useQuickReply('Current traffic situation')">
                          🚦 Traffic Update
                        </button>
                        <button @click="useQuickReply('Emergency contacts')">
                          🆘 Emergency Help
                        </button>
                      </div>
                    </div>

                    <!-- Typing indicator -->
                    <div v-if="chatbotLoading" class="chatbot-typing">
                      <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      Assistant is typing...
                    </div>
                  </div>

                  <!-- Input area -->
                  <div class="chatbot-input-area">
                    <div class="chatbot-input-wrapper">
                      <textarea
                        ref="chatInput"
                        v-model="chatbotInput"
                        placeholder="Type your message..."
                        rows="1"
                        @input="adjustTextareaHeight"
                        @keydown="handleKeyDown"
                        :disabled="chatbotLoading"
                      ></textarea>
                      <button
                        @click="sendChatbotMessage"
                        class="btn-send"
                        :disabled="!chatbotInput.trim() || chatbotLoading"
                      >
                        <span v-if="!chatbotLoading">Send</span>
                        <span v-else class="sending">...</span>
                      </button>
                    </div>
                    <div class="input-hint">
                      Press Enter to send • Shift+Enter for new line
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ===== PROFILE ===== -->
          <div v-else class="card">
            <div class="profile-card">
              <h2 class="profile-title">User Profile</h2>
              <div class="profile-avatar">
                <div class="avatar-wrapper">
                  <img :src="avatarUrl" class="avatar-img" alt="Profile Picture" />
                </div>

                <label class="avatar-upload">
                  Change Photo
                  <input type="file" accept="image/*" @change="onAvatarChange" hidden />
                </label>
              </div>

              <div class="profile-grid">
                <div class="form-group">
                  <label>Full Name</label>
                  <input v-model="profile.full_name" type="text" />
                </div>

                <div class="form-group">
                  <label>Email (read-only)</label>
                  <input v-model="profile.email" type="email" disabled />
                </div>

                <div class="form-group">
                  <label>Contact Number</label>
                  <input v-model="profile.contact_number" type="text" />
                </div>

                <div class="form-group">
                  <label>Barangay</label>
                  <input v-model="profile.barangay" type="text" />
                </div>

                <div class="form-group full">
                  <label>Address</label>
                  <textarea v-model="profile.address"></textarea>
                </div>

                <div class="form-group">
                  <label>Emergency Contact Name</label>
                  <input v-model="profile.emergency_contact_name" type="text" />
                </div>

                <div class="form-group">
                  <label>Emergency Contact Number</label>
                  <input v-model="profile.emergency_contact_number" type="text" />
                </div>
              </div>

              <div class="profile-actions">
                <button class="btn-save" @click="saveProfile">
                  Update Profile
                </button>
              </div>
            </div>
          </div>

          <!-- ===== GLOBAL MODALS (placed outside v-if but inside content) ===== -->
          <!-- Alert Map Modal -->
          <div
            v-if="showAlertMapModal"
            class="modal-overlay"
            @click.self="showAlertMapModal = false"
          >
            <div class="modal-content" style="max-width: 800px">
              <div class="modal-header">
                <h3>Alert Area</h3>
                <button class="modal-close" @click="showAlertMapModal = false">
                  ×
                </button>
              </div>
              <div class="modal-body">
                <div
                  id="alert-map"
                  style="height: 400px; width: 100%; border-radius: 8px"
                ></div>
              </div>
            </div>
          </div>

          <!-- Image Modal -->
          <div
            v-if="showImageModal"
            class="modal-overlay"
            @click.self="showImageModal = false"
          >
            <div class="modal-content" style="max-width: 600px">
              <div class="modal-header">
                <h3>Announcement Image</h3>
                <button class="modal-close" @click="showImageModal = false">
                  ×
                </button>
              </div>
              <div class="modal-body">
                <img
                  :src="modalImageUrl"
                  style="width: 100%; border-radius: 8px"
                />
              </div>
            </div>
          </div>


          <!-- Report Details Modal -->
<div v-if="showReportModal" class="modal-overlay" @click.self="showReportModal = false">
  <div class="modal-content" style="max-width: 700px;">
    <div class="modal-header">
      <h3>Incident Details</h3>
      <button class="modal-close" @click="showReportModal = false">×</button>
    </div>
    <div class="modal-body">
      <div v-if="loadingReportDetails" class="loading">Loading details...</div>
      <div v-else-if="selectedReport" class="report-details">
        <!-- Basic info -->
        <div class="detail-row">
          <strong>ID:</strong> #{{ selectedReport.id }}
        </div>
        <div class="detail-row">
          <strong>Type:</strong> {{ selectedReport.incident_type || 'Unknown' }}
        </div>
        <div class="detail-row">
          <strong>Severity:</strong>
          <span class="severity-badge" :class="selectedReport.severity?.toLowerCase()">
            {{ selectedReport.severity || 'N/A' }}
          </span>
        </div>
        <div class="detail-row">
          <strong>Status:</strong>
          <span class="status-badge" :class="selectedReport.status">
            {{ selectedReport.status || 'pending' }}
          </span>
        </div>
        <div class="detail-row">
          <strong>Location:</strong> {{ selectedReport.barangay || 'Unknown' }}
          <span v-if="selectedReport.address"> ({{ selectedReport.address }})</span>
        </div>
        <div class="detail-row">
          <strong>Description:</strong>
          <p>{{ selectedReport.description }}</p>
        </div>
        <div class="detail-row">
          <strong>Reported at:</strong> {{ new Date(selectedReport.created_at).toLocaleString() }}
        </div>
        <div class="detail-row">
          <strong>Your Contact:</strong> {{ selectedReport.contact_number || 'Not provided' }}
        </div>
        <div class="detail-row" v-if="selectedReport.emergency_contact">
          <strong>Emergency Contact:</strong> {{ selectedReport.emergency_contact }}
        </div>

        <div v-if="selectedReport && (selectedReport.latitude && selectedReport.longitude)" class="detail-row">
          <strong>📍 Location Map:</strong>
          <div id="incident-map" style="height:300px;width:100%;border-radius:8px;margin-top:8px;background:#f8fafc;"></div>
          
          <!-- Responder ETA -->
          <div v-if="selectedReport.responderLocation" class="eta-info" style="margin-top:8px;padding:8px;background:#f1f5f9;border-radius:6px;">
            <span>🚑 Responder ETA: <strong>{{ etaText(selectedReport) }}</strong></span>
            <span style="margin-left:12px;font-size:0.8rem;color:#64748b;">
              (last update: {{ new Date(selectedReport.responderLocation.updated_at).toLocaleTimeString() }})
            </span>
          </div>
          
          <!-- Responder location unavailable -->
          <div v-else-if="selectedReport.assigned_to" style="margin-top:8px;padding:10px;background:#fef3c7;border-radius:6px;color:#92400e;border:1px solid #fcd34d;display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
            <span>⚠️ Responder location not yet available</span>
            <button 
              @click="refreshResponderLocation" 
              class="btn-small" 
              style="background:#f97316;color:white;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;"
              :disabled="refreshingLocation"
            >
              {{ refreshingLocation ? '⏳ Refreshing...' : '🔄 Refresh' }}
            </button>
          </div>
          
          <!-- No responder assigned -->
          <div v-else-if="selectedReport.assigned_to === null" style="margin-top:8px;padding:8px;background:#f3f4f6;border-radius:6px;color:#6b7280;">
            📋 No responder assigned to this incident yet.
          </div>
        </div>

        <!-- AI Analysis (if available) -->
        <div v-if="selectedReport.text_analysis" class="detail-row">
          <strong>🤖 AI Analysis:</strong>
          <div>Predicted type: {{ selectedReport.text_analysis.incident_type }} 
            ({{ (selectedReport.text_analysis.type_confidence * 100).toFixed(0) }}% confidence)
          </div>
          <div>Predicted severity: {{ selectedReport.text_analysis.severity }}
            ({{ (selectedReport.text_analysis.severity_confidence * 100).toFixed(0) }}% confidence)
          </div>
        </div>

        <!-- Images (if any) -->
        <div v-if="parseMediaArray(selectedReport.image_paths).length > 0" class="detail-row">
          <strong>📷 Images:</strong>
          <div class="media-list">
            <div v-for="(img, idx) in parseMediaArray(selectedReport.image_paths)" :key="idx" class="media-thumb">
              <img :src="getFullImageUrl(img)" @error="handleImageError" @click="openImageModal(getFullImageUrl(img))" />
            </div>
          </div>
        </div>

        <!-- Videos (if any) -->
        <div v-if="parseMediaArray(selectedReport.video_paths).length > 0" class="detail-row">
          <strong>🎥 Videos:</strong>
          <div class="media-list">
            <video v-for="(vid, idx) in parseMediaArray(selectedReport.video_paths)" :key="idx" controls :src="getFullImageUrl(vid)" style="max-width: 200px; margin-right: 8px;"></video>
          </div>
        </div>
              </div>
              <div v-else class="no-data">Unable to load incident details.</div>
            </div>
            <div class="modal-actions">
              <button class="btn btn-outline" @click="showReportModal = false">Close</button>
            </div>
          </div>
        </div>
        </section>
        <!-- end content -->
      </div>
      <!-- end layout -->
    </main>

    <!-- ========== FOOTER ========== -->
    <footer class="footer">
      <div class="footer-inner">
        <span>© {{ new Date().getFullYear() }} RESQAPP • Calapan City</span>
      </div>
    </footer>
  </div>
  <!-- end page -->
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
  height: 100vh;          /* full viewport height */
  overflow: hidden;       /* prevent page scroll */
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

.btn-outline,
.btn-outline-blue {
  background: transparent;
  border: 2px solid #2a5298;
  color: #2a5298;
}

.btn-outline:hover,
.btn-outline-blue:hover {
  background: #2a5298;
  color: white;
}

.btn-outline-blue {
  border-color: #2a5298;
  color: #2a5298;
}

.btn-outline-blue:hover {
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
}

.hamburger {
  display: none;
  flex-direction: column;
  justify-content: space-around;
  width: 2rem;
  height: 2rem;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  z-index: 50;
}

.hamburger span {
  width: 2rem;
  height: 0.25rem;
  background: #2a5298;
  border-radius: 10px;
  transition: all 0.3s;
}

.brand {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.seal-wrap {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.seal {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-weight: 700;
  font-size: 1.25rem;
  background: linear-gradient(135deg, #1e3c72, #f97316);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.brand-subtitle {
  font-size: 0.75rem;
  color: #64748b;
}

.right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.role {
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  background: #e2e8f0;
  color: #334155;
}

.role.admin {
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: white;
}

.role.responder {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
}

/* ===== MAIN LAYOUT ===== */
.main {
  flex: 1;
  max-width: 1400px;
  width: 100%;
  margin: 2rem auto;
  padding: 0 2rem;
  min-height: 0; 
    display: flex;
  flex-direction: column;
   overflow: visible; 
}

.layout {
    flex: 1;
  min-height: 0;
  display: flex;
  gap: 2rem;
  position: relative;
  overflow: hidden;    
}

/* ===== SIDE NAVIGATION ===== */
.nav {
  width: 220px;
  flex-shrink: 0;
  background: white;
  border-radius: 1rem;
  padding: 1.5rem 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  height: fit-content;
  position: sticky;
  
  align-self: start;     
}

.navbtn {
  width: 100%;
  text-align: left;
  padding: 0.75rem 1rem;
  border: none;
  background: transparent;
  border-radius: 0.5rem;
  font-weight: 500;
  color: #475569;
  transition: all 0.2s;
  cursor: pointer;
  font-size: 0.95rem;
}

.navbtn:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.navbtn.on {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
  font-weight: 600;
  box-shadow: 0 4px 8px rgba(30, 60, 114, 0.3);
}

/* Mobile navigation */
.nav-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 45;
  backdrop-filter: blur(2px);
}

@media (max-width: 639px) {

   body {
    overflow-x: hidden;
  }
  .hamburger {
    display: flex;
  }

  .nav {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 260px;
    z-index: 50;
    border-radius: 20px;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }

  .nav.mobile-open {
    transform: translateX(0);
  }
/* ===== CONTENT AREA ===== */
.content {
  flex: 1;
  overflow-y: auto; 
  min-width: 0;
  margin-top: 0;
  
}
/* Optional: if you have any Leaflet controls that still peek, increase further */
.leaflet-pane,
.leaflet-control {
  z-index: 400 !important;
}

.leaflet-top,
.leaflet-bottom {
  z-index: 450 !important;
} 
/* ===== CONTENT AREA ===== */
.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;       /* makes the content area scrollable */
  padding-right: 4px;  
 
}

.card {
  background: white;
  border-radius: 1.5rem;
  padding: 2rem;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.03);
  margin-bottom: 2rem;
}

/* ===== OVERVIEW GRID ===== */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
  margin-top: 2rem;
}

.mini {
  background: #f8fafc;
  border-radius: 1rem;
  padding: 1.5rem;
  border: 1px solid #e9eef2;
  transition: transform 0.2s, box-shadow 0.2s;
}

.mini:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -8px rgba(0, 0, 0, 0.1);
  border-color: #2a5298;
}

.miniTitle {
  font-weight: 700;
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
  color: #1e293b;
}

.miniText {
  color: #64748b;
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}

/* ===== FORMS ===== */
.form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 800px;
}

.label {
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
  display: block;
  color: #334155;
}

.required {
  color: #f97316;
}

.input,
textarea,
select {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  font-size: 1rem;
  transition: all 0.2s;
  background: white;
}

.input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: #2a5298;
  box-shadow: 0 0 0 3px rgba(42, 82, 152, 0.1);
}

textarea {
  resize: vertical;
  min-height: 100px;
}

.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.word-count {
  font-size: 0.8rem;
  color: #94a3b8;
  text-align: right;
  margin-top: 0.25rem;
}

/* ===== AI ANALYSIS PREVIEW ===== */
.ai-analysis-preview {
  background: linear-gradient(135deg, #f0f4ff, #e6f0ff);
  border-radius: 1rem;
  padding: 1.5rem;
  margin-bottom: 2rem;
  border-left: 4px solid #f97316;
}

.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.ai-badge {
  background: #f97316;
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
}

.ai-confidence {
  font-size: 0.9rem;
  color: #1e3c72;
  font-weight: 600;
}

.ai-content {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}

.ai-type-section,
.ai-severity {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.type-display {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ai-type-badge {
  background: white;
  padding: 0.35rem 1rem;
  border-radius: 999px;
  font-weight: 600;
  color: #1e3c72;
  border: 1px solid #2a5298;
}

.btn-edit-type {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: #64748b;
}

.type-edit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.type-select {
  width: auto;
  min-width: 180px;
}

.edit-actions {
  display: flex;
  gap: 0.25rem;
}

.btn-save-type,
.btn-cancel-type {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
}

.btn-save-type {
  background: #10b981;
  color: white;
}

.btn-cancel-type {
  background: #ef4444;
  color: white;
}

.severity-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
}

.severity-badge.low {
  background: #dbeafe;
  color: #1e3c72;
}
.severity-badge.medium {
  background: #fed7aa;
  color: #9a3412;
}
.severity-badge.high {
  background: #fee2e2;
  color: #b91c1c;
}
.severity-badge.critical {
  background: #fecaca;
  color: #7f1d1d;
}

.ai-keywords {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.keyword-tag {
  background: white;
  padding: 0.2rem 0.8rem;
  border-radius: 999px;
  font-size: 0.8rem;
  border: 1px solid #e2e8f0;
}

/* ===== LOCATION PICKER ===== */
.location-picker {
  background: #f8fafc;
  border-radius: 0.75rem;
  padding: 1rem;
  border: 1px dashed #94a3b8;
}

.location-summary {
  font-size: 0.95rem;
  color: #334155;
  margin-bottom: 0.75rem;
}

.location-summary.not-set {
  color: #94a3b8;
  font-style: italic;
}

.location-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.btn-location {
  background: none;
  border: 1px solid #2a5298;
  color: #2a5298;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-location:hover {
  background: #2a5298;
  color: white;
}

/* ===== MEDIA UPLOAD ===== */
.media-upload {
  border: 2px dashed #e2e8f0;
  border-radius: 1rem;
  padding: 1.5rem;
  background: #f9fbfd;
}

.upload-buttons {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.btn-upload {
  background: white;
  border: 1px solid #cbd5e1;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.btn-upload:hover {
  border-color: #2a5298;
  color: #2a5298;
}

.media-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1rem;
}

.media-item {
  width: 150px;
  background: white;
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0,0,0,0.05);
}

.media-thumbnail {
  position: relative;
  height: 100px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-thumbnail {
  font-size: 2rem;
}

.btn-remove-media {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
}

.media-info {
  padding: 0.5rem;
}

.media-name {
  font-size: 0.8rem;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-size {
  font-size: 0.7rem;
  color: #64748b;
}

/* ===== AI RECOMMENDATIONS ===== */
.ai-recommendations {
  background: #f0f9ff;
  border-radius: 1rem;
  padding: 1rem 1.5rem;
  border-left: 4px solid #f97316;
}

.ai-recommendations h4 {
  margin-bottom: 0.5rem;
  color: #1e3c72;
}

.ai-recommendations ul {
  list-style: disc;
  padding-left: 1.5rem;
  color: #334155;
}

/* ===== ACTIONS ===== */
.actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

.submission-status {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-weight: 500;
}

.submission-status.success {
  background: #d1fae5;
  color: #065f46;
}
.submission-status.error {
  background: #fee2e2;
  color: #b91c1c;
}

/* ===== MODAL ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: white;
  border-radius: 1.5rem;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 20px 40px rgba(0,0,0,0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h3 {
  font-size: 1.3rem;
  font-weight: 600;
  color: #1e3c72;
}

.modal-close {
  background: none;
  border: none;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  color: #94a3b8;
}

.modal-body {
  padding: 2rem;
}

.modal-actions {
  padding: 1rem 2rem 2rem;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}

.map-modal .modal-content {
  max-width: 800px;
}

.picker-map,
#alert-map {
  height: 400px;
  width: 100%;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.selected-coords {
  text-align: center;
  font-size: 0.9rem;
  color: #334155;
}

/* ===== ANNOUNCEMENTS ===== */
.announcements-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.announcement-card {
  background: #f8fafc;
  border-radius: 1rem;
  padding: 1.5rem;
  border-left: 4px solid #94a3b8;
  transition: box-shadow 0.2s;
}

.announcement-card.low {
  border-left-color: #3b82f6;
}
.announcement-card.medium {
  border-left-color: #f97316;
}
.announcement-card.high {
  border-left-color: #ef4444;
}
.announcement-card.critical {
  border-left-color: #7f1d1d;
}

.announcement-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.announcement-time {
  font-size: 0.8rem;
  color: #64748b;
}

.announcement-message {
  font-size: 1rem;
  margin-bottom: 1rem;
  color: #1e293b;
}

.announcement-image {
  margin: 1rem 0;
  border-radius: 0.5rem;
  overflow: hidden;
  cursor: pointer;
  max-height: 200px;
}

.announcement-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.announcement-map-btn {
  background: #eef2ff;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  color: #1e3c72;
  border: 1px solid #cbd5e1;
}

.empty-announcements {
  text-align: center;
  padding: 3rem;
  color: #94a3b8;
  background: #f8fafc;
  border-radius: 1rem;
}

/* ===== MAP PAGE ===== */
.mapTop {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.mapActions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.mapStatus {
  background: #f1f5f9;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  color: #475569;
}

.mapFrame {
  height: 500px;
  border-radius: 1rem;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.map {
  width: 100%;
  height: 100%;
  z-index: 40;
}

.mapHint {
  margin-top: 0.75rem;
  font-size: 0.85rem;
  color: #64748b;
  font-style: italic;
}

/* Route Panel */
.route-panel {
  background: white;
  border-radius: 1rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  border: 1px solid #e2e8f0;
}

.route-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.route-header h3 {
  font-size: 1.2rem;
  font-weight: 600;
  color: #1e3c72;
}

.btn-clear-route {
  background: none;
  border: 1px solid #cbd5e1;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
}

.route-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.input-with-actions {
  display: flex;
  gap: 0.5rem;
}

.input-with-actions .input {
  flex: 1;
}

.input-actions {
  display: flex;
  gap: 0.25rem;
}

.btn-small {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}

.btn-small.active {
  background: #2a5298;
  color: white;
  border-color: #2a5298;
}

.route-actions {
  margin-top: 0.5rem;
}

.ai-loading {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: #f0f9ff;
  border-radius: 0.5rem;
}

.ai-spinner {
  width: 20px;
  height: 20px;
  border: 3px solid #e2e8f0;
  border-top-color: #f97316;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.live-traffic-info {
  background: #f1f5f9;
  padding: 1rem;
  border-radius: 0.5rem;
}

.traffic-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.traffic-level {
  font-weight: 600;
}
.traffic-level.low { color: #10b981; }
.traffic-level.medium { color: #f97316; }
.traffic-level.high { color: #ef4444; }

.eta-info {
  display: flex;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.eta-delay {
  color: #ef4444;
}

.route-alerts {
  background: #fff7ed;
  padding: 1rem;
  border-radius: 0.5rem;
}

.alerts-header h5 {
  margin-bottom: 0.5rem;
  color: #9a3412;
}

.alert-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #fed7aa;
}

.alert-item.high .alert-icon {
  color: #ef4444;
}

.route-info {
  background: #f8fafc;
  padding: 1rem;
  border-radius: 0.5rem;
}

.route-stats {
  display: flex;
  justify-content: space-around;
  margin-bottom: 1rem;
}

.stat {
  text-align: center;
}

.stat-label {
  font-size: 0.8rem;
  color: #64748b;
}

.stat-value {
  font-weight: 700;
  font-size: 1.2rem;
}

.stat-value.warning {
  color: #f97316;
}

.alternatives {
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
}

.alt-title {
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.alt-route {
  padding: 0.25rem 0;
  font-size: 0.9rem;
}

.alt-route.best {
  color: #10b981;
  font-weight: 600;
}

.time-saving {
  color: #10b981;
  font-size: 0.8rem;
}

.route-error {
  color: #ef4444;
  background: #fee2e2;
  padding: 0.75rem;
  border-radius: 0.5rem;
}

/* ===== MY REPORTS ===== */
.reports-container {
  background: white;
  border-radius: 1.5rem;
  padding: 2rem;
  box-shadow: 0 8px 20px rgba(0,0,0,0.03);
}

.reports-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.reports-title {
  font-size: 1.8rem;
  font-weight: 700;
  background: linear-gradient(135deg, #1e3c72, #f97316);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.reports-subtitle {
  color: #64748b;
}

.btn-new-report {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: transform 0.2s, box-shadow 0.2s;
}

.btn-new-report:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px -4px rgba(30, 60, 114, 0.4);
}

.btn-icon {
  font-size: 1.5rem;
  line-height: 1;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: #f8fafc;
  border-radius: 1rem;
  padding: 1.5rem 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  border: 1px solid #e9eef2;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.stat-icon.total {
  background: #dbeafe;
  color: #1e3c72;
}
.stat-icon.pending {
  background: #fed7aa;
  color: #9a3412;
}
.stat-icon.in-progress {
  background: #cffafe;
  color: #0e7490;
}
.stat-icon.resolved {
  background: #d1fae5;
  color: #065f46;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  font-size: 0.8rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.search-filter-bar {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

.search-box {
  flex: 2;
  min-width: 250px;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 1rem;
  color: #94a3b8;
}

.search-input {
  width: 100%;
  padding: 0.75rem 1rem 0.75rem 2.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  font-size: 0.95rem;
}

.clear-search {
  position: absolute;
  right: 1rem;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 1.2rem;
}

.filter-select {
  padding: 0.75rem 2rem 0.75rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: white;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20' stroke='%23475569'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1.2rem;
}

.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.skeleton-row {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: #f1f5f9;
  border-radius: 0.5rem;
  animation: pulse 1.5s infinite;
}

.skeleton-cell {
  height: 1rem;
  background: #e2e8f0;
  border-radius: 0.25rem;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  background: #f8fafc;
  border-radius: 1rem;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.6;
}

.empty-state h3 {
  font-size: 1.3rem;
  margin-bottom: 0.5rem;
  color: #334155;
}

.empty-state p {
  color: #94a3b8;
  margin-bottom: 1.5rem;
}

.btn-clear-filters {
  background: none;
  border: 1px solid #2a5298;
  color: #2a5298;
  padding: 0.5rem 1.5rem;
  border-radius: 999px;
  cursor: pointer;
}

.reports-table-container {
  overflow-x: auto;
}

.reports-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.reports-table th {
  text-align: left;
  padding: 1rem 0.75rem;
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  border-bottom: 2px solid #e2e8f0;
}

.reports-table td {
  padding: 1rem 0.75rem;
  border-bottom: 1px solid #e9eef2;
  vertical-align: middle;
}

.report-row:hover {
  background: #f1f5f9;
}

.report-id {
  font-family: monospace;
  font-weight: 600;
  color: #1e3c72;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
}

.badge.severity {
  background: #f1f5f9;
  color: #334155;
}
.badge.severity.low { background: #dbeafe; color: #1e3c72; }
.badge.severity.medium { background: #fed7aa; color: #9a3412; }
.badge.severity.high { background: #fee2e2; color: #b91c1c; }
.badge.severity.critical { background: #fecaca; color: #7f1d1d; }

.badge.status {
  background: #f1f5f9;
}
.badge.status.pending { background: #fed7aa; color: #92400e; }
.badge.status.in-progress { background: #cffafe; color: #0e7490; }
.badge.status.resolved { background: #d1fae5; color: #065f46; }

.btn-view {
  background: none;
  border: 1px solid #cbd5e1;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: #334155;
  transition: all 0.2s;
}

.btn-view:hover {
  background: #1e3c72;
  color: white;
  border-color: #1e3c72;
}

/* ===== CHAT ===== */
.chat-layout {
  display: flex;
  gap: 1.5rem;
  height: calc(100vh - 200px);
  min-height: 500px;
}
.chat-history-sidebar {
  width: 280px;
  background: white;
  border-radius: 1rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 0.5rem;
}

.sidebar-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1e3c72;
}

.btn-new-chat {
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: white;
  border: none;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.chat-history-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chat-history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: #f8fafc;
  cursor: pointer;
  transition: background 0.2s;
}

.chat-history-item:hover {
  background: #f1f5f9;
}

.chat-history-item.active {
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
  border-left: 4px solid #f97316;
}

.chat-item-content {
  flex: 1;
  overflow: hidden;
}

.chat-summary {
  font-weight: 600;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.25rem;
}

.chat-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: #64748b;
}

.btn-delete-chat {
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  opacity: 0.6;
  padding: 0.25rem;
}

.btn-delete-chat:hover {
  opacity: 1;
}

.empty-history {
  text-align: center;
  padding: 2rem;
  color: #94a3b8;
  font-size: 0.9rem;
}

.chat-main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 1rem;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
}

.chat-main-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.btn-toggle-sidebar {
  background: none;
  border: 1px solid #cbd5e1;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
  display: none;
}

.chat-title {
  flex: 1;
  font-size: 1.2rem;
  font-weight: 600;
  color: #1e3c72;
}

.chat-header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-clear,
.btn-new-chat-header {
  background: none;
  border: 1px solid #e2e8f0;
  padding: 0.25rem 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-new-chat-header {
  background: #1e3c72;
  color: white;
  border-color: #1e3c72;
}

.chatbot-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  box-shadow: none;
  padding: 1rem;
  min-height: 0;  
}

.chatbot-header {
  margin-bottom: 1rem;
}

.chatbot-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;          /* important for flex children to shrink */
}

.chatbot-messages {
  flex: 1;
  overflow-y: auto;
  padding-right: 0.5rem;
  margin-bottom: 1rem;
  min-height: 0;     
}

.chatbot-message {
  margin-bottom: 1rem;
  max-width: 80%;
}

.chatbot-message.user {
  margin-left: auto;
  text-align: right;
}

.message-content {
  display: inline-block;
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  background: #f1f5f9;
  color: #1e293b;
}

.chatbot-message.user .message-content {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
}

.message-time {
  font-size: 0.7rem;
  color: #94a3b8;
  margin-top: 0.25rem;
}

.chatbot-quick-replies {
  margin: 1rem 0;
}

.quick-replies-title {
  font-size: 0.85rem;
  color: #64748b;
  margin-bottom: 0.5rem;
}

.quick-replies-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.quick-replies-buttons button {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-replies-buttons button:hover {
  background: #e2e8f0;
}

.chatbot-typing {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #64748b;
}

.typing-dots {
  display: flex;
  gap: 0.2rem;
}

.typing-dots span {
  width: 6px;
  height: 6px;
  background: #94a3b8;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}

.chatbot-input-area {
  flex-shrink: 0;         /* prevent it from being squeezed */
  border-top: 1px solid #e2e8f0;
  padding: 1rem 0 0 0;
  background: white;
  margin-bottom: -1rem; 
}

.chatbot-input-wrapper {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}

.chatbot-input-wrapper textarea {
  flex: 1;
  min-height: 44px !important;   /* force visible height */
  height: auto !important;        /* let it grow naturally */
  resize: none;
  padding: 0.75rem 1rem;
  border-radius: 20px;        /* softer, not full pill */
  border: 1px solid #e2e8f0;
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.5;
  background: white;
}

.btn-send {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  font-size: 0.7rem;
  color: #94a3b8;
  margin-top: 0.25rem;
  text-align: right;
}

/* ===== PROFILE ===== */
.profile-card {
  max-width: 800px;
  margin: 0 auto;
}

.profile-title {
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #1e3c72, #f97316);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 2rem;
  text-align: center;
}

.profile-avatar {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 2rem;
}

.avatar-wrapper {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  border: 4px solid white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  margin-bottom: 1rem;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-upload {
  background: #f1f5f9;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-size: 0.9rem;
  cursor: pointer;
  border: 1px solid #cbd5e1;
  transition: all 0.2s;
}

.avatar-upload:hover {
  background: #e2e8f0;
}

.profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.form-group.full {
  grid-column: span 2;
}

.form-group label {
  display: block;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
  color: #334155;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  font-size: 1rem;
  background: #f9fbfd;
}

.form-group input:disabled {
  background: #f1f5f9;
  color: #64748b;
}

.profile-actions {
  display: flex;
  justify-content: center;
}

.btn-save {
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
  border: none;
  padding: 0.75rem 3rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 1.1rem;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.btn-save:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px -4px rgba(30, 60, 114, 0.4);
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

/* ===== RESPONSIVE TWEAKS ===== */
@media (max-width: 1023px) {
  .layout {
    flex-direction: column;
  }
  .nav {
    width: 100%;
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    padding: 1rem;
  }
  .navbtn {
    width: auto;
  }
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 767px) {
  .topbar-inner {
    padding: 0.75rem 1rem;
  }
  .brand-text {
    display: none;
  }
  .main {
    padding: 0 1rem;
  }
  .two {
    grid-template-columns: 1fr;
  }
  .profile-grid {
    grid-template-columns: 1fr;
  }
  .form-group.full {
    grid-column: span 1;
  }
  .chat-layout {
    flex-direction: column;
    height: auto;
  }
  .chat-history-sidebar {
    width: 100%;
    height: 300px;
  }
  .btn-toggle-sidebar {
    display: inline-flex;
  }
  .chat-history-sidebar.hidden {
    display: none;
  }
  .mapTop {
    flex-direction: column;
  }
  .mapActions {
    width: 100%;
    justify-content: stretch;
  }
  .mapActions .btn {
    flex: 1;
  }
}

@media (max-width: 479px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .right .role {
    display: none;
  }
}

/* ===== LEGAL COMPLIANCE ===== */
.legal-search-wrap { position: relative; display: flex; align-items: center; margin-bottom: 1.5rem; }
.legal-search-icon { position: absolute; left: 1rem; color: #94a3b8; font-size: 1rem; }
.legal-search-input { width: 100%; padding: 0.75rem 1rem 0.75rem 2.75rem; border: 1.5px solid #e2e8f0; border-radius: 999px; font-size: 0.95rem; outline: none; transition: border-color 0.2s; background: white; }
.legal-search-input:focus { border-color: #2a5298; box-shadow: 0 0 0 3px rgba(42,82,152,0.08); }
.legal-search-clear { position: absolute; right: 1rem; background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 1.1rem; padding: 0; line-height: 1; }
.legal-grid { display: flex; flex-direction: column; gap: 1rem; }
.legal-entry-card { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #2a5298; border-radius: 1rem; padding: 1.25rem 1.5rem; transition: box-shadow 0.2s, transform 0.2s; }
.legal-entry-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.07); transform: translateY(-2px); }
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

/* Transport Mode Selector */
.mode-selector {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.mode-btn {
  flex: 1;
  min-width: 70px;
  padding: 0.5rem 0.75rem;
  border: 2px solid #e2e8f0;
  background: white;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.mode-btn:hover {
  border-color: #2a5298;
  background: #f0f4ff;
}

.mode-btn.active {
  border-color: #2a5298;
  background: linear-gradient(135deg, #1e3c72, #2a5298);
  color: white;
}

.mode-icon {
  font-size: 1.3rem;
}

.mode-label {
  font-weight: 500;
}

.mode-hint {
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: #f8fafc;
  border-radius: 0.5rem;
}

/* Report detail modal media */
.media-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.media-thumb {
  width: 100px;
  height: 100px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid #e2e8f0;
}
.media-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.detail-row {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}
.detail-row strong {
  display: inline-block;
  width: 140px;
  color: #1e293b;
}
.detail-row p {
  margin-top: 4px;
  color: #475569;
  line-height: 1.5;
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

#user-map,
#incident-map,
#alert-map,
#location-picker-map {
  touch-action: none;        /* prevents scroll interference */
}

</style>
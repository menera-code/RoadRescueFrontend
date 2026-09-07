<script setup>
// ============================================================
//  IMPORTS
// ============================================================
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  onMounted,
  reactive,
} from "vue";
import { useRouter } from "vue-router";
import calapanLogo from "@/assets/logos/calapan.png";
import L from "leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import api from "@/api/client";
import { useAutoRefresh } from "@/composables/useAutoRefresh";

// ============================================================
//  ROUTER & AUTH
// ============================================================
const router = useRouter();
const active = ref("dashboard");
const role = "Administrator";
const roleClass = computed(() => "role-admin");

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
};

// ============================================================
//  NOTIFICATION SYSTEM
// ============================================================
const showNotification = (message, type = "info") => {
  const notification = document.createElement("div");
  notification.className = `admin-notification ${type}`;
  notification.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">×</button>
  `;
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px;
    background: ${type === "success" ? "#10b981" : type === "error" ? "#dc2626" : "#0b4fa3"};
    color: white; padding: 12px 16px; border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 9999;
    display: flex; align-items: center; gap: 10px;
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove?.(), 3000);
};

// ============================================================
//  DASHBOARD STATS
// ============================================================
const dashboardStats = ref({
  totalIncidents: 0,
  pending: 0,
  inProgress: 0,
  resolved: 0,
  totalUsers: 0,
  citizens: 0,
  tmoOfficers: 0,
  responders: 0,
  administrators: 0,
  recentIncidents: [],
});

const loadDashboardStats = async () => {
  try {
    const res = await api.get("/admin/dashboard/stats");
    dashboardStats.value = {
      totalIncidents: res.data.total_incidents || 0,
      pending: res.data.pending || 0,
      inProgress: res.data.in_progress || 0,
      resolved: res.data.resolved || 0,
      totalUsers: res.data.total_users || 0,
      citizens: res.data.citizens || 0,
      tmoOfficers: res.data.tmoOfficers || 0,
      responders: res.data.responders || 0,
      administrators: res.data.administrators || 0,
      recentIncidents: res.data.recent_incidents || [],
    };
  } catch (error) {
    console.error("Failed to load dashboard stats:", error);
  }
};

const todaysIncidents = computed(() => {
  const today = new Date().toDateString();
  return (dashboardStats.value.recentIncidents || []).filter(
    (i) => new Date(i.created_at).toDateString() === today
  ).length;
});

const totalVehicleCount = computed(() => {
  return analyticsData.value.vehicleTypes.reduce((sum, item) => sum + item.count, 0);
});

const maxBarangayPeriodCount = computed(() => {
  const all = analyticsData.value.barangayTrends.flatMap(b => [b.today, b.week, b.month]);
  return all.length ? Math.max(...all, 1) : 1;
});

const resolutionRate = computed(() => {
  if (dashboardStats.value.totalIncidents === 0) return 0;
  return ((dashboardStats.value.resolved / dashboardStats.value.totalIncidents) * 100).toFixed(0);
});

const criticalCount = computed(() => {
  return (dashboardStats.value.recentIncidents || []).filter(
    (i) => i.severity?.toLowerCase() === "critical"
  ).length;
});

// ============================================================
//  INCIDENTS MANAGEMENT (with pagination & sorting)
// ============================================================
const allIncidents = ref([]);
const incidentsLoading = ref(false);
const incidentsFilter = ref("all");
const selectedIncident = ref(null);
const showIncidentModal = ref(false);
const incidentDetails = ref(null);
const loadingIncident = ref(false);

// Pagination for incidents
const incidentsPagination = reactive({
  currentPage: 1,
  perPage: 10,
  total: 0,
});
const totalIncidentsPages = computed(() => Math.ceil(incidentsPagination.total / incidentsPagination.perPage) || 1);

// Sorted and paginated incidents
const paginatedIncidents = computed(() => {
  const sorted = [...allIncidents.value].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  incidentsPagination.total = sorted.length;
  const start = (incidentsPagination.currentPage - 1) * incidentsPagination.perPage;
  const end = start + incidentsPagination.perPage;
  return sorted.slice(start, end);
});

const severityColors = { critical: "#dc2626", high: "#f59e0b", medium: "#3b82f6", low: "#10b981" };
const statusColors = { pending: "#f59e0b", "in-progress": "#3b82f6", resolved: "#10b981" };

const loadAllIncidents = async () => {
  incidentsLoading.value = true;
  try {
    const params = { status: incidentsFilter.value !== "all" ? incidentsFilter.value : undefined };
    const res = await api.get("/admin/incidents", { params });
    allIncidents.value = res.data.map((inc) => ({
      ...inc,
      assigned_to: inc.assigned_to != null ? Number(inc.assigned_to) : null,
    }));
    incidentsPagination.currentPage = 1; // reset to first page on filter change
  } catch (error) {
    console.error("Failed to load incidents:", error);
  } finally {
    incidentsLoading.value = false;
  }
};

const updateIncidentStatus = async (incidentId, status) => {
  try {
    await api.put(`/admin/incidents/${incidentId}/status`, { status });
    await loadAllIncidents();
    await loadDashboardStats();
    showNotification(`Incident status updated to ${status}`, "success");
  } catch (error) {
    console.error("Failed to update incident:", error);
    showNotification("Failed to update incident", "error");
  }
};

const approveIncidentFromList = async (incidentId) => {
  try {
    await api.post(`/admin/incidents/${incidentId}/approve`);
    showNotification("Incident approved and marked in-progress", "success");
    await loadAllIncidents();
  } catch (error) {
    console.error("Approval failed:", error);
    showNotification("Failed to approve incident", "error");
  }
};

const resolveIncidentFromList = async (incidentId) => {
  try {
    await api.put(`/admin/incidents/${incidentId}/status?status=resolved`);
    showNotification("Incident marked as resolved", "success");
    await loadAllIncidents();
  } catch (error) {
    console.error("Resolution failed:", error);
    showNotification("Failed to resolve incident", "error");
  }
};

const viewIncidentDetails = async (incidentId) => {
  loadingIncident.value = true;
  showIncidentModal.value = true;
  try {
    const [detailsRes, mediaRes] = await Promise.all([
      api.get(`/admin/incidents/${incidentId}`),
      api.get(`/admin/incidents/${incidentId}/media-analysis`),
    ]);
    incidentDetails.value = { ...detailsRes.data, ...mediaRes.data };
  } catch (error) {
    console.error("Failed to load incident details:", error);
    showNotification("Could not load incident details", "error");
    showIncidentModal.value = false;
    incidentDetails.value = null;
  } finally {
    loadingIncident.value = false;
  }
};

const approveIncident = async () => {
  if (!incidentDetails.value) return;
  await approveIncidentFromList(incidentDetails.value.id);
  showIncidentModal.value = false;
};

const declineIncident = async () => {
  if (!incidentDetails.value) return;
  if (!confirm("Are you sure you want to permanently delete this incident?")) return;
  try {
    await api.delete(`/admin/incidents/${incidentDetails.value.id}`);
    showNotification("Incident deleted", "success");
    showIncidentModal.value = false;
    await loadAllIncidents();
  } catch (error) {
    console.error("Deletion failed:", error);
    showNotification("Failed to delete incident", "error");
  }
};

const approveIncidentFromModal = approveIncident;
const resolveIncidentFromModal = async () => {
  if (!incidentDetails.value) return;
  await resolveIncidentFromList(incidentDetails.value.id);
  showIncidentModal.value = false;
};

// ============================================================
//  ASSIGNMENTS (with pagination & sorting)
// ============================================================
const assignmentsList = ref([]);
const assignmentsLoading = ref(false);
const assignmentsFilterResponder = ref("all");
const availableResponders = ref([]);

// Pagination for assignments
const assignmentsPagination = reactive({
  currentPage: 1,
  perPage: 10,
  total: 0,
});
const totalAssignmentsPages = computed(() => Math.ceil(assignmentsPagination.total / assignmentsPagination.perPage) || 1);

const paginatedAssignments = computed(() => {
  const sorted = [...assignmentsList.value].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  assignmentsPagination.total = sorted.length;
  const start = (assignmentsPagination.currentPage - 1) * assignmentsPagination.perPage;
  const end = start + assignmentsPagination.perPage;
  return sorted.slice(start, end);
});

const loadAssignments = async () => {
  assignmentsLoading.value = true;
  try {
    const params = {};
    if (assignmentsFilterResponder.value === "unassigned") params.assigned_to = "null";
    else if (assignmentsFilterResponder.value !== "all") params.assigned_to = assignmentsFilterResponder.value;
    const res = await api.get("/admin/incidents", { params });
    assignmentsList.value = res.data.map((inc) => ({
      ...inc,
      assigned_to: inc.assigned_to ? Number(inc.assigned_to) || null : null,
    }));
    assignmentsPagination.currentPage = 1;
  } catch (error) {
    console.error("Failed to load assignments:", error);
  } finally {
    assignmentsLoading.value = false;
  }
};

const loadResponders = async () => {
  try {
    const res = await api.get("/admin/responders");
    availableResponders.value = res.data.map((r) => ({ ...r, id: Number(r.id) }));
  } catch (error) {
    console.error("Failed to load responders:", error);
  }
};

const getResponderName = (responderId) => {
  if (!responderId) return "Unassigned";
  const responder = availableResponders.value.find((r) => r.id == responderId);
  return responder ? responder.name : `Responder #${responderId}`;
};

const assignToResponder = async (incidentId, responderId) => {
  let finalResponderId = null;
  if (responderId && responderId !== "null") {
    const num = Number(responderId);
    if (!isNaN(num)) finalResponderId = num;
  }

  const previousValue = allIncidents.value.find(i => i.id === incidentId)?.assigned_to ?? null;

  const updateIncident = (inc) => {
    if (inc.id === incidentId) inc.assigned_to = finalResponderId;
  };
  allIncidents.value.forEach(updateIncident);
  assignmentsList.value.forEach(updateIncident);

  try {
    const params = finalResponderId !== null ? { responder_id: finalResponderId } : {};
    const res = await api.post(`/admin/incidents/${incidentId}/assign`, null, { params });
    const newAssigned = res.data.assigned_to;

    if (newAssigned !== finalResponderId) {
      allIncidents.value.forEach(i => { if (i.id === incidentId) i.assigned_to = newAssigned; });
      assignmentsList.value.forEach(i => { if (i.id === incidentId) i.assigned_to = newAssigned; });
    }
    showNotification(finalResponderId ? "Assigned successfully" : "Unassigned successfully", "success");
  } catch (error) {
    console.error("Assignment error:", error);
    showNotification(`Assignment failed: ${error.response?.data?.detail || error.message}`, "error");
    allIncidents.value.forEach(i => { if (i.id === incidentId) i.assigned_to = previousValue; });
    assignmentsList.value.forEach(i => { if (i.id === incidentId) i.assigned_to = previousValue; });
  }
};

const autoAssignAll = async () => {
  try {
    const res = await api.post("/admin/incidents/auto-assign");
    const assignments = res.data.assignments || [];
    assignments.forEach(({ incident_id, assigned_to }) => {
      allIncidents.value.forEach(i => {
        if (i.id === incident_id) i.assigned_to = assigned_to;
      });
      assignmentsList.value.forEach(i => {
        if (i.id === incident_id) i.assigned_to = assigned_to;
      });
    });
    showNotification(`✅ Assigned ${res.data.assigned} incidents automatically`, "success");
  } catch (error) {
    showNotification("Auto‑assignment failed", "error");
  }
};

const assignmentStats = computed(() => {
  const total = assignmentsList.value.length;
  const assigned = assignmentsList.value.filter((i) => i.assigned_to).length;
  return { total, assigned, unassigned: total - assigned };
});

watch(showIncidentModal, (newVal) => {
  if (!newVal && incidentDetails.value) {
    const updated = incidentDetails.value;
    const idx = allIncidents.value.findIndex(i => i.id === updated.id);
    if (idx !== -1) {
      allIncidents.value[idx] = { ...allIncidents.value[idx], ...updated };
    }
    const aidx = assignmentsList.value.findIndex(i => i.id === updated.id);
    if (aidx !== -1) {
      assignmentsList.value[aidx] = { ...assignmentsList.value[aidx], ...updated };
    }
  }
});

const exportAssignments = () => {
  const data = assignmentsList.value;
  if (!data?.length) {
    showNotification("No data to export", "error");
    return;
  }
  const headers = ["Incident ID", "Type", "Severity", "Barangay", "Status", "Assigned To", "Reported At", "Updated At"];
  const rows = data.map((inc) => [
    inc.id,
    inc.type || "N/A",
    inc.severity || "N/A",
    inc.barangay || "N/A",
    inc.status || "N/A",
    getResponderName(inc.assigned_to),
    inc.created_at ? new Date(inc.created_at).toLocaleString() : "N/A",
    inc.updated_at ? new Date(inc.updated_at).toLocaleString() : "N/A",
  ]);
  let csv = headers.join(",") + "\n";
  rows.forEach((row) => {
    csv += row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",") + "\n";
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `incident_assignments_${new Date().toISOString().slice(0, 19)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showNotification(`Exported ${data.length} assignment record(s)`, "success");
};

// ============================================================
//  HEATMAP
// ============================================================
let map = null;
let incidentMarkers = [];
const DEFAULT_CENTER = [13.411, 121.181];
const DEFAULT_ZOOM = 13;
const mapStatus = ref("");
const mapRef = ref(null);
const showResponders = ref(true);
const responderLocations = ref([]);
const responderMarkers = ref([]);
const heatmapStartDate = ref(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
const heatmapEndDate = ref(new Date().toISOString().slice(0, 10));

const getSeverityColor = (severity) => {
  const colors = { critical: "#dc2626", high: "#f59e0b", medium: "#3b82f6", low: "#10b981" };
  return colors[severity] || "#6b7280";
};

const initHeatMap = async () => {
  if (map) return;
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
  const el = document.getElementById("heatmap");
  if (!el) return;
  map = L.map(el).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  mapRef.value = map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  await loadHeatmapData();
};

const loadHeatmapData = async () => {
  if (!map) {
    mapStatus.value = "Map not ready. Please wait...";
    return;
  }
  mapStatus.value = "Loading current incidents...";
  try {
    const res = await api.get("/admin/incidents/heatmap", { params: { status: "in-progress" } });
    const incidents = res.data;
    incidentMarkers.forEach((m) => map.removeLayer(m));
    incidentMarkers = [];
    if (!incidents?.length) {
      mapStatus.value = "No in-progress incidents found.";
      return;
    }
    incidents.forEach((inc) => {
      const color = getSeverityColor(inc.severity?.toLowerCase() || "medium");
      const marker = L.circleMarker([inc.latitude, inc.longitude], {
        radius: 15,
        fillColor: color,
        color: "#000",
        weight: 1,
        fillOpacity: 0.8,
      }).addTo(map);
      marker.bindPopup(`
        <div class="incident-popup">
          <strong>${inc.type || "Unknown"}</strong><br>
          Severity: ${inc.severity || "N/A"}<br>
          Status: ${inc.status || "N/A"}<br>
          Location: ${inc.barangay || "Unknown"}<br>
          Reported: ${inc.created_at ? new Date(inc.created_at).toLocaleDateString() : "N/A"}
        </div>
      `);
      incidentMarkers.push(marker);
    });
    if (incidents.length > 0) {
      const bounds = L.latLngBounds(incidents.map((i) => [i.latitude, i.longitude]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
    mapStatus.value = `Showing ${incidents.length} in-progress incidents.`;
  } catch (error) {
    console.error("Failed to load heatmap data:", error);
    mapStatus.value = "Error loading incidents. Check console.";
    showNotification("Could not load incident locations", "error");
  }
};

const loadPredictiveHeatmap = async () => {
  if (!map) await initHeatMap();
  mapStatus.value = "Generating predictive hotspots...";
  try {
    const res = await api.get("/admin/incidents/heatmap-predict", {
      params: { start_date: heatmapStartDate.value, end_date: heatmapEndDate.value },
    });
    incidentMarkers.forEach((m) => map.removeLayer(m));
    incidentMarkers = [];
    const features = res.data.features || [];
    if (!features.length) {
      mapStatus.value = res.data.message || "No significant hotspots predicted.";
      return;
    }
    features.forEach((f) => {
      const [lng, lat] = f.geometry.coordinates;
      const intensity = f.properties.intensity;
      const radius = 10 + intensity * 20;
      const marker = L.circleMarker([lat, lng], {
        radius,
        fillColor: "#ff6b6b",
        color: "#fff",
        weight: 1,
        fillOpacity: intensity * 0.8,
      }).addTo(map);
      marker.bindPopup(`Predicted hotspot intensity: ${intensity.toFixed(2)}`);
      incidentMarkers.push(marker);
    });
    mapStatus.value = `Showing ${features.length} predicted hotspots based on data from ${heatmapStartDate.value} to ${heatmapEndDate.value}`;
  } catch (err) {
    console.error("Prediction error:", err);
    mapStatus.value = err.response?.data?.detail || "Failed to generate prediction";
    showNotification(mapStatus.value, "error");
  }
};

const loadResponderLocations = async () => {
  try {
    const res = await api.get("/admin/responder-locations");
    responderLocations.value = res.data;
    updateResponderMarkers();
  } catch (error) {
    console.error("Failed to load responder locations:", error);
  }
};

const updateResponderMarkers = () => {
  if (!map) return;
  responderMarkers.value.forEach((m) => map.removeLayer(m));
  responderMarkers.value = [];
  if (!showResponders.value) return;
  responderLocations.value.forEach((r) => {
    const icon = L.divIcon({
      className: "responder-marker-admin",
      html: `<div style="background-color:#f97316;width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 2px #f97316,0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;color:white;">🚑</div>`,
      iconSize: [28, 28],
      popupAnchor: [0, -14],
      iconAnchor: [14, 14],
    });
    const marker = L.marker([r.lat, r.lng], { icon })
      .addTo(map)
      .bindPopup(`<b>${r.name}</b><br>Last update: ${new Date(r.last_update).toLocaleString()}<br>Accuracy: ${Math.round(r.accuracy)}m`);
    responderMarkers.value.push(marker);
  });
};

watch(showResponders, updateResponderMarkers);

// ============================================================
//  ANALYTICS
// ============================================================
const analyticsData = ref({
  incidentsByType: [],
  severityDistribution: [],
  activitySummary: { daily: [], weekly: [], monthly: [] },
  vehicleTypes: [],
  barangayTrends: [],
});
const analyticsStartDate = ref(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
const analyticsEndDate = ref(new Date().toISOString().slice(0, 10));
const analyticsDataEnhanced = ref({
  barangayDistribution: [],
  hourlyDistribution: [],
  weeklyTrend: [],
  avgResolutionHours: 0,
});

const vehicleSummary = computed(() => {
  if (!incidentDetails.value) return null;
  const safeParse = (data) => {
    if (!data) return null;
    if (typeof data === 'object') return data;
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }
    return null;
  };
  const textAnalysis = safeParse(incidentDetails.value.text_analysis);
  const imageAnalysis = safeParse(incidentDetails.value.image_analysis);
  const videoAnalysis = safeParse(incidentDetails.value.video_analysis);

  let textVehicles = textAnalysis?.mentioned_vehicles || [];
  if (textVehicles.length === 0 && incidentDetails.value.description) {
    const desc = incidentDetails.value.description.toLowerCase();
    const keywords = [
      'car', 'cars', 'sedan', 'suv', 'van', 'pickup', 'hatchback',
      'truck', 'trucks', 'lorry', 'dump truck',
      'motorcycle', 'motorbike', 'bike', 'scooter', 'moped',
      'tricycle', 'trike', 'pedicab',
      'bus', 'minibus', 'coaster',
      'bicycle',
      'jeepney', 'jeep',
      'trailer', 'semi-trailer', 'heavy vehicle',
      'ambulance', 'fire truck', 'police car'
    ];
    const found = keywords.filter(kw => desc.includes(kw));
    textVehicles = found.map(kw => kw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  }

  const imageVehicles = imageAnalysis?.vehicles || {};
  const videoVehicles = videoAnalysis?.vehicles || {};

  const combined = {};
  textVehicles.forEach(v => { combined[v] = (combined[v] || 0) + 1; });
  Object.entries(imageVehicles).forEach(([k, v]) => { combined[k] = (combined[k] || 0) + v; });
  Object.entries(videoVehicles).forEach(([k, v]) => { combined[k] = (combined[k] || 0) + v; });

  const sorted = Object.entries(combined).sort((a, b) => b[1] - a[1]);
  return {
    total: sorted.reduce((sum, [_, count]) => sum + count, 0),
    types: sorted.map(([type, count]) => ({ type, count })),
    textMentions: textVehicles,
    imageDetections: imageVehicles,
    videoDetections: videoVehicles,
  };
});

const firstImage = computed(() => {
  if (!incidentDetails.value) return null;
  const paths = incidentDetails.value.image_paths;
  if (!paths) return null;
  let parsed = paths;
  if (typeof paths === 'string') {
    try {
      parsed = JSON.parse(paths);
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed[0];
  }
  return null;
});

const firstVideo = computed(() => {
  if (!incidentDetails.value) return null;
  const paths = incidentDetails.value.video_paths;
  if (!paths) return null;
  let parsed = paths;
  if (typeof paths === 'string') {
    try {
      parsed = JSON.parse(paths);
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed[0];
  }
  return null;
});
 
const totalIncidentsByType = computed(() => {
  return analyticsData.value.incidentsByType.reduce((sum, item) => sum + item.count, 0);
});

const severityWithPercent = computed(() => {
  const total = analyticsData.value.severityDistribution.reduce((sum, item) => sum + item.count, 0);
  return analyticsData.value.severityDistribution.map((item) => ({
    ...item,
    percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : 0,
  }));
});

const pieGradient = computed(() => {
  let cumulative = 0;
  const parts = [];
  const colors = { critical: "#dc2626", high: "#f59e0b", medium: "#3b82f6", low: "#10b981" };
  severityWithPercent.value.forEach((item) => {
    const color = colors[item.level.toLowerCase()] || "#9ca3af";
    const start = cumulative;
    cumulative += parseFloat(item.percentage);
    parts.push(`${color} ${start}% ${cumulative}%`);
  });
  return `conic-gradient(${parts.join(", ")})`;
});

const maxActivity = computed(() => {
  const days = analyticsData.value.activitySummary.daily;
  return days.length ? Math.max(...days.map((d) => d.activity), 1) : 1;
});

const maxBarangayCount = computed(() => {
  const arr = analyticsDataEnhanced.value.barangayDistribution;
  return arr.length ? Math.max(...arr.map((item) => item.count), 1) : 1;
});

const maxHourlyCount = computed(() => {
  const arr = analyticsDataEnhanced.value.hourlyDistribution;
  return arr.length ? Math.max(...arr.map((item) => item.count), 1) : 1;
});

const maxWeeklyTrend = computed(() => {
  const arr = analyticsDataEnhanced.value.weeklyTrend;
  return arr.length ? Math.max(...arr.map((item) => item.count), 1) : 1;
});

const loadAnalyticsData = async () => {
  try {
    const params = { start_date: analyticsStartDate.value, end_date: analyticsEndDate.value };
    const res = await api.get("/admin/analytics", { params });
    analyticsData.value = {
      incidentsByType: res.data.incidentsByType || [],
      severityDistribution: res.data.severityDistribution || [],
      activitySummary: res.data.activitySummary || { daily: [], weekly: [], monthly: [] },
      vehicleTypes: res.data.vehicleTypes || [],
      barangayTrends: res.data.barangayTrends || [],
    };
    analyticsDataEnhanced.value = {
      barangayDistribution: res.data.barangayDistribution || [],
      hourlyDistribution: res.data.hourlyDistribution || [],
      weeklyTrend: res.data.weeklyTrend || res.data.activitySummary?.weekly || [],
      avgResolutionHours: res.data.avgResolutionHours || 0,
    };
  } catch (error) {
    console.error("Failed to load analytics:", error);
    analyticsData.value.vehicleTypes = [];
    analyticsData.value.barangayTrends = [];
    showNotification("Failed to load analytics data", "error");
  }
};

// ============================================================
//  EXPORT ANALYTICS TO CSV (Excel)
// ============================================================
const exportAnalyticsToCSV = () => {
  const rows = [];

  // Header with report title and date range
  rows.push(['Analytics Report', `Generated: ${new Date().toLocaleString()}`]);
  rows.push(['Date Range', `${analyticsStartDate.value} to ${analyticsEndDate.value}`]);
  rows.push([]); // blank line

  // 1. Incidents by Type
  rows.push(['Incidents by Type']);
  rows.push(['Type', 'Count']);
  analyticsData.value.incidentsByType.forEach(item => {
    rows.push([item.name, item.count]);
  });
  rows.push([]);

  // 2. Severity Distribution
  rows.push(['Severity Distribution']);
  rows.push(['Severity', 'Count']);
  analyticsData.value.severityDistribution.forEach(item => {
    rows.push([item.level, item.count]);
  });
  rows.push([]);

  // 3. Barangay Distribution
  rows.push(['Barangay Distribution']);
  rows.push(['Barangay', 'Count']);
  analyticsDataEnhanced.value.barangayDistribution.forEach(item => {
    rows.push([item.barangay, item.count]);
  });
  rows.push([]);

  // 4. Daily Activity (last 7 days)
  rows.push(['Daily Activity (Last 7 Days)']);
  rows.push(['Date', 'Activity']);
  analyticsData.value.activitySummary.daily.slice(0, 7).forEach(item => {
    rows.push([item.date, item.activity]);
  });
  rows.push([]);

  // 5. Weekly Trend (last 4 weeks)
  rows.push(['Weekly Trend (Last 4 Weeks)']);
  rows.push(['Week', 'Count']);
  analyticsDataEnhanced.value.weeklyTrend.slice(0, 4).forEach(item => {
    rows.push([item.week, item.count]);
  });
  rows.push([]);

  // 6. Hourly Distribution
  rows.push(['Hourly Distribution']);
  rows.push(['Hour', 'Count']);
  analyticsDataEnhanced.value.hourlyDistribution.forEach(item => {
    rows.push([`${item.hour}:00`, item.count]);
  });
  rows.push([]);

  // 7. Vehicle Types Detected
  rows.push(['Vehicle Types Detected']);
  rows.push(['Type', 'Count']);
  analyticsData.value.vehicleTypes.forEach(item => {
    rows.push([item.type, item.count]);
  });

  // Build CSV string (with BOM for UTF‑8 in Excel)
  const csvContent = rows.map(row => row.join(',')).join('\n');
  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `analytics_report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showNotification('Analytics report exported successfully', 'success');
};

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short" });
};

const formatHour = (hour) => `${hour}:00`;
const formatWeekLabel = (weekStr) => {
  const d = new Date(weekStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

watch([analyticsStartDate, analyticsEndDate], () => {
  if (active.value === "analytics") loadAnalyticsData();
});

// ============================================================
//  CHATS
// ============================================================
const adminChats = ref([]);
const selectedChat = ref(null);
const chatMessages = ref([]);
const newMessage = ref("");
const showChatModal = ref(false);
let chatRefreshInterval = null;

const loadAdminChats = async () => {
  try {
    const res = await api.get("/admin/chats");
    adminChats.value = res.data;
  } catch (error) {
    console.error("Failed to load chats:", error);
  }
};

const openChat = async (chatId) => {
  if (chatRefreshInterval) clearInterval(chatRefreshInterval);
  selectedChat.value = chatId;
  try {
    const res = await api.get(`/admin/chats/${chatId}/messages`);
    chatMessages.value = res.data;
    showChatModal.value = true;
    chatRefreshInterval = setInterval(async () => {
      if (!showChatModal.value) return;
      try {
        const newResp = await api.get(`/admin/chats/${chatId}/messages`);
        chatMessages.value = newResp.data;
        nextTick(() => {
          const container = document.querySelector(".chat-window .chat-messages");
          if (container) container.scrollTop = container.scrollHeight;
        });
      } catch (err) {
        console.error("Polling error", err);
      }
    }, 5000);
  } catch (error) {
    console.error("Failed to load chat messages:", error);
  }
};

const closeChatModal = () => {
  if (chatRefreshInterval) clearInterval(chatRefreshInterval);
  chatRefreshInterval = null;
  showChatModal.value = false;
  selectedChat.value = null;
  chatMessages.value = [];
};

const sendAdminMessage = async () => {
  if (!newMessage.value.trim() || !selectedChat.value) return;
  try {
    await api.post(`/admin/chats/${selectedChat.value}/message`, { message: newMessage.value });
    chatMessages.value.push({
      role: "admin",
      message: newMessage.value,
      timestamp: new Date().toISOString(),
    });
    newMessage.value = "";
    nextTick(() => {
      const container = document.querySelector(".chat-window .chat-messages");
      if (container) container.scrollTop = container.scrollHeight;
    });
  } catch (error) {
    console.error("Failed to send message:", error);
    showNotification("Failed to send message", "error");
  }
};

// ============================================================
//  BROADCAST ALERT
// ============================================================
const alertData = reactive({
  message: "",
  severity: "medium",
  useTemplate: false,
  template: "",
});
const alertTemplates = ref([
  "Emergency alert in your area. Please stay safe.",
  "Traffic advisory: Avoid the following routes...",
  "Weather warning: Heavy rains expected...",
  "Public safety announcement from Calapan City...",
  "Important update regarding ongoing incident...",
]);
const expirationType = ref("permanent");
const expiresAt = ref("");
const selectedImage = ref(null);
const imagePreview = ref(null);

const useTemplate = (template) => {
  alertData.message = template;
  alertData.useTemplate = true;
  alertData.template = template;
};

const onImageSelect = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showNotification("Please select an image file", "error");
    return;
  }
  selectedImage.value = file;
  imagePreview.value = URL.createObjectURL(file);
};

const clearImage = () => {
  selectedImage.value = null;
  if (imagePreview.value) {
    URL.revokeObjectURL(imagePreview.value);
    imagePreview.value = null;
  }
};

const sendAlert = async () => {
  if (!alertData.message.trim()) {
    showNotification("Please enter an alert message", "error");
    return;
  }
  if (expirationType.value === "timed" && !expiresAt.value) {
    showNotification("Please set an expiration date and time", "error");
    return;
  }
  const payload = { message: alertData.message, severity: alertData.severity };
  if (drawnGeometry.value) payload.geometry = drawnGeometry.value;
  if (expirationType.value === "timed" && expiresAt.value) {
    payload.expires_at = new Date(expiresAt.value).toISOString();
  }
  try {
    if (selectedImage.value) {
      const formData = new FormData();
      formData.append("message", alertData.message);
      formData.append("severity", alertData.severity);
      if (payload.geometry) formData.append("geometry", JSON.stringify(payload.geometry));
      if (payload.expires_at) formData.append("expires_at", payload.expires_at);
      formData.append("image", selectedImage.value);
      await api.post("/admin/broadcast-alert-with-image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    } else {
      if (!payload.expires_at) delete payload.expires_at;
      await api.post("/admin/broadcast-alert", payload);
    }
    showNotification("Alert broadcasted successfully", "success");
    alertData.message = "";
    alertData.severity = "medium";
    alertData.useTemplate = false;
    alertData.template = "";
    expirationType.value = "permanent";
    expiresAt.value = "";
    clearGeometry();
    clearImage();
  } catch (error) {
    console.error("Broadcast error:", error);
    const msg = error.response?.data?.detail || error.response?.data?.message || error.message;
    showNotification(`Failed: ${msg}`, "error");
  }
};

// ============================================================
//  BROADCAST MAP DRAWING
// ============================================================
const drawnGeometry = ref(null);
let drawMap = null;
let drawnItems = null;
const isDrawing = ref(false);
const currentPoints = ref([]);
const tempLine = ref(null);

const initBroadcastMap = () => {
  if (drawMap) {
    drawMap.invalidateSize();
    return;
  }
  const el = document.getElementById("broadcast-map");
  if (!el) {
    setTimeout(initBroadcastMap, 100);
    return;
  }
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  });
  drawMap = L.map(el).setView([13.411, 121.181], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(drawMap);
  drawnItems = L.featureGroup().addTo(drawMap);
  drawMap.on("click", onMapClick);
  drawMap.on("dblclick", onMapDblClick);
  setTimeout(() => drawMap.invalidateSize(), 200);
};

const onMapClick = (e) => {
  if (!isDrawing.value) return;
  const latlng = e.latlng;
  currentPoints.value.push([latlng.lat, latlng.lng]);
  if (tempLine.value) drawMap.removeLayer(tempLine.value);
  if (currentPoints.value.length >= 2) {
    tempLine.value = L.polyline(currentPoints.value, {
      color: "#2563eb",
      weight: 3,
      dashArray: "5, 5",
    }).addTo(drawMap);
  }
};

const onMapDblClick = (e) => {
  e.originalEvent.preventDefault();
  if (!isDrawing.value) return;
  finishDrawing();
};

const startDrawing = () => {
  if (!drawMap) return;
  isDrawing.value = true;
  currentPoints.value = [];
  if (tempLine.value) drawMap.removeLayer(tempLine.value);
  drawMap.getContainer().style.cursor = "crosshair";
  showNotification("Click on map to add points. Double‑click to finish.", "info");
};

const finishDrawing = () => {
  if (currentPoints.value.length < 2) {
    showNotification("Need at least 2 points", "error");
    stopDrawing();
    return;
  }
  const polyline = L.polyline(currentPoints.value, { color: "#dc2626", weight: 6 });
  drawnItems.clearLayers();
  drawnItems.addLayer(polyline);
  drawnGeometry.value = polyline.toGeoJSON();
  if (tempLine.value) {
    drawMap.removeLayer(tempLine.value);
    tempLine.value = null;
  }
  stopDrawing();
  showNotification("Line drawn successfully", "success");
};

const stopDrawing = () => {
  isDrawing.value = false;
  if (drawMap) drawMap.getContainer().style.cursor = "";
  currentPoints.value = [];
};

const cancelDrawing = () => {
  if (tempLine.value) {
    drawMap.removeLayer(tempLine.value);
    tempLine.value = null;
  }
  stopDrawing();
};

const clearGeometry = () => {
  drawnItems?.clearLayers();
  drawnGeometry.value = null;
  stopDrawing();
};

const geometrySummary = computed(() => {
  if (!drawnGeometry.value) return "";
  const type = drawnGeometry.value.geometry.type;
  if (type === "LineString") return `Polyline (${drawnGeometry.value.geometry.coordinates.length} points)`;
  return type;
});

watch(active, (newVal) => {
  if (newVal === "broadcast") {
    if (drawMap) setTimeout(() => drawMap.invalidateSize(), 100);
    else setTimeout(initBroadcastMap, 100);
  }
});

// ============================================================
//  ANNOUNCEMENTS
// ============================================================
const announcements = ref([]);
const announcementsLoading = ref(false);
const editingAnnouncement = ref(null);
const showAnnouncementModal = ref(false);
const showAnnouncementMapModal = ref(false);
const announcementMapGeometry = ref(null);
let announcementMapInstance = null;

const loadAnnouncements = async () => {
  announcementsLoading.value = true;
  try {
    const res = await api.get("/admin/alerts");
    announcements.value = res.data;
  } catch (error) {
    console.error("Failed to load announcements:", error);
    showNotification("Could not load announcements", "error");
    announcements.value = [];
  } finally {
    announcementsLoading.value = false;
  }
};

const editAnnouncement = (alert) => {
  editingAnnouncement.value = { ...alert };
  alertData.message = alert.message;
  alertData.severity = alert.severity;
  if (alert.image_url) {
    imagePreview.value = getFullImageUrl(alert.image_url);
  }
  showAnnouncementModal.value = true;
};

const updateAnnouncement = async () => {
  if (!editingAnnouncement.value) return;
  try {
    await api.put(`/admin/alerts/${editingAnnouncement.value.id}`, {
      message: alertData.message,
      severity: alertData.severity,
    });
    showNotification("Announcement updated successfully", "success");
    showAnnouncementModal.value = false;
    loadAnnouncements();
    alertData.message = "";
    alertData.severity = "medium";
    editingAnnouncement.value = null;
  } catch (error) {
    console.error("Update failed:", error);
    showNotification("Failed to update announcement", "error");
  }
};

const deleteAnnouncement = async (id) => {
  if (!confirm("Are you sure you want to delete this announcement?")) return;
  try {
    await api.delete(`/admin/alerts/${id}`);
    showNotification("Announcement deleted", "success");
    loadAnnouncements();
  } catch (error) {
    console.error("Delete failed:", error);
  }
};

const openAnnouncementMap = (geometry) => {
  announcementMapGeometry.value = geometry;
  showAnnouncementMapModal.value = true;
  nextTick(initAnnouncementMap);
};

const initAnnouncementMap = () => {
  const el = document.getElementById("announcement-map");
  if (!el) return;
  if (announcementMapInstance) announcementMapInstance.remove();
  let center = [13.411, 121.181];
  if (announcementMapGeometry.value) {
    const coords = announcementMapGeometry.value.geometry.coordinates;
    if (announcementMapGeometry.value.geometry.type === "LineString" && coords.length > 0) {
      center = [coords[0][1], coords[0][0]];
    } else if (announcementMapGeometry.value.geometry.type === "Point") {
      center = [coords[1], coords[0]];
    }
  }
  announcementMapInstance = L.map(el).setView(center, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(announcementMapInstance);
  if (announcementMapGeometry.value) {
    L.geoJSON(announcementMapGeometry.value, {
      style: { color: "#dc2626", weight: 6, opacity: 0.8 },
    }).addTo(announcementMapInstance).bindPopup("Affected area");
  }
};

// ============================================================
//  USER MANAGEMENT
// ============================================================
const allUsers = ref([]);
const usersFilter = ref("all");
const selectedUser = ref(null);
const showUserModal = ref(false);
const showReportModal = ref(false);
const showCreateUserModal = ref(false);
const isEditingUser = ref(false);
const editedUser = reactive({});
const userSearchQuery = ref("");
const advancedFilters = reactive({
  status: "",
  barangay: "",
  dateRange: { start: "", end: "" },
});
const pagination = reactive({
  currentPage: 1,
  perPage: 10,
  totalPages: 1,
  totalItems: 0,
});
const selectedUsers = ref(new Set());
const bulkAction = ref("");
const validationErrors = ref({});
const creatingUser = ref(false);
const saving = ref(false);
const sendWelcomeEmail = ref(false);

const roleLabels = { user: "Citizen", responder: "Responder", tmo: "TMO Officer", admin: "Administrator" };
const roleColors = { user: "#0b4fa3", responder: "#10b981", tmo: "#8b5cf6", admin: "#dc2626" };

const barangays = ref([
  "Tawagan",
  "Sta. Isabel",
  "Lumangbayan",
  "Poblacion",
  "Navotas",
  "Santiago",
  "Masipit",
  "Ilaya",
  "San Antonio",
  "San Vicente",
  "Sta. Maria",
  "Central",
]);

const newUser = reactive({
  full_name: "",
  email: "",
  password: "",
  confirm_password: "",
  role: "user",
  contact_number: "",
  barangay: "",
  address: "",
  emergency_contact_name: "",
  emergency_contact_number: "",
  status: "active",
});

const filteredUsers = computed(() => {
  let users = Array.isArray(allUsers.value) ? allUsers.value : [];
  if (userSearchQuery.value) {
    const q = userSearchQuery.value.toLowerCase();
    users = users.filter((u) =>
      (u.full_name || u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.contact_number || "").includes(q) ||
      (u.barangay || "").toLowerCase().includes(q)
    );
  }
  if (advancedFilters.status && advancedFilters.status !== "all") {
    users = users.filter((u) => (u.status || "active") === advancedFilters.status);
  }
  if (advancedFilters.barangay && advancedFilters.barangay !== "all") {
    users = users.filter((u) => u.barangay === advancedFilters.barangay);
  }
  if (advancedFilters.dateRange.start && advancedFilters.dateRange.end) {
    const start = new Date(advancedFilters.dateRange.start);
    const end = new Date(advancedFilters.dateRange.end);
    users = users.filter((u) => {
      if (!u.created_at) return true;
      try {
        const d = new Date(u.created_at);
        return d >= start && d <= end;
      } catch {
        return true;
      }
    });
  }
  pagination.totalItems = users.length;
  pagination.totalPages = Math.ceil(users.length / pagination.perPage) || 1;
  return users;
});

const paginatedUsers = computed(() => {
  const users = Array.isArray(filteredUsers.value) ? filteredUsers.value : [];
  const start = (pagination.currentPage - 1) * pagination.perPage;
  return users.slice(start, start + pagination.perPage);
});

const loadAllUsers = async () => {
  try {
    const res = await api.get("/admin/users", {
      params: {
        role: usersFilter.value !== "all" ? usersFilter.value : undefined,
        status: advancedFilters.status || undefined,
        barangay: advancedFilters.barangay || undefined,
        search: userSearchQuery.value || undefined,
      },
    });
    if (res.data?.users) {
      allUsers.value = res.data.users;
      pagination.totalItems = res.data.total || res.data.users.length;
      pagination.currentPage = res.data.page || 1;
      pagination.totalPages = res.data.total_pages || Math.ceil((res.data.total || res.data.users.length) / pagination.perPage);
    } else if (res.data?.data) {
      allUsers.value = res.data.data;
      pagination.totalItems = res.data.total || res.data.data.length;
      pagination.currentPage = res.data.current_page || 1;
      pagination.totalPages = res.data.last_page || Math.ceil((res.data.total || res.data.data.length) / pagination.perPage);
    } else if (Array.isArray(res.data)) {
      allUsers.value = res.data;
      pagination.totalItems = res.data.length;
      pagination.currentPage = 1;
      pagination.totalPages = Math.ceil(res.data.length / pagination.perPage) || 1;
    } else {
      allUsers.value = [];
      pagination.totalItems = 0;
      pagination.currentPage = 1;
      pagination.totalPages = 1;
    }
  } catch (error) {
    console.error("Failed to load users:", error);
    loadMockUsers();
  }
};

const loadMockUsers = () => {
  allUsers.value = [
    {
      id: 1,
      full_name: "Admin User",
      email: "admin@example.com",
      role: "admin",
      status: "active",
      contact_number: "09123456789",
      barangay: "Poblacion",
      address: "City Hall",
      created_at: "2024-01-01T00:00:00.000Z",
      emergency_contact_name: "Emergency Contact",
      emergency_contact_number: "09187654321",
      profile_photo: null,
    },
    {
      id: 6,
      full_name: "Christian Pacheco Mendoza",
      email: "chimeo0513@gmail.com",
      role: "responder",
      status: "active",
      contact_number: "09770126677",
      barangay: "Ilaya",
      address: "144 A. Bonifacio St.",
      created_at: "2024-01-15T00:00:00.000Z",
      emergency_contact_name: "Christian Pacheco Mendoza",
      emergency_contact_number: "0770126677",
      profile_photo: null,
    },
    {
      id: 8,
      full_name: "Christian Pacheco Mendoza",
      email: "chimen0531@gmail.com",
      role: "responder",
      status: "active",
      contact_number: "09770126677",
      barangay: "Ilaya",
      address: "144. A. Bonifacio St.",
      created_at: "2024-01-19T00:00:00.000Z",
      emergency_contact_name: "Christian Pacheco Mendoza",
      emergency_contact_number: "0770126677",
      profile_photo: null,
    },
    {
      id: 9,
      full_name: "Benedict M. Madrigal",
      email: "bene@gmail.com",
      role: "user",
      status: "active",
      contact_number: "09123456789",
      barangay: "Tawagan",
      address: "Tawagan, Calapan City",
      created_at: "2024-01-20T00:00:00.000Z",
      emergency_contact_name: "Christian Pacheco Mendoza",
      emergency_contact_number: "0770126677",
      profile_photo: "uploads/avatars/user_9.jfif",
    },
  ];
  pagination.totalItems = allUsers.value.length;
};

const getFullImageUrl = (path) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const fullPath = path.startsWith("/") ? path : "/" + path;
  const base = api.defaults.baseURL || "";
  if (!base || base === "/" || base === "") return fullPath;
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return cleanBase + fullPath;
};

const getInitials = (name) => {
  if (!name) return "U";
  return name
    .split(" ")
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
    .substring(0, 2);
};

const handleImageError = (event) => {
  event.target.style.display = "none";
  const parent = event.target.parentElement;
  if (parent) {
    const name = selectedUser.value?.full_name || selectedUser.value?.name || "U";
    parent.innerHTML = `<div class="avatar-initials">${getInitials(name)}</div>`;
  }
};

const handleTableImageError = (event, user) => {
  event.target.style.display = "none";
  const parent = event.target.parentElement;
  if (parent) {
    const name = user?.full_name || user?.name || "U";
    parent.innerHTML = `<div class="avatar-initials-sm">${getInitials(name)}</div>`;
  }
};

const updateUserRole = async (userId, newRole) => {
  if (!newRole) return;
  try {
    await api.put(`/admin/users/${userId}/role`, { role: newRole });
    await loadAllUsers();
    await loadDashboardStats();
    showNotification(`User role updated to ${roleLabels[newRole] || newRole}`, "success");
  } catch (error) {
    console.error("Failed to update user role:", error);
    showNotification("Failed to update user role", "error");
  }
};

const toggleUserStatus = async (userId, currentStatus) => {
  try {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    await api.put(`/admin/users/${userId}/status`, { status: newStatus });
    await loadAllUsers();
    await loadDashboardStats();
    showNotification(`User status updated to ${newStatus}`, "success");
  } catch (error) {
    console.error("Failed to update user status:", error);
    showNotification("Failed to update user status", "error");
  }
};

const viewUserDetails = (user) => {
  selectedUser.value = user;
  isEditingUser.value = false;
  Object.assign(editedUser, { ...user });
  showUserModal.value = true;
};

const editUser = (user) => {
  selectedUser.value = user;
  Object.assign(editedUser, { ...user });
  isEditingUser.value = true;
};

const closeUserModal = () => {
  showUserModal.value = false;
  isEditingUser.value = false;
  Object.keys(editedUser).forEach((k) => delete editedUser[k]);
};

const startEditUser = () => {
  isEditingUser.value = true;
  editedUser.value = JSON.parse(JSON.stringify(selectedUser.value));
};

const cancelEdit = () => {
  isEditingUser.value = false;
  Object.keys(editedUser).forEach((k) => delete editedUser[k]);
};

const saveUser = async () => {
  if (!selectedUser.value || !editedUser.value) return;
  saving.value = true;
  try {
    const updateData = {
      full_name: editedUser.value.full_name,
      email: editedUser.value.email,
      contact_number: editedUser.value.contact_number,
      barangay: editedUser.value.barangay,
      address: editedUser.value.address,
      emergency_contact_name: editedUser.value.emergency_contact_name,
      emergency_contact_number: editedUser.value.emergency_contact_number,
      role: editedUser.value.role,
      status: editedUser.value.status,
    };
    await api.put(`/admin/users/${selectedUser.value.id}`, updateData);
    const idx = allUsers.value.findIndex((u) => u.id === selectedUser.value.id);
    if (idx !== -1) {
      Object.assign(allUsers.value[idx], updateData);
      Object.assign(selectedUser.value, updateData);
    }
    showNotification("User updated successfully", "success");
    isEditingUser.value = false;
    Object.keys(editedUser).forEach((k) => delete editedUser[k]);
  } catch (error) {
    console.error("Failed to update user:", error);
    showNotification(error.response?.data?.message || "Failed to update user", "error");
  } finally {
    saving.value = false;
  }
};

const deleteUser = async (userId) => {
  if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;
  try {
    await api.delete(`/admin/users/${userId}`);
    showNotification("User deleted successfully", "success");
    allUsers.value = allUsers.value.filter((u) => u.id !== userId);
    showUserModal.value = false;
    isEditingUser.value = false;
    await loadDashboardStats();
  } catch (error) {
    console.error("Failed to delete user:", error);
    showNotification(error.response?.data?.message || "Failed to delete user", "error");
  }
};

const validateNewUser = () => {
  validationErrors.value = {};
  if (!newUser.full_name.trim()) validationErrors.value.full_name = "Full name is required";
  if (!newUser.email.trim()) {
    validationErrors.value.email = "Email is required";
  } else if (!/\S+@\S+\.\S+/.test(newUser.email)) {
    validationErrors.value.email = "Email is invalid";
  }
  if (!newUser.password) {
    validationErrors.value.password = "Password is required";
  } else if (newUser.password.length < 6) {
    validationErrors.value.password = "Password must be at least 6 characters";
  }
  if (newUser.password !== newUser.confirm_password) {
    validationErrors.value.confirm_password = "Passwords do not match";
  }
  if (!newUser.contact_number.trim()) {
    validationErrors.value.contact_number = "Contact number is required";
  }
  return Object.keys(validationErrors.value).length === 0;
};

const formatFieldName = (field) => {
  const names = {
    full_name: "Full Name",
    email: "Email",
    password: "Password",
    confirm_password: "Confirm Password",
    contact_number: "Contact Number",
    barangay: "Barangay",
    address: "Address",
    emergency_contact_name: "Emergency Contact Name",
    emergency_contact_number: "Emergency Contact Number",
  };
  return names[field] || field.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

const createUser = async () => {
  if (!validateNewUser()) {
    showNotification("Please fix validation errors", "error");
    return;
  }
  creatingUser.value = true;
  try {
    const payload = {
      full_name: newUser.full_name.trim(),
      email: newUser.email.trim().toLowerCase(),
      password: newUser.password,
      role: newUser.role,
      contact_number: newUser.contact_number.trim(),
      barangay: newUser.barangay,
      address: newUser.address,
      emergency_contact_name: newUser.emergency_contact_name,
      emergency_contact_number: newUser.emergency_contact_number,
      status: newUser.status,
      send_welcome_email: sendWelcomeEmail.value,
    };
    await api.post("/admin/users", payload);
    showNotification("User created successfully", "success");
    resetNewUserForm();
    showCreateUserModal.value = false;
    await loadAllUsers();
    await loadDashboardStats();
  } catch (error) {
    console.error("Failed to create user:", error);
    if (error.response?.data?.detail) {
      if (typeof error.response.data.detail === "string") {
        showNotification(error.response.data.detail, "error");
      } else if (Array.isArray(error.response.data.detail)) {
        showNotification(error.response.data.detail.map((e) => e.msg).join(", "), "error");
      }
    } else if (error.response?.data?.message) {
      showNotification(error.response.data.message, "error");
    } else {
      showNotification("Failed to create user. Please try again.", "error");
    }
  } finally {
    creatingUser.value = false;
  }
};

const resetNewUserForm = () => {
  Object.keys(newUser).forEach((key) => {
    if (key === "role") newUser[key] = "user";
    else if (key === "status") newUser[key] = "active";
    else newUser[key] = "";
  });
  validationErrors.value = {};
  sendWelcomeEmail.value = false;
};

const closeCreateUserModal = () => {
  showCreateUserModal.value = false;
  resetNewUserForm();
};

const toggleSelectUser = (userId) => {
  if (selectedUsers.value.has(userId)) selectedUsers.value.delete(userId);
  else selectedUsers.value.add(userId);
};

const toggleSelectAll = () => {
  if (selectedUsers.value.size === paginatedUsers.value.length && paginatedUsers.value.length > 0) {
    selectedUsers.value.clear();
  } else {
    selectedUsers.value.clear();
    paginatedUsers.value.forEach((u) => selectedUsers.value.add(u.id));
  }
};

const executeBulkAction = async () => {
  if (!bulkAction.value || selectedUsers.value.size === 0) {
    showNotification("Please select users and an action", "error");
    return;
  }
  try {
    const ids = Array.from(selectedUsers.value);
    switch (bulkAction.value) {
      case "activate":
        await Promise.all(ids.map((id) => api.put(`/admin/users/${id}/status`, { status: "active" })));
        showNotification(`${ids.length} user(s) activated`, "success");
        break;
      case "deactivate":
        await Promise.all(ids.map((id) => api.put(`/admin/users/${id}/status`, { status: "inactive" })));
        showNotification(`${ids.length} user(s) deactivated`, "success");
        break;
      case "delete":
        if (!confirm(`Are you sure you want to delete ${ids.length} user(s)? This cannot be undone.`)) return;
        await Promise.all(ids.map((id) => api.delete(`/admin/users/${id}`)));
        showNotification(`${ids.length} user(s) deleted`, "success");
        break;
    }
    await loadAllUsers();
    await loadDashboardStats();
    selectedUsers.value.clear();
    bulkAction.value = "";
  } catch (error) {
    console.error("Bulk action failed:", error);
    showNotification("Failed to execute bulk action", "error");
  }
};

const exportUsers = (format = "csv") => {
  const users = filteredUsers.value;
  if (format === "csv") {
    const headers = ["ID", "Full Name", "Email", "Phone", "Barangay", "Address", "Role", "Account Status", "Online Status", "Last Active", "Created At"];
    const rows = users.map((u) => [
      u.id,
      u.full_name || u.name || "",
      u.email,
      u.contact_number || "",
      u.barangay || "",
      u.address || "",
      roleLabels[u.role] || u.role,
      u.status || "active",
      u.is_online ? "Online" : "Offline",
      u.last_active ? new Date(u.last_active).toLocaleString() : "Never",
      u.created_at ? new Date(u.created_at).toLocaleDateString() : "",
    ]);
    let csv = headers.join(",") + "\n";
    rows.forEach((row) => {
      csv += row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users_export_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification(`Exported ${users.length} user(s) successfully`, "success");
  }
};

const resetFilters = () => {
  userSearchQuery.value = "";
  advancedFilters.status = "";
  advancedFilters.barangay = "";
  advancedFilters.dateRange.start = "";
  advancedFilters.dateRange.end = "";
  usersFilter.value = "all";
  selectedUsers.value.clear();
  bulkAction.value = "";
  loadAllUsers();
};

const goToPage = (page) => {
  if (page >= 1 && page <= pagination.totalPages) pagination.currentPage = page;
};

const nextPage = () => {
  if (pagination.currentPage < pagination.totalPages) pagination.currentPage++;
};

const prevPage = () => {
  if (pagination.currentPage > 1) pagination.currentPage--;
};

const getPageNumbers = () => {
  const pages = [];
  const total = pagination.totalPages;
  const current = pagination.currentPage;
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    if (current <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push("...");
      pages.push(total);
    } else if (current >= total - 3) {
      pages.push(1);
      pages.push("...");
      for (let i = total - 4; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push("...");
      for (let i = current - 1; i <= current + 1; i++) pages.push(i);
      pages.push("...");
      pages.push(total);
    }
  }
  return pages;
};

const updateUserStatusInEdit = async (status) => {
  if (!selectedUser.value) return;
  try {
    await api.put(`/admin/users/${selectedUser.value.id}/status`, { status });
    editedUser.status = status;
    selectedUser.value.status = status;
    showNotification(`User status updated to ${status}`, "success");
  } catch (error) {
    console.error("Failed to update user status:", error);
    showNotification("Failed to update user status", "error");
  }
};

watch([() => userSearchQuery.value, () => advancedFilters.status, () => advancedFilters.barangay], () => {
  pagination.currentPage = 1;
}, { deep: true });

// ============================================================
//  ANONYMOUS SOS
// ============================================================
const anonymousEmergencies = ref([]);
const loadingEmergencies = ref(false);
const showMapModal = ref(false);
const mapCoordinates = ref({ lat: 0, lng: 0 });
let mapInstance = null;

const getFullAudioUrl = (path) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  let base = api.defaults.baseURL || "";
  if (base.endsWith("/")) base = base.slice(0, -1);
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}/${cleanPath}`;
};

const loadAnonymousEmergencies = async () => {
  loadingEmergencies.value = true;
  try {
    const res = await api.get("/admin/emergencies/anonymous");
    anonymousEmergencies.value = res.data;
  } catch (error) {
    console.error("Failed to load anonymous emergencies:", error);
    showNotification("Failed to load anonymous emergencies", "error");
  } finally {
    loadingEmergencies.value = false;
  }
};

const openMapModal = (lat, lng) => {
  mapCoordinates.value = { lat, lng };
  showMapModal.value = true;
  nextTick(initModalMap);
};

const initModalMap = () => {
  const el = document.getElementById("modal-map");
  if (!el) return;
  if (mapInstance) mapInstance.remove();
  mapInstance = L.map(el).setView([mapCoordinates.value.lat, mapCoordinates.value.lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(mapInstance);
  L.marker([mapCoordinates.value.lat, mapCoordinates.value.lng]).addTo(mapInstance)
    .bindPopup("Emergency location")
    .openPopup();
};

const closeMapModal = () => {
  showMapModal.value = false;
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
};

// ============================================================
//  LEGAL COMPLIANCE
// ============================================================
const legalCompliances = ref([]);
const legalLoading = ref(false);
const showLegalModal = ref(false);
const editingLegal = ref(null);
const legalCategoryFilter = ref("");
const effectiveDateType = ref("permanent");
const legalCategories = [
  "Disaster Risk Reduction",
  "Emergency Response",
  "Traffic & Road Safety",
  "Public Health",
  "Environmental",
  "Criminal Justice",
  "Civil Protection",
  "Other",
];
const legalForm = reactive({
  title: "",
  law_number: "",
  category: "",
  description: "",
  official_statement: "",
  effective_date: "",
  is_active: true,
});
const showExportModal = ref(false);
const exportType = ref("all");
const exportCategory = ref("");
const exportDateFrom = ref("");
const exportDateTo = ref("");

const loadLegalCompliances = async () => {
  legalLoading.value = true;
  try {
    const params = legalCategoryFilter.value ? { category: legalCategoryFilter.value } : {};
    const res = await api.get("/admin/legal-compliances", { params });
    legalCompliances.value = res.data;
  } catch (e) {
    showNotification("Failed to load legal compliances", "error");
  } finally {
    legalLoading.value = false;
  }
};

const openCreateLegal = () => {
  editingLegal.value = null;
  Object.assign(legalForm, {
    title: "",
    law_number: "",
    category: "",
    description: "",
    official_statement: "",
    effective_date: "",
    is_active: true,
  });
  effectiveDateType.value = "permanent";
  showLegalModal.value = true;
};

const openEditLegal = (entry) => {
  editingLegal.value = entry;
  Object.assign(legalForm, { ...entry });
  effectiveDateType.value = legalForm.effective_date?.trim() ? "specific" : "permanent";
  if (effectiveDateType.value === "permanent") legalForm.effective_date = "";
  showLegalModal.value = true;
};

const saveLegal = async () => {
  if (!legalForm.title || !legalForm.category || !legalForm.description || !legalForm.official_statement) {
    showNotification("Please fill in all required fields", "error");
    return;
  }
  const payload = { ...legalForm };
  if (effectiveDateType.value === "permanent") payload.effective_date = "";
  try {
    if (editingLegal.value) {
      await api.put(`/admin/legal-compliances/${editingLegal.value.id}`, payload);
      showNotification("Legal entry updated", "success");
    } else {
      await api.post("/admin/legal-compliances", payload);
      showNotification("Legal entry created", "success");
    }
    showLegalModal.value = false;
    await loadLegalCompliances();
  } catch (e) {
    showNotification("Failed to save legal entry", "error");
  }
};

const deleteLegal = async (id) => {
  if (!confirm("Delete this legal compliance entry?")) return;
  try {
    await api.delete(`/admin/legal-compliances/${id}`);
    showNotification("Entry deleted", "success");
    await loadLegalCompliances();
  } catch (e) {
    showNotification("Failed to delete entry", "error");
  }
};

const toggleLegalStatus = async (entry) => {
  try {
    await api.put(`/admin/legal-compliances/${entry.id}`, { is_active: !entry.is_active });
    showNotification(`Entry ${entry.is_active ? "deactivated" : "activated"}`, "success");
    await loadLegalCompliances();
  } catch (e) {
    showNotification("Failed to toggle status", "error");
  }
};

const exportFilteredCompliances = computed(() => {
  let filtered = [...legalCompliances.value];
  if (exportType.value === "category" && exportCategory.value) {
    filtered = filtered.filter((c) => c.category === exportCategory.value);
  } else if (exportType.value === "date" && exportDateFrom.value && exportDateTo.value) {
    const from = new Date(exportDateFrom.value);
    const to = new Date(exportDateTo.value);
    to.setHours(23, 59, 59, 999);
    filtered = filtered.filter((c) => {
      const created = new Date(c.created_at);
      return created >= from && created <= to;
    });
  }
  return filtered;
});

const exportLegalToCSV = () => {
  const data = exportFilteredCompliances.value;
  if (!data.length) {
    showNotification("No data to export", "error");
    return;
  }
  const headers = ["ID", "Title", "Law Number", "Category", "Description", "Official Statement", "Effective Date", "Status", "Created At"];
  const rows = data.map((item) => [
    item.id,
    `"${item.title.replace(/"/g, '""')}"`,
    item.law_number ? `"${item.law_number.replace(/"/g, '""')}"` : "",
    item.category,
    `"${item.description.replace(/"/g, '""')}"`,
    `"${item.official_statement.replace(/"/g, '""')}"`,
    item.effective_date || "Permanent",
    item.is_active ? "Active" : "Inactive",
    new Date(item.created_at).toLocaleString(),
  ]);
  let csv = headers.join(",") + "\n";
  rows.forEach((row) => { csv += row.join(",") + "\n"; });
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `legal_compliances_${new Date().toISOString().slice(0, 19)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showNotification(`Exported ${data.length} entries`, "success");
  showExportModal.value = false;
  exportType.value = "all";
  exportCategory.value = "";
  exportDateFrom.value = "";
  exportDateTo.value = "";
};

watch(effectiveDateType, (newType) => {
  if (newType === "permanent") legalForm.effective_date = "";
});

// ============================================================
//  ML ANALYTICS
// ============================================================
const mlAnalyticsData = ref({
  modelPerf: {},
  datasetStatus: {
    incident_images: { file_count: 0, size_mb: 0 },
    training_data: { file_count: 0, size_mb: 0 },
    uploads: { file_count: 0, size_mb: 0 },
    total_size_mb: 0,
    verified_samples: 0,
    used_in_training: 0,
  },
  summaryStats: {
    total_predictions: 0,
    avg_confidence: 0,
    by_type: {},
    by_severity: {},
  },
  trainingDataStatus: { verified_samples: 0, used_in_training: 0 },
});
const mlLoading = ref(false);
const predictionStats = ref({});

const loadMLAnalytics = async () => {
  mlLoading.value = true;
  try {
    const [perfRes, datasetRes, summaryRes, trainingStatusRes] = await Promise.all([
      api.get("/admin/ml-performance"),
      api.get("/admin/dataset-status"),
      api.get("/admin/ml-stats-summary?days=30"),
      api.get("/admin/training-data-status"),
    ]);
    mlAnalyticsData.value.modelPerf = perfRes.data;
    mlAnalyticsData.value.datasetStatus = datasetRes.data;
    mlAnalyticsData.value.summaryStats = summaryRes.data;
    mlAnalyticsData.value.trainingDataStatus = trainingStatusRes.data;
  } catch (error) {
    console.error("Failed to load ML analytics:", error);
    showNotification("Failed to load ML analytics data", "error");
  } finally {
    mlLoading.value = false;
  }
};

const loadPredictionStats = async () => {
  try {
    const res = await api.get("/admin/ml/prediction-stats");
    predictionStats.value = res.data;
  } catch (err) {
    console.error("Failed to load prediction stats:", err);
  }
};

// ============================================================
//  NAVIGATION
// ============================================================
const go = async (section) => {
  active.value = section;
  await nextTick();
  switch (section) {
    case "dashboard":
      await loadDashboardStats();
      await loadAnalyticsData();
      break;
    case "announcements":
      await loadAnnouncements();
      break;
    case "incidents":
      await loadAllIncidents();
      break;
    case "heatmap":
      await initHeatMap();
      await loadHeatmapData();
      await loadResponderLocations();
      if (map) map.invalidateSize();
      break;
    case "analytics":
      await loadDashboardStats();
      await loadAnalyticsData();
      break;
    case "chats":
      await loadAdminChats();
      break;
    case "broadcast":
      await loadResponders();
      setTimeout(initBroadcastMap, 50);
      break;
    case "users":
      await loadAllUsers();
      break;
    case "ml-analytics":
      mlLoading.value = true;
      await nextTick();
      await Promise.all([loadMLAnalytics(), loadPredictionStats()]);
      mlLoading.value = false;
      break;
    case "anonymous":
      await loadAnonymousEmergencies();
      break;
    case "assignments":
      assignmentsFilterResponder.value = "all";
      await loadResponders();
      await loadAssignments();
      break;
    case "legal":
      await loadLegalCompliances();
      break;
  }
};

// ============================================================
//  AUTO REFRESH
// ============================================================
const refreshActiveSection = async () => {
  switch (active.value) {
    case "dashboard":
      await loadDashboardStats();
      break;
    case "incidents":
      await loadAllIncidents();
      break;
    case "users":
      await loadAllUsers();
      break;
    case "legal":
      await loadLegalCompliances();
      break;
    case "assignments":
      await loadAssignments();
      break;
    case "announcements":
      await loadAnnouncements();
      break;
    case "heatmap":
      await loadHeatmapData();
      break;
    default:
      break;
  }
};

useAutoRefresh({
  refreshFn: refreshActiveSection,
  interval: 30000,
  enabled: true,
  preserveScroll: true,
  preserveMap: true,
  mapRef,
});

// ============================================================
//  LIFECYCLE
// ============================================================
onMounted(async () => {
  await loadDashboardStats();
  await loadAnalyticsData();
  if (!document.getElementById("notification-styles")) {
    const style = document.createElement("style");
    style.id = "notification-styles";
    style.textContent = `
      @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      .admin-notification button { background: transparent; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0 0 0 10px; }
    `;
    document.head.appendChild(style);
  }
});

onBeforeUnmount(() => {
  if (map) { map.remove(); map = null; }
  if (drawMap) { drawMap.remove(); drawMap = null; }
  if (chatRefreshInterval) { clearInterval(chatRefreshInterval); chatRefreshInterval = null; }
});

// Pagination helpers (for incidents and assignments)
const goToIncidentsPage = (page) => {
  if (page >= 1 && page <= totalIncidentsPages.value) {
    incidentsPagination.currentPage = page;
  }
};
const nextIncidentsPage = () => {
  if (incidentsPagination.currentPage < totalIncidentsPages.value) incidentsPagination.currentPage++;
};
const prevIncidentsPage = () => {
  if (incidentsPagination.currentPage > 1) incidentsPagination.currentPage--;
};

const goToAssignmentsPage = (page) => {
  if (page >= 1 && page <= totalAssignmentsPages.value) {
    assignmentsPagination.currentPage = page;
  }
};
const nextAssignmentsPage = () => {
  if (assignmentsPagination.currentPage < totalAssignmentsPages.value) assignmentsPagination.currentPage++;
};
const prevAssignmentsPage = () => {
  if (assignmentsPagination.currentPage > 1) assignmentsPagination.currentPage--;
};

// Watch filters to reset pagination
watch(incidentsFilter, () => { incidentsPagination.currentPage = 1; });
watch(assignmentsFilterResponder, () => { assignmentsPagination.currentPage = 1; });

</script>

<template>
  <div class="page">
    <!-- ===== TOPBAR ===== -->
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="seal-wrap">
            <img class="seal" :src="calapanLogo" alt="Calapan City Seal" />
          </div>
          <div class="brand-text">
            <div class="brand-title">RESQAPP • Admin Dashboard</div>
            <div class="brand-subtitle">Calapan City Emergency Management</div>
          </div>
        </div>
        <div class="right">
          <span class="role" :class="roleClass">{{ role }}</span>
          <button class="btn btn-outline btn-sm" @click="logout">Logout</button>
        </div>
      </div>
    </header>

    <!-- ===== MAIN LAYOUT ===== -->
    <main class="main">
      <div class="layout">
        <!-- Navigation -->
        <nav class="nav">
          <button class="navbtn" :class="{ on: active === 'dashboard' }" @click="go('dashboard')">📊 Dashboard</button>
          <button class="navbtn" :class="{ on: active === 'announcements' }" @click="go('announcements')">📢 Announcements</button>
          <button class="navbtn" :class="{ on: active === 'anonymous' }" @click="go('anonymous')">🆘 Anonymous SOS</button>
          <button class="navbtn" :class="{ on: active === 'heatmap' }" @click="go('heatmap')">🔥 HeatMap</button>
          <button class="navbtn" :class="{ on: active === 'analytics' }" @click="go('analytics')">📈 Analytics</button>
          <button class="navbtn" :class="{ on: active === 'assignments' }" @click="go('assignments')">📋 Incidents</button>
          <button class="navbtn" :class="{ on: active === 'broadcast' }" @click="go('broadcast')">📢 Broadcast</button>
          <button class="navbtn" :class="{ on: active === 'chats' }" @click="go('chats')">💬 Messages</button>
          <button class="navbtn" :class="{ on: active === 'legal' }" @click="go('legal')">⚖️ Legal Compliance</button>
          <button class="navbtn" :class="{ on: active === 'users' }" @click="go('users')">👥 Users</button>
          <button class="navbtn" :class="{ on: active === 'ml-analytics' }" @click="go('ml-analytics')">🤖 ML Analytics</button>
        </nav>

        <!-- Content -->
        <section class="content">

          <!-- ============================================================
          DASHBOARD
          ============================================================ -->
          <div v-if="active === 'dashboard'" class="dashboard-home">
            <div class="dashboard-welcome">
              <h2 class="h2">👋 Welcome back, Administrator</h2>
              <p class="sub">Here’s what’s happening in Calapan City today.</p>
            </div>

            <div class="stats-grid">
              <div class="stat-card" style="border-top:4px solid #0b4fa3;">
                <div class="stat-title">Total Incidents</div>
                <div class="stat-value">{{ dashboardStats.totalIncidents }}</div>
                <div class="stat-trend">All time</div>
              </div>
              <div class="stat-card" style="border-top:4px solid #f59e0b;">
                <div class="stat-title">Pending</div>
                <div class="stat-value" style="color:#f59e0b;">{{ dashboardStats.pending }}</div>
                <div class="stat-trend">Awaiting review</div>
              </div>
              <div class="stat-card" style="border-top:4px solid #3b82f6;">
                <div class="stat-title">In Progress</div>
                <div class="stat-value" style="color:#3b82f6;">{{ dashboardStats.inProgress }}</div>
                <div class="stat-trend">Being handled</div>
              </div>
              <div class="stat-card" style="border-top:4px solid #10b981;">
                <div class="stat-title">Resolved</div>
                <div class="stat-value" style="color:#10b981;">{{ dashboardStats.resolved }}</div>
                <div class="stat-trend">
                  <span v-if="resolutionRate > 0">{{ resolutionRate }}% resolution rate</span>
                  <span v-else>No data</span>
                </div>
              </div>
            </div>

            <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-top:16px;">
              <div class="stat-card stat-card-compact">
                <div class="stat-title">Today</div>
                <div class="stat-value" style="font-size:26px;">{{ todaysIncidents }}</div>
                <div class="stat-trend">New incidents</div>
              </div>
              <div class="stat-card stat-card-compact">
                <div class="stat-title">Critical</div>
                <div class="stat-value" style="font-size:26px;color:#dc2626;">{{ criticalCount }}</div>
                <div class="stat-trend">High‑severity</div>
              </div>
              <div class="stat-card stat-card-compact">
                <div class="stat-title">Resolved Rate</div>
                <div class="stat-value" style="font-size:26px;color:#10b981;">{{ resolutionRate }}%</div>
                <div class="stat-trend">Overall</div>
              </div>
              <div class="stat-card stat-card-compact">
                <div class="stat-title">Total Users</div>
                <div class="stat-value" style="font-size:26px;">{{ dashboardStats.totalUsers }}</div>
                <div class="stat-trend">Registered</div>
              </div>
            </div>

            <div class="quick-actions">
              <button class="btn-action" @click="active = 'broadcast'"><span class="btn-icon">📢</span> Create Alert</button>
              <button class="btn-action" @click="active = 'incidents'"><span class="btn-icon">📋</span> Manage Incidents</button>
              <button class="btn-action" @click="active = 'users'"><span class="btn-icon">👥</span> User Management</button>
              <button class="btn-action" @click="active = 'analytics'"><span class="btn-icon">📈</span> Analytics</button>
            </div>

            <div v-if="analyticsData.activitySummary?.daily?.length" class="mini-chart-section" style="margin-top:28px;">
              <h3>📊 Last 7 Days</h3>
              <div class="mini-bars">
                <div v-for="day in analyticsData.activitySummary.daily.slice(0,7)" :key="day.date" class="mini-bar-item">
                  <div class="mini-bar-fill" :style="{ height: (day.activity / maxActivity) * 100 + '%' }"></div>
                  <span class="mini-bar-label">{{ new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ============================================================
          ANNOUNCEMENTS
          ============================================================ -->
          <div v-else-if="active === 'announcements'" class="card">
            <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <h2 class="h2">Manage Announcements</h2>
                <p class="p">View and manage active alerts.</p>
              </div>
              <button class="btn btn-outline-blue btn-sm" @click="loadAnnouncements">🔄 Refresh</button>
            </div>

            <div v-if="announcementsLoading" class="loading-skeleton">
              <div class="skeleton-row" v-for="i in 3" :key="i"><div class="skeleton-cell"></div></div>
            </div>

            <div v-else-if="announcements.length === 0" class="empty-announcements">
              <div class="empty-icon">📢</div>
              <h3>No announcements yet</h3>
              <p>Create an announcement from the <strong>Broadcast</strong> tab.</p>
              <button class="btn btn-primary" @click="go('broadcast')">Go to Broadcast</button>
            </div>

            <div v-else class="announcements-list">
              <div v-for="alert in announcements" :key="alert.id" class="announcement-item">
                <div class="announcement-header">
                  <span class="severity-badge" :class="alert.severity">{{ alert.severity }}</span>
                  <span class="announcement-date">{{ new Date(alert.created_at).toLocaleDateString() }}</span>
                </div>
                <p class="announcement-message">{{ alert.message }}</p>
                <div v-if="alert.image_url" class="announcement-thumb">
                  <img :src="getFullImageUrl(alert.image_url)" />
                </div>
                <div v-if="alert.geometry" class="announcement-map-preview" @click="openAnnouncementMap(alert.geometry)">
                  <div class="map-thumbnail-overlay">🗺️ View Map</div>
                </div>
                <div class="announcement-actions">
                  <button @click="editAnnouncement(alert)" class="btn-small">✎ Edit</button>
                  <button @click="deleteAnnouncement(alert.id)" class="btn-small btn-danger">🗑️ Delete</button>
                </div>
              </div>
            </div>
          </div>

          <!-- ============================================================
          ANONYMOUS SOS
          ============================================================ -->
          <div v-else-if="active === 'anonymous'" class="card">
            <h2 class="h2">Anonymous SOS Alerts</h2>
            <div v-if="loadingEmergencies" class="loading">Loading...</div>
            <div v-else class="table-container">
              <div class="table-responsive">
                <table class="users-table">
                  <thead>
                    <tr><th>ID</th><th>Location</th><th>Timestamp</th><th>Audio</th><th>Map</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in anonymousEmergencies" :key="item.id">
                      <td>#{{ item.id }}</td>
                      <td>{{ item.latitude.toFixed(5) }}, {{ item.longitude.toFixed(5) }}</td>
                      <td>{{ new Date(item.timestamp).toLocaleString() }}</td>
                      <td><audio controls :src="getFullAudioUrl(item.audio_url)" style="max-width:250px;"></audio></td>
                      <td><button @click="openMapModal(item.latitude, item.longitude)" class="btn-small">📍 View Map</button></td>
                    </tr>
                    <tr v-if="anonymousEmergencies.length === 0">
                      <td colspan="5" class="no-data">No anonymous SOS alerts found.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Map Modal for Anonymous SOS -->
          <div v-if="showMapModal" class="modal-overlay" @click.self="closeMapModal">
            <div class="modal-content" style="max-width:800px;">
              <div class="modal-header">
                <h3>Emergency Location</h3>
                <button class="modal-close" @click="closeMapModal">×</button>
              </div>
              <div class="modal-body">
                <div id="modal-map" style="height:400px;width:100%;border-radius:8px;"></div>
                <p style="margin-top:10px;color:#374151;">
                  Coordinates: {{ mapCoordinates.lat.toFixed(6) }}, {{ mapCoordinates.lng.toFixed(6) }}
                </p>
              </div>
            </div>
          </div>

          <!-- ============================================================
          INCIDENTS (with pagination)
          ============================================================ -->
          <div v-else-if="active === 'incidents'" class="card">
            <div class="section-header">
              <h2 class="h2">Incidents Management</h2>
              <div class="filter-controls">
                <select v-model="incidentsFilter" @change="loadAllIncidents" class="filter-select">
                  <option value="all">All Incidents</option>
                  <option value="pending">Pending</option>
                  <option value="in-progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
            </div>

            <div v-if="incidentsLoading" class="loading">Loading incidents...</div>

            <div class="table">
              <div class="row incidents-row head">
                <div>ID</div><div>Type</div><div>Severity</div><div>Location</div>
                <div>Status</div><div>Reported</div><div>Assigned To</div><div>Actions</div>
              </div>
              <div v-for="incident in paginatedIncidents" :key="incident.id" class="row incidents-row">
                <div>#{{ incident.id }}</div>
                <div>{{ incident.type }}</div>
                <div><span class="pill" :style="{ backgroundColor: severityColors[incident.severity] }">{{ incident.severity }}</span></div>
                <div>{{ incident.barangay }}</div>
                <div><span class="pill" :style="{ backgroundColor: statusColors[incident.status] }">{{ incident.status }}</span></div>
                <div>{{ new Date(incident.created_at).toLocaleDateString() }}</div>
                <div>{{ getResponderName(incident.assigned_to) }}</div>
                <div class="action-buttons">
                  <button @click="viewIncidentDetails(incident.id)" class="btn-small">👁️ View</button>
                  <button v-if="incident.status === 'pending'" @click="approveIncidentFromList(incident.id)" class="btn-small btn-success">✅ Approve</button>
                  <button v-else-if="incident.status === 'in-progress'" @click="resolveIncidentFromList(incident.id)" class="btn-small btn-primary">✓ Resolve</button>
                  <span v-else class="resolved-badge">Resolved</span>
                  <select 
                    :key="incident.id" 
                    :value="incident.assigned_to ?? null" 
                    @change="assignToResponder(incident.id, $event.target.value)" 
                    class="responder-select"
                  >
                    <option :value="null">Unassign</option>
                    <option v-for="resp in availableResponders" :key="resp.id" :value="resp.id">{{ resp.name }}</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Pagination for incidents -->
            <div v-if="totalIncidentsPages > 1" class="pagination">
              <div class="pagination-info">
                Showing {{ (incidentsPagination.currentPage - 1) * incidentsPagination.perPage + 1 }} to {{ Math.min(incidentsPagination.currentPage * incidentsPagination.perPage, incidentsPagination.total) }} of {{ incidentsPagination.total }} incidents
              </div>
              <div class="pagination-controls">
                <button @click="prevIncidentsPage" :disabled="incidentsPagination.currentPage === 1" class="pagination-btn">← Previous</button>
                <div class="page-numbers">
                  <button v-for="page in getPageNumbers()" :key="page" @click="goToIncidentsPage(page)" :class="{ active: page === incidentsPagination.currentPage, dots: page === '...' }" class="page-btn" :disabled="page === '...'">{{ page }}</button>
                </div>
                <button @click="nextIncidentsPage" :disabled="incidentsPagination.currentPage === totalIncidentsPages" class="pagination-btn">Next →</button>
              </div>
            </div>
          </div>

          <!-- Incident Details Modal -->
          <div v-if="showIncidentModal" class="modal-overlay" @click.self="showIncidentModal = false">
            <div class="modal-content" style="max-width:700px;">
              <div class="modal-header">
                <h3>Incident Details</h3>
                <button class="modal-close" @click="showIncidentModal = false">×</button>
              </div>
              <div class="modal-body">
                <div v-if="loadingIncident" class="loading">Loading incident details...</div>
                <div v-else-if="incidentDetails" class="incident-details">
                  <!-- Basic info -->
                  <div class="detail-row"><strong>ID:</strong> #{{ incidentDetails.id }}</div>
                  <div class="detail-row"><strong>Type:</strong> {{ incidentDetails.type }}</div>
                  <div class="detail-row"><strong>Severity:</strong> <span class="severity-badge" :class="incidentDetails.severity">{{ incidentDetails.severity }}</span></div>
                  <div class="detail-row"><strong>Status:</strong> <span class="status-badge" :class="incidentDetails.status">{{ incidentDetails.status }}</span></div>
                  <div class="detail-row"><strong>Location:</strong> {{ incidentDetails.barangay }}<br><small>{{ incidentDetails.address || 'No address provided' }}</small></div>
                  <div class="detail-row"><strong>Description:</strong><p>{{ incidentDetails.description }}</p></div>
                  <div class="detail-row"><strong>Reported by:</strong> {{ incidentDetails.reporter?.name || 'Anonymous' }} <span v-if="incidentDetails.reporter?.contact">({{ incidentDetails.reporter.contact }})</span></div>
                  <div class="detail-row"><strong>Reported at:</strong> {{ new Date(incidentDetails.created_at).toLocaleString() }}</div>
                  <div class="detail-row" v-if="incidentDetails.assigned_to"><strong>Assigned to:</strong> Responder ID {{ incidentDetails.assigned_to }}</div>

                  <!-- AI Prediction -->
                  <div v-if="incidentDetails.text_analysis" class="detail-row">
                    <strong>🤖 AI Prediction:</strong>
                    <div>Type: {{ incidentDetails.text_analysis.incident_type }} ({{ (incidentDetails.text_analysis.type_confidence * 100).toFixed(0) }}%)</div>
                    <div>Severity: {{ incidentDetails.text_analysis.severity }} ({{ (incidentDetails.text_analysis.severity_confidence * 100).toFixed(0) }}%)</div>
                  </div>

                  <!-- Vehicle Analysis -->
                  <div v-if="vehicleSummary && vehicleSummary.total > 0" class="vehicle-analysis-section">
                    <h4>🚗 Vehicle Analysis Report</h4>
                    <div class="vehicle-stats-row">
                      <div class="vehicle-stat">
                        <span class="stat-number">{{ vehicleSummary.total }}</span>
                        <span class="stat-label">Total Vehicles Detected</span>
                      </div>
                      <div class="vehicle-stat">
                        <span class="stat-number">{{ vehicleSummary.types.length }}</span>
                        <span class="stat-label">Distinct Vehicle Types</span>
                      </div>
                      <div class="vehicle-stat" v-if="incidentDetails.text_analysis?.mentioned_vehicles?.length">
                        <span class="stat-number">{{ incidentDetails.text_analysis.mentioned_vehicles.length }}</span>
                        <span class="stat-label">Mentions in Text</span>
                      </div>
                      <div class="vehicle-stat" v-if="Object.keys(incidentDetails.image_analysis?.vehicles || {}).length">
                        <span class="stat-number">{{ Object.values(incidentDetails.image_analysis.vehicles).reduce((a,b) => a+b, 0) }}</span>
                        <span class="stat-label">Detected in Images</span>
                      </div>
                    </div>

                    <table class="vehicle-breakdown-table">
                      <thead>
                        <tr>
                          <th>Vehicle Type</th>
                          <th>Count</th>
                          <th>Source</th>
                          <th>Confidence (avg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="item in vehicleSummary.types" :key="item.type">
                          <td><span class="vehicle-type-badge">{{ item.type }}</span></td>
                          <td><strong>{{ item.count }}</strong></td>
                          <td>
                            <span v-if="vehicleSummary.textMentions.includes(item.type)" class="source-tag">📝 Text</span>
                            <span v-if="vehicleSummary.imageDetections[item.type]" class="source-tag">🖼️ Image</span>
                            <span v-if="vehicleSummary.videoDetections[item.type]" class="source-tag">🎥 Video</span>
                          </td>
                          <td>
                            <span v-if="incidentDetails.image_analysis?.objects">~0.80</span>
                            <span v-else>–</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <details class="vehicle-source-details">
                      <summary>📄 View raw detection details</summary>
                      <div v-if="incidentDetails.text_analysis?.mentioned_vehicles?.length" class="source-block">
                        <strong>From text:</strong> {{ incidentDetails.text_analysis.mentioned_vehicles.join(', ') }}
                      </div>
                      <div v-if="Object.keys(incidentDetails.image_analysis?.vehicles || {}).length" class="source-block">
                        <strong>From images:</strong>
                        <ul>
                          <li v-for="(count, type) in incidentDetails.image_analysis.vehicles" :key="type">
                            {{ type }}: {{ count }}
                          </li>
                        </ul>
                      </div>
                      <div v-if="Object.keys(incidentDetails.video_analysis?.vehicles || {}).length" class="source-block">
                        <strong>From video:</strong>
                        <ul>
                          <li v-for="(count, type) in incidentDetails.video_analysis.vehicles" :key="type">
                            {{ type }}: {{ count }}
                          </li>
                        </ul>
                      </div>
                    </details>
                  </div>
                  <div v-else-if="incidentDetails" class="vehicle-analysis-section no-data">
                    <p>No vehicle data available for this incident.</p>
                  </div>

                  <!-- Detected objects in images -->
                  <div v-if="incidentDetails.image_analysis && incidentDetails.image_analysis.objects && incidentDetails.image_analysis.objects.length" class="detail-row">
                    <strong>🖼️ Detected objects in images:</strong>
                    <div><span v-for="obj in incidentDetails.image_analysis.objects.slice(0,5)" :key="obj.label" style="display:inline-block;background:#f3f4f6;padding:2px 8px;border-radius:12px;margin-right:8px;margin-top:4px;">{{ obj.label }} ({{ (obj.confidence * 100).toFixed(0) }}%)</span></div>
                  </div>

                  <!-- Video analysis summary -->
                  <div v-if="incidentDetails.video_analysis && incidentDetails.video_analysis.summary && incidentDetails.video_analysis.summary.length" class="detail-row">
                    <strong>🎥 Video analysis:</strong>
                    <div><span v-for="item in incidentDetails.video_analysis.summary" :key="item.label" style="display:inline-block;background:#e0e7ff;padding:2px 8px;border-radius:12px;margin-right:8px;margin-top:4px;">{{ item.label }} ({{ item.count }} times)</span></div>
                  </div>

                  <!-- Images & videos -->
                  <div v-if="firstImage" class="detail-row">
                    <strong>📷 Image:</strong>
                    <div style="margin-top:6px;">
                      <img :src="getFullImageUrl(firstImage)" style="max-width:100%;max-height:250px;border-radius:8px;" @error="console.error('❌ Image failed to load:', getFullImageUrl(firstImage))" />
                    </div>
                  </div>

                  <div v-if="firstVideo" class="detail-row">
                    <strong>🎥 Video:</strong>
                    <div style="margin-top:6px;">
                      <video controls :src="getFullImageUrl(firstVideo)" style="max-width:100%;border-radius:8px;"></video>
                    </div>
                  </div>
                </div>
              </div>
              <div class="modal-actions">
                <button v-if="incidentDetails?.status === 'pending'" class="btn btn-success" @click="approveIncidentFromModal">✅ Approve</button>
                <button v-else-if="incidentDetails?.status === 'in-progress'" class="btn btn-primary" @click="resolveIncidentFromModal">✓ Resolve</button>
                <button class="btn btn-danger" @click="declineIncident">🗑️ Decline & Delete</button>
                <button class="btn btn-outline" @click="showIncidentModal = false">Close</button>
              </div>
            </div>
          </div>

          <!-- ============================================================
          HEATMAP
          ============================================================ -->
          <div v-else-if="active === 'heatmap'" class="card">
            <h2 class="h2">Incident HeatMap & Predictive Hotspots</h2>
            <p class="p">View current incidents or predict future hotspots based on historical data.</p>

            <div class="filter-bar" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;align-items:flex-end;">
              <div><label class="filter-label">Historical data from:</label><input type="date" v-model="heatmapStartDate" class="filter-select" style="width:auto;" /></div>
              <div><label class="filter-label">to:</label><input type="date" v-model="heatmapEndDate" class="filter-select" style="width:auto;" /></div>
              <button class="btn btn-outline-blue" @click="loadHeatmapData">📍 Show Current Incidents</button>
            </div>

            <div class="responder-toggle">
              <label class="toggle-label">
                <input type="checkbox" v-model="showResponders" /> Show Responder Locations
              </label>
            </div>

            <div class="map-container">
              <div id="heatmap" class="map"></div>
            </div>

            <div class="legend">
              <div class="legend-item"><div class="legend-color" style="background:#10b981;"></div><span>Low severity (current)</span></div>
              <div class="legend-item"><div class="legend-color" style="background:#3b82f6;"></div><span>Medium severity (current)</span></div>
              <div class="legend-item"><div class="legend-color" style="background:#f59e0b;"></div><span>High severity (current)</span></div>
              <div class="legend-item"><div class="legend-color" style="background:#dc2626;"></div><span>Critical severity (current)</span></div>
              <div class="legend-item"><div class="legend-color" style="background:#ff6b6b;border-radius:50%;"></div><span>Predicted hotspot (intensity)</span></div>
            </div>
            <div class="mapStatus">{{ mapStatus }}</div>
          </div>

          <!-- ============================================================
          ANALYTICS
          ============================================================ -->
          <div v-else-if="active === 'analytics'" class="analytics-dashboard">
            <h2 class="h2">📈 Analytics Dashboard</h2>
            <p class="p">Filter by date range to explore trends and patterns.</p>

            <div class="filter-bar" style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin:20px 0 24px;">
              <div class="form-group"><label class="filter-label">From</label><input type="date" v-model="analyticsStartDate" class="filter-select" style="width:auto;" /></div>
              <div class="form-group"><label class="filter-label">To</label><input type="date" v-model="analyticsEndDate" class="filter-select" style="width:auto;" /></div>
              <button class="btn btn-outline-blue btn-sm" @click="loadAnalyticsData">🔄 Refresh</button>
              <button class="btn btn-primary btn-sm" @click="exportAnalyticsToCSV">📊 Export Report</button>
            </div>

            <div class="summary-cards">
              <div class="summary-card"><div class="card-icon total">📊</div><div class="card-content"><div class="card-value">{{ dashboardStats.totalIncidents }}</div><div class="card-label">Total Incidents</div></div></div>
              <div class="summary-card"><div class="card-icon pending">⏳</div><div class="card-content"><div class="card-value">{{ dashboardStats.pending }}</div><div class="card-label">Pending</div></div></div>
              <div class="summary-card"><div class="card-icon progress">🔄</div><div class="card-content"><div class="card-value">{{ dashboardStats.inProgress }}</div><div class="card-label">In Progress</div></div></div>
              <div class="summary-card"><div class="card-icon resolved">✅</div><div class="card-content"><div class="card-value">{{ dashboardStats.resolved }}</div><div class="card-label">Resolved</div></div></div>
              <div class="summary-card" v-if="analyticsDataEnhanced.avgResolutionHours > 0">
                <div class="card-icon" style="background:#f0fdf4;color:#15803d;">⏱️</div>
                <div class="card-content"><div class="card-value">{{ analyticsDataEnhanced.avgResolutionHours.toFixed(1) }}h</div><div class="card-label">Avg. Resolution Time</div></div>
              </div>
            </div>

            <div class="charts-grid">
              <div class="chart-card">
                <h3>Incidents by Type</h3>
                <div class="bar-chart">
                  <div v-for="item in analyticsData.incidentsByType" :key="item.name" class="bar-item">
                    <span class="bar-label">{{ item.name }}</span>
                    <div class="bar-container"><div class="bar-fill" :style="{ width: (item.count / totalIncidentsByType * 100) + '%' }"></div></div>
                    <span class="bar-count">{{ item.count }}</span>
                  </div>
                  <div v-if="!analyticsData.incidentsByType.length" class="no-data">No data for selected range</div>
                </div>
              </div>

              <div class="chart-card">
                <h3>Severity Distribution</h3>
                <div class="pie-container">
                  <div class="pie-chart" :style="{ background: pieGradient }"></div>
                  <div class="pie-legend">
                    <div v-for="item in severityWithPercent" :key="item.level" class="legend-item">
                      <span class="legend-color" :style="{ backgroundColor: severityColors[item.level.toLowerCase()] }"></span>
                      <span class="legend-label">{{ item.level }} ({{ item.percentage }}%)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="chart-card">
                <h3>Incidents by Barangay</h3>
                <div class="bar-chart">
                  <div v-for="item in analyticsDataEnhanced.barangayDistribution" :key="item.barangay" class="bar-item">
                    <span class="bar-label">{{ item.barangay }}</span>
                    <div class="bar-container"><div class="bar-fill" :style="{ width: (item.count / maxBarangayCount * 100) + '%' }"></div></div>
                    <span class="bar-count">{{ item.count }}</span>
                  </div>
                  <div v-if="!analyticsDataEnhanced.barangayDistribution.length" class="no-data">No barangay data yet</div>
                </div>
              </div>

              <div class="chart-card">
                <h3>Time of Day</h3>
                <div class="bar-chart" style="height:200px;overflow-y:auto;">
                  <div v-for="item in analyticsDataEnhanced.hourlyDistribution" :key="item.hour" class="bar-item">
                    <span class="bar-label">{{ formatHour(item.hour) }}</span>
                    <div class="bar-container"><div class="bar-fill" :style="{ width: (item.count / maxHourlyCount * 100) + '%', background: 'linear-gradient(90deg, #3b82f6, #6366f1)' }"></div></div>
                    <span class="bar-count">{{ item.count }}</span>
                  </div>
                  <div v-if="!analyticsDataEnhanced.hourlyDistribution.length" class="no-data">No hourly data</div>
                </div>
              </div>

              <div class="chart-card full-width">
                <h3>Weekly Trend (Last 4 Weeks)</h3>
                <div class="activity-chart" style="height:180px;">
                  <div v-for="week in analyticsDataEnhanced.weeklyTrend.slice(0,4)" :key="week.week" class="activity-bar">
                    <div class="bar" :style="{ height: (week.count / maxWeeklyTrend * 100) + '%', background: 'linear-gradient(to top, #0b4fa3, #3b82f6)' }"></div>
                    <span class="bar-date">{{ formatWeekLabel(week.week) }}</span>
                  </div>
                  <div v-if="!analyticsDataEnhanced.weeklyTrend.length" class="no-data" style="align-self:center;">No weekly data</div>
                </div>
              </div>

              <div class="chart-card full-width">
                <h3>Daily Activity (Last 7 Days)</h3>
                <div class="activity-chart">
                  <div v-for="day in analyticsData.activitySummary.daily.slice(0,7)" :key="day.date" class="activity-bar">
                    <div class="bar" :style="{ height: (day.activity / maxActivity) * 100 + '%' }"></div>
                    <span class="bar-date">{{ formatDate(day.date) }}</span>
                  </div>
                </div>
              </div>

              <!-- Vehicle Types Breakdown -->
              <div class="chart-card full-width">
                <h3>🚗 Vehicle Types Detected</h3>
                <div class="bar-chart">
                  <div v-for="item in analyticsData.vehicleTypes" :key="item.type" class="bar-item">
                    <span class="bar-label">{{ item.type }}</span>
                    <div class="bar-container">
                      <div class="bar-fill" :style="{ width: (item.count / totalVehicleCount * 100) + '%', background: 'linear-gradient(90deg, #8b5cf6, #6366f1)' }"></div>
                    </div>
                    <span class="bar-count">{{ item.count }}</span>
                  </div>
                  <div v-if="!analyticsData.vehicleTypes.length" class="no-data">No vehicle data yet</div>
                </div>
              </div>

              <!-- Barangay Incident Trends -->
              <div class="chart-card full-width">
                <h3>📍 Top Barangays by Incident Volume</h3>
                <div class="barangay-trend-chart">
                  <div v-for="barangay in analyticsData.barangayTrends" :key="barangay.barangay" class="trend-group">
                    <div class="trend-bar-wrapper">
                      <div class="trend-bar today" :style="{ height: (barangay.today / maxBarangayPeriodCount * 100) + '%' }"></div>
                      <div class="trend-bar week" :style="{ height: (barangay.week / maxBarangayPeriodCount * 100) + '%' }"></div>
                      <div class="trend-bar month" :style="{ height: (barangay.month / maxBarangayPeriodCount * 100) + '%' }"></div>
                    </div>
                    <span class="trend-label">{{ barangay.barangay }}</span>
                  </div>
                  <div v-if="!analyticsData.barangayTrends.length" class="no-data" style="align-self:center;">No barangay data</div>
                </div>
                <div class="trend-legend">
                  <span><span class="legend-dot today"></span> Today</span>
                  <span><span class="legend-dot week"></span> Past Week</span>
                  <span><span class="legend-dot month"></span> Past Month</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ============================================================
          ASSIGNMENTS (with pagination)
          ============================================================ -->
          <div v-else-if="active === 'assignments'" class="card">
            <h2 class="h2">📋 Incident Assignments</h2>
            <p class="p">Assign incidents to responders and manage workloads.</p>

            <div class="filter-bar" style="display:flex;gap:12px;margin:16px 0;flex-wrap:wrap;align-items:center;">
              <label class="filter-label">Filter by responder:</label>
              <select v-model="assignmentsFilterResponder" @change="loadAssignments" class="filter-select" style="width:auto;">
                <option value="all">All incidents</option>
                <option value="unassigned">Unassigned only</option>
                <option v-for="resp in availableResponders" :key="resp.id" :value="resp.id">{{ resp.name }} (Responder)</option>
              </select>
              <button @click="exportAssignments" class="btn btn-outline-blue" style="margin-left:8px;">📥 Export CSV</button>
              <button @click="autoAssignAll" class="btn btn-primary">🤖 Auto‑Assign All</button>
              <div class="assignment-stats" style="margin-left:auto;display:flex;gap:16px;">
                <span>📊 Total: {{ assignmentStats.total }}</span>
                <span>👤 Assigned: {{ assignmentStats.assigned }}</span>
                <span>⚠️ Unassigned: {{ assignmentStats.unassigned }}</span>
              </div>
            </div>

            <div v-if="assignmentsLoading" class="loading">Loading assignments...</div>
            <div v-else class="table-responsive">
              <div class="table">
                <div class="row assignments-row head">
                  <div>ID</div><div>Type</div><div>Severity</div><div>Location</div>
                  <div>Status</div><div>Assigned To</div><div>Actions</div>
                </div>
                <div v-for="incident in paginatedAssignments" :key="incident.id" class="row assignments-row">
                  <div>#{{ incident.id }}</div>
                  <div>{{ incident.type }}</div>
                  <div><span class="pill" :style="{ backgroundColor: severityColors[incident.severity] }">{{ incident.severity }}</span></div>
                  <div>{{ incident.barangay }}</div>
                  <div><span class="pill" :style="{ backgroundColor: statusColors[incident.status] }">{{ incident.status }}</span></div>
                  <div>{{ getResponderName(incident.assigned_to) }}</div>
                  <div class="action-buttons">
                    <select 
                      :key="incident.id" 
                      :value="incident.assigned_to ?? null" 
                      @change="assignToResponder(incident.id, $event.target.value)" 
                      class="responder-select"
                    >
                      <option :value="null">Unassign</option>
                      <option v-for="resp in availableResponders" :key="resp.id" :value="resp.id">{{ resp.name }}</option>
                    </select>
                    <button @click="viewIncidentDetails(incident.id)" class="btn-small">👁️ View</button>
                    <button v-if="incident.status === 'pending'" @click="approveIncidentFromList(incident.id)" class="btn-small btn-success">✅ Approve</button>
                    <button v-else-if="incident.status === 'in-progress'" @click="resolveIncidentFromList(incident.id)" class="btn-small btn-primary">✓ Resolve</button>
                    <span v-else class="resolved-badge">Resolved</span>
                  </div>
                </div>
                <div v-if="assignmentsList.length === 0 && !assignmentsLoading" class="no-data">No incidents match the filter.</div>
              </div>
            </div>

            <!-- Pagination for assignments -->
            <div v-if="totalAssignmentsPages > 1" class="pagination">
              <div class="pagination-info">
                Showing {{ (assignmentsPagination.currentPage - 1) * assignmentsPagination.perPage + 1 }} to {{ Math.min(assignmentsPagination.currentPage * assignmentsPagination.perPage, assignmentsPagination.total) }} of {{ assignmentsPagination.total }} assignments
              </div>
              <div class="pagination-controls">
                <button @click="prevAssignmentsPage" :disabled="assignmentsPagination.currentPage === 1" class="pagination-btn">← Previous</button>
                <div class="page-numbers">
                  <button v-for="page in getPageNumbers()" :key="page" @click="goToAssignmentsPage(page)" :class="{ active: page === assignmentsPagination.currentPage, dots: page === '...' }" class="page-btn" :disabled="page === '...'">{{ page }}</button>
                </div>
                <button @click="nextAssignmentsPage" :disabled="assignmentsPagination.currentPage === totalAssignmentsPages" class="pagination-btn">Next →</button>
              </div>
            </div>
          </div>

          <!-- ============================================================
          CHATS
          ============================================================ -->
          <div v-else-if="active === 'chats'" class="card">
            <h2 class="h2">Chat Management</h2>
            <div class="chats-container">
              <div class="chat-list">
                <div v-for="chat in adminChats" :key="chat.id" class="chat-item" @click="openChat(chat.id)">
                  <div class="chat-avatar">{{ chat.user_name?.charAt(0) || 'U' }}</div>
                  <div class="chat-info">
                    <div class="chat-name">{{ chat.user_name || 'Unknown User' }}</div>
                    <div class="chat-preview">{{ chat.last_message?.substring(0, 50) || 'No messages yet' }}</div>
                  </div>
                  <div class="chat-time">{{ new Date(chat.last_activity).toLocaleTimeString() }}</div>
                </div>
              </div>

              <div v-if="showChatModal" class="modal-overlay" @click.self="closeChatModal">
                <div class="modal-content" style="max-width:800px;">
                  <div class="modal-header">
                    <h3>Chat with User</h3>
                    <button class="modal-close" @click="closeChatModal">×</button>
                  </div>
                  <div class="modal-body" style="padding:0;">
                    <div class="chat-window" style="height:500px;display:flex;flex-direction:column;">
                      <div class="chat-messages" style="flex:1;overflow-y:auto;padding:1rem;">
                        <div v-for="(msg, idx) in chatMessages" :key="idx" class="message" :class="msg.role === 'admin' ? 'admin' : 'user'">
                          <div class="message-content"><strong>{{ msg.role === 'admin' ? 'Admin' : 'User' }}:</strong> {{ msg.message }}</div>
                          <div class="message-time">{{ new Date(msg.timestamp).toLocaleTimeString() }}</div>
                        </div>
                        <div v-if="chatMessages.length === 0" class="no-data">No messages yet.</div>
                      </div>
                      <div class="chat-input" style="border-top:1px solid #e2e8f0;padding:1rem;display:flex;gap:0.5rem;">
                        <input v-model="newMessage" @keyup.enter="sendAdminMessage" placeholder="Type your message..." class="input" style="flex:1;" />
                        <button @click="sendAdminMessage" class="btn btn-primary">Send</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ============================================================
          BROADCAST
          ============================================================ -->
          <div v-else-if="active === 'broadcast'" class="broadcast-container">
            <div class="broadcast-header">
              <h2 class="broadcast-title">📢 Broadcast Alert System</h2>
              <p class="broadcast-subtitle">Send emergency alerts to citizens and responders</p>
            </div>

            <div class="broadcast-layout">
              <div class="broadcast-form-card">
                <form @submit.prevent="sendAlert" class="broadcast-form">
                  <div class="form-group">
                    <label class="form-label">Alert Message <span class="required">*</span></label>
                    <textarea v-model="alertData.message" class="form-input" rows="4" placeholder="Enter alert message..."></textarea>
                  </div>

                  <div class="form-group">
                    <label class="form-label">Attach Image (Optional)</label>
                    <div class="image-upload-area">
                      <label class="image-upload-btn">📷 Choose Image<input type="file" accept="image/*" @change="onImageSelect" hidden /></label>
                      <div v-if="imagePreview" class="image-preview">
                        <img :src="imagePreview" alt="Preview" />
                        <button @click="clearImage" class="btn-icon-small" title="Remove">✕</button>
                      </div>
                    </div>
                  </div>

                  <div class="form-group">
                    <label class="form-label">Severity Level</label>
                    <div class="severity-pills">
                      <button v-for="level in ['low','medium','high','critical']" :key="level" type="button"
                        @click="alertData.severity = level"
                        class="severity-pill" :class="{ active: alertData.severity === level, [level]: true }">
                        {{ level }}
                      </button>
                    </div>
                  </div>

                  <div class="form-group">
                    <label class="form-label">Announcement Expiration</label>
                    <div class="expiration-options">
                      <label class="expiration-radio"><input type="radio" value="permanent" v-model="expirationType" /> 🔷 Permanent (never expires)</label>
                      <label class="expiration-radio"><input type="radio" value="timed" v-model="expirationType" /> 🕒 Time‑limited</label>
                    </div>
                  </div>

                  <div v-if="expirationType === 'timed'" class="form-group">
                    <label class="form-label">Expiration Date & Time <span class="required">*</span></label>
                    <input type="datetime-local" v-model="expiresAt" class="form-input" required />
                    <div class="form-hint">Alert will automatically expire after this date/time.</div>
                  </div>

                  <div class="form-group">
                    <label class="form-label">Quick Templates</label>
                    <div class="template-grid">
                      <button v-for="(template, idx) in alertTemplates" :key="idx" type="button"
                        @click="useTemplate(template)" class="template-btn">
                        {{ template }}
                      </button>
                    </div>
                  </div>

                  <div class="form-actions">
                    <button type="submit" class="btn btn-primary btn-lg btn-block">📢 Broadcast Alert</button>
                  </div>
                </form>
              </div>

              <div class="broadcast-map-card">
                <div class="map-header">
                  <h3 class="map-title">🗺️ Affected Area (Optional)</h3>
                  <p class="map-subtitle">Draw a line (road closure) or place a marker</p>
                </div>

                <div class="map-toolbar">
                  <button @click="startDrawing" :disabled="isDrawing" class="btn-draw" :class="{ active: isDrawing }">
                    {{ isDrawing ? 'Drawing...' : '✏️ Draw Line' }}
                  </button>
                  <button v-if="isDrawing" @click="finishDrawing" class="btn-draw">✅ Finish</button>
                  <button v-if="isDrawing" @click="cancelDrawing" class="btn-draw">❌ Cancel</button>
                  <button @click="clearGeometry" class="btn-draw" :disabled="!drawnGeometry">🗑️ Clear</button>
                </div>

                <div id="broadcast-map" class="broadcast-map"></div>

                <div v-if="drawnGeometry" class="geometry-preview">
                  <div class="geometry-info">
                    <span class="geometry-badge">{{ geometrySummary }}</span>
                    <button @click="clearGeometry" class="btn-icon" title="Clear drawing">✕</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ============================================================
          USERS
          ============================================================ -->
          <div v-else-if="active === 'users'" class="card user-management-section">
            <div class="section-header">
              <div class="section-title">
                <h2 class="h2">👥 User Management</h2>
                <p class="section-subtitle">Manage all system users, their roles, and status</p>
              </div>
              <div class="user-stats-summary">
                <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-content"><div class="stat-value">{{ dashboardStats.totalUsers || allUsers.length }}</div><div class="stat-label">Total Users</div></div></div>
                <div class="stat-card"><div class="stat-icon">👨‍💼</div><div class="stat-content"><div class="stat-value" style="color:#dc2626;">{{ dashboardStats.citizens || 0 }}</div><div class="stat-label">Citizens</div></div></div>
                <div class="stat-card"><div class="stat-icon">👨‍⚕️</div><div class="stat-content"><div class="stat-value" style="color:#10b981;">{{ dashboardStats.responders || 0 }}</div><div class="stat-label">Responders</div></div></div>
              </div>
            </div>

            <div class="action-bar">
              <div class="action-group">
                <button @click="showCreateUserModal = true" class="btn btn-primary"><span class="btn-icon">➕</span> Add New User</button>
                <button @click="exportUsers('csv')" class="btn btn-outline-blue"><span class="btn-icon">📥</span> Export CSV</button>
              </div>
              <div class="search-box">
                <span class="search-icon">🔍</span>
                <input v-model="userSearchQuery" type="text" placeholder="Search users by name, email, or phone..." class="search-input" />
                <button v-if="userSearchQuery" @click="userSearchQuery = ''" class="clear-search">✕</button>
              </div>
            </div>

            <div v-if="selectedUsers.size > 0" class="bulk-actions-bar">
              <div class="bulk-info"><span class="selected-count">{{ selectedUsers.size }}</span> user(s) selected</div>
              <div class="bulk-controls">
                <select v-model="bulkAction" class="bulk-select"><option value="">Choose action...</option><option value="activate">Activate Selected</option><option value="deactivate">Deactivate Selected</option><option value="delete">Delete Selected</option></select>
                <button @click="executeBulkAction" :disabled="!bulkAction" class="btn btn-warning">Apply</button>
                <button @click="selectedUsers.clear()" class="btn btn-outline">Cancel</button>
              </div>
            </div>

            <div class="advanced-filters">
              <div class="filter-row">
                <div class="filter-group"><label class="filter-label">Filter by Role</label><select v-model="usersFilter" @change="loadAllUsers(1)" class="filter-select"><option value="all">All Roles</option><option value="user">Citizens</option><option value="responder">Responders</option><option value="tmo">TMO Officers</option><option value="admin">Administrators</option></select></div>
                <div class="filter-group"><label class="filter-label">Filter by Status</label><select v-model="advancedFilters.status" class="filter-select"><option value="">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                <div class="filter-group"><label class="filter-label">Filter by Barangay</label><select v-model="advancedFilters.barangay" class="filter-select"><option value="">All Barangays</option><option v-for="barangay in barangays" :key="barangay" :value="barangay">{{ barangay }}</option></select></div>
                <div class="filter-group"><label class="filter-label">Date Range</label><div class="date-range"><input v-model="advancedFilters.dateRange.start" type="date" class="date-input" placeholder="Start date" /><span class="date-separator">to</span><input v-model="advancedFilters.dateRange.end" type="date" class="date-input" placeholder="End date" /></div></div>
              </div>
            </div>

            <div class="table-container">
              <div class="table-responsive">
                <table class="users-table">
                  <thead>
                    <tr>
                      <th class="select-column"><input type="checkbox" :checked="selectedUsers.size === paginatedUsers.length && paginatedUsers.length > 0" @change="toggleSelectAll" class="select-all-checkbox" /></th>
                      <th>ID</th><th>User</th><th>Contact</th><th>Role</th><th>Status</th><th>Created</th><th>Online</th><th class="actions-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="user in paginatedUsers" :key="user.id" :class="{ selected: selectedUsers.has(user.id) }">
                      <td class="select-cell"><input type="checkbox" :checked="selectedUsers.has(user.id)" @change="toggleSelectUser(user.id)" class="user-checkbox" /></td>
                      <td class="user-id">#{{ user.id }}</td>
                      <td class="user-info">
                        <div class="user-avatar-sm">
                          <div v-if="user.profile_photo" class="avatar-image-sm"><img :src="getFullImageUrl(user.profile_photo)" :alt="user.full_name || user.name" @error="handleTableImageError($event, user)" class="avatar-img" /></div>
                          <span v-else>{{ (user.full_name || user.name || 'U').charAt(0) }}</span>
                        </div>
                        <div class="user-details">
                          <div class="user-name">{{ user.full_name || user.name || 'Unknown' }}</div>
                          <div class="user-email">{{ user.email }}</div>
                        </div>
                      </td>
                      <td class="contact-info"><div class="phone">{{ user.contact_number || 'N/A' }}</div></td>
                      <td><span class="role-badge" :style="{ backgroundColor: roleColors[user.role] }">{{ roleLabels[user.role] || user.role }}</span></td>
                      <td><span class="status-badge" :class="user.status || 'active'">{{ user.status || 'active' }}</span></td>
                      <td class="created-date">{{ new Date(user.created_at).toLocaleDateString() }}</td>
                      <td><span v-if="user.is_online" class="online-indicator" title="Online now">🟢</span><span v-else class="offline-indicator" title="Offline">⚫</span></td>
                      <td class="actions-cell">
                        <div class="action-buttons">
                          <button @click="viewUserDetails(user)" class="role-select-sm" title="View Details">View Details</button>
                          <select @change="updateUserRole(user.id, $event.target.value)" class="role-select-sm">
                            <option value="">Change Role</option>
                            <option value="user">Citizen</option>
                            <option value="responder">Responder</option>
                            <option value="tmo">TMO Officer</option>
                            <option value="admin">Administrator</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="paginatedUsers.length === 0">
                      <td colspan="9" class="no-data">
                        <div class="empty-state"><div class="empty-icon">👤</div><h3>No users found</h3><p>Try adjusting your search or filters</p><button @click="resetFilters" class="btn btn-outline">Clear all filters</button></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="pagination.totalPages > 1" class="pagination">
                <div class="pagination-info">Showing {{ ((pagination.currentPage - 1) * pagination.perPage) + 1 }} to {{ Math.min(pagination.currentPage * pagination.perPage, pagination.totalItems) }} of {{ pagination.totalItems }} users</div>
                <div class="pagination-controls">
                  <button @click="prevPage" :disabled="pagination.currentPage === 1" class="pagination-btn">← Previous</button>
                  <div class="page-numbers">
                    <button v-for="page in getPageNumbers()" :key="page" @click="goToPage(page)" :class="{ active: page === pagination.currentPage, dots: page === '...' }" class="page-btn" :disabled="page === '...'">{{ page }}</button>
                  </div>
                  <button @click="nextPage" :disabled="pagination.currentPage === pagination.totalPages" class="pagination-btn">Next →</button>
                </div>
              </div>
            </div>
          </div>

          <!-- User Details/Edit Modal -->
          <div v-if="showUserModal" class="modal-overlay" @click.self="showUserModal = false">
            <div class="modal-content" style="max-width:700px;">
              <div class="modal-header">
                <h3>{{ isEditingUser ? 'Edit User' : 'User Details' }}</h3>
                <button class="modal-close" @click="closeUserModal">×</button>
              </div>
              <div class="modal-body">
                <div class="user-profile-header">
                  <div class="user-avatar-large">
                    <div v-if="selectedUser.profile_photo" class="avatar-image"><img :src="getFullImageUrl(selectedUser.profile_photo)" :alt="selectedUser.full_name || selectedUser.name" @error="handleImageError" /></div>
                    <div v-else class="avatar-initials">{{ getInitials(selectedUser.full_name || selectedUser.name || 'U') }}</div>
                  </div>
                  <div class="user-basic-info">
                    <h4 v-if="!isEditingUser">{{ selectedUser.full_name || selectedUser.name || 'Unknown User' }}</h4>
                    <div v-else class="form-group"><label>Full Name</label><input v-model="editedUser.full_name" type="text" class="input" placeholder="Full Name" /></div>
                    <span class="user-role-badge" :style="{ backgroundColor: roleColors[selectedUser.role] }">{{ roleLabels[selectedUser.role] || selectedUser.role }}</span>
                  </div>
                </div>

                <div v-if="!isEditingUser" class="user-details-grid">
                  <div class="detail-item"><label>User ID:</label><span>#{{ selectedUser.id }}</span></div>
                  <div class="detail-item"><label>Email:</label><span>{{ selectedUser.email }}</span></div>
                  <div class="detail-item"><label>Phone:</label><span>{{ selectedUser.contact_number || 'Not provided' }}</span></div>
                  <div class="detail-item"><label>Barangay:</label><span>{{ selectedUser.barangay || 'Not specified' }}</span></div>
                  <div class="detail-item"><label>Address:</label><span>{{ selectedUser.address || 'Not provided' }}</span></div>
                  <div class="detail-item"><label>Account Status:</label><div class="status-with-action"><span class="status-badge" :class="selectedUser.status || 'active'">{{ selectedUser.status || 'active' }}</span><button @click="toggleUserStatus(selectedUser.id, selectedUser.status)" class="btn-icon-small status-toggle">{{ (selectedUser.status === 'active' || !selectedUser.status) ? '❌' : '✅' }}</button></div></div>
                  <div class="detail-item"><label>Role:</label><div class="role-with-action"><span class="role-badge-sm" :style="{ backgroundColor: roleColors[selectedUser.role] }">{{ roleLabels[selectedUser.role] || selectedUser.role }}</span><select @change="updateUserRole(selectedUser.id, $event.target.value)" class="role-select-xs"><option value="">Change Role</option><option value="user">Citizen</option><option value="responder">Responder</option><option value="tmo">TMO Officer</option><option value="admin">Administrator</option></select></div></div>
                  <div class="detail-item"><label>Account Created:</label><span v-if="selectedUser.created_at">{{ new Date(selectedUser.created_at).toLocaleDateString() }}</span><span v-else>N/A</span></div>
                </div>

                <div v-if="isEditingUser" class="edit-form">
                  <div class="form-section"><h4>Basic Information</h4><div class="form-grid"><div class="form-group"><label>Email:</label><input v-model="editedUser.email" type="email" class="input" placeholder="Email" /></div><div class="form-group"><label>Phone:</label><input v-model="editedUser.contact_number" type="text" class="input" placeholder="Contact Number" /></div><div class="form-group"><label>Barangay:</label><select v-model="editedUser.barangay" class="input"><option value="">Select Barangay</option><option v-for="barangay in barangays" :key="barangay" :value="barangay">{{ barangay }}</option></select></div><div class="form-group"><label>Address:</label><input v-model="editedUser.address" type="text" class="input" placeholder="Full Address" /></div></div></div>
                  <div class="form-section"><h4>Emergency Contact</h4><div class="form-grid"><div class="form-group"><label>Contact Name:</label><input v-model="editedUser.emergency_contact_name" type="text" class="input" placeholder="Emergency Contact Name" /></div><div class="form-group"><label>Contact Number:</label><input v-model="editedUser.emergency_contact_number" type="text" class="input" placeholder="Emergency Contact Number" /></div></div></div>
                  <div class="form-section"><h4>Account Settings</h4><div class="form-grid"><div class="form-group"><label>Role:</label><select v-model="editedUser.role" class="input"><option value="user">Citizen</option><option value="responder">Responder</option><option value="tmo">TMO Officer</option><option value="admin">Administrator</option></select></div><div class="form-group"><label>Status:</label><select v-model="editedUser.status" class="input"><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></div></div></div>
                </div>

                <div v-if="!isEditingUser && (selectedUser.emergency_contact_name || selectedUser.emergency_contact_number)" class="emergency-section">
                  <h4>Emergency Contact</h4>
                  <div class="emergency-details">
                    <div class="detail-item"><label>Contact Name:</label><span>{{ selectedUser.emergency_contact_name || 'Not provided' }}</span></div>
                    <div class="detail-item"><label>Contact Number:</label><span>{{ selectedUser.emergency_contact_number || 'Not provided' }}</span></div>
                  </div>
                </div>

                <div class="modal-actions">
                  <button v-if="!isEditingUser" class="btn btn-outline" @click="showUserModal = false">Close</button>
                  <button v-if="!isEditingUser" class="btn btn-primary" @click="startEditUser">Edit User</button>
                  <div v-if="isEditingUser" class="edit-actions">
                    <button class="btn btn-outline" @click="cancelEdit">Cancel</button>
                    <button class="btn btn-danger" @click="deleteUser(selectedUser.id)" :disabled="selectedUser.id === 1">Delete User</button>
                    <button class="btn btn-primary" @click="saveUser" :disabled="saving">{{ saving ? 'Saving...' : 'Save Changes' }}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Create User Modal -->
          <div v-if="showCreateUserModal" class="modal-overlay" @click.self="showCreateUserModal = false">
            <div class="modal-content" style="max-width:800px;">
              <div class="modal-header">
                <h3>Create New User</h3>
                <button class="modal-close" @click="closeCreateUserModal">×</button>
              </div>
              <div class="modal-body">
                <div v-if="Object.keys(validationErrors).length > 0" class="validation-errors">
                  <div class="error-alert"><div class="error-icon">⚠️</div><div class="error-content"><h4>Please fix the following errors:</h4><ul><li v-for="(error, field) in validationErrors" :key="field"><strong>{{ formatFieldName(field) }}:</strong> {{ error }}</li></ul></div></div>
                </div>

                <div class="create-user-form">
                  <div class="form-section"><h4>Account Information</h4><div class="form-grid">
                    <div class="form-group" :class="{ error: validationErrors.full_name }"><label for="full_name">Full Name *</label><input id="full_name" v-model="newUser.full_name" type="text" class="input" placeholder="Enter full name" :class="{ error: validationErrors.full_name }" /><div v-if="validationErrors.full_name" class="error-message">{{ validationErrors.full_name }}</div></div>
                    <div class="form-group" :class="{ error: validationErrors.email }"><label for="email">Email Address *</label><input id="email" v-model="newUser.email" type="email" class="input" placeholder="user@example.com" :class="{ error: validationErrors.email }" /><div v-if="validationErrors.email" class="error-message">{{ validationErrors.email }}</div></div>
                    <div class="form-group" :class="{ error: validationErrors.password }"><label for="password">Password *</label><input id="password" v-model="newUser.password" type="password" class="input" placeholder="At least 6 characters" :class="{ error: validationErrors.password }" /><div v-if="validationErrors.password" class="error-message">{{ validationErrors.password }}</div></div>
                    <div class="form-group" :class="{ error: validationErrors.confirm_password }"><label for="confirm_password">Confirm Password *</label><input id="confirm_password" v-model="newUser.confirm_password" type="password" class="input" placeholder="Confirm your password" :class="{ error: validationErrors.confirm_password }" /><div v-if="validationErrors.confirm_password" class="error-message">{{ validationErrors.confirm_password }}</div></div>
                    <div class="form-group" :class="{ error: validationErrors.contact_number }"><label for="contact_number">Contact Number *</label><input id="contact_number" v-model="newUser.contact_number" type="text" class="input" placeholder="09123456789" :class="{ error: validationErrors.contact_number }" /><div v-if="validationErrors.contact_number" class="error-message">{{ validationErrors.contact_number }}</div></div>
                    <div class="form-group"><label for="role">User Role</label><select id="role" v-model="newUser.role" class="input"><option value="user">Citizen</option><option value="responder">Responder</option><option value="tmo">TMO Officer</option><option value="admin">Administrator</option></select></div>
                  </div></div>

                  <div class="form-section"><h4>Location Information</h4><div class="form-grid">
                    <div class="form-group"><label for="barangay">Barangay</label><select id="barangay" v-model="newUser.barangay" class="input"><option value="">Select Barangay</option><option v-for="barangay in barangays" :key="barangay" :value="barangay">{{ barangay }}</option></select></div>
                    <div class="form-group full-width"><label for="address">Full Address</label><input id="address" v-model="newUser.address" type="text" class="input" placeholder="Street, Building, Landmark" /></div>
                  </div></div>

                  <div class="form-section"><h4>Emergency Contact (Optional)</h4><div class="form-grid">
                    <div class="form-group"><label for="emergency_contact_name">Emergency Contact Name</label><input id="emergency_contact_name" v-model="newUser.emergency_contact_name" type="text" class="input" placeholder="Contact person name" /></div>
                    <div class="form-group"><label for="emergency_contact_number">Emergency Contact Number</label><input id="emergency_contact_number" v-model="newUser.emergency_contact_number" type="text" class="input" placeholder="09123456789" /></div>
                  </div></div>

                  <div class="form-section"><h4>Account Settings</h4><div class="form-grid">
                    <div class="form-group"><label for="status">Account Status</label><select id="status" v-model="newUser.status" class="input"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                    <div class="form-group"><label class="checkbox-label"><input type="checkbox" v-model="sendWelcomeEmail" /> Send welcome email with credentials</label><div class="form-hint">User will receive an email with their login details</div></div>
                  </div></div>

                  <div class="preview-section">
                    <h4>User Summary</h4>
                    <div class="preview-card">
                      <div class="preview-header">
                        <div class="preview-avatar">{{ getInitials(newUser.full_name) || 'NU' }}</div>
                        <div class="preview-info"><div class="preview-name">{{ newUser.full_name || 'New User' }}</div><div class="preview-email">{{ newUser.email || 'email@example.com' }}</div></div>
                        <span class="preview-role-badge" :style="{ backgroundColor: roleColors[newUser.role] }">{{ roleLabels[newUser.role] || 'Citizen' }}</span>
                      </div>
                      <div class="preview-details">
                        <div class="preview-detail"><span class="detail-label">Phone:</span><span class="detail-value">{{ newUser.contact_number || 'Not provided' }}</span></div>
                        <div class="preview-detail"><span class="detail-label">Barangay:</span><span class="detail-value">{{ newUser.barangay || 'Not specified' }}</span></div>
                        <div class="preview-detail"><span class="detail-label">Status:</span><span class="detail-value status-badge" :class="newUser.status || 'active'">{{ newUser.status || 'active' }}</span></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="modal-actions">
                  <button class="btn btn-outline" @click="closeCreateUserModal">Cancel</button>
                  <button class="btn btn-primary" @click="createUser" :disabled="creatingUser">{{ creatingUser ? 'Creating...' : 'Create User' }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- ============================================================
          LEGAL COMPLIANCE
          ============================================================ -->
          <div v-else-if="active === 'legal'" class="card">
            <div class="section-header">
              <div>
                <h2 class="h2">⚖️ Legal Compliance</h2>
                <p class="p">Manage laws and official legal statements displayed to all users.</p>
              </div>
              <button class="btn btn-primary" @click="openCreateLegal">➕ Add New Law</button>
              <button class="btn btn-outline-blue" @click="showExportModal = true">📤 Export</button>
            </div>

            <div style="margin-bottom:1rem;display:flex;gap:12px;align-items:center;">
              <label class="filter-label">Filter by Category:</label>
              <select v-model="legalCategoryFilter" @change="loadLegalCompliances" class="filter-select" style="width:auto;">
                <option value="">All Categories</option>
                <option v-for="cat in legalCategories" :key="cat" :value="cat">{{ cat }}</option>
              </select>
            </div>

            <div v-if="legalLoading">Loading...</div>
            <div v-else-if="legalCompliances.length === 0" class="empty-state" style="padding:2rem;">
              <div style="font-size:2rem;">⚖️</div>
              <p>No legal compliance entries yet. Click "Add New Law" to get started.</p>
            </div>
            <div v-else class="legal-list">
              <div v-for="entry in legalCompliances" :key="entry.id" class="legal-card">
                <div class="legal-card-header">
                  <div><span class="legal-category-badge">{{ entry.category }}</span><span v-if="entry.law_number" class="legal-law-num">{{ entry.law_number }}</span></div>
                  <span class="status-badge" :class="entry.is_active ? 'active' : 'inactive'">{{ entry.is_active ? 'Active' : 'Inactive' }}</span>
                </div>
                <h3 class="legal-title">{{ entry.title }}</h3>
                <p class="legal-desc">{{ entry.description }}</p>
                <details class="legal-statement-toggle">
                  <summary>📜 View Official Statement</summary>
                  <p class="legal-statement-text">{{ entry.official_statement }}</p>
                </details>
                <div class="legal-meta">📅 Effective: {{ entry.effective_date || 'Permanent' }}</div>
                <div class="legal-actions">
                  <button @click="openEditLegal(entry)" class="btn-small">✎ Edit</button>
                  <button @click="toggleLegalStatus(entry)" class="btn-small">{{ entry.is_active ? '🔕 Deactivate' : '✅ Activate' }}</button>
                  <button @click="deleteLegal(entry.id)" class="btn-small btn-danger">🗑️ Delete</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Legal Create/Edit Modal -->
          <div v-if="showLegalModal" class="modal-overlay" @click.self="showLegalModal = false">
            <div class="modal-content" style="max-width:700px;">
              <div class="modal-header">
                <h3>{{ editingLegal ? 'Edit Legal Entry' : 'Add New Legal Entry' }}</h3>
                <button class="modal-close" @click="showLegalModal = false">×</button>
              </div>
              <div class="modal-body">
                <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                  <div class="form-group" style="grid-column:1/-1;"><label class="form-label">Title <span style="color:red">*</span></label><input v-model="legalForm.title" class="form-input" placeholder="e.g., Republic Act No. 10121" /></div>
                  <div class="form-group"><label class="form-label">Law / Reference Number</label><input v-model="legalForm.law_number" class="form-input" placeholder="e.g., RA 10121" /></div>
                  <div class="form-group"><label class="form-label">Category <span style="color:red">*</span></label><select v-model="legalForm.category" class="form-input"><option value="">Select Category</option><option v-for="cat in legalCategories" :key="cat" :value="cat">{{ cat }}</option></select></div>
                  <div class="form-group" style="grid-column:1/-1;"><label class="form-label">Description <span style="color:red">*</span></label><textarea v-model="legalForm.description" class="form-input" rows="3" placeholder="Brief description of what this law covers..."></textarea></div>
                  <div class="form-group" style="grid-column:1/-1;"><label class="form-label">Official Statement <span style="color:red">*</span></label><textarea v-model="legalForm.official_statement" class="form-input" rows="5" placeholder="Paste the full official legal text or statement..."></textarea></div>
                  <div class="form-group">
                    <label class="form-label">Effective Date</label>
                    <div class="expiration-options" style="margin-bottom:10px;">
                      <label class="expiration-radio"><input type="radio" value="permanent" v-model="effectiveDateType" /> 🗓️ Permanent (no expiration)</label>
                      <label class="expiration-radio"><input type="radio" value="specific" v-model="effectiveDateType" /> 📅 Specific date</label>
                    </div>
                    <input v-if="effectiveDateType === 'specific'" v-model="legalForm.effective_date" type="date" class="form-input" placeholder="YYYY-MM-DD" />
                    <div v-else class="form-hint">This legal entry will be considered always effective.</div>
                  </div>
                  <div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:1.5rem;">
                    <input type="checkbox" v-model="legalForm.is_active" id="legal-active" />
                    <label for="legal-active" style="font-weight:600;">Active (visible to users)</label>
                  </div>
                </div>
              </div>
              <div class="modal-actions">
                <button class="btn btn-outline" @click="showLegalModal = false">Cancel</button>
                <button class="btn btn-primary" @click="saveLegal">{{ editingLegal ? 'Save Changes' : 'Create Entry' }}</button>
              </div>
            </div>
          </div>

          <!-- Legal Export Modal -->
          <div v-if="showExportModal" class="modal-overlay" @click.self="showExportModal = false">
            <div class="modal-content" style="max-width:500px;">
              <div class="modal-header">
                <h3>Export Legal Compliances</h3>
                <button class="modal-close" @click="showExportModal = false">×</button>
              </div>
              <div class="modal-body">
                <div class="form-group"><label class="form-label">Export Options</label><select v-model="exportType" class="form-input"><option value="all">All records</option><option value="category">Filter by Category</option><option value="date">Filter by Date Range (created at)</option></select></div>
                <div v-if="exportType === 'category'" class="form-group"><label class="form-label">Select Category</label><select v-model="exportCategory" class="form-input"><option value="">All Categories</option><option v-for="cat in legalCategories" :key="cat" :value="cat">{{ cat }}</option></select></div>
                <div v-if="exportType === 'date'" class="form-group"><label class="form-label">From Date</label><input type="date" v-model="exportDateFrom" class="form-input" /><label class="form-label" style="margin-top:12px;">To Date</label><input type="date" v-model="exportDateTo" class="form-input" /></div>
                <div class="export-preview" v-if="exportFilteredCompliances.length > 0" style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;"><strong>{{ exportFilteredCompliances.length }}</strong> entries will be exported.</div>
                <div v-else-if="exportType !== 'all'" class="export-preview" style="margin-top:16px;padding:12px;background:#fee2e2;border-radius:8px;color:#991b1b;">No entries match the selected filters.</div>
              </div>
              <div class="modal-actions">
                <button class="btn btn-outline" @click="showExportModal = false">Cancel</button>
                <button class="btn btn-primary" @click="exportLegalToCSV" :disabled="exportFilteredCompliances.length === 0">Export CSV</button>
              </div>
            </div>
          </div>

          <!-- ============================================================
          ML ANALYTICS
          ============================================================ -->
          <div v-else-if="active === 'ml-analytics'" class="ml-analytics-container">
            <div v-if="mlLoading" class="loading-spinner">Loading ML analytics data...</div>
            <div v-else>
              <h2 class="h2">🤖 Machine Learning Analytics</h2>
              <p class="p">AI-powered insights from incident predictions and model performance</p>

              <div class="stats-grid">
                <div class="stat-card"><div class="stat-title">Total Predictions (last 30d)</div><div class="stat-value">{{ mlAnalyticsData.summaryStats.total_predictions || 0 }}</div></div>
                <div class="stat-card"><div class="stat-title">Avg. Confidence</div><div class="stat-value">{{ (mlAnalyticsData.summaryStats.avg_confidence * 100).toFixed(1) }}%</div></div>
                <div class="stat-card"><div class="stat-title">Verified Samples</div><div class="stat-value">{{ mlAnalyticsData.trainingDataStatus.verified_samples || 0 }}</div></div>
                <div class="stat-card"><div class="stat-title">Used in Training</div><div class="stat-value">{{ mlAnalyticsData.trainingDataStatus.used_in_training || 0 }}</div></div>
              </div>

              <div class="analytics-card">
                <h3>📊 Prediction Statistics (All Incidents)</h3>
                <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:20px;">
                  <div class="stat-card"><div class="stat-title">Total Predictions</div><div class="stat-value">{{ predictionStats.total_predictions || 0 }}</div></div>
                  <div class="stat-card"><div class="stat-title">Avg. Confidence</div><div class="stat-value">{{ ((predictionStats.avg_confidence || 0) * 100).toFixed(1) }}%</div></div>
                </div>
                <div class="two-columns" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                  <div>
                    <h4>Predicted Incident Types</h4>
                    <div v-if="predictionStats.by_type && predictionStats.by_type.length" class="bar-chart">
                      <div v-for="item in predictionStats.by_type" :key="item.type" class="bar-item">
                        <span class="bar-label">{{ item.type }}</span>
                        <div class="bar-container"><div class="bar-fill" :style="{ width: (item.count / predictionStats.total_predictions * 100) + '%' }"></div></div>
                        <span class="bar-count">{{ item.count }}</span>
                      </div>
                    </div>
                    <div v-else class="no-data">No prediction data yet</div>
                  </div>
                  <div>
                    <h4>Predicted Severity Levels</h4>
                    <div v-if="predictionStats.by_severity && predictionStats.by_severity.length" class="bar-chart">
                      <div v-for="item in predictionStats.by_severity" :key="item.severity" class="bar-item">
                        <span class="bar-label">{{ item.severity }}</span>
                        <div class="bar-container"><div class="bar-fill" :style="{ width: (item.count / predictionStats.total_predictions * 100) + '%', backgroundColor: severityColors[item.severity] || '#6b7280' }"></div></div>
                        <span class="bar-count">{{ item.count }}</span>
                      </div>
                    </div>
                    <div v-else class="no-data">No severity data yet</div>
                  </div>
                </div>
              </div>

              <div class="analytics-card">
                <h3>Incident Type Distribution (Model)</h3>
                <div class="bar-chart">
                  <div v-for="(count, type) in mlAnalyticsData.summaryStats.by_type" :key="type" class="bar-item">
                    <span class="bar-label">{{ type }}</span>
                    <div class="bar-container"><div class="bar-fill" :style="{ width: (count / mlAnalyticsData.summaryStats.total_predictions * 100) + '%' }"></div></div>
                    <span class="bar-count">{{ count }}</span>
                  </div>
                  <div v-if="!mlAnalyticsData.summaryStats.by_type || Object.keys(mlAnalyticsData.summaryStats.by_type).length === 0"><p class="no-data">No predictions yet</p></div>
                </div>
              </div>

              <div class="analytics-card">
                <h3>Severity Distribution (Model)</h3>
                <div class="severity-chart">
                  <div v-for="(count, severity) in mlAnalyticsData.summaryStats.by_severity" :key="severity" class="severity-item">
                    <span class="severity-label">{{ severity }}</span>
                    <div class="progress-bar"><div class="progress-fill" :style="{ width: (count / mlAnalyticsData.summaryStats.total_predictions * 100) + '%', backgroundColor: severityColors[severity.toLowerCase()] }"></div></div>
                    <span class="severity-count">{{ count }}</span>
                  </div>
                </div>
              </div>

              <div class="analytics-card">
                <h3>Model Performance</h3>
                <div class="metrics-grid">
                  <template v-for="(metrics, modelName) in mlAnalyticsData.modelPerf" :key="modelName">
                    <div v-if="modelName !== '_meta'" class="metric-item">
                      <div class="metric-label">{{ modelName.replace('_', ' ') }}</div>
                      <div class="metric-value">{{ metrics.accuracy ? (metrics.accuracy * 100).toFixed(1) + '%' : '0%' }}</div>
                      <div class="metric-detail">Version: {{ metrics.version || 'N/A' }}</div>
                      <div class="metric-detail">Samples: {{ metrics.training_samples || 0 }}</div>
                    </div>
                  </template>
                  <div v-if="Object.keys(mlAnalyticsData.modelPerf).filter(k => k !== '_meta').length === 0"><p class="no-data">No model versions found. Run training first.</p></div>
                </div>
                <div class="meta-note"><small>Training buffer size: {{ mlAnalyticsData.modelPerf._meta?.buffer_size || 0 }}</small></div>
              </div>

              <div class="analytics-card">
                <h3>Dataset & Storage</h3>
                <div class="storage-info">
                  <div class="storage-item"><strong>Incident Images:</strong> {{ mlAnalyticsData.datasetStatus.incident_images?.file_count || 0 }} files, {{ mlAnalyticsData.datasetStatus.incident_images?.size_mb || 0 }} MB</div>
                  <div class="storage-item"><strong>Training Data:</strong> {{ mlAnalyticsData.datasetStatus.training_data?.file_count || 0 }} files, {{ mlAnalyticsData.datasetStatus.training_data?.size_mb || 0 }} MB</div>
                  <div class="storage-item"><strong>Uploads:</strong> {{ mlAnalyticsData.datasetStatus.uploads?.file_count || 0 }} files, {{ mlAnalyticsData.datasetStatus.uploads?.size_mb || 0 }} MB</div>
                  <div class="storage-item"><strong>Total:</strong> {{ mlAnalyticsData.datasetStatus.total_size_mb || 0 }} MB</div>
                  <div v-if="mlAnalyticsData.datasetStatus.storage_warning" class="warning-badge">⚠️ Storage approaching limit (8GB+)</div>
                </div>
              </div>
            </div>
          </div>

        </section>
      </div>
    </main>

    <!-- ===== FOOTER ===== -->
    <footer class="footer">
      <div class="footer-inner">
        <span>© {{ new Date().getFullYear() }} RESQAPP Admin • Calapan City Emergency Management System</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ============================================================
   BASE & RESET
   ============================================================ */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f4f7fb;
  font-family: Arial, Helvetica, sans-serif;
  color: #1f2a37;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  overflow-x: hidden;
  width: 100%;
  max-width: 100vw;
}

/* ============================================================
   TOPBAR
   ============================================================ */
.topbar {
  background: #0b4fa3;
  color: #fff;
  border-bottom: 4px solid #c62828;
  width: 100%;
}
.topbar-inner {
  max-width: 100%;
  margin: 0 auto;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  box-sizing: border-box;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.seal-wrap {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.28);
  display: grid;
  place-items: center;
}
.seal {
  width: 42px;
  height: 42px;
  object-fit: contain;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25));
}
.brand-title {
  font-weight: 900;
  font-size: 15px;
  line-height: 1.1;
}
.brand-subtitle {
  font-size: 12px;
  opacity: 0.92;
}
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.role {
  font-size: 12px;
  font-weight: 900;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.14);
}
.role-admin {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  border-color: rgba(255, 255, 255, 0.5);
}

/* ============================================================
   LAYOUT
   ============================================================ */
.main {
  flex: 1;
  padding: 18px 16px 28px;
  box-sizing: border-box;
  width: 100%;
  overflow-x: hidden;
}
.layout {
  max-width: 100%;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 14px;
  align-items: start;
  box-sizing: border-box;
  overflow-x: hidden;
}
.content {
  display: grid;
  gap: 14px;
  max-width: 100%;
  overflow-x: hidden;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
    max-width: 100%;
    overflow-x: hidden;
  }
  .layout {
    gap: 12px;
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
.nav {
  background: #fff;
  border: 1px solid #d7e2f1;
  border-radius: 12px;
  padding: 10px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
  position: sticky;
  top: 0px;
}
.navbtn {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 12px 12px;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 900;
  color: #1f2a37;
  min-height: 44px;
}
.navbtn:hover {
  background: #eef5ff;
}
.navbtn.on {
  background: #e9f1ff;
  color: #0b4fa3;
  border: 1px solid #cfe0ff;
}
@media (max-width: 900px) {
  .navbtn {
    white-space: nowrap;
    width: auto;
  }
}

/* ============================================================
   CARDS
   ============================================================ */
.card {
  background: #fff;
  border: 1px solid #d7e2f1;
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}
.h2 {
  margin: 0;
  color: #0b4fa3;
  font-size: 18px;
}
.p {
  margin: 8px 0 0;
  color: #6b7280;
  line-height: 1.55;
}

/* ============================================================
   STATS
   ============================================================ */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 20px 0;
}
.stat-card {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 10px;
  text-align: center;
  transition: transform 0.2s;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
}
.stat-title {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 8px;
}
.stat-value {
  font-size: 32px;
  font-weight: 800;
  color: #0b4fa3;
  margin-bottom: 4px;
}
.stat-trend {
  font-size: 12px;
  color: #9ca3af;
}

/* ============================================================
   TABLES
   ============================================================ */
.table {
  margin-top: 14px;
  border: 1px solid #d7e2f1;
  border-radius: 12px;
  overflow: hidden;
  max-width: 100%;
}
.row {
  display: grid;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border-top: 1px solid #e5edf8;
  font-size: 13px;
  align-items: center;
}
.row.head {
  background: #f6f9ff;
  font-weight: 900;
  color: #0b4fa3;
  border-top: none;
}
.incidents-row {
  grid-template-columns: 80px 1fr 120px 120px 120px 120px 150px 1fr;
}
.assignments-row {
  grid-template-columns: 80px 1fr 120px 120px 120px 150px 1fr;
}
@media (max-width: 768px) {
  .row {
    grid-template-columns: 60px 1fr 100px 100px 100px 100px 180px;
    font-size: 12px;
  }
}
@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
    grid-auto-rows: auto;
    gap: 8px;
  }
}

.pill {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  font-weight: 900;
  border: 1px solid #ffd0d0;
  background: #fff7f7;
  color: #7f1d1d;
}
.pill.ok {
  border-color: #b7f7c5;
  background: #f0fff4;
  color: #14532d;
}
.pill.warn {
  border-color: #ffe1a6;
  background: #fff8e7;
  color: #7a4b00;
}

/* ============================================================
   BUTTONS
   ============================================================ */
.btn {
  border: none;
  cursor: pointer;
  padding: 12px 16px;
  border-radius: 10px;
  font-weight: 900;
  min-height: 44px;
  box-sizing: border-box;
}
.btn-sm {
  padding: 10px 14px;
  min-height: 40px;
  border-radius: 9px;
}
.btn-xs {
  padding: 8px 10px;
  min-height: 36px;
  border-radius: 9px;
  font-weight: 900;
}
.btn-outline {
  background: transparent;
  color: #fff;
  border: 2px solid rgba(255, 255, 255, 0.85);
}
.btn-outline:hover {
  background: rgba(255, 255, 255, 0.12);
}
.btn-outline-blue {
  background: #fff;
  color: #0b4fa3;
  border: 2px solid #0b4fa3;
}
.btn-outline-blue:hover {
  background: #eef5ff;
}
.btn-primary {
  background: #c62828;
  color: #fff;
}
.btn-primary:hover {
  background: #a61f1f;
}
.btn-success {
  background: #10b981;
  color: white;
}
.btn-success:hover {
  background: #059669;
}
.btn-danger {
  background: #dc2626;
  color: white;
}
.btn-danger:hover {
  background: #b91c1c;
}
.btn-warning {
  background: #f59e0b;
  color: white;
}
.btn-small {
  padding: 6px 12px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.btn-small:hover {
  background: #e5e7eb;
}
button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

/* ============================================================
   ACTION BUTTONS
   ============================================================ */
.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.status-select,
.role-select,
.responder-select {
  padding: 6px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 12px;
  background: white;
  min-width: 100px;
}
.resolved-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: #d1fae5;
  color: #065f46;
}

/* ============================================================
   MAPS
   ============================================================ */
.map-container {
  margin: 20px 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}
.map {
  width: 100%;
  height: 400px;
}
.legend {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 15px;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.legend-color {
  width: 20px;
  height: 20px;
  border-radius: 4px;
}
.mapStatus {
  margin-top: 10px;
  font-size: 13px;
  color: #6b7280;
  text-align: center;
}

/* ============================================================
   ANALYTICS
   ============================================================ */
.analytics-dashboard {
  background: #fff;
  border: 1px solid #d7e2f1;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}
.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 20px 0;
}
.summary-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: transform 0.2s, box-shadow 0.2s;
}
.summary-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
}
.card-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}
.card-icon.total {
  background: #e9f1ff;
  color: #0b4fa3;
}
.card-icon.pending {
  background: #fff8e7;
  color: #f59e0b;
}
.card-icon.progress {
  background: #e6f7ff;
  color: #3b82f6;
}
.card-icon.resolved {
  background: #e6f7e6;
  color: #10b981;
}
.card-content {
  flex: 1;
}
.card-value {
  font-size: 28px;
  font-weight: 800;
  color: #1e293b;
  line-height: 1.2;
}
.card-label {
  font-size: 14px;
  color: #64748b;
  font-weight: 500;
}

.charts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 20px;
}
.chart-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}
.chart-card.full-width {
  grid-column: span 2;
}
.chart-card h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }
  .chart-card.full-width {
    grid-column: span 1;
  }
}

.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bar-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bar-label {
  width: 100px;
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}
.bar-container {
  flex: 1;
  height: 24px;
  background: #f1f5f9;
  border-radius: 12px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #0b4fa3, #3b82f6);
  border-radius: 12px;
  transition: width 0.3s ease;
}
.bar-count {
  width: 40px;
  font-size: 13px;
  font-weight: 600;
  color: #0b4fa3;
  text-align: right;
}

.pie-container {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.pie-chart {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: #e2e8f0;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
}
.pie-legend {
  flex: 1;
  min-width: 150px;
}

.activity-chart {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 200px;
  padding: 20px 0;
}
.activity-bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  height: 100%;
}
.activity-bar .bar {
  width: 30px;
  background: linear-gradient(to top, #0b4fa3, #3b82f6);
  border-radius: 6px 6px 0 0;
  transition: height 0.3s ease;
  min-height: 4px;
}
.bar-date {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  transform: rotate(-30deg);
  white-space: nowrap;
}

/* ============================================================
   CHATS
   ============================================================ */
.chats-container {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 20px;
  height: 500px;
}
.chat-list {
  border-right: 1px solid #e5e7eb;
  overflow-y: auto;
}
.chat-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid #f3f4f6;
  cursor: pointer;
}
.chat-item:hover {
  background: #f9fafb;
}
.chat-avatar {
  width: 40px;
  height: 40px;
  background: #0b4fa3;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-right: 12px;
}
.chat-info {
  flex: 1;
}
.chat-name {
  font-weight: 600;
}
.chat-preview {
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
.chat-time {
  font-size: 11px;
  color: #9ca3af;
}
.chat-window {
  display: flex;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}
.chat-messages {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}
.message {
  margin-bottom: 12px;
  max-width: 70%;
  clear: both;
}
.message.user {
  float: right;
  margin-left: auto;
}
.message.admin {
  float: left;
  margin-right: auto;
}
.message.user .message-content {
  background: #e5e7eb;
  color: #1f2937;
  border-radius: 12px 12px 0 12px;
}
.message.admin .message-content {
  background: #0b4fa3;
  color: white;
  border-radius: 12px 12px 12px 0;
}
.message-content {
  padding: 10px 14px;
  word-wrap: break-word;
}
.message-time {
  font-size: 10px;
  color: #9ca3af;
  margin-top: 4px;
  text-align: right;
}
.chat-messages::after {
  content: "";
  display: table;
  clear: both;
}
.chat-input {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid #e5e7eb;
}
.chat-input input {
  flex: 1;
  padding: 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}
@media (max-width: 1024px) {
  .chats-container {
    grid-template-columns: 1fr;
    height: auto;
  }
  .chat-list {
    height: 300px;
    border-right: none;
    border-bottom: 1px solid #e5e7eb;
  }
}

/* ============================================================
   BROADCAST
   ============================================================ */
.broadcast-container {
  background: #ffffff;
  border-radius: 24px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.05);
  padding: 24px;
}
.broadcast-header {
  margin-bottom: 28px;
  border-bottom: 2px solid #f1f5f9;
  padding-bottom: 16px;
}
.broadcast-title {
  font-size: 24px;
  font-weight: 700;
  color: #0b4fa3;
  margin: 0 0 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.broadcast-subtitle {
  font-size: 14px;
  color: #64748b;
  margin: 0;
}
.broadcast-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
@media (max-width: 900px) {
  .broadcast-layout {
    grid-template-columns: 1fr;
  }
}
.broadcast-form-card,
.broadcast-map-card {
  background: #f8fafc;
  border-radius: 20px;
  padding: 24px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}
.broadcast-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.broadcast-map {
  height: 300px;
  width: 100%;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  background: #f8fafc;
  z-index: 1;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-label {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  display: flex;
  align-items: center;
  gap: 4px;
}
.form-input {
  background: white;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 14px;
  transition: all 0.2s ease;
  width: 100%;
  box-sizing: border-box;
}
.form-input:focus {
  outline: none;
  border-color: #0b4fa3;
  box-shadow: 0 0 0 3px rgba(11, 79, 163, 0.1);
}
textarea.form-input {
  resize: vertical;
  min-height: 100px;
}
.required {
  color: #ef4444;
  font-size: 14px;
}
.form-hint {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
}

.severity-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.severity-pill {
  padding: 8px 16px;
  border-radius: 30px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  color: white;
  opacity: 0.7;
}
.severity-pill.low {
  background: #10b981;
}
.severity-pill.medium {
  background: #3b82f6;
}
.severity-pill.high {
  background: #f59e0b;
}
.severity-pill.critical {
  background: #dc2626;
}
.severity-pill.active {
  opacity: 1;
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.expiration-options {
  display: flex;
  gap: 20px;
  margin-top: 6px;
}
.expiration-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #334155;
}
.expiration-radio input {
  cursor: pointer;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.template-btn {
  background: white;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.template-btn:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.map-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.btn-draw {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 4px;
}
.btn-draw:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.btn-draw.active {
  background: #0b4fa3;
  color: white;
  border-color: #0b4fa3;
}
.btn-draw:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.geometry-preview {
  margin-top: 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 16px;
}
.geometry-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.geometry-badge {
  background: #e9f1ff;
  color: #0b4fa3;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
}
.btn-icon {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 18px;
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s;
}
.btn-icon:hover {
  background: #f1f5f9;
  color: #ef4444;
}

.image-upload-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.image-upload-btn {
  background: #f1f5f9;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
}
.image-upload-btn:hover {
  background: #e2e8f0;
}
.image-preview {
  position: relative;
  width: 200px;
  height: 120px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}
.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.image-preview .btn-icon-small {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
}

.btn-block {
  width: 100%;
  justify-content: center;
}
.btn-lg {
  padding: 15px 30px;
  font-size: 16px;
}

/* ============================================================
   USER MANAGEMENT
   ============================================================ */
.user-management-section {
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  width: 100%;
  max-width: 100%;
  padding: 1.5rem;
  overflow-x: hidden;
  box-sizing: border-box;
}
.section-header {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #f1f5f9;
  max-width: 100%;
}
.section-title {
  margin-bottom: 1rem;
  overflow-wrap: break-word;
}
.section-subtitle {
  color: #64748b;
  font-size: 0.95rem;
  margin-top: 0.5rem;
  overflow-wrap: break-word;
}

.user-stats-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
  max-width: 100%;
}
.user-stats-summary .stat-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  min-width: 0;
}

.action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
  max-width: 100%;
}
.action-group {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  min-width: 200px;
  max-width: 400px;
  flex: 1;
}
.search-icon {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
}
.search-input {
  width: 100%;
  padding: 0.875rem 1rem 0.875rem 3rem;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.95rem;
  transition: all 0.2s ease;
  background: white;
  box-sizing: border-box;
}
.search-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.clear-search {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 1.25rem;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.clear-search:hover {
  background: #f1f5f9;
  color: #64748b;
}

.advanced-filters {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  max-width: 100%;
  overflow: hidden;
}
.filter-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
  align-items: end;
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.filter-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  white-space: nowrap;
}
.filter-select {
  padding: 0.75rem 1rem;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  background: white;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
  box-sizing: border-box;
  width: 100%;
}
.filter-select:hover {
  border-color: #cbd5e1;
}
.filter-select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.date-range {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.date-input {
  flex: 1;
  min-width: 120px;
  padding: 0.75rem 1rem;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.95rem;
  box-sizing: border-box;
}
.date-input:focus {
  outline: none;
  border-color: #3b82f6;
}
.date-separator {
  color: #64748b;
  font-size: 0.875rem;
}

/* Users Table */
.table-container {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  max-width: 100%;
  margin-bottom: 1.5rem;
}
.table-responsive {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  max-width: 100%;
  min-height: 1px;
}
.users-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;
}
.users-table thead {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 2px solid #e2e8f0;
}
.users-table th {
  padding: 0.75rem 0.5rem;
  text-align: left;
  font-weight: 600;
  color: #475569;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
.users-table td {
  padding: 0.75rem 0.5rem;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
  font-size: 0.875rem;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  margin-top: 19px;
}
.user-avatar-sm {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0b4fa3, #3b82f6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 0.875rem;
  flex-shrink: 0;
}
.user-details {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.user-name {
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 0.125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
.user-email {
  font-size: 0.75rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.role-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  min-width: 70px;
  text-align: center;
  white-space: nowrap;
}
.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  min-width: 65px;
  text-align: center;
  white-space: nowrap;
}
.status-badge.active {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}
.status-badge.inactive {
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
}

.role-select-sm {
  padding: 0.375rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: white;
  font-size: 0.75rem;
  cursor: pointer;
  min-width: 100px;
  flex-shrink: 0;
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-wrap: wrap;
  gap: 1rem;
  max-width: 100%;
}
.pagination-info {
  color: #64748b;
  font-size: 0.75rem;
  white-space: nowrap;
}
.pagination-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
}
.page-btn {
  min-width: 32px;
  height: 32px;
  border: 1px solid #e2e8f0;
  background: white;
  border-radius: 6px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0 0.5rem;
  white-space: nowrap;
}
.page-btn.active {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}
.page-btn.dots {
  cursor: default;
  background: transparent;
  border: none;
}
.pagination-btn {
  padding: 0.375rem 0.75rem;
  border: 1px solid #e2e8f0;
  background: white;
  border-radius: 6px;
  font-size: 0.75rem;
  cursor: pointer;
  font-weight: 600;
  color: #475569;
}
.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .action-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .search-box {
    min-width: 100%;
    max-width: 100%;
  }
  .action-group {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }
  .action-group .btn {
    width: 100%;
    justify-content: center;
  }
  .filter-row {
    grid-template-columns: 1fr;
  }
  .user-stats-summary {
    grid-template-columns: repeat(2, 1fr);
  }
  .users-table {
    min-width: 600px;
  }
  .users-table th,
  .users-table td {
    padding: 0.5rem 0.25rem;
    font-size: 0.75rem;
  }
  .user-name {
    max-width: 140px;
  }
  .user-email {
    max-width: 140px;
  }
  .pagination {
    flex-direction: column;
    text-align: center;
    gap: 0.75rem;
  }
  .pagination-controls {
    justify-content: center;
  }
}
@media (max-width: 576px) {
  .user-management-section {
    padding: 0.75rem;
  }
  .user-stats-summary {
    grid-template-columns: 1fr;
  }
  .users-table {
    min-width: 500px;
  }
}
@media (max-width: 400px) {
  .user-management-section {
    padding: 0.5rem;
  }
  .users-table {
    min-width: 450px;
  }
  .user-name {
    max-width: 120px;
  }
  .user-email {
    max-width: 120px;
  }
}

/* ============================================================
   USER DETAILS MODAL
   ============================================================ */
.user-profile-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f3f4f6;
}
.user-avatar-large {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0b4fa3, #3b82f6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: bold;
  flex-shrink: 0;
}
.user-avatar-large img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}
.user-basic-info h4 {
  margin: 0 0 8px 0;
  font-size: 20px;
  color: #1f2937;
}
.user-role-badge {
  padding: 4px 12px;
  border-radius: 999px;
  color: white;
  font-size: 12px;
  font-weight: 600;
  display: inline-block;
}
.user-details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-item label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.detail-item span {
  font-size: 14px;
  color: #374151;
  word-break: break-word;
}
.emergency-section {
  background: #f8fafc;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}
.emergency-section h4 {
  margin: 0 0 12px 0;
  color: #0b4fa3;
  font-size: 16px;
}
.emergency-details {
  display: grid;
  gap: 12px;
}

.avatar-image,
.avatar-image-sm {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  background: #f3f4f6;
}
.avatar-image img,
.avatar-image-sm img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-initials,
.avatar-initials-sm {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(135deg, #0b4fa3, #3b82f6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}
.avatar-initials {
  font-size: 32px;
}
.avatar-initials-sm {
  font-size: 14px;
}

/* ============================================================
   MODALS
   ============================================================ */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}
.modal-content {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  animation: slideUp 0.3s ease;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #e5e7eb;
}
.modal-header h3 {
  margin: 0;
  color: #0b4fa3;
  font-size: 18px;
}
.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #6b7280;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.modal-close:hover {
  background: #f3f4f6;
  color: #374151;
}
.modal-body {
  padding: 20px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
  margin-top: 16px;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ============================================================
   CREATE USER MODAL
   ============================================================ */
.create-user-form .form-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid #e5e7eb;
}
.create-user-form .form-section:last-child {
  border-bottom: none;
}
.create-user-form .form-section h4 {
  margin: 0 0 16px 0;
  color: #374151;
  font-size: 18px;
  font-weight: 600;
}
.create-user-form .form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.create-user-form .form-group.full-width {
  grid-column: 1 / -1;
}
.create-user-form .form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}
.create-user-form .form-group label.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #374151;
}
.create-user-form .form-group label.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #3b82f6;
}
.create-user-form .input {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  font-size: 15px;
  transition: all 0.2s ease;
  background: white;
  color: #374151;
}
.create-user-form .input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.create-user-form .input.error {
  border-color: #ef4444;
  background-color: #fef2f2;
}
.create-user-form .input.error:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
}
@media (max-width: 768px) {
  .create-user-form .form-grid {
    grid-template-columns: 1fr;
  }
}

.validation-errors {
  margin-bottom: 24px;
}
.error-alert {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.error-icon {
  font-size: 20px;
  color: #ef4444;
  flex-shrink: 0;
  margin-top: 2px;
}
.error-content h4 {
  margin: 0 0 8px 0;
  color: #7f1d1d;
  font-size: 16px;
  font-weight: 600;
}
.error-content ul {
  margin: 0;
  padding-left: 20px;
  list-style-type: disc;
}
.error-content li {
  color: #7f1d1d;
  font-size: 14px;
  margin-bottom: 4px;
}
.error-content li strong {
  color: #991b1b;
}
.error-message {
  color: #ef4444;
  font-size: 12px;
  margin-top: 4px;
  font-weight: 500;
}

.preview-section {
  margin: 24px 0;
  padding: 20px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.preview-section h4 {
  margin: 0 0 16px 0;
  color: #374151;
  font-size: 16px;
  font-weight: 600;
}
.preview-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}
.preview-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f3f4f6;
}
.preview-avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0b4fa3, #3b82f6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  flex-shrink: 0;
}
.preview-info {
  flex: 1;
  min-width: 0;
}
.preview-name {
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-email {
  font-size: 14px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-role-badge {
  padding: 6px 12px;
  border-radius: 999px;
  color: white;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
.preview-details {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.preview-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
@media (max-width: 768px) {
  .preview-details {
    grid-template-columns: 1fr;
  }
}

/* ============================================================
   LEGAL COMPLIANCE
   ============================================================ */
.legal-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}
.legal-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  border-left: 4px solid #0b4fa3;
  transition: box-shadow 0.2s;
}
.legal-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.legal-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.legal-category-badge {
  background: #e9f1ff;
  color: #0b4fa3;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  margin-right: 8px;
}
.legal-law-num {
  background: #fff3e0;
  color: #e65100;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
}
.legal-title {
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 6px;
}
.legal-desc {
  font-size: 14px;
  color: #475569;
  margin-bottom: 10px;
}
.legal-statement-toggle {
  margin: 10px 0;
  cursor: pointer;
}
.legal-statement-toggle summary {
  font-size: 13px;
  font-weight: 600;
  color: #0b4fa3;
  padding: 6px 0;
  user-select: none;
}
.legal-statement-text {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  color: #374151;
  line-height: 1.7;
  margin-top: 8px;
  white-space: pre-wrap;
}
.legal-meta {
  font-size: 12px;
  color: #64748b;
  margin-top: 8px;
}
.legal-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* ============================================================
   ANNOUNCEMENTS
   ============================================================ */
.announcements-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 20px;
}
.announcement-item {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
}
.announcement-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}
.announcement-date {
  font-size: 12px;
  color: #64748b;
}
.announcement-message {
  font-size: 14px;
  margin: 8px 0;
}
.announcement-thumb {
  width: 100px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  margin: 8px 0;
}
.announcement-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.announcement-actions {
  display: flex;
  gap: 8px;
}
.announcement-map-preview {
  background: #f1f5f9;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #0b4fa3;
}
.announcement-map-preview:hover {
  background: #e2e8f0;
}
.empty-announcements {
  text-align: center;
  padding: 3rem 2rem;
  background: #f8fafc;
  border-radius: 1rem;
}
.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
  opacity: 0.6;
}
.empty-announcements h3 {
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
  color: #334155;
}
.empty-announcements p {
  color: #64748b;
  margin-bottom: 1rem;
}

/* ============================================================
   ML ANALYTICS
   ============================================================ */
.ml-analytics-container {
  background: #fff;
  border: 1px solid #d7e2f1;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.metric-item {
  background: #f8fafc;
  border-radius: 12px;
  padding: 16px;
  text-align: center;
}
.metric-label {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 8px;
}
.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: #0b4fa3;
}
.metric-detail {
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}
.severity-chart {
  margin-top: 16px;
}
.severity-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.severity-label {
  width: 80px;
  font-weight: 600;
  text-transform: capitalize;
}
.progress-bar {
  flex: 1;
  height: 24px;
  background: #f1f5f9;
  border-radius: 12px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 12px;
  transition: width 0.3s;
}
.severity-count {
  width: 40px;
  text-align: right;
  font-weight: 600;
}
.storage-info {
  background: #f8fafc;
  border-radius: 12px;
  padding: 16px;
  margin-top: 16px;
}
.storage-item {
  margin-bottom: 8px;
  font-size: 14px;
}
.warning-badge {
  margin-top: 12px;
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 8px;
  padding: 8px 12px;
  color: #856404;
  font-size: 13px;
  font-weight: 500;
}
.loading-spinner {
  text-align: center;
  padding: 40px;
  color: #0b4fa3;
  font-size: 16px;
}
.no-data {
  color: #6b7280;
  text-align: center;
  padding: 20px;
}
.meta-note {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
  text-align: center;
  font-size: 12px;
  color: #6b7280;
}

/* ============================================================
   QUICK ACTIONS / DASHBOARD
   ============================================================ */
.dashboard-home {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 24px;
  padding: 24px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
}
.dashboard-welcome {
  margin-bottom: 20px;
}
.dashboard-welcome .sub {
  color: #64748b;
  margin-top: 4px;
}
.quick-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}
.btn-action {
  display: flex;
  align-items: center;
  gap: 8px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 20px;
  font-weight: 600;
  color: #0b4fa3;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-action:hover {
  background: #f0f4ff;
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
}
.btn-action .btn-icon {
  font-size: 1.2rem;
}

.mini-chart-section {
  background: #f8fafc;
  border-radius: 16px;
  padding: 20px;
  border: 1px solid #e2e8f0;
}
.mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 120px;
  margin-top: 12px;
}
.mini-bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
}
.mini-bar-fill {
  width: 24px;
  background: linear-gradient(to top, #0b4fa3, #3b82f6);
  border-radius: 6px 6px 0 0;
  min-height: 4px;
  transition: height 0.3s;
}
.mini-bar-label {
  margin-top: 6px;
  font-size: 0.7rem;
  color: #64748b;
  font-weight: 500;
}

/* ============================================================
   RESPONDER TOGGLE
   ============================================================ */
.responder-toggle {
  margin: 16px 0;
}
.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 500;
  color: #1e293b;
}
.toggle-label input {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #f97316;
}
.online-indicator {
  color: #10b981;
  font-size: 1.2rem;
}
.offline-indicator {
  color: #6b7280;
  font-size: 1.2rem;
}

/* ============================================================
   VEHICLE TAGS
   ============================================================ */
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

/* ============================================================
   FOOTER
   ============================================================ */
.footer {
  background: #e9eef6;
  border-top: 1px solid #d7e2f1;
  width: 100%;
}
.footer-inner {
  max-width: 100%;
  margin: 0 auto;
  padding: 12px 16px;
  font-size: 12px;
  color: #4b5563;
  box-sizing: border-box;
}

/* Vehicle Analysis Section */
.vehicle-analysis-section {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 2px solid #e5e7eb;
}
.vehicle-analysis-section h4 {
  margin-bottom: 1rem;
  color: #0b4fa3;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.vehicle-stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem 2.5rem;
  margin-bottom: 1.25rem;
}
.vehicle-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #f8fafc;
  padding: 0.5rem 1.25rem;
  border-radius: 0.75rem;
  border: 1px solid #e2e8f0;
}
.vehicle-stat .stat-number {
  font-size: 1.75rem;
  font-weight: 700;
  color: #0b4fa3;
}
.vehicle-stat .stat-label {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.vehicle-breakdown-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}
.vehicle-breakdown-table th {
  background: #f1f5f9;
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-weight: 600;
  color: #334155;
}
.vehicle-breakdown-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e2e8f0;
}
.vehicle-type-badge {
  display: inline-block;
  background: #e9f1ff;
  color: #0b4fa3;
  padding: 0.15rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.8rem;
  font-weight: 600;
}
.source-tag {
  display: inline-block;
  margin-right: 0.25rem;
  font-size: 0.7rem;
  background: #f1f5f9;
  padding: 0.1rem 0.5rem;
  border-radius: 0.75rem;
  color: #475569;
}
.vehicle-source-details {
  margin-top: 0.75rem;
  background: #f8fafc;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid #e2e8f0;
}
.vehicle-source-details summary {
  font-weight: 600;
  cursor: pointer;
  color: #0b4fa3;
}
.source-block {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: white;
  border-radius: 0.25rem;
}
.source-block ul {
  margin: 0.25rem 0 0 1.25rem;
}
.no-data {
  color: #6b7280;
  font-style: italic;
  padding: 0.5rem 0;
}

/* Barangay trend chart */
.barangay-trend-chart {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  height: 200px;
  gap: 1rem;
  padding: 0.5rem 0;
  overflow-x: auto;
}

.trend-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 60px;
}

.trend-bar-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 180px;
}

.trend-bar {
  width: 14px;
  border-radius: 4px 4px 0 0;
  transition: height 0.3s ease;
  min-height: 4px;
}

.trend-bar.today {
  background: #3b82f6;
}
.trend-bar.week {
  background: #f59e0b;
}
.trend-bar.month {
  background: #10b981;
}

.trend-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #475569;
  margin-top: 4px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60px;
}

.trend-legend {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  margin-top: 1rem;
  font-size: 0.8rem;
  color: #475569;
}

.legend-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 4px;
  margin-right: 4px;
}
.legend-dot.today { background: #3b82f6; }
.legend-dot.week { background: #f59e0b; }
.legend-dot.month { background: #10b981; }

</style>
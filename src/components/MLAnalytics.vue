<template>
  <div class="ml-analytics">
    <!-- ML Status Cards -->
    <div class="status-grid">
      <div class="status-card">
        <div class="status-icon">📊</div>
        <div class="status-content">
          <div class="status-value">{{ mlStats.total_predictions }}</div>
          <div class="status-label">Total Predictions</div>
        </div>
      </div>
      <div class="status-card">
        <div class="status-icon">🎯</div>
        <div class="status-content">
          <div class="status-value">{{ mlStats.avg_confidence | percent }}</div>
          <div class="status-label">Avg Confidence</div>
        </div>
      </div>
      <div class="status-card">
        <div class="status-icon">📦</div>
        <div class="status-content">
          <div class="status-value">{{ datasetStatus.total_size_mb }} MB</div>
          <div class="status-label">Dataset Size</div>
        </div>
      </div>
      <div class="status-card">
        <div class="status-icon">⚡</div>
        <div class="status-content">
          <div class="status-value">{{ modelPerf.latest_accuracy | percent }}</div>
          <div class="status-label">Model Accuracy</div>
        </div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="charts-row">
      <!-- Incident Types Pie -->
      <div class="chart-card">
        <h3>Prediction Types</h3>
        <canvas ref="typeChart"></canvas>
      </div>

      <!-- Severity Bar -->
      <div class="chart-card">
        <h3>Severity Distribution</h3>
        <canvas ref="severityChart"></canvas>
      </div>
    </div>

    <!-- Model Performance -->
    <div class="model-section">
      <h3>Model Performance</h3>
      <div class="model-grid">
        <div class="metric">
          <span class="metric-label">Training Runs</span>
          <span class="metric-value">{{ modelPerf.training_runs }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Buffer Size</span>
          <span class="metric-value">{{ modelPerf.buffer_size }}</span>
        </div>
        <button @click="retrainModel" class="retrain-btn" :disabled="datasetStatus.storage_warning">
          🚀 Retrain Models
        </button>
      </div>
    </div>

    <!-- Dataset Status -->
    <div class="dataset-section" v-if="datasetStatus.storage_warning" class="warning">
      <div class="warning-icon">⚠️</div>
      <p>Storage near limit ({{ datasetStatus.total_size_mb }}MB). Clear old data before retraining.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { Chart } from 'vue-chartjs'
import { Bar, Pie } from 'vue-chartjs'
import {
  Title,
  Tooltip,
  Legend,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale
} from 'chart.js'

const props = defineProps({
  userId: { type: Number, required: true }
})

const emit = defineEmits(['retrain-started'])

const mlStats = ref({})
const modelPerf = ref({})
const datasetStatus = ref({})

// Charts refs
const typeChart = ref(null)
const severityChart = ref(null)

const api = inject('api') // or import from client.js

onMounted(async () => {
  await loadMLData()
})

const loadMLData = async () => {
  try {
    mlStats.value = await api.get('/api/reports/my-ml-stats?days=30')
    modelPerf.value = await api.get('/api/ml/performance')
    datasetStatus.value = await api.get('/api/datasets/status')
    
    nextTick(() => {
      renderCharts()
    })
  } catch (error) {
    console.error('Failed to load ML data:', error)
  }
}

const renderCharts = () => {
  if (!typeChart.value || !mlStats.value.by_type) return
  
  // Type pie chart
  new Chart(typeChart.value, {
    type: 'pie',
    data: {
      labels: Object.keys(mlStats.value.by_type),
      datasets: [{
        data: Object.values(mlStats.value.by_type),
        backgroundColor: [
          '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
          '#8b5cf6', '#ec4899', '#14b8a6'
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } }
    }
  })
  
  // Severity bar chart
  if (severityChart.value && mlStats.value.by_severity) {
    new Chart(severityChart.value, {
      type: 'bar',
      data: {
        labels: Object.keys(mlStats.value.by_severity),
        datasets: [{
          label: 'Incidents',
          data: Object.values(mlStats.value.by_severity),
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444']
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    })
  }
}

const retrainModel = async () => {
  if (datasetStatus.value.storage_warning) {
    alert('Storage limit reached. Clear datasets first.')
    return
  }
  
  emit('retrain-started')
  await api.post('/api/ml/train')
  loadMLData()
}
</script>

<style scoped>
.ml-analytics {
  padding: 1.5rem;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.status-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.status-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

.status-value {
  font-size: 2rem;
  font-weight: 800;
  color: var(--text-primary);
}

.status-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.chart-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
}

.chart-card h3 {
  margin-bottom: 1rem;
  font-size: 1.125rem;
  color: var(--text-primary);
}

.chart-card canvas {
  max-height: 300px;
}

.model-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  align-items: end;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.metric-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.metric-value {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--text-primary);
}

.retrain-btn {
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 12px;
  font-weight: 700;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.3s ease;
}

.retrain-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
}

.retrain-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dataset-section.warning {
  background: #fef3cd;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}

.warning-icon {
  font-size: 1.25rem;
}

:deep(.status-badge) {
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

@media (max-width: 768px) {
  .charts-row {
    grid-template-columns: 1fr;
  }
  
  .model-grid {
    grid-template-columns: 1fr;
  }
}
</style>


<template>
  <div class="sos-container">
    <div class="header">
      <h1>Emergency SOS</h1>
      <p class="subtitle">Press the button and speak – we'll send your location and a 10‑second voice message to responders.</p>
    </div>

    <div class="main-content">
      <!-- Status messages -->
      <transition name="fade">
        <div v-if="error" class="message error-message">
          <span class="icon">⚠️</span> {{ error }}
        </div>
        <div v-else-if="success" class="message success-message">
          <span class="icon">✅</span> Emergency alert sent successfully!
        </div>
      </transition>

      <!-- Recording indicator & timer -->
      <div v-if="recording" class="recording-indicator">
        <div class="voice-visualizer">
          <span v-for="i in 5" :key="i" class="bar" :style="{ animationDelay: i * 0.1 + 's' }"></span>
        </div>
        <div class="timer">{{ formattedTimer }}s</div>
        <p class="recording-hint">Recording... speak clearly</p>
      </div>

      <!-- Main action button -->
      <button
        @click="triggerEmergency"
        :disabled="loading || recording"
        class="sos-button"
        :class="{ 'pulse': !recording && !loading && !success, 'recording': recording }"
      >
        <span v-if="recording">🔴 Recording...</span>
        <span v-else-if="loading">⏳ Sending...</span>
        <span v-else-if="success">✅ Sent</span>
        <span v-else>SOS</span>

    
      </button>

      <!-- Additional info when idle -->
      <div v-if="!recording && !loading && !success" class="info-box">
        <p><span class="icon">📍</span> Your location will be sent automatically.</p>
        <p><span class="icon">🎤</span> You'll have 10 seconds to describe the emergency.</p>
      </div>
    </div>
  </div>
</template>

<script>

import api from "@/api/client"

export default {
  data() {
    return {
      loading: false,
      error: null,
      success: false,
      recording: false,
      timer: 10,
      timerInterval: null,
      mediaRecorder: null,
      audioChunks: [],
      stream: null,
    };
  },
  computed: {
    formattedTimer() {
      return this.timer.toString().padStart(2, '0');
    }
  },
  beforeUnmount() {
    this.cleanup();
  },
  methods: {
    async triggerEmergency() {
      // Reset state
      this.loading = true;
      this.error = null;
      this.success = false;
      this.recording = false;
      this.cleanup(); // stop any previous recording

      try {
        // 1. Get current location
        const position = await this.getCurrentPosition();
        const { latitude, longitude } = position.coords;

        // 2. Request microphone access
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // 3. Set up recorder
        this.mediaRecorder = new MediaRecorder(this.stream);
        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
          this.audioChunks.push(event.data);
        };

        this.mediaRecorder.onstop = async () => {
          // Upload after recording finishes
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          await this.uploadEmergency(audioBlob, latitude, longitude);
          // Release microphone tracks
          if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
          }
        };

        // 4. Start recording and timer
        this.mediaRecorder.start();
        this.recording = true;
        this.timer = 10;
        this.loading = false; // loading done, now recording

        this.timerInterval = setInterval(() => {
          if (this.timer > 0) {
            this.timer -= 1;
          }
          if (this.timer === 0) {
            this.stopRecording();
          }
        }, 1000);
      } catch (err) {
        this.error = this.getErrorMessage(err);
        this.loading = false;
        this.cleanup();
      }
    },

    stopRecording() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
      this.recording = false;
      this.loading = true; // now uploading
    },

    async uploadEmergency(audioBlob, lat, lng) {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'emergency.webm');
  formData.append('lat', lat);
  formData.append('lng', lng);

  try {
    // Axios automatically parses JSON responses
    const response = await api.post('/api/emergency/anonymous', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    // ✅ The parsed JSON is available in response.data
    const data = response.data;
    this.success = true;
    this.loading = false;
    console.log('Emergency saved:', data);
  } catch (err) {
    // Axios errors are wrapped; the actual response is in err.response
    const errorMessage = err.response?.data?.detail || err.message || 'Upload failed';
    this.error = errorMessage;
    this.loading = false;
  }
},

    getCurrentPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation is not supported by your browser.'));
        } else {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        }
      });
    },

    getErrorMessage(err) {
      if (err.code === 1) return 'Location permission denied. Please enable location services.';
      if (err.code === 2) return 'Location unavailable. Please try again.';
      if (err.code === 3) return 'Location request timed out.';
      if (err.name === 'NotAllowedError' || err.message.includes('permission')) {
        return 'Microphone access denied. Please allow microphone to record.';
      }
      return err.message || 'An unexpected error occurred.';
    },

    cleanup() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      this.recording = false;
    },
  },
};
</script>

<style scoped>
/* Base styles */
.sos-container {
  width: 100%;
  min-height: 100vh;
  padding: clamp(1rem, 5vw, 3rem);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.header {
  text-align: center;
  margin-bottom: clamp(2rem, 8vh, 4rem);
  width: 100%;
  max-width: 600px;
}

.header h1 {
  font-size: clamp(2rem, 8vw, 3.5rem);
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 0.5rem;
  line-height: 1.2;
}

.subtitle {
  color: #666;
  font-size: clamp(1rem, 4vw, 1.2rem);
  line-height: 1.5;
  padding: 0 1rem;
}

.main-content {
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(1.5rem, 5vh, 3rem);
}

/* Message styles */
.message {
  width: 100%;
  padding: clamp(0.75rem, 2vw, 1.25rem) clamp(1rem, 3vw, 2rem);
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 500;
  font-size: clamp(0.9rem, 3.5vw, 1rem);
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  box-sizing: border-box;
}

.error-message {
  background-color: #fee2e2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}

.success-message {
  background-color: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.icon {
  font-size: clamp(1.2rem, 5vw, 1.5rem);
  flex-shrink: 0;
}

/* Recording indicator */
.recording-indicator {
  text-align: center;
  width: 100%;
  margin: 0.5rem 0;
}

.voice-visualizer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: max(4px, 1vw);
  height: clamp(40px, 15vw, 80px);
  margin-bottom: 0.5rem;
}

.bar {
  width: max(6px, 1.5vw);
  height: 30%;
  background: linear-gradient(to top, #3b82f6, #60a5fa);
  border-radius: 4px;
  animation: voice-pulse 1.2s ease-in-out infinite;
  transform-origin: bottom;
  flex-shrink: 0;
}

@keyframes voice-pulse {
  0%, 100% { height: 30%; }
  50% { height: 90%; }
}

.timer {
  font-size: clamp(2.5rem, 15vw, 5rem);
  font-weight: 700;
  color: #3b82f6;
  line-height: 1;
  margin: 0.25rem 0;
}

.recording-hint {
  color: #4b5563;
  font-size: clamp(0.8rem, 3.5vw, 1rem);
}

/* SOS button */
.sos-button {
  background-color: #dc2626;
  color: white;
  font-size: clamp(1.8rem, 8vw, 3.5rem);
  font-weight: 700;
  padding: clamp(1rem, 4vw, 2rem) clamp(2rem, 8vw, 4rem);
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  box-shadow: 0 10px 25px rgba(220, 38, 38, 0.3);
  transition: all 0.2s ease;
  width: 100%;
  max-width: 500px;
  text-transform: uppercase;
  letter-spacing: 2px;
  border: 2px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sos-button:hover:not(:disabled) {
  background-color: #b91c1c;
  transform: scale(1.02);
  box-shadow: 0 15px 30px rgba(220, 38, 38, 0.4);
}

.sos-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.sos-button.pulse {
  animation: pulse 2s infinite;
}

.sos-button.recording {
  background-color: #1e3a8a;
  box-shadow: 0 0 0 4px rgba(30, 58, 138, 0.3);
  animation: none;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.7); }
  70% { box-shadow: 0 0 0 15px rgba(220, 38, 38, 0); }
  100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
}

/* Info box */
.info-box {
  background-color: #f3f4f6;
  border-radius: 16px;
  padding: clamp(1rem, 4vw, 2rem);
  width: 100%;
  max-width: 500px;
  margin-top: 0.5rem;
  box-sizing: border-box;
}

.info-box p {
  margin: 0.75rem 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #374151;
  font-size: clamp(0.9rem, 3.5vw, 1rem);
  word-break: break-word;
}

.info-box .icon {
  font-size: clamp(1.2rem, 5vw, 1.5rem);
  flex-shrink: 0;
}

/* Transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* Extra small devices (phones under 400px) */
@media (max-width: 400px) {
  .sos-button {
    font-size: 1.5rem;
    padding: 1rem 1.5rem;
    letter-spacing: 1px;
  }
  .timer {
    font-size: 2.2rem;
  }
  .header h1 {
    font-size: 1.8rem;
  }
}

/* Landscape orientation on phones */
@media (max-height: 500px) and (orientation: landscape) {
  .sos-container {
    min-height: auto;
    padding: 1rem;
  }
  .header {
    margin-bottom: 1rem;
  }
  .header h1 {
    font-size: 1.8rem;
  }
  .main-content {
    gap: 0.75rem;
  }
  .voice-visualizer {
    height: 30px;
  }
  .timer {
    font-size: 2rem;
  }
  .info-box {
    padding: 0.75rem;
  }
}
</style>
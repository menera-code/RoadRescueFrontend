import { ref, onMounted, onBeforeUnmount } from 'vue'

export function useAutoRefresh({
  refreshFn,         // async function that fetches data and updates refs
  interval = 5000,  // milliseconds
  enabled = true,    // reactive boolean (e.g., active tab check)
  preserveScroll = true,
  scrollContainerSelector = '.table-container, .reports-table-container, .users-table-container',
  preserveMap = true,
  mapRef = null,     // pass map instance ref
}) {
  let timer = null
  let isRefreshing = ref(false)

  const saveScrollPosition = () => {
    if (!preserveScroll) return 0
    const container = document.querySelector(scrollContainerSelector)
    return container?.scrollTop || 0
  }

  const restoreScrollPosition = (scrollTop) => {
    if (!preserveScroll) return
    const container = document.querySelector(scrollContainerSelector)
    if (container) container.scrollTop = scrollTop
  }

  const saveMapView = () => {
    if (!preserveMap || !mapRef?.value) return null
    return {
      center: mapRef.value.getCenter(),
      zoom: mapRef.value.getZoom()
    }
  }

  const restoreMapView = (view) => {
    if (!preserveMap || !mapRef?.value || !view) return
    mapRef.value.setView(view.center, view.zoom)
  }

  const refresh = async () => {
    if (!enabled) return
    if (isRefreshing.value) return
    isRefreshing.value = true

    const scrollTop = saveScrollPosition()
    const mapView = saveMapView()

    try {
      await refreshFn()
    } catch (err) {
      console.warn('Auto-refresh failed:', err)
    } finally {
      restoreScrollPosition(scrollTop)
      restoreMapView(mapView)
      isRefreshing.value = false
    }
  }

  const start = () => {
    if (timer) clearInterval(timer)
    if (!enabled) return
    timer = setInterval(refresh, interval)
  }

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  onMounted(() => start())
  onBeforeUnmount(() => stop())

  // Re-start if enabled changes
  // (you can watch enabled and call start/stop)

  return { isRefreshing, refresh }
}
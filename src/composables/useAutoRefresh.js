import {
  ref,
  isRef,
  onMounted,
  onBeforeUnmount,
  watch,
} from "vue"

export function useAutoRefresh({
  refreshFn,
  interval = 15000,
  enabled = true,

  preserveScroll = true,

  scrollContainerSelector =
    ".table-container, .reports-table-container, .users-table-container",

  preserveMap = true,
  mapRef = null,

  immediate = false,
}) {
  const isRefreshing = ref(false)

  let timer = null

  let mounted = false

  /*
   * ----------------------------------------------------------
   * Get current enabled state
   * ----------------------------------------------------------
   *
   * Supports both:
   *
   * enabled: true
   *
   * and:
   *
   * enabled: computed(() => ...)
   */
  const getEnabled = () => {
    return isRef(enabled) ? enabled.value : enabled
  }

  /*
   * ----------------------------------------------------------
   * Scroll position
   * ----------------------------------------------------------
   */

  const saveScrollPosition = () => {
    if (!preserveScroll) {
      return 0
    }

    const container = document.querySelector(
      scrollContainerSelector
    )

    return container?.scrollTop || 0
  }

  const restoreScrollPosition = (scrollTop) => {
    if (!preserveScroll) {
      return
    }

    const container = document.querySelector(
      scrollContainerSelector
    )

    if (container) {
      container.scrollTop = scrollTop
    }
  }

  /*
   * ----------------------------------------------------------
   * Leaflet map position
   * ----------------------------------------------------------
   */

  const saveMapView = () => {
    if (!preserveMap || !mapRef?.value) {
      return null
    }

    try {
      return {
        center: mapRef.value.getCenter(),
        zoom: mapRef.value.getZoom(),
      }
    } catch (error) {
      console.warn("Could not save map view:", error)
      return null
    }
  }

  const restoreMapView = (view) => {
    if (!preserveMap || !mapRef?.value || !view) {
      return
    }

    try {
      mapRef.value.setView(view.center, view.zoom, {
        animate: false,
      })
    } catch (error) {
      console.warn("Could not restore map view:", error)
    }
  }

  /*
   * ----------------------------------------------------------
   * Refresh
   * ----------------------------------------------------------
   */

  const refresh = async () => {
    if (!getEnabled()) {
      return
    }

    // Prevent duplicate/overlapping refresh requests.
    if (isRefreshing.value) {
      return
    }

    if (typeof refreshFn !== "function") {
      console.warn(
        "useAutoRefresh: refreshFn must be a function."
      )

      return
    }

    isRefreshing.value = true

    const scrollTop = saveScrollPosition()
    const mapView = saveMapView()

    try {
      await refreshFn()
    } catch (error) {
      console.warn(
        "Auto-refresh request failed:",
        error
      )
    } finally {
      restoreScrollPosition(scrollTop)
      restoreMapView(mapView)

      isRefreshing.value = false
    }
  }

  /*
   * ----------------------------------------------------------
   * Start timer
   * ----------------------------------------------------------
   */

  const start = () => {
    stop()

    if (!mounted) {
      return
    }

    if (!getEnabled()) {
      return
    }

    /*
     * 15 seconds is intentionally used instead of 5 seconds.
     *
     * Emergency actions should still trigger their own
     * immediate refresh when needed.
     */
    timer = window.setInterval(() => {
      refresh()
    }, interval)
  }

  /*
   * ----------------------------------------------------------
   * Stop timer
   * ----------------------------------------------------------
   */

  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  /*
   * ----------------------------------------------------------
   * Lifecycle
   * ----------------------------------------------------------
   */

  onMounted(() => {
    mounted = true

    if (immediate) {
      refresh()
    }

    start()
  })

  onBeforeUnmount(() => {
    mounted = false
    stop()
  })

  /*
   * ----------------------------------------------------------
   * Watch reactive enabled state
   * ----------------------------------------------------------
   *
   * This fixes the problem in the original implementation.
   */

  if (isRef(enabled)) {
    watch(
      enabled,
      (newValue) => {
        if (newValue) {
          start()
        } else {
          stop()
        }
      },
      {
        flush: "post",
      }
    )
  }

  return {
    isRefreshing,
    refresh,
    start,
    stop,
  }
}
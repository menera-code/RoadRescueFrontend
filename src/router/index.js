import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/stores/auth"

// Public pages
import LandingView from "@/views/LandingView.vue"
import LoginView from "@/views/LoginView.vue"
import RegisterView from "@/views/RegisterView.vue"
import HomeView from "@/views/HomeView.vue"
import EmergencySOSView from "@/views/EmergencySOS.vue"

// Dashboard pages are lazy-loaded.
// This prevents all dashboard code from loading when the user
// first opens the website.
const UserDashboardView = () =>
  import("@/views/dashboards/UserDashboardView.vue")

const ResponderDashboardView = () =>
  import("@/views/dashboards/ResponderDashboardView.vue")

const AdminDashboardView = () =>
  import("@/views/dashboards/AdminDashboardView.vue")

const routes = [
  {
    path: "/",
    name: "landing",
    component: LandingView,
  },

  {
    path: "/login",
    name: "login",
    component: LoginView,
  },

  {
    path: "/register",
    name: "register",
    component: RegisterView,
  },

  {
    path: "/sos",
    name: "sos",
    component: EmergencySOSView,
  },

  {
    path: "/home",
    name: "home",
    component: HomeView,
    meta: {
      requiresAuth: true,
    },
  },

  {
    path: "/dashboard/user",
    name: "dashboard-user",
    component: UserDashboardView,
    meta: {
      requiresAuth: true,
      role: "user",
    },
  },

  {
    path: "/dashboard/responder",
    name: "dashboard-responder",
    component: ResponderDashboardView,
    meta: {
      requiresAuth: true,
      role: "responder",
    },
  },

  {
    path: "/dashboard/admin",
    name: "dashboard-admin",
    component: AdminDashboardView,
    meta: {
      requiresAuth: true,
      role: "admin",
    },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Navigation guard
router.beforeEach((to) => {
  const auth = useAuthStore()

  // Protect private routes
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return {
      path: "/login",
      query: {
        redirect: to.fullPath,
      },
    }
  }

  return true
})

export default router
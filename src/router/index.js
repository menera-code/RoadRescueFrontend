import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/stores/auth"

import LandingView from "@/views/LandingView.vue"
import LoginView from "@/views/LoginView.vue"
import RegisterView from "@/views/RegisterView.vue"
import HomeView from "@/views/HomeView.vue"
import EmergencySOSView from "@/views/EmergencySOS.vue"; // NEW: SOS button view

import UserDashboardView from "@/views/dashboards/UserDashboardView.vue"
import ResponderDashboardView from "@/views/dashboards/ResponderDashboardView.vue"
import AdminDashboardView from "@/views/dashboards/AdminDashboardView.vue"
import { jwtDecode } from "jwt-decode"


const routes = [
  { path: "/", component: LandingView },
  { path: "/login", component: LoginView },
  { path: "/register", component: RegisterView },
  { path: "/sos", component: EmergencySOSView }, // No auth required
 
  {
    path: "/home",
    component: HomeView,
    meta: { requiresAuth: true }
  },// inside routes: []
{
  path: "/dashboard/user",
  name: "dashboard-user",
  component: UserDashboardView,
},
{
  path: "/dashboard/responder",
  name: "dashboard-responder",
  component: ResponderDashboardView,
},
{
  path: "/dashboard/admin",
  name: "dashboard-admin",
  component: AdminDashboardView,
},
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  // If logged in, prevent going back to public pages
  if (
    auth.isAuthenticated &&
    (to.path === "/" || to.path === "/login" || to.path === "/register")
  ) {
    
  }

  // Protect private pages
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return "/login"
  }

  return true
})




export default router

import { defineStore } from "pinia"
import api from "@/api/client"

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null,
    token: localStorage.getItem("access_token")
  }),

  getters: {
    isAuthenticated: state => !!state.token
  },

  actions: {
    async login(email, password) {
      const res = await api.post("/auth/login", { email, password })
      this.token = res.data.access_token
      localStorage.setItem("access_token", this.token)
      await this.fetchUser()
    },

    async fetchUser() {
      const res = await api.get("/me")
      this.user = res.data
    },

    logout() {
      this.user = null
      this.token = null
      localStorage.removeItem("access_token")
    }
  }
})

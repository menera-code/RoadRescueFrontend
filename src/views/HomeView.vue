<script setup>
import { useAuthStore } from "@/stores/auth"
import { useRouter } from "vue-router"

const auth = useAuthStore()
const router = useRouter()

const logout = () => {
  auth.logout()
  router.push("/login")
}
</script>

<template>
  <div>
    <h1>Road Rescue</h1>

    <p><strong>Name:</strong> {{ auth.user?.full_name }}</p>
    <p><strong>Email:</strong> {{ auth.user?.email }}</p>
    <p><strong>Role:</strong> {{ auth.user?.role }}</p>

    <button @click="logout">Logout</button>
  </div>
</template>

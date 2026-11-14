import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    open: true, // Abre el navegador automáticamente
    // Solo en desarrollo: /api se reenvía al backend local, así el navegador habla con un único
    // origen (5173). Usar con VITE_API_BASE_URL=http://localhost:5173/api. No afecta el build de Render.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})

import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
	root: path.resolve(__dirname, "src"),
	publicDir: false,
	build: {
		outDir: path.resolve(__dirname, "dist", "public"),
		emptyOutDir: true,
		rollupOptions: {
			input: {
				index: path.resolve(__dirname, "src", "index.html"),
				dashboard: path.resolve(__dirname, "src", "dashboard.html"),
				login: path.resolve(__dirname, "src", "login.html"),
				signup: path.resolve(__dirname, "src", "signup.html"),
			},
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:3000",
		},
	},
});

import { initThemeToggle } from "./theme.js";

export function getRole() {
	return localStorage.getItem("role");
}

export function isAuthenticated() {
	return !!getRole();
}

export function logout() {
	document.cookie = "userId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
	document.cookie = "userRole=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
	localStorage.removeItem("role");
	window.location.href = "/";
}

export function showToast(message, type = "info") {
	const toast = document.createElement("div");
	toast.className = `toast ${type}`;
	toast.textContent = message;
	document.body.appendChild(toast);
	setTimeout(() => toast.remove(), 3000);
}

export function showLoading(container, count = 3) {
	let skeletons = "";
	for (let i = 0; i < count; i++) {
		skeletons += `<div class="skeleton-card"><div class="skeleton-title"></div><div class="skeleton-line"></div><div class="skeleton-line" style="width: 60%"></div></div>`;
	}
	container.innerHTML = skeletons;
}

export function escapeHtml(str) {
	if (!str) return "";
	return str.replace(/[&<>]/g, function (m) {
		if (m === "&") return "&amp;";
		if (m === "<") return "&lt;";
		if (m === ">") return "&gt;";
		return m;
	});
}

document.addEventListener("DOMContentLoaded", initThemeToggle);

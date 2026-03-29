export function initThemeToggle() {
	const themeToggle = document.getElementById("themeToggle");
	if (!themeToggle) return;

	const savedTheme = localStorage.getItem("theme");
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const isDark = savedTheme ? savedTheme === "dark" : prefersDark;

	if (isDark) {
		document.documentElement.classList.add("dark");
		themeToggle.textContent = "☀️";
	} else {
		themeToggle.textContent = "🌙";
	}

	themeToggle.addEventListener("click", () => {
		document.documentElement.classList.toggle("dark");
		const nowDark = document.documentElement.classList.contains("dark");
		localStorage.setItem("theme", nowDark ? "dark" : "light");
		themeToggle.textContent = nowDark ? "☀️" : "🌙";
	});
}

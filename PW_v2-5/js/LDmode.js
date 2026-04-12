// 🌙 Theme toggle with localStorage
const toggleButton = document.getElementById("toggle-theme");
const prefersDark = localStorage.getItem("theme") === "dark";

// Apply saved theme on page load
if (prefersDark) {
    document.body.classList.add("dark-mode");
    toggleButton.textContent = "Switch to Light Mode";
} else {
    toggleButton.textContent = "Switch to Dark Mode";
}

toggleButton.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    toggleButton.textContent = isDark
    ? "Switch to Light Mode"
    : "Switch to Dark Mode";
});
(() => {
  const storageKey = "dth_theme";

  function getSavedTheme() {
    try {
      return localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
    } catch (error) {
      console.warn("Could not read the saved theme preference:", error);
      return "light";
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    const button = document.getElementById("btnThemeToggle");
    if (!button) return;

    const isDark = theme === "dark";
    button.innerHTML = isDark
      ? '<i class="fa-solid fa-sun" style="color: #fbbf24;"></i>'
      : '<i class="fa-solid fa-moon"></i>';
    button.setAttribute("aria-label", isDark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối");
    button.setAttribute("aria-pressed", String(isDark));
    button.title = isDark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối";
  }

  const initialTheme = getSavedTheme();
  document.documentElement.setAttribute("data-theme", initialTheme);

  function initThemeToggle() {
    const button = document.getElementById("btnThemeToggle");
    if (!button) return;

    applyTheme(initialTheme);
    button.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);

      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch (error) {
        console.error("Could not save the theme preference:", error);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemeToggle, { once: true });
  } else {
    initThemeToggle();
  }
})();

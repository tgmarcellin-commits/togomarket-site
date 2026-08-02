import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── localStorage buyer-identity reset ────────────────────────────────────────
// Increment LS_VERSION to wipe all saved buyer names/phones and chat sessions
// for all users on next page load. Safe to bump whenever a clean slate is needed.
const LS_VERSION = "2";
const LS_VERSION_KEY = "tm_ls_v";
if (localStorage.getItem(LS_VERSION_KEY) !== LS_VERSION) {
  // Remove buyer identity
  localStorage.removeItem("tm_buyer");
  // Remove all per-listing chat sessions (keys starting with tm_chat_)
  Object.keys(localStorage)
    .filter((k) => k.startsWith("tm_chat_"))
    .forEach((k) => localStorage.removeItem(k));
  localStorage.setItem(LS_VERSION_KEY, LS_VERSION);
}
// ─────────────────────────────────────────────────────────────────────────────

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);

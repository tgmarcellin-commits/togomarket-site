import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "fr" | "en";
export type Theme = "light" | "dark";

interface SiteSettings {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  toggleTheme: () => void;
}

const SiteSettingsContext = createContext<SiteSettings>({
  lang: "fr",
  theme: "light",
  setLang: () => {},
  toggleTheme: () => {},
});

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    return (localStorage.getItem("tg_lang") as Lang) ?? "fr";
  });
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("tg_theme") as Theme) ?? "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("tg_lang", l);
  };

  const toggleTheme = () => {
    setThemeState((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("tg_theme", next);
      return next;
    });
  };

  return (
    <SiteSettingsContext.Provider value={{ lang, theme, setLang, toggleTheme }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}

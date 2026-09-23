import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "fr" | "en";

interface SiteSettings {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const SiteSettingsContext = createContext<SiteSettings>({
  lang: "fr",
  setLang: () => {},
});

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    return (localStorage.getItem("tg_lang") as Lang) ?? "fr";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("tg_lang", l);
  };

  return (
    <SiteSettingsContext.Provider value={{ lang, setLang }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}

import { useRef } from "react";
import { Store, Megaphone, ShoppingBag, Calendar, PackageSearch } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

export type NavTab = "boutique" | "publicite" | "marketplace" | "evenementiel" | "introuvable";

type SecretTab = "publicite" | "evenementiel";

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onSecretTap?: (tab: SecretTab) => void;
}

const SECRET_TABS: SecretTab[] = ["publicite", "evenementiel"];
const SECRET_CLICKS = 5;
const SECRET_RESET_MS = 2000;

export function BottomNav({ activeTab, onTabChange, onSecretTap }: BottomNavProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);

  const clickCounts = useRef<Partial<Record<SecretTab, number>>>({});
  const clickTimers = useRef<Partial<Record<SecretTab, ReturnType<typeof setTimeout>>>>({});

  const tabs: { id: NavTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "boutique", label: t.navBoutique, Icon: Store },
    { id: "publicite", label: t.navAds, Icon: Megaphone },
    { id: "marketplace", label: t.navMarket, Icon: ShoppingBag },
    { id: "evenementiel", label: t.navEvents, Icon: Calendar },
    { id: "introuvable", label: t.navLost, Icon: PackageSearch },
  ];

  const handleTabClick = (id: NavTab) => {
    onTabChange(id);

    if (SECRET_TABS.includes(id as SecretTab)) {
      const sId = id as SecretTab;
      const existing = clickTimers.current[sId];
      if (existing) clearTimeout(existing);

      const newCount = (clickCounts.current[sId] ?? 0) + 1;
      clickCounts.current[sId] = newCount;

      if (newCount >= SECRET_CLICKS) {
        clickCounts.current[sId] = 0;
        onSecretTap?.(sId);
      } else {
        clickTimers.current[sId] = setTimeout(() => {
          clickCounts.current[sId] = 0;
        }, SECRET_RESET_MS);
      }
    }
  };

  return (
    <div className="fixed bottom-0 left-0 w-full bg-background/95 backdrop-blur-md border-t z-50 safe-area-bottom">
      <div className="flex items-stretch justify-around max-w-2xl mx-auto">
        {tabs.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors min-h-[56px] ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
              <span className={`text-[9px] font-semibold leading-tight text-center max-w-[58px] ${isActive ? "text-primary" : ""}`}>
                {label}
              </span>
              {isActive && (
                <div className="absolute bottom-0 h-0.5 w-10 bg-primary rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

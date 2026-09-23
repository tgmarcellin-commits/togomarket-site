import { Store, ShoppingBag, Calendar, PackageSearch, Briefcase, MessageCircle } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

export type NavTab = "stand" | "marketplace" | "evenementiel" | "introuvable" | "services" | "messages";

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  messagesUnread?: number;
}

export function BottomNav({ activeTab, onTabChange, messagesUnread = 0 }: BottomNavProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);

  const tabs: {
    id: NavTab;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    { id: "stand", label: t.navMarket, Icon: Store },
    { id: "services", label: t.navServices, Icon: Briefcase },
    { id: "marketplace", label: "Market Place", Icon: ShoppingBag },
    { id: "messages", label: t.navMessages, Icon: MessageCircle, badge: messagesUnread },
    { id: "evenementiel", label: t.navEvents, Icon: Calendar },
  ];

  return (
    <div className="fixed bottom-0 left-0 w-full bg-background/95 backdrop-blur-md border-t z-50 safe-area-bottom">
      <div className="flex items-stretch justify-around max-w-2xl mx-auto">
        {tabs.map(({ id, label, Icon, badge }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors min-h-[56px] relative ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                {badge != null && badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </div>
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

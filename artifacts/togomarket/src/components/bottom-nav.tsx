import { Store, Megaphone, ShoppingBag, Calendar, PackageSearch } from "lucide-react";

export type NavTab = "boutique" | "publicite" | "marketplace" | "evenementiel" | "introuvable";

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

const tabs: { id: NavTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "boutique", label: "Boutique", Icon: Store },
  { id: "publicite", label: "Publicité", Icon: Megaphone },
  { id: "marketplace", label: "Market Place", Icon: ShoppingBag },
  { id: "evenementiel", label: "Événementiel", Icon: Calendar },
  { id: "introuvable", label: "Introuvable", Icon: PackageSearch },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <div className="fixed bottom-0 left-0 w-full bg-background/95 backdrop-blur-md border-t z-50 safe-area-bottom">
      <div className="flex items-stretch justify-around max-w-2xl mx-auto">
        {tabs.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
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

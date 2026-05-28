import { useEffect, useState } from "react";
import { useGetActiveAds } from "@workspace/api-client-react";
import { Megaphone } from "lucide-react";

export function AdBanner() {
  const { data: ads } = useGetActiveAds();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!ads || ads.length <= 1) return;
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % ads.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [ads]);

  if (!ads || ads.length === 0) return null;

  const ad = ads[current];

  return (
    <div className="w-full bg-amber-50 border-b border-amber-200">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 bg-amber-400 rounded-full p-1.5">
            <Megaphone className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 flex-shrink-0">
            Pub
          </span>
          <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
            {ad.image && (
              <img
                src={ad.image}
                alt={ad.advertiserName}
                className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-amber-200"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground truncate">{ad.advertiserName}</p>
              <p className="text-xs text-muted-foreground truncate">{ad.message}</p>
            </div>
          </div>
          {ads.length > 1 && (
            <div className="flex gap-1 flex-shrink-0">
              {ads.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === current ? "bg-amber-500" : "bg-amber-200"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

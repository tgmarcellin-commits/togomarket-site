import { useEffect, useState } from "react";
import { Star, Trash2, Pencil, Loader2 } from "lucide-react";
import { loadBuyerIdentity, saveBuyerIdentity } from "@/components/buyer-identity-prompt";

/* ── Stockage local des jetons d'édition (auteur uniquement) ── */
const TOKENS_KEY = "tm_review_tokens";
function loadTokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || "{}"); } catch { return {}; }
}
function saveToken(reviewId: number, token: string) {
  try {
    const map = loadTokens();
    map[String(reviewId)] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(map));
  } catch {}
}
function removeToken(reviewId: number) {
  try {
    const map = loadTokens();
    delete map[String(reviewId)];
    localStorage.setItem(TOKENS_KEY, JSON.stringify(map));
  } catch {}
}

interface Review {
  id: number;
  listingId: number;
  buyerName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

function Stars({ value, onChange, size = "w-4 h-4" }: { value: number; onChange?: (v: number) => void; size?: string }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(i)}
          className={onChange ? "cursor-pointer" : "cursor-default"}
        >
          <Star className={`${size} ${i <= value ? "fill-yellow-400 text-yellow-400" : "text-white/30"}`} />
        </button>
      ))}
    </div>
  );
}

interface ListingReviewsProps {
  listingId: number;
  isAdmin?: boolean;
  adminPassword?: string;
  onStatsChange?: (avg: number | null, count: number) => void;
}

/** Section « Avis et Commentaires » affichée sous la description dans la vue plein écran. */
export function ListingReviews({ listingId, isAdmin, adminPassword, onStatsChange }: ListingReviewsProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokens, setTokens] = useState<Record<string, string>>(loadTokens());

  // Formulaire (création ou édition)
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState(loadBuyerIdentity()?.name ?? "");
  const [phone, setPhone] = useState(loadBuyerIdentity()?.phone ?? "");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const res = await fetch(`/api/listings/${listingId}/reviews`);
      if (res.ok) {
        const data = await res.json() as { items: Review[]; avgRating: number | null; count: number };
        setReviews(data.items);
        onStatsChange?.(data.avgRating, data.count);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setEditingId(null);
    setFormOpen(false);
    setRating(0);
    setComment("");
    setError("");
  };

  const startEdit = (r: Review) => {
    setEditingId(r.id);
    setFormOpen(true);
    setRating(r.rating);
    setComment(r.comment);
    setError("");
  };

  const handleSubmit = async () => {
    setError("");
    if (rating < 1) { setError("Choisissez une note (1 à 5 étoiles)."); return; }
    if (!editingId && (name.trim().length < 2 || phone.trim().length < 8)) {
      setError("Indiquez votre nom et votre numéro.");
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        const res = await fetch("/api/reviews/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, editToken: tokens[String(editingId)] ?? "", rating, comment: comment.trim() }),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch(`/api/listings/${listingId}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buyerName: name.trim(), buyerPhone: phone.trim(), rating, comment: comment.trim() }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json() as { review: Review; editToken: string };
        saveToken(data.review.id, data.editToken);
        setTokens(loadTokens());
        saveBuyerIdentity({ name: name.trim(), phone: phone.trim() });
      }
      resetForm();
      await refresh();
    } catch {
      setError("Échec de l'envoi. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (r: Review) => {
    const mine = Boolean(tokens[String(r.id)]);
    let body: Record<string, unknown>;
    if (mine) {
      if (!confirm("Supprimer votre avis ?")) return;
      body = { id: r.id, editToken: tokens[String(r.id)] };
    } else if (isAdmin) {
      let pwd = adminPassword;
      if (!pwd) {
        const entered = window.prompt("Code administrateur :");
        if (!entered) return;
        pwd = entered;
      }
      if (!confirm(`Supprimer l'avis de ${r.buyerName} ?`)) return;
      body = { id: r.id, password: pwd };
    } else return;

    const res = await fetch("/api/reviews/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      removeToken(r.id);
      setTokens(loadTokens());
      await refresh();
    } else {
      alert("Suppression impossible.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-white font-semibold text-sm">Avis et Commentaires ({reviews.length})</h4>
        {!formOpen && (
          <button
            onClick={() => { setFormOpen(true); setEditingId(null); setRating(0); setComment(""); }}
            className="text-xs bg-white/15 hover:bg-white/25 text-white rounded-full px-3 py-1 transition-colors"
          >
            ✍️ Donner mon avis
          </button>
        )}
      </div>

      {formOpen && (
        <div className="bg-white/10 rounded-lg p-3 space-y-2">
          {!editingId && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Votre nom"
                className="bg-white/10 text-white placeholder:text-white/40 text-xs rounded-md px-2 py-1.5 outline-none focus:bg-white/20"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Votre numéro"
                inputMode="tel"
                className="bg-white/10 text-white placeholder:text-white/40 text-xs rounded-md px-2 py-1.5 outline-none focus:bg-white/20"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-white/70 text-xs">Note :</span>
            <Stars value={rating} onChange={setRating} size="w-5 h-5" />
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Votre commentaire (facultatif)"
            rows={2}
            maxLength={1000}
            className="w-full bg-white/10 text-white placeholder:text-white/40 text-xs rounded-md px-2 py-1.5 outline-none focus:bg-white/20 resize-none"
          />
          {error && <p className="text-red-300 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="text-xs bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-semibold disabled:opacity-50"
            >
              {submitting ? "Envoi…" : editingId ? "Enregistrer" : "Publier mon avis"}
            </button>
            <button onClick={resetForm} className="text-xs text-white/60 hover:text-white px-2">Annuler</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-white/50" /></div>
      ) : reviews.length === 0 ? (
        <p className="text-white/50 text-xs">Aucun avis pour le moment. Soyez le premier à donner votre avis !</p>
      ) : (
        <div className="space-y-2">
          {reviews.map((r) => {
            const mine = Boolean(tokens[String(r.id)]);
            return (
              <div key={r.id} className="bg-white/5 rounded-lg p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-white text-xs font-semibold truncate">{r.buyerName}</span>
                    <Stars value={r.rating} size="w-3 h-3" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-white/40 text-[10px]">
                      {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                    </span>
                    {mine && (
                      <button onClick={() => startEdit(r)} className="text-white/50 hover:text-white p-0.5" title="Modifier">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {(mine || isAdmin) && (
                      <button onClick={() => handleDelete(r)} className="text-red-300 hover:text-red-400 p-0.5" title="Supprimer">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                {r.comment && <p className="text-white/80 text-xs mt-1 whitespace-pre-wrap break-words">{r.comment}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

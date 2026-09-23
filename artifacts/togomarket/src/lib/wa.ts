/**
 * Prépare un numéro pour un lien wa.me / l'API WhatsApp.
 * WhatsApp identifie les numéros béninois avec l'ancien format international
 * (229 + 8 chiffres), sans le préfixe national "01".
 *  - 22901XXXXXXXX → 229XXXXXXXX
 *  - 2291XXXXXXXX (numéro mal enregistré, 0 perdu) → 229XXXXXXXX
 * Les autres numéros (Togo, etc.) sont renvoyés en chiffres purs.
 */
export function waPhone(raw: string): string {
  const s = (raw ?? "").replace(/\D/g, "");
  if (/^22901\d{8}$/.test(s)) return "229" + s.slice(5);
  if (/^2291\d{8}$/.test(s)) return "229" + s.slice(4);
  return s;
}

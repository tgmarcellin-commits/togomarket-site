import { createDriverNotification } from "./driver-notifications";
import { sendDriverPush } from "./driver-push";
import { sendVendorPush } from "./vendor-push";

function fcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

/**
 * Notifications envoyées APRÈS la validation du règlement (jamais dans la transaction) :
 * le livreur et le vendeur sont prévenus que leur paiement est crédité sur leur portefeuille.
 * Ne lève jamais d'erreur.
 */
export async function notifyDeliverySettled(params: {
  orderId: number;
  driverId: number;
  vendorId: number;
  driverPayout: number;
  sellerPayout: number;
}): Promise<void> {
  const { orderId, driverId, vendorId, driverPayout, sellerPayout } = params;
  try {
    await Promise.allSettled([
      (async () => {
        const title = `Paiement reçu : ${fcfa(driverPayout)}`;
        const body = `La livraison de la commande #${orderId} est confirmée. ${fcfa(driverPayout)} ont été crédités sur votre portefeuille.`;
        await createDriverNotification({ driverId, orderId, kind: "delivery_settled", title, body });
        await sendDriverPush(driverId, { title, body, url: "/driver-connexion", tag: `delivery-settled-${orderId}` });
      })(),
      sendVendorPush(vendorId, {
        title: `Paiement reçu : ${fcfa(sellerPayout)}`,
        body: `La commande #${orderId} est livrée. ${fcfa(sellerPayout)} ont été crédités sur votre portefeuille.`,
        tag: `delivery-settled-${orderId}`,
      }),
    ]);
  } catch {
    // une notification ratée ne remet jamais en cause un règlement déjà validé
  }
}

/** Retour confirmé : le livreur touche son aller-retour, le vendeur récupère son article. */
export async function notifyReturnSettled(params: {
  orderId: number;
  driverId: number;
  vendorId: number;
  driverPayout: number;
}): Promise<void> {
  const { orderId, driverId, vendorId, driverPayout } = params;
  try {
    await Promise.allSettled([
      (async () => {
        const title = `Retour confirmé : ${fcfa(driverPayout)}`;
        const body = `Le retour de la commande #${orderId} est confirmé. ${fcfa(driverPayout)} ont été crédités sur votre portefeuille.`;
        await createDriverNotification({ driverId, orderId, kind: "return_settled", title, body });
        await sendDriverPush(driverId, { title, body, url: "/driver-connexion", tag: `return-settled-${orderId}` });
      })(),
      sendVendorPush(vendorId, {
        title: "Retour confirmé",
        body: `Le retour de la commande #${orderId} est confirmé : l'article vous a été restitué.`,
        tag: `return-settled-${orderId}`,
      }),
    ]);
  } catch {
    // idem
  }
}

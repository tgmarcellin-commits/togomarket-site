import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Paiements FedaPay déjà appliqués (renouvellements de publicités, événements et services).
 * Un même paiement peut être confirmé plusieurs fois (retour du navigateur + webhook + vérification) :
 * cette table garantit que les 30 jours ne sont ajoutés qu'UNE seule fois par transaction.
 * La table est créée automatiquement (create table if not exists) : aucune migration manuelle.
 */
let tableReady: Promise<void> | null = null;

export function ensureAppliedTable(): Promise<void> {
  if (!tableReady) {
    tableReady = db
      .execute(sql`
        create table if not exists fedapay_applied_transactions (
          transaction_id text primary key,
          entity_type text not null,
          entity_id integer not null,
          applied_at timestamptz not null default now()
        )`)
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

/**
 * Réserve la transaction. Retourne true la PREMIÈRE fois (il faut alors ajouter les 30 jours),
 * false si ce paiement a déjà été appliqué. À appeler dans la même transaction SQL que la mise à jour.
 */
export async function claimTransaction(
  executor: Pick<typeof db, "execute">,
  transactionId: string,
  entityType: string,
  entityId: number,
): Promise<boolean> {
  const result = await executor.execute(sql`
    insert into fedapay_applied_transactions (transaction_id, entity_type, entity_id)
    values (${transactionId}, ${entityType}, ${entityId})
    on conflict (transaction_id) do nothing
    returning transaction_id`);
  return result.rows.length > 0;
}

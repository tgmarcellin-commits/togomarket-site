import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCourseTotal,
  computeSellerCommission,
  computeSellerPayout,
} from "./platform-fees";

test("le total de la course = article + livreur + 250 FCFA acheteur", () => {
  const result = computeCourseTotal({ articlePriceLocked: 10_000, transportFeeLocked: 1_500 });
  assert.equal(result.total, 11_750);
  assert.equal(result.buyerCommission, 250);
});

test("les montants vides ou invalides ne produisent jamais de nombre négatif ou décimal", () => {
  assert.equal(computeCourseTotal({ articlePriceLocked: null, transportFeeLocked: undefined }).total, 250);
  assert.equal(computeCourseTotal({ articlePriceLocked: 1000.4, transportFeeLocked: -50 }).total, 1250);
});

test("le vendeur supporte 250 FCFA de commission, plafonnés au prix de l'article", () => {
  assert.equal(computeSellerCommission(10_000), 250);
  assert.equal(computeSellerPayout(10_000), 9_750);
  assert.equal(computeSellerCommission(100), 100);
  assert.equal(computeSellerPayout(100), 0);
});

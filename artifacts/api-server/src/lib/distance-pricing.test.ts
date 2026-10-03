import test from "node:test";
import assert from "node:assert/strict";
import { computeReturnPricing, computeTransportFee, toIntegerKm } from "./distance-pricing";

test("tranche 0 à 5,99 km : 500 FCFA", () => {
  assert.equal(computeTransportFee(0.4), 500);
  assert.equal(computeTransportFee(1), 500);
  assert.equal(computeTransportFee(5), 500);
  assert.equal(computeTransportFee(5.99), 500);
});

test("tranche 6 à 10,99 km : 1 000 FCFA", () => {
  assert.equal(computeTransportFee(6), 1000);
  assert.equal(computeTransportFee(8.5), 1000);
  assert.equal(computeTransportFee(10.99), 1000);
});

test("tranche 11 à 20,99 km : 1 500 FCFA", () => {
  assert.equal(computeTransportFee(11), 1500);
  assert.equal(computeTransportFee(15), 1500);
  assert.equal(computeTransportFee(20.99), 1500);
});

test("au-delà de 20,99 km : 1 500 FCFA + 50 FCFA par km entier à partir de 21 km", () => {
  assert.equal(computeTransportFee(21), 1550);
  assert.equal(computeTransportFee(21.99), 1550);
  assert.equal(computeTransportFee(22), 1600);
  assert.equal(computeTransportFee(25), 1750);
  assert.equal(computeTransportFee(30), 2000);
});

test("une distance invalide ne produit jamais de frais négatif ou non numérique", () => {
  assert.equal(computeTransportFee(Number.NaN), 500);
  assert.equal(computeTransportFee(-3), 500);
});

test("la distance verrouillée est tronquée à l'entier, avec 1 km au minimum", () => {
  assert.equal(toIntegerKm(5.99), 5);
  assert.equal(toIntegerKm(6.01), 6);
  assert.equal(toIntegerKm(0.3), 1);
});

test("computeReturnPricing : retour = moitié de l'aller, aller-retour = 1,5 x l'aller", () => {
  const outboundDistanceKm = 12;
  const outboundTransportFee = computeTransportFee(outboundDistanceKm); // tranche 11 à 20,99 km

  const pricing = computeReturnPricing(outboundTransportFee, outboundDistanceKm);

  assert.equal(pricing.returnDistanceKm, 12);
  assert.equal(pricing.returnFee, 750);
  assert.equal(pricing.roundTripFee, 2250);
});

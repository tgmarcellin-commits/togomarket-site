import test from "node:test";
import assert from "node:assert/strict";
import { computeReturnPricing, FCFA_PER_KM } from "./distance-pricing";

test("distance pricing enforces 50 FCFA/km policy", () => {
  assert.equal(FCFA_PER_KM, 50);
});

test("computeReturnPricing returns exact economic rules: return distance = outbound, return fee = outbound, round-trip = 2x", () => {
  const outboundDistanceKm = 12;
  const outboundTransportFee = outboundDistanceKm * FCFA_PER_KM; // 600

  const pricing = computeReturnPricing(outboundTransportFee, outboundDistanceKm);

  assert.equal(pricing.returnDistanceKm, 12);
  assert.equal(pricing.returnFee, 600);
  assert.equal(pricing.roundTripFee, 1200); // 2 * outboundFee
});

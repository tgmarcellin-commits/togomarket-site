import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderCreationInput,
  getBusyDriverIds,
  mergeDriverRatings,
  getPriceConfirmationState,
  hasAcceptedAssignmentConflict,
} from "./delivery-autonomous-flow";

test("price confirmation state reports mismatch when amounts differ", () => {
  assert.deepEqual(
    getPriceConfirmationState([
      { actorType: "buyer", amountFcfa: 10_000 },
      { actorType: "vendor", amountFcfa: 9_500 },
    ]),
    {
      buyerAmount: 10_000,
      vendorAmount: 9_500,
      status: "mismatch",
    },
  );
});

test("price confirmation state reports matched when both sides submit same amount", () => {
  assert.deepEqual(
    getPriceConfirmationState([
      { actorType: "buyer", amountFcfa: 10_000 },
      { actorType: "vendor", amountFcfa: 10_000 },
    ]),
    {
      buyerAmount: 10_000,
      vendorAmount: 10_000,
      status: "matched",
    },
  );
});

test("price confirmation state stays pending when only one side confirmed", () => {
  assert.deepEqual(
    getPriceConfirmationState([
      { actorType: "buyer", amountFcfa: 10_000 },
    ]),
    {
      buyerAmount: 10_000,
      vendorAmount: null,
      status: "pending",
    },
  );
});

test("busy driver filtering excludes accepted and unexpired pending jobs", () => {
  const now = new Date("2026-09-25T08:00:00.000Z");
  const busy = getBusyDriverIds([
    {
      id: 1,
      assignments: [{ acceptanceStatus: "accepted_by_driver", assignmentExpiresAt: null }],
    },
    {
      id: 2,
      assignments: [{ acceptanceStatus: "pending_driver_response", assignmentExpiresAt: new Date("2026-09-25T08:10:00.000Z") }],
    },
    {
      id: 3,
      assignments: [{ acceptanceStatus: "pending_driver_response", assignmentExpiresAt: new Date("2026-09-25T07:59:00.000Z") }],
    },
  ], now);
  assert.equal(busy.has(1), true);
  assert.equal(busy.has(2), true);
  assert.equal(busy.has(3), false);
});

test("assignment conflict detection rejects concurrent second acceptance", () => {
  assert.equal(
    hasAcceptedAssignmentConflict(15, [
      { id: 14, acceptanceStatus: "accepted_by_driver" },
      { id: 15, acceptanceStatus: "pending_driver_response" },
    ]),
    true,
  );
});

test("buyer confirmation then matching vendor confirmation unlocks order creation with a non-null amount", () => {
  // Buyer confirms first: state stays "pending" and no order should be created yet.
  const afterBuyer = getPriceConfirmationState([
    { actorType: "buyer", amountFcfa: 500 },
  ]);
  assert.equal(afterBuyer.status, "pending");

  // Vendor confirms the same amount: state becomes "matched" with a non-null buyerAmount,
  // which is exactly the condition the price-confirmation route uses to auto-create the order.
  const afterVendor = getPriceConfirmationState([
    { actorType: "buyer", amountFcfa: 500 },
    { actorType: "vendor", amountFcfa: 500 },
  ]);
  assert.equal(afterVendor.status, "matched");
  assert.notEqual(afterVendor.buyerAmount, null);

  const orderInput = buildOrderCreationInput({
    buyerName: "Afi Buyer",
    buyerPhone: "90000000",
    listingTitle: "Sac à main",
    vendorLastName: "Kodjo",
    lockedBuyerAmount: afterVendor.buyerAmount!,
  });
  assert.deepEqual(orderInput, {
    firstName: "Afi Buyer",
    lastName: "Kodjo",
    phone: "90000000",
    description: "Sac à main",
    articlePriceLocked: 500,
  });
});

test("buildOrderCreationInput falls back to 'Vendeur' when vendor lastName is empty, blank or missing", () => {
  const base = {
    buyerName: "Afi Buyer",
    buyerPhone: "90000000",
    listingTitle: "Sac à main",
    lockedBuyerAmount: 500,
  };
  assert.equal(buildOrderCreationInput({ ...base, vendorLastName: "" }).lastName, "Vendeur");
  assert.equal(buildOrderCreationInput({ ...base, vendorLastName: "   " }).lastName, "Vendeur");
  assert.equal(buildOrderCreationInput({ ...base, vendorLastName: null }).lastName, "Vendeur");
  assert.equal(buildOrderCreationInput({ ...base, vendorLastName: undefined }).lastName, "Vendeur");
  assert.equal(buildOrderCreationInput({ ...base, vendorLastName: "Kodjo" }).lastName, "Kodjo");
});

test("buildOrderCreationInput falls back to a default description when listingTitle is empty or missing", () => {
  const base = {
    buyerName: "Afi Buyer",
    buyerPhone: "90000000",
    vendorLastName: "Kodjo",
    lockedBuyerAmount: 500,
  };
  assert.equal(
    buildOrderCreationInput({ ...base, listingTitle: null }).description,
    "Commande créée depuis Messages",
  );
  assert.equal(
    buildOrderCreationInput({ ...base, listingTitle: "" }).description,
    "Commande créée depuis Messages",
  );
  assert.equal(
    buildOrderCreationInput({ ...base, listingTitle: "Sac à main" }).description,
    "Sac à main",
  );
});

test("driver rating merge defaults unrated drivers to zero", () => {
  const merged = mergeDriverRatings(
    [
      { id: 1, firstName: "Afi" },
      { id: 2, firstName: "Kossi" },
    ],
    [
      { driverId: 2, averageRating: 4.5, ratingCount: 8 },
    ],
  );
  assert.deepEqual(merged, [
    { id: 1, firstName: "Afi", ratingAverage: 0, ratingCount: 0 },
    { id: 2, firstName: "Kossi", ratingAverage: 4.5, ratingCount: 8 },
  ]);
});

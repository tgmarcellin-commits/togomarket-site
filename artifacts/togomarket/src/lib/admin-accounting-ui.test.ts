import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFcfa,
  getJournalStatusStyle,
  isJournalBalanced,
  buildClientCsvFromJournals,
  sanitizeDriverForRole,
  computeGpsFreshness,
  computeQrHealth,
} from "./admin-accounting-ui";
import type { FormattedJournal } from "@/pages/admin-accounting-api";

test("formatFcfa formats FCFA currency consistently", () => {
  assert.equal(formatFcfa(15000), "15 000 FCFA");
  assert.equal(formatFcfa(0), "0 FCFA");
});

test("getJournalStatusStyle returns distinct labels and colors for balanced and reversed", () => {
  const balanced = getJournalStatusStyle("balanced");
  assert.equal(balanced.label, "Équilibré");
  assert.equal(balanced.dotClass.includes("bg-emerald"), true);

  const reversed = getJournalStatusStyle("reversed");
  assert.equal(reversed.label, "Contre-passé");
  assert.equal(reversed.dotClass.includes("bg-purple"), true);

  const reversal = getJournalStatusStyle("reversal");
  assert.equal(reversal.label, "Écriture d'annulation");

  const unbal = getJournalStatusStyle("pending_correction");
  assert.equal(unbal.label.includes("Déséquilibré"), true);
});

test("isJournalBalanced verifies debit equals credit", () => {
  assert.equal(isJournalBalanced({ totalDebit: 5000, totalCredit: 5000 }), true);
  assert.equal(isJournalBalanced({ totalDebit: 5000, totalCredit: 4999 }), false);
});

test("buildClientCsvFromJournals generates structured CSV with headers and legs", () => {
  const sampleJournals: FormattedJournal[] = [
    {
      journalReference: "JRNL_TEST_1",
      createdAt: "2026-10-01T04:00:00.000Z",
      description: "Paiement livraison",
      entriesCount: 1,
      totalDebit: 1500,
      totalCredit: 1500,
      isBalanced: true,
      isReversal: false,
      reversedFrom: null,
      reversedBy: null,
      reversalReason: null,
      status: "balanced",
      orderId: 77,
      driverId: 3,
      walletId: null,
      settlementRef: null,
      legs: [
        {
          id: 1,
          debitAccount: { id: 1, code: "2010", name: "Séquestre", accountType: "liability" },
          creditAccount: { id: 2, code: "2030", name: "Livreurs à payer", accountType: "liability" },
          amount: 1500,
          description: "Commission course",
        },
      ],
    },
  ];

  const csv = buildClientCsvFromJournals(sampleJournals);
  assert.equal(csv.includes("Reference,Date,Statut"), true);
  assert.equal(csv.includes("JRNL_TEST_1"), true);
  assert.equal(csv.includes("2010 - Séquestre"), true);
  assert.equal(csv.includes("1500"), true);
});

test("sanitizeDriverForRole strictly hides private identity documents outside superadmin", () => {
  const fullDriver = {
    id: 12,
    firstName: "Yao",
    lastName: "Koffi",
    phone: "+22890000000",
    whatsappNumber: "+22890000000",
    idDocumentNumber: "NIF-12345-SECRET",
    idDocumentPhotoUrl: "https://storage.private/doc.jpg",
    workZone: "Adidogomé",
  };

  const forBuyer = sanitizeDriverForRole(fullDriver, "buyer");
  assert.equal("idDocumentNumber" in forBuyer, false);
  assert.equal("idDocumentPhotoUrl" in forBuyer, false);
  assert.equal("phone" in forBuyer, false);

  const forDriver = sanitizeDriverForRole(fullDriver, "driver");
  assert.equal("idDocumentNumber" in forDriver, false);
  assert.equal("idDocumentPhotoUrl" in forDriver, false);

  const forSuperadmin = sanitizeDriverForRole(fullDriver, "superadmin");
  assert.equal("idDocumentNumber" in forSuperadmin, true);
  assert.equal("idDocumentPhotoUrl" in forSuperadmin, true);
});

test("computeGpsFreshness flags stale or missing positions", () => {
  const healthy = computeGpsFreshness({
    freshCount: 5,
    staleAlertCount: 0,
    missingCount: 0,
    staleThresholdMinutes: 10,
    staleAlerts: [],
  });
  assert.equal(healthy.isHealthy, true);

  const unhealthy = computeGpsFreshness({
    freshCount: 3,
    staleAlertCount: 2,
    missingCount: 1,
    staleThresholdMinutes: 10,
    staleAlerts: [],
  });
  assert.equal(unhealthy.isHealthy, false);
  assert.equal(unhealthy.alertMessage.includes("signal GPS obsolète"), true);
});

test("computeQrHealth flags failed proximity checks", () => {
  const healthy = computeQrHealth({
    totalIssued: 10,
    used: 10,
    activePending: 0,
    expired: 0,
    failedProximityCount: 0,
    averageProximityMeters: 30,
  });
  assert.equal(healthy.isHealthy, true);

  const badProximity = computeQrHealth({
    totalIssued: 10,
    used: 9,
    activePending: 0,
    expired: 0,
    failedProximityCount: 2,
    averageProximityMeters: 80,
  });
  assert.equal(badProximity.isHealthy, false);
  assert.equal(badProximity.alertMessage.includes("scan QR hors zone"), true);
});

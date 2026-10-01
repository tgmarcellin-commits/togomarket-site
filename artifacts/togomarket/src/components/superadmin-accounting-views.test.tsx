import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatFcfa,
  getJournalStatusStyle,
  getWithdrawalStatusBadge,
  isJournalBalanced,
  buildClientCsvFromJournals,
  sanitizeDriverForRole,
  computeGpsFreshness,
  computeQrHealth,
} from "../lib/admin-accounting-ui";
import type { FormattedJournal, OperationsOverview } from "../pages/admin-accounting-api";

// Sample mock data
const sampleJournals: FormattedJournal[] = [
  {
    journalReference: "JNL_ORD_101_DELIVERY",
    createdAt: "2026-10-01T10:00:00.000Z",
    status: "balanced",
    description: "Règlement livraison commande #101",
    entriesCount: 2,
    isReversal: false,
    settlementRef: "SETTL_101",
    reversedFrom: null,
    reversedBy: null,
    reversalReason: null,
    orderId: 101,
    driverId: 5,
    walletId: 12,
    totalDebit: 3500,
    totalCredit: 3500,
    isBalanced: true,
    legs: [
      {
        id: 1,
        debitAccount: { id: 2, code: "2010", name: "Fonds Vendeurs", accountType: "LIABILITY" },
        creditAccount: { id: 1, code: "1010", name: "Disponibilités FedaPay", accountType: "ASSET" },
        amount: 2500,
        description: "Règlement vente article commande #101",
      },
      {
        id: 2,
        debitAccount: { id: 3, code: "2020", name: "Rémunérations Livreurs", accountType: "LIABILITY" },
        creditAccount: { id: 1, code: "1010", name: "Disponibilités FedaPay", accountType: "ASSET" },
        amount: 1000,
        description: "Frais transport livraison commande #101",
      },
    ],
  },
  {
    journalReference: "JNL_ORD_102_DELIVERY",
    createdAt: "2026-10-01T11:00:00.000Z",
    status: "reversed",
    description: "Règlement livraison commande #102",
    entriesCount: 1,
    isReversal: false,
    settlementRef: "SETTL_102",
    reversedFrom: null,
    reversedBy: "REV_JNL_ORD_102_DELIVERY",
    reversalReason: "Litige client avéré",
    orderId: 102,
    driverId: 7,
    walletId: 14,
    totalDebit: 4000,
    totalCredit: 4000,
    isBalanced: true,
    legs: [
      {
        id: 3,
        debitAccount: { id: 2, code: "2010", name: "Fonds Vendeurs", accountType: "LIABILITY" },
        creditAccount: { id: 1, code: "1010", name: "Disponibilités FedaPay", accountType: "ASSET" },
        amount: 4000,
        description: "Règlement initial commande #102",
      },
    ],
  },
  {
    journalReference: "REV_JNL_ORD_102_DELIVERY",
    createdAt: "2026-10-01T11:30:00.000Z",
    status: "reversal",
    description: "Annulation commande #102",
    entriesCount: 1,
    isReversal: true,
    settlementRef: "SETTL_102",
    reversedFrom: "JNL_ORD_102_DELIVERY",
    reversedBy: null,
    reversalReason: "Litige client avéré",
    orderId: 102,
    driverId: 7,
    walletId: 14,
    totalDebit: 4000,
    totalCredit: 4000,
    isBalanced: true,
    legs: [
      {
        id: 4,
        debitAccount: { id: 1, code: "1010", name: "Disponibilités FedaPay", accountType: "ASSET" },
        creditAccount: { id: 2, code: "2010", name: "Fonds Vendeurs", accountType: "LIABILITY" },
        amount: 4000,
        description: "Contre-passation annulation commande #102",
      },
    ],
  },
];

test("superadmin accounting ledger renders balanced and reversed journals status accurately", () => {
  const balancedStyle = getJournalStatusStyle("balanced");
  assert.equal(balancedStyle.label, "Équilibré");
  assert.match(balancedStyle.badgeClass, /emerald/);

  const reversedStyle = getJournalStatusStyle("reversed");
  assert.equal(reversedStyle.label, "Contre-passé");
  assert.match(reversedStyle.badgeClass, /purple/);

  const reversalStyle = getJournalStatusStyle("reversal");
  assert.equal(reversalStyle.label, "Écriture d'annulation");
  assert.match(reversalStyle.badgeClass, /amber/);

  // Validate balance check
  assert.equal(isJournalBalanced(sampleJournals[0]), true);
  assert.equal(isJournalBalanced({ totalDebit: 5000, totalCredit: 4000 }), false);
});

test("non-admin users cannot see private driver documents or phone numbers", () => {
  const rawDriver = {
    id: 42,
    firstName: "Koffi",
    lastName: "Mensah",
    phone: "+22890112233",
    whatsappNumber: "+22890112233",
    idDocumentNumber: "TG-CARD-998877",
    idDocumentPhotoUrl: "https://secure-bucket/private-docs/id42.jpg",
    workZone: "Lomé Maritime",
    isAvailable: true,
  };

  // Buyer / public view
  const publicView = sanitizeDriverForRole(rawDriver, "buyer") as any;
  assert.equal(publicView.idDocumentNumber, undefined);
  assert.equal(publicView.idDocumentPhotoUrl, undefined);
  assert.equal(publicView.phone, undefined);
  assert.equal(publicView.whatsappNumber, undefined);
  assert.equal(publicView.firstName, "Koffi");
  assert.equal(publicView.workZone, "Lomé Maritime");

  // Standard admin view (can contact driver, but cannot inspect confidential ID card)
  const adminView = sanitizeDriverForRole(rawDriver, "admin") as any;
  assert.equal(adminView.idDocumentNumber, undefined);
  assert.equal(adminView.idDocumentPhotoUrl, undefined);
  assert.equal(adminView.phone, "+22890112233");

  // Superadmin view (has full audit rights)
  const superadminView = sanitizeDriverForRole(rawDriver, "superadmin") as any;
  assert.equal(superadminView.idDocumentNumber, "TG-CARD-998877");
  assert.equal(superadminView.idDocumentPhotoUrl, "https://secure-bucket/private-docs/id42.jpg");
});

test("wallet summary and withdrawal badge states render correctly", () => {
  const pendingBadge = getWithdrawalStatusBadge("pending");
  assert.equal(pendingBadge.label, "En attente");

  const reviewBadge = getWithdrawalStatusBadge("withdrawal_review_required");
  assert.equal(reviewBadge.label, "Revue requise");
  assert.match(reviewBadge.color, /purple/);

  const completedBadge = getWithdrawalStatusBadge("completed");
  assert.equal(completedBadge.label, "Payé");
  assert.match(completedBadge.color, /emerald/);

  const failedBadge = getWithdrawalStatusBadge("failed");
  assert.equal(failedBadge.label, "Échec / Rejeté");
  assert.match(failedBadge.color, /destructive/);

  // Formatter FCFA
  assert.equal(formatFcfa(15000), "15 000 FCFA");
  assert.equal(formatFcfa(0), "0 FCFA");
});

test("active delivery summary shows stale GPS or failed proximity alerts", () => {
  const healthyGps: OperationsOverview["gpsHealth"] = {
    freshCount: 8,
    staleAlertCount: 0,
    missingCount: 0,
    staleThresholdMinutes: 10,
    staleAlerts: [],
  };
  const healthyResult = computeGpsFreshness(healthyGps);
  assert.equal(healthyResult.isHealthy, true);

  const degradedGps: OperationsOverview["gpsHealth"] = {
    freshCount: 4,
    staleAlertCount: 2,
    missingCount: 1,
    staleThresholdMinutes: 10,
    staleAlerts: [
      { orderId: 88, driverId: 3, ageMinutes: 25, lastRecordedAt: "2026-10-01T10:15:00.000Z" },
    ],
  };
  const degradedResult = computeGpsFreshness(degradedGps);
  assert.equal(degradedResult.isHealthy, false);
  assert.match(degradedResult.alertMessage, /2 mission\(s\) avec signal GPS obsolète/);

  // QR proximity checks
  const normalQr: OperationsOverview["qrHealth"] = {
    totalIssued: 15,
    used: 12,
    activePending: 3,
    expired: 0,
    failedProximityCount: 0,
    averageProximityMeters: 45,
  };
  assert.equal(computeQrHealth(normalQr).isHealthy, true);

  const anomalousQr: OperationsOverview["qrHealth"] = {
    totalIssued: 20,
    used: 15,
    activePending: 2,
    expired: 2,
    failedProximityCount: 3,
    averageProximityMeters: 380,
  };
  const qrHealthResult = computeQrHealth(anomalousQr);
  assert.equal(qrHealthResult.isHealthy, false);
  assert.match(qrHealthResult.alertMessage, /3 tentative\(s\) de scan QR hors zone/);
});

test("transaction filters and CSV export work with sample double-entry data", () => {
  const csv = buildClientCsvFromJournals(sampleJournals);
  assert.match(csv, /Reference,Date,Statut,Annule_De,Annule_Par,Motif/);
  assert.match(csv, /"JNL_ORD_101_DELIVERY"/);
  assert.match(csv, /"2010 - Fonds Vendeurs"/);
  assert.match(csv, /"Litige client avéré"/);
  assert.match(csv, /"REV_JNL_ORD_102_DELIVERY"/);

  // Filter verification logic
  const reversedJournals = sampleJournals.filter((j) => j.status === "reversed" || j.reversedBy);
  assert.equal(reversedJournals.length, 1);
  assert.equal(reversedJournals[0].journalReference, "JNL_ORD_102_DELIVERY");

  const order101Journals = sampleJournals.filter((j) => j.orderId === 101);
  assert.equal(order101Journals.length, 1);
});

test("static markup renders journal summary metrics without crashing", () => {
  const totalDebit = sampleJournals.reduce((acc, j) => acc + j.totalDebit, 0);
  const totalCredit = sampleJournals.reduce((acc, j) => acc + j.totalCredit, 0);

  const element = (
    <div className="accounting-metrics">
      <span className="debit-total">{formatFcfa(totalDebit)}</span>
      <span className="credit-total">{formatFcfa(totalCredit)}</span>
      <span className="balanced-badge">{isJournalBalanced({ totalDebit, totalCredit }) ? "ÉQUILIBRÉ" : "DÉSÉQUILIBRÉ"}</span>
    </div>
  );

  const markup = renderToStaticMarkup(element);
  assert.match(markup, /11 500 FCFA/);
  assert.match(markup, /ÉQUILIBRÉ/);
});

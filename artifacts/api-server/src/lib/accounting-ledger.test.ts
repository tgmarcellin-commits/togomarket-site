import test from "node:test";
import assert from "node:assert/strict";
import {
  postBalancedJournalEntry,
  reverseJournalEntry,
  getTrialBalance,
  STANDARD_ACCOUNTS,
} from "./accounting-ledger";
import { db, ledgerEntriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

test("accounting ledger: successfully posts balanced double-entry transaction", async () => {
  const ref = `TEST_JOURNAL_BALANCED_${Date.now()}`;
  const result = await postBalancedJournalEntry({
    journalReference: ref,
    legs: [
      {
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code, // 2010
        creditAccountCode: STANDARD_ACCOUNTS.SELLER_PAYABLE.code, // 2020
        amount: 5000,
        description: "Paiement article vendeur",
      },
      {
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code, // 2010
        creditAccountCode: STANDARD_ACCOUNTS.DRIVER_PAYABLE.code, // 2030
        amount: 1000,
        description: "Paiement transport livreur",
      },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.entriesCount, 2);
  assert.equal(result.duplicate, false);

  // Verify stored rows
  const stored = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.journalReference, ref));
  assert.equal(stored.length, 2);
  assert.equal(stored[0].amount, 5000);
  assert.equal(stored[1].amount, 1000);
});

test("accounting ledger: idempotent duplicate journalReference returns duplicate: true without re-inserting", async () => {
  const ref = `TEST_JOURNAL_IDEMPOTENT_${Date.now()}`;
  const first = await postBalancedJournalEntry({
    journalReference: ref,
    legs: [
      {
        debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        amount: 2500,
        description: "Encaissement FedaPay",
      },
    ],
  });
  assert.equal(first.duplicate, false);

  // Post identical journalReference again
  const second = await postBalancedJournalEntry({
    journalReference: ref,
    legs: [
      {
        debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        amount: 2500,
        description: "Encaissement FedaPay duplicate attempt",
      },
    ],
  });
  assert.equal(second.duplicate, true);

  const stored = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.journalReference, ref));
  assert.equal(stored.length, 1);
});

test("accounting ledger: rejects negative, zero, or fractional amounts", async () => {
  await assert.rejects(
    async () => {
      await postBalancedJournalEntry({
        journalReference: `TEST_ERR_NEG_${Date.now()}`,
        legs: [
          {
            debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
            creditAccountCode: STANDARD_ACCOUNTS.SELLER_PAYABLE.code,
            amount: -500,
            description: "Montant négatif illégal",
          },
        ],
      });
    },
    /Montant comptable invalide/,
  );

  await assert.rejects(
    async () => {
      await postBalancedJournalEntry({
        journalReference: `TEST_ERR_FLOAT_${Date.now()}`,
        legs: [
          {
            debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
            creditAccountCode: STANDARD_ACCOUNTS.SELLER_PAYABLE.code,
            amount: 150.75,
            description: "Montant fractionnaire illégal",
          },
        ],
      });
    },
    /Montant comptable invalide/,
  );
});

test("accounting ledger: rejects same debit and credit account", async () => {
  await assert.rejects(
    async () => {
      await postBalancedJournalEntry({
        journalReference: `TEST_ERR_SAME_${Date.now()}`,
        legs: [
          {
            debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
            creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
            amount: 1000,
            description: "Même compte débit et crédit",
          },
        ],
      });
    },
    /ne peuvent pas être identiques/,
  );
});

test("accounting ledger: reversal appends balanced opposite entries without deleting original", async () => {
  const origRef = `TEST_ORIGINAL_${Date.now()}`;
  await postBalancedJournalEntry({
    journalReference: origRef,
    legs: [
      {
        debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        amount: 3000,
        description: "Paiement initial",
      },
    ],
  });

  const revRef = `TEST_REV_${Date.now()}`;
  const reversal = await reverseJournalEntry({
    originalJournalReference: origRef,
    reversalJournalReference: revRef,
    reason: "Correction suite à erreur saisie",
  });

  assert.equal(reversal.success, true);
  assert.equal(reversal.reversedEntriesCount, 1);

  // Original entries still exist (append-only principle!)
  const origStored = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.journalReference, origRef));
  assert.equal(origStored.length, 1);

  // Reversal entries exist with inverted debit/credit accounts
  const revStored = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.journalReference, revRef));
  assert.equal(revStored.length, 1);
  assert.equal(revStored[0].debitAccountId, origStored[0].creditAccountId);
  assert.equal(revStored[0].creditAccountId, origStored[0].debitAccountId);
});

test("accounting ledger: trial balance verifies debit sum equals credit sum", async () => {
  const trialBalance = await getTrialBalance();
  assert.equal(trialBalance.isBalanced, true);
  assert.equal(trialBalance.difference, 0);
  assert.equal(trialBalance.totalDebitSum, trialBalance.totalCreditSum);
});

test("accounting ledger: supports multi-leg balanced entries and rejects unbalanced legs", async () => {
  // Balanced multi-leg (debit 5000 + 1000 = credit 6000)
  const balancedRef = `TEST_BALANCED_MULTI_${Date.now()}`;
  const balancedResult = await postBalancedJournalEntry({
    journalReference: balancedRef,
    legs: [
      {
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        creditAccountCode: STANDARD_ACCOUNTS.SELLER_PAYABLE.code,
        amount: 5000,
        entrySide: "debit",
        description: "Debit escrow 5000",
      },
      {
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        creditAccountCode: STANDARD_ACCOUNTS.DRIVER_PAYABLE.code,
        amount: 1000,
        entrySide: "debit",
        description: "Debit escrow 1000",
      },
      {
        debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        amount: 6000,
        entrySide: "credit",
        description: "Credit buyer escrow 6000",
      },
    ],
  });
  assert.equal(balancedResult.success, true);

  // Unbalanced multi-leg should be rejected
  await assert.rejects(
    async () => {
      await postBalancedJournalEntry({
        journalReference: `TEST_UNBALANCED_${Date.now()}`,
        legs: [
          {
            debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
            creditAccountCode: STANDARD_ACCOUNTS.SELLER_PAYABLE.code,
            amount: 5000,
            entrySide: "debit",
            description: "Debit 5000",
          },
          {
            debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
            creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
            amount: 4000, // Mismatched! 5000 != 4000
            entrySide: "credit",
            description: "Credit 4000",
          },
        ],
      });
    },
    /Journal déséquilibré/,
  );
});

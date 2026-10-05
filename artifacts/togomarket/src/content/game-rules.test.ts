import test from "node:test";
import assert from "node:assert/strict";
import { GAME_CONTENT_EN, GAME_CONTENT_FR, GAME_RULES_VERSION, getGameContent } from "./game-rules";

test("le règlement français contient les 5 articles du règlement, dans l'ordre", () => {
  assert.equal(GAME_CONTENT_FR.rules.length, 5);
  GAME_CONTENT_FR.rules.forEach((rule, index) => assert.ok(rule.title.startsWith(`Article ${index + 1} :`), rule.title));
});

test("les engagements essentiels figurent dans le règlement (gratuité, sans achat, non retirable, anti-triche)", () => {
  const text = GAME_CONTENT_FR.rules.map((rule) => rule.body).join(" ");
  assert.match(text, /gratuit/);
  assert.match(text, /sans aucune obligation d'achat/);
  assert.match(text, /strictement non-retirable et non-convertible en espèces/);
  assert.match(text, /triche ou multi-compte/);
});

test("la traduction anglaise suit la même structure que le français", () => {
  assert.equal(GAME_CONTENT_EN.rules.length, GAME_CONTENT_FR.rules.length);
  assert.equal(GAME_CONTENT_EN.card.highlights.length, GAME_CONTENT_FR.card.highlights.length);
  assert.deepEqual(Object.keys(GAME_CONTENT_EN.dialog).sort(), Object.keys(GAME_CONTENT_FR.dialog).sort());
});

test("le libellé de la case à cocher est celui demandé, et la langue se choisit par le code", () => {
  assert.equal(GAME_CONTENT_FR.dialog.checkbox, "J'ai lu et j'accepte le règlement du jeu");
  assert.equal(getGameContent("fr"), GAME_CONTENT_FR);
  assert.equal(getGameContent("en"), GAME_CONTENT_EN);
});

test("la version du règlement est renseignée", () => {
  assert.match(GAME_RULES_VERSION, /^[A-Za-z0-9_.:-]{1,40}$/);
});

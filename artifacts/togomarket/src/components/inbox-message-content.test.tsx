import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InboxMessageContent,
  type InboxMessageContentData,
} from "./inbox-message-content";

const signedUrl = "/api/conversations/42/files/7?access=123.signature";

function renderMessage(
  message: InboxMessageContentData,
  fileSrc = signedUrl,
): string {
  return renderToStaticMarkup(
    <InboxMessageContent message={message} fileSrc={fileSrc} />,
  );
}

test("keeps a refreshed signed URL on a clickable image thumbnail", () => {
  const markup = renderMessage({ content: null, fileType: "image" });

  assert.match(markup, /<a[^>]+href="\/api\/conversations\/42\/files\/7\?access=123\.signature"/);
  assert.match(markup, /<img[^>]+src="\/api\/conversations\/42\/files\/7\?access=123\.signature"/);
  assert.match(markup, /alt="Image envoyée"/);
});

test("keeps a refreshed signed URL on an audio player with controls", () => {
  const markup = renderMessage({ content: null, fileType: "audio" });

  assert.match(markup, /<audio[^>]+controls=""[^>]+src="\/api\/conversations\/42\/files\/7\?access=123\.signature"/);
});

test("keeps a refreshed signed URL on a usable PDF download link", () => {
  const markup = renderMessage({ content: null, fileType: "pdf" });

  assert.match(markup, /<a[^>]+href="\/api\/conversations\/42\/files\/7\?access=123\.signature"/);
  assert.match(markup, /download=""/);
  assert.match(markup, /Télécharger le PDF/);
});

test("does not add an empty paragraph when a message has no text", () => {
  const markup = renderMessage({ content: "   ", fileType: "image" });

  assert.doesNotMatch(markup, /<p(?:\s|>)/);
});
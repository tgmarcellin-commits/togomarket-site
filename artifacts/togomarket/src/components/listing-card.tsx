  /** Create or resume a conversation then open it (floating window or redirect). */
  const startChat = async (identity: BuyerIdentity | null) => {
    if (chatLoading) return;
    setBuyerIdentity(identity);
    setChatLoading(true);
    setChatError(null);

    const vid = listing.vendorId ?? 0;
    const lid = listing.id;
    const stored = vid ? getBuyerSession(vid, lid) ?? loadChatSession(vid, lid) : null;

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          vendorId: vid,
          buyerName: identity?.name,
          buyerPhone: identity?.phone,
          buyerKey: identity ? getOrCreateBuyerKey(identity) : undefined,
          conversationId: stored?.convId,
          resumeBuyerToken: stored?.buyerToken,
          knownBuyerTokens: getAllBuyerSessions()
            .filter((session) => session.vendorId === vid)
            .map((session) => session.buyerToken),
          listingTitle: listing.name,
          listingId: lid,
        }),
      });
      const payload = await res.json().catch(() => null) as {
        id?: number;
        buyerToken?: string;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !payload?.id || !payload.buyerToken) {
        const requireBuyerIdentity = !identity && (
          payload?.error === "buyer identity required" ||
          payload?.error === "buyerKey required"
        );
        if (requireBuyerIdentity) {
          setIdentityPromptOpen(true);
          return;
        }
        const fallback = lang === "fr"
          ? "Impossible d’ouvrir la discussion. Réessayez."
          : "Unable to open the conversation. Please try again.";
        setChatError(payload?.message ?? fallback);
        return;
      }

      const conv = { id: payload.id, buyerToken: payload.buyerToken };
      if (vid) {
        storeBuyerSession({
          convId: conv.id,
          buyerToken: conv.buyerToken,
          vendorId: vid,
          listingId: lid,
          listingTitle: listing.name,
        });
      }
      if (onOpenInMessages) {
        onOpenInMessages(conv.id);
      } else {
        setConversationId(conv.id);
        setBuyerToken(conv.buyerToken);
        setChatOpen(true);
      }
    } catch {
      setChatError(lang === "fr"
        ? "La connexion a échoué. Vérifiez votre réseau puis réessayez."
        : "Connection failed. Check your network and try again.");
    } finally {
      setChatLoading(false);
    }
  };

  const handleContactVendor = () => {
    const existingIdentity = loadBuyerIdentity();
    if (existingIdentity) {
      startChat(existingIdentity);
      return;
    }

    // Every visitor can initiate a seller chat after entering a buyer identity.
    // We never call the API without a buyer identity because the guest flow must
    // always pass through the prompt first.
    setIdentityPromptOpen(true);
  };

  const handleIdentityConfirm = (identity: BuyerIdentity) => {
    setIdentityPromptOpen(false);
    startChat(identity);
  };
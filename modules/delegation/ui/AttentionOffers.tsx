"use client";

import { Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useCallback, useMemo, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { labelOfName } from "agents";
import { useAgents } from "agents/ui";
import { notify } from "components/notices";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { getUserFacingErrorMessage } from "lib/errors";
import { requestPlace } from "lib/placeRequests";

import type { AttentionOffer } from "../pointers";
import { useDelegation } from "./context";
import PointerOffer from "./PointerOffer";
import { dismissOfferShortcut, takeOfferShortcut } from "./shortcuts";

/**
 * Each set of items, coverages and impacts an agent pointed the spec owner
 * to, with its text and a way to go to each in turn, kept until dismissed.
 * It never takes the focus: its buttons are reached with Tab, and its keys
 * go to the offer made last.
 */
const AttentionOffers = observer(function AttentionOffers() {
  const { offers, dismissOffer, placeLabel } = useDelegation();
  const agents = useAgents().view.agents;
  // The unit each offer goes to next, by offer.
  const [next, setNext] = useState<Record<string, number>>({});
  const indexOf = useCallback((offer: AttentionOffer) => (next[offer.id] ?? 0) % offer.places.length, [next]);

  const dismiss = useCallback(
    (offer: AttentionOffer) => {
      dismissOffer(offer.id).catch((error: unknown) => notify(getUserFacingErrorMessage(error, "Could not dismiss it."), "error"));
    },
    [dismissOffer],
  );
  const take = useCallback(
    (offer: AttentionOffer) => {
      const index = indexOf(offer);
      requestPlace(offer.places[index]!, { leavePreview: true });
      setNext((current) => ({ ...current, [offer.id]: index + 1 }));
    },
    [indexOf],
  );

  const bindings = useMemo<ShortcutBinding[]>(() => {
    const when = (event: KeyboardEvent) => offers.length > 0 && !isEditableTarget(event.target) && !isOverlayTarget(event.target);
    return [
      { id: "take-offer", ...takeOfferShortcut, when, action: () => take(offers.at(-1)!) },
      { id: "dismiss-offer", ...dismissOfferShortcut, when, action: () => dismiss(offers.at(-1)!) },
    ];
  }, [offers, take, dismiss]);
  useShortcut(bindings[0]!);
  useShortcut(bindings[1]!);

  if (offers.length === 0) return null;
  return (
    <Stack
      role="region"
      aria-label="Agents point you to"
      aria-live="polite"
      spacing={1}
      sx={{ position: "fixed", left: 16, bottom: 16, zIndex: (theme) => theme.zIndex.snackbar, maxWidth: 420 }}
    >
      {offers.map((offer, index) => {
        const newest = index === offers.length - 1;
        return (
          <PointerOffer
            key={offer.id}
            text={offer.text}
            from={labelOfName(agents, offer.from)}
            units={offer.places.map(placeLabel)}
            index={indexOf(offer)}
            onGo={() => take(offer)}
            onDismiss={() => dismiss(offer)}
            goButton={newest ? (button) => <ActionTooltip name="Go to it" shortcut={takeOfferShortcut}>{button}</ActionTooltip> : undefined}
            dismissButton={newest ? (button) => <ActionTooltip name="Dismiss" shortcut={dismissOfferShortcut}>{button}</ActionTooltip> : undefined}
          />
        );
      })}
    </Stack>
  );
});

export default AttentionOffers;

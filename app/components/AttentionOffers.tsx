"use client";

import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useCallback, useMemo } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { dismissOfferShortcut, takeOfferShortcut } from "actions/actions";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { getUserFacingErrorMessage } from "lib/errors";
import { requestPlace } from "lib/placeRequests";
import type { AttentionOffer } from "project-session";
import { useProject } from "projectContext";
import { WORKFLOW } from "store";

import { notify } from "./notices";

/**
 * Each item, coverage or impact the coding agent named for the spec
 * owner's attention, with its text and a way to go to it or dismiss it,
 * kept until one of those is taken. It never takes the focus: its buttons
 * are reached with Tab, and its keys go to the one named last.
 */
const AttentionOffers = observer(function AttentionOffers() {
  const { offers, dismissOffer, moduleStore, modules, modulesEnabled } = useProject();

  const dismiss = useCallback(
    (offer: AttentionOffer) => {
      dismissOffer(offer.id).catch((error: unknown) => notify(getUserFacingErrorMessage(error, "Could not dismiss it."), "error"));
    },
    [dismissOffer],
  );
  const take = useCallback(
    (offer: AttentionOffer) => {
      requestPlace(offer.place, { leavePreview: true });
      dismiss(offer);
    },
    [dismiss],
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
      aria-label="The coding agent points you to"
      aria-live="polite"
      spacing={1}
      sx={{ position: "fixed", left: 16, bottom: 16, zIndex: (theme) => theme.zIndex.snackbar, maxWidth: 420 }}
    >
      {offers.map((offer, index) => {
        const label = moduleStore(offer.place.moduleId)?.unitLabel(offer.place.unitId) ?? "a removed item";
        const moduleName = modulesEnabled ? modules.find(({ id }) => id === offer.place.moduleId)?.name : undefined;
        const where = [moduleName, WORKFLOW.isStage(offer.place.stage) ? WORKFLOW.stage(offer.place.stage).label : null].filter((part) => part != null).join(", ");
        const newest = index === offers.length - 1;
        return (
          <Paper key={offer.id} elevation={4} sx={{ p: 1.5 }}>
            <Typography variant="body2">{offer.text}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", "&::first-letter": { textTransform: "uppercase" } }}>
              {label}
              {where === "" ? "" : `, ${where}`} · {offer.from}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
              {newest ? (
                <ActionTooltip name="Go to it" shortcut={takeOfferShortcut}>
                  <Button size="small" variant="contained" onClick={() => take(offer)}>
                    Go to it
                  </Button>
                </ActionTooltip>
              ) : (
                <Button size="small" variant="contained" onClick={() => take(offer)}>
                  Go to it
                </Button>
              )}
              {newest ? (
                <ActionTooltip name="Dismiss" shortcut={dismissOfferShortcut}>
                  <Button size="small" onClick={() => dismiss(offer)}>
                    Dismiss
                  </Button>
                </ActionTooltip>
              ) : (
                <Button size="small" onClick={() => dismiss(offer)}>
                  Dismiss
                </Button>
              )}
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
});

export default AttentionOffers;

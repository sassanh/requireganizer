"use client";

import { MoreVert } from "@mui/icons-material";
import { IconButton, Menu, Tooltip } from "@mui/material";
import { useCallback, useState, type MouseEvent } from "react";

import { copyAction, copyUrlAction } from "actions/actions";
import { ActionView } from "actions/ActionView";

/**
 * Overflow menu on each fragment card. Copy and Copy link read from the
 * same actions as the keyboard shortcuts, so the menu rows can never
 * disagree with the keys about what they do.
 */
export function FragmentMoreMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const isOpen = anchor !== null;

  const handleOpen = useCallback((event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setFrame(event.currentTarget.closest<HTMLElement>("[data-navigate-card]"));
    setAnchor(event.currentTarget);
  }, []);
  const handleClose = useCallback(() => {
    setAnchor(null);
  }, []);

  return (
    <>
      <Tooltip title="More actions">
        <IconButton
          aria-label="More actions"
          size="small"
          onClick={handleOpen}
        >
          <MoreVert fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={isOpen} onClose={handleClose}>
        {frame == null ? null : (
          <>
            <ActionView
              variant="menuitem"
              action={copyAction}
              target={frame}
              onSelect={handleClose}
            />
            <ActionView
              variant="menuitem"
              action={copyUrlAction}
              target={frame}
              onSelect={handleClose}
            />
          </>
        )}
      </Menu>
    </>
  );
}

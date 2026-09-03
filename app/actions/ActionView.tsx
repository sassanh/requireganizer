"use client";

import {
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Tooltip,
  Typography,
  type ButtonProps,
  type IconButtonProps,
} from "@mui/material";
import { type Ref } from "react";

import type { Action } from "./actions";
import { actionHint, shortcutText } from "./shortcutText";

interface IconButtonRepresentation<Target> {
  variant: "iconbutton";
  action: Action<Target>;
  target: Target;
  size?: IconButtonProps["size"];
  color?: IconButtonProps["color"];
  /** Submit buttons let their form run the action; plain buttons run it. */
  submit?: boolean;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

interface TextButtonRepresentation<Target> {
  variant: "textbutton";
  action: Action<Target>;
  target: Target;
  size?: ButtonProps["size"];
  color?: ButtonProps["color"];
  buttonVariant?: ButtonProps["variant"];
  ref?: Ref<HTMLButtonElement>;
}

interface MenuItemRepresentation<Target> {
  variant: "menuitem";
  action: Action<Target>;
  target: Target;
  onSelect?: () => void;
}

export type ActionViewProps<Target> =
  | IconButtonRepresentation<Target>
  | TextButtonRepresentation<Target>
  | MenuItemRepresentation<Target>;

/**
 * The one place that turns an action into interface. Fed with an action
 * plus its live target, it renders the requested representation — icon
 * button, text button, or menu row — with name, picture, hint,
 * availability, and run all coming from the action. Call sites never touch
 * action internals. Every representation carries data-action so keyboard
 * shortcuts can press the selected card's own button through its action
 * instead of a hand-made hook.
 */
export function ActionView<Target>(props: ActionViewProps<Target>) {
  const { action, target } = props;
  // Hint text only appears in the hover layer, never in the page markup,
  // so reading the platform here cannot split the server render.
  const hint = actionHint(action.name, action.shortcut);
  if (props.variant === "menuitem") {
    const { onSelect } = props;
    return (
      <MenuItem
        data-action={action.id}
        disabled={!action.isEnabled(target)}
        onClick={() => {
          action.run(target);
          onSelect?.();
        }}
      >
        <ListItemIcon>{action.icon}</ListItemIcon>
        <ListItemText>{action.name}</ListItemText>
        {action.shortcut == null ? null : (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 3 }}>
            {shortcutText(action.shortcut)}
          </Typography>
        )}
      </MenuItem>
    );
  }
  if (props.variant === "textbutton") {
    const { size, color, buttonVariant, ref } = props;
    return (
      <Tooltip title={hint}>
        <span>
          <Button
            aria-label={action.name}
            data-action={action.id}
            size={size}
            color={color}
            variant={buttonVariant}
            type="button"
            disabled={!action.isEnabled(target)}
            ref={ref}
            onClick={() => action.run(target)}
          >
            {action.name}
          </Button>
        </span>
      </Tooltip>
    );
  }
  const { size, color, submit = false, loading, ref } = props;
  return (
    <Tooltip title={hint}>
      <span>
        <IconButton
          aria-label={action.name}
          data-action={action.id}
          size={size}
          color={color}
          type={submit ? "submit" : "button"}
          disabled={!action.isEnabled(target)}
          loading={loading}
          ref={ref}
          onClick={submit ? undefined : () => action.run(target)}
        >
          {action.icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

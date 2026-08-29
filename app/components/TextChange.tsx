import { Box, TextField, type TextFieldProps } from "@mui/material";
import { alpha, keyframes, useTheme } from "@mui/material/styles";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { isPresenting } from "presentation";

import { usePresentationTurn } from "./changeQueue";
import {
  hunksHaveKind,
  wordDiff,
  type DiffHunk,
} from "./wordDiff";

/** Red blink length. We swap to the new text during its fade. */
export const TEXT_REMOVE_MILLISECONDS = 500;

/** When during the red blink the deletions come off and additions take their seats. */
export const TEXT_REMOVE_SWAP_MILLISECONDS = 300;

/** Green summon blink for additions. */
export const TEXT_INSERT_MILLISECONDS = 500;

const removeFlash = keyframes`
  0% { background-color: transparent; }
  35% { background-color: var(--text-change-flash); }
  70% { background-color: var(--text-change-flash-mid); }
  100% { background-color: transparent; }
`;

const insertFlash = keyframes`
  0% { opacity: 0; background-color: transparent; }
  25% { opacity: 1; background-color: var(--text-change-flash); }
  70% { opacity: 1; background-color: var(--text-change-flash-mid); }
  100% { opacity: 1; background-color: transparent; }
`;

export type TextChangePhase = "idle" | "remove" | "insert";

function TextChangeSpans({
  hunks,
  phase,
}: {
  hunks: DiffHunk[];
  phase: "remove" | "insert";
}) {
  const theme = useTheme();
  const flash =
    phase === "remove" ? theme.palette.error.main : theme.palette.success.main;
  const shown = phase === "remove" ? "delete" : "insert";

  return (
    <>
      {hunks.map((hunk, index) => {
        if (hunk.kind === "equal") return hunk.text;
        if (hunk.kind !== shown) return null;
        return (
          <Box
            component="span"
            key={`${hunk.kind}:${index}`}
            sx={{
              borderRadius: "2px",
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
              "--text-change-flash": alpha(flash, 0.32),
              "--text-change-flash-mid": alpha(flash, 0.12),
              animation:
                phase === "remove"
                  ? `${removeFlash} ${TEXT_REMOVE_MILLISECONDS}ms ease-out forwards`
                  : `${insertFlash} ${TEXT_INSERT_MILLISECONDS}ms ease-out forwards`,
              ...(phase === "insert" ? { opacity: 0 } : {}),
            }}
          >
            {hunk.text}
          </Box>
        );
      })}
    </>
  );
}

function TextChangeOverlay({
  hunks,
  phase,
  input,
}: {
  hunks: DiffHunk[];
  phase: "remove" | "insert";
  input: HTMLInputElement | HTMLTextAreaElement;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (overlay == null) return;

    const sync = (): void => {
      const parent = overlay.offsetParent as HTMLElement | null;
      if (parent == null) return;
      const parentRect = parent.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      overlay.style.left = `${inputRect.left - parentRect.left}px`;
      overlay.style.top = `${inputRect.top - parentRect.top}px`;
      overlay.style.width = `${input.clientWidth}px`;
      overlay.style.minHeight = `${input.clientHeight}px`;
      overlay.style.height = "auto";
      overlay.style.font = style.font;
      overlay.style.letterSpacing = style.letterSpacing;
      overlay.style.lineHeight = style.lineHeight;
      overlay.style.padding = style.padding;
      overlay.style.boxSizing = "border-box";
      overlay.style.whiteSpace =
        style.whiteSpace === "nowrap" ? "pre" : "pre-wrap";
      overlay.style.overflow = "visible";
      overlay.style.wordWrap = "break-word";
      overlay.style.overflowWrap = "break-word";
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(input);
    return () => observer.disconnect();
  }, [input, hunks, phase]);

  return (
    <Box
      ref={overlayRef}
      aria-hidden
      sx={{
        position: "absolute",
        pointerEvents: "none",
        color: "text.primary",
        zIndex: 1,
      }}
    >
      <TextChangeSpans hunks={hunks} phase={phase} />
    </Box>
  );
}

/**
 * Present a recorded string change: red-blink deletions, swap at the fade
 * to the new text with additions invisible but seated, then green-blink
 * them in. Idle / human edits snap.
 */
export function useStagedText(
  committed: string,
  elementId?: string,
): {
  displayed: string;
  animating: boolean;
  phase: TextChangePhase;
  hunks: DiffHunk[] | null;
  input: HTMLInputElement | HTMLTextAreaElement | null;
  setInput: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
} {
  const [displayed, setDisplayed] = useState(committed);
  const [phase, setPhase] = useState<TextChangePhase>("idle");
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  const [input, setInput] = useState<
    HTMLInputElement | HTMLTextAreaElement | null
  >(null);
  const displayedRef = useRef(displayed);
  // eslint-disable-next-line react-hooks/refs -- sync ref for effect comparison
  displayedRef.current = displayed;
  const { claimTurn, completeTurn, createCleanup } =
    usePresentationTurn(elementId);

  useLayoutEffect(() => {
    if (committed === displayedRef.current) {
      if (!isPresenting()) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- snap when not presenting
        setPhase("idle");
        setHunks(null);
      }
      return;
    }

    const nextHunks = wordDiff(displayedRef.current, committed);
    const hasDeletes = hunksHaveKind(nextHunks, "delete");
    const hasInserts = hunksHaveKind(nextHunks, "insert");
    if (!hasDeletes && !hasInserts) {
      setDisplayed(committed);
      setPhase("idle");
      setHunks(null);
      return;
    }

    const tick = claimTurn();
    if (tick == null) {
      setDisplayed(committed);
      setPhase("idle");
      setHunks(null);
      return;
    }

    setHunks(nextHunks);
    setDisplayed(committed);
    if (hasDeletes) {
      setPhase("remove");
    } else {
      setPhase("insert");
    }

    const finish = () => completeTurn(tick);

    let swapTimer: ReturnType<typeof setTimeout> | null = null;
    let finalTimer: ReturnType<typeof setTimeout> | null = null;

    if (hasDeletes && hasInserts) {
      swapTimer = setTimeout(() => {
        setDisplayed(committed);
        setPhase("insert");
      }, TEXT_REMOVE_SWAP_MILLISECONDS);
      finalTimer = setTimeout(() => {
        setPhase("idle");
        setHunks(null);
        finish();
      }, TEXT_REMOVE_SWAP_MILLISECONDS + TEXT_INSERT_MILLISECONDS);
    } else if (hasDeletes) {
      finalTimer = setTimeout(() => {
        setDisplayed(committed);
        setPhase("idle");
        setHunks(null);
        finish();
      }, TEXT_REMOVE_MILLISECONDS);
    } else if (hasInserts) {
      finalTimer = setTimeout(() => {
        setPhase("idle");
        setHunks(null);
        finish();
      }, TEXT_INSERT_MILLISECONDS);
    }

    return createCleanup(tick, () => {
      if (swapTimer != null) clearTimeout(swapTimer);
      if (finalTimer != null) clearTimeout(finalTimer);
    });
  }, [committed, elementId, claimTurn, completeTurn, createCleanup]);

  return {
    displayed,
    animating: phase !== "idle",
    phase,
    hunks,
    input,
    setInput,
  };
}

type StagedTextFieldProps = Omit<TextFieldProps, "value"> & {
  committed: string;
  elementId?: string;
};

/** TextField that plays word-level red/green change spans while presenting. */
export function StagedTextField({
  committed,
  elementId,
  slotProps,
  onChange,
  onFocus,
  onBlur,
  ...props
}: StagedTextFieldProps) {
  const staged = useStagedText(committed, elementId);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(committed);

  useLayoutEffect(() => {
    if (!isFocused && !staged.animating) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync draft when not focused/animating
      setDraft(committed);
    }
  }, [committed, isFocused, staged.animating]);

  const showDraft =
    staged.animating ? false : isFocused || draft !== staged.displayed;
  const displayValue = showDraft ? draft : staged.displayed;

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setDraft(event.target.value);
    (onChange as unknown as
      | ((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void)
      | undefined)?.(event);
  };

  const handleFocus = (
    event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setIsFocused(true);
    (onFocus as unknown as
      | ((event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void)
      | undefined)?.(event);
  };

  const handleBlur = (
    event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setIsFocused(false);
    (onBlur as unknown as
      | ((event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void)
      | undefined)?.(event);
  };

  const htmlInput =
    slotProps != null &&
    typeof slotProps.htmlInput === "object" &&
    slotProps.htmlInput != null
      ? slotProps.htmlInput
      : {};
  const htmlStyle =
    "style" in htmlInput && htmlInput.style != null
      ? (htmlInput.style as CSSProperties)
      : {};

  return (
    <Box
      sx={{
        position: "relative",
        width: props.fullWidth === true ? "100%" : undefined,
      }}
    >
      <TextField
        {...props}
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        inputRef={staged.setInput}
        slotProps={{
          ...slotProps,
          htmlInput: {
            ...htmlInput,
            style: {
              ...htmlStyle,
              ...(staged.animating
                ? { color: "transparent", caretColor: "transparent" }
                : {}),
            },
          },
        }}
      />
      {staged.animating &&
        staged.hunks != null &&
        staged.phase !== "idle" &&
        staged.input != null && (
          <TextChangeOverlay
            hunks={staged.hunks}
            phase={staged.phase}
            input={staged.input}
          />
        )}
    </Box>
  );
}

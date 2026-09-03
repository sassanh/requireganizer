import { Stack, StackProps, TextField, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";
import { Fragment, useEffect, useRef, type MouseEvent, type ReactNode } from "react";

import { useFragmentHash } from "hooks/useFragmentHash";
import { FRAGMENT_CODES, Priority, StructuralFragment as StructuralFragmentName, useStore } from "store";
import { type TestCase, StructuralFragment } from "store/models";

import { ApprovalFrame } from "./ApprovalFrame";
import ApprovalMark from "./ApprovalMark";
import { pulseElement } from "./attention";
import { HIGHLIGHT_MILLISECONDS } from "./changeQueue";
import { formatFragmentCopy } from "./copyFormat";
import { FragmentMoreMenu } from "./FragmentMoreMenu";
import { getFrozenFragment, rememberFrozenFragment } from "./frozenFragment";
import Link from "./Link";
import { QualityIssues } from "./QualityState";
import { scrollIntoViewWithMargin } from "./scrollFollower";

const lastLiveCode = new WeakMap<object, string>();

const codeSx = (priority: string) => (theme: Theme) => ({
  position: "relative" as const,
  zIndex: 1,
  fontWeight: 800,
  mr: -8,
  mt: 2,
  flexBasis: "calc(var(--mui-spacing) * 7)",
  flexShrink: 0,
  flexGrow: 0,
  color: {
    [Priority.P2]: theme.palette.warning.main,
    [Priority.P1]: theme.palette.warning.dark,
    [Priority.P0]: theme.palette.error.main,
    "": "inherit",
  }[priority],
});

type CaptionLink = { id: string; href: string; label: string };

interface FragmentFrameProps extends StackProps {
  id: string;
  code: string;
  type: string;
  priority: string;
  approved?: boolean;
  qualityIssues?: readonly string[];
  children: ReactNode;
  isDisabled: boolean;
  isHighlighted: boolean;
  highlightSx?:
  | React.CSSProperties
  | ((theme: Theme) => React.CSSProperties);
  dependencies: CaptionLink[];
  references: CaptionLink[];
  onComment?: (comment: string) => void;
  getCopyText?: () => string;
}

function FragmentFrame({
  id,
  code,
  type,
  priority,
  approved,
  qualityIssues = [],
  children,
  isDisabled,
  isHighlighted,
  highlightSx,
  dependencies,
  references,
  onComment,
  onClick,
  getCopyText,
  sx,
  ...props
}: FragmentFrameProps) {
  const hasCaptions = dependencies.length > 0 || references.length > 0;
  const captionRightPadding = onComment != null ? 36 : 22;
  // Clicking anywhere on the card (not a button or link) focuses its text,
  // so the whole card — not just the text box — shows the focus border.
  const handleFrameClick = (event: MouseEvent<HTMLDivElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest("button, a, input, textarea")) {
      return;
    }
    event.currentTarget.querySelector<HTMLElement>("input, textarea")?.focus();
  };
  return (
    <ApprovalFrame
      {...props}
      elementId={id}
      approval={approved === true ? "approved" : "draft"}
      data-fragment-code={code === "" ? undefined : code}
      getCopyText={getCopyText}
      onClick={handleFrameClick}
      sx={[
        {
          position: 'relative',
          borderRadius: 1,
          bgcolor: "background.paper",
          "&:focus-within": {
            outline: "2px solid",
            outlineColor: "primary.main",
          },
        },
        isHighlighted ? highlightSx ?? { backgroundColor: "action.focus" } : {},
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Stack
        sx={{
          pl: 2,
          pb: hasCaptions ? 0 : 5,
        }}
      >
        <Stack direction="row" data-fragment={`${type}:${id}`}>
          <Typography
            component={Link}
            href={`#${code}`}
            underline="hover"
            variant="body1"
            sx={codeSx(priority)}
          >
            {code}.
          </Typography>
          {children}
        </Stack>
        {dependencies.length > 0 && (
          <Typography variant="caption" sx={{ py: 1, pr: captionRightPadding }}>
            Dependencies:{" "}
            {dependencies.map((dependency, index) => (
              <Fragment key={`${dependency.id}:${index}`}>
                <Link
                  scroll={false}
                  href={dependency.href}
                  underline="hover"
                >
                  {dependency.label}
                </Link>
                {index < dependencies.length - 1 ? ", " : ""}
              </Fragment>
            ))}
          </Typography>
        )}
        {references.length > 0 && (
          <Typography variant="caption" sx={{ py: 1, pr: captionRightPadding }}>
            References:{" "}
            {references.map((reference, index) => (
              <Fragment key={`${reference.id}:${index}`}>
                <Link href={reference.href} underline="hover">
                  {reference.label}
                </Link>
                {index < references.length - 1 ? ", " : ""}
              </Fragment>
            ))}
          </Typography>
        )}
        <Stack
          sx={{
            position: "absolute",
            right: 8,
            bottom: 8,
          }}
        >
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
            <ApprovalMark
              id={id}
              onRequestChange={onComment}
              requestChangeDisabled={isDisabled}
            />
            <FragmentMoreMenu />
          </Stack>
        </Stack>
      </Stack>
      <QualityIssues issues={qualityIssues} />
    </ApprovalFrame>
  );
}

interface FragmentShellProps<Type extends StructuralFragment>
  extends StackProps {
  isDisabled: boolean;
  list: Type[];
  fragment: Type;
  onComment?: (parameters: { fragment: Type; comment: string }) => void;
  highlightSx?:
  | React.CSSProperties
  | ((theme: Theme) => React.CSSProperties);
}

const FragmentShellContent = observer(function FragmentShellContent<
  Type extends StructuralFragment,
>({
  children,
  isDisabled,
  list,
  fragment,
  onComment,
  highlightSx,
  sx,
  ...props
}: FragmentShellProps<Type>) {
  const store = useStore();
  const hash = useFragmentHash();

  lastLiveCode.set(fragment, fragment.getCode());
  const code = lastLiveCode.get(fragment) ?? "";
  const fragmentId = fragment.id;
  const fragmentType = fragment.type;
  const fragmentPriority = fragment.priority ?? "";
  const qualityIssues =
    store?.mechanicalIssuesForItem(fragmentId).map(({ message }) => message) ?? [];
  const dependencies = [...fragment.dependencies].map((id) => {
    const linkedCode = store.getCode(id);
    return {
      id,
      href: linkedCode ? `#${linkedCode}` : "#",
      label: `${FRAGMENT_CODES[fragmentType]}-${list.findIndex(({ id: id_ }) => id_ === id) + 1
        }`,
    };
  });
  const references = [...fragment.references].map((reference) => ({
    id: reference.id,
    href: store.getPath(reference.id) ?? "#",
    label: store.getCode(reference.id) ?? reference.id,
  }));
  const isHighlighted = hash === code || hash === fragmentId;

  // Navigating to a fragment (its code link, a reference, a fresh page
  // load with a hash) pulls the card into view and flashes it once.
  const previousHashRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousHashRef.current;
    previousHashRef.current = hash;
    if (hash === "" || hash === previous) return;
    if (hash !== code && hash !== fragmentId) return;
    const node = document.getElementById(fragmentId);
    if (node == null) return;
    scrollIntoViewWithMargin(node, "nearest");
    pulseElement(node, HIGHLIGHT_MILLISECONDS);
  }, [hash, code, fragmentId]);

  const handleComment = (comment: string) => {
    if (!isAlive(fragment)) return;
    onComment?.({ fragment, comment });
  };

  const frame = (
    <FragmentFrame
      code={code}
      type={fragmentType}
      priority={fragmentPriority}
      approved={fragment.approval === "approved"}
      qualityIssues={qualityIssues}
      isDisabled={isDisabled}
      isHighlighted={isHighlighted}
      highlightSx={highlightSx}
      dependencies={dependencies}
      references={references}
      onComment={handleComment}
      getCopyText={() =>
        formatFragmentCopy({
          code,
          fragment,
          getCode: (id) => store?.getCode(id) ?? id,
        })
      }
      sx={sx}
      {...props}
      id={fragmentId}
    >
      {children}
    </FragmentFrame>
  );
  rememberFrozenFragment(fragmentId, frame);
  return frame;
});

const FragmentShell = <Type extends StructuralFragment>(
  props: FragmentShellProps<Type>,
) => (isAlive(props.fragment) ? <FragmentShellContent {...props} /> : null);

const fieldSx = {
  "& fieldset": { border: "none" },
};

function itemBodyFromFields(fields: {
  type: string;
  content?: string;
  title?: string;
  steps?: string;
  expectedResult?: string;
}): ReactNode {
  if (fields.type === StructuralFragmentName.TestCase) {
    return (
      <Stack spacing={1} sx={{ flexGrow: 1 }}>
        <TextField
          multiline
          fullWidth
          value={fields.title ?? ""}
          placeholder="Test Case Title"
          size="small"
          sx={fieldSx}
          slotProps={{
            input: { readOnly: true, sx: { pl: 9, fontWeight: "bold" } },
          }}
        />
        <TextField
          multiline
          fullWidth
          value={fields.steps ?? ""}
          placeholder="Test Steps"
          size="small"
          sx={fieldSx}
          slotProps={{
            input: { readOnly: true, sx: { pl: 9 } },
          }}
        />
        <TextField
          multiline
          fullWidth
          value={fields.expectedResult ?? ""}
          placeholder="Expected Result"
          size="small"
          sx={fieldSx}
          slotProps={{
            input: { readOnly: true, sx: { pl: 9, fontStyle: "italic" } },
          }}
        />
      </Stack>
    );
  }
  return (
    <TextField
      multiline
      fullWidth
      value={fields.content ?? ""}
      sx={fieldSx}
      slotProps={{ input: { sx: { pl: 9 } } }}
    />
  );
}

function itemBody(fragment: StructuralFragment): ReactNode {
  if (fragment.type === StructuralFragmentName.TestCase) {
    const testCase = fragment as TestCase;
    return itemBodyFromFields({
      type: fragment.type,
      title: testCase.title,
      steps: testCase.steps,
      expectedResult: testCase.expectedResult,
    });
  }
  return itemBodyFromFields({
    type: fragment.type,
    content: fragment.content,
  });
}

/** MST-free picture of a still-live item, taken when its enter is queued. */
export function freezeLiveFragment(
  fragment: StructuralFragment,
  {
    list,
    isDisabled,
    store,
  }: {
    list: StructuralFragment[];
    isDisabled: boolean;
    store: {
      getCode: (id: string) => string | undefined;
      getPath: (id: string) => string | undefined;
    };
  },
): void {
  const fragmentType = fragment.type;
  const dependencies = [...fragment.dependencies].map((id) => {
    const linkedCode = store.getCode(id);
    return {
      id,
      href: linkedCode ? `#${linkedCode}` : "#",
      label: `${FRAGMENT_CODES[fragmentType]}-${list.findIndex(({ id: id_ }) => id_ === id) + 1
        }`,
    };
  });
  const references = [...fragment.references].map((reference) => ({
    id: reference.id,
    href: store.getPath(reference.id) ?? "#",
    label: store.getCode(reference.id) ?? reference.id,
  }));
  rememberFrozenFragment(
    fragment.id,
    <FragmentFrame
      id={fragment.id}
      code={fragment.getCode()}
      type={fragmentType}
      priority={fragment.priority ?? ""}
      approved={fragment.approval === "approved"}
      isDisabled={isDisabled}
      isHighlighted={false}
      dependencies={dependencies}
      references={references}
    >
      {itemBody(fragment)}
    </FragmentFrame>,
  );
}

/** Picture taken from the change's own snapshot, used when the live model
 * is already gone at schedule time. */
export function freezeFragmentSnapshot(
  id: string,
  snapshot: unknown,
  isDisabled: boolean,
): void {
  if (getFrozenFragment(id) != null) return;
  if (snapshot == null || typeof snapshot !== "object") return;
  const record = snapshot as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  rememberFrozenFragment(
    id,
    <FragmentFrame
      id={id}
      code=""
      type={type}
      priority={typeof record.priority === "string" ? record.priority : ""}
      isDisabled={isDisabled}
      isHighlighted={false}
      dependencies={[]}
      references={[]}
    >
      {itemBodyFromFields({
        type,
        content: typeof record.content === "string" ? record.content : "",
        title: typeof record.title === "string" ? record.title : "",
        steps: typeof record.steps === "string" ? record.steps : "",
        expectedResult:
          typeof record.expectedResult === "string"
            ? record.expectedResult
            : "",
      })}
    </FragmentFrame>,
  );
}

export default FragmentShell;

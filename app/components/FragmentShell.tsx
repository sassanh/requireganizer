import { Delete } from "@mui/icons-material";
import { IconButton, Stack, StackProps, TextField, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";
import { Fragment, type ReactNode } from "react";

import { useFragmentHash } from "hooks/useFragmentHash";
import { FRAGMENT_CODES, Priority, StructuralFragment as StructuralFragmentName, useStore } from "store";
import { type TestCase, StructuralFragment } from "store/models";

import CommentButton from "./CommentButton";
import { getFrozenFragment, rememberFrozenFragment } from "./frozenFragment";
import Link from "./Link";

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
  children: ReactNode;
  showActions: boolean;
  isDisabled: boolean;
  isHighlighted: boolean;
  highlightSx?:
    | React.CSSProperties
    | ((theme: Theme) => React.CSSProperties);
  dependencies: CaptionLink[];
  references: CaptionLink[];
  onRemove?: () => void;
  onComment?: (comment: string) => void;
}

function FragmentFrame({
  id,
  code,
  type,
  priority,
  children,
  showActions,
  isDisabled,
  isHighlighted,
  highlightSx,
  dependencies,
  references,
  onRemove,
  onComment,
  sx,
  ...props
}: FragmentFrameProps) {
  return (
    <Stack
      {...props}
      id={id}
      sx={[
        { pl: 1 },
        isHighlighted ? highlightSx ?? { backgroundColor: "action.focus" } : {},
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
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
        {showActions && (
          <Stack direction="row">
            <IconButton
              aria-label="Remove"
              disabled={isDisabled}
              onClick={onRemove}
            >
              <Delete />
            </IconButton>
            <CommentButton
              disabled={isDisabled}
              onSubmit={onComment ?? (() => {})}
            />
          </Stack>
        )}
      </Stack>
      {dependencies.length > 0 && (
        <Typography variant="caption" sx={{ py: 1 }}>
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
        <Typography variant="caption" sx={{ py: 1 }}>
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
    </Stack>
  );
}

interface FragmentShellProps<Type extends StructuralFragment>
  extends StackProps {
  isDisabled: boolean;
  list: Type[];
  fragment: Type;
  onComment?: (parameters: { fragment: Type; comment: string }) => void;
  onRemove?: (parameters: { fragment: Type }) => void;
  showActions?: boolean;
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
  onRemove,
  showActions = true,
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
  const dependencies = [...fragment.dependencies].map((id) => {
    const linkedCode = store.getCode(id);
    return {
      id,
      href: linkedCode ? `#${linkedCode}` : "#",
      label: `${FRAGMENT_CODES[fragmentType]}-${
        list.findIndex(({ id: id_ }) => id_ === id) + 1
      }`,
    };
  });
  const references = [...fragment.references].map((reference) => ({
    id: reference.id,
    href: store.getPath(reference.id) ?? "#",
    label: store.getCode(reference.id) ?? reference.id,
  }));
  const isHighlighted = hash === code || hash === fragmentId;

  const handleRemove = () => {
    if (!isAlive(fragment)) return;
    onRemove?.({ fragment });
  };
  const handleComment = (comment: string) => {
    if (!isAlive(fragment)) return;
    onComment?.({ fragment, comment });
  };

  const frame = (
    <FragmentFrame
      code={code}
      type={fragmentType}
      priority={fragmentPriority}
      showActions={showActions}
      isDisabled={isDisabled}
      isHighlighted={isHighlighted}
      highlightSx={highlightSx}
      dependencies={dependencies}
      references={references}
      onRemove={handleRemove}
      onComment={handleComment}
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
  "&:not(:focus-within) fieldset": { border: "none" },
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
    showActions,
    store,
  }: {
    list: StructuralFragment[];
    isDisabled: boolean;
    showActions: boolean;
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
      label: `${FRAGMENT_CODES[fragmentType]}-${
        list.findIndex(({ id: id_ }) => id_ === id) + 1
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
      showActions={showActions}
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
  showActions: boolean,
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
      showActions={showActions}
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

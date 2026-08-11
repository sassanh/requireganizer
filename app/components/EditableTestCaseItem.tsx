import { Delete } from "@mui/icons-material";
import {
    Box,
    IconButton,
    Stack,
    StackProps,
    TextField,
    Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { Fragment, useEffect, useState } from "react";

import { FRAGMENT_CODES, Priority, useStore } from "store";
import { TestCase } from "store/models";

import CommentButton from "./CommentButton";
import Link from "./Link";

interface EditableTestCaseItemProps extends StackProps {
    isDisabled: boolean;
    list: TestCase[];
    fragment: TestCase;
    index: number;
    onComment: (paremeters: { fragment: TestCase; comment: string }) => void;
    onRemove: (paremeters: { fragment: TestCase }) => void;
}

const EditableTestCaseItem = ({
    children,
    isDisabled,
    list,
    fragment,
    index,
    onComment,
    onRemove,
    ...props
}: EditableTestCaseItemProps) => {
    const store = useStore();

    const [hash, setHash] = useState("");

    useEffect(() => {
        const onHashChanged = () => setHash(window.location.hash.replace(/^#/, ""));

        onHashChanged();

        const { pushState, replaceState } = window.history;
        window.history.pushState = function (...args) {
            pushState.apply(window.history, args);
            setTimeout(onHashChanged);
        };
        window.history.replaceState = function (...args) {
            replaceState.apply(window.history, args);
            setTimeout(onHashChanged);
        };

        window.addEventListener("hashchange", onHashChanged);
        return () => {
            window.removeEventListener("hashchange", onHashChanged);
        };
    }, []);

    const handleRemove = () => {
        onRemove({ fragment });
    };

    const handleComment = (comment: string) => {
        onComment({ fragment, comment });
    };

    const handleTitleChange = ({
        target: { value },
    }: React.ChangeEvent<HTMLTextAreaElement>) => {
        fragment.setTitle(value);
    };
    const handleStepsChange = ({
        target: { value },
    }: React.ChangeEvent<HTMLTextAreaElement>) => {
        fragment.setSteps(value);
    };
    const handleExpectedResultChange = ({
        target: { value },
    }: React.ChangeEvent<HTMLTextAreaElement>) => {
        fragment.setExpectedResult(value);
    };

    const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Escape") {
            event.currentTarget.blur();
        }
    };

    return (
        <Stack
            id={fragment.id}
            sx={[
                (theme) => ({
                    pl: 1, py: 1,
                    backgroundColor: fragment.testStatus === "generated"
                        ? (theme.palette.mode === "dark" ? "rgba(46, 125, 50, 0.15)" : "rgba(46, 125, 50, 0.08)")
                        : fragment.testStatus === "out-of-sync"
                            ? (theme.palette.mode === "dark" ? "rgba(237, 108, 2, 0.15)" : "rgba(237, 108, 2, 0.08)")
                            : "transparent",
                    transition: "background-color 0.2s"
                }),
                (theme) =>
                    hash === fragment.getCode() || hash === fragment.id
                        ? {
                            outline: `2px solid ${theme.palette.action.focus}`,
                        }
                        : {},
            ]}
            {...props}
        >
            <Stack
                direction="row"
                data-fragment={`${fragment.type}:${fragment.id}`}
                {...props}
            >
                <Typography
                    component={Link}
                    href={`#${fragment.getCode()}`}
                    underline="hover"
                    variant="body1"
                    sx={(theme) => ({
                        position: "relative",
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
                        }[fragment.priority ?? ""],
                    })}
                >
                    {fragment.getCode()}.
                </Typography>

                <Stack spacing={1} sx={{ flexGrow: 1 }}>
                    <TextField
                        multiline
                        fullWidth
                        onChange={handleTitleChange}
                        value={fragment.title}
                        disabled={isDisabled}
                        placeholder="Test Case Title"
                        size="small"
                        sx={{
                            "&:not(:focus-within) fieldset": { border: "none" },
                        }}
                        slotProps={{
                            input: {
                                onKeyUp: handleKeyUp,
                                sx: { pl: 9, fontWeight: 'bold' },
                            },
                        }}
                    />
                    <TextField
                        multiline
                        fullWidth
                        onChange={handleStepsChange}
                        value={fragment.steps}
                        disabled={isDisabled}
                        placeholder="Test Steps"
                        size="small"
                        sx={{
                            "&:not(:focus-within) fieldset": { border: "none" },
                        }}
                        slotProps={{
                            input: {
                                onKeyUp: handleKeyUp,
                                sx: { pl: 9 },
                            },
                        }}
                    />
                    <TextField
                        multiline
                        fullWidth
                        onChange={handleExpectedResultChange}
                        value={fragment.expectedResult}
                        disabled={isDisabled}
                        placeholder="Expected Result"
                        size="small"
                        sx={{
                            "&:not(:focus-within) fieldset": { border: "none" },
                        }}
                        slotProps={{
                            input: {
                                onKeyUp: handleKeyUp,
                                sx: { pl: 9, fontStyle: 'italic' },
                            },
                        }}
                    />
                </Stack>


                <Stack direction="row">
                    <IconButton disabled={isDisabled} onClick={handleRemove}>
                        <Delete />
                    </IconButton>
                    <CommentButton disabled={isDisabled} onSubmit={handleComment} />
                </Stack>
            </Stack>
            {fragment.dependencies.length > 0 && (
                <Typography variant="caption" sx={{
                    py: 1
                }}>
                    Dependencies:{" "}
                    {fragment.dependencies.map((id, index) => (
                        <Fragment key={id}>
                            <Link
                                scroll={false}
                                href={`#${store.getCode(id)}`}
                                underline="hover"
                            >
                                {FRAGMENT_CODES[fragment.type]}-
                                {list.findIndex(({ id: id_ }) => id_ === id) + 1}
                            </Link>
                            {index < fragment.dependencies.length - 1 ? ", " : ""}
                        </Fragment>
                    ))}
                </Typography>
            )}
            {fragment.references.length > 0 && (
                <Typography variant="caption" sx={{
                    py: 1
                }}>
                    References:{" "}
                    {fragment.references.map((reference, index) => (
                        <Fragment key={reference.id}>
                            <Link href={store.getPath(reference.id)} underline="hover">
                                {store.getCode(reference.id)}
                            </Link>
                            {index < fragment.references.length - 1 ? ", " : ""}
                        </Fragment>
                    ))}
                </Typography>
            )}
            {children != null ? <div>{children}</div> : null}
        </Stack>
    );
};

export default observer(EditableTestCaseItem);

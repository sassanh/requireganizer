export type DiffKind = "equal" | "delete" | "insert";
export type DiffHunk = { kind: DiffKind; text: string };

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "nor",
  "is",
  "it",
  "as",
  "at",
  "by",
  "be",
  "if",
  "so",
  "do",
  "from",
  "with",
  "that",
  "this",
  "these",
  "those",
  "are",
  "was",
  "were",
  "but",
  "not",
  "its",
  "into",
  "than",
  "then",
  "too",
  "via",
  "per",
  "up",
  "out",
]);

const MAX_TOKENS = 400;

/** Words and whitespace are separate tokens; words stay whole. */
export function tokenize(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

function isWhitespace(token: string): boolean {
  return /^\s+$/.test(token);
}

function foldedWord(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** A real word, not a glue word like "to" / "a" that makes noisy anchors. */
function isContentWord(token: string): boolean {
  if (isWhitespace(token)) return false;
  const folded = foldedWord(token);
  if (folded.length === 0) return false;
  if (STOPWORDS.has(folded)) return false;
  return folded.length >= 3;
}

function isWeakEqual(text: string): boolean {
  return !tokenize(text).some(isContentWord);
}

type TokenOp = { kind: DiffKind; token: string };

function lcsOps(before: string[], after: string[]): TokenOp[] {
  const n = before.length;
  const m = after.length;
  const dp: Uint16Array[] = Array.from(
    { length: n + 1 },
    () => new Uint16Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        before[i] === after[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: TokenOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: "equal", token: before[i]! });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "delete", token: before[i]! });
      i += 1;
    } else {
      ops.push({ kind: "insert", token: after[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: "delete", token: before[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: "insert", token: after[j]! });
    j += 1;
  }
  return ops;
}

function hunksFromOps(ops: TokenOp[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const op of ops) {
    const last = hunks[hunks.length - 1];
    if (last != null && last.kind === op.kind) {
      last.text += op.token;
    } else {
      hunks.push({ kind: op.kind, text: op.token });
    }
  }
  return hunks;
}

/** Short glue matches between edits become part of the surrounding replace
 * so a sentence does not shatter around a kept "to" or "a". */
function absorbWeakEquals(hunks: DiffHunk[]): DiffHunk[] {
  const absorbed: DiffHunk[] = [];
  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]!;
    if (hunk.kind !== "equal") {
      absorbed.push(hunk);
      continue;
    }
    const prev = hunks[i - 1];
    const next = hunks[i + 1];
    const bounded =
      prev != null &&
      next != null &&
      prev.kind !== "equal" &&
      next.kind !== "equal";
    if (bounded && isWeakEqual(hunk.text)) {
      absorbed.push({ kind: "delete", text: hunk.text });
      absorbed.push({ kind: "insert", text: hunk.text });
      continue;
    }
    absorbed.push(hunk);
  }
  return absorbed;
}

/** Collapse a run of deletes/inserts into one replace. */
function squeezeReplaces(hunks: DiffHunk[]): DiffHunk[] {
  const squeezed: DiffHunk[] = [];
  let i = 0;
  while (i < hunks.length) {
    const hunk = hunks[i]!;
    if (hunk.kind === "equal") {
      squeezed.push(hunk);
      i += 1;
      continue;
    }
    let deleted = "";
    let inserted = "";
    while (i < hunks.length && hunks[i]!.kind !== "equal") {
      const part = hunks[i]!;
      if (part.kind === "delete") deleted += part.text;
      else inserted += part.text;
      i += 1;
    }
    if (deleted.length > 0) squeezed.push({ kind: "delete", text: deleted });
    if (inserted.length > 0) squeezed.push({ kind: "insert", text: inserted });
  }
  return squeezed;
}

/**
 * Word-level diff that prefers readable hunks over the shortest edit.
 * Tokens are words (and the whitespace between them). Tiny glue words
 * that would pin a noisy match are absorbed into the surrounding change.
 */
export function wordDiff(before: string, after: string): DiffHunk[] {
  if (before === after) return [{ kind: "equal", text: before }];
  const oldTokens = tokenize(before);
  const newTokens = tokenize(after);
  if (
    oldTokens.length * newTokens.length > MAX_TOKENS * MAX_TOKENS ||
    oldTokens.length > MAX_TOKENS ||
    newTokens.length > MAX_TOKENS
  ) {
    const hunks: DiffHunk[] = [];
    if (before.length > 0) hunks.push({ kind: "delete", text: before });
    if (after.length > 0) hunks.push({ kind: "insert", text: after });
    return hunks;
  }
  return squeezeReplaces(absorbWeakEquals(hunksFromOps(lcsOps(oldTokens, newTokens))));
}

export function hunksHaveKind(hunks: DiffHunk[], kind: DiffKind): boolean {
  return hunks.some((hunk) => hunk.kind === kind);
}

export class InvalidJsonError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "InvalidJsonError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The value, checked to hold exactly the keys named: every required one, and
 * besides them only optional ones.
 */
export function exactRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidJsonError(`${label} must be an object.`);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new InvalidJsonError(`${label} has no ${key}.`);
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new InvalidJsonError(`${label} holds ${JSON.stringify(key)}, which Requireganizer does not store.`);
    }
  }
  return value;
}

/** The value, checked to be a text. */
export function readText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new InvalidJsonError(`${label} must be a text.`);
  return value;
}

/** The value, checked to be a list of texts. */
export function readTexts(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new InvalidJsonError(`${label} must be a list of texts.`);
  }
  return value;
}

/** The value, checked to be true or false. */
export function readFlag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new InvalidJsonError(`${label} must be true or false.`);
  return value;
}

export function stripJsoncComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let comment: "line" | "block" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (comment === "line") {
      if (character === "\n" || character === "\r") {
        comment = null;
        result += character;
      } else {
        result += " ";
      }
      continue;
    }

    if (comment === "block") {
      if (character === "*" && nextCharacter === "/") {
        result += "  ";
        comment = null;
        index += 1;
      } else {
        result += character === "\n" || character === "\r" ? character : " ";
      }
      continue;
    }

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === "/" && nextCharacter === "/") {
      comment = "line";
      result += "  ";
      index += 1;
    } else if (character === "/" && nextCharacter === "*") {
      comment = "block";
      result += "  ";
      index += 1;
    } else {
      result += character;
    }
  }

  if (comment === "block") {
    throw new InvalidJsonError("Invalid JSONC: unterminated block comment.");
  }

  return result;
}

function stripTrailingCommas(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(source[nextIndex] ?? "")) {
        nextIndex += 1;
      }
      if (source[nextIndex] === "}" || source[nextIndex] === "]") {
        continue;
      }
    }

    result += character;
  }

  return result;
}

function parse(source: string, label: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    // The parser's own message says where, such as "at position 12 (line 3 column 1)".
    const where = error instanceof Error ? `: ${error.message}.` : ".";
    throw new InvalidJsonError(`${label} is not valid JSON${where}`, error);
  }
}

export function parseJson(source: string, label = "Value"): unknown {
  return parse(source, label);
}

export function parseJsonc(source: string, label = "Value"): unknown {
  const withoutComments = stripJsoncComments(source);
  return parse(stripTrailingCommas(withoutComments), label);
}

export function expectRecord(
  value: unknown,
  label = "Value",
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidJsonError(`${label} must be a JSON object.`);
  }
  return value;
}

export function parseJsonObject(
  source: string,
  label = "Value",
): Record<string, unknown> {
  return expectRecord(parseJson(source, label), label);
}

export function parseJsoncObject(
  source: string,
  label = "Value",
): Record<string, unknown> {
  return expectRecord(parseJsonc(source, label), label);
}

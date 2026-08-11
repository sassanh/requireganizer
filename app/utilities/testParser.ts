interface CommentSyntax {
  prefix: string;
  suffix: string;
}

interface ScaffoldFileContent {
  path: string;
  content: string;
}

const HASH_COMMENT_LANGUAGES = new Set([
  "python",
  "ruby",
  "bash",
  "sh",
  "shell",
  "perl",
  "r",
  "yaml",
  "yml",
]);
const DASH_COMMENT_LANGUAGES = new Set(["sql", "haskell", "lua", "elm"]);
const MARKUP_COMMENT_LANGUAGES = new Set(["html", "xml", "svg", "vue"]);
const LISP_COMMENT_LANGUAGES = new Set(["lisp", "clojure", "scheme"]);

export function getCommentSyntax(language: string): CommentSyntax {
  const normalizedLanguage = language.toLowerCase().trim();

  if (HASH_COMMENT_LANGUAGES.has(normalizedLanguage)) {
    return { prefix: "#", suffix: "" };
  }
  if (DASH_COMMENT_LANGUAGES.has(normalizedLanguage)) {
    return { prefix: "--", suffix: "" };
  }
  if (MARKUP_COMMENT_LANGUAGES.has(normalizedLanguage)) {
    return { prefix: "<!--", suffix: "-->" };
  }
  if (LISP_COMMENT_LANGUAGES.has(normalizedLanguage)) {
    return { prefix: ";", suffix: "" };
  }
  return { prefix: "//", suffix: "" };
}

export function generateTestAnnotation(
  language: string,
  codeAndTitle: string,
  id: string,
  type: "beginning" | "end" | "scenario",
): string {
  const syntax = getCommentSyntax(language);
  const suffix = syntax.suffix ? ` ${syntax.suffix}` : "";
  return type === "scenario"
    ? `${syntax.prefix} TSC-SCENARIO - ${id}${suffix}`
    : `${syntax.prefix} ${codeAndTitle} - ${id} - ${type}${suffix}`;
}

export function findScenarioFiles(
  scaffoldFiles: ScaffoldFileContent[],
  scenarioId: string,
): ScaffoldFileContent[] {
  return scaffoldFiles.filter((file) =>
    file.content.includes(`TSC-SCENARIO - ${scenarioId}`),
  );
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTestCaseCode(
  scaffoldFiles: ScaffoldFileContent[],
  scenarioId: string,
  testCaseId: string,
  language: string,
): string | null {
  const [file] = findScenarioFiles(scaffoldFiles, scenarioId);
  if (!file) return null;

  const syntax = getCommentSyntax(language);
  const escapedPrefix = escapeRegularExpression(syntax.prefix);
  const escapedSuffix = syntax.suffix
    ? escapeRegularExpression(` ${syntax.suffix}`)
    : "";
  const escapedTestCaseId = escapeRegularExpression(testCaseId);
  const annotation = `${escapedPrefix}\\s*.*?\\s*-\\s*${escapedTestCaseId}`;
  const expression = new RegExp(
    `${annotation}\\s*-\\s*beginning${escapedSuffix}\\r?\\n` +
      `([\\s\\S]*?)${annotation}\\s*-\\s*end${escapedSuffix}`,
    "i",
  );
  const match = file.content.match(expression);
  return match?.[1]?.trim() || null;
}

export interface HydratableTestCase {
  id: string;
  lastGeneratedAt: number | null;
  lastModifiedAt: number;
  setLastGeneratedAt: (timestamp: number) => void;
}

export interface HydratableTestScenario {
  id: string;
  testCases: HydratableTestCase[];
}

export function hydrateMissingLastGeneratedAt(
  testScenarios: HydratableTestScenario[],
  scaffoldFiles: ScaffoldFileContent[],
  language: string,
): void {
  testScenarios.forEach((scenario) => {
    scenario.testCases.forEach((testCase) => {
      if (testCase.lastGeneratedAt != null) return;

      const code = extractTestCaseCode(
        scaffoldFiles,
        scenario.id,
        testCase.id,
        language,
      );
      if (code) {
        testCase.setLastGeneratedAt(testCase.lastModifiedAt || Date.now());
      }
    });
  });
}

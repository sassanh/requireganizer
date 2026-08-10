export const getCommentSyntax = (language: string): { prefix: string; suffix: string } => {
    const lang = language.toLowerCase().trim();

    // Hash style comments
    if (['python', 'ruby', 'bash', 'sh', 'shell', 'perl', 'r', 'yaml', 'yml'].includes(lang)) {
        return { prefix: '#', suffix: '' };
    }

    // Dash style comments
    if (['sql', 'haskell', 'lua', 'elm'].includes(lang)) {
        return { prefix: '--', suffix: '' };
    }

    // HTML/XML style
    if (['html', 'xml', 'svg', 'vue'].includes(lang)) {
        return { prefix: '<!--', suffix: '-->' };
    }

    // Lisp style
    if (['lisp', 'clojure', 'scheme'].includes(lang)) {
        return { prefix: ';', suffix: '' };
    }

    // Default to C-style double slashes
    return { prefix: '//', suffix: '' };
};

export const generateTestAnnotation = (
    language: string,
    codeAndTitle: string,
    uuid: string,
    type: 'beginning' | 'end' | 'scenario'
): string => {
    const syntax = getCommentSyntax(language);
    const suffix = syntax.suffix ? ` ${syntax.suffix}` : '';
    return type === 'scenario'
        ? `${syntax.prefix} TSC-SCENARIO - ${uuid}${suffix}`
        : `${syntax.prefix} ${codeAndTitle} - ${uuid} - ${type}${suffix}`;
};

export const findScenarioFile = (
    scaffoldFiles: { path: string; content: string }[],
    scenarioId: string
) => {
    return scaffoldFiles.filter(f => f.content.includes(`TSC-SCENARIO - ${scenarioId}`));
};

export const extractTestCaseCode = (
    scaffoldFiles: { path: string; content: string }[],
    scenarioId: string,
    testCaseId: string,
    language: string
): string | null => {
    // 1. Find the exact file with the in-file scenario UUID annotation
    const files = findScenarioFile(scaffoldFiles, scenarioId);
    if (files.length === 0) return null;
    const file = files[0];

    // 2. Build the precise Regex for the language's comment syntax
    const syntax = getCommentSyntax(language);

    // Escape prefix and suffix for Regex
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedPrefix = escapeRegex(syntax.prefix);
    const escapedSuffix = syntax.suffix ? escapeRegex(' ' + syntax.suffix) : '';

    // E.g., for JS: \/\/ .* - <uuid> - beginning\n([\s\S]*?)\/\/ .* - <uuid> - end
    const regexSource = `${escapedPrefix}\\s*.*?\\s*-\\s*${testCaseId}\\s*-\\s*beginning${escapedSuffix}\\n([\\s\\S]*?)${escapedPrefix}\\s*.*?\\s*-\\s*${testCaseId}\\s*-\\s*end${escapedSuffix}`;
    const regex = new RegExp(regexSource, 'i');

    const match = file.content.match(regex);
    if (match && match[1]) {
        return match[1].trim();
    }

    return null;
};

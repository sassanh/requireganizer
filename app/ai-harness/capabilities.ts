import { ProgrammingLanguage } from "store/constants";

export interface LanguageHarnessCapability {
  testFileSuffix: string;
}

export const LANGUAGE_HARNESS_CAPABILITIES: Record<
  ProgrammingLanguage,
  LanguageHarnessCapability
> = {
  [ProgrammingLanguage.C]: { testFileSuffix: ".test.c" },
  [ProgrammingLanguage.CPlusPlus]: { testFileSuffix: ".test.cpp" },
  [ProgrammingLanguage.CSharp]: { testFileSuffix: "Tests.cs" },
  [ProgrammingLanguage.Dart]: { testFileSuffix: "_test.dart" },
  [ProgrammingLanguage.Elixir]: { testFileSuffix: "_test.exs" },
  [ProgrammingLanguage.FSharp]: { testFileSuffix: "Tests.fs" },
  [ProgrammingLanguage.GDScript]: { testFileSuffix: ".test.gd" },
  [ProgrammingLanguage.Go]: { testFileSuffix: "_test.go" },
  [ProgrammingLanguage.Haxe]: { testFileSuffix: "Test.hx" },
  [ProgrammingLanguage.Java]: { testFileSuffix: "Test.java" },
  [ProgrammingLanguage.JavaScript]: { testFileSuffix: ".test.js" },
  [ProgrammingLanguage.Julia]: { testFileSuffix: "_test.jl" },
  [ProgrammingLanguage.Kotlin]: { testFileSuffix: "Test.kt" },
  [ProgrammingLanguage.Lua]: { testFileSuffix: "_spec.lua" },
  [ProgrammingLanguage.ObjectiveC]: { testFileSuffix: "Tests.m" },
  [ProgrammingLanguage.PHP]: { testFileSuffix: "Test.php" },
  [ProgrammingLanguage.Perl]: { testFileSuffix: ".t" },
  [ProgrammingLanguage.Python]: { testFileSuffix: "_test.py" },
  [ProgrammingLanguage.QML]: { testFileSuffix: "Test.qml" },
  [ProgrammingLanguage.R]: { testFileSuffix: "_test.R" },
  [ProgrammingLanguage.Racket]: { testFileSuffix: "_test.rkt" },
  [ProgrammingLanguage.Ruby]: { testFileSuffix: "_spec.rb" },
  [ProgrammingLanguage.Rust]: { testFileSuffix: "_test.rs" },
  [ProgrammingLanguage.Scala]: { testFileSuffix: "Spec.scala" },
  [ProgrammingLanguage.Shell]: { testFileSuffix: ".test.sh" },
  [ProgrammingLanguage.Swift]: { testFileSuffix: "Tests.swift" },
  [ProgrammingLanguage.TypeScript]: { testFileSuffix: ".test.ts" },
};

export function getScenarioTestPath(
  scenarioCode: string,
  scenarioId: string,
  language: ProgrammingLanguage,
): string {
  const stableName = `${scenarioCode.toLowerCase()}-${scenarioId.slice(0, 8)}`;
  return `tests/${stableName}${LANGUAGE_HARNESS_CAPABILITIES[language].testFileSuffix}`;
}

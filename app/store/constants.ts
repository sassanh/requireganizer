import { Store } from "./store";

export enum Environment {
  WebApplication = "web_application_frameworks",
  MobileApplication = "mobile_application_frameworks",
  DesktopApplication = "desktop_application_frameworks",
  EmbeddedDevice = "embedded_device_frameworks",
  MachineLearning = "machine_learning_frameworks",
  GameDevelopment = "game_development_frameworks",
}

export enum ProgrammingLanguage {
  C = "C",
  CPlusPlus = "C++",
  CSharp = "C#",
  Dart = "Dart",
  Elixir = "Elixir",
  FSharp = "F#",
  GDScript = "GDScript",
  Go = "Go",
  Haxe = "Haxe",
  Java = "Java",
  JavaScript = "JavaScript",
  Julia = "Julia",
  Kotlin = "Kotlin",
  Lua = "Lua",
  ObjectiveC = "Objective-C",
  PHP = "PHP",
  Perl = "Perl",
  Python = "Python",
  QML = "QML",
  R = "R",
  Racket = "Racket",
  Ruby = "Ruby",
  Rust = "Rust",
  Scala = "Scala",
  Shell = "Shell",
  Swift = "Swift",
  TypeScript = "TypeScript",
}

export enum Framework {
  ASPNETCore = "ASP.NET Core",
  Angular = "Angular",
  AppKit = "AppKit",
  Bash = "Bash",
  Caffe = "Caffe",
  CakePHP = "CakePHP",
  Cocoa = "Cocoa",
  Contiki = "Contiki",
  Django = "Django",
  Electron = "Electron",
  EmberJS = "EmberJS",
  ExpressJS = "ExpressJS",
  Fable = "Fable",
  Flask = "Flask",
  Flutter = "Flutter",
  Framework7 = "Framework7",
  GTK = "GTK",
  GatsbyJS = "GatsbyJS",
  Godot = "Godot",
  HaxeFlixel = "Haxe Flixel",
  Ionic = "Ionic",
  JavaFX = "JavaFX",
  Keras = "Keras",
  Kivy = "Kivy",
  KotlinMultiplatformMobile = "Kotlin Multiplatform Mobile",
  Laravel = "Laravel",
  Love2D = "Love2D",
  MXNet = "MXNet",
  MicroPython = "MicroPython",
  Mojolicious = "Mojolicious",
  NativeScript = "NativeScript",
  NestJS = "NestJS",
  NextJS = "NextJS",
  NuxtJS = "NuxtJS",
  Phoenix = "Phoenix",
  PlayFramework = "Play Framework",
  PyQt = "PyQt",
  PyTorch = "PyTorch",
  Qt = "Qt",
  QuasarFramework = "Quasar Framework",
  RIOTOS = "RIOT OS",
  RacketGUI = "Racket GUI",
  React = "React",
  ReactNative = "React Native",
  RubyOnRails = "Ruby on Rails",
  SDL = "SDL",
  SFML = "SFML",
  ScikitLearn = "Scikit-Learn",
  SpringBoot = "Spring Boot",
  Svelte = "Svelte",
  SwiftUI = "SwiftUI",
  Swing = "Swing",
  Symfony = "Symfony",
  TensorFlow = "TensorFlow",
  Theano = "Theano",
  Tkinter = "Tkinter",
  Tock = "Tock",
  TornadoFX = "TornadoFX",
  UWP = "UWP",
  VueJS = "VueJS",
  WPF = "WPF",
  WinForms = "WinForms",
  Xamarin = "Xamarin",
  Zephyr = "Zephyr",
  Zsh = "Zsh",
  wxWidgets = "wxWidgets",
}

export const FRAMEWORKS_BY_PROGRAMMING_LANGUAGE = {
  [ProgrammingLanguage.JavaScript]: [
    Framework.Angular,
    Framework.React,
    Framework.VueJS,
    Framework.EmberJS,
    Framework.ExpressJS,
    Framework.NextJS,
    Framework.NuxtJS,
    Framework.GatsbyJS,
    Framework.Svelte,
    Framework.Electron,
    Framework.Ionic,
    Framework.NativeScript,
    Framework.ReactNative,
    Framework.Framework7,
    Framework.QuasarFramework,
  ],
  [ProgrammingLanguage.TypeScript]: [
    Framework.Angular,
    Framework.React,
    Framework.VueJS,
    Framework.EmberJS,
    Framework.ExpressJS,
    Framework.NextJS,
    Framework.NuxtJS,
    Framework.GatsbyJS,
    Framework.Svelte,
    Framework.Electron,
    Framework.Ionic,
    Framework.NativeScript,
    Framework.ReactNative,
    Framework.Framework7,
    Framework.QuasarFramework,
  ],
  [ProgrammingLanguage.Python]: [
    Framework.Django,
    Framework.Flask,
    Framework.PyQt,
    Framework.Kivy,
    Framework.Tkinter,
    Framework.PyTorch,
    Framework.TensorFlow,
    Framework.Theano,
    Framework.Caffe,
    Framework.MXNet,
    Framework.ScikitLearn,
    Framework.Keras,
    Framework.MicroPython,
  ],
  [ProgrammingLanguage.Ruby]: [Framework.RubyOnRails],
  [ProgrammingLanguage.PHP]: [
    Framework.Laravel,
    Framework.Symfony,
    Framework.CakePHP,
  ],
  [ProgrammingLanguage.Java]: [
    Framework.SpringBoot,
    Framework.PlayFramework,
    Framework.JavaFX,
    Framework.Swing,
  ],
  [ProgrammingLanguage.Scala]: [Framework.PlayFramework],
  [ProgrammingLanguage.Kotlin]: [
    Framework.KotlinMultiplatformMobile,
    Framework.TornadoFX,
  ],
  [ProgrammingLanguage.Swift]: [
    Framework.SwiftUI,
    Framework.Cocoa,
    Framework.AppKit,
  ],
  [ProgrammingLanguage.CSharp]: [
    Framework.ASPNETCore,
    Framework.WinForms,
    Framework.WPF,
    Framework.UWP,
    Framework.Xamarin,
  ],
  [ProgrammingLanguage.Rust]: [
    Framework.Tock,
    Framework.RIOTOS,
    Framework.Zephyr,
    Framework.Contiki,
  ],
  [ProgrammingLanguage.ObjectiveC]: [Framework.Cocoa, Framework.AppKit],
  [ProgrammingLanguage.C]: [
    Framework.GTK,
    Framework.SDL,
    Framework.Qt,
    Framework.wxWidgets,
  ],
  [ProgrammingLanguage.CPlusPlus]: [
    Framework.Qt,
    Framework.SDL,
    Framework.SFML,
    Framework.GTK,
    Framework.wxWidgets,
  ],
  [ProgrammingLanguage.Go]: [Framework.NestJS],
  [ProgrammingLanguage.Elixir]: [Framework.Phoenix],
  [ProgrammingLanguage.Julia]: [Framework.MXNet],
  [ProgrammingLanguage.R]: [Framework.TensorFlow],
  [ProgrammingLanguage.Lua]: [Framework.Love2D],
  [ProgrammingLanguage.Haxe]: [Framework.HaxeFlixel],
  [ProgrammingLanguage.GDScript]: [Framework.Godot],
  [ProgrammingLanguage.QML]: [Framework.Qt],
  [ProgrammingLanguage.Dart]: [Framework.Flutter],
  [ProgrammingLanguage.FSharp]: [Framework.Fable],
  [ProgrammingLanguage.Shell]: [Framework.Bash, Framework.Zsh],
  [ProgrammingLanguage.Perl]: [Framework.Mojolicious],
  [ProgrammingLanguage.Racket]: [Framework.RacketGUI],
};

export const PROGRAMMING_LANGUAGE_BY_FRAMEWORK: {
  [key in Framework]: ProgrammingLanguage[];
} = {
  [Framework.Angular]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.React]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.VueJS]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.EmberJS]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.ExpressJS]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.NextJS]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.NuxtJS]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.GatsbyJS]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.Svelte]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.Electron]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.Ionic]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.NativeScript]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.ReactNative]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.Framework7]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.QuasarFramework]: [
    ProgrammingLanguage.JavaScript,
    ProgrammingLanguage.TypeScript,
  ],
  [Framework.Django]: [ProgrammingLanguage.Python],
  [Framework.Flask]: [ProgrammingLanguage.Python],
  [Framework.PyQt]: [ProgrammingLanguage.Python],
  [Framework.Kivy]: [ProgrammingLanguage.Python],
  [Framework.Tkinter]: [ProgrammingLanguage.Python],
  [Framework.TornadoFX]: [ProgrammingLanguage.Kotlin],
  [Framework.PyTorch]: [ProgrammingLanguage.Python],
  [Framework.TensorFlow]: [ProgrammingLanguage.Python, ProgrammingLanguage.R],
  [Framework.Theano]: [ProgrammingLanguage.Python],
  [Framework.Caffe]: [ProgrammingLanguage.Python],
  [Framework.MXNet]: [ProgrammingLanguage.Python, ProgrammingLanguage.Julia],
  [Framework.ScikitLearn]: [ProgrammingLanguage.Python],
  [Framework.Keras]: [ProgrammingLanguage.Python],
  [Framework.MicroPython]: [ProgrammingLanguage.Python],
  [Framework.RubyOnRails]: [ProgrammingLanguage.Ruby],
  [Framework.Laravel]: [ProgrammingLanguage.PHP],
  [Framework.Symfony]: [ProgrammingLanguage.PHP],
  [Framework.CakePHP]: [ProgrammingLanguage.PHP],
  [Framework.SpringBoot]: [ProgrammingLanguage.Java],
  [Framework.PlayFramework]: [
    ProgrammingLanguage.Java,
    ProgrammingLanguage.Scala,
  ],
  [Framework.JavaFX]: [ProgrammingLanguage.Java],
  [Framework.Swing]: [ProgrammingLanguage.Java],
  [Framework.KotlinMultiplatformMobile]: [ProgrammingLanguage.Kotlin],
  [Framework.SwiftUI]: [ProgrammingLanguage.Swift],
  [Framework.Cocoa]: [
    ProgrammingLanguage.Swift,
    ProgrammingLanguage.ObjectiveC,
  ],
  [Framework.AppKit]: [
    ProgrammingLanguage.Swift,
    ProgrammingLanguage.ObjectiveC,
  ],
  [Framework.ASPNETCore]: [ProgrammingLanguage.CSharp],
  [Framework.WinForms]: [ProgrammingLanguage.CSharp],
  [Framework.WPF]: [ProgrammingLanguage.CSharp],
  [Framework.UWP]: [ProgrammingLanguage.CSharp],
  [Framework.Xamarin]: [ProgrammingLanguage.CSharp],
  [Framework.Tock]: [ProgrammingLanguage.Rust],
  [Framework.RIOTOS]: [ProgrammingLanguage.Rust],
  [Framework.Zephyr]: [ProgrammingLanguage.Rust],
  [Framework.Contiki]: [ProgrammingLanguage.Rust],
  [Framework.GTK]: [ProgrammingLanguage.C, ProgrammingLanguage.CPlusPlus],
  [Framework.SDL]: [ProgrammingLanguage.C, ProgrammingLanguage.CPlusPlus],
  [Framework.Qt]: [
    ProgrammingLanguage.C,
    ProgrammingLanguage.CPlusPlus,
    ProgrammingLanguage.QML,
  ],
  [Framework.wxWidgets]: [ProgrammingLanguage.C, ProgrammingLanguage.CPlusPlus],
  [Framework.SFML]: [ProgrammingLanguage.CPlusPlus],
  [Framework.NestJS]: [ProgrammingLanguage.Go],
  [Framework.Phoenix]: [ProgrammingLanguage.Elixir],
  [Framework.Love2D]: [ProgrammingLanguage.Lua],
  [Framework.HaxeFlixel]: [ProgrammingLanguage.Haxe],
  [Framework.Godot]: [ProgrammingLanguage.GDScript],
  [Framework.Flutter]: [ProgrammingLanguage.Dart],
  [Framework.Fable]: [ProgrammingLanguage.FSharp],
  [Framework.Bash]: [ProgrammingLanguage.Shell],
  [Framework.Zsh]: [ProgrammingLanguage.Shell],
  [Framework.Mojolicious]: [ProgrammingLanguage.Perl],
  [Framework.RacketGUI]: [ProgrammingLanguage.Racket],
};

export enum Step {
  Description = "description",
  ProductOverview = "product-overview",
  Requirements = "requirements",
  UserStories = "user-stories",
  AcceptanceCriteria = "acceptance-criteria",
  TestScenarios = "test-scenarios",
  TestCases = "test-cases",
  TestCode = "test-code",
  MainCode = "main-code",
}
export const STEPS = Object.values(Step);
export const STEP_LABELS: { [key in Step]: string } = {
  [Step.Description]: "Description",
  [Step.ProductOverview]: "Product Overview",
  [Step.Requirements]: "Requirements",
  [Step.UserStories]: "User Stories",
  [Step.AcceptanceCriteria]: "Acceptance Criteria",
  [Step.TestScenarios]: "Test Scenarios",
  [Step.TestCases]: "Test Cases",
  [Step.TestCode]: "Test Code",
  [Step.MainCode]: "Main Code",
};
export const LAST_STEP = Step.TestCases;

export function isBefore(step1: Step, step2: Step) {
  return STEPS.indexOf(step1) < STEPS.indexOf(step2);
}

export function isAfter(step1: Step, step2: Step) {
  return STEPS.indexOf(step1) > STEPS.indexOf(step2);
}

export enum StructuralFragment {
  PrimaryFeature = "primary_feature",
  TargetUser = "target_user",
  Requirement = "requirement",
  UserStory = "user_story",
  AcceptanceCriteria = "acceptance_criteria",
  TestScenario = "test_scenario",
  TestCase = "test_case",
  TestCode = "test_code",
}

export const STRUCTURAL_FRAGMENT_LABEL: {
  [key in StructuralFragment]: string;
} = {
  [StructuralFragment.PrimaryFeature]: "Primary Feature",
  [StructuralFragment.TargetUser]: "Target User",
  [StructuralFragment.Requirement]: "Requirement",
  [StructuralFragment.UserStory]: "User Story",
  [StructuralFragment.AcceptanceCriteria]: "Acceptance Criteria",
  [StructuralFragment.TestScenario]: "Test Scenario",
  [StructuralFragment.TestCase]: "Test Case",
  [StructuralFragment.TestCode]: "Test Code",
};

export const STEP_BY_STRUCTURAL_FRAGMENT: {
  [key in StructuralFragment]: Step;
} = {
  [StructuralFragment.PrimaryFeature]: Step.ProductOverview,
  [StructuralFragment.TargetUser]: Step.ProductOverview,
  [StructuralFragment.Requirement]: Step.Requirements,
  [StructuralFragment.UserStory]: Step.UserStories,
  [StructuralFragment.AcceptanceCriteria]: Step.AcceptanceCriteria,
  [StructuralFragment.TestScenario]: Step.TestScenarios,
  [StructuralFragment.TestCase]: Step.TestCases,
  [StructuralFragment.TestCode]: Step.TestCode,
};
export const STRUCTURAL_FRAGMENT_BY_STEP: {
  [key in Exclude<Step, Step.Description | Step.MainCode>]:
    | StructuralFragment
    | StructuralFragment[];
} = {
  [Step.ProductOverview]: [
    StructuralFragment.PrimaryFeature,
    StructuralFragment.TargetUser,
  ],
  [Step.Requirements]: StructuralFragment.Requirement,
  [Step.UserStories]: StructuralFragment.UserStory,
  [Step.AcceptanceCriteria]: StructuralFragment.AcceptanceCriteria,
  [Step.TestScenarios]: StructuralFragment.TestScenario,
  [Step.TestCases]: StructuralFragment.TestCase,
  [Step.TestCode]: StructuralFragment.TestCode,
};

export enum EngineerRole {
  RequirementsEngineer = "requirements-engineer",
  SoftwareTestEngineer = "software-test-engineer",
  SoftwareDeveloper = "software-developer",
}

export const ENGINEER_ROLE_LABELS: {
  [key in EngineerRole]: string;
} = {
  [EngineerRole.RequirementsEngineer]: "Requirements Engineer",
  [EngineerRole.SoftwareTestEngineer]: "Software Test Engineer",
  [EngineerRole.SoftwareDeveloper]: "Software Developer",
};

export const ENGINEER_ROLE_BY_STEP: {
  [key in Step]: EngineerRole[];
} = {
  [Step.Description]: [EngineerRole.RequirementsEngineer],
  [Step.ProductOverview]: [EngineerRole.RequirementsEngineer],
  [Step.Requirements]: [EngineerRole.RequirementsEngineer],
  [Step.UserStories]: [EngineerRole.RequirementsEngineer],
  [Step.AcceptanceCriteria]: [
    EngineerRole.RequirementsEngineer,
    EngineerRole.SoftwareTestEngineer,
  ],
  [Step.TestScenarios]: [EngineerRole.SoftwareTestEngineer],
  [Step.TestCases]: [EngineerRole.SoftwareTestEngineer],
  [Step.TestCode]: [EngineerRole.SoftwareDeveloper],
  [Step.MainCode]: [EngineerRole.SoftwareDeveloper],
};

export const GENERATOR_ACTION_BY_STEP: {
  [key in Step]: Extract<keyof Store, `generate${string}`> | null;
} = {
  [Step.Description]: null,
  [Step.ProductOverview]: "generateProductOverview",
  [Step.Requirements]: "generateRequirements",
  [Step.UserStories]: "generateUserStories",
  [Step.AcceptanceCriteria]: "generateAcceptanceCriteria",
  [Step.TestScenarios]: "generateTestScenarios",
  [Step.TestCases]: "generateTestCases",
  [Step.TestCode]: null,
  [Step.MainCode]: null,
};

export const FRAGMENT_CODES: { [key in StructuralFragment]: string } = {
  [StructuralFragment.PrimaryFeature]: "FEA",
  [StructuralFragment.TargetUser]: "USR",
  [StructuralFragment.Requirement]: "REQ",
  [StructuralFragment.UserStory]: "US",
  [StructuralFragment.AcceptanceCriteria]: "AC",
  [StructuralFragment.TestScenario]: "TSC",
  [StructuralFragment.TestCase]: "TCS",
  [StructuralFragment.TestCode]: "TCD",
};

export enum Priority {
  Low = "low",
  Medium = "medium",
  High = "high",
}

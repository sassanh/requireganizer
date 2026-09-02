# Artifact contracts

Every generated artifact has a stable artifact ID and, where approval matters, an immutable revision ID. Downstream artifacts name the exact revisions they consume. Application-owned IDs, revision metadata, timestamps, hashes, and output paths are never accepted from a model proposal unless the operation explicitly requires an existing allowed identity.

## Boundary Design

`BoundaryDesign` records the exact Requirements and Acceptance Criteria set fingerprints it consumes.

| Field | Contract |
| --- | --- |
| `rootSubjectId` | Identifies the mandatory root product subject. The root has no parent and is not internal. |
| `subjects` | Define purpose, responsibilities, exclusions, classification, containment, lifecycle, and upstream justification. Internal subjects require a requirement or criterion. |
| `interfaces` | Belong to one subject and declare peer, visibility, direction, interaction style, and exact owned interactions. |
| `interactions` | Belong to one interface and declare semantic input, output, failures, state effects, requirements, and criteria. |
| `verificationObligations` | Represent performance, security, accessibility, compatibility, static-analysis, or manual-evidence work that is not an ordinary behavioral interaction. |
| `coverage` | Maps every acceptance criterion to a claimed interaction or verification obligation. Missing or inconsistent mappings invalidate the graph. |

Draft subject names, purposes, and interface names are directly editable. Structural changes use a graph-level reconciliation request. Approval reruns complete graph validation.

## Implementation Profile

The profile binds one Boundary Design revision and contains open-ended platform, runtime, language, framework, module/target system, build ecosystem, test ecosystem, and constraint text. It does not define product behavior. A profile must be approved before formal contracts are generated.

## Interface contract bundle

Each semantic interface has one bundle:

- `AdapterProgram` defines a stable adapter ID/version, notation and rationale, formalization/revision instructions, and bounded JSON Schemas for formal-contract and trace-event data.
- `FormalInterfaceContract` contains native declarations where suitable, or a neutral typed manifest. Every native document has a safe logical path, media type, exact content, and application-computed SHA-256.
- `NormalizedInterfaceIndex` maps every semantic interaction exactly once to a stable operation ID, input schema, declared output/error schemas, and native document anchors.

The adapter schemas use local references only, an allowlisted keyword set, bounded size/depth/node/property counts, and resource-safe patterns. `@cfworker/json-schema` performs authoritative instance validation. Provider-facing schemas are conservative projections and do not replace runtime validation.

## Subject and verification contracts

Each subject has one `SubjectContractBundle`:

- `SubjectProtocolContract` defines initial state, states, transitions, normalized outcomes, and cross-interface ordering rules.
- `HarnessBindingContract` defines module/target identity, how to obtain and reset a fresh subject, the initial-fixture schema, and exact invocation/observation bindings for every owned interaction.

Each verification obligation has one `VerificationContract` with environment, stimulus, evidence schema, and portable pass matchers. Interface, subject, and verification bundles require separate approval.

## Scenarios and cases

A behavioral scenario binds one subject, one or more approved interfaces owned by that subject, and exact Boundary Design, interface-contract, and subject-contract revisions. A verification scenario binds one obligation and verification-contract revision. Claimed criteria must belong to the bound interfaces or obligation.

A behavioral case contains one initial fixture and an ordered trace. Input events introduce unique correlation aliases. Output, error, and bounded-silence observations correlate to an earlier matching input; unsolicited events may omit correlation. Captures use JSON Pointer and can be referenced only by later inputs. Payloads, outcomes, fixtures, and adapter events validate against approved schemas. Portable matchers are exact, schema, presence/absence, subset, range, regex, or unordered-list.

A verification case uses the formal contract's exact environment, stimulus, and pass matchers, and declares the evidence to collect. Human-readable steps and expected results are rendered from the structured definition.

## Project Setup and Automated Tests

`ProjectSetup` binds exact boundary, profile, suite, and structured-test fingerprints. Its manifest declares module names, source/test roots, byte-for-byte contract placements, one test target per scenario, and one unimplemented subject-binding seam per subject. Binding seam files contain `REQUIREGANIZER_UNIMPLEMENTED_BINDING`; scaffold generation does not provide product behavior.

Automated-test generation receives the exact structured case, scenario binding, approved contract subset, adapter identities, configuration, and manifest target. The server independently verifies those values and controls the output path. Each generated case has its own input fingerprint, so changing one test file does not stale Project Setup.

## Project schema and recovery

Project exports use schema version 3. Imports with another schema version are rejected with the reason shown to the user. Imports rerun graph, schema, revision, dependency, coverage, contract, case, and scaffold validation before replacing live state.

Before an upstream revision invalidates completed downstream work, Requireganizer presents the affected artifacts and saves a complete recovery snapshot. Stale artifacts remain readable but cannot be used for generation. IndexedDB retains the latest 20 unpinned snapshots per project and every pinned snapshot.

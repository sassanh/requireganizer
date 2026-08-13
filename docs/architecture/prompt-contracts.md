# Prompt and function contracts

## Stable prefix

The prompt order is intentionally stable:

1. fixed security and harness rules;
2. canonical workflow and operation rules;
3. approved adapter instructions and identities;
4. approved revisioned artifacts;
5. changing project context, target, feedback, and repair data.

This maximizes the common prefix available to provider-side prompt caching. Cache reads and writes remain provider capabilities; Requireganizer reports the usage fields a provider returns and does not claim a cache hit when none is reported.

## Operation tools

Boundary Design, Implementation Profile, Interface Contracts, Test Scenarios, Test Cases, Project Setup, and Automated Tests each use a separate result function. The server controls operation scope, current revision context, and output paths. `communicate` is the only alternate tool.

Function definitions constrain transport shape. Application validators enforce ownership, coverage, approval, revision identity, schema safety, graph consistency, capture causality, contract hashes, manifest paths, and exact test-block preservation.

## Untrusted context

Project text, approved artifacts, adapter programs, existing files, feedback, previous calls, and validation errors are serialized as untrusted data. They do not override the fixed system policy or selected function contract.

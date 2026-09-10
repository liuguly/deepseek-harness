## Purpose

Turns template-mode documents into searchable question-authoring knowledge: document-level metadata, a document-level question template, extracted existing questions, and a per-question variant-generation template, each carrying refined metadata and one of five difficulty levels.

## ADDED Requirements

### Requirement: Document-level metadata distillation
The system SHALL distill concise metadata from the document name and content — subject, topic, question type, knowledge points, and keywords required; grade level, year, and source inferred when present — once per document, share it across all template artifacts of that document, and refine per-question fields during per-question processing.

#### Scenario: Metadata derived from title
- **WHEN** a document named "2024年高考数学真题" is ingested in template mode
- **THEN** the distilled metadata includes subject, year, and source consistent with the title and content

### Requirement: Document-level question template
The system SHALL generate one structured question template per template-mode document — question types, knowledge points, difficulty distribution, generation rules, and at most five sample questions — validating the model output and retrying once before failing the document.

#### Scenario: Invalid model JSON
- **WHEN** the model returns malformed JSON for the document template and the retry also fails
- **THEN** the document enters the `failed` state naming template generation as the cause

### Requirement: Question extraction
The system SHALL extract existing questions from the document in bounded windows — stem, options, answer, analysis, knowledge points, source location, and an assessed difficulty — deduplicate them, cap the total, and isolate a per-question extraction failure without failing the document.

#### Scenario: Extraction cap
- **WHEN** a document contains more questions than the configured maximum
- **THEN** extraction stops at the cap and the document reaches `ready` with the capped question count

### Requirement: Per-question variant template
The system SHALL generate for each extracted question a variant template containing the question pattern, variable slots, invariants, solution strategy, knowledge points, one difficulty of `easy`/`normal`/`hard`/`hell`/`nightmare`, inherited-and-refined metadata, and a reusable generation prompt with a difficulty placeholder; a per-question failure SHALL mark only that question.

#### Scenario: Difficulty restricted to five levels
- **WHEN** the model returns a difficulty outside the five enumerated levels and the retry also fails
- **THEN** only that question's template generation fails and the remaining questions complete

### Requirement: Variant generation from a template
The system SHALL generate a requested number of variant questions from one question template using its generation prompt with an optional target difficulty (defaulting to the template's own difficulty), and SHALL archive each generated variant linked to its template with inherited metadata and an assessed difficulty.

#### Scenario: Variants generated at target difficulty
- **WHEN** three variants are requested from a template with target difficulty `hell`
- **THEN** three variant questions are generated, archived under that template, and retrievable

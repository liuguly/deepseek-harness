## Purpose

Renders the personal knowledge workbench inside the Web settings surface: a two-pane layout with a persistent upload area, a document library, and a search pane with difficulty filters and in-card variant generation.

## ADDED Requirements

### Requirement: Two-pane workbench section
The system SHALL present a `knowledge` section in the settings surface with an upload area at top and a two-pane body — document library left, search right — collapsing to stacked panes on narrow viewports, with copy provided through the locale dictionaries in Chinese and English.

#### Scenario: Section appears in settings
- **WHEN** the web GUI opens settings with the workbench composition mounted
- **THEN** a knowledge section is listed alongside the built-in sections and renders the workbench

### Requirement: Upload queue feedback
The system SHALL let the user pick or drop files, choose the ingest mode, and observe per-file progress through the ingest states including failure reason and single-file retry.

#### Scenario: Failed upload retried
- **WHEN** an upload fails during ingest and the user retries that file
- **THEN** the document re-enters the pipeline and the queue reflects the new attempt

### Requirement: Document library actions
The system SHALL list documents with mode, state, artifact counts, and time; support filtering by mode and name; delete with confirmation; re-ingest; and filter the search pane to one document on selection.

#### Scenario: Delete requires confirmation
- **WHEN** the user requests deletion of a document
- **THEN** the workbench asks for confirmation before the document and its artifacts are removed

### Requirement: Difficulty filters and result cards
The system SHALL offer a five-level difficulty filter (简单/普通/困难/地狱/噩梦 as localized labels over stable internal codes) alongside kind filters, and SHALL render results as kind-specific cards showing score, difficulty badge, and metadata labels.

#### Scenario: Filter chips narrow results
- **WHEN** the user selects difficulty levels 普通 and 困难 and searches
- **THEN** only results whose difficulty is one of the selected levels are shown

### Requirement: In-card variant generation
The system SHALL provide variant generation on each question-template card with a count and target difficulty (defaulting to the template's difficulty), show progress while generating, render generated variants in place, archive them, and expose prior variants per template.

#### Scenario: Generate from a card
- **WHEN** the user requests three variants at difficulty 地狱 from a question-template card
- **THEN** three variants appear on that card and remain available under its history on later visits

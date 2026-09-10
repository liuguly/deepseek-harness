## Purpose

Ingests uploaded documents into the knowledge base: the upload moment selects the pipeline mode, parsing extracts text per format, chunking splits content, tokenization records CJK word tokens, and a durable state machine tracks every document to ready or failed.

## ADDED Requirements

### Requirement: Upload-time mode selection
The system SHALL accept document uploads with an explicit mode chosen at upload time: `knowledge` (tokenized chunk knowledge base) or `template` (question-template pipeline), and SHALL route the document through the pipeline of the selected mode only.

#### Scenario: Knowledge-mode upload
- **WHEN** a document is uploaded with mode `knowledge`
- **THEN** the document is parsed, chunked, tokenized, embedded, and stored as chunks without running any template generation

#### Scenario: Template-mode upload
- **WHEN** a document is uploaded with mode `template`
- **THEN** the document runs the template pipeline and stores no chunks

### Requirement: Document parsing by format
The system SHALL extract text from Markdown, plain text, PDF (text layer), DOCX (heading structure preserved), and HTML (script/style stripped, heading structure preserved) uploads, and SHALL reject empty or oversized uploads with an explicit error.

#### Scenario: PDF without text layer
- **WHEN** an uploaded PDF yields no extractable text (scanned document)
- **THEN** the document enters the `failed` state with an error naming the missing text layer

### Requirement: Chunking and tokenization
The system SHALL split knowledge-mode documents into chunks within configured size bounds — heading-structure-aware when the source preserves headings, recursive with overlap otherwise — and SHALL store Chinese-aware word tokens (capped) with each chunk for display and future hybrid retrieval.

#### Scenario: Structured markdown chunking
- **WHEN** a markdown document with headings is ingested in knowledge mode
- **THEN** chunk boundaries prefer heading boundaries and small sections are merged up to the target chunk size

### Requirement: Durable ingest state machine
The system SHALL track each document through `staged`, `parsing`, `chunking`, `embedding`, `generating`, `ready`, or `failed` with the failure reason persisted, SHALL surface state to the Web client, and SHALL mark transient-state documents `failed` with reason `interrupted by restart` when the process restarts.

#### Scenario: Failure reason visible
- **WHEN** a template-mode document fails because the model returned invalid JSON twice
- **THEN** the document state is `failed` and its stored error names the cause

#### Scenario: Interrupted by restart
- **WHEN** the harness restarts while a document is in a transient state
- **THEN** the document is marked `failed` with the interruption reason and can be re-ingested

### Requirement: Upload deduplication
The system SHALL recognize a re-upload of identical content by content hash and SHALL return the existing document while offering an explicit re-ingest action that replaces prior artifacts.

#### Scenario: Duplicate upload
- **WHEN** a file whose content hash already exists is uploaded again
- **THEN** the existing document is returned instead of creating a second record

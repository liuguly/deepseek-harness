## Purpose

Provides retrieval over the knowledge base: vector similarity over chunks and template artifacts with structured filters, so stored content and distilled metadata are both findable.

## ADDED Requirements

### Requirement: Vector similarity search
The system SHALL embed the query and return the nearest stored chunks or template artifacts by cosine similarity, each result carrying its score, source document title, artifact kind, difficulty when present, and content or structured payload.

#### Scenario: Natural language retrieval
- **WHEN** a user searches with a natural-language question after ingesting matching documents
- **THEN** results are ordered by similarity score and identify their source documents

### Requirement: Structured filters
The system SHALL support filtering search results by artifact kind, document mode, difficulty level, and source document, combining any subset.

#### Scenario: Difficulty-filtered search
- **WHEN** a search is issued with difficulty `hell` and kind `question_template`
- **THEN** only question templates assessed `hell` are returned

### Requirement: Metadata contributes to retrieval
The system SHALL compose each template artifact's embedding text from its distilled metadata summary together with its pattern, constraints, and knowledge points, so documents and questions are findable by document name, subject, knowledge point, and keywords.

#### Scenario: Find by document-name term
- **WHEN** the search query contains a term that appears in the source document name but not in a question's stem
- **THEN** the question's artifacts remain discoverable through the metadata in their embedding text

### Requirement: Query failure surfaces
The system SHALL report a query-embedding or storage failure to the caller as an explicit error without altering stored data.

#### Scenario: Embedding endpoint unavailable
- **WHEN** the embedding endpoint rejects the query embedding request
- **THEN** the search call fails with an error naming the cause and no results are returned

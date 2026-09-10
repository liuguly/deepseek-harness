---
description: "Browser half of the personal knowledge workbench: the settings-section two-pane workbench with upload queue, document library, search filters, and variant generation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

This package renders the knowledge workbench in two additive surfaces: a `settings.section` occupant alongside the built-in settings sections, and a frame-wide overlay panel (a `shell.overlay` entry) opened from a `sidebar.footer.action` button; both share one controller. The layout is an upload bar on top and a two-pane body —ocument library left, search right —ollapsing to stacked panes on narrow viewports. Search supports kind filters and the five difficulty levels (简单/普通/困难/地狱/噩梦 as localized labels over stable codes), and each question-template card generates variants with a count and target difficulty.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- id: ui-workbench
  name: '@deepseek-ai/dsh-client-ui-workbench'
```

The host half must provide the `/api/knowledge.*` routes (the `workbench-knowledge` row). Rebuild the client bundle before probing a live server: the registry serves `lib/client.js`, not sources.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Locale registration and the `settings.section` slot contribution |
| [`src/client/api.ts`](src/client/api.ts) | Hand-typed wire calls; XHR upload with progress |
| [`src/client/store.ts`](src/client/store.ts) | The controller: snapshot store plus actions over the API |
| [`src/client/WorkbenchSection.tsx`](src/client/WorkbenchSection.tsx) | The section, upload bar, library, search pane, and result cards |
| [`src/client/locales.ts`](src/client/locales.ts) | zh/en dictionaries; every visible string lives here |


<a id="further-exploration"></a>
## Further Exploration

- [Workbench subsystem](../../../docs/subsystems/workbench.md) — the data model and pipeline semantics.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers —lick to expand</summary>

No invariant companion is published: the controller keeps upload files outside the observable snapshot, and every mutation path writes through one store.

</details>

<a id="model-experience"></a>
## Model Experience

### Knowledge workbench settings section

#### What the model sees

Nothing. The browser half calls no model route; variant generation runs on the host through the knowledge service.

#### Token effect

Zero `session` events, The workbench UI creates no model turn.

#### KV Cache effect

None. Uploads, searches, and generations stay outside the session log.

## Known Limitations and Deferred Work

- Document status refreshes on explicit actions and the refresh button; background polling is deferred.
- Template payloads render as JSON; a structured variant-template renderer is deferred.
- Token names in the stylesheet reconcile against the theme sheet during verification.

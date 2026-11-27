<!-- Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/apps/builtins/design_critique/skills/design-critique/frameworks/main-checklist.md (Apache-2.0). Changed: evidence tags name CMDeck preview evidence, a responsive-layout item added, wording tightened. -->

# Design critique checklist

The rubric behind [SKILL.md](SKILL.md). Each item has a stable ID, the evidence it needs, and the principle behind it. Record each applicable item as pass, severity 1 to 4, or not checked. Apply the severity rules in SKILL.md; practitioner guidance here is a prompt to look, not a universal requirement.

Evidence tags: **[image]** a screenshot shows it · **[dom]** needs computed styles or the accessibility tree · **[runtime]** needs interaction in the preview · **[flow]** needs several screens of one journey · **[state-pair]** needs the same view before and after an action.

## Rules

- Every issue needs observable evidence.
- A concern estimated from pixels is not a measured standards failure.
- Do not enforce a grid, type scale, target size or component rule unless it is a platform guideline or the user supplied it.
- One root cause is one finding; cite several items as support without counting it twice.
- Do not fault screens or states you were not shown.

## 1. Visual design and hierarchy

### Typography

- **V01 [image] Type hierarchy.** Text treatments form a stable title, body and metadata hierarchy without near-duplicates. Do not require a fixed number of sizes. _(Refactoring UI; Gestalt similarity)_
- **V02 [image] Emphasis channels.** Size, weight, color and spacing reinforce the intended reading order rather than contradict it. _(Refactoring UI)_
- **V03 [image] Line length.** Paragraph prose has a readable measure; about 45 to 90 characters is a diagnostic range, not a rule for tables, labels or dense tools. _(Practical typography)_
- **V04 [image] Line height and density.** Leading suits the typeface, size and density; flag shown reading friction rather than one ratio.
- **V05 [image] Typographic consistency.** Families and styles have distinct roles and repeated roles look the same.

### Spacing, grouping and layout

- **V06 [image] Spacing rhythm.** Repeated relationships use a coherent spacing rhythm. A 4 or 8 point grid is vocabulary, not a requirement.
- **V07 [image] Alignment.** Related elements share axes; exceptions look intentional. _(Gestalt continuity)_
- **V08 [image] Grouping.** Proximity and shared regions match logical relationships; unrelated items are not grouped by accident. _(Gestalt proximity, common region)_
- **V09 [image] Focal hierarchy.** Visual weight leads to the primary information or action for the task. _(Gestalt figure and ground)_
- **V15 [image] Responsive layout.** At each captured width, content fits without horizontal scrolling or clipping, navigation stays reachable, reading order survives reflow, and the primary action stays findable. Compare the widths: a layout that only works at one is the finding. _(WCAG 2.2 SC 1.4.10 reflow at 320 CSS px as the floor)_

### Color and surface

- **V10 [image] Color roles.** Repeated semantic roles use color consistently; flag role confusion, not palette size. _(Refactoring UI)_
- **V11 [image] Purposeful emphasis.** Accent and contrast support the hierarchy instead of creating competing focal points.
- **V12 [image] Repeated components.** Equivalent controls and containers look equivalent unless state or priority differs. _(Nielsen 4; Gestalt similarity)_
- **V13 [image] Shape, border and elevation.** Radius, border and elevation differences communicate a role or state rather than looking accidental.
- **V16 [image] Appearance parity.** When the page has a dark theme, both appearances keep the hierarchy, legible text, visible borders and readable images and charts. Never fault a page for having no dark theme unless the brief asks for one.

### Legibility of what matters

- **V14 [image] Critical-content legibility.** Content the user must read to act, above all the page's main artifact or media, appears at a legible size; detail images offer a larger view. Up to Major when illegible content blocks the core task. _(Shneiderman: overview, zoom, details on demand)_

Use Gestalt principles as explanations across these items, not as a separate score.

## 2. Usability and interaction

### From a static frame

- **U01 [image] Consistency and standards.** Controls use recognizable patterns; equivalent actions look and read the same. _(Nielsen 4)_
- **U02 [image] Users' language.** Labels, icons and concepts fit the brief's users rather than exposing system terms. _(Nielsen 2)_
- **U03 [image] Recognition over recall.** Needed options, context and signifiers are present where they are used. _(Nielsen 6)_
- **U04 [image] Relevant minimalism.** Nonessential elements visibly compete with the task. Not a demand to remove useful information. _(Nielsen 8)_
- **U05 [image] Affordances and signifiers.** Interactive elements look actionable and their action is understandable. _(Norman)_
- **U06 [image] Mapping.** Control placement and labels make the affected object or outcome clear. _(Norman)_

### Designer lenses

- **U07 [image] Choice complexity.** Simultaneous choices create shown decision friction; grouping can reduce it. _(Hick)_
- **U08 [image/dom] Target acquisition.** Targets look usable for the platform and width. Measure sizes from computed styles; a screenshot supports only a concern. _(Fitts)_
- **U09 [image] Cognitive load and chunking.** Dense information lacks meaningful grouping. Do not use 7 plus or minus 2 as a cap on UI items.
- **U10 [image] Convention fit.** A nonstandard pattern costs learning without a visible benefit. _(Jakob)_

### Needs runtime or flow evidence

- **U11 [runtime/flow] System status and feedback.** Actions show progress, completion and current state. _(Nielsen 1)_
- **U12 [runtime/flow] Control and reversibility.** Users can leave, cancel, undo or recover where the task needs it. _(Nielsen 3)_
- **U13 [runtime/flow] Error prevention and recovery.** Constraints prevent likely errors; recovery explains the next step. _(Nielsen 5, 9)_
- **U19 [runtime/flow] Destructive actions and data loss.** A delete, revoke or cancel asks first or can be undone; a confirmation says what will be lost; entered data survives back, refresh and navigation; the destructive button does not look like the safe one beside it. An unconfirmed permanent delete is a Catastrophe. If you were not shown the flow, do not assume the confirmation is missing. _(Nielsen 3, 5)_
- **U20 [image/runtime] Help at the point of confusion.** Where something is genuinely hard, help sits next to it: an inline hint, an example of the expected format, a "what's this". A self-evident screen needs none. _(Nielsen 10)_
- **U14 [flow] Ending quality.** The flow's consequential moments and ending give clear closure.
- **U15 [runtime/flow] Flexibility and efficiency.** Repeated expert tasks have accelerators that do not obscure the default path. _(Nielsen 7)_

### State quality, only when the state is shown

- **U16 [image] Empty and first-run states.** A shown empty state says what this is, previews the value, and offers an easy start, instead of a bare "nothing here yet". Judge what the state is for, not how its disabled controls look.

### Across a state change

- **U17 [state-pair/runtime] State-change continuity.** Elements present in both states keep their position, size and alignment; the primary action does not jump; framing does not silently disappear; the real change is not buried by everything else moving. A shift right after input is excluded from CLS, so report it as usability, not a Core Web Vitals failure. _(Change blindness; Norman: gulf of evaluation)_
- **U18 [state-pair/runtime] Motion and response timing.** Motion explains the change and never delays the next action; past about 1 second needs visible progress. Non-essential motion honors `prefers-reduced-motion`, and anything moving for more than 5 seconds can be paused. Never judge motion from a static frame. _(WCAG 2.2 SC 2.3.3, 2.2.2)_

## 3. Accessibility, bounded by evidence

- **A01 [image/dom] Text contrast.** From a screenshot, only a likely concern. With computed colors, the WCAG 2.2 ratio for SC 1.4.3 (4.5:1, or 3:1 for large text). _(WCAG 2.2 SC 1.4.3)_
- **A02 [image/dom] Non-text contrast.** Control boundaries, focus and state indicators, and meaningful graphics reach 3:1 against neighbors. _(SC 1.4.11)_
- **A03 [image] Text legibility.** Shown difficulty from size, weight, typeface or rendering. WCAG sets no universal 16px minimum.
- **A04 [runtime] Resize and reflow.** Content reflows at narrow widths without two-dimensional scrolling; the phone capture is evidence for SC 1.4.10, one screenshot is not proof of text resize. _(SC 1.4.4, 1.4.10)_
- **A05 [image/dom] Target size.** Measured targets of at least 24×24 CSS px, or the spacing exception. Apple's 44×44 points is separate platform guidance. _(SC 2.5.8)_
- **A06 [image] Color as the only cue.** Status, selection, required fields or links rely on color alone. _(SC 1.4.1)_
- **A07 [image] Color-vision robustness.** Without a simulation or source colors, only a concern about confusable pairs.
- **A08 [runtime] Focus visibility.** Tab through with `preview_act` and check the indicator; markup alone cannot pass this. _(SC 2.4.7, 2.4.11)_
- **A09 [runtime] Keyboard operation and order.** Controls work from the keyboard and focus follows reading order. _(SC 2.1.1, 2.4.3)_
- **A10 [dom] Name, role, value and alternatives.** From the accessibility tree: controls and meaningful images have accurate names, fields have labels, headings and landmarks give structure, distinct actions have distinct names. _(SC 4.1.2, 1.1.1, 1.3.1, 2.4.6; ARIA APG)_

These describe evidenced barriers. The review is not an accessibility audit or certification.

## 4. Content and language

- **C01 [image] Label clarity.** Buttons, links, fields and headings say their purpose in context.
- **C02 [image] Plain language.** Unexplained jargon is a barrier for the brief's users.
- **C03 [image] Terminology consistency.** One concept, one name, across the page or flow. _(Nielsen 4)_
- **C04 [image] Scannability.** Long instructions or prose lack the structure the task needs. Do not demand headings for short copy.
- **C05 [image/flow] Recovery copy.** A shown error says what happened and what to do next, without blame. _(Nielsen 9)_
- **C06 [dom] Readability scores.** Only for enough sentence prose to mean something; never for labels, and never the only basis for severity.

Do not report tone preferences, generic "make it shorter" advice, or copyedits that do not improve comprehension, trust or task success.

## Conformance with a supplied reference

Only when the user supplies tokens, a design system, a spec or conventions: report each supplied assertion as conforms, deviates, or not verifiable, quoting it. Cover token values (color, spacing, type, shape), component and variant use, required layout, documented conventions and supplied flows. Keep these results apart from the severity tally unless a deviation also causes a usability issue of its own.

# Data visualization inside product UI

Load when the target surface contains charts, analytical visualizations, KPI encodings, forecasts, funnels, or other visual representations of data. This is product-surface design guidance, not a general statistics/reporting skill.

## Start from the user question

Name the question before choosing a chart:

- **change over time** -> continuous time encoding, usually a line;
- **compare discrete categories** -> bars or another length-based comparison;
- **part of a meaningful whole** -> part-to-whole only when the total matters;
- **distribution / relationship / outliers** -> distribution or scatter-style encoding;
- **forecast / estimate** -> separate observed and predicted values and expose uncertainty;
- **sequential conversion / drop-off** -> flow/funnel only when stages are actually sequential;
- **value against target** -> make value, target, and direction explicit;
- **exact lookup dominates** -> a table may be the primary interface, not a fallback chart.

When the choice is uncertain, load `design-guidance.md` and query the `chart` domain. A catalog result is a candidate encoding, not proof.

## Encoding rules

- Preserve meaningful order. Sort categories only when ranking is the task; chronological, ordinal, or domain order may be more truthful.
- Do not add dimensions because the chart library supports them. Extra color, area, animation, 3D, or bubble size must answer a real question.
- Avoid gauges when there is no target, funnels when there is no sequence, and pies when precise comparison matters more than rough share.
- Distinguish observed facts from forecasts, targets, and thresholds visually and in text.
- Show uncertainty explicitly when the data is uncertain. Never render a prediction as observed truth.
- Dense dashboards need hierarchy across charts. Not every metric deserves equal visual weight or its own card.

## Accessibility and alternative access

Every material visualization needs a non-color path to its meaning.

- combine hue with labels, line styles, marker shapes, boundaries, patterns, or direct annotation as appropriate;
- expose exact values through an accessible table, list, summary, or equivalent structured view when the chart alone cannot provide them;
- hover-only detail needs keyboard/focus parity;
- brushing, drag zoom, map pan, and drill interactions need operable alternatives appropriate to the task;
- name uncertainty, targets, status, and thresholds in text rather than encoding them only in color;
- do not move keyboard focus merely to announce live chart updates.

A visually attractive chart that loses the underlying values or task for assistive users fails the Gate.

## Scale and runtime

Rendering strategy is a measured implementation question, not a fixed row-count law.

- prefer the project's existing charting/visualization stack when it can meet the interaction and accessibility contract;
- inspect actual data volume, update frequency, device class, interaction needs, and profiling evidence before switching SVG/Canvas/WebGL or adding downsampling;
- aggregation and sampling must preserve the decision the chart is meant to support;
- animation may explain change, but it must not delay interaction or become correctness-critical; route material motion through the existing motion standards.

## Verification

Verify with representative real data, not only a happy-path fixture:

- empty / sparse / dense data;
- long category and series names;
- negative/zero/extreme values where the domain allows them;
- keyboard and focus behavior;
- reduced motion;
- narrow and wide layouts;
- theme/contrast states;
- accessible value fallback;
- forecast/target semantics when present.

Source lineage: chart-selection and accessibility concepts adapted from `nextlevelbuilder/ui-ux-pro-max-skill` snapshot `f3ac195224eac1eb0dfe1a3059c2a6add78ffbe3` (MIT), rewritten to remove universal ordering, palette, library, and row-count prescriptions.

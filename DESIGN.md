# Recover — design notes

## Concept

**A dunning desk is a stack of paper.** The site borrows its rules from a printed invoice and a
rubber stamp, not from a SaaS dashboard. That decides the palette (paper, ink, one oxblood accent),
the type (a book serif for headings, monospace for every figure), and the signature object: a
receipt pinned slightly askew to the desk, its edges perforated, its lines showing the retry ladder.

- **Idea:** failed payments are paper you have to work through, one invoice at a time.
- **Metaphor:** a dunning letter on a desk.
- **Signature:** the hero receipt, rotated −1.4°, with a masked perforated edge and the ladder printed as line items.
- **Emotion:** calm, clerical, unhurried — the opposite of a red-alert billing dashboard.
- **Motion verb:** settle like paper — small rotations, 180 ms colour shifts, one underline that draws in.

## System

| Role | Value |
| --- | --- |
| Ground | `#f1ebdf` (paper) |
| Panel | `#faf6ec` |
| Ink | `#191512` |
| Muted | `#6b6157` |
| Line | `#d8cdbb` / `#b6a894` |
| Accent | `#8c2f1f` (oxblood) |
| Good / bad | `#2f6b4f` / `#a33a26` |

**Type.** Display: Iowan Old Style / Palatino / Georgia, 400, −0.035em tracking, 0.88 leading.
Body: Helvetica Neue at 16 px. Figures and labels: SF Mono at 10–11 px with 0.14–0.18em tracking.
Three families, three jobs, no overlap.

**Grid.** 1440 max width, 20–56 px gutters, sections separated by a single 1 px rule rather than
cards. The hero is asymmetric: headline left, receipt right, actions under the receipt. The desk
turns into a 4-column KPI strip over a two-column table and feed.

**Shape.** No border radius anywhere. Hairlines, dashed rules and one 3 px accent bar on the receipt.

**Genericness test.** "Payment dashboard" would produce a dark dashboard with green numbers and a
chart. This is paper, serif, and a receipt — the metaphor is doing the work, and it survives to the
footer and into the desk (the KPI strip is a ruled ledger, the activity feed is a margin note).

## Pages

1. **Landing** — receipt hero, three steps, the recovery-rate formula, an honest limits section.
2. **Auth** — split: a quotation and the demo credentials on paper, the form on the right with an
   explicit note on how the password is stored.
3. **Desk** — KPI strip, a 14-day sparkline, the retry queue with per-row retry and write-off, and
   the event feed.

## Accessibility

Semantic headings, a visible focus ring, `aria-selected` on the auth tabs, `role="status"` on
action feedback, table headers, and a reduced-motion rule that removes the transitions.

# Design System Inspired by NENTRA
### ([A] Intro × [B] Pinned walkthrough × [C] Landing hero × [D] Footer × [E] Section stacks × [M] Bento & spotlight grids, re-themed)

**Sourcing key** (attachments mapped in upload order; tell me if any are swapped)
- **[A]** the amber bokeh intro image: the base identity (color, light, mood). Everything below inherits from it.
- **[B]** video 1, a screen recording of a pinned phone walkthrough: the scroll animation and component animations.
- **[C]** video 2, a screen recording of a landing hero: the grain-gradient field and the wordmark "melt".
- **[D]** the footer image: CTA band and footer design and layout.
- **[E]** video 3, a section-stack recording: how other sections animate (stacked scenes, pinned beats, transitions).
- **[M]** the bento grid and feature spotlight grid from the earlier design, rebuilt in this theme.

**Locked fonts:** Georama and Satoshi, and Inter appears nowhere in this system. One display serif (Instrument Serif) is my pick for the accent words in [D]'s headline pattern; swap candidates are in Section 3.

**Not adopted:** the reference sites' names, logos, copy and screens. Every product screen, mark and line of copy is yours.

**How the media were read:** [A] and [D] are still images, so [A]'s intro animation is my proposed choreography, built from the still's cues (falling beams, hanging orb, two-part line). [B] (48.7s) and [C] (23.1s) are silent 1080p screen recordings that include browser chrome; [E] is the 67s recording with audible sound (measured about -21 dB; I have not heard it). Timings are estimates from sampled frames; tune them in the browser.

## 1. Visual Theme & Atmosphere

Light falling into a dark room. The page opens on warm bokeh, vertical beams of light and one dark glass orb that hangs in the beam. The orb dissolves into the product name, and the room turns into a grainy ember field with the name melting and re-forming at its center. From there the story is told by a phone pinned at the center of the screen, lit from below by a horizon glow, while the copy and a numbered index change around it. Everything is warm: ember, amber, honey and cream on near-black. The product is about financial rhythm, so every motion is counted in beats.

**Key Characteristics**
- Near-black warm ground with amber, ember and honey glow; no cool colors [A]
- One mark: a dark glass orb with an amber rim, a white specular dot and a falling beam [A]
- An intro that ends with the orb dissolving into the wordmark [A][C]
- A grainy ember field with dark blotches drifting slowly behind the wordmark [C]
- A wordmark that melts left to right into marbled fragments and re-forms [C]
- A pinned phone, an index of numbered steps and a crossfading headline [B]
- A horizon glow band at the bottom of scenes and of the footer [B][D]
- Stacked scenes that hold and animate for a beat, then hand over to the next [E]
- One motion unit, the beat (`1200ms`), that every duration is a multiple of

## 2. Color Palette & Roles

All hexes are estimated from the images and compressed frames.

### Ground & Text [A]
- **Ember Black** `#0D0B07`: page ground
- **Umber** `#1B160F`: raised panels
- **Olive Shadow** `#26250F`: dark blotches, the olive shade in the intro's dark areas
- **Cream** `#F6EEDC`: text, wordmark
- **Cream 70** `rgba(246,238,220,.70)`: body · **Cream 55** `rgba(246,238,220,.55)`: captions (5.5:1 on Ember Black) · **Cream 35**: decoration only
- **Hairline** `rgba(246,238,220,.16)` · **Hairline Strong** `rgba(246,238,220,.32)`

### Light [A]
- **Rust** `#7A2A0E`: deepest red-orange at the intro's top-left
- **Ember** `#B5440F` · **Amber** `#F28A2E` · **Gold Glow** `#F5B561` · **Honey** `#E3C07F`
- **Beam** `rgba(255,236,200,.16)`: vertical light bars

### Semantic (financial data)
- **Gain** `#8CCB86` · **Loss** `#E4604A`
- Never use Amber or Ember to mean gain or loss.

### Gradients (the only ones)
- **Intro glow:** `radial-gradient(70% 55% at 62% 18%, rgba(245,181,97,.9), rgba(242,138,46,.55) 38%, transparent 70%)` plus `radial-gradient(60% 45% at 12% 8%, #7A2A0E, transparent 70%)`
- **Ember field [C]:** base `#B5440F`, with Amber and Gold Glow highlights and Ember Black / Olive Shadow blotches (see Components)
- **Horizon band [B]:** `radial-gradient(120% 60% at 50% 100%, #F28A2E 0%, #B5440F 30%, rgba(122,42,14,.6) 55%, transparent 75%)`
- **Footer glow [D]:** `radial-gradient(120% 80% at 50% 100%, #F28A2E 0%, #B5440F 38%, #1B160F 72%, #0D0B07 100%)`
- **Orb:** `radial-gradient(circle at 32% 28%, #FFD9A0 0%, #F28A2E 18%, #2A130A 46%, #0D0B07 100%)`

**Contrast rules:** text on Amber, Gold Glow or Honey is Ember Black only (cream on amber is about 2.4:1 and fails). Amber text is allowed on Ember Black (about 8:1).

## 3. Typography Rules

### Font Family (locked)
**Interface & Headlines — Satoshi** (Fontshare, free for commercial use; weights 300, 400, 500, 700, 900): wordmark fallback, headlines, body, nav, buttons, footer, the intro line.
Fallback: 'General Sans', -apple-system, 'Segoe UI', sans-serif
**Labels & Data — Georama** (Google Fonts, variable): step numerals, tags, tile labels, the corner text blocks, micro-labels.
Fallback: 'Satoshi', system-ui, sans-serif
**Accent Serif — Instrument Serif** (Google Fonts, 400 and italic): my pick for the serif accent words in headlines, following [D]. Swap candidates: Newsreader, Cormorant Garamond.
Fallback: Georgia, serif

### Role Ownership
| Family | Owns | Never |
|--------|------|-------|
| Satoshi | Wordmark fallback, headlines, body, nav, buttons, footer, intro line | Tracked micro-labels |
| Georama | Numerals, tags, chips, tile labels, corner blocks, micro-labels | Paragraphs, headlines |
| Instrument Serif | Up to two accent words inside an H1 or H2 | Body, UI, H3, more than two words, color |

### Hierarchy (desktop)

| Role | Font | Size / Line | Weight | Tracking | Color |
|------|------|-------------|--------|----------|-------|
| Wordmark | Satoshi (or supplied logotype) | clamp(64px, 17vw, 260px) / 0.9 | 900 | -0.03em | Cream |
| Tagline [C] | Georama | 16 / 22 | 400, lowercase | +0.02em | Cream 70 |
| Corner Block [C] | Georama | 13 / 18 | 400, lowercase | 0 | Cream 70 |
| Intro Line [A] | Satoshi | 28 / 36 | 300 | 0 | Cream |
| H1 | Satoshi + Instrument Serif accent | 72 / 76 | 700 (serif 400) | -0.03em | Cream |
| H2 | Satoshi + Instrument Serif accent | 48 / 52 | 700 (serif 400) | -0.025em | Cream |
| Scene Headline [B] | Satoshi | 56 / 60 | 500 | -0.03em | Cream |
| Lead | Satoshi | 18 / 28 | 400 | 0 | Cream 70 |
| Body | Satoshi | 16 / 26 | 400 | 0 | Cream 70 |
| Card Title | Satoshi | 20 / 28 | 500 | 0 | Cream |
| Step Numeral [B] | Georama | 12 / 16 | 500, tabular | +0.12em | Amber |
| Index Item [B] | Satoshi | 15 / 20 | 400 | 0 | Cream 45 (active: Cream) |
| Nav | Satoshi | 14 / 20 | 500 | 0 | Cream 70 |
| Button | Satoshi | 15 / 20 | 700 | 0 | Ember Black on Amber |
| Micro-label | Georama | 11 / 14 | 400, caps | +0.18em | Cream 55 |
| Tile Label [M] | Georama | 22 / 26 | 700 | -0.01em | Ember Black on Cream |
| Footer Heading [D] | Satoshi | 14 / 20 | 500 | 0 | Cream 80 |
| Footer Link [D] | Satoshi | 13 / 20 | 400 | 0 | Cream 65 |
| Footer Wordmark [D] | Satoshi (or supplied) | clamp(120px, 34vw, 520px) / 0.85 | 900 | -0.04em | Cream |

### Principles
- Satoshi sets every headline; the serif only accents up to two words, as in [D]'s "Built for *brands* that mean *business.*"
- Accent words stay Cream, never colored.
- Sentence case everywhere, except micro-labels and the wordmark.
- Georama is never over 22px; the serif is never under 40px.
- Numbers (steps, amounts) are tabular.
- Hierarchy rank: wordmark, then H1/H2 or Scene Headline, then lead, then body, then labels. Only one rank-1 element per screen.

## 4. Component Stylings

### Intro Stage [A]
- **Ground:** Ember Black plus the Intro glow gradients; 5–6 large bokeh discs (`20–38vw`, Honey and Gold Glow at `.35–.6`, blurred `40px`), positioned in the lower half and drifting `±2vw` over `4 beats`
- **Grain:** halftone-style grain over everything (a pre-baked noise tile at 10–12%, `mix-blend-mode: overlay`)
- **Beams:** 3 vertical bars (`80px`, Beam gradient fading downward) at about 20%, 48% and 78% of the width; two carry small falling light heads (`18–36px`, Gold Glow)
- **Anamorphic streak:** a `1px` horizontal light line through the orb, `40vw` wide, Cream at 50%, fading at the ends
- **Intro Line:** centered under the orb in two phrases ("Together," then the rest), set as in the hierarchy table

### Orb Mark [A]
- **Size:** `64px` (nav `28px`, footer giant mark scaled to the wordmark's cap height)
- **Fill:** the Orb gradient; rim light at the lower left; a `4px` white specular dot at the upper left
- **Halo:** `0 0 32px rgba(242,138,46,.55)`; breathing: scale `1 → 1.04`, halo `.55 → .8` over `4 beats`
- **Beam:** a Beam bar above it when it hangs in the intro

### Wordmark & Melt [A][C]
- **Wordmark:** centered, tagline below, two Corner Blocks bottom-left and bottom-right (three lines each, left- and right-aligned), per [C]'s layout
- **Melt states (from [C]):**

| State | Duration | Look |
|-------|----------|------|
| Clean | rest | solid Cream letters on the field |
| Wave | about 6s | a turbulent displacement wave starts at the leftmost glyph and travels right (about `150px/s`); letters turn into marbled, high-contrast cream fragments with a hard threshold, the tagline fades out |
| Torn | holds | letters stay legible with ragged, torn edges |
| Reform | not shown in the video | letters settle to Clean |

- **Use 1:** the intro's dissolve, played in reverse: turbulence over the orb's position resolves left to right into the clean wordmark
- **Use 2:** the same effect triggered by pointer proximity (radius about `160px`), resolving when the pointer leaves. This is inferred; the recording can't confirm whether the effect is timed or pointer-driven.
- **Implementation:** SVG `feTurbulence` + `feDisplacementMap` + a threshold (`feComponentTransfer`), or a small WebGL shader; limit the effect to the wordmark's box (at most `1200 × 420`)

### Ember Field [C]
- A field of `#B5440F` with Amber and Gold Glow highlights, and Ember Black / Olive Shadow blotches on a staggered lattice (about two blotches per `1000px`), each blotch `300–420px`, feathered
- Slow drift: blotches move `±3vw` over `8 beats`; the lattice never resets visibly
- Heavy grain (`12–14%`); nothing sharp except the wordmark

### Navigation [B][C]
- **Layout:** orb mark and wordmark left; links right; outlined pill CTA far right (as [C]); in [B] the nav appears after the hero, so fade it in at the end of the intro
- **Height:** `64px`; transparent over art; once past the hero, `rgba(13,11,7,.72)` with `backdrop-filter: blur(12px)` and a `1px` Hairline bottom edge
- **Mobile:** mark left, menu button right

### Buttons [B][C][D]
**Primary (Amber):** fill `#F28A2E`, text `#0D0B07`, pill, height `48px`, padding `0 28px`, Satoshi 700 15px, optional `↗` icon (as [D]); glow `0 8px 28px rgba(242,138,46,.35)`. Hover: fill `#F5B561`, glow `.5`. Active: `scale(.98)`.
**Outline [C]:** `1px solid rgba(246,238,220,.6)`, text Cream, pill, same size. Hover: fill `rgba(246,238,220,.10)`.
**Cream [D]:** fill Cream, text `#0D0B07`, pill (the "Subscribe" button).
**Nav CTA:** Amber pill, `36px` high, Satoshi 700 14px.
Focus ring: `2px solid #F5B561`, offset `3px`.

### Pinned Walkthrough [B] (signature scroll component)
- **Layout:** left column (about cols 2–5): numeral, headline, sub; center (cols 5–8): the phone; right (cols 10–12): the step index
- **Phone:** dark bezel (`#15110B`, `1px` Hairline), radius `44px`, dynamic-island notch, status bar; screen on Ember Black; width about `320px`, height about `640px`
- **Horizon band:** the Horizon band gradient along the bottom of the scene, softened with a horizontal streak texture (blur `24px`, scaleY `.3`); it drifts `±2vw` over `4 beats`
- **Star dust:** a faint noise of stars in the top `30%` of the scene
- **Step index:** a vertical `1px` Hairline at the left of a list of 5 rows ("01 You talk"); numerals Georama; the active row is Cream with an Amber `2px` segment on the rule; inactive rows Cream 45
- **Step copy:** numeral in Amber, Scene Headline over two lines, sub in Cream 70

**Walkthrough choreography (estimated, `5 × 100vh` runway plus `40vh` entry)**

| Phase | Behavior |
|-------|----------|
| Entry (first `40vh`) | the phone rises from the bottom edge to the center; the horizon band glows up behind it; the nav appears |
| Each step | the old copy fades out (`opacity → 0`, `translateY -12px`, `300ms`) while the new copy fades in from `+12px` (`500ms`, `--ease-out`); the active segment slides to the new row (`300ms`); the screen dims to `30%` then the new screen fades in, its elements staggered `120ms` |
| Holds | within a step, a state changes after one beat: for example a button reads "Send message" and turns to "Message sent ✓" (Gain tint); a chip such as "Live" fades in after the card; an amount counts up over `900ms` |
| Release | the phone and band hold for `20vh`, then the next section stacks over them |

- Screen content per step is placeholder; you supply the five product screens.

### Stack Scenes [E] (other sections)
- **Runway:** `200–260vh` pinned; inside, `3–4` beats of motion before the hand-off
- **Beats:** the heading and paragraph enter; outlined tag pills highlight one at a time (the active pill fills Cream with Ember Black text, one beat each); a tilted preview card swaps its image on each pill (`perspective(1200px) rotateY(-14deg) rotateX(6deg) rotateZ(4deg)`, floating `±10px` over `5s`); numbers count up
- **Hand-off:** the next scene slides up over the current one (`translateY 100% → 0`, `1000ms`, `--ease-lid`), while the outgoing scene parallaxes up `12%` and dims; the incoming scene's top edge carries a `1px` Amber rim
- **Pager:** a vertical dot pager at the right edge, `6px` dots, active dot Cream with a `10px` Hairline ring (desktop only)
- **Tags:** `1px` Hairline pill, Georama 500 11px caps, `+0.08em`
- **Ring carousel (optional, for case studies):** 7–9 cards on a ring (radius about `36vw`, tilted `rotateX(10deg)`); scroll rotates the ring; the active card centers, scales `1.15` and shows its title with a serif accent; others dim to `.55` and blur `1px`
- **Aperture transition (use once, between the walkthrough and the features):** a vertical lens opens from a slit onto the next scene, rim `2px` Gold Glow with `0 0 16px rgba(245,181,97,.8)`; modeled on [E]'s portal

### Feature Spotlight Grid [M] (re-themed)
- 3 columns, no gaps; cells share `1px` Hairline lines; `12px` "+" crosshair markers in Cream 40 at each cell's top-left and bottom-right corners
- **Spotlight:** `radial-gradient(ellipse 60% 55% at 20% 0%, rgba(245,181,97,.16), transparent 70%)`; hover raises it to `.26` over `300ms`
- Padding `32px`, min height `260px`; icon tile `48px`, radius `4px`, `rgba(246,238,220,.05)` fill, `1px` Hairline border, icon `24px` Cream
- Title Satoshi 20/500 Cream; body Satoshi 16/26 Cream 70; no shadow

### Bento Grid [M] (re-themed)
- **Container:** `rgba(246,238,220,.04)` fill, `1px` Hairline border, radius `28px`, padding `20px`, `backdrop-filter: blur(20px)`
- **Grid:** 12 columns, `20px` gap; row 1 is an 8-column tile and a 4-column tile, row 2 three 4-column tiles; row height `360px`
- **Tile tints:** Rust `#3A1A0B` · Olive `#25240F` · Umber `#1F1A12` · Dust `#3B2A10` · Smoke `#1A1812`; radius `12px`; each carries a warm flare at its top-left, `radial-gradient(120% 90% at 0% 0%, rgba(245,181,97,.14), transparent 55%)`
- **Tile Label:** Cream pill, Ember Black text, Georama 22/700, padding `10px 24px`, rotated `-3°` to `+4°` (vary per tile), with a caption in Georama 14 Cream 70 `8px` above
- **"Coming soon" variant:** `rgba(246,238,220,.05)` pill with a Hairline border and Cream text
- **Art slot:** a circular lens crop (about `55%` of tile height) with a feathered edge and a Hairline ring

### CTA Band & Footer [D]
**CTA band (centered)**
- Eyebrow pill (`1px` Hairline, Georama 12 caps, `6px 16px`), then an H2 over two lines with up to two serif accent words, then a Lead of two lines, then the Primary button with `↗`
- The band sits on Ember Black; the glow rises beneath it into the footer

**Footer**
- **Ground:** the Footer glow gradient, feathered at its top edge into an arc, with grain
- **Left:** orb mark plus wordmark (about `34px` high), then a two-line descriptor in Satoshi 300 22/28 Cream 80, then four `44px` circular social buttons (`1px` Hairline Strong, icons `18px`)
- **Middle:** three link columns (heading, then five links at `14px` rhythm)
- **Right:** newsletter label, an email input (pill, `rgba(246,238,220,.14)` fill, Cream 55 placeholder), a full-width Cream "Subscribe" pill
- **Bottom:** the giant mark and wordmark in Cream, bleeding off the bottom edge (about 40% of the wordmark's height visible below the columns); the mark is the orb in place of [D]'s squircle
- Padding `64px` sides, `56px` top

### Inputs & Forms (extrapolated; none beyond the newsletter in the references)
- Pill, `48px` high, `rgba(246,238,220,.08)` fill, `1px` Hairline border, Satoshi 16 Cream; focus border `#F5B561` plus `0 0 0 4px rgba(245,181,97,.2)`; a visible label in Satoshi 14/500 above

### Illustration & Imagery
- Product shots sit in dark phone or glass frames; photographs get a warm grade (amber highlights, umber shadows) and `8%` grain
- Bokeh and beams are the only decorative imagery; no illustration, no stock photography

## 5. Layout Principles

### Spacing System
**Base Unit:** `4px`
**Scale:** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 120`

| Relationship | Value |
|--------------|-------|
| Eyebrow → headline → lead → button | 16 → 16 → 32 |
| Numeral → headline → sub | 16 → 16 |
| Section padding, top and bottom | 120 desktop · 80 tablet · 64 mobile |
| Card and tile gap | 20 |
| Card padding | 32 (spotlight), 20 (bento container) |
| Footer column gap | 14 (links), 64 (columns) |

### Grid & Container
- Max width `1280px`, side padding `40px` desktop, `20px` mobile; 12 columns, `20px` gutter
- Intro, hero, walkthrough, stack scenes and the footer run full-bleed

### Page Blueprint

| Order | Section | Source |
|-------|---------|--------|
| 0 | Intro (bokeh, orb, line, dissolve) | [A][C] |
| 1 | Landing hero (ember field, wordmark, melt) | [C] |
| 2 | Pinned walkthrough (5 steps) | [B] |
| 3 | Stack scenes (2–3 scenes, one aperture transition) | [E] |
| 4 | Features (spotlight grid) | [M] |
| 5 | Output (bento) | [M] |
| 6 | CTA band + footer | [D] |

### Motion Choreography

**Rhythm tokens**
- `--beat: 1200ms`. Reveal `600ms` (½ beat), stagger `120ms` (1/10 beat), ambient loops `4 beats` (`4.8s`) or `8 beats` (`9.6s`)
- `--ease-out: cubic-bezier(.16,1,.3,1)` · `--ease-lid: cubic-bezier(.65,0,.15,1)`; scroll-linked motion is scrubbed (`scrub: 0.8`), not eased

**Intro (about 6.8s, proposed from [A]'s still)**

| Time | Event |
|------|-------|
| 0.0–0.6s | black; grain and bokeh fade up (`blur 24 → 0`) |
| 0.4–1.6s | beams drop at staggered columns with light heads; the orb descends its beam to the center and settles, halo pulsing once |
| 1.4–2.4s | "Together," fades in (`blur 6 → 0`, `translateY 8 → 0`); then the rest of the line, word stagger `60ms` |
| 2.4–3.6s | hold; the line and orb breathe |
| 3.6–4.2s | the line fades out; the orb pulses once (`1 → 1.12 → 1`) |
| 4.2–5.6s | the orb breaks into turbulence and the Melt resolves, left to right, into the clean wordmark; the bokeh and beams cross-morph into the Ember field |
| 5.6–6.8s | tagline, corner blocks and nav fade in, `120ms` stagger |

- Any scroll, click or key press completes the intro to its end in `300ms`
- Repeat visits in a session play a `1.5s` variant (orb pulse, then the wordmark)

**Hero → walkthrough:** on first scroll the wordmark fades (`opacity → 0`, `300ms`), the Ember field drains to Ember Black (`600ms`), and the phone rises with the Horizon band, as in the Entry phase above.

**Reduced motion:** no intro, no melt, no pin. Show the hero static, then each walkthrough step as a stacked block with a `300ms` crossfade; stop ambient loops.

**Implementation:** GSAP ScrollTrigger (`pin`, `scrub`) from cdnjs for the walkthrough and stack scenes; optionally Lenis. Animate only `transform`, `opacity`, `filter`, `clip-path`. Pause the Melt and bokeh when off screen.

### Sound
None required. [B] and [C] are silent. [E] carries audio I haven't heard; if you want sound, supply stems, keep it muted by default behind a visible toggle, and start it only after a user gesture.

### Whitespace Philosophy
Dark space frames light. The intro and hero hold almost nothing; the walkthrough keeps three quiet columns around the phone; grids hold structure with hairlines instead of fills.

### Border Radius Scale
- `4px` icon tiles · `12px` tiles, frames · `28px` bento container · `44px` phone · `9999px` pills, buttons, inputs · `50%` orb, social circles

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| 0 Ground | Ember Black | page |
| 1 Umber | `#1B160F` + Hairline | panels, phone bezel |
| 2 Glass | translucent fill, border, blur | bento container, input |
| Glow | halo, horizon, rim | orb, primary button, scene edges |
| Grain | noise overlay | intro, hero, footer |

**Philosophy:** no drop shadows except the primary button's amber glow. Depth is light: beams from above, horizon glow from below, glass layers in between.

## 7. Do's and Don'ts

### Do
- Keep every color within the warm family; amber and ember carry all emphasis
- Count every duration in beats
- Let the orb dissolve into the wordmark with the Melt, not a plain fade
- Keep the phone pinned at the center of the walkthrough with copy on the left and the index on the right
- Use dark text on any amber fill
- Limit serif accents to two words per headline
- Re-tint all light to the same warm source (top-left flare on tiles, horizon below on scenes)

### Don't
- Don't use Inter anywhere
- Don't introduce blue, purple or magenta
- Don't color the serif accent words
- Don't put cream text on amber
- Don't add drop shadows or hard-edged cards
- Don't use more than one aperture transition per page
- Don't use Amber or Ember for gain or loss

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <640px | Intro line `22 / 30`; wordmark `17vw`; beams reduced to 2; Corner Blocks hidden; walkthrough: copy above the phone, phone `78vw` (max `300px`), the index becomes a 5-dot bar below it; stack scenes become plain sections with swipeable tilted previews; ring carousel becomes a snap scroller; spotlight and bento one column; footer columns 2 × 2, wordmark `30vw` |
| Tablet | 640–1023px | Walkthrough keeps the three columns at narrower widths; spotlight 2 columns; bento 2 columns |
| Desktop | 1024–1439px | Full behavior |
| Wide | ≥1440px | Container stays `1280px`; ground and glow extend edge to edge |

### Type by Breakpoint
| Role | Mobile | Tablet | Desktop |
|------|--------|--------|---------|
| H1 | 40 / 44 | 56 / 60 | 72 / 76 |
| H2 | 32 / 38 | 40 / 46 | 48 / 52 |
| Scene Headline | 36 / 40 | 46 / 50 | 56 / 60 |
| Tile Label | 18 / 22 | 20 / 24 | 22 / 26 |

### Touch Targets and Performance
- Minimum `44 × 44px`
- Use a pre-baked noise tile for grain (not a live filter); limit the Melt to the wordmark's box; bokeh and beams animate with `transform` and `opacity` only; pause everything off screen

## 9. Agent Prompt Guide

### Asset Slots (supply these; don't fabricate)

| Slot | What |
|------|------|
| Wordmark | NENTRA logotype SVG (optional; the Satoshi fallback exists) |
| Orb mark | SVG with the Orb and Beam layers |
| Phone screens | 5 product screens for the walkthrough |
| Scene previews | images for the stack scenes and the tilted card |
| Case study cards | for the optional ring carousel |
| Social icons | for the footer |
| Grain tile | 256px seamless noise PNG |
| Sound stems | optional |

### Quick Color Reference
- **Ground:** `#0D0B07` · `#1B160F` · Olive `#26250F`
- **Light:** Rust `#7A2A0E` · Ember `#B5440F` · Amber `#F28A2E` · Gold `#F5B561` · Honey `#E3C07F`
- **Text:** Cream `#F6EEDC` · Cream 70 · Cream 55
- **Data:** Gain `#8CCB86` · Loss `#E4604A`

### Token Starter
```css
:root{
  --font-ui:'Satoshi','General Sans',-apple-system,'Segoe UI',sans-serif;
  --font-label:'Georama','Satoshi',system-ui,sans-serif;
  --font-accent:'Instrument Serif',Georgia,serif;
  --black:#0D0B07; --umber:#1B160F; --olive:#26250F;
  --cream:#F6EEDC; --cream-70:rgba(246,238,220,.70); --cream-55:rgba(246,238,220,.55);
  --hairline:rgba(246,238,220,.16); --hairline-strong:rgba(246,238,220,.32);
  --rust:#7A2A0E; --ember:#B5440F; --amber:#F28A2E; --gold:#F5B561; --honey:#E3C07F;
  --beat:1200ms; --ease-out:cubic-bezier(.16,1,.3,1); --ease-lid:cubic-bezier(.65,0,.15,1);
  --r-tile:12px; --r-container:28px; --r-phone:44px; --gap:20px; --section-y:120px;
}
```
Satoshi loads from Fontshare (`https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap`); Georama and Instrument Serif from Google Fonts.

### Build Order
1. Fonts, tokens, ground, type classes, grain tile.
2. Buttons, pills, inputs, nav.
3. Orb mark and its states.
4. Ember field and the static hero with the wordmark and Corner Blocks.
5. The Melt (clean, wave, torn) on the wordmark.
6. The intro timeline: bokeh, beams, orb, line, dissolve into the wordmark.
7. Pinned walkthrough: phone, Horizon band, index, copy swaps, screen swaps.
8. Stack scenes: pills, tilted preview, pager, hand-off, one aperture transition.
9. Spotlight grid, then bento.
10. CTA band and footer.
11. Reduced-motion and mobile variants.
12. Check contrast, the spacing table, performance and every breakpoint.

### Iteration Guide
1. **Fonts are locked:** Satoshi for headlines and interface, Georama for labels and numerals, Instrument Serif only for up to two accent words. No Inter.
2. **The base identity is the intro's warm dark:** ember, amber, honey and cream on near-black. Nothing cool.
3. **The orb is the one mark;** it dissolves into the wordmark with the Melt.
4. **Every duration is a multiple of the beat (`1200ms`).**
5. **The walkthrough is pinned:** phone center, copy left, index right, copy crossfade `300/500ms`.
6. **Scenes stack:** hold for a beat or two of motion, then slide the next scene over.
7. **Light comes from above (beams, top-left flare) and pools below (horizon, footer glow).**
8. **Dark text on amber fills; cream text on dark.**
9. **No drop shadows;** only the primary button's amber glow.
10. **Bento tiles are dark warm tints with a top-left flare and tilted cream labels;** spotlight cells are hairline-ruled with `+` markers.
11. **The footer follows [D]:** CTA band, glow arc, columns, social circles, newsletter, giant wordmark bleeding off the bottom.
12. **Always provide the skip and reduced-motion paths.**

# Reproduction evidence

Measured 2026-09-07 in real Chromium 151.0.7922.34, against the working-tree `content.js` preserved before implementation. Fixtures are recreated in `tests/fixtures`; these are observations, while automated tests assert corrected behavior.

| Target | Observed before this change |
| --- | --- |
| Result starvation | Default found late transparent text after 799 hidden labels; returned zero findings after 800 and 1,000 labels. Runs took 95, 86, and 102 ms. |
| Root identity | The current branch already included host selector paths. With duplicate host/frame IDs, Default retained 8 of 11 distinct targets, and Everything retained 10 of 11 because identical snippets still collided. |
| Page ownership | Scanning deleted a preexisting page-owned `#htd-panel`. Page CSS targeting this ID also hid the replacement report. |
| Ordinary-size same color | White-on-white 16px text and black text over an ancestor black background were missed in Everything. |
| Vertical positioning | `top:-10000px;left:0` was missed; equivalent horizontal displacement was detected. Ordinary below-fold content was not flagged. |
| Modern and unknown color | Readable white-on-black `oklch()` text was falsely reported with contrast 1.00. A gradient background also produced an unjustified precise ratio. |
| Unicode | Emoji, a normal emoji sentence, Persian ZWNJ, Indic ZWJ/ZWNJ, and Arabic ZWJ all appeared in Default. The emoji sentence also appeared in Precise. |
| Frame coverage | Accessible frame text was found; opaque sandbox and real cross-origin frames had no coverage warning because `contentDocument` returned null. |
| Representative work | 10,000 ordinary visible spans: synchronous scan took 159 ms in this local run. This is a fixture observation, not a general performance claim. |

Root highlighting support had already improved on the current branch relative to the older review; regression coverage now checks actual computed outlines and complete owned cleanup in documents and open shadow roots. The previous scan was synchronous and provided no cancellation protocol. Measurements vary with machine, layout, browser version, and changing page content.

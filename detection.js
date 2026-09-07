/* Local, bounded detection helpers. Shared as a plain extension script and by Node tests. */
(() => {
  const THRESHOLDS = Object.freeze({ everything: -Infinity, sweep: 3, default: 6, precise: 9 });
  const WEIGHTS = Object.freeze({
    'display-hidden': 3, 'visibility-hidden': 3, 'opacity-low': 3, 'content-hidden': 3,
    'ancestor-display': 3, 'ancestor-visibility': 3, 'ancestor-opacity': 1, 'ancestor-content': 3,
    'font-tiny': 6, 'line-zero': 4, 'spacing-negative': 4, 'indent-negative': 4,
    'color-alpha': 6, 'fill-alpha': 6, 'contrast-invisible': 6, 'contrast-low': 5,
    'clip-small': 1, 'clip': 2, 'clip-path': 3, 'mask': 2, 'transform-small': 1,
    'transform-zero': 3, 'off-canvas': 5, 'box-zero': 1, 'occlusion': 0,
    'unicode-invisible': 2, 'unicode-bidi': 2, 'unicode-joiner-diagnostic': 0, 'color-unknown': 0,
  });
  const STRUCTURAL = new Set(['display-hidden', 'visibility-hidden', 'content-hidden',
    'ancestor-display', 'ancestor-visibility', 'ancestor-content', 'clip-small', 'clip',
    'transform-small', 'box-zero', 'occlusion', 'pseudo-content']);
  const VISIBILITY = new Set(['display-hidden', 'visibility-hidden', 'content-hidden',
    'ancestor-display', 'ancestor-visibility', 'ancestor-content']);
  const HIGH_SIGNAL = new Set(['font-tiny', 'line-zero', 'spacing-negative', 'indent-negative',
    'color-alpha', 'fill-alpha', 'contrast-invisible', 'contrast-low', 'off-canvas', 'transform-zero']);
  const A11Y_REASONS = new Set(['clip-small', 'clip', 'transform-small', 'box-zero', 'occlusion', 'pseudo-content']);
  const contextStates = new WeakMap();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const number = (value, fallback = 0) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;
  const diagnostic = (id) => id.startsWith('unicode-') || id === 'color-unknown';

  // Strict fallback for environments without Canvas. Unknown syntax is never black.
  function parseRGBA(input) {
    const color = String(input || '').trim().toLowerCase();
    if (color === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (hex) {
      let value = hex[1];
      if (value.length <= 4) value = [...value].map(char => char + char).join('');
      return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16), a: value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1 };
    }
    const match = color.match(/^rgba?\(([^()]+)\)$/);
    if (!match) return null;
    const numeric = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?%?';
    const commaSyntax = new RegExp(`^${numeric}\\s*,\\s*${numeric}\\s*,\\s*${numeric}(?:\\s*,\\s*${numeric})?$`);
    const spaceSyntax = new RegExp(`^${numeric}\\s+${numeric}\\s+${numeric}(?:\\s*/\\s*${numeric})?$`);
    const body = match[1].trim();
    if (!(body.includes(',') ? commaSyntax : spaceSyntax).test(body)) return null;
    const parts = body.split(/[\s,/]+/);
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (!parts.every(part => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/.test(part))) return null;
    const channel = (part) => clamp(part.endsWith('%') ? parseFloat(part) * 255 / 100 : parseFloat(part), 0, 255);
    const alpha = parts[3] ? clamp(parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1), 0, 1) : 1;
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  }

  function createColorResolver(doc) {
    const cache = new Map();
    let canvasContext = null;
    try {
      const canvas = doc?.createElement('canvas');
      if (canvas) {
        canvas.width = canvas.height = 1;
        canvasContext = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      }
    } catch (_) { /* RGB fallback still works when Canvas is unavailable. */ }
    return (input) => {
      const color = String(input || '').trim();
      if (cache.has(color)) return cache.get(color);
      let result = null;
      // Computed colors should already resolve these context-dependent values.
      if (color && !/^(currentcolor|inherit|initial|unset|revert(?:-layer)?)$|\bvar\(/i.test(color)) {
        if (canvasContext) {
          try {
            // Invalid fillStyle assignments are ignored. Two distinct sentinels
            // distinguish invalid input from a valid color equal to one sentinel.
            canvasContext.fillStyle = '#010203';
            canvasContext.fillStyle = color;
            const first = canvasContext.fillStyle;
            canvasContext.fillStyle = '#040506';
            canvasContext.fillStyle = color;
            if (canvasContext.fillStyle === first) {
              canvasContext.clearRect(0, 0, 1, 1);
              canvasContext.fillRect(0, 0, 1, 1);
              const data = canvasContext.getImageData(0, 0, 1, 1).data;
              result = { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
            }
          } catch (_) { result = parseRGBA(color); }
        } else result = parseRGBA(color);
      }
      if (cache.size >= 512) cache.clear();
      cache.set(color, result);
      return result;
    };
  }

  function stateFor(context) {
    let state = contextStates.get(context);
    if (!state) {
      state = { colors: new WeakMap(), backgrounds: new WeakMap(), ancestors: new WeakMap(), pseudoAncestors: new WeakMap(), occlusions: new WeakMap() };
      contextStates.set(context, state);
    }
    return state;
  }

  function resolveColor(color, el, context) {
    if (context.color) return context.color(color, el.ownerDocument);
    const state = stateFor(context);
    const doc = el.ownerDocument;
    if (!doc) return parseRGBA(color);
    if (!state.colors.has(doc)) state.colors.set(doc, createColorResolver(doc));
    return state.colors.get(doc)(color);
  }

  function composite(front, back) {
    const a = front.a + back.a * (1 - front.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const channel = (key) => (front[key] * front.a + back[key] * back.a * (1 - front.a)) / a;
    return { r: channel('r'), g: channel('g'), b: channel('b'), a };
  }

  function contrastRatio(fg, bg) {
    const luminance = (color) => {
      const [r, g, b] = [color.r, color.g, color.b].map(value => value / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * r + .7152 * g + .0722 * b;
    };
    const l1 = luminance(fg), l2 = luminance(bg);
    return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
  }

  function backgroundsUnknown(style) {
    return (style.backgroundImage && style.backgroundImage !== 'none') ||
      (style.mixBlendMode && style.mixBlendMode !== 'normal') ||
      (style.filter && style.filter !== 'none') ||
      (style.backdropFilter && style.backdropFilter !== 'none') || number(style.opacity, 1) < 1;
  }

  function effectiveBackground(el, context, pseudo) {
    const cache = stateFor(context).backgrounds;
    if (!pseudo && cache.has(el)) return cache.get(el);
    let result = { r: 0, g: 0, b: 0, a: 0 };
    let current = el;
    let pseudoStyle = pseudo ? context.style(el, pseudo) : null;
    const visited = new Set();
    for (let depth = 0; current && depth < 128; depth++) {
      if (visited.has(current) && !pseudoStyle) { result = null; break; }
      const style = pseudoStyle || context.style(current);
      if (!style || backgroundsUnknown(style)) { result = null; break; }
      const background = resolveColor(style.backgroundColor, current, context);
      if (!background) { result = null; break; }
      result = composite(result, background);
      if (result.a >= .9999) break;
      if (pseudoStyle) { pseudoStyle = null; continue; }
      visited.add(current);
      const parent = context.parent(current);
      // Frame surfaces can have page imagery behind them; do not invent a
      // cross-document canvas backing by walking into the embedding document.
      current = parent?.ownerDocument === el.ownerDocument ? parent : null;
    }
    if (result && result.a < .9999) result = null;
    if (!pseudo) cache.set(el, result);
    return result;
  }

  function ancestorInfo(el, context, includeOrigin = false) {
    // A pseudo-element is painted inside its originating element: host opacity,
    // visibility and compositing also affect generated text. Keep this cache
    // separate from direct text, whose own style is analyzed independently.
    const cache = includeOrigin ? stateFor(context).pseudoAncestors : stateFor(context).ancestors;
    if (cache.has(el)) return cache.get(el);
    const result = { evidence: null, compositionUnknown: false };
    let current = includeOrigin ? el : context.parent(el);
    const visited = new Set(includeOrigin ? [] : [el]);
    for (let depth = 0; current && depth < 128; depth++) {
      if (visited.has(current)) { result.compositionUnknown = true; break; }
      visited.add(current);
      const style = context.style(current);
      if (!style) { result.compositionUnknown = true; break; }
      if (number(style.opacity, 1) < 1 || (style.filter && style.filter !== 'none') ||
          (style.mixBlendMode && style.mixBlendMode !== 'normal')) result.compositionUnknown = true;
      if (!result.evidence) {
        if (style.display === 'none') result.evidence = { id: 'ancestor-display', message: 'ancestor display:none' };
        else if (style.visibility === 'hidden' || style.visibility === 'collapse') result.evidence = { id: 'ancestor-visibility', message: `ancestor visibility:${style.visibility}` };
        else if (number(style.opacity, 1) <= .02) result.evidence = { id: 'ancestor-opacity', message: `ancestor opacity:${style.opacity}` };
        else if (style.contentVisibility === 'hidden') result.evidence = { id: 'ancestor-content', message: 'ancestor content-visibility:hidden' };
      }
      current = context.parent(current);
    }
    if (current) result.compositionUnknown = true;
    cache.set(el, result);
    return result;
  }

  const PICTOGRAPH = /\p{Extended_Pictographic}/u;
  const EMOJI_EXTRA = /[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/u;
  const JOINING_SCRIPT = /[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Khmer}\p{Script=Myanmar}]/u;
  const WORD_BREAK_SCRIPT = /[\p{Script=Thai}\p{Script=Khmer}\p{Script=Myanmar}]/u;

  function unicodeEvidence(text) {
    const chars = Array.from(text);
    const groups = new Map();
    const add = (id, char) => {
      if (!groups.has(id)) groups.set(id, { count: 0, codePoints: new Set() });
      const group = groups.get(id);
      group.count++;
      group.codePoints.add(`U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    };
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (/[\u202A-\u202E\u2066-\u2069\u061C\u200E\u200F]/.test(char)) {
        add('unicode-bidi', char);
      } else if (char === '\u200D' || char === '\u200C') {
        let previous = i - 1;
        while (previous >= 0 && EMOJI_EXTRA.test(chars[previous])) previous--;
        const emoji = char === '\u200D' && PICTOGRAPH.test(chars[previous] || '') && PICTOGRAPH.test(chars[i + 1] || '');
        const language = JOINING_SCRIPT.test(chars[i - 1] || '') && JOINING_SCRIPT.test(chars[i + 1] || '');
        add(emoji || language ? 'unicode-joiner-diagnostic' : 'unicode-invisible', char);
      } else if (/[\u200B\u2060\uFEFF\u00AD\u034F]/.test(char)) {
        const languageBreak = char === '\u200B' && WORD_BREAK_SCRIPT.test(chars[i - 1] || '') && WORD_BREAK_SCRIPT.test(chars[i + 1] || '');
        add(languageBreak ? 'unicode-joiner-diagnostic' : 'unicode-invisible', char);
      }
    }
    const messages = {
      'unicode-joiner-diagnostic': 'Unicode joiner or word separator in a common emoji/language context; diagnostic only',
      'unicode-invisible': 'Invisible formatting character outside a recognized common context; usage may be legitimate',
      'unicode-bidi': 'Directional formatting controls; may support legitimate bidirectional text',
    };
    return [...groups].map(([id, group]) => ({ id, description: messages[id], message: `${messages[id]} (${[...group.codePoints].join(', ')}; x${group.count})`,
      count: group.count, codePoints: [...group.codePoints] }));
  }

  function offCanvas(el, style, rect, context, includeOrigin = false) {
    const view = el.ownerDocument?.defaultView;
    if (!view) return null;
    const fixed = style.position === 'fixed';
    const displacementContext = candidate => {
      if (!candidate) return false;
      const positioned = candidate.position === 'fixed' || candidate.position === 'absolute';
      const transformed = candidate.transform && candidate.transform !== 'none';
      const extremeOffset = candidate.position !== 'static' &&
        ['left', 'right', 'top', 'bottom'].some(side => Math.abs(number(candidate[side])) >= 300);
      return positioned || transformed || extremeOffset;
    };
    let displacedLayout = displacementContext(style);
    let x = fixed ? 0 : number(view.scrollX);
    let y = fixed ? 0 : number(view.scrollY);
    // Restore nested scrolling as well as window scrolling before comparing
    // document coordinates. Scrolling normal content away is not concealment.
    let current = includeOrigin ? el : context.parent(el);
    for (let depth = 0; !fixed && current && current.ownerDocument === el.ownerDocument && depth < 128; depth++) {
      // Text may be static while its containing element is displaced. Only use
      // the current document's bounded ancestor context, and still require its
      // restored geometry to be far outside the ordinary document area below.
      if (!displacedLayout) displacedLayout = displacementContext(context.style(current));
      if (current !== el.ownerDocument.scrollingElement) {
        x += number(current.scrollLeft);
        y += number(current.scrollTop);
      }
      current = context.parent(current);
    }
    const horizontal = rect.right + x < -200 || rect.left + x > number(view.innerWidth, 1000) + 200;
    const vertical = rect.bottom + y < -Math.max(200, number(view.innerHeight, 800)) ||
      (fixed && rect.top > number(view.innerHeight, 800) + 1000);
    if (!displacedLayout || (!horizontal && !vertical)) return null;
    return { id: 'off-canvas', message: `off-canvas positioning (${[horizontal && 'horizontal', vertical && 'vertical'].filter(Boolean).join(', ')})`,
      axis: [horizontal && 'horizontal', vertical && 'vertical'].filter(Boolean) };
  }

  function occluded(el, rect, context) {
    const cache = stateFor(context).occlusions;
    if (cache.has(el)) return cache.get(el);
    let result = false;
    const doc = el.ownerDocument, view = doc?.defaultView;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (doc?.elementFromPoint && view && x >= 0 && y >= 0 && x <= view.innerWidth && y <= view.innerHeight) {
      try {
        let top = doc.elementFromPoint(x, y);
        for (let depth = 0; top?.shadowRoot?.elementFromPoint && depth < 16; depth++) {
          const nested = top.shadowRoot.elementFromPoint(x, y);
          if (!nested || nested === top) break;
          top = nested;
        }
        result = Boolean(top && top !== el && !top.contains(el) && !el.contains(top));
        // A shadow host and its descendant are one visual target.
        for (let current = el, depth = 0; result && current && depth < 128; depth++) {
          if (current === top) result = false;
          current = context.parent(current);
        }
      } catch (_) { /* Detached/navigated documents cannot be sampled reliably. */ }
    }
    cache.set(el, result);
    return result;
  }

  function analyze(el, text, context, pseudo = null) {
    const evidence = unicodeEvidence(String(text || ''));
    const style = context.style(el, pseudo);
    if (!style) return evidence;
    const add = (id, message, data = {}) => evidence.push({ id, message, ...data });
    if (style.display === 'none') add('display-hidden', 'display:none');
    if (style.visibility === 'hidden' || style.visibility === 'collapse') add('visibility-hidden', `visibility:${style.visibility}`);
    if (number(style.opacity, 1) <= .02) add('opacity-low', `opacity:${style.opacity}`);
    if (style.contentVisibility === 'hidden') add('content-hidden', 'content-visibility:hidden');
    const fontSize = number(style.fontSize, 16);
    if (fontSize <= 4) add('font-tiny', `tiny font-size (${fontSize}px)`, { fontSize });
    if (style.lineHeight === '0px' || style.lineHeight === '0') add('line-zero', 'line-height:0');
    if (number(style.letterSpacing) < -20) add('spacing-negative', `letter-spacing very negative (${style.letterSpacing})`);
    if (number(style.textIndent) < -300) add('indent-negative', `text-indent very negative (${style.textIndent})`);

    const fg = resolveColor(style.color, el, context);
    const fillValue = style.webkitTextFillColor || style.getPropertyValue?.('-webkit-text-fill-color');
    const fill = fillValue ? resolveColor(fillValue, el, context) : fg;
    if (!fg || !fill) add('color-unknown', 'Foreground color could not be resolved; contrast is unknown');
    if (fg && fg.a <= .08 && fill && fill.a <= .08) add('color-alpha', `text color alpha low (${fg.a.toFixed(2)})`, { alpha: fg.a });
    if (fill && fill.a <= .08 && (!fg || fg.a > .08)) add('fill-alpha', `-webkit-text-fill-color alpha low (${fill.a.toFixed(2)})`, { alpha: fill.a });
    const ancestors = ancestorInfo(el, context, Boolean(pseudo));
    const bg = effectiveBackground(el, context, pseudo);
    // The text fill color is the actual glyph paint in Chromium. Do not
    // fabricate precision for images, unknown canvas backings, blending,
    // filters, shadows, or opacity composition outside the known background.
    if (fg && fill && fill.a > .08 && bg && !ancestors.compositionUnknown && (!style.textShadow || style.textShadow === 'none')) {
      const ratio = contrastRatio(composite(fill, bg), bg);
      if (ratio <= 1.15) add('contrast-invisible', `effectively identical text/background colors (estimated ratio ${ratio.toFixed(2)})`, { ratio, fontSize });
      else if (ratio < 1.5 && fontSize <= 12) add('contrast-low', `very low contrast vs background (estimated ratio ${ratio.toFixed(2)})`, { ratio, fontSize });
    }

    const rect = context.rect(el);
    if (rect) {
      if ((style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden') && (rect.width <= 20 || rect.height <= 12)) add('clip-small', 'small + overflow:hidden (clipping)');
      if (style.clip && style.clip !== 'auto') add('clip', `clip:${style.clip}`);
      if (style.clipPath && style.clipPath !== 'none') add('clip-path', `clip-path:${style.clipPath}`);
      const mask = style.maskImage || style.webkitMaskImage;
      if (mask && mask !== 'none') add('mask', 'mask-image applied');
      if (style.transform && style.transform !== 'none') {
        if (rect.width <= 2 || rect.height <= 2) add('transform-small', 'transform + nearly zero box');
        const matrix = style.transform.match(/^matrix\(([^)]+)\)$/);
        const values = matrix?.[1].split(',').map(Number);
        const tinyMatrix = values?.length === 6 && (Math.hypot(values[0], values[1]) <= .01 || Math.hypot(values[2], values[3]) <= .01);
        if (tinyMatrix || /scale\(\s*0(?:\.0+)?(?:[, )])/.test(style.transform)) add('transform-zero', `transform scales to ~0 (${style.transform})`);
      }
      const displaced = offCanvas(el, style, rect, context, Boolean(pseudo));
      if (displaced) evidence.push(displaced);
      if ((rect.width <= 2 || rect.height <= 2) && text.length) add('box-zero', `nearly zero box (${Math.round(rect.width)}x${Math.round(rect.height)})`);
      if (!pseudo && !displaced && rect.width > 3 && rect.height > 3 && occluded(el, rect, context)) add('occlusion', 'covered by another element (center-point sample)');
    }
    if (ancestors.evidence) evidence.push(ancestors.evidence);
    return evidence;
  }

  function normalizeTolerance(raw) {
    const mode = String(raw || '').toLowerCase();
    const migrated = ({ all: 'everything', strict: 'sweep', balanced: 'default' })[mode] || mode;
    return Object.hasOwn(THRESHOLDS, migrated) ? migrated : 'default';
  }

  const promptLike = (text) => /\b(ignore|instruction|prompt|must|do not)\b/i.test(text);
  const iconGlyph = (text) => /^[\uE000-\uF8FF]{1,4}$/u.test(String(text || '').trim());
  const uniqueEvidence = (item) => [...new Map((item.evidence || []).map(e => [e.id, e])).values()];

  function scoreFinding(item) {
    const evidence = uniqueEvidence(item);
    let score = evidence.reduce((sum, rule) => sum + (WEIGHTS[rule.id] || 0), 0);
    // Formatting diagnostics alone gain no suspicion from prose length or
    // prompt vocabulary. Multiple diagnostics do not imply deceptive intent.
    if (evidence.every(rule => diagnostic(rule.id))) return Math.min(2, score);
    const snippet = String(item.snippet || '');
    if (snippet.length >= 24) score++;
    if (item.pseudo) score--;
    if (iconGlyph(snippet)) score -= 3;
    if (promptLike(snippet)) score += 2;
    if (evidence.some(rule => rule.id.startsWith('contrast-') && rule.fontSize <= 12)) score++;
    return score;
  }

  function likelyA11y(item, evidence) {
    const el = item.el;
    const classes = typeof el?.className === 'string' ? el.className : '';
    if (/screenreader|sr-only|visually-hidden|skip_navigation|a11y|accessibility|external_link_icon/i.test(`${el?.id || ''} ${classes}`)) return true;
    if (String(item.snippet || '').trim().toLowerCase() === 'links to an external site.') return true;
    return evidence.length > 0 && evidence.every(rule => A11Y_REASONS.has(rule.id)) && evidence.some(rule => rule.id === 'clip-small' || rule.id === 'clip');
  }

  function shouldKeepFinding(item, mode) {
    const evidence = uniqueEvidence(item);
    if (!evidence.length) return false;
    const tolerance = normalizeTolerance(mode);
    if (tolerance === 'everything') return true;
    if (evidence.every(rule => diagnostic(rule.id))) {
      return tolerance === 'sweep' && evidence.some(rule => rule.id === 'unicode-invisible' || rule.id === 'unicode-bidi');
    }
    const score = scoreFinding(item);
    const prompt = promptLike(item.snippet || '');
    const visibilityHidden = evidence.some(rule => VISIBILITY.has(rule.id));
    const highSignal = evidence.some(rule => HIGH_SIGNAL.has(rule.id));
    const stealth = prompt || evidence.some(rule => !STRUCTURAL.has(rule.id) && !diagnostic(rule.id) && (WEIGHTS[rule.id] || 0) >= 3);
    if ((item.pseudo && iconGlyph(item.snippet) || likelyA11y(item, evidence)) && !stealth) return false;
    if (tolerance === 'sweep') return score >= THRESHOLDS.sweep || visibilityHidden || stealth;
    if (tolerance === 'precise') return prompt && visibilityHidden ? score >= 5 : score >= THRESHOLDS.precise && stealth && highSignal;
    if (visibilityHidden && !stealth) return false;
    return score >= THRESHOLDS.default || (stealth && score >= THRESHOLDS.default - 1);
  }

  function compareFindings(a, b) {
    return (b.score ?? scoreFinding(b)) - (a.score ?? scoreFinding(a)) ||
      (b.evidence?.length || 0) - (a.evidence?.length || 0) || (a.order || 0) - (b.order || 0);
  }

  const api = Object.freeze({ analyze, createColorResolver, scoreFinding, shouldKeepFinding, compareFindings, normalizeTolerance });
  globalThis.RevelioDetection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

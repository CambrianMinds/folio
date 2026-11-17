import { patchSchema, presets, validateConfig, type Config } from './config';
import { z } from 'zod';
export interface Change {
  key: keyof Config;
  before: Config[keyof Config];
  after: Config[keyof Config];
}
export type Interpretation =
  | { kind: 'layout'; config: Config; changes: Change[]; engine: string }
  | { kind: 'fit'; pages: number; minimum: number };
export function changesBetween(before: Config, after: Config): Change[] {
  return (Object.keys(after) as (keyof Config)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((key) => ({ key, before: before[key], after: after[key] }));
}
const numbers: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  half: 0.5,
  quarter: 0.25,
};
function numeric(s: string) {
  const text = s.toLowerCase().replace(/-/g, ' ').trim();
  if (text in numbers) return numbers[text];
  if (/^\d+\s*\/\s*\d+$/.test(text)) {
    const [a, b] = text.split('/').map(Number);
    return a / b;
  }
  return Number(text);
}
const amount =
  '(?:\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?|\\.\\d+|half|quarter|one|two|three|four|five|six)';
const unit = '(?:inches|inch|in|millimeters|millimetres|mm|points|point|pts|pt|em|%)';
const colors: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  gray: '#808080',
  grey: '#808080',
  blue: '#345b70',
  navy: '#243b53',
  charcoal: '#282b2d',
  cream: '#f4eee2',
  red: '#a33b32',
  green: '#436b54',
};
export function parseCommand(input: string, current: Config, fonts: string[]): Interpretation {
  if (!input.trim() || input.length > 2000)
    throw Error('Describe a layout change in 1–2000 characters.');
  let remaining = input
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/½/g, 'half')
    .replace(/¼/g, 'quarter');
  const fit = remaining.match(
    new RegExp(
      `^(?:try to )?fit(?: this| the document| it)? (?:in|into|to)(?: at most)? (${amount}) pages?(?:[,;]? (?:while |and )?(?:keeping |keep )?(?:the )?(?:body (?:text|type)|font|text)(?: size)? (?:at least|above|no smaller than) (${amount})(?:[ -]?(?:pt|points?)))?[.!]?$`,
      'i',
    ),
  );
  if (fit) {
    const pages = numeric(fit[1]),
      minimum = fit[2] ? numeric(fit[2]) : Math.min(current.fontSize, 10);
    if (
      !Number.isInteger(pages) ||
      pages < 1 ||
      pages > 100 ||
      minimum < 6 ||
      minimum > current.fontSize
    )
      throw Error('Choose 1–100 pages and a minimum size between 6 pt and the current body size.');
    return { kind: 'fit', pages, minimum };
  }
  const preserveSize =
    /\b(?:without changing|keep|leave) (?:the )?body (?:font )?size(?: unchanged| alone)?\b/i.test(
      remaining,
    );
  remaining = remaining
    .replace(
      /\b(?:without changing|keep|leave) (?:the )?body (?:font )?size(?: unchanged| alone)?\b/gi,
      '',
    )
    .replace(/all four margins/gi, 'all margins')
    .replace(/half an inch/gi, '0.5 inch')
    .replace(/a quarter of an inch/gi, '0.25 inch');
  let next = { ...current };
  let recognized = false;
  const consume = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    remaining = remaining.replace(re, (...args: unknown[]) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      fn(m);
      recognized = true;
      return ' ';
    });
  };
  consume(
    /(?:use|apply|switch to|start with)?\s*(manuscript|essay|journal|reference)(?:\s+(?:preset|layout|style))?/gi,
    (m) => {
      const p = Object.values(presets).find((c) => c.preset.toLowerCase() === m[1].toLowerCase())!;
      next = {
        ...p,
        title: current.title,
        author: current.author,
        header: current.header,
        footer: current.footer,
      };
    },
  );
  consume(
    new RegExp(`(${amount})[ -]*(?:columns?|cols?)\\b`, 'gi'),
    (m) => (next.columns = numeric(m[1])),
  );
  consume(
    new RegExp(`(?:number of )?(?:columns?|cols?)\\s*(?:to|at|=|:)?\\s*(${amount})\\b`, 'gi'),
    (m) => (next.columns = numeric(m[1])),
  );
  consume(
    /\b(?:single|double|triple)[ -]column\b/gi,
    (m) => (next.columns = /single/i.test(m[0]) ? 1 : /double/i.test(m[0]) ? 2 : 3),
  );
  const length = (s: string, u?: string) =>
    numeric(s) *
    (u
      ? /^(in|inch)/i.test(u)
        ? 72
        : /^(mm|milli)/i.test(u)
          ? 72 / 25.4
          : 1
      : current.units === 'in'
        ? 72
        : current.units === 'mm'
          ? 72 / 25.4
          : 1);
  consume(
    new RegExp(
      `(?:(${amount})[ -]*(${unit})[ -]*(?:(top|bottom|left|right|inside|outside|all)[ -]*)?margins?\\b|(?:(top|bottom|left|right|inside|outside|all)[ -]*)?margins?\\s*(?:of|to|at|=|:)?\\s*(${amount})(?:[ -]*(${unit}))?)`,
      'gi',
    ),
    (m) => {
      const v = length(m[1] || m[5], m[2] || m[6]);
      const side = (m[3] || m[4] || 'all').toLowerCase();
      if (side === 'all')
        Object.assign(next, { marginTop: v, marginBottom: v, marginLeft: v, marginRight: v });
      else
        next[
          (
            {
              top: 'marginTop',
              bottom: 'marginBottom',
              left: 'marginLeft',
              right: 'marginRight',
              inside: 'marginLeft',
              outside: 'marginRight',
            } as const
          )[side as 'top']
        ] = v;
    },
  );
  consume(
    new RegExp(
      `(?:gutter(?: width)?|column (?:gap|spacing))\\s*(?:of|to|at|=|:)?\\s*(${amount})(?:[ -]*(${unit}))?`,
      'gi',
    ),
    (m) => (next.gutter = length(m[1], m[2])),
  );
  consume(
    new RegExp(`(${amount})[ -]*(${unit})[ -]*(?:gutter|column gap)`, 'gi'),
    (m) => (next.gutter = length(m[1], m[2])),
  );
  consume(
    /\b(widen|increase|narrow|decrease|reduce) (?:the )?gutter(?: (slightly|a little))?\b/gi,
    (m) =>
      (next.gutter = Math.max(
        0,
        next.gutter + (/widen|increase/i.test(m[1]) ? 1 : -1) * (m[2] ? 3 : 6),
      )),
  );
  consume(
    /\b(?:make (?:the )?)?headings? (less|more) prominent\b/gi,
    (m) =>
      (next.headingScale = Math.max(
        1,
        Math.min(2, next.headingScale + (/less/i.test(m[1]) ? -0.1 : 0.1)),
      )),
  );
  consume(
    new RegExp(
      `\\b(increase|decrease|reduce|raise|lower) (?:the )?(?:body |text |font )?(?:font )?size by (${amount})[ -]*(?:pt|points?)\\b`,
      'gi',
    ),
    (m) => (next.fontSize += numeric(m[2]) * (/increase|raise/i.test(m[1]) ? 1 : -1)),
  );
  consume(
    /\b(?:no|disable|remove|hide|turn off) (?:the )?(?:vertical |column |separator )?rules?\b/gi,
    () => (next.rule = false),
  );
  consume(
    new RegExp(
      `\\b(?:rule (?:weight|thickness)|(?:vertical |column )?rule)\\s*(?:of|to|at|=|:)?\\s*(${amount})[ -]*(?:points?|pts?|pt)\\b`,
      'gi',
    ),
    (m) => {
      next.rule = true;
      next.ruleWidth = numeric(m[1]);
    },
  );
  consume(
    /\b(?:(?:add|enable|show|use|a|with)\s+)?(?:(thin|fine|thick)\s+)?(?:(#[\da-f]{6}|black|white|gr[ae]y|blue|navy|charcoal|red|green)\s+)?(?:vertical |column |separator )?rules?(?:\s+between\s+(?:the\s+)?columns)?\b/gi,
    (m) => {
      next.rule = true;
      if (m[1]) next.ruleWidth = /thick/i.test(m[1]) ? 1 : 0.4;
      if (m[2]) next.ruleColor = colors[m[2].toLowerCase()] || m[2];
    },
  );
  consume(/\b(?:landscape|portrait)\b/gi, (m) => (next.landscape = /landscape/i.test(m[0])));
  consume(/\b(?:letter|a4|a5|legal)(?:\s+(?:paper|pages?))?\b/gi, (m) => {
    const name = m[0].split(/\s/)[0].toLowerCase();
    const sizes: Record<string, [string, number, number]> = {
      letter: ['Letter', 612, 792],
      a4: ['A4', 595.276, 841.89],
      a5: ['A5', 419.528, 595.276],
      legal: ['Legal', 612, 1008],
    };
    const [p, w, h] = sizes[name];
    Object.assign(next, { paper: p, width: w, height: h });
  });
  consume(
    /\b(?:left[ -]align(?:ed)?|align left|justif(?:y|ied))\b/gi,
    (m) => (next.justify = /justif/i.test(m[0])),
  );
  consume(/\b(?:no|hide|disable|remove) page numbers?\b/gi, () => (next.pageNumbers = false));
  consume(/\b(?:add|show|enable) page numbers?\b/gi, () => (next.pageNumbers = true));
  consume(
    new RegExp(
      `(?:paragraph spacing|paragraph gap)\\s*(?:to|of|at|=|:)?\\s*(${amount})[ -]*(?:points?|pts?|pt)?`,
      'gi',
    ),
    (m) => (next.paragraphSpacing = numeric(m[1])),
  );
  consume(
    new RegExp(`(?:line spacing|leading)\\s*(?:to|of|at|=|:)?\\s*(${amount})\\s*(?:em)?`, 'gi'),
    (m) => (next.leading = numeric(m[1])),
  );
  consume(
    new RegExp(
      `(?:body |font |text )?(?:size\\s*(?:to|of|at|=|:)?\\s*)?(${amount})[ -]*(?:points?|pts?|pt)(?:\\s+(?:body|text|type|font))?\\b`,
      'gi',
    ),
    (m) => (next.fontSize = numeric(m[1])),
  );
  // Match installed names literally, longest first, so multiword families stay intact.
  for (const font of [...new Set([...fonts, current.bodyFont, current.headingFont])].sort(
    (a, b) => b.length - a.length,
  )) {
    const escaped = font.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    consume(
      new RegExp(
        `\\b(?:headings?(?: font| typeface)?\\s*(?:in|to|of|:)?\\s*)${escaped}(?![\\w-])`,
        'gi',
      ),
      () => (next.headingFont = font),
    );
    consume(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi'), () => (next.bodyFont = font));
  }
  consume(
    /\b(?:paper|page|background)(?: color| colour)?\s*(?:to|of|:)?\s*(#[\da-f]{6}|white|black|cream|gr[ae]y)\b/gi,
    (m) => (next.background = colors[m[1].toLowerCase()] || m[1]),
  );
  consume(
    /\b(?:body|text|heading|headings|link|links)(?: (?:ink|colou?r))\s*(?:to|of|:)?\s*(#[\da-f]{6}|white|black|charcoal|blue|navy|red|green|gr[ae]y)\b/gi,
    (m) => {
      next[
        /^heading/i.test(m[0]) ? 'headingColor' : /^link/i.test(m[0]) ? 'linkColor' : 'textColor'
      ] = colors[m[1].toLowerCase()] || m[1];
    },
  );
  remaining = remaining
    .replace(
      /\b(?:and|with|please|set|use|make|it|this|the|a|an|to|in|body|font|typeface|keep everything else|keep the rest unchanged|unchanged|otherwise)\b/gi,
      ' ',
    )
    .replace(/[\s,;.:'"–—-]/g, '');
  if (remaining || !recognized)
    throw Error(
      `I couldn't interpret ${remaining ? `“${remaining.slice(0, 90)}”` : 'that change'}. Try explicit settings, or use the optional local model.`,
    );
  if (preserveSize && next.fontSize !== current.fontSize)
    throw Error('The request both changes and preserves body size. Specify which one you want.');
  next = validateConfig(next);
  return {
    kind: 'layout',
    config: next,
    changes: changesBetween(current, next),
    engine: 'Local command parser',
  };
}
export function validateModelPatch(value: unknown, current: Config): Config {
  const patch = patchSchema
    .omit({
      schemaVersion: true,
      preset: true,
      title: true,
      author: true,
      header: true,
      footer: true,
    })
    .strict()
    .parse(value);
  return validateConfig({ ...current, ...patch });
}
export function fitCandidates(current: Config, minimum: number): Config[] {
  const candidates: Config[] = [current];
  // Keep paper, columns, margins, colors and fonts fixed. Explore bounded spacing and body size.
  const steps = Math.max(1, Math.min(12, Math.ceil((current.fontSize - minimum) / 0.5)));
  for (let index = 0; index <= steps; index++) {
    const size = current.fontSize - ((current.fontSize - minimum) * index) / steps;
    for (const ratio of [1, 0.9, 0.8]) {
      candidates.push({
        ...current,
        fontSize: Math.max(minimum, Number(size.toFixed(3))),
        leading: Math.max(0.35, current.leading * ratio),
        paragraphSpacing: Math.max(0, current.paragraphSpacing * ratio),
      });
    }
  }
  return candidates
    .filter((c, i, a) => a.findIndex((v) => JSON.stringify(v) === JSON.stringify(c)) === i)
    .slice(0, 40);
}
export function resolveStyle(value: unknown, current: Config): Config {
  const choice = z
    .object({
      style: z.enum(['Manuscript', 'Essay', 'Journal', 'Reference']).nullable(),
      clarification: z.string().max(1000),
    })
    .strict()
    .parse(value);
  if (choice.clarification.trim() || !choice.style)
    throw Error(
      choice.clarification ||
        'Which composition style would you like: Manuscript, Essay, Journal, or Reference?',
    );
  return validateConfig({
    ...presets[choice.style],
    title: current.title,
    author: current.author,
    header: current.header,
    footer: current.footer,
  });
}

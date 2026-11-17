import { z } from 'zod';
const color = z.string().regex(/^#[\da-f]{6}$/i);
export const configSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    preset: z.string().default('Essay'),
    paper: z.enum(['Letter', 'A4', 'Legal', 'A5', 'Custom']).default('Letter'),
    width: z.number().min(144).max(2880).default(612),
    height: z.number().min(144).max(2880).default(792),
    landscape: z.boolean().default(false),
    units: z.enum(['in', 'mm', 'pt']).default('in'),
    marginTop: z.number().min(12).max(720).default(54),
    marginBottom: z.number().min(12).max(720).default(54),
    marginLeft: z.number().min(12).max(720).default(58),
    marginRight: z.number().min(12).max(720).default(58),
    linkedMargins: z.boolean().default(false),
    mirrored: z.boolean().default(false),
    background: color.default('#ffffff'),
    columns: z.number().int().min(1).max(6).default(1),
    gutter: z.number().min(0).max(144).default(18),
    rule: z.boolean().default(false),
    ruleWidth: z.number().min(0.1).max(6).default(0.5),
    ruleColor: color.default('#9a9a94'),
    ruleInsetTop: z.number().min(0).max(720).default(0),
    ruleInsetBottom: z.number().min(0).max(720).default(0),
    bodyFont: z.string().default('Georgia'),
    headingFont: z.string().default('Georgia'),
    fontSize: z.number().min(6).max(48).default(11),
    headingScale: z.number().min(1).max(2).default(1.25),
    leading: z.number().min(0.1).max(2).default(0.65),
    paragraphSpacing: z.number().min(0).max(72).default(7),
    indent: z.number().min(0).max(72).default(0),
    justify: z.boolean().default(false),
    textColor: color.default('#282b2d'),
    headingColor: color.default('#283b44'),
    linkColor: color.default('#345b70'),
    pageNumbers: z.boolean().default(true),
    header: z.string().default(''),
    footer: z.string().default(''),
    toc: z.boolean().default(false),
    title: z.string().default(''),
    author: z.string().default(''),
    fullWidthTitle: z.boolean().default(true),
    codeSize: z.number().min(5).max(24).default(8),
    figureSpacing: z.number().min(0).max(72).default(10),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
// Partial updates must not inherit defaults: an omitted setting means "keep it".
export const patchSchema = z
  .object(
    Object.fromEntries(
      Object.entries(configSchema.shape).map(([key, schema]) => [key, schema.removeDefault()]),
    ) as unknown as { [K in keyof Config]: z.ZodType<Config[K]> },
  )
  .partial()
  .strict();
export const defaults = configSchema.parse({});
export const presets: Record<string, Config> = {
  Manuscript: {
    ...defaults,
    preset: 'Manuscript',
    bodyFont: 'Times New Roman',
    headingFont: 'Times New Roman',
    fontSize: 12,
    leading: 1.1,
    marginTop: 72,
    marginBottom: 72,
    marginLeft: 72,
    marginRight: 72,
    paragraphSpacing: 0,
    indent: 18,
    headingColor: '#282b2d',
  },
  Essay: defaults,
  Journal: {
    ...defaults,
    preset: 'Journal',
    columns: 2,
    fontSize: 10,
    leading: 0.55,
    marginTop: 42,
    marginBottom: 42,
    marginLeft: 42,
    marginRight: 42,
    gutter: 20,
    rule: true,
    ruleWidth: 0.4,
    justify: true,
    paragraphSpacing: 5,
    headingScale: 1.18,
  },
  Reference: {
    ...defaults,
    preset: 'Reference',
    bodyFont: 'Segoe UI',
    headingFont: 'Segoe UI',
    fontSize: 9,
    columns: 2,
    marginTop: 36,
    marginBottom: 36,
    marginLeft: 36,
    marginRight: 36,
    gutter: 18,
    leading: 0.45,
    paragraphSpacing: 4,
    headingScale: 1.15,
    codeSize: 7,
  },
};
export function validateConfig(value: unknown): Config {
  const c = configSchema.parse(value);
  const w = c.landscape ? c.height : c.width;
  const h = c.landscape ? c.width : c.height;
  const column = (w - c.marginLeft - c.marginRight - (c.columns - 1) * c.gutter) / c.columns;
  if (column < Math.max(60, c.fontSize * 6))
    throw new Error('Columns are too narrow. Reduce columns, margins, font size, or gutter.');
  if (h - c.marginTop - c.marginBottom < 100)
    throw new Error('Margins leave too little space for text.');
  if (c.ruleInsetTop + c.ruleInsetBottom >= h - c.marginTop - c.marginBottom)
    throw new Error('Rule insets consume the entire text area.');
  if (c.columns > 1 && c.rule && c.gutter < c.ruleWidth + 4)
    throw new Error('Increase the gutter to leave space around the vertical rule.');
  return c;
}
export const unitFactor = { in: 72, mm: 72 / 25.4, pt: 1 };

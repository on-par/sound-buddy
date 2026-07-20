// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure "Share Image" report-card renderer (#265): builds a compact, branded,
// social-sized (1200×630) PNG — big grade letter, score, a handful of
// headline metrics, "Sound Buddy" wordmark. A purpose-built marketing
// artifact, not a rasterized screenshot of the full report card and not a
// re-skin of the existing Export PDF (window.print()). Model → draw ops →
// renderer, all side-effect free; the canvas context is injected so this
// stays 100% unit-testable without a DOM. The rasterization glue (canvas
// creation, toBlob, save dialog) is impure browser code that lives in
// inline-app.js, mirroring report-export.ts's split (#368).

import { slugify } from './report-export';

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;
export const MAX_SHARE_METRICS = 3;
export const MAX_CHURCH_NAME_LEN = 40;
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

export interface ShareCardInput {
  grade: string;
  score: number;
  headline: string;
  metrics: Array<{ label: string; value: string }>;
  /** undefined/null/'' => omitted entirely (AC-2: no identifying info by default). */
  churchName?: string | null;
}

export interface ShareCardModel {
  grade: string;
  score: number;
  headline: string;
  metrics: Array<{ label: string; value: string }>;
  churchName: string | null;
  accent: string;
}

export type DrawOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { kind: 'text'; x: number; y: number; text: string; font: string; fill: string; align: 'left' | 'center' | 'right' }
  | { kind: 'circle'; x: number; y: number; r: number; stroke: string; lineWidth: number };

/**
 * The subset of CanvasRenderingContext2D that {@link renderShareCard} uses —
 * a local structural type so a recording fake can satisfy it in tests
 * without `any` and without a DOM canvas.
 */
export interface CanvasLike {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
}

// ── Colors — literal hex values mirroring the semantic tokens in
// styles/tokens.css (canvas cannot resolve CSS custom properties). ──
const BG_APP_HEX = '#0B0C0F'; // mirrors --bg-app (--neutral-950)
const TEXT_PRIMARY_HEX = '#E6E9EE'; // mirrors --text-primary (--neutral-100)
const TEXT_MUTED_HEX = '#565D6B'; // mirrors --text-muted (--neutral-500)

// Grade → accent color, keyed by the grade's first letter, mirroring the
// --grade-* tokens. D and F share the "needs attention" red (--grade-f) —
// this card only needs a coarse good/ok/attention read at a glance, not the
// full 5-way ramp the on-screen grade ring uses.
const GRADE_ACCENTS: Record<string, string> = {
  A: '#57D77C', // mirrors --grade-a
  B: '#9AD05A', // mirrors --grade-b
  C: '#F3CA5E', // mirrors --grade-c (--gold-400)
  D: '#F26D71', // mirrors --grade-f
  F: '#F26D71', // mirrors --grade-f
};
const DEFAULT_ACCENT = TEXT_MUTED_HEX;

// ── Layout — every coordinate/size below is a named constant derived from
// the card dimensions, never a raw literal sprinkled into shareCardDrawOps. ──
const CARD_PADDING_X = 64;
const ACCENT_BAR_HEIGHT = 8;

const GRADE_CIRCLE_CX = 210;
const GRADE_CIRCLE_CY = SHARE_CARD_HEIGHT / 2;
const GRADE_CIRCLE_RADIUS = 110;
const GRADE_CIRCLE_STROKE_WIDTH = 12;
const CIRCLE_START_ANGLE = 0;
const FULL_CIRCLE_RADIANS = Math.PI * 2;

const GRADE_LETTER_FONT = 'bold 120px "Helvetica Neue", Arial, sans-serif';
const GRADE_LETTER_BASELINE_OFFSET = 15; // nudges the letter's baseline to look vertically centered
const SCORE_FONT = 'bold 30px "Helvetica Neue", Arial, sans-serif';
const SCORE_BASELINE_OFFSET = 55; // below the grade letter, inside the ring

const CONTENT_X = 420; // left edge of headline/metric/church-name text, right of the grade circle
const HEADLINE_FONT = '32px "Helvetica Neue", Arial, sans-serif';
const HEADLINE_Y = 170;

const METRIC_FONT = '26px "Helvetica Neue", Arial, sans-serif';
const METRICS_START_Y = 260;
const METRIC_ROW_HEIGHT = 58;

const CHURCH_NAME_FONT = '22px "Helvetica Neue", Arial, sans-serif';
const CHURCH_NAME_Y = SHARE_CARD_HEIGHT - 130;

const WORDMARK_TEXT = 'SOUND BUDDY';
const WORDMARK_FONT = 'bold 24px "Helvetica Neue", Arial, sans-serif';
const WORDMARK_Y = SHARE_CARD_HEIGHT - 48;
const PRODUCT_LINE_TEXT = 'soundbuddy.app';
const PRODUCT_LINE_FONT = '18px "Helvetica Neue", Arial, sans-serif';

function clampScore(score: number): number {
  return Math.round(Math.min(MAX_SCORE, Math.max(MIN_SCORE, score)));
}

function normalizeChurchName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed.slice(0, MAX_CHURCH_NAME_LEN);
}

function accentForGrade(grade: string): string {
  const letter = (grade || '').trim().charAt(0).toUpperCase();
  return GRADE_ACCENTS[letter] ?? DEFAULT_ACCENT;
}

export function buildShareCardModel(input: ShareCardInput): ShareCardModel {
  return {
    grade: input.grade,
    score: clampScore(input.score),
    headline: input.headline,
    metrics: input.metrics.slice(0, MAX_SHARE_METRICS),
    churchName: normalizeChurchName(input.churchName),
    accent: accentForGrade(input.grade),
  };
}

export function shareCardDrawOps(model: ShareCardModel): DrawOp[] {
  const ops: DrawOp[] = [];

  // 1. background
  ops.push({ kind: 'rect', x: 0, y: 0, w: SHARE_CARD_WIDTH, h: SHARE_CARD_HEIGHT, fill: BG_APP_HEX });

  // 2. accent bar
  ops.push({ kind: 'rect', x: 0, y: 0, w: SHARE_CARD_WIDTH, h: ACCENT_BAR_HEIGHT, fill: model.accent });

  // 3. grade circle + letter
  ops.push({
    kind: 'circle',
    x: GRADE_CIRCLE_CX,
    y: GRADE_CIRCLE_CY,
    r: GRADE_CIRCLE_RADIUS,
    stroke: model.accent,
    lineWidth: GRADE_CIRCLE_STROKE_WIDTH,
  });
  ops.push({
    kind: 'text',
    x: GRADE_CIRCLE_CX,
    y: GRADE_CIRCLE_CY + GRADE_LETTER_BASELINE_OFFSET,
    text: model.grade,
    font: GRADE_LETTER_FONT,
    fill: TEXT_PRIMARY_HEX,
    align: 'center',
  });

  // 4. score line
  ops.push({
    kind: 'text',
    x: GRADE_CIRCLE_CX,
    y: GRADE_CIRCLE_CY + SCORE_BASELINE_OFFSET,
    text: `${model.score}/100`,
    font: SCORE_FONT,
    fill: TEXT_PRIMARY_HEX,
    align: 'center',
  });

  // 5. headline
  ops.push({
    kind: 'text',
    x: CONTENT_X,
    y: HEADLINE_Y,
    text: model.headline,
    font: HEADLINE_FONT,
    fill: TEXT_PRIMARY_HEX,
    align: 'left',
  });

  // 6. metrics
  model.metrics.forEach((m, i) => {
    ops.push({
      kind: 'text',
      x: CONTENT_X,
      y: METRICS_START_Y + i * METRIC_ROW_HEIGHT,
      text: `${m.label}  ${m.value}`,
      font: METRIC_FONT,
      fill: TEXT_PRIMARY_HEX,
      align: 'left',
    });
  });

  // 7. church name — only when the model didn't omit it (AC-2 privacy guard).
  if (model.churchName !== null) {
    ops.push({
      kind: 'text',
      x: CONTENT_X,
      y: CHURCH_NAME_Y,
      text: model.churchName,
      font: CHURCH_NAME_FONT,
      fill: TEXT_MUTED_HEX,
      align: 'left',
    });
  }

  // 8. wordmark + product line — what makes this a marketing artifact.
  ops.push({
    kind: 'text',
    x: CARD_PADDING_X,
    y: WORDMARK_Y,
    text: WORDMARK_TEXT,
    font: WORDMARK_FONT,
    fill: TEXT_PRIMARY_HEX,
    align: 'left',
  });
  ops.push({
    kind: 'text',
    x: SHARE_CARD_WIDTH - CARD_PADDING_X,
    y: WORDMARK_Y,
    text: PRODUCT_LINE_TEXT,
    font: PRODUCT_LINE_FONT,
    fill: TEXT_MUTED_HEX,
    align: 'right',
  });

  return ops;
}

export function renderShareCard(ctx: CanvasLike, ops: DrawOp[]): void {
  for (const op of ops) {
    switch (op.kind) {
      case 'rect':
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.w, op.h);
        break;
      case 'text':
        ctx.fillStyle = op.fill;
        ctx.font = op.font;
        ctx.textAlign = op.align;
        ctx.fillText(op.text, op.x, op.y);
        break;
      case 'circle':
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lineWidth;
        ctx.beginPath();
        ctx.arc(op.x, op.y, op.r, CIRCLE_START_ANGLE, FULL_CIRCLE_RADIANS);
        ctx.stroke();
        break;
    }
  }
}

/**
 * Runtime defense-in-depth privacy guard (AC-2): throws if any text op would
 * render one of the `forbidden` strings (the source basename, the full path,
 * and the raw church-name setting when the model omitted it). Blank/empty
 * forbidden entries are ignored — nothing to guard against.
 */
export function assertNoIdentifyingText(ops: DrawOp[], forbidden: string[]): void {
  for (const raw of forbidden) {
    const needle = raw.trim();
    if (needle === '') continue;
    const lower = needle.toLowerCase();
    for (const op of ops) {
      if (op.kind === 'text' && op.text.toLowerCase().includes(lower)) {
        throw new Error(
          `Share export aborted: the image would contain "${needle}". Clear the church name in Settings or report this as a bug.`
        );
      }
    }
  }
}

/**
 * Builds a deterministic, PII-free suggested save name — never takes a
 * card/file/church name, only an injected date string (no ambient
 * `new Date()`), mirroring report-export.ts's buildExportFilename contract.
 */
export function buildShareFilename(dateText: string): string {
  const slug = slugify(dateText);
  return slug === '' ? 'sound-buddy-grade.png' : `sound-buddy-grade-${slug}.png`;
}

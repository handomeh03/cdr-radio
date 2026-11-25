import { Transform } from 'class-transformer';

export const TITLE_MAX = 200;
export const ARTIST_MAX = 200;

/** Trims strings and collapses whitespace; empty strings become `emptyAs`. */
export const TrimmedText = (emptyAs?: null) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed === '' ? emptyAs : trimmed;
  });

import { transliterate } from "./unicode.ts";

export type SlugOptions = {
  maxLength?: number;
  fallback?: string;
};

export function truncateSlug(slug: string, maxLength: number): string {
  if (slug.length <= maxLength) return slug;
  const clipped = slug.slice(0, maxLength).replace(/-+$/g, "");
  const lastDash = clipped.lastIndexOf("-");
  if (lastDash >= Math.floor(maxLength * 0.6)) return clipped.slice(0, lastDash);
  return clipped;
}

export function slugify(title: string, options: SlugOptions = {}): string {
  const maxLength = options.maxLength ?? 60;
  const fallback = options.fallback ?? "article";
  const normalized = transliterate(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncateSlug(normalized || fallback, maxLength);
}

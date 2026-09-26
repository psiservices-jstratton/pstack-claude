import { slugify } from "./slug.ts";

export type Article = {
  title: string;
  body: string;
  slug: string;
};

export function createArticle(title: string, body: string): Article {
  return { title, body, slug: slugify(title) };
}

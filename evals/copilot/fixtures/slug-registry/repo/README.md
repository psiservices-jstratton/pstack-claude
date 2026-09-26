# slug-registry

Creates article URL slugs. Slugs are lowercase ASCII, accents are transliterated, non-alphanumeric runs become a single dash, edge dashes are trimmed, and empty results use `article`. Slugs are capped at 60 characters and prefer to stop at a word boundary.

Run with `npm test` on Node 24.

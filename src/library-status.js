/**
 * Return whether a catalog entry represents a public preview.
 *
 * Preview packages do not always have a dedicated landing page, so the
 * catalog's explicit tag and kicker remain authoritative signals too.
 *
 * @param {{ homepage?: string, kicker?: string, tags?: string[] }} book
 * @returns {boolean}
 */
export function isPreviewBook(book) {
  const hasPreviewTag = book.tags?.some(
    (tag) => tag.trim().toLowerCase() === 'preview',
  )

  return Boolean(
    book.homepage ||
      /\bpreview\b/i.test(book.kicker ?? '') ||
      hasPreviewTag,
  )
}

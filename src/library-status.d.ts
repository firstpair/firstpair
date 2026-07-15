export type PreviewCatalogEntry = {
  homepage?: string
  kicker?: string
  tags?: string[]
}

export function isPreviewBook(book: PreviewCatalogEntry): boolean

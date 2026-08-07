from __future__ import annotations

from .model import Projection, VaultConfig


def project(config: VaultConfig, product_name: str) -> Projection:
    product = config.products[product_name]
    pages = tuple(page for page in config.pages if product_name != "preview" or page.preview)
    if not pages:
        raise ValueError("preview product has no selected reader pages")
    page_ids = {page.page_id for page in pages}

    if product_name == "desktop":
        evidence = config.evidence
    else:
        evidence = tuple(
            target
            for target in config.evidence
            if set(target.referenced_by) & page_ids
        )
    if product_name == "desktop":
        collections = config.collections
    else:
        collections = tuple(
            collection
            for collection in config.collections
            if set(collection.referenced_by) & page_ids
        )
    return Projection(product=product, pages=pages, evidence=evidence, collections=collections)

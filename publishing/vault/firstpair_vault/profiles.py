from __future__ import annotations

from .model import EvidenceTarget


PROFILE_KINDS = {
    "code": frozenset({"code-file", "code-range", "example", "diagram", "document"}),
    "history": frozenset({"source-passage", "anthology-entry", "claim", "visual", "document"}),
    "triptych": frozenset({"parallel-passage", "editorial", "annotation", "visual", "document"}),
}

PROFILE_COLLECTION_KINDS = {
    "code": frozenset({"code-tree", "examples", "documents"}),
    "history": frozenset({"source-corpus", "anthology", "visuals"}),
    "triptych": frozenset({"triptych-corpus", "editorials", "annotations"}),
}


def validate_evidence(profile: str, targets: tuple[EvidenceTarget, ...]) -> None:
    allowed = PROFILE_KINDS[profile]
    invalid = sorted({target.kind for target in targets if target.kind not in allowed})
    if invalid:
        raise ValueError(f"unsupported {profile} evidence kinds: {', '.join(invalid)}")
    restricted = [
        target.target_id
        for target in targets
        if target.rights == "restricted"
        and (target.source.suffix.lower() != ".json" or target.metadata.get("metadataOnly") is not True)
    ]
    if restricted:
        raise ValueError(
            "restricted evidence must use a JSON metadata document and metadataOnly=true: "
            + ", ".join(restricted)
        )


def validate_collection_kinds(profile: str, collections) -> None:
    allowed = PROFILE_COLLECTION_KINDS[profile]
    invalid = sorted({collection.kind for collection in collections if collection.kind not in allowed})
    if invalid:
        raise ValueError(f"unsupported {profile} collection kinds: {', '.join(invalid)}")
    restricted = [collection.collection_id for collection in collections if collection.rights == "restricted"]
    if restricted:
        raise ValueError("restricted collections cannot copy bytes: " + ", ".join(restricted))

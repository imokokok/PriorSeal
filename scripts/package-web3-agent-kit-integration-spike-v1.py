#!/usr/bin/env python3
"""Create a deterministic, portable WAK/Insight/PriorSeal v1 fixture archive."""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "examples/web3-agent-kit-integration-spike-v1"
FILES = (
    "README.md",
    "fixture/baseline.json",
    "fixture/cases.json",
    "fixture/manifest.json",
    "fixture/trust-roots.json",
    "verify.mjs",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "wak-insight-priorseal-conformance-v1.zip",
    )
    args = parser.parse_args()
    manifest = json.loads((BUNDLE / "fixture/manifest.json").read_text())
    for name in FILES:
        if name == "fixture/manifest.json":
            continue
        digest = hashlib.sha256((BUNDLE / name).read_bytes()).hexdigest()
        if manifest["files"].get(name) != digest:
            raise SystemExit(f"manifest mismatch: {name}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, "w", compression=ZIP_STORED) as archive:
        for name in FILES:
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_STORED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (BUNDLE / name).read_bytes())
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    print(json.dumps({"status": "PACKAGED", "path": str(args.output), "sha256": digest}))


if __name__ == "__main__":
    main()

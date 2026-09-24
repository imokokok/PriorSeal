#!/usr/bin/env python3
"""Create a deterministic, portable WAK/Insight/PriorSeal fixture archive."""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
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
        "--version",
        choices=("v1", "v1.0.1"),
        default="v1",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
    )
    args = parser.parse_args()
    suffix = "v1" if args.version == "v1" else "v1.0.1"
    bundle = ROOT / f"examples/web3-agent-kit-integration-spike-{suffix}"
    output = args.output or ROOT / f"wak-insight-priorseal-conformance-{suffix}.zip"
    manifest = json.loads((bundle / "fixture/manifest.json").read_text())
    for name in FILES:
        if name == "fixture/manifest.json":
            continue
        digest = hashlib.sha256((bundle / name).read_bytes()).hexdigest()
        if manifest["files"].get(name) != digest:
            raise SystemExit(f"manifest mismatch: {name}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_STORED) as archive:
        for name in FILES:
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_STORED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (bundle / name).read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(json.dumps({"status": "PACKAGED", "version": args.version, "path": str(output), "sha256": digest}))


if __name__ == "__main__":
    main()

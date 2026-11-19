#!/usr/bin/env python3
"""Generate tests/parity/fixtures.json from the Python reference phonemizer (dizione).

    python3 scripts/gen-parity-fixtures.py

Needs git and numpy. It checks out dizione at the pinned commit and downloads the phonemizer
data from Hugging Face at the pinned revision (verified by SHA-256) into a cache directory,
then phonemizes every sentence and records the token ids and stress values.

Sentences: dizione's own tests/data/tricky_sentences.txt (the TEXT lines) followed by
tests/parity/extra.txt. Re-run after changing either pin or extra.txt, and commit the result.
The output keeps the layout written here (one case per line); Biome is told to leave it alone.
"""

import hashlib
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

DIZIONE_REPO = "https://github.com/n4ze3m/dizione"
DIZIONE_COMMIT = "8cd889e4de7be6bd1dd2e6891344a0729fa14dd4"
DATA_REVISION = "1e73262226dbf4ef02e9df277e81aaa1db5ce16c"
DATA_URL = f"https://huggingface.co/n4ze3m/tiny-voca/resolve/{DATA_REVISION}/phonemizer"
DATA = {
    "lexicon.tsv": "3fc930345c6b3cabc533981c4b212fa309eec83913fcdbd42919338270d64b06",
    "align.json": "864763dbd558a864950266b2c30627f1cad203e75062ee842ee63c653e823b75",
    "g2p.json": "c518fd839ea0109c0b2b4f778c17506bf0d7653557b8b8c97a4c8dd9883d4432",
    "g2p.npz": "eb3fd519ff00e72d850928d2fccb968adc36134bca2f3bda09de7e794c2ed01b",
    "homographs.json": "9c3a96fcdf79fa27d1b3686dc6a507c37e4f754966928608ee9ddb617ba39192",
}

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("PARITY_CACHE", Path.home() / ".cache" / "tiny-reader-parity"))


def checkout():
    source = CACHE / "dizione"
    if not (source / ".git").exists():
        subprocess.run(["git", "clone", "--quiet", DIZIONE_REPO, str(source)], check=True)
    subprocess.run(["git", "-C", str(source), "fetch", "--quiet", "origin", DIZIONE_COMMIT], check=True)
    subprocess.run(["git", "-C", str(source), "checkout", "--quiet", "--detach", DIZIONE_COMMIT], check=True)
    return source


def data():
    directory = CACHE / f"data-{DATA_REVISION[:12]}"
    directory.mkdir(parents=True, exist_ok=True)
    for name, wanted in DATA.items():
        path = directory / name
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != wanted:
            body = urllib.request.urlopen(f"{DATA_URL}/{name}").read()
            actual = hashlib.sha256(body).hexdigest()
            if actual != wanted:
                sys.exit(f"{name}: SHA-256 is {actual}, expected {wanted}")
            path.write_bytes(body)
    return directory


def sentences(source):
    texts = []
    for line in (source / "tests/data/tricky_sentences.txt").read_text(encoding="utf-8").splitlines():
        if line.startswith("TEXT:"):
            texts.append(line[len("TEXT:"):].strip())
    for line in (ROOT / "tests/parity/extra.txt").read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            texts.append(line.strip())
    return list(dict.fromkeys(text for text in texts if text))


def main():
    source = checkout()
    os.environ["DIZIONE_DATA"] = str(data())
    sys.path.insert(0, str(source / "src"))
    import dizione

    cases = []
    for text in sentences(source):
        try:
            result = dizione.phonemize(text)
            cases.append({"text": text, "ids": list(result.ids), "stress": list(result.stress)})
        except ValueError:
            # "Nothing to pronounce": the JS side must refuse the same text.
            cases.append({"text": text, "ids": None, "stress": None})
    out = {"dizione_commit": DIZIONE_COMMIT, "data_revision": DATA_REVISION, "cases": cases}
    lines = ["{", f' "dizione_commit": "{DIZIONE_COMMIT}",', f' "data_revision": "{DATA_REVISION}",', ' "cases": [']
    lines += [f"  {json.dumps(case, ensure_ascii=False)}{',' if i < len(cases) - 1 else ''}" for i, case in enumerate(cases)]
    lines += [" ]", "}"]
    (ROOT / "tests/parity/fixtures.json").write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert json.loads((ROOT / "tests/parity/fixtures.json").read_text(encoding="utf-8")) == out
    print(f"wrote {len(cases)} cases ({sum(case['ids'] is None for case in cases)} with nothing to pronounce)")


if __name__ == "__main__":
    main()

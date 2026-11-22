#!/usr/bin/env bash
# Rewrites tests/parity/german.json and german-at.json: what apptor's own Python front end makes of
# the sentences in tests/parity/german-sentences.json, as standard German and with its Austrian
# readings. The parity test compares the JavaScript front end with them.
# Needs Docker; nothing is installed on the host.
#
#   pnpm german-fixtures
#
# Inside a pinned Python image: the front end's files and its letter-to-sound model are fetched
# from Hugging Face at the commit below and run with pinned onnxruntime, numpy and num2words.
set -euo pipefail

REVISION=0b6962273a1d6618f250cdbd621b56ba04b62cef
BASE="https://huggingface.co/apptor/apptor-tiny-tts/resolve/${REVISION}"
G2P_SHA256=d981694e7a03030b2169be46b2094775dde4ec5a3e9406c92a3fc8f1ed8bbec3
IMAGE="python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b"
PACKAGES="onnxruntime==1.32.0 numpy==2.5.5 num2words==0.5.14"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/german-fixtures.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/out"
cp "${ROOT}/tests/parity/german-sentences.json" "${WORK}/sentences.json"

cat > "${WORK}/reference.py" <<EOF
import hashlib, json, os, sys, urllib.request

os.makedirs("/work/tinyvoca", exist_ok=True)
for name in ("tinyvoca/__init__.py", "tinyvoca/g2p_de.py", "tinyvoca/math_de.py", "tinyvoca/normalize_de.py",
             "tinyvoca/text.py", "apptor-g2p-de.json", "apptor-g2p-de.onnx"):
    urllib.request.urlretrieve("${BASE}/" + name, "/work/" + name)
got = hashlib.sha256(open("/work/apptor-g2p-de.onnx", "rb").read()).hexdigest()
assert got == "${G2P_SHA256}", "the letter-to-sound model is not the pinned one: " + got

os.environ["APPTOR_G2P_MODEL"] = "/work/apptor-g2p-de.onnx"
sys.path.insert(0, "/work")
from tinyvoca.g2p_de import phonemize
from tinyvoca import text as T

sentences = json.load(open("/build/sentences.json", encoding="utf-8"))
# german.json: standard German. german-at.json: with the readings used when the Austrian model's accent is on.
for name, austrian in (("german.json", False), ("german-at.json", True)):
    out = []
    for sentence in sentences:
        try:
            p = phonemize(sentence, austrian=austrian)
            out.append({"text": sentence, "ids": list(p.ids), "stress": list(p.stress)})
        except Exception as error:
            out.append({"text": sentence, "error": type(error).__name__})
    json.dump({"symbols": list(T.SYMBOLS), "sentences": out}, open("/work/out/" + name, "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
EOF

UID_GID="$(id -u):$(id -g)"
docker run --rm -v "${WORK}:/build:ro" -v "${WORK}/out:/work/out" "${IMAGE}" bash -c "
  set -euo pipefail
  pip install --quiet --disable-pip-version-check --root-user-action=ignore ${PACKAGES}
  pip freeze | grep -i -E '^(onnxruntime|numpy|num2words)=='
  python /build/reference.py
  chown -R ${UID_GID} /work/out"

cp "${WORK}/out/german.json" "${WORK}/out/german-at.json" "${ROOT}/tests/parity/"
echo "wrote:" && ls -l "${ROOT}/tests/parity/german.json" "${ROOT}/tests/parity/german-at.json"

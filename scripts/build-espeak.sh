#!/usr/bin/env bash
# Builds eSpeak NG 1.52.0 as WebAssembly, with the data of the languages Tiny Reader reads
# through it. eSpeak NG turns text into phonemes for the models that were trained on its output
# (engine/frontends.ts). Needs Docker; nothing else is installed on the host.
#
#   pnpm build-espeak                     # writes vendor/espeak/ and public/assets/espeak/
#   pnpm build-espeak --fixtures          # instead rewrites tests/parity/espeak-*.json (see below)
#   pnpm build-espeak --allow-different   # installs a build that is not the recorded one (see the end)
#
# Everything runs inside a pinned emscripten/emsdk image:
#   1. clone espeak-ng at tag 1.52.0 and check the commit hash;
#   2. build it natively and compile the data from that same tree, as upstream's Makefile does;
#   3. build libespeak-ng with emcc and link a small driver (tr_espeak.c below) that replays
#      what the espeak-ng program does for
#        espeak-ng -q --ipa --sep=_ -v <voice> --stdin
#      writing the phoneme trace to a memory stream instead of stdout;
#   4. pack only the data of LANGS into one gzip file.
#
# With --fixtures, step 2's native program is used instead to run each model's own Python front
# end (fetched at the commit pinned below) over tests/parity/espeak-sentences.json, and the
# token ids it gives are written to tests/parity/espeak-<language>.json. The parity tests
# compare the JavaScript front ends, running on the wasm build, with those files.
#
# Adapted from scripts/build_espeak_wasm.sh in https://github.com/stdevMac/tiny-voca
# (Apache-2.0), which builds the same thing for Spanish alone.
# eSpeak NG is GPL-3.0-or-later: its licence is copied next to the build.
set -euo pipefail

ESPEAK_REPO=https://github.com/espeak-ng/espeak-ng.git
ESPEAK_TAG=1.52.0
ESPEAK_COMMIT=4870adfa25b1a32b4361592f1be8a40337c58d6c
EMSDK_VERSION=4.0.10
# Dictionaries to ship, and with each the voice file of that name. English is there because every
# voice switches to it for letters and signs its own dictionary lacks (the switch shows as
# "(en)…(es)").
LANGS="es fr tr bn ml en"
# Voice files besides those: Bengali reads Latin-script words with the American English voice.
MORE_VOICES="en-US"
# The models' reference front ends, for --fixtures, one a line:
#   language  repository  commit  Python package  its directory  environment for it
REFERENCES="\
es https://github.com/stdevMac/tiny-voca a4bf2bd979fc40b1bd7e34e13c0164db627d14ec tiny_voca src/tiny_voca TINY_VOCA_LANGUAGE=es TINY_VOCA_FRONTEND=espeak
fr https://github.com/DanielSuncost/tiny-voca-fr 4cc26ab23d934e3d33796eb06bf11f23f4c9ab34 tiny_voca src/tiny_voca TINY_VOCA_LANGUAGE=fr TINY_VOCA_FRONTEND=espeak
tr https://github.com/erkinemreta1/zerre-tts cf3cdfaaa54a9e8ec541081bb5c2e97c3d563db4 zerre src/zerre ZERRE_LANG=tr
bn https://huggingface.co/Xeven7/tiny-swara 9432a340c46249c8acae4ff4b062d46b9cbd1991 tiny_voca tiny_voca TINY_VOCA_INVENTORY=/work/reference-bn/inventory.json TINY_VOCA_LEXICON=/work/reference-bn/lexicon.json"

MALAYALAM_REPOSITORY=https://github.com/Cyrax321/tui-voice
MALAYALAM_COMMIT=478761a10399c357e9ccc5380145906167e4d655

# emscripten/emsdk publishes the amd64 image as <version> and the arm64 image as
# <version>-arm64; both are pinned by digest. emcc output does not depend on which one runs it.
case "$(uname -m)" in
  arm64|aarch64) EMSDK_IMAGE="emscripten/emsdk:${EMSDK_VERSION}-arm64@sha256:46566098d0e12a11aed071a4aaa20e6a626ab3d011a246846ae2423a21b659d9" ;;
  *)             EMSDK_IMAGE="emscripten/emsdk:${EMSDK_VERSION}@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7" ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES=""
DIFFERENT=""
for argument in "$@"; do
  case "${argument}" in
    --fixtures) FIXTURES=1 ;;
    --allow-different) DIFFERENT=1 ;;
    *) echo "unknown argument: ${argument}" >&2; exit 2 ;;
  esac
done
WORK="$(mktemp -d "${TMPDIR:-/tmp}/espeak-wasm.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/out"

# ---------------------------------------------------------------- driver (C)
cat > "${WORK}/tr_espeak.c" <<'EOF'
/* Replays espeak-ng.c main() for: -q --ipa --sep=_ -v <voice> --stdin
 * Initialisation happens once (tr_init), tr_voice does what -v does, and every
 * tr_phonemize call is one "process run": the input bytes are what the program
 * would read from stdin. One instance serves every voice. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include <emscripten/emscripten.h>

static char voice_name[64];

/* espeak-ng.c SynthCallback with quiet=true: discard audio, keep going. */
static int synth_callback(short *wav, int numsamples, espeak_EVENT *events)
{
	(void)wav; (void)numsamples; (void)events;
	return 0;
}

static int set_voice(void)
{
	espeak_ng_STATUS result = espeak_ng_SetVoiceByName(voice_name);
	if (result != ENS_OK) {
		espeak_VOICE voice_select;
		memset(&voice_select, 0, sizeof(voice_select));
		voice_select.languages = voice_name;
		result = espeak_ng_SetVoiceByProperties(&voice_select);
	}
	return result == ENS_OK ? 0 : (int)result;
}

EMSCRIPTEN_KEEPALIVE int tr_init(const char *data_path)
{
	espeak_ng_InitializePath(data_path);
	espeak_ng_ERROR_CONTEXT context = NULL;
	espeak_ng_STATUS result = espeak_ng_Initialize(&context);
	if (result != ENS_OK) {
		espeak_ng_PrintStatusCodeMessage(result, stderr, context);
		espeak_ng_ClearErrorContext(&context);
		return (int)result;
	}
	result = espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL);
	if (result != ENS_OK) {
		espeak_ng_PrintStatusCodeMessage(result, stderr, NULL);
		return (int)result;
	}
	espeak_SetSynthCallback(synth_callback);
	return 0;
}

/* The voice that speaks from now on. 0, or eSpeak NG's status when there is no such voice. */
EMSCRIPTEN_KEEPALIVE int tr_voice(const char *voice)
{
	snprintf(voice_name, sizeof(voice_name), "%s", voice);
	return set_voice();
}

EMSCRIPTEN_KEEPALIVE const char *tr_version(void)
{
	return espeak_Info(NULL);
}

/* input: the bytes the program would read from stdin (not NUL terminated).
 * Returns a malloc'd NUL-terminated copy of what it would print to stdout;
 * the caller frees it. *out_len receives its length. NULL when eSpeak NG
 * reports an error or memory runs out: no output is not the same as nothing
 * to say. */
EMSCRIPTEN_KEEPALIVE char *tr_phonemize(const char *input, int input_len, int *out_len)
{
	char *out = NULL;
	size_t size = 0;
	FILE *f_phonemes_out = open_memstream(&out, &size);
	if (f_phonemes_out == NULL)
		return NULL;

	/* --ipa sets espeakPHONEMES_IPA; --sep=_ sets espeakPHONEMES_SHOW and the
	 * separator '_' in bits 8-23. */
	espeak_SetPhonemeTrace(espeakPHONEMES_IPA | espeakPHONEMES_SHOW | ('_' << 8), f_phonemes_out);

	/* espeak-ng.c "bulk input on stdin": read every byte, then overwrite the
	 * last one with NUL and synthesise with size ix+1. */
	int ix = input_len;
	int failed = 0;
	if (ix > 0) {
		char *p_text = (char *)malloc((size_t)ix + 1);
		if (p_text == NULL) {
			failed = 1;
		} else {
			memcpy(p_text, input, (size_t)ix);
			p_text[ix] = 0;
			p_text[ix-1] = 0;
			int synth_flags = espeakCHARS_AUTO | espeakPHONEMES | espeakENDPAUSE;
			failed = espeak_Synth(p_text, (size_t)ix + 1, 0, POS_CHARACTER, 0, synth_flags, NULL, NULL) != EE_OK;
			free(p_text);
		}
	}
	espeak_ng_Synchronize();

	espeak_SetPhonemeTrace(0, stderr);
	fclose(f_phonemes_out);
	if (failed) {
		free(out);
		return NULL;
	}
	*out_len = (int)size;
	return out;
}
EOF

# ------------------------------------------------- reference outputs (Python)
cat > "${WORK}/reference.py" <<'EOF'
"""Runs a model's own Python front end over a list of sentences: in.json -> out.json."""
import importlib
import json
import sys
import types

# Only the package's text.py is wanted: its own __init__ pulls in the model and torch.
package = types.ModuleType(sys.argv[4])
package.__path__ = [sys.argv[5]]
sys.modules[sys.argv[4]] = package
T = importlib.import_module(sys.argv[4] + ".text")

out = []
for sentence in json.load(open(sys.argv[1], encoding="utf-8"))[sys.argv[3]]:
    try:
        p = T.phonemize(sentence)
        out.append({"text": sentence, "ids": list(p.ids), "stress": list(p.stress)})
    except Exception as error:
        out.append({"text": sentence, "error": type(error).__name__})
voice = getattr(T, "ESPEAK_VOICE", None) or T.language().espeak_voice
json.dump({"espeak": T.espeak_version(), "voice": voice, "symbols": list(T.SYMBOLS), "sentences": out},
          open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=0)
EOF
if [ -n "${FIXTURES}" ]; then
  cp "${ROOT}/tests/parity/espeak-sentences.json" "${WORK}/sentences.json"
  printf '%s\n' "${REFERENCES}" > "${WORK}/references.txt"
  # What the Malayalam front end builds on: the English model's token table and its own plan
  # for it, both fetched by `pnpm fetch-assets`.
  cp "${ROOT}/vendor/tiny-voca/config.json" "${WORK}/upstream.json"
  cp "${ROOT}/vendor/tui-voice/vocab_plan.json" "${WORK}/vocab_plan.json"
fi

cat > "${WORK}/reference-ml.py" <<'EOF'
"""Runs tui-voice's own phonemize and encode over the Malayalam sentences: in.json -> out.json."""
import importlib
import json
import subprocess
import sys
import types

package = types.ModuleType("tui_voice")
package.__path__ = [sys.argv[3]]
sys.modules["tui_voice"] = package
P = importlib.import_module("tui_voice.phonemes")
T = importlib.import_module("tui_voice.text")

# The English model's symbols in the order of their slots, as its training took them.
vocab = json.load(open(sys.argv[4], encoding="utf-8"))["vocab"]
upstream = sorted(vocab, key=vocab.get)
plan = json.load(open(sys.argv[5], encoding="utf-8"))
out = []
for sentence in json.load(open(sys.argv[1], encoding="utf-8"))["ml"]:
    ids = P.encode(P.phonemize(T.normalize(sentence)), plan, upstream)
    out.append({"text": sentence, "ids": ids, "stress": [0] * len(ids)})
version = subprocess.run(["espeak-ng", "--version"], capture_output=True, text=True, check=True).stdout.strip()
json.dump({"espeak": version, "voice": "ml", "symbols": plan["new_symbols"], "sentences": out},
          open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=0)
EOF

# -------------------------------------------------------- in-container build
UID_GID="$(id -u):$(id -g)"
cat > "${WORK}/build.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
# What the build writes belongs to root. It is handed to the caller however the build ends, or a
# failed one would leave files the caller cannot remove.
trap 'chown -R "${UID_GID}" /work/out' EXIT
export DEBIAN_FRONTEND=noninteractive
# The versions the image's release (Ubuntu 22.04) has: a mirror that offers others stops the build
# rather than changing what it makes.
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends autoconf=2.71-2 automake=1:1.16.5-1.3 libtool=2.4.6-15build2 >/dev/null

git clone -q --depth 1 --branch "${ESPEAK_TAG}" "${ESPEAK_REPO}" /work/src
got="\$(git -C /work/src rev-parse HEAD)"
if [ "\${got}" != "${ESPEAK_COMMIT}" ]; then
  echo "espeak-ng tag ${ESPEAK_TAG} is \${got}, expected ${ESPEAK_COMMIT}" >&2
  exit 1
fi
echo "espeak-ng ${ESPEAK_TAG} at \${got}"

CONFIG_OPTS="--without-pcaudiolib --without-sonic --without-speechplayer --without-mbrola --without-async --with-klatt"

# Native build: to compile the data from this source tree, and for --fixtures.
cp -a /work/src /work/native
cd /work/native
./autogen.sh >/dev/null 2>&1
./configure \${CONFIG_OPTS} >/dev/null
nice -n 10 make -j"\$(nproc)" src/espeak-ng >/dev/null
nice -n 10 make phsource/phonemes.stamp >/dev/null
for lang in ${LANGS}; do
  nice -n 10 make "espeak-ng-data/\${lang}_dict" >/dev/null
done
ESPEAK_DATA_PATH=/work/native ./src/espeak-ng --version

if [ -n "${FIXTURES}" ]; then
  # The reference front ends call "espeak-ng" from PATH.
  printf '#!/bin/sh\nESPEAK_DATA_PATH=/work/native exec /work/native/src/espeak-ng "\$@"\n' > /usr/local/bin/espeak-ng
  chmod +x /usr/local/bin/espeak-ng
  # Only source files are wanted from the references, not what they keep in large-file storage.
  export GIT_LFS_SKIP_SMUDGE=1
  while read -r language repository commit package directory environment; do
    git init -q "/work/reference-\${language}"
    # By commit where the server allows it (GitHub), else from the branch (Hugging Face).
    git -C "/work/reference-\${language}" fetch -q --depth 1 "\${repository}" "\${commit}" 2>/dev/null \\
      || git -C "/work/reference-\${language}" fetch -q "\${repository}"
    git -C "/work/reference-\${language}" checkout -q "\${commit}"
    env \${environment} python3 /build/reference.py /build/sentences.json "/work/out/espeak-\${language}.json" \\
      "\${language}" "\${package}" "/work/reference-\${language}/\${directory}"
  done < /build/references.txt
  # Malayalam: the model has a front end of its own design, so a driver of its own.
  git init -q /work/reference-ml
  git -C /work/reference-ml fetch -q --depth 1 "${MALAYALAM_REPOSITORY}" "${MALAYALAM_COMMIT}"
  git -C /work/reference-ml checkout -q FETCH_HEAD
  python3 /build/reference-ml.py /build/sentences.json /work/out/espeak-ml.json /work/reference-ml/tui_voice \\
    /build/upstream.json /build/vocab_plan.json
  exit 0
fi

# WebAssembly build of the library.
cp -a /work/src /work/wasm
cd /work/wasm
./autogen.sh >/dev/null 2>&1
# src/include/compat/wctype.h maps iswupper & co. to ucd_isupper & co. musl's
# <wchar.h> also declares iswupper(wint_t), and wint_t is int on wasm32 while
# ucd's codepoint_t is uint32_t, so the renamed declarations conflict. Reading
# the system <wchar.h> first, before the macros exist, avoids that; the ucd
# functions still replace the libc ones everywhere, as in the native build.
SYS_WCHAR="\$(dirname "\$(command -v emcc)")/cache/sysroot/include/wchar.h"
test -f "\${SYS_WCHAR}"
emconfigure ./configure --host=wasm32-unknown-emscripten --disable-shared --enable-static \\
  CFLAGS="-O2 -include \${SYS_WCHAR}" \${CONFIG_OPTS} >/dev/null
nice -n 10 emmake make -j"\$(nproc)" src/libespeak-ng.la >/dev/null
nice -n 10 emcc -O2 -I src/include /build/tr_espeak.c src/.libs/libespeak-ng.a \\
  -o /work/out/espeak-ng-core.mjs \\
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEspeakCore \\
  -sENVIRONMENT=web,worker,node \\
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16MB \\
  -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \\
  -sEXPORTED_FUNCTIONS=_tr_init,_tr_voice,_tr_phonemize,_tr_version,_malloc,_free \\
  -sEXPORTED_RUNTIME_METHODS=FS,UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8,HEAP32

# Pack the data of LANGS: one gzip stream of
#   "TVPK" | u32le header length | JSON [[path, size], ...] | file bytes
cd /work/native/espeak-ng-data
LANG_FILES="\$(for lang in ${LANGS}; do echo "\${lang}_dict"; find lang -type f -name "\${lang}"; done
  for voice in ${MORE_VOICES}; do find lang -type f -name "\${voice}"; done)"
LANG_FILES="\${LANG_FILES}" python3 - <<'PY'
import gzip, json, os, struct
files = ["phontab", "phonindex", "phondata", "intonations"] + os.environ["LANG_FILES"].split()
blobs = [open(f, "rb").read() for f in files]
header = json.dumps([[f, len(b)] for f, b in zip(files, blobs)]).encode()
raw = b"TVPK" + struct.pack("<I", len(header)) + header + b"".join(blobs)
with open("/work/out/espeak-ng-data.pack", "wb") as out:
    out.write(gzip.compress(raw, compresslevel=9, mtime=0))
PY
cp /work/src/COPYING /work/out/espeak-ng.COPYING.txt
EOF

# The container says a great deal while it works: compiler warnings in eSpeak NG's own code, its
# Makefile, configure asking the compiler for its version. None of it is this script's news, so
# it goes to a log that is shown only when the build fails.
echo "Building eSpeak NG ${ESPEAK_TAG} in a container. This takes about a minute."
if ! nice -n 10 docker run --rm \
  -v "${WORK}:/build:ro" -v "${WORK}/out:/work/out" \
  "${EMSDK_IMAGE}" bash /build/build.sh > "${WORK}/build.log" 2>&1
then
  cat "${WORK}/build.log" >&2
  echo >&2
  echo "The build failed. Everything it printed is above." >&2
  exit 1
fi
# What was built from: the commit that was checked, and the version the native build reports.
grep -E "^(espeak-ng ${ESPEAK_TAG} at |eSpeak NG text-to-speech: )" "${WORK}/build.log" || true

if [ -n "${FIXTURES}" ]; then
  cp "${WORK}"/out/espeak-*.json "${ROOT}/tests/parity/"
  echo "wrote:" && ls -l "${ROOT}"/tests/parity/espeak-*.json
  exit 0
fi

echo "built:"
( cd "${WORK}/out" && wc -c espeak-ng-core.mjs espeak-ng-core.wasm espeak-ng-data.pack )
# The build has come out the same, byte for byte, every time so far (x86-64). The recorded build
# is in scripts/espeak.sha256, which CI also checks its cached copy against. A build that differs
# is not installed: it may be a toolchain that drifted, or a change that still has to be recorded.
if sed 's|  .*/|  |' "${ROOT}/scripts/espeak.sha256" | ( cd "${WORK}/out" && sha256sum --check --quiet - ); then
  echo "identical to the recorded build"
elif [ -n "${DIFFERENT}" ]; then
  echo "NOTE: this build differs from the recorded one. Installed because of --allow-different." >&2
else
  {
    echo "This build differs from the recorded one, so nothing was installed. It has:"
    ( cd "${WORK}/out" && sha256sum espeak-ng-core.mjs espeak-ng-core.wasm espeak-ng-data.pack )
    echo "If this script or one of its pins was changed on purpose, record these in scripts/espeak.sha256."
    echo "To install a build that differs without recording it, pass --allow-different."
  } >&2
  exit 1
fi

# The glue is code: it is bundled into the engine Worker. The rest is data, read at run time.
mkdir -p "${ROOT}/vendor/espeak" "${ROOT}/public/assets/espeak" "${ROOT}/public/assets/licenses"
cp "${WORK}/out/espeak-ng-core.mjs" "${ROOT}/vendor/espeak/"
cp "${WORK}/out/espeak-ng-core.wasm" "${WORK}/out/espeak-ng-data.pack" "${ROOT}/public/assets/espeak/"
cp "${WORK}/out/espeak-ng.COPYING.txt" "${ROOT}/public/assets/licenses/"
echo "installed in vendor/espeak and public/assets/espeak"

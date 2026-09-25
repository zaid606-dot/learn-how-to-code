#!/usr/bin/env bash
# Downloads the on-device OCR engine (tesseract.js-core 7.0.0) and English data
# (tessdata_fast) into vendor/ocr/. Both are Apache-2.0. Needed by build-artifact.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p vendor/ocr
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/tesseract-ocr/tessdata_fast "$tmp/tessdata"
git -C "$tmp/tessdata" sparse-checkout set --no-cone /eng.traineddata /LICENSE
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/naptha/tesseract.js-core "$tmp/core"
git -C "$tmp/core" sparse-checkout set --no-cone /tesseract-core-simd-lstm.wasm.js /tesseract-core-lstm.wasm.js /LICENSE
cp "$tmp/tessdata/eng.traineddata" vendor/ocr/eng.traineddata
cp "$tmp/tessdata/LICENSE" vendor/ocr/LICENSE-tessdata
cp "$tmp/core/tesseract-core-simd-lstm.wasm.js" "$tmp/core/tesseract-core-lstm.wasm.js" vendor/ocr/
cp "$tmp/core/LICENSE" vendor/ocr/LICENSE-tesseract-core
ls -la vendor/ocr

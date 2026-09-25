#!/usr/bin/env bash
# Downloads the on-device OCR engine (tesseract.js-core 7.0.0) and English data
# (tessdata_fast) into vendor/ocr/. Both are Apache-2.0. Needed by build-artifact.mjs.
# Versions are pinned and checksummed, so every deploy ships exactly the files that were tested.
set -euo pipefail
cd "$(dirname "$0")/.."
CORE_TAG="v7.0.0"
TESSDATA_COMMIT="87416418657359cb625c412a48b6e1d6d41c29bd"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p vendor/ocr
git init -q "$tmp/tessdata"
git -C "$tmp/tessdata" remote add origin https://github.com/tesseract-ocr/tessdata_fast
git -C "$tmp/tessdata" sparse-checkout set --no-cone /eng.traineddata /LICENSE
git -C "$tmp/tessdata" fetch -q --depth 1 --filter=blob:none origin "$TESSDATA_COMMIT"
git -C "$tmp/tessdata" checkout -q FETCH_HEAD
git clone -q --depth 1 --branch "$CORE_TAG" --filter=blob:none --sparse https://github.com/naptha/tesseract.js-core "$tmp/core"
git -C "$tmp/core" sparse-checkout set --no-cone /tesseract-core-simd-lstm.wasm.js /tesseract-core-lstm.wasm.js /LICENSE
cp "$tmp/tessdata/eng.traineddata" vendor/ocr/eng.traineddata
cp "$tmp/tessdata/LICENSE" vendor/ocr/LICENSE-tessdata
cp "$tmp/core/tesseract-core-simd-lstm.wasm.js" "$tmp/core/tesseract-core-lstm.wasm.js" vendor/ocr/
cp "$tmp/core/LICENSE" vendor/ocr/LICENSE-tesseract-core
(cd vendor/ocr && sha256sum -c - <<'SUMS'
7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2  eng.traineddata
c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38  tesseract-core-simd-lstm.wasm.js
eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680  tesseract-core-lstm.wasm.js
SUMS
)
ls -la vendor/ocr

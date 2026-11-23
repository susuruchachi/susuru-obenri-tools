#!/bin/bash
# 貸し借り帳のアイコン一式を作り直す（kashikari/icons/・kashikari/icon-source.svg・android の mipmap）。要る物：python3、node と playwright（Chromium）
# 絵を変えるときは make-svg.py（羅針盤 compass と硬貨 coin）を直してから、リポジトリの一番上で：  bash tools/icons/make-icons.sh
set -e
R="$(cd "$(dirname "$0")/../.." && pwd)"; T="$(mktemp -d)"; A="$R/android/app/src/main/res"; W="$R/kashikari/icons"
mkdir -p "$W"
(cd "$T" && python3 "$R/tools/icons/make-svg.py")
J='['
for n in 16 32 48; do J="$J[\"$T/small.svg\",$n,\"$W/icon-$n.png\"],"; done
for n in 180 192 512; do J="$J[\"$T/full.svg\",$n,\"$W/icon-$n.png\"],"; done
J="$J[\"$T/maskable.svg\",512,\"$W/icon-maskable-512.png\"]"
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read n l a <<< "$d"; mkdir -p "$A/mipmap-$n"
  J="$J,[\"$T/full.svg\",$l,\"$A/mipmap-$n/ic_launcher.png\"],[\"$T/bg.svg\",$a,\"$A/mipmap-$n/ic_launcher_background.png\"],[\"$T/fg.svg\",$a,\"$A/mipmap-$n/ic_launcher_foreground.png\"]"
done
node "$R/tools/icons/render.js" "$J]"
cp "$T/full.svg" "$R/kashikari/icon-source.svg"
echo "アイコンを作り直しました（Android のアイコンを変えたときは APK も作り直す）"

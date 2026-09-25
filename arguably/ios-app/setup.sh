#!/usr/bin/env bash
# One-time setup of the Xcode project. Run on a Mac with Xcode and Node installed:
#   cd arguably/ios-app && bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"
npm install
[ -d ios ] || npx cap add ios
npx cap sync ios

PLIST="ios/App/App/Info.plist"
set_key() { /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 $3 $2" "$PLIST"; }
# Why the app asks (Apple rejects apps without these when the photo picker offers the camera).
set_key NSPhotoLibraryUsageDescription "Arguably reads the screenshots and screen recordings you pick to judge the argument. It never browses the rest of your library." string
set_key NSCameraUsageDescription "Take a photo of a conversation to judge it." string
set_key NSPhotoLibraryAddUsageDescription "Save verdict cards to your photos." string
# Arguably only uses standard HTTPS, so export compliance is simple.
set_key ITSAppUsesNonExemptEncryption false bool

echo
echo "Done. Next: npx cap open ios  → in Xcode pick your Team under Signing & Capabilities,"
echo "add the In-App Purchase capability, set the app icon, then Product › Archive."

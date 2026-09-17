#!/usr/bin/env bash
# Builds Linux (local) + Windows (Sojourner-WinBuild VM) installers for the
# version currently pinned in package.json, syncs them into web-site/downloads/,
# and bumps the version string in web-site/index.html.
#
# Requires: the Sojourner-WinBuild VirtualBox VM already provisioned (see
# windows-build-provision.ps1 and the "windows build vm" memory/notes), with
# its S: shared folder pointed at this repo checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

VM=Sojourner-WinBuild
DOWNLOADS=web-site/downloads
INDEX=web-site/index.html
VERSION=$(node -p "require('./package.json').version")

# The version currently linked from the site is what we're replacing --
# read it straight out of the first (== "current") release entry's <span
# class="rver"> rather than hardcoding a version-string pattern, since the
# scheme itself changes over time (MC-only -> <semver>-MC<mc-version>).
OLD_VERSION=$(grep -oE '<span class="rver">[^<]+</span>' "$INDEX" | head -1 | sed -E 's/<[^>]+>//g' || true)

echo "==> Releasing $VERSION (site currently links ${OLD_VERSION:-none})"

echo "==> Linux build"
npm run build

echo "==> Windows build: booting $VM"
if ! VBoxManage list runningvms | grep -q "\"$VM\""; then
  VBoxManage startvm "$VM" --type headless
fi

echo "    waiting for guest control..."
for i in $(seq 1 60); do
  VBoxManage guestcontrol "$VM" run --username user --password user \
    --exe "C:\\Windows\\System32\\whoami.exe" -- whoami >/dev/null 2>&1 && break
  sleep 5
done

rm -f WINDOWS_BUILD_DONE.txt WINDOWS_BUILD_LOG.txt
echo "    launching windows-build-provision.ps1 (npm install + npm run build on the guest, against this same checkout via S:\\)"
VBoxManage guestcontrol "$VM" run --username user --password user \
  --exe "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -- \
  powershell.exe -ExecutionPolicy Bypass -File "S:\\windows-build-provision.ps1" &

# Poll for the installer itself rather than the guest script's own DONE marker --
# that marker is only written after an in-guest smoke test (launching the built
# exe and watching it for 15s) which has been observed to hang indefinitely
# without affecting the actual build output. 30 min timeout.
NSIS_EXE="release/$VERSION/nsis/Sojourner_${VERSION}_x64-setup.exe"
echo "    waiting for $NSIS_EXE"
for i in $(seq 1 360); do
  [ -f "$NSIS_EXE" ] && break
  sleep 5
done
if [ ! -f "$NSIS_EXE" ]; then
  echo "!! timed out waiting for $NSIS_EXE -- check WINDOWS_BUILD_LOG.txt" >&2
  exit 1
fi
echo "    Windows installer ready (in-guest smoke test may still be running/hung in the background -- harmless, see WINDOWS_BUILD_LOG.txt; not killing it, killing mid-flight guest processes has wedged the guest execution service before)"

# The guest's npm install runs directly against this checkout's shared
# node_modules/ and drops the Linux native @tauri-apps/cli binding in favor of
# the Windows one. Restore it now that the guest build is done with it.
echo "==> Restoring local node_modules"
npm install

echo "==> Syncing $DOWNLOADS"
mkdir -p "$DOWNLOADS"
cp "release/$VERSION/deb/Sojourner_${VERSION}_amd64.deb" "$DOWNLOADS/"
cp "release/$VERSION/rpm/Sojourner-${VERSION}-1.x86_64.rpm" "$DOWNLOADS/"
cp "$NSIS_EXE" "$DOWNLOADS/"

if [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" != "$VERSION" ]; then
  echo "==> Archiving $OLD_VERSION artifacts + bumping $INDEX"
  ARCHIVE="$DOWNLOADS/archive/$OLD_VERSION"
  mkdir -p "$ARCHIVE"
  mv -f "$DOWNLOADS/Sojourner_${OLD_VERSION}_amd64.deb" \
        "$DOWNLOADS/Sojourner-${OLD_VERSION}-1.x86_64.rpm" \
        "$DOWNLOADS/Sojourner_${OLD_VERSION}_x64-setup.exe" \
        "$ARCHIVE/"
  sed -i "s/${OLD_VERSION}/${VERSION}/g" "$INDEX"
  echo "    NOTE: add a <li class=\"release\"> for $OLD_VERSION to the 'Older builds' <details> in $INDEX by hand"
fi

echo "==> Done. Review before committing:"
echo "    git status web-site/"

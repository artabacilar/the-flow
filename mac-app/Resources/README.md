# Resources

`AppIcon.icns` — the Mac app icon: the iOS artwork on Apple's macOS grid (an
824-point rounded square in a 1024 canvas, transparent margin), packed with
all eleven sizes the format defines.

Redraw it with `node mac-app/scripts/make-mac-icon.js`. It is committed,
unlike the generated iOS icons, because `build.sh` must work with nothing but
the Command Line Tools — and Node is not one of them. `tests/test-mac.js`
re-renders every slot and fails if these bytes and the script ever disagree.

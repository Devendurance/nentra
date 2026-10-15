# Nentra README media

This folder contains the official branded README banner and four **explicitly labeled screenshot placeholders**, not fake product screenshots.

Replace each placeholder PNG **in place** with a screenshot from the real application. Keep the exact filenames so README.md automatically renders the updated images:

| Filename | What to capture | Suggested target |
|---|---|---|
| `screenshot-landing.png` | Landing hero + first section | https://usenentra.vercel.app |
| `screenshot-floor.png` | Full six-station operations floor, visible decision rail and timeline | https://usenentra.vercel.app/app |
| `screenshot-recovery.png` | Select event #20 or #25 and capture the failure/recovery state | https://usenentra.vercel.app/app |
| `screenshot-evidence.png` | Event #44–45, verification PASS and sandbox receipt | https://usenentra.vercel.app/app |

## Capture requirements

- Use **actual** app footage and a readable 16:9 desktop viewport (1280×720 or 1920×1080 works).
- Show the **DEMO_SANDBOX** label in booking/evidence shots. Do not imply live shipping or delivery.
- Avoid exposing tokens, private contact details, credential strings, or browser developer-secret panels.
- Prefer lossless PNG. Crop excess browser chrome only when that doesn't conceal critical labels.
- Use the original official Nentra mark and logo in the application; do not replace them with AI-generated wordmarks.
- The map element in `nentra-banner.png` comes from the Africa/Nigeria illustration provided for the project. It is atmospheric artwork, **not** an actual logistics-coverage map.
- The banner is decorative and the four screenshot files are clearly marked placeholders until you replace them.

## Example (PowerShell)

```powershell
Copy-Item "C:\path\to\your\verified-floor-screenshot.png" "docs\assets\readme\screenshot-floor.png" -Force
# Review the change, then commit the updated asset.
```

If you want a different banner, replace `nentra-banner.png` with a 3:1 PNG containing Nentra's official lockup. No proprietary font files are bundled in this documentation package.

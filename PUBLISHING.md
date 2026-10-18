# Publication notes

Source and release instructions for **[Quick-Eyed-Sky/loopra](https://github.com/Quick-Eyed-Sky/loopra)**.

## Repository

- **Name:** `loopra`
- **Description:** A calm browser instrument: 32 independent synthesized loops, one shared key, and a mix of your own.
- **License:** MIT, as supplied in `LICENSE`.
- **Suggested topics:** `generative-music`, `ambient`, `web-audio`, `javascript`, `browser`, `music`.
- **Language:** English for the interface and documentation.

The README links to the latest GitHub release. There is no claimed live browser demo.

## Product scope

Loopra is a synthesis-only instrument. Its 32 layers share a selected key and mode, with independent periods, harmonic complexity and temporary headphone Solo. Solo preserves the chosen on/off mix and returns to it when switched off. Distant calls remain an automatic layer and can be auditioned with Solo; there are no manual call controls.

Audio import has been removed from the publication interface. The former option played a whole local file on repeat in place of the generator; it did not analyze, slice, harmonize or turn the file into Loopra layers.

Setup JSON files are portable settings, not recordings. The application does not offer audio recording or audio export.

## Files to include

- `dist/`: the complete static application and its local assets.
- `docs/loopra.png`: a current screenshot, with the headphone buttons visible.
- `docs/first-opening.md` and `READ-ME.txt`: first-opening guidance, linked from the README and included in the download.
- `scripts/`, `tests/`, `package.json`, the two launchers and the documentation.
- `LICENSE` and `.gitignore`.
- Any reviewed CI or Pages workflow added for the source release.

Keep local hosting metadata (`.openai/`), captures used during development, runtime files, browser state, logs and personal setup files outside the public source package. The screenshot in `docs/` is the deliberate documentation asset. Finder's orange launcher label is local macOS metadata; Git does not preserve that label.

## Before publishing

1. Run `npm run check`, `npm test` and `python3 -m unittest discover -s tests -p 'test_*.py'`.
2. Open `Run Loopra.command` on macOS and `./run.sh` on macOS or Linux. Check the printed address: the helper prefers port **4184**, reuses only the same resolved folder and build, and chooses the next free port through **4215** if an older or unrelated copy is already running. The Mac launcher opens that address automatically; `run.sh` prints it.
3. Listen with a small mix and with all 32 layers; check All off, count changes and key/mode changes.
4. Solo an enabled layer and a disabled layer. Each should be heard immediately, without losing the chosen mix; exiting Solo should restore that mix.
5. Save a setup, change the controls, then load it. Reload the page and check stored settings. Confirm that imported setup data cannot add text or code to the page.
6. Replace `docs/loopra.png` if the interface has changed, and check that its relative README link works.
7. Review the staged source list for local files and verify the MIT copyright notice.
8. Keep the prominent download link, first-opening link and optional Buy me a coffee link in the README, following the other Quick-Eyed-Sky projects. Check the download link after publishing the first release.

The automated audio tests use a simulated clock and graph. Browser listening is still needed to judge sound quality and balance.

The local helper sends `no-store` responses and opens a URL tied to the current build. Test with two unzipped copies as well as a relaunch of the same copy. An already open browser tab does not switch folders when a newer archive is unzipped; run the new copy's launcher to open it.

## Later GitHub Pages deployment

The static website is **`dist/`**, not the repository root. A future Pages workflow should upload the contents of that folder as its site artifact. No install or build command is needed.

Using an Actions deployment keeps the source, tests, launchers and README together at the root while serving only the application. After publication is explicitly requested, create the repository, upload the reviewed source and choose its Pages deployment method. Check the resulting address before adding a “Play it” link to the README.

## Commands for the source publication

Run these from this folder when ready to publish. They require Git and a GitHub CLI session signed in as the intended account, with a Git commit name and email already configured. These commands create a **public** repository; use `--private` instead if the source should remain private.

```sh
npm run check
npm test
git init -b main
git add .
git status --short
git commit -m "Initial release: Loopra ambient instrument"
gh repo create Quick-Eyed-Sky/loopra --public --source=. --remote=origin --push --description "A calm browser instrument: 32 independent synthesized loops, one shared key, and a mix of your own."
```

The repository setup above is only for the first publication. For later versions, commit and push the changes to the existing repository instead of creating it again.

After the source is online, the prepared release text is in [RELEASE.md](RELEASE.md):

```sh
gh release create v0.1.1 ../Loopra-v0.1.1.zip ../Loopra-v0.1.1-SHA256SUMS.txt --repo Quick-Eyed-Sky/loopra --title "Loopra 0.1.1 — calm, in layers" --notes-file RELEASE.md
```

The source publication and release do not enable GitHub Pages. A browser demo can be added separately using `dist/`.

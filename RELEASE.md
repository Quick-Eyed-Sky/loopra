# Loopra 0.1.1 — calm, in layers

Loopra is a small ambient instrument for unhurried listening, made entirely in the browser. Free and open source, with an English interface.

**Download `Loopra-v0.1.1.zip` below, under Assets, and unzip it.** Keep the whole folder together, then double-click **Run Loopra.command** on a Mac. Python 3 is required; there are no Python packages or models to install.

Its 32 synthesized layers repeat at different lengths in one shared key and mode. Pads and bowed bass hold a quiet foundation; bells, felt piano, glass, discreet arpeggios, ripples and rare little calls pass through it.

- Choose 0–32 layers, or switch them individually.
- Use each layer's headphone button to listen to it alone. Sparse sounds play a short audition immediately; switching Solo off restores your chosen mix.
- Explore 12 root notes, seven modes and softly enriched harmonies.
- Draw new loop lengths, and save or load a portable setup.
- Run locally on macOS or Linux, or serve `dist/` on a static web host.

No package installation, account, samples or external audio services. The interface and documentation are in English. All audio is synthesized locally; this version has no audio import, recording or audio-file export.

Released under the MIT license. The source includes launchers, documentation and 17 automated audio tests.

## This version

The new launcher opens a fresh page and checks both the folder and the app build before reusing a running server. If an older copy already occupies the local port, it chooses another. This fixes the case where unzipping the update still appeared to open the old interface.

Look for **v0.1.1** in the footer and the headphone button on every layer. Audio import and the manual “Send a call” controls have been removed; Distant calls remain an automatic layer.

Validated with 17 audio tests and six launcher integration tests, including two extracted copies running at once and reusing a copy's existing port when a lower port becomes free.

## First opening on a Mac

macOS may ask you to confirm before running a downloaded launcher. For a trusted download, the usual path after trying to open it is **System Settings → Privacy & Security → Open Anyway**. The full explanation is in **READ-ME.txt** inside the ZIP and in the [first-opening guide](https://github.com/Quick-Eyed-Sky/loopra/blob/main/docs/first-opening.md).

Keep the Terminal window open while listening, then click **Start listening** in the browser. The download's SHA-256 fingerprint is supplied in the separate `Loopra-v0.1.1-SHA256SUMS.txt` asset.

Jean-Pascal — [Quick-Eyed Sky](https://www.youtube.com/@QuickEyedSky) on YouTube, [QES](https://huggingface.co/QES) on Hugging Face.

If it gives you a quiet afternoon, you can [buy me a coffee](https://buymeacoffee.com/oFJ5CiY7n). Entirely optional, and Loopra stays exactly as free either way.

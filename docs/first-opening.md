# Opening Loopra for the first time on a Mac

[← Back to the README](../README.md)

Loopra is a free, open-source browser instrument. The download contains readable JavaScript, a small Python server and a `.command` launcher. It is not a signed or notarized Mac application bundle.

## Open the downloaded copy

1. Unzip the release and keep the whole folder together.
2. Double-click **Run Loopra.command**. It opens a Terminal window and then your browser. Keep that Terminal window open while you listen.
3. Click **Start listening** in the browser. The click is required before the browser makes sound.

The footer identifies this release as **v0.1.1**. Each sound layer has a headphone button. There is no audio-drop area or manual “Send a call” control.

## If macOS asks you to confirm

A downloaded launcher may be marked as coming from the internet. macOS can ask for confirmation or block software whose developer it cannot verify. That warning does not establish whether a download is safe; review the source and check that it came from the intended repository.

If you trust the download and macOS offers this option, try opening the launcher once, then go to **System Settings → Privacy & Security**, scroll to **Security**, and choose **Open Anyway** for the blocked launcher. Confirm the final **Open** prompt. Apple describes this process in [Safely open apps on your Mac](https://support.apple.com/en-us/102445).

This guide does not apply to a message saying that a file contains malware or is damaged. Check the download and the source instead of treating those messages as the usual first-opening confirmation.

## Another way to start

With Python 3 installed, open Terminal in the unzipped folder and run:

```sh
python3 scripts/serve.py --open
```

If Terminal says `python3` cannot be found, install Python 3 from [python.org](https://www.python.org/downloads/macos/), then try again. Loopra needs no Python packages or model downloads.

## After an update

Run the launcher inside the new folder. It checks which copy and build are being served, and opens a fresh page. An older tab does not update merely because a new archive was unzipped. If another copy already occupies the preferred port, Loopra chooses another local port and prints its address.

The server listens only on your own computer. It delivers the files in `dist/`; synthesis happens in the browser. Save a setup file before moving to a different browser or local port if you want to carry your mix with you.

# uselessguide.md

A guide for downloading and getting this thing running. No lore, no explanation. Just the bits you need.

## What you need

- Google Chrome
- Node.js 20 or newer
- Ollama, if you want to use the default local model setup
- Git is optional; downloading the ZIP works fine

## Download it

1. Open the repository page on GitHub.
2. Click **Code**, then **Download ZIP**.
3. Extract the ZIP somewhere you can find it.
4. Open the extracted project folder. It is the folder containing `manifest.json` and `package.json`.

## Set up the local helper

1. Open PowerShell in the project folder. In File Explorer, open the folder, click the address bar, type `powershell`, and press Enter.
2. Install the project packages:

   ```powershell
   npm.cmd install
   ```

3. Copy `server/.env.example` to `server/.env`.
4. The default setup uses Ollama. Install Ollama, download the model named in `server/.env` (default: `qwen2.5:3b`), and leave Ollama running.
5. Start the helper from the project folder:

   ```powershell
   npm.cmd start
   ```

   Keep that PowerShell window open while using the extension.

## Add it to Chrome

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted project folder—the one containing `manifest.json`.

To update it after downloading a newer copy, open `chrome://extensions`, click **Reload** on its card, and refresh the page where you use it.

## If it gets stuck

- Make sure you selected the folder containing `manifest.json`, not its parent folder.
- Keep the PowerShell window running.
- If PowerShell says port `8787` is already in use, stop the older helper window with **Ctrl+C** before starting another one.

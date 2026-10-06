# I made some shit with Codex

Heh. I’m non-technical and somehow cooked up some shit nobody asked for. I still don’t know why I made it, but I spent time on it, so I put it on GitHub.

I’m not telling you here what I made. If you want to know what the hell this is, download it and try it yourself lol.

Everything was made with Codex. Codex feels like heaven for non-technical people (at least for now, I think). If you know more tools I should try, recommend them—I’ll probably use them because I love trying random stuff. Finding new tools takes forever and it’s boring, hehehe.

It took me about a week to cook this shit. The funny part is, I didn’t make it in one setting. While Codex was cooking, I was off doing random side quests. Why did this take me a week? Idk whyyyyyy. I thought I’d cook some fine shit, but instead I cooked a potato. Still, I made it, so why not? Oh well, at least I made something after the random websites I made in 7th grade to show off (without AI), plus a website I made with AI a few weeks ago. Why am I telling you all this? No clue.

If the initial commit makes it look like I spent longer making this, that doesn’t mean I was working on it all that time—I’m not *that* slow lol. I made the repo first and got the idea some time after. If I think about it, I could’ve made it in around three days if I’d worked continuously. Hmm, who knows... Idk why I spent my time on this useless idea. The idea was good enough, but the execution… huff. Maybe someone in the near future will complete my vision—even if I’m dead by then, who knows. Wow, I sound like a wise old fellow.

If you star my repository, I’ll star yours hehe. Here’s the challenge: think you’re experienced? Prove it. Download and run this extension, then make something better out of the scuffed mess my vibe coding produced. Fix the weak parts, push the idea further, and build the version I couldn’t. Or is talking about how easy it is all you’ve got? I don’t want advice—I want to see you ship it. There’s a **Whole Vision** Easter egg waiting for you when you download and run the extension. I want to see if anyone can complete that vision.

Anyway, why are you reading all this? Go to the supposedly useless [uselessguide.md](uselessguide.md) and get on with it.

## Security details

This section describes the current implementation and its trust boundaries. The exact host names, code paths, and field selectors are inspectable in the source.

### Extension permissions and page access

- The Manifest V3 manifest declares Chrome's `storage` and `activeTab` permissions, plus host access for two specific HTTPS origins and one loopback HTTP service. It does not request `history`, `cookies`, `webRequest`, `identity`, or `<all_urls>`.
- The content script runs only on the two site origins declared in the manifest. It reads selected DOM elements; it does not use Chrome's browsing-history API or read unrelated tabs. The manual action runs against the active supported tab.
- The extension does not implement project accounts, a hosted application backend, or preference synchronization.

### Data storage and outbound requests

- Preferences and lightweight feedback are stored with `chrome.storage.local` in the current Chrome profile. This is browser-managed local storage, not encryption provided by this project.
- For automatic processing, the extension serializes a bounded batch of at most eight visible items. Per item, the source caps the identifier at 100 characters, title at 350, channel/source name at 180, and description at 800. For manual analysis, caps are 500 characters for title, 250 for channel/source, 6,000 for description, and 18,000 for text available in the page's transcript panel.
- Those fields go from the content script to the local Node service. Preference fields are not included in those classification requests; preference matching runs in the extension. The service accepts request bodies up to 70,000 characters and responds with `Cache-Control: no-store`.
- The service forwards submitted text to the configured model provider. OpenAI mode sends it over HTTPS to OpenAI's API; provider retention and handling are governed by OpenAI's current terms and settings. Ollama mode sends it to `OLLAMA_HOST`, defaulting to `http://127.0.0.1:11434`. A non-loopback Ollama host receives the text outside the local machine; verify that host and its transport/security before using it.
- No custom project database or persistent server-side content store is implemented. The server keeps its request-rate timestamps in memory; submitted text is not deliberately written to disk by the service.

### Credentials and provider costs

- The OpenAI key is read by the local Node process from `server/.env`; it is not embedded in the extension bundle. The repository's `.gitignore` excludes `.env` files, but Git ignore rules do not protect a key if it is copied, committed elsewhere, or exposed from the computer. Keep the file private, rotate any exposed key, and set provider-side usage limits.
- An OpenAI key can incur charges. Using a local Ollama instance avoids sending the model request to OpenAI, but it uses the computer's resources. The extension does not control provider retention, pricing, quotas, or the security of a separately configured Ollama host.

### Local service threat model

- The Node service binds to `127.0.0.1` on port `8787` by default, so it is not intended to listen on the LAN or public internet. Do not change the bind address, port-forward it, or put it behind a public proxy.
- **There is no authentication or per-request secret.** The service also sets `Access-Control-Allow-Origin: *` and permits JSON POST requests. Loopback binding and browser CORS behavior are not authentication: assume any local process, and any web origin that can reach the endpoint, may invoke it.
- A request that reaches the service can cause the configured provider to process attacker-chosen text. With a paid provider, that may consume the configured key's quota; the in-memory limit of 20 requests per minute per IP is only a basic throttle, resets when the process restarts, and is not a security boundary.
- For data requests, the service exposes two POST processing routes and a health check; it also answers OPTIONS preflight requests. It validates required input, caps request size, and limits output labels/categories to known values. These checks reduce malformed input and output; they do not replace authentication or prevent a model from making a wrong classification.
- The submitted page text is untrusted input. Model instructions ask the provider to classify it and return JSON; response parsing and allow-lists constrain the returned structure, but prompt injection or misleading text can still affect labels and filtering decisions. The model has no tools or direct browser access.

### Audit status

This is an experimental prototype and has not had an independent security audit. That is a statement of audit status, not a claim that the project is safe or unsafe.

## Contact

You can contact me at [vv1232011@gmail.com](mailto:vv1232011@gmail.com). I don’t use the other apps, so Gmail only. No DMs, just G-mails.

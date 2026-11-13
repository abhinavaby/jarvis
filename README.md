# JARVIS — Personal AI Companion

A browser-based voice companion. Choose a local OpenAI-compatible server or the OpenAI API as its model provider.

## Run the website

Serve this folder from a local web server (microphone APIs generally require `localhost` or HTTPS):

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Choose an AI provider

Open **Connection settings** and choose a provider. The site sends requests to `<base URL>/chat/completions`.

### Local model

Enter your model server's OpenAI-compatible API base URL, model name, and an API key if required. For example, with Ollama's OpenAI-compatible API:

- Base URL: `http://localhost:11434/v1`
- Model: the model name installed in Ollama, such as `llama3.2`

For a port-forwarded model, use the forwarded URL reachable from the browser on this computer. The model server must accept browser requests from the website's origin (CORS).

### OpenAI API

Select **OpenAI API**, enter your OpenAI API key, and choose a model (the default is `gpt-4o-mini`). Requests go from the browser directly to OpenAI. The key is stored in this browser's local storage, where browser scripts and anyone using this browser profile can access it. Use this only for private local testing; do not host the site publicly with a personal key. For a public deployment, put the key behind a secured backend instead.

Use **Test connection** to check either provider. Errors from the server are shown in the settings dialog; the app does not silently switch providers.

Settings are stored in this browser's local storage. Chat history exists only for the current page session. Click the orb once to start hands-free voice mode; it keeps listening between turns, speaks replies, and stops speaking when it detects your voice. Click the orb again to end voice mode. Speech recognition uses the browser's Speech Recognition API (available in supported browsers, often Chrome) and may use that browser's recognition service. Headphones can help prevent the assistant's voice from being picked up as your speech.

const STORAGE_KEY = "jarvis-companion-settings";
const SYSTEM_PROMPT =
  "You are JARVIS, a warm, thoughtful, capable personal AI companion. Be conversational and concise by default. Listen carefully, ask thoughtful follow-up questions, and be honest about what you do not know.";
const DEFAULT_SETTINGS = {
  provider: "local",
  endpoint: "http://localhost:11434/v1",
  model: "llama3.2",
  apiKey: "",
};

const elements = {
  form: document.querySelector("#chat-form"),
  input: document.querySelector("#message-input"),
  send: document.querySelector("#send-button"),
  thread: document.querySelector("#chat-thread"),
  welcome: document.querySelector("#welcome-block"),
  error: document.querySelector("#error-banner"),
  status: document.querySelector("#model-status"),
  statusLabel: document.querySelector("#status-label"),
  modal: document.querySelector("#settings-modal"),
  settingsForm: document.querySelector("#settings-form"),
  provider: document.querySelector("#provider-input"),
  endpoint: document.querySelector("#endpoint-input"),
  endpointHelp: document.querySelector("#endpoint-help"),
  model: document.querySelector("#model-input"),
  key: document.querySelector("#key-input"),
  keyOptional: document.querySelector("#key-optional"),
  settingsError: document.querySelector("#settings-error"),
  testButton: document.querySelector("#test-connection"),
  micButton: document.querySelector("#mic-button"),
  orbButton: document.querySelector("#orb-button"),
  orbCaption: document.querySelector("#orb-caption"),
};

let settings = loadSettings();
let messages = [];
let recognition = null;
let voiceMode = false;
let busy = false;
let voiceProcessing = false;
let voiceFinalTranscript = "";
let voiceSilenceTimer = null;
let speechUtterance = null;

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
  } catch (error) {
    console.error("Could not read saved connection settings.", error);
    return { ...DEFAULT_SETTINGS };
  }
}

function setStatus(connected, label) {
  elements.status.classList.toggle("connected", connected);
  elements.statusLabel.textContent = label;
}

function openSettings() {
  elements.provider.value = settings.provider;
  elements.endpoint.value = settings.endpoint;
  elements.model.value = settings.model;
  elements.key.value = settings.apiKey;
  updateProviderFields();
  showSettingsError("");
  elements.modal.classList.remove("hidden");
  elements.endpoint.focus();
}

function updateProviderFields() {
  const isOpenAI = elements.provider.value === "openai";
  elements.endpointHelp.textContent = isOpenAI
    ? "OpenAI API endpoint. Your key and requests are sent directly from this browser."
    : "Use your local server’s OpenAI-compatible API URL.";
  elements.key.placeholder = isOpenAI ? "Required for OpenAI API requests" : "Only if your endpoint requires one";
  elements.keyOptional.textContent = isOpenAI ? "(required)" : "(optional)";
  elements.key.required = isOpenAI;
}

function closeSettings() {
  elements.modal.classList.add("hidden");
}

function showSettingsError(message) {
  elements.settingsError.textContent = message;
  elements.settingsError.classList.toggle("hidden", !message);
  elements.settingsError.style.color = "";
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
  elements.error.textContent = "";
  elements.error.classList.add("hidden");
}

function requestUrl(endpoint) {
  return `${endpoint.trim().replace(/\/+$/, "")}/chat/completions`;
}

function getSettingsFromForm() {
  const provider = elements.provider.value;
  const endpoint = elements.endpoint.value.trim().replace(/\/+$/, "");
  const model = elements.model.value.trim();
  const apiKey = elements.key.value.trim();
  if (!endpoint || !model) throw new Error("Enter both an API base URL and a model name.");
  if (provider === "openai" && !apiKey) throw new Error("Enter an OpenAI API key to use the OpenAI provider.");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Enter a valid API base URL, including http:// or https://.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The API base URL must use http:// or https://.");
  }
  return { provider, endpoint, model, apiKey };
}

async function callModel(payload, config = settings) {
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let response;
  try {
    response = await fetch(requestUrl(config.endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${config.endpoint}. Check the URL, that your port forward is active, and that the model server allows browser requests (CORS).`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    const message = detail ? `: ${detail.slice(0, 240)}` : "";
    throw new Error(`Model server returned ${response.status} ${response.statusText}${message}`);
  }
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The model returned an empty or unsupported response. Check that the endpoint uses the OpenAI chat completions format.");
  }
  return content.trim();
}

function addMessage(role, content, pending = false) {
  const row = document.createElement("article");
  row.className = `message ${role}`;
  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "A" : "✳";
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role === "user" ? "YOU" : "JARVIS";
  body.append(meta);

  if (pending) {
    const dots = document.createElement("div");
    dots.className = "typing-dots";
    dots.innerHTML = "<i></i><i></i><i></i>";
    body.append(dots);
  } else {
    const text = document.createElement("div");
    text.textContent = content;
    body.append(text);
    if (role === "assistant") {
      const tools = document.createElement("div");
      tools.className = "message-tools";
      const speak = document.createElement("button");
      speak.type = "button";
      speak.textContent = "Read aloud";
      speak.addEventListener("click", () => speakText(content));
      tools.append(speak);
      body.append(tools);
    }
  }
  row.append(avatar, body);
  elements.thread.append(row);
  elements.thread.scrollTop = elements.thread.scrollHeight;
  return row;
}

async function sendMessage(rawMessage) {
  const content = rawMessage.trim();
  if (!content || busy) return;
  if (!settings.endpoint || !settings.model) {
    stopVoiceMode();
    openSettings();
    showSettingsError("Connect an AI provider before starting a conversation.");
    return;
  }

  clearError();
  elements.welcome.classList.add("hidden");
  elements.thread.classList.remove("hidden");
  elements.input.value = "";
  resizeInput();
  elements.send.disabled = true;
  busy = true;
  messages.push({ role: "user", content });
  addMessage("user", content);
  const pending = addMessage("assistant", "", true);
  elements.statusLabel.textContent = "Thinking";

  try {
    const answer = await callModel({
      model: settings.model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: false,
    });
    pending.remove();
    messages.push({ role: "assistant", content: answer });
    addMessage("assistant", answer);
    setStatus(true, settings.provider === "openai" ? `OpenAI · ${settings.model}` : settings.model);
    if (voiceMode) {
      voiceProcessing = false;
      speakText(answer, true);
    }
    const firstUserMessage = messages.find((message) => message.role === "user")?.content;
    if (firstUserMessage && elements.thread.querySelectorAll(".message.user").length === 1) {
      document.querySelector("#conversation-title").textContent =
        firstUserMessage.length > 23 ? `${firstUserMessage.slice(0, 23)}…` : firstUserMessage;
    }
  } catch (error) {
    pending.remove();
    messages.pop();
    setStatus(false, "Connection issue");
    showError(error instanceof Error ? error.message : "Something went wrong while contacting your model.");
  } finally {
    busy = false;
    voiceProcessing = false;
    elements.send.disabled = !elements.input.value.trim();
    if (voiceMode && !recognition && !voiceSilenceTimer) startVoiceRecognition();
    else if (!voiceMode) elements.input.focus();
  }
}

function resizeInput() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 130)}px`;
  elements.send.disabled = !elements.input.value.trim() || busy;
}

function showRecognitionError(event) {
  const messagesByCode = {
    "not-allowed": "Microphone access was denied. Allow microphone access in your browser settings and try again.",
    "no-speech": "I didn’t hear anything. Try again when you’re ready.",
    "audio-capture": "No microphone was found. Connect a microphone and try again.",
    network: "Speech recognition is unavailable right now. You can still type a message.",
  };
  if (event.error === "no-speech" && voiceMode) return;
  showError(messagesByCode[event.error] || `Speech recognition stopped: ${event.error}.`);
  if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) stopVoiceMode();
}

function setOrbCaption(message) {
  elements.orbCaption.innerHTML = `<span class="mic-symbol">⌁</span> ${message}`;
}

function startVoiceRecognition() {
  if (!voiceMode || recognition || voiceProcessing) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError("Speech recognition is not available in this browser. Try a recent version of Chrome or type your message instead.");
    stopVoiceMode();
    return;
  }
  const currentRecognition = new SpeechRecognition();
  recognition = currentRecognition;
  currentRecognition.lang = navigator.language || "en-US";
  currentRecognition.interimResults = true;
  currentRecognition.continuous = true;
  currentRecognition.onstart = () => {
    elements.micButton.classList.add("listening");
    elements.orbButton.classList.add("listening");
    setOrbCaption("VOICE MODE · TAP TO STOP");
  };
  currentRecognition.onresult = (event) => {
    let interim = "";
    let heardSpeech = false;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0].transcript;
      if (!transcript.trim()) continue;
      heardSpeech = true;
      if (result.isFinal) voiceFinalTranscript += `${transcript} `;
      else interim += transcript;
    }
    if (!heardSpeech) return;
    if (speechUtterance) {
      window.speechSynthesis.cancel();
      speechUtterance = null;
      setOrbCaption("LISTENING…");
    }
    elements.input.value = `${voiceFinalTranscript}${interim}`.trim();
    resizeInput();
    if (voiceFinalTranscript.trim()) {
      clearTimeout(voiceSilenceTimer);
      voiceSilenceTimer = setTimeout(submitVoiceTurn, 1100);
    }
  };
  currentRecognition.onerror = showRecognitionError;
  currentRecognition.onend = () => {
    if (recognition === currentRecognition) recognition = null;
    if (!voiceMode) {
      elements.micButton.classList.remove("listening");
      elements.orbButton.classList.remove("listening");
    } else if (!voiceProcessing && !voiceSilenceTimer) {
      setTimeout(startVoiceRecognition, 250);
    }
  };
  try {
    currentRecognition.start();
  } catch (error) {
    if (recognition === currentRecognition) recognition = null;
    showError(error instanceof Error ? error.message : "Could not start microphone listening.");
    stopVoiceMode();
  }
}

function submitVoiceTurn() {
  clearTimeout(voiceSilenceTimer);
  voiceSilenceTimer = null;
  const transcript = voiceFinalTranscript.trim();
  voiceFinalTranscript = "";
  if (!voiceMode || !transcript || busy) return;
  voiceProcessing = true;
  setOrbCaption("THINKING…");
  if (recognition) recognition.stop();
  void sendMessage(transcript);
}

function stopVoiceMode() {
  voiceMode = false;
  voiceProcessing = false;
  voiceFinalTranscript = "";
  clearTimeout(voiceSilenceTimer);
  voiceSilenceTimer = null;
  window.speechSynthesis?.cancel();
  speechUtterance = null;
  if (recognition) recognition.stop();
  elements.micButton.classList.remove("listening");
  elements.orbButton.classList.remove("listening");
  setOrbCaption("TAP TO TALK");
}

function toggleListening() {
  if (voiceMode) {
    stopVoiceMode();
    return;
  }
  if (recognition) {
    recognition.stop();
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError("Speech recognition is not available in this browser. Try a recent version of Chrome or type your message instead.");
    return;
  }
  clearError();
  const dictation = new SpeechRecognition();
  recognition = dictation;
  dictation.lang = navigator.language || "en-US";
  dictation.interimResults = true;
  dictation.continuous = false;
  dictation.onstart = () => elements.micButton.classList.add("listening");
  dictation.onresult = (event) => {
    let transcript = "";
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index][0].transcript;
    }
    elements.input.value = transcript;
    resizeInput();
  };
  dictation.onerror = showRecognitionError;
  dictation.onend = () => {
    if (recognition === dictation) recognition = null;
    elements.micButton.classList.remove("listening");
    if (elements.input.value.trim()) elements.input.focus();
  };
  try {
    dictation.start();
  } catch (error) {
    recognition = null;
    showError(error instanceof Error ? error.message : "Could not start microphone listening.");
  }
}

function toggleVoiceMode() {
  if (voiceMode) {
    stopVoiceMode();
    return;
  }
  clearError();
  voiceFinalTranscript = "";
  voiceMode = true;
  startVoiceRecognition();
}

function speakText(text, resumeVoice = false) {
  if (!("speechSynthesis" in window)) {
    if (resumeVoice) {
      stopVoiceMode();
    }
    showError("Text-to-speech is not available in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  speechUtterance = utterance;
  utterance.onend = () => {
    if (speechUtterance !== utterance) return;
    speechUtterance = null;
    if (resumeVoice && voiceMode) startVoiceRecognition();
  };
  utterance.onerror = () => {
    if (speechUtterance === utterance) speechUtterance = null;
  };
  if (resumeVoice && voiceMode) startVoiceRecognition();
  window.speechSynthesis.speak(utterance);
}

async function testConnection() {
  showSettingsError("");
  elements.testButton.disabled = true;
  elements.testButton.textContent = "Testing…";
  try {
    const candidateSettings = getSettingsFromForm();
    await callModel({
      model: candidateSettings.model,
      messages: [{ role: "user", content: "Reply with exactly: Connection successful." }],
      max_tokens: 20,
      stream: false,
    }, candidateSettings);
    settings = candidateSettings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setStatus(true, candidateSettings.provider === "openai" ? `OpenAI · ${settings.model}` : settings.model);
    showSettingsError("Connected successfully. You can start chatting.");
    elements.settingsError.classList.remove("hidden");
    elements.settingsError.style.color = "#8ce0cb";
  } catch (error) {
    showSettingsError(error instanceof Error ? error.message : "Could not test this connection.");
    elements.settingsError.style.color = "";
  } finally {
    elements.testButton.disabled = false;
    elements.testButton.textContent = "Test connection";
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(elements.input.value);
});
elements.input.addEventListener("input", resizeInput);
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});
document.querySelectorAll(".suggestion-card").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt || ""));
});
document.querySelectorAll("#open-settings, #open-settings-top, #open-settings-footer").forEach((button) => {
  button.addEventListener("click", openSettings);
});
document.querySelector("#close-settings").addEventListener("click", closeSettings);
elements.modal.addEventListener("click", (event) => {
  if (event.target === elements.modal) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    resetConversation();
  }
});
elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    settings = getSettingsFromForm();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setStatus(false, settings.provider === "openai" ? "OpenAI · ready" : "Ready to connect");
    showSettingsError("");
    closeSettings();
  } catch (error) {
    showSettingsError(error instanceof Error ? error.message : "Check your connection settings.");
  }
});
elements.provider.addEventListener("change", () => {
  if (elements.provider.value === "openai") {
    if (elements.endpoint.value.trim() === DEFAULT_SETTINGS.endpoint) {
      elements.endpoint.value = "https://api.openai.com/v1";
    }
    if (elements.model.value.trim() === DEFAULT_SETTINGS.model) {
      elements.model.value = "gpt-4o-mini";
    }
  } else {
    if (elements.endpoint.value.trim() === "https://api.openai.com/v1") {
      elements.endpoint.value = DEFAULT_SETTINGS.endpoint;
    }
    if (elements.model.value.trim() === "gpt-4o-mini") {
      elements.model.value = DEFAULT_SETTINGS.model;
    }
  }
  updateProviderFields();
});
elements.testButton.addEventListener("click", testConnection);
elements.micButton.addEventListener("click", toggleListening);
elements.orbButton.addEventListener("click", toggleVoiceMode);
document.querySelector("#voice-shortcut").addEventListener("click", toggleVoiceMode);
document.querySelector("#new-chat").addEventListener("click", resetConversation);
document.querySelector("#mobile-menu").addEventListener("click", () => {
  document.querySelector(".sidebar").classList.toggle("open");
});
document.querySelector("#conversation-list").addEventListener("click", () => {
  document.querySelector(".sidebar").classList.remove("open");
});

function resetConversation() {
  messages = [];
  elements.thread.replaceChildren();
  elements.thread.classList.add("hidden");
  elements.welcome.classList.remove("hidden");
  elements.input.value = "";
  resizeInput();
  clearError();
  document.querySelector("#conversation-title").textContent = "A fresh start";
  document.querySelector(".sidebar").classList.remove("open");
}

if (settings.endpoint && settings.model) {
  setStatus(false, "Ready to connect");
  if (settings.provider === "openai") elements.statusLabel.textContent = "OpenAI · not connected";
}

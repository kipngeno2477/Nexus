# Running Nexus on your own computer

This guide takes you from nothing installed to Nexus running in your browser at
`http://localhost:5173`. It takes about 15 minutes. It works on **Windows, macOS and Linux**.

You will run two small programs:
- the **backend** (the API that searches the law and talks to the AI model), on port **5000**
- the **frontend** (the web page you use), on port **5173**

---

## Contents
1. [What you need](#1-what-you-need)
2. [Install Node.js 22](#2-install-nodejs-22)
3. [Get the code](#3-get-the-code)
4. [Install the dependencies](#4-install-the-dependencies)
5. [Choose an AI model](#5-choose-an-ai-model)
6. [Start Nexus](#6-start-nexus)
7. [Check that it works](#7-check-that-it-works)
8. [Optional: tests and evaluation](#8-optional-tests-and-evaluation)
9. [Stopping and updating](#9-stopping-and-updating)
10. [Troubleshooting](#10-troubleshooting)
11. [Alternative: run with Docker](#11-alternative-run-with-docker)

---

## 1. What you need

| Requirement | Why | Check with |
|---|---|---|
| **Node.js 22** (comes with npm) | runs the backend and builds the frontend. **Node 18 or 20 will not work** | `node -v` should print `v22.x.x` |
| **Git** | to download the code | `git --version` |
| **One AI model option** (see step 5) | writes the answers | |
| ↳ *Option A:* a free **Groq API key** | fast, recommended (about 1 second per answer) | |
| ↳ *Option B:* **Ollama** + about 3 GB of free RAM | fully offline, but slow on laptops (45–65 seconds per answer) | `ollama -v` |
| About 1 GB of disk space | dependencies | |
| Access to the GitHub repository | the code is at `github.com/kipngeno2477/Nexus` | ask the repo owner if you get "not found" |

---

## 2. Install Node.js 22

Use a version manager. It lets you switch Node versions without breaking anything else.

**macOS / Linux** (with [nvm](https://github.com/nvm-sh/nvm)):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# close and reopen your terminal, then:
nvm install 22
nvm use 22
node -v        # v22.x.x
```

**Windows** (with [nvm-windows](https://github.com/coreybutler/nvm-windows/releases)): download and
run `nvm-setup.exe`, then open a **new** PowerShell window:
```powershell
nvm install 22
nvm use 22
node -v        # v22.x.x
```

> No version manager? Install the **Node.js 22 LTS** installer from <https://nodejs.org> instead.

**Git**, if you don't have it: <https://git-scm.com/downloads> (on macOS, `xcode-select --install` also works).

---

## 3. Get the code

```bash
git clone https://github.com/kipngeno2477/Nexus.git
cd Nexus
```

(If you use SSH keys with GitHub: `git clone git@github.com:kipngeno2477/Nexus.git`.)

If you installed Node with nvm, run `nvm use` inside the `Nexus` folder. It reads `.nvmrc`
and switches to Node 22 automatically.

---

## 4. Install the dependencies

Run these from the `Nexus` folder. **Make sure `node -v` shows v22 first.** Installing with an
older Node leaves the frontend unable to build (see [Troubleshooting](#10-troubleshooting)).

```bash
cd Backend
npm install
cd ../Frontend
npm install
cd ..
```

Both should finish without errors. Warnings about funding or deprecated packages are fine.

---

## 5. Choose an AI model

Nexus needs a language model to write answers. Settings go in a file called `Backend/.env`.
Create it from the template:

```bash
# macOS / Linux
cp Backend/.env.example Backend/.env
```
```powershell
# Windows PowerShell
Copy-Item Backend\.env.example Backend\.env
```

Open `Backend/.env` in any text editor and set **one** of the options below.

> **Never commit `Backend/.env` or share your API key.** The file is already listed in `.gitignore`.

### Option A: Groq (recommended: fast and free)

1. Sign up at <https://console.groq.com> and create a key under **API Keys**. It starts with `gsk_`.
2. In `Backend/.env`, **replace** the five `LLM_` lines at the top (`LLM_PROVIDER` to `LLM_TIMEOUT_MS`) with:

```ini
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=qwen/qwen3.8-27b
LLM_REASONING_EFFORT=none
LLM_FALLBACK_MODEL=openai/gpt-oss-20b
LLM_FALLBACK_REASONING_EFFORT=low
LLM_API_KEY=gsk_your_key_here
LLM_TIMEOUT_MS=30000
```

Write each line as `NAME=value`, without quotes. The URL must end in **`/openai/v1`**.

The free tier allows roughly 4–6 answers a minute. If you go faster, Nexus switches to the
fallback model or asks you to wait a few seconds.

### Option B: Ollama (offline, no account)

1. Install Ollama from <https://ollama.com/download>, then download the model (about 1.9 GB):
   ```bash
   ollama pull qwen2.5:3b
   ```
2. The template's defaults already point at Ollama, so **leave the `LLM_` lines as they are**:
   ```ini
   LLM_PROVIDER=ollama
   LLM_BASE_URL=http://localhost:11434
   LLM_MODEL=qwen2.5:3b
   ```
3. Make sure Ollama is running (it starts in the background after installation; `ollama list` should
   show `qwen2.5:3b`).

On a typical laptop CPU each answer takes **45–65 seconds**. If your computer has little free
memory, add `LLM_NUM_CTX=4096`, or use the smaller `qwen2.5:1.5b`.

### No model at all?

Nexus still runs. Searching, the source passages, the document upload and all the checks work;
only the written answer is replaced by "Answer generator unavailable" plus the relevant passages
of the law.

### Optional settings
- `DEMO_FAILURES=true` adds a **Simulate** menu for showing model or search outages.
- Everything else can stay at its default. The full list is in [README.md §11](README.md#11-configuration-reference).

---

## 6. Start Nexus

Pick **one** of these ways.

### Way 1: development mode (two terminals, live reload)

**Terminal 1, the backend:**
```bash
cd Nexus/Backend
npm run dev
```
Wait until you see:
```
Knowledge base: 1 docs, 53 chunks
LLM: openai_compatible qwen/qwen3.8-27b @ https://api.groq.com/openai/v1
Server running on port 5000
```

**Terminal 2, the frontend:**
```bash
cd Nexus/Frontend
npm run dev
```
Wait for `Local: http://localhost:5173/`, then open **<http://localhost:5173>** in your browser.

### Way 2: one server (closest to the real deployment)

```bash
cd Nexus/Frontend
npm run build
cd ../Backend
npm start
```
Open **<http://localhost:5000>**. The backend serves the built web page itself, so you only need
one terminal. After changing frontend code, run `npm run build` again.

---

## 7. Check that it works

1. **Health check:** open <http://localhost:5000/healthz>. It should show `{"ok":true,"chunks":53}`.
2. **Top-right of the page:** two green dots, one showing **53 chunks** and one showing the model name.
   A red dot labelled "model offline" means the model settings in step 5 need fixing.
3. **Ask a question:** click the example **"How much does it cost to request information?"**.
   You should get a green **"Answered from the documents"** banner, with citation numbers that link to
   *12. Fees*.
4. **Check that it refuses off-topic questions:** ask *"How do I get a passport?"*. You should see an
   amber **"Not enough evidence"** banner, and no made-up answer.
5. **Upload your own document:** click the **paperclip** in the question bar, choose a PDF (with
   selectable text), `.txt` or `.md` file, then ask about it. PDFs are converted to text in your
   browser. The **Search in** bar above the question box switches to your document; set it to
   *All documents* to search everything. Only you can see uploaded documents, and they are deleted
   after an hour.
6. **See how it works:** expand **"How this answer was produced"** to see the workflow steps and
   the top-K passages picked by the heap.

You can also ask questions from the terminal, without the web page (with the backend's `.env` configured):
```bash
cd Nexus/Backend
npm run ask -- "Who can I complain to if my request is refused?"
```

---

## 8. Optional: tests and evaluation

From `Nexus/Backend`:

```bash
npm test                            # 74 automated tests, about 10 seconds, no internet needed
npm run bench                       # heap vs full-sort speed comparison
npm run eval -- --retrieval-only    # search-quality metrics, no AI calls
npm run eval                        # full 27-question evaluation (Groq: about 6 minutes; uses quota)
```

Results are written to `Backend/eval-results/latest.md`. See [EVALUATION.md](EVALUATION.md) for what
the numbers mean.

---

## 9. Stopping and updating

- **Stop:** press `Ctrl + C` in each terminal.
- **Update to the latest code:**
  ```bash
  cd Nexus
  git pull
  cd Backend && npm install
  cd ../Frontend && npm install
  ```
  Then start again (step 6). Your `Backend/.env` is kept.

---

## 10. Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`, or Vite/ESLint refusing to start | Node is older than 22 | `nvm use 22` (or install Node 22), then delete `Frontend/node_modules` and run `npm install` again |
| `Cannot find native binding` / `Cannot find module '@rolldown/binding-…'` when building the frontend | Dependencies were installed with an older Node | With Node 22 active: delete `Frontend/node_modules` and run `npm install` |
| `Error: listen EADDRINUSE: address already in use :::5000` | Something else is using port 5000. **On macOS this is often "AirPlay Receiver"** | Set `PORT=5050` in `Backend/.env`, then start the frontend with the new address: `VITE_API_TARGET=http://localhost:5050 npm run dev` (PowerShell: `$env:VITE_API_TARGET="http://localhost:5050"; npm run dev`). Or turn off AirPlay Receiver in System Settings → General → AirDrop & Handoff |
| The page loads but shows **"server offline"** | The backend isn't running, or is on a different port | Start the backend (step 6) and check its terminal for errors |
| **"Answer generator unavailable"** on every question | Model settings are wrong or the model is unreachable | Open <http://localhost:5000/api/health> and look at the `model` section. Then check the rows below |
| `401 Invalid API Key` in the details panel or terminal | Wrong, expired or mistyped Groq key | Paste the key again as `LLM_API_KEY=gsk_…`, without quotes or spaces, and restart the backend |
| `404 Unknown request URL` | Wrong Groq URL | It must be exactly `https://api.groq.com/openai/v1` |
| `LLM endpoint unreachable: ECONNREFUSED` (Ollama) | Ollama isn't running | Start the Ollama app, or run `ollama serve`; check with `ollama list` |
| "The answer service is busy (free-tier rate limit)" | More than about 4–6 answers a minute on Groq's free tier | Wait 10–60 seconds. Repeated questions are cached and cost nothing |
| "Please slow down" | Nexus's own limit of 10 questions per minute per user | Wait a minute, or raise `ASK_RATE_LIMIT` in `.env` |
| Answers take about a minute | Ollama running on the CPU | Expected. Use Groq for speed, or keep using Ollama for offline work |
| Changes to `.env` have no effect | The backend reads `.env` only when it starts | Stop it (`Ctrl + C`) and start it again |
| `npm install` fails behind a company or campus proxy | Network restrictions | Run `npm config set proxy http://your-proxy:port` (and `https-proxy`), or use another network |
| "No selectable text found… scanned PDF" | The PDF is a scan (images only); there is no OCR | Use a PDF with selectable text (you can highlight words in it), or paste the text |
| "Please choose a .pdf, .txt or .md file" | Word, images and other formats aren't supported | In Word: *Save As → PDF* or *Plain Text* |
| "This PDF is password-protected" | Encrypted PDF | Remove the password (e.g. print to a new PDF) and try again |

Still stuck? Run `npm test` in `Backend/`. If the tests pass, the code is fine, and the problem is
the `.env` settings or the network.

---

## 11. Alternative: run with Docker

If you have Docker, you can skip installing Node:

```bash
cd Nexus
docker build -t nexus .
docker run --rm -p 8080:8080 \
  -e LLM_PROVIDER=openai_compatible \
  -e LLM_BASE_URL=https://api.groq.com/openai/v1 \
  -e LLM_MODEL=qwen/qwen3.8-27b \
  -e LLM_REASONING_EFFORT=none \
  -e LLM_FALLBACK_MODEL=openai/gpt-oss-20b \
  -e LLM_FALLBACK_REASONING_EFFORT=low \
  -e LLM_API_KEY=gsk_your_key_here \
  nexus
```
Open **<http://localhost:8080>**. (On Windows PowerShell, replace each trailing `\` with a backtick `` ` ``.)
On Linux, prefix the commands with `sudo` if your user isn't in the `docker` group.

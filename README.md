# Image Keyword Generator (Local Qwen + Ollama)

A small local web app that lets you upload an image and generates keywords + a reusable prompt for image generation.

## Prerequisites

- Ollama running locally
- A vision-capable Qwen model pulled in Ollama

Example:

```bash
ollama pull qwen3.5:9b
```

## Run

### 1) Start the backend

```bash
python -m venv .venv
.venv\\Scripts\\activate
pip install -r backend\\requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

### 2) Open the UI

Go to:

- http://localhost:8000

Random prompt page:

- http://localhost:8000/random

## Config

Environment variables:

- `OLLAMA_BASE_URL` (default: `http://localhost:11434`)
- `OLLAMA_MODEL` (default: `qwen3.5:9b`)
- `DB_PATH` (default: `backend/keywords.sqlite3`)

Example:

```bash
set OLLAMA_MODEL=qwen3.5:9b
set OLLAMA_BASE_URL=http://localhost:11434
python -m uvicorn backend.main:app --reload --port 8000
```

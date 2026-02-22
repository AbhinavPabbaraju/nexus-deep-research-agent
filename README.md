# NEXUS · Deep Research Agent

**Production-grade multi-provider AI research agent with contextual memory, RAG pipeline, multi-pass synthesis, and confidence scoring**

<br/>

[![Deploy with Vercel](https://vercel.com/button)](https://nexus-deep-research-agent.vercel.app)
&nbsp;
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ecf8e?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

## ✨ Features

### 🤖 Multi-Provider LLM Support
| Provider | Models |
|---|---|
| **Anthropic** | Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5 |
| **OpenAI** | GPT-4o, GPT-4o Mini, GPT-4 Turbo, o1 Preview, o1 Mini |
| **Google Gemini** | Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash |
| **NVIDIA NIM** | Llama 3.1 405B, Mixtral 8x22B, Nemotron 340B, Gemma 2 27B |

Switch providers mid-session — each has its own secure API key panel.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier works)
- At least one LLM provider API key

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/nexus-deep-research-agent.git
cd nexus-deep-research-agent
npm install
```

### 2. Set up Supabase

Create a new Supabase project, then run this in the **SQL Editor**:

```sql
-- Research history
create table research_history (
  id uuid default gen_random_uuid() primary key,
  user_id text,
  query text not null,
  answer text,
  confidence float,
  provider text,
  model text,
  depth text,
  created_at timestamptz default now()
);

-- Memory contexts
create table memory_contexts (
  id uuid default gen_random_uuid() primary key,
  user_id text,
  query text not null,
  answer text,
  provider text,
  model text,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table research_history enable row level security;
alter table memory_contexts enable row level security;
```

### 3. Configure environment variables

Create `.env.local` in the project root:

```env
# Supabase
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key

# LLM Providers (add whichever you have)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIza...
NVIDIA_API_KEY=nvapi-...
```

> ⚠️ Never commit `.env.local` — it's in `.gitignore` by default.

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — NEXUS is running.

---

## ☁️ Deploying to Vercel

### Option A — One-click (recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/nexus-deep-research-agent)

### Option B — Manual deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Then go to **Vercel Dashboard → Settings → Environment Variables** and add all the keys from your `.env.local`.

Every `git push` to `main` triggers an automatic redeploy.

---

# Span

A visual, patent-ready educational software tool for mapping math concepts, powered by an AI-driven recommendation engine.

---

## Features

- **Sidebar:** Drag-and-drop from a detailed, expandable math concept hierarchy.
- **Canvas:** Arrange, link, annotate concepts; create a custom math map.
- **AI Recommendations:** Get smart suggestions for related concepts based on what you’re working on.
- **Backend AI:** Python Flask server computes recommendations using curriculum structure and map context.

---

## Files

- `index.html` — Landing page explaining the tool, with a link into the playground.
- `playground.html` — The interactive map UI (sidebar, canvas, AI panel; includes all CSS/JS).
- `settings.html` / `settings.js` — Color theme picker + lean class management (create/join a
  class; a no-login "preview as Student/Teacher" demo toggle for signed-out visitors). The
  deep per-class view lives on `dashboard.html` instead - each class here links out to it.
- `dashboard.html` / `dashboard.js` — Teacher Dashboard: roster, a live-thumbnail "Class at a
  Glance" card grid, and Class Insights (most-explored/hub/isolated concepts, classwide
  prerequisite gaps aware of what the teacher has marked taught, student progress, curriculum
  coverage). Supports `?sample=1` (no login) and `?class=<id>` (deep link to one class).
- `theme.js` — Color theme presets, applied on every page.
- `app.js` — All front-end logic for the playground.
- `auth.js` — Accounts, cloud map storage, and rostering (Supabase). See "Accounts & Cloud
  Save" below.
- `vendor/supabase.js` — Vendored `@supabase/supabase-js` UMD build (committed, not loaded from a CDN).
- `concepts.json` — Math concepts, organized by grade/unit/topic.
- `ai_recommender.py` — Flask API backend for AI-driven recommendations.
- `supabase-schema.sql` — Database schema + Row Level Security policies for cloud map storage
  and rostering.
- `README.md` — This file.

---

## How to Run Locally

1. **Start Backend (AI Recommendation Engine)**
   - Ensure you have Python 3 and Flask:
     ```sh
     pip install flask flask-cors
     ```
   - Start the server:
     ```sh
     python ai_recommender.py
     ```
   - By default, runs at `http://localhost:5000`

2. **Open the demo site**
   - Either open `static/index.html` directly in your browser (no web server needed), or
     visit `http://localhost:5000/` once the Flask backend is running.
   - The landing page explains the tool; click "Open the Playground" to reach `playground.html`.

3. **Usage**
   - Drag topics from the sidebar to the canvas.
   - Connect nodes with arrows. Double-click a link to add a note.
   - Long-press a node to see AI recommendations and add them instantly (requires the backend
     from step 1 to be running, since the playground calls `http://localhost:5000/recommend`).

---

## Accounts & Cloud Save (Supabase)

Logging in is optional — everything above works with no account (maps autosave to
`localStorage` and can be shared via `?share=` links regardless). Signing in additionally
saves maps to the cloud so they're available across devices/browsers.

Setup (one-time):

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the project's SQL Editor and run everything in `supabase-schema.sql`.
3. Go to **Settings → API** and copy the **Project URL** and **anon public** key.
4. Paste them into `static/auth.js`, replacing the `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   placeholders at the top of the file. (The anon key is *meant* to be public client-side —
   the SQL above enables Row Level Security, which is what actually enforces that a user can
   only read/write their own maps, not the key being secret.)

Until those placeholders are replaced, the app runs exactly as before — the "Sign in" button
hides itself and logs a console note instead of breaking anything.

**Roles:** every signup is a `student` by default — there's no role picker at signup, on
purpose. Role lives in `auth.users.app_metadata`, which the client SDK cannot write directly
(only a service-role/dashboard call, or a `SECURITY DEFINER` Postgres function, can).

⚠️ **Temporary, demo-only exception:** a signed-in student can currently self-promote via a
"Become a teacher (demo)" button on `settings.html`, which calls the `claim_teacher_role()`
RPC in `supabase-schema.sql` — completely ungated. This is only acceptable because this
deployment is a demo with no real student data at stake; see `TODO.md`'s "Auth & roles"
section for the plan to replace it with a real gate before any real usage. The manual SQL
path below still works and is the only *safe* promotion path until then:

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"teacher"}'::jsonb
where email = 'teacher@example.com';
```

Note: a promoted account's *existing* session still carries the old role claim until it
refreshes (~1hr) — sign out/in right after promoting to see the change take effect.

**Classes (rostering):** on `settings.html`, teachers create a class and get a shareable
invite code; students join with it. Teachers get read-only visibility into maps their
students save (never edit/delete). If you already ran `supabase-schema.sql` before this was
added, just run the newer half of the file (from the "Rostering" section onward) — the
`maps` table setup at the top will error as already-existing if you re-run all of it.

---

## Customizing

- Edit `concepts.json` to adjust the curriculum.
- The backend (`ai_recommender.py`) is modular—extend it with smarter NLP as desired.
- The UI (HTML/JS) is fully commented for rapid prototyping or production use.

---

## Structure

- **Front-End:** All UI, map logic, node/link management, and API communication (`app.js`).
- **Back-End:** Receives POST requests with current map + selected node, returns ranked recommendations.

---

## Patent-Readiness

- The AI recommendation mechanism is modular and distinct (for patenting).
- Full end-to-end interaction between user actions, curriculum structure, and the suggestion engine.

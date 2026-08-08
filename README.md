# Math Concept Mapper

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
- `app.js` — All front-end logic for the playground.
- `concepts.json` — Math concepts, organized by grade/unit/topic.
- `ai_recommender.py` — Flask API backend for AI-driven recommendations.
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

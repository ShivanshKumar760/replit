# Mini Replit API (Python)

Python/FastAPI port of the Replit clone backend. Uses **FastAPI** and **PostgreSQL** only (projects are stored in PostgreSQL instead of MongoDB).

## Stack

- **Framework:** FastAPI
- **Database:** PostgreSQL (async via SQLAlchemy + asyncpg)
- **Auth:** JWT (python-jose), bcrypt (passlib)
- **Containers:** Docker (same `mini-replit-node` image for run/stop)

## Setup

1. Create a virtualenv and install dependencies:

   ```bash
   cd python_version
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and set your PostgreSQL URL and `JWT_SECRET`.

3. Ensure PostgreSQL is running and the database exists. Tables `users` and `projects` are created on startup.

4. Run the app:

   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 5000
   ```

   Or:

   ```bash
   python -m app.main
   ```

## API Endpoints

| Method | Path            | Auth | Description                    |
|--------|-----------------|------|--------------------------------|
| POST   | `/register`    | No   | Register (email, password)    |
| POST   | `/login`       | No   | Login; returns JWT            |
| POST   | `/create-project` | Yes (Bearer) | One project per user; creates workspace + `package.json` + `index.js` |
| POST   | `/run`         | Yes  | Start Docker container        |
| POST   | `/stop`        | Yes  | Stop and remove container     |

Request/response shapes match the JavaScript version (e.g. `Create-Project` body can include `dependencies`).

## Environment

- `PORT` – Server port (default `5000`)
- `JWT_SECRET` – Secret for JWT signing
- `PG_*` – PostgreSQL connection (`PG_USER`, `PG_HOST`, `PG_DATABASE`, `PG_PASSWORD`, `PG_PORT`)
- `WORKSPACE_DIR` – Base directory for project workspaces (default `workspaces`)

## Project layout

```
python_version/
  app/
    main.py           # FastAPI app, lifespan, router
    config/           # settings, async DB engine/session
    models/           # User, Project (SQLAlchemy)
    schemas/          # Pydantic request/response
    routes/replit.py  # register, login, create-project, run, stop
    middleware/auth.py # JWT dependency
    utils/            # jwt, bcrypt
  requirements.txt
  .env.example
  README.md
```

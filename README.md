# CivicPulse — community issue reporting

CivicPulse is a civic-tech app for reporting neighborhood issues and making community needs easier to see. This version is the public reporting foundation for the KIET InnoTech 2026 project.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB via Mongoose
- Redis: ioredis (optional at runtime; API remains available if Redis is offline)

## Requirements
- Node.js 20+
- MongoDB Atlas account or local MongoDB
- Docker Desktop (optional, for Redis)

## 1. Configure backend
Open a terminal in `backend`:

```bash
npm install
```

Copy `.env.example` to `.env` and fill in `MONGODB_URI`, `ADMIN_API_KEY`, and `JWT_SECRET`. Use separate random secrets for the admin key and JWT signing key; the JWT secret must be at least 32 bytes. Generate each with:

```bash
openssl rand -hex 32
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## 2. Start Redis (optional but recommended)
If Docker Desktop is running:

```powershell
docker run -d --name civicpulse-redis -p 6379:6379 redis:7-alpine
```

If the container already exists, run:

```powershell
docker start civicpulse-redis
```

## 3. Start backend
From `backend`:

```bash
npm run dev
```

Backend health endpoint: http://localhost:8000/api/health
Issues endpoint: http://localhost:8000/api/issues
Public aggregate report counts, including total, workflow states, high-priority unresolved reports, and community supports: http://localhost:8000/api/issues/summary

### Accounts and Civic Score

Create an account with `POST /api/auth/register` using `{ "displayName": "Your name", "email": "you@example.com", "password": "at-least-10-characters" }`, or sign in with `POST /api/auth/login`. Both return a 7-day bearer token. The browser keeps that token in tab-scoped session storage; do not expose `JWT_SECRET` in frontend code or a `VITE_*` variable.

Report submission now requires `Authorization: Bearer YOUR_TOKEN`. Each successfully created report earns its signed-in author 10 points. Possible-duplicate warnings do not award points unless the reporter explicitly submits a separate report. The authenticated `GET /api/users/me/score` endpoint returns the signed-in user's score and report count. The score is calculated from reports attributed to the verified account; users cannot request another account's score by changing an ID.

Passwords are hashed before storage. Existing reports submitted before accounts were added remain public but are not attributed to a user and do not add points to anyone's Civic Score.

Password recovery is available from the sign-in page. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in the backend environment to send reset emails. For Gmail, enable 2-Step Verification on the Google account, create an App Password in Google Account security settings, and use that 16-character value as `SMTP_PASSWORD` (not the regular Google password). Set `SMTP_USER` and `SMTP_FROM` to the same Gmail address; use `smtp.gmail.com`, port `587`, and `SMTP_SECURE=false`. Never commit the real App Password. The email link expires after one hour; only a hash of its random token is stored. `SMTP_SECURE=true` is typically used with port 465; use `false` with STARTTLS on port 587. `FRONTEND_ORIGIN` must point to the deployed frontend so reset links return to the right site. The endpoints are `POST /api/auth/forgot-password` with `{ "email": "you@example.com" }` and `POST /api/auth/reset-password` with `{ "token": "...", "password": "at-least-10-characters" }`. Reset requests are rate-limited with the other authentication endpoints.

### Update a report status (admin)

New reports start with status `New`. The supported statuses are `New`, `Acknowledged`, `In Progress`, and `Resolved`. Status changes require the backend-only `ADMIN_API_KEY`; set it in `backend/.env` (and in your deployment provider's backend environment settings). Generate a strong value with:

```bash
openssl rand -hex 32
```

Never add this key to a `VITE_*` variable or frontend code. Update a report with:

```bash
curl -X PATCH http://localhost:8000/api/issues/REPORT_ID/status \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"In Progress"}'
```

Replace `REPORT_ID` with the report's MongoDB `_id`. The endpoint returns `400` for an unsupported status, `401` when the key is absent or incorrect, `404` when no report matches, and `503` if `ADMIN_API_KEY` has not been configured. Status badges in the public feed use distinct, restrained colors. Legacy `Open` and `Assigned` reports display as New and Acknowledged in the feed.

## 4. Start frontend
Open another terminal in `frontend`:

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually http://localhost:5173).

## Current features
- Submit and browse public reports for potholes, garbage, streetlights, road damage, water, and other issues.
- Attach up to four JPEG, PNG, or WebP photos (1 MB each). Photos are stored in MongoDB and fetched only when a report is opened, keeping the report feed lightweight.
- Add a place name or opt in to share the browser's current coordinates.
- See nearby report clusters and mapped locations in an OpenStreetMap view.
- Review a transparent priority score and the reasons that contributed to it.
- Get warned about an exact open title/category match before submitting a possible duplicate.
- Search reports and filter by category or status. The homepage summary and map preview use actual database records; report locations appear on the map only when coordinates were shared.
- View recent reports and community totals aggregated from MongoDB; the public summary endpoint exposes counts only.
- Create an account, sign in, and view a personal profile with a Civic Score; each successfully submitted report adds 10 points.
- Receive a server-generated `CP-YYYY-NNN` tracking ID for new reports, view real status-history events, and support/un-support reports once per account.
- Open a protected administrator dashboard with live totals, status/category analytics, resolution rate, recent report details, report management, and a map of available locations. User management, settings, and active-user totals are not implemented.
- See conservative possible-duplicate suggestions across the 100 most recent unresolved reports in the same category, based on similar titles and matching real coordinates or location names. Suggestions can always be dismissed to submit a distinct report; if no location is available, only an exact title match is suggested.

Priority is a simple, explainable demo score based on issue category and safety, active-water-hazard, and public-access terms in the report text. It is a triage aid, not an automated decision about service eligibility.

## Next steps
The admin dashboard uses the existing single shared `ADMIN_API_KEY`, not role-based access control. An API-key holder can view dashboard data and update report status; the displayed administrator profile is informational only and does not grant access. The dashboard API and status-update API both validate the key on the backend. The browser keeps the key only in active application memory, not browser storage; never put it in frontend source or deployment build variables. For production, replace the shared key with named administrator accounts and audited role-based authorization. Assignment, resolution evidence, and citizen disputes are not implemented yet. For production photo storage, use an object-storage service and keep only its file references in MongoDB. The frontend stores citizen bearer tokens in tab-scoped session storage; use secure, HttpOnly cookies and appropriate CSRF protections for a production deployment.

Tracking IDs are allocated from an atomic MongoDB counter per UTC year. Older reports keep working without an ID or fabricated status history. Community support uses a MongoDB supporter set and an atomic count change, so repeating the same support action does not inflate the total.

## Notes
- Never commit your real `.env` file or share database credentials.
- In MongoDB Atlas, create a database user and allow your current IP in Network Access.
- Browser geolocation requires the user's permission and a secure context (HTTPS, or localhost).
- The map uses OpenStreetMap; the embed is centered on the report coordinates and nearby reports are summarized below it.

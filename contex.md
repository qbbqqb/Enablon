Project Context — Enablon Observation Bundler (Next.js)
Role & Goal

You are a senior TypeScript + Next.js engineer. Build a single-screen web app where a user drops photos (+ optional notes), selects a project, clicks Make my CSV, and receives a ZIP containing:

observations.csv (Compass/Enablon-compliant, exact headers/order)

photos/ (renamed versions of uploaded images)

manifest.json (row ↔ filename mapping)

FAILED.json (optional; items skipped or repaired)

Must feel “magic”: one page, one button, auto-download, minimal choices.

Non-Goals (MVP)

No accounts/auth, no DB, no S3, no queues.

No direct Enablon API push (file export only).

No multi-user collaboration.

Tech Stack (minimal, production-friendly)

Frontend: Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui

Uploads: HTML5 drag-drop (or UploadThing if preferred)

Media: sharp (HEIC→JPG, resize), exifr (optional)

ZIP: archiver

AI: Gemini 2.5 Pro Vision (single strict prompt per micro-batch)

Validation: local schema checks (no external libs required)

Everything happens in memory + /tmp within a single request. Optimize for 10–60 photos.

Single Screen UX

Dropzone: accepts jpg/png/heic (multi-file, up to 60)

Textarea: Notes (optional)

Select: Project (GVX03 | GVX04 | GVX05, default GVX04)

Primary Button: Make my CSV

Progress bar + label (optimistic by micro-batch): “Analysing 24/48 photos…”

Auto-download ZIP when ready; success toast “All set—ready for Enablon 🎉”

Endpoint (one route)

POST /api/generate (multipart/form-data)

Fields: project (string, GVX03/GVX04/GVX05), notes (string, optional), files[] (images)

Server flow (strict order):

Parse form

Normalize images

HEIC→JPG via sharp

Resize longest edge to 1600 px, JPEG quality ~0.7

Track original order index

If image still >10MB after compression → skip and record in FAILED.json

Micro-batch AI

Chunk images into batches of 8; process with concurrency = 2

One Gemini call per batch → STRICT JSON array (one object per image, same order)

Post-process & repair

Fill constants + mappings (below)

Enforce HRA vs General exclusivity

If a batch returns invalid JSON: one “repair to schema” attempt; otherwise skip those items and record in FAILED.json

Build outputs

observations.csv (UTF-8 with BOM, CRLF, exact header order below)

Rename photos (pattern below)

manifest.json (row ↔ renamed files)

FAILED.json (only if needed)

Stream ZIP back (Content-Type: application/zip) and cleanup /tmp

Default limits (ship these)

Max files: 60

Max total upload: 200 MB

AI batch size: 8

AI concurrency: 2

TZ: Europe/Stockholm

CSV Contract (order EXACT)

Project

Room/Area

Comments

Observation Category

Observation Description

Responsible Party

Interim Corrective Actions

Final Corrective Actions

Category Type

Phase of Construction

Notification Date

High Risk + Significant Exposure

General Category

Worst Potential Severity

Person Notified

Formatting: UTF-8 with BOM, CRLF endlines, quote fields as needed, escape inner quotes by doubling.

Enumerations & Mappings (must match exactly)

Projects: GVX03 | GVX04 | GVX05

Room/Area:
AHU, Battery Room, Breakroom/Canteen, Cleaner/Janitorial Stores, COLO or AZ, Corridor/Hallway/Spine, Data Bearing Device, DBD Shredding Room or Area, Debox/Storage Room, Designated Smoking Area, Electrical Room, External Area, FOC, FOC Stores, FOC Workshop or Tool Room, Generator Compound/Service Yard, ITPAC, Loading Bay or Dock, MDF or IDF Room, Office of Administrative Area, Other, Parking Lot/Car Park, Restroom or Washroom, Roof Area, SOC, Training Room, Vendor Stores

Observation Category: New At Risk Observation | New Near Miss | New Positive Observation

Category Type: General Category | HRA + Significant Exposure (mutually exclusive)

HRA + Significant Exposure:
Confined Spaces, Driving, Electrical, Energy Isolation, Ground Disturbance, Hazardous Materials, Infectious Disease, Lifting Operations, Material Handling, Mobile Equipment, Noise, Temperature Extremes, Working from Heights

General Category:
Animals and Insects, Barricades, Biological, Documentation, Emergency Preparedness, Environmental, Ergonomic, Fatigue, Fire Protection, Hand or Power Tools, Housekeeping, Lasers, Lighting, Line of Fire, Logistics, Manual Lifting, Office Tools and Equipment, Other, Personal Protective Equipment, Safety Culture, Sanitation, Site Access and Control, Training, Ventilation, Walking, Working Surfaces, Welding, Cutting and Grinding

Phase of Construction:
Cladding Building Envelope, Commissioning, Demolition, Exterior Slabs & Equipment, Foundations, Integration, Interior Fit-Out - CSA, Interior Fit-Out - Electrical, Interior Fit-Out - Mechanical, Interior Slabs, Interior Underground Services, Network Fit-Out, Roofing, Security, Site Clearing & Preparation, Site Utility Services, Steel Erection, Tilt Wall Construction

Worst Potential Severity:
Major (1 Day) | Potentially Serious/Serious (Immediate) | Positive Observation | Minor (7 Days)

Constants & mappings

Comments: DCD Observation

Notification Date: today, DD/MM/YYYY (Europe/Stockholm)

Responsible Party by Project:

GVX04 → Dean Bradbury - dbradbury B2B

GVX03 → Nigel MacAodha - nmacaodha

GVX05 → Nigel MacAodha - nmacaodha

Person Notified by Project:

GVX04 → Vitor Ferreira - vferreira B2B

GVX05 → Liina Laanemae - llaanemae B2B

GVX03 → Dragos Viorel-Silion - dviorelsilion B2B

Exclusivity rule

If Category Type = HRA + Significant Exposure ⇒ High Risk set, General Category empty

If Category Type = General Category ⇒ General Category set, High Risk empty

Quick image→category rules

Cable drum without chocks → HRA: Material Handling

Rebar without caps → General: Walking, Working Surfaces

Barriers down/broken feet → General: Barricades

Poor housekeeping → General: Housekeeping

Exposed pipe near traffic route → General: Line of Fire

Obstructed egress → General: Emergency Preparedness

Photo Renaming Pattern

<Project>-<ObsNo>-<Area>-<CategoryOrHRA>-<Severity>-<YYYYMMDD>-<shortslug>.jpg

ObsNo = zero-padded (001, 002, …) by row order

CategoryOrHRA = if HRA use that value, else General Category

shortslug = 3–4 keywords from description; ASCII; ≤80 chars; dedupe with -2, -3

AI Prompt (use per micro-batch)

System/Instruction (verbatim skeleton):

Role: construction safety inspector producing Compass/Enablon rows

Output: STRICT JSON array; one object per image in input order; no extra fields; British English

Timezone: Europe/Stockholm; Notification Date = today (DD/MM/YYYY)

Use only the enumerations provided (lists above).

Object must include exactly the 15 fields (same names as CSV headers).

Apply the quick rules (drum→HRA/Material Handling, rebar→Walking, barriers→Barricades, housekeeping→Housekeeping, pipe→Line of Fire, egress→Emergency Preparedness).

Return only JSON: [ {15-field object}, ... ].

Server passes: project, notes, binary images array.
Server enforces exclusivity and mappings if model misses them.

File Layout (target)
/app
  /page.tsx                 # single-screen UI
  /api/generate/route.ts    # the only endpoint (multipart in, ZIP out)
/lib
  ai/analyze.ts             # calls Gemini per micro-batch
  csv/buildCsv.ts           # BOM+CRLF+quoting exact order
  files/normalize.ts        # heic->jpg + resize + keep order
  files/rename.ts           # filename sanitizer & pattern
  zip/buildZip.ts           # archiver streaming + cleanup
  constants/enums.ts        # all picklists & mappings
  constants/headers.ts      # 15 CSV headers in order
  date/stockholm.ts         # DD/MM/YYYY today
/tests
  csv.spec.ts               # header order + quoting
  exclusivity.spec.ts       # HRA vs General enforcement

Environment Variables
AI_PROVIDER=gemini
AI_API_KEY=...
TZ=Europe/Stockholm

Acceptance Checklist (Done = true)

Drop 10–60 photos → click Make my CSV → one ZIP auto-downloads

observations.csv has exact 15 headers, UTF-8 BOM, CRLF; imports to Enablon/Compass with zero edits

Photos are renamed per pattern; manifest.json maps rows ↔ photos

HRA/General exclusivity always correct

FAILED.json present only if items skipped; app never crashes—always returns a ZIP

Implementation Tasks (micro)

UI page: dropzone, notes, project select, button, optimistic progress, auto-download on success.

API route: parse multipart; normalize (heic→jpg, resize); micro-batch AI (8, concurrency 2); repair/enforce schema; build CSV; rename photos; stream ZIP; cleanup.

AI call: strict prompt; return array per micro-batch; server validates and fixes trivial violations.


OpenRouter + Gemini 2.5 Pro (for Next.js app)
What we’re using

Provider: OpenRouter

Endpoint: https://openrouter.ai/api/v1/chat/completions 
OpenRouter

Model ID: google/gemini-2.5-pro 
OpenRouter

Headers (recommended):

Authorization: Bearer <OPENROUTER_API_KEY>

HTTP-Referer: <your app URL> (optional attribution)

X-Title: <your app name> (optional attribution) 
OpenRouter
+1

Multimodal input: send images in the message content array with type: "image_url" (URLs or data URLs) alongside text segments. 
OpenRouter

Streaming (not required for this MVP): set "stream": true if you later want token streaming. 
OpenRouter

Env vars (add to .env.local)
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_APP_URL=https://your-domain.tld
OPENROUTER_APP_NAME=Enablon Observation Bundler
TZ=Europe/Stockholm

How we call it (shape & rules)

One request per micro-batch (8 images); concurrency = 2.

messages[0].role = "user" with content array:

First a text chunk containing the strict instructions + enumerations

Then one image_url object per image (either a public URL or a data:image/jpeg;base64,...)

Return only JSON (string). We’ll JSON.parse it server-side and validate.

Message content shape (example):

{
  "model": "google/gemini-2.5-pro",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<STRICT prompt with columns/enums & rules>" },
        { "type": "image_url", "image_url": "data:image/jpeg;base64,..." },
        { "type": "image_url", "image_url": "https://your-temp-url/photo2.jpg" }
      ]
    }
  ],
  "temperature": 0.2
}


(Using image_url for images is the OpenRouter multimodal convention. PDFs and audio use different types.) 
OpenRouter

Minimal analyzeImages() contract (Cursor should generate this)

Input: { files: FileLike[], project: 'GVX03'|'GVX04'|'GVX05', notes?: string }

Steps:

Convert HEIC→JPG; resize to longest edge 1600px (≈0.7 JPEG quality).

Chunk into batches of 8; process with concurrency 2.

For each batch:

Build messages: strict text prompt + image data URLs (or temporary HTTPS URLs).

POST to https://openrouter.ai/api/v1/chat/completions with headers above.

Extract choices[0].message.content (Gemini via OpenRouter returns OpenAI-style payload). 
OpenRouter

JSON.parse → validate/repair to schema (enforce HRA↔General exclusivity; fill constants and mappings).

Merge arrays in original order → return Observation[].

Headers boilerplate (Cursor can reuse)

Authorization: Bearer ${process.env.OPENROUTER_API_KEY}

HTTP-Referer: ${process.env.OPENROUTER_APP_URL}

X-Title: ${process.env.OPENROUTER_APP_NAME} 
OpenRouter
+1

Notes & tips

If you can host temporary images at an HTTPS URL, prefer that over giant base64 to keep requests lighter; data URLs still work.

Keep batch requests small (we’re using 8) to stay within model input limits and to improve reliability. (OpenRouter routes to many providers but uses OpenAI-compatible semantics and model naming like provider/model.) 
OpenRouter
+1

If you ever need token streaming (e.g., to show live progress text), OpenRouter supports it via "stream": true and SSE—out of scope for this MVP.
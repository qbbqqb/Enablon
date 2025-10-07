# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Enablon Observation Bundler - a Next.js 15 web application for processing construction safety observation photos. Users upload photos in batches, optionally add numbered notes, and receive a ZIP file containing:

- `observations.csv` (Enablon/Compass-compliant format)
- `photos/` (renamed images)
- `manifest.json` (row-to-filename mapping)
- `FAILED.json` (optional, for processing failures)

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- **Image Processing**: sharp (HEIC→JPG, resizing), exifr (EXIF metadata)
- **AI**: Gemini 2.5 Pro Vision via OpenRouter API
- **File Processing**: archiver (ZIP generation), jsonrepair (malformed JSON recovery)
- **Testing**: Jest with ts-jest

## Commands

```bash
npm run dev          # Start development server at localhost:3000
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript compiler check (tsc --noEmit)
npm test             # Run all Jest tests
npm run test:watch   # Run tests in watch mode
```

## Architecture

### Processing Workflow

The application uses a **multi-stage batch processing** architecture with session-based storage:

1. **Analyze Stage** (`/api/analyze`):
   - Accepts multipart form data (project, notes, files[], sessionId, batchIndex)
   - Normalizes images (HEIC→JPG, resize to 1600px, <10MB)
   - Calls Gemini API in micro-batches (6 images per chunk, 3 concurrent chunks)
   - Stores results in server-side session (15min TTL)
   - Returns observations for user review

2. **Export Stage** (`/api/export`):
   - Receives reviewed/edited observations + sessionId
   - Retrieves images from session store
   - Generates CSV (UTF-8+BOM, CRLF), renames photos, creates manifest
   - Streams ZIP file to client
   - Clears session data

3. **Simple Mode** (`/api/simple`):
   - Single-pass workflow for quick processing
   - Combines analyze + export in one request
   - Supports numbered notes (e.g., "1. Description" maps to photo 1)
   - Falls back to AI analysis for photos without notes

### File Structure

```
/app
  page.tsx                       # Main UI: dropzone, project selector, batch upload
  layout.tsx                     # Root layout
  /api
    /analyze/route.ts            # Batch analysis with session storage
    /export/route.ts             # Export reviewed observations to ZIP
    /simple/route.ts             # Single-pass analyze + export
    /analyze-multi/route.ts      # Multi-project batch analysis
    /progress/route.ts           # SSE progress updates
    /generate/route.ts           # Legacy single-request endpoint

/lib
  /ai/analyze.ts                 # Gemini API integration (559 lines)
  /batch/processor.ts            # Batch creation and result combination
  /csv/buildCsv.ts               # CSV generation with exact Enablon format
  /files/normalize.ts            # HEIC→JPG conversion + resizing
  /files/rename.ts               # Photo renaming with deduplication (190 lines)
  /zip/buildZip.ts               # ZIP streaming + temp file cleanup
  /constants/enums.ts            # All enumerations and mappings
  /constants/headers.ts          # 15 CSV headers in exact order
  /date/stockholm.ts             # Europe/Stockholm timezone formatting
  /session/store.ts              # In-memory session storage (15min TTL)
  /progress/manager.ts           # SSE progress tracking
  /utils/projectDetection.ts     # Multi-project note parsing
  /client/compress.ts            # Client-side image compression
  types.ts                       # Core TypeScript interfaces

/components
  dropzone.tsx                   # File upload UI
  observation-review.tsx         # Single-project review interface
  multi-project-review.tsx       # Multi-project review interface
  progress-bar.tsx               # Progress UI

/__tests__
  csv.test.ts                    # CSV format validation
  exclusivity.test.ts            # HRA vs General category rules
```

### Critical Business Rules

**CSV Format**: Exact 15-column order, UTF-8 with BOM, CRLF line endings:
- Project, Room/Area, Comments, Observation Category, Observation Description, Responsible Party, Interim Corrective Actions, Final Corrective Actions, Category Type, Phase of Construction, Notification Date, High Risk + Significant Exposure, General Category, Worst Potential Severity, Person Notified

**Category Exclusivity** (enforced in tests):
- If "Category Type" = "HRA + Significant Exposure" → populate "High Risk + Significant Exposure", empty "General Category"
- If "Category Type" = "General Category" → populate "General Category", empty "High Risk + Significant Exposure"

**Project Mappings**:
- GVX04 → Responsible: Dean Bradbury - dbradbury B2B, Notified: Vitor Ferreira - vferreira B2B
- GVX03 → Responsible: Nigel MacAodha - nmacaodha, Notified: Dragos Viorel-Silion - dviorelsilion B2B
- GVX05 → Responsible: Nigel MacAodha - nmacaodha, Notified: Liina Laanemae - llaanemae B2B

**Photo Naming Pattern**:
```
<Project>-<ObsNo>-<Area>-<CategoryOrHRA>-<Severity>-<YYYYMMDD>-<shortslug>.jpg
```
Example: `GVX04-001-External-Area-Housekeeping-Minor-20250912-poor-housekeeping.jpg`

### AI Integration (OpenRouter + Gemini)

- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Model**: `google/gemini-2.5-pro`
- **Batch Processing**: 6 images per chunk, 3 concurrent chunks (configurable in `/api/simple`)
- **Fallback Strategy**: Uses `jsonrepair` for malformed JSON responses
- **Context**: Accepts numbered notes for photo-specific hints
- **Multi-project**: Can detect project codes in notes and split observations

### Session Storage

Server-side in-memory storage (`/lib/session/store.ts`):
- **TTL**: 15 minutes
- **Data**: ProcessedImage[], Observation[], FailedItem[], projectFallback, order
- **Purpose**: Decouple analysis from export, enable review/edit workflow
- **Cleanup**: Automatic expiry check on retrieval

### Batch Processing

Client-side batching (`/lib/batch/processor.ts`):
- **Max files per batch**: 6 images
- **Max size per batch**: 15MB raw (compresses to ~2MB)
- **Progress allocation**: 80% for batches (divided equally), 20% for final processing
- **Result combination**: First batch provides observations, all batches contribute images

### Environment Variables

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_APP_URL=https://your-domain.tld
OPENROUTER_APP_NAME=Enablon Observation Bundler
TZ=Europe/Stockholm
```

### Limits & Constraints

- **Max files**: 60 per session (client-side limit in constants)
- **Max upload**: 10MB per request (Railway limit, checked in `/api/analyze`)
- **Image normalization**: Resize to 1600px longest edge, JPEG quality 70%, <10MB final size
- **AI batch size**: 6 images per chunk (configurable in simple mode)
- **AI concurrency**: 3 chunks (configurable in simple mode)
- **Target use case**: 10-60 photos per session
- **Timezone**: Europe/Stockholm for all dates

### Progress Tracking

Server-Sent Events (SSE) via `/api/progress`:
- Client subscribes with sessionId
- Server sends ProgressEvent updates: `{ progress: 0-100, message: string, stage: string }`
- Stages: 'normalizing', 'analyzing', 'generating', 'complete', 'error'
- Connection closed by server after 'complete' or 'error'

### Key Implementation Details

**Image Normalization** (`/lib/files/normalize.ts`):
- Converts HEIC to JPG using sharp
- Resizes to max 1600px longest edge
- Compresses to <10MB with quality 70%
- Extracts EXIF DateTimeOriginal for filename generation
- Returns Buffer + metadata

**Photo Renaming** (`/lib/files/rename.ts`):
- Generates slugs from observation description
- Deduplicates by appending incrementing numbers (e.g., `-2`, `-3`)
- Uses EXIF date or current date in YYYYMMDD format
- Validates slug uniqueness across entire batch

**CSV Generation** (`/lib/csv/buildCsv.ts`):
- Adds UTF-8 BOM (`\uFEFF`)
- Escapes fields with commas/quotes (RFC 4180)
- Uses CRLF line endings (`\r\n`)
- Exactly 15 columns in header order from `/lib/constants/headers.ts`

**AI Analysis** (`/lib/ai/analyze.ts`):
- Sends images as base64 data URIs
- Includes strict JSON schema in prompt
- Processes numbered notes as photo-specific context
- Returns structured Observation[] matching CSV schema
- Retry logic for malformed JSON with `jsonrepair`

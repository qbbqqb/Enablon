# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Enablon Observation Bundler - a Next.js 15 single-screen web application that processes construction safety observation photos. Users drop photos, add optional notes, select a project, and receive a ZIP file containing:

- `observations.csv` (Compass/Enablon-compliant format)
- `photos/` (renamed images) 
- `manifest.json` (row-to-filename mapping)
- `FAILED.json` (optional, for skipped items)

## Tech Stack

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Image Processing**: sharp (HEIC→JPG conversion, resizing), exifr
- **AI**: Gemini 2.5 Pro Vision via OpenRouter API
- **File Processing**: archiver for ZIP generation
- **Architecture**: Single request/response, in-memory processing

## Commands

Since this is a fresh Next.js project, the standard commands will be:

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript compiler check
npm test             # Run tests
```

## Architecture

### File Structure (Planned)
```
/app
  page.tsx                 # Single-screen UI with dropzone, project selector, notes
  /api/generate/route.ts   # Main endpoint (multipart → ZIP)

/lib
  ai/analyze.ts            # Gemini API calls (micro-batches of 8 images)
  csv/buildCsv.ts          # CSV generation with exact Enablon format
  files/normalize.ts       # HEIC→JPG conversion + resizing
  files/rename.ts          # Photo renaming per pattern
  zip/buildZip.ts          # ZIP streaming + temp file cleanup
  constants/enums.ts       # All enumerations and mappings
  constants/headers.ts     # 15 CSV headers in exact order
  date/stockholm.ts        # Europe/Stockholm timezone handling

/tests
  csv.spec.ts              # CSV format validation
  exclusivity.spec.ts      # HRA vs General category rules
```

### Key Processing Flow
1. **Parse multipart form data** (project, notes, files[])
2. **Normalize images**: HEIC→JPG, resize to 1600px longest edge, <10MB
3. **AI processing**: Micro-batches of 8 images, concurrency=2, Gemini vision analysis
4. **Schema enforcement**: HRA vs General Category exclusivity, required field mapping
5. **Output generation**: CSV (UTF-8+BOM, CRLF), renamed photos, manifest, ZIP stream

### Critical Business Rules

**CSV Format**: Exact 15-column order, UTF-8 with BOM, CRLF line endings:
- Project, Room/Area, Comments, Observation Category, Observation Description, Responsible Party, Interim Corrective Actions, Final Corrective Actions, Category Type, Phase of Construction, Notification Date, High Risk + Significant Exposure, General Category, Worst Potential Severity, Person Notified

**Category Exclusivity**: 
- If "Category Type" = "HRA + Significant Exposure" → populate High Risk field, empty General Category
- If "Category Type" = "General Category" → populate General Category, empty High Risk field

**Project Mappings**:
- GVX04 → Responsible: Dean Bradbury, Notified: Vitor Ferreira  
- GVX03 → Responsible: Nigel MacAodha, Notified: Dragos Viorel-Silion
- GVX05 → Responsible: Nigel MacAodha, Notified: Liina Laanemae

**Photo Naming**: `<Project>-<ObsNo>-<Area>-<CategoryOrHRA>-<Severity>-<YYYYMMDD>-<shortslug>.jpg`

### Environment Variables
```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_APP_URL=https://your-domain.tld  
OPENROUTER_APP_NAME=Enablon Observation Bundler
TZ=Europe/Stockholm
```

### AI Integration (OpenRouter + Gemini)
- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Model**: `google/gemini-2.5-pro`
- **Input**: Strict prompt + image batch (8 max)
- **Output**: JSON array matching CSV schema
- **Error Handling**: One repair attempt, then record failures in FAILED.json

### Limits & Constraints
- Max files: 60
- Max upload: 200MB total
- AI batch size: 8 images
- AI concurrency: 2 batches
- Target: 10-60 photos per session
- Timezone: Europe/Stockholm for all dates
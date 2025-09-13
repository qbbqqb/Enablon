# Enablon Observation Bundler

A Next.js web application that processes construction safety observation photos and generates Enablon/Compass-compliant CSV files with renamed images in a ZIP package.

## Features

- **Single-screen interface**: Drop photos, select project, click "Make my CSV"
- **AI-powered analysis**: Uses Gemini 2.5 Pro Vision via OpenRouter to analyze safety observations
- **Enablon-compliant output**: Generates CSV with exact headers, UTF-8 BOM, CRLF line endings
- **Image processing**: HEIC→JPG conversion, resizing, compression
- **Automatic file naming**: Photos renamed per Enablon pattern with deduplication
- **Batch processing**: Handles 10-60 photos with micro-batching and concurrency limits
- **Error handling**: Failed items tracked in FAILED.json

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- **Image Processing**: Sharp (HEIC conversion, resizing), exifr (EXIF data)
- **AI**: OpenRouter API with Gemini 2.5 Pro Vision
- **File Handling**: Archiver (ZIP generation)
- **Testing**: Jest with TypeScript

## Quick Start

1. **Clone and install dependencies**:
   ```bash
   cd enablon
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` and add your OpenRouter API key:
   ```
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```
   
   Visit [http://localhost:3000](http://localhost:3000)

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key for Gemini access | `sk-or-v1-...` |
| `OPENROUTER_APP_URL` | Your app URL for attribution | `https://yourdomain.com` |
| `OPENROUTER_APP_NAME` | App name for OpenRouter | `Enablon Observation Bundler` |
| `TZ` | Timezone for date formatting | `Europe/Stockholm` |

## Available Scripts

```bash
npm run dev         # Start development server
npm run build       # Build for production
npm run start       # Start production server
npm run lint        # Run ESLint
npm run typecheck   # Run TypeScript compiler
npm run test        # Run Jest tests
npm run test:watch  # Run tests in watch mode
```

## Usage

1. **Drop photos** into the dropzone (supports JPG, PNG, HEIC)
2. **Select project** (GVX03, GVX04, or GVX05)
3. **Add notes** (optional context for AI analysis)
4. **Click "Make my CSV"** and wait for processing
5. **Download ZIP** containing:
   - `observations.csv` - Enablon-compliant CSV
   - `photos/` - Renamed images
   - `manifest.json` - Row-to-filename mapping
   - `FAILED.json` - Failed items (if any)

## Output Format

### CSV Headers (Exact Order)
1. Project
2. Room/Area  
3. Comments
4. Observation Category
5. Observation Description
6. Responsible Party
7. Interim Corrective Actions
8. Final Corrective Actions
9. Category Type
10. Phase of Construction
11. Notification Date
12. High Risk + Significant Exposure
13. General Category
14. Worst Potential Severity
15. Person Notified

### Photo Naming Pattern
```
<Project>-<ObsNo>-<Area>-<CategoryOrHRA>-<Severity>-<YYYYMMDD>-<shortslug>.jpg
```

Example: `GVX04-001-External-Area-Housekeeping-Minor-20250912-poor-housekeeping.jpg`

## Project Mappings

| Project | Responsible Party | Person Notified |
|---------|------------------|----------------|
| GVX04 | Dean Bradbury - dbradbury B2B | Vitor Ferreira - vferreira B2B |
| GVX03 | Nigel MacAodha - nmacaodha | Dragos Viorel-Silion - dviorelsilion B2B |
| GVX05 | Nigel MacAodha - nmacaodha | Liina Laanemae - llaanemae B2B |

## Limits

- **Max files**: 60 photos per session
- **Max upload size**: 200MB total
- **Max file size**: 10MB per image after compression
- **Image processing**: Resize to max 1600px, JPEG quality 70%
- **AI batching**: 8 images per batch, 2 concurrent batches

## Business Rules

### Category Exclusivity
- **HRA + Significant Exposure**: Populates "High Risk" field, leaves "General Category" empty
- **General Category**: Populates "General Category" field, leaves "High Risk" empty

### Quick Recognition Rules
- Cable drum without chocks → HRA: Material Handling
- Rebar without caps → General: Walking, Working Surfaces
- Barriers down/broken → General: Barricades
- Poor housekeeping → General: Housekeeping
- Exposed pipe near traffic → General: Line of Fire
- Obstructed egress → General: Emergency Preparedness

## Testing

Run the test suite:
```bash
npm test
```

Tests cover:
- CSV format validation (BOM, CRLF, header order)
- Field escaping (commas, quotes)
- HRA vs General Category exclusivity
- Project mappings

## Development Notes

- **Timezone**: All dates in Europe/Stockholm
- **File processing**: In-memory with /tmp cleanup
- **Error handling**: Graceful degradation with FAILED.json
- **Progress tracking**: Optimistic UI with micro-batch progress
- **Security**: No file system persistence, request-scoped processing
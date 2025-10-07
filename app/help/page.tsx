export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white shadow-lg rounded-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          Enablon Observation Bundler - Help Guide
        </h1>

        {/* Quick Start */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Quick Start</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-700">
            <li>Select your project (CAMPUS, GVX03, GVX04, or GVX05)</li>
            <li>Upload your observation photos (drag & drop or click to browse)</li>
            <li>Optionally add numbered notes to provide context</li>
            <li>Click "Analyze & Review" to process your observations</li>
            <li>Review and edit the AI-generated observations</li>
            <li>Click "Export to ZIP" to download your package</li>
          </ol>
        </section>

        {/* What You Get */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">What You Get</h2>
          <p className="text-gray-700 mb-3">The exported ZIP file contains:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
            <li><strong>observations.csv</strong> - Enablon/Compass-compliant CSV file ready for upload</li>
            <li><strong>photos/</strong> - Renamed photos with descriptive filenames based on content</li>
            <li><strong>manifest.json</strong> - Mapping of original filenames to renamed filenames</li>
            <li><strong>FAILED.json</strong> (if applicable) - Details of any processing failures</li>
          </ul>
        </section>

        {/* Numbered Notes */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Using Numbered Notes</h2>
          <p className="text-gray-700 mb-3">
            Numbered notes help the AI understand your observations better and group photos correctly.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
            <p className="font-semibold text-blue-900 mb-2">Example Format:</p>
            <pre className="text-sm text-blue-800 whitespace-pre-wrap">
{`1. GVX04 - Materials stored in the pipe, no confined space signage and poor access to the area.
2. GVX04 - IBC tank unstable on two pallets (Salboheds)
3. GVX04 - Telehandler was transporting a waste bin without it being strapped.`}
            </pre>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
            <p className="font-semibold text-yellow-900 mb-2">Important Tips:</p>
            <ul className="list-disc list-inside space-y-1 text-yellow-800 text-sm ml-4">
              <li>Each numbered item becomes one observation</li>
              <li>Multiple photos can show the same observation (e.g., different angles)</li>
              <li>Upload photos in the same order as your numbered notes for best results</li>
              <li>You can also upload photos without notes - AI will analyze each photo independently</li>
            </ul>
          </div>
        </section>

        {/* Photo Requirements */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Photo Requirements</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
            <li><strong>Formats:</strong> JPG, JPEG, PNG, HEIC</li>
            <li><strong>Max files:</strong> 60 photos per session</li>
            <li><strong>Max size:</strong> 10MB per request (photos are automatically compressed)</li>
            <li><strong>Total batch:</strong> Recommended 10-60 photos per upload</li>
            <li><strong>Processing:</strong> HEIC files are automatically converted to JPG</li>
          </ul>
        </section>

        {/* Project Information */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Project Information</h2>
          <p className="text-gray-700 mb-3">
            Each project automatically assigns the correct responsible party and person to be notified:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded p-4">
              <h3 className="font-semibold text-gray-900 mb-2">CAMPUS</h3>
              <p className="text-sm text-gray-700">Responsible: alimberger B2B</p>
              <p className="text-sm text-gray-700">Notified: adoyle B2B</p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded p-4">
              <h3 className="font-semibold text-gray-900 mb-2">GVX03</h3>
              <p className="text-sm text-gray-700">Responsible: c-rhornton B2B</p>
              <p className="text-sm text-gray-700">Notified: dviorelsilion B2B</p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded p-4">
              <h3 className="font-semibold text-gray-900 mb-2">GVX04</h3>
              <p className="text-sm text-gray-700">Responsible: dbradbury B2B</p>
              <p className="text-sm text-gray-700">Notified: vferreira B2B</p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded p-4">
              <h3 className="font-semibold text-gray-900 mb-2">GVX05</h3>
              <p className="text-sm text-gray-700">Responsible: nmacaodha</p>
              <p className="text-sm text-gray-700">Notified: llaanemae B2B</p>
            </div>
          </div>
        </section>

        {/* CSV Format */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">CSV Format Details</h2>
          <p className="text-gray-700 mb-3">
            The generated CSV file is fully compliant with Enablon/Compass requirements:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
            <li><strong>Encoding:</strong> UTF-8 with BOM</li>
            <li><strong>Line endings:</strong> CRLF (Windows-style)</li>
            <li><strong>Columns:</strong> 15 columns in exact Enablon order</li>
            <li><strong>Date format:</strong> DD/MM/YYYY (Europe/Stockholm timezone)</li>
            <li><strong>Category exclusivity:</strong> Either HRA+Significant Exposure OR General Category (never both)</li>
          </ul>
        </section>

        {/* Photo Naming */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Photo Naming</h2>
          <p className="text-gray-700 mb-3">
            Photos are automatically renamed with descriptive filenames based on their content:
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded p-4">
            <p className="text-sm text-gray-700 mb-2"><strong>Example:</strong></p>
            <p className="text-sm text-gray-600">Original: IMG_1234.jpg</p>
            <p className="text-sm text-gray-600">Renamed: Telehandler-unstable-load-flat-tire.jpg</p>
          </div>
          <p className="text-gray-700 mt-3 text-sm">
            The AI analyzes each photo and generates an accurate, descriptive filename that matches the visual content.
          </p>
        </section>

        {/* Tips & Best Practices */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Tips & Best Practices</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
            <li>Take clear, well-lit photos that show the safety issue clearly</li>
            <li>Include visual context (location markers, equipment, materials)</li>
            <li>Group related photos together (multiple angles of same issue)</li>
            <li>Use numbered notes to provide contractor names, locations, and immediate actions</li>
            <li>Review AI-generated observations carefully before exporting</li>
            <li>Edit any fields that need correction in the review step</li>
            <li>Keep batches under 60 photos for optimal performance</li>
          </ul>
        </section>

        {/* Troubleshooting */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Troubleshooting</h2>

          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Processing takes too long</h3>
              <p className="text-sm text-gray-700">
                Reduce batch size to 20-30 photos, or split into multiple uploads.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Photos not matching notes</h3>
              <p className="text-sm text-gray-700">
                Ensure photos are uploaded in the same order as your numbered notes.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Wrong observation count</h3>
              <p className="text-sm text-gray-700">
                Check that each numbered note is on a separate line and properly formatted (e.g., "1. Description").
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-1">AI generated incorrect information</h3>
              <p className="text-sm text-gray-700">
                Use the review step to edit any incorrect fields. You can modify descriptions, categories, severity, etc.
              </p>
            </div>
          </div>
        </section>

        {/* Workflow Summary */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Complete Workflow</h2>
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
            <ol className="space-y-3">
              <li className="flex items-start">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold mr-3">1</span>
                <div>
                  <p className="font-semibold text-gray-900">Collect Photos</p>
                  <p className="text-sm text-gray-700">Take photos of safety observations in the field</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold mr-3">2</span>
                <div>
                  <p className="font-semibold text-gray-900">Write Notes (Optional)</p>
                  <p className="text-sm text-gray-700">Create numbered list with context, contractors, locations</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold mr-3">3</span>
                <div>
                  <p className="font-semibold text-gray-900">Upload & Process</p>
                  <p className="text-sm text-gray-700">Select project, upload photos, add notes, click Analyze</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold mr-3">4</span>
                <div>
                  <p className="font-semibold text-gray-900">Review AI Results</p>
                  <p className="text-sm text-gray-700">Check and edit AI-generated observations as needed</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold mr-3">5</span>
                <div>
                  <p className="font-semibold text-gray-900">Export & Upload</p>
                  <p className="text-sm text-gray-700">Download ZIP and upload CSV to Enablon/Compass</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-gray-200">
          <p className="text-center text-gray-600">
            <a href="/" className="text-blue-600 hover:text-blue-800 font-medium">
              ← Back to Application
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

import { PROJECTS } from '../constants/enums'
import type { Project } from '../constants/enums'

/**
 * Extract project code from notes text
 * Looks for project codes in various formats (GVX04, GVX-04, GVX 04, etc.)
 */
export function detectProjectFromNotes(notes: string): Project | null {
  const projects = detectAllProjectsFromNotes(notes)
  return projects.length > 0 ? projects[0] : null // Return first project found
}

/**
 * Extract all project codes from notes text
 * Returns array of all detected projects
 */
export function detectAllProjectsFromNotes(notes: string): Project[] {
  if (!notes) return []
  
  const foundProjects: Set<Project> = new Set()
  const upperNotes = notes.toUpperCase()
  
  // Look for exact project matches
  for (const project of PROJECTS) {
    const patterns = [
      new RegExp(`\\b${project}\\b`, 'i'),           // Exact match: GVX04
      new RegExp(`\\b${project.replace(/(\d)/, '-$1')}\\b`, 'i'),  // With dash: GVX-04
      new RegExp(`\\b${project.replace(/(\d)/, ' $1')}\\b`, 'i'),  // With space: GVX 04
      new RegExp(`\\bproject\\s+${project}\\b`, 'i'),             // "project GVX04"
      new RegExp(`\\b${project}\\s+project\\b`, 'i'),             // "GVX04 project"
    ]
    
    for (const pattern of patterns) {
      if (pattern.test(upperNotes)) {
        foundProjects.add(project)
        break // Stop checking patterns for this project once found
      }
    }
  }
  
  return Array.from(foundProjects)
}

/**
 * Split notes by project sections
 * Returns array of {project, notes} objects
 */
export function splitNotesByProject(notes: string): Array<{project: Project, notes: string}> {
  if (!notes) return []
  
  const allProjects = detectAllProjectsFromNotes(notes)
  if (allProjects.length <= 1) {
    // Single project or no project detected
    const project = allProjects[0]
    return project ? [{project, notes}] : []
  }
  
  // Multiple projects detected - try to split sections
  const sections: Array<{project: Project, notes: string}> = []
  const lines = notes.split('\n')
  let currentProject: Project | null = null
  let currentNotes: string[] = []
  
  for (const line of lines) {
    const lineProjects = detectAllProjectsFromNotes(line)
    
    if (lineProjects.length > 0) {
      // Found project mention in this line
      if (currentProject && currentNotes.length > 0) {
        // Save previous section
        sections.push({
          project: currentProject,
          notes: currentNotes.join('\n').trim()
        })
      }
      
      // Start new section
      currentProject = lineProjects[0] // Use first project if multiple in one line
      currentNotes = [line]
    } else if (currentProject) {
      // Continue current section
      currentNotes.push(line)
    }
  }
  
  // Save final section
  if (currentProject && currentNotes.length > 0) {
    sections.push({
      project: currentProject,
      notes: currentNotes.join('\n').trim()
    })
  }
  
  return sections
}

/**
 * Extract location information from notes
 * Looks for common location patterns like "COLO5", "loading bay", "electrical room"
 */
export function extractLocationFromNotes(notes: string): string[] {
  if (!notes) return []
  
  const locations: string[] = []
  const upperNotes = notes.toUpperCase()
  
  // Common location patterns
  const locationPatterns = [
    /\bCOLO\d+\b/gi,                    // COLO5, COLO3, etc.
    /\bLOADING\s+BAY\b/gi,             // Loading bay
    /\bELECTRICAL\s+ROOM\b/gi,         // Electrical room  
    /\bPARKING\s+AREA\b/gi,            // Parking area
    /\bENTRANCE\b/gi,                  // Entrance
    /\bEXIT\b/gi,                      // Exit
    /\bSTAIRWELL\b/gi,                 // Stairwell
    /\bROOFTOP\b/gi,                   // Rooftop
    /\bBASEMENT\b/gi,                  // Basement
    /\bLOBBY\b/gi,                     // Lobby
    /\bCORRIDOR\b/gi,                  // Corridor
    /\bWAREHOUSE\b/gi,                 // Warehouse
    /\bOFFICE\b/gi,                    // Office
    /\bCONFERENCE\s+ROOM\b/gi,         // Conference room
    /\bKITCHEN\b/gi,                   // Kitchen
    /\bRESTROOM\b/gi,                  // Restroom
    /\bFIRE\s+EXIT\b/gi,               // Fire exit
    /\bEMERGENCY\s+EXIT\b/gi,          // Emergency exit
    /\bSERVER\s+ROOM\b/gi,             // Server room
    /\bMECHANICAL\s+ROOM\b/gi,         // Mechanical room
    /\bSTORAGE\s+ROOM\b/gi,            // Storage room
    /\bWORK\s+AREA\b/gi,               // Work area
    /\bCONSTRUCTION\s+AREA\b/gi,       // Construction area
  ]
  
  for (const pattern of locationPatterns) {
    const matches = notes.match(pattern)
    if (matches) {
      locations.push(...matches.map(match => match.trim()))
    }
  }
  
  return [...new Set(locations)] // Remove duplicates
}
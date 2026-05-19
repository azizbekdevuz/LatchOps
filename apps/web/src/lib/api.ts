const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080'

// TypeScript interfaces for type safety
export interface AnalysisResult {
  status: string
  issue: string
  severity: string
  commands: Command[]
}

export interface Command {
  step: number
  command: string
  description: string
  safe: boolean
}

// Main function to send file to Spring Boot
export async function analyzeRepository(file: File): Promise<AnalysisResult> {
  try {
    // Read file content
    const text = await file.text()
    
    // Parse JSON
    const jsonData = JSON.parse(text)
    
    // Send to Spring Boot backend
    const response = await fetch(`${BACKEND_URL}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: file.name,
        data: jsonData,
      }),
    })

    // Check if request was successful
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Return the result
    const result: AnalysisResult = await response.json()
    return result
    
  } catch (error) {
    console.error('Error analyzing repository:', error)
    throw new Error('Failed to analyze repository. Please check if backend is running.')
  }
}

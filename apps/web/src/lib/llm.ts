/**
 * LLM provider stub - easy to swap for different providers.
 * Currently uses Claude via Anthropic API.
 */

export interface LLMResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    // Return mock response for demo/development
    console.warn('ANTHROPIC_API_KEY not set, using mock LLM response');
    return getMockResponse(prompt);
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM API error: ${error}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

/**
 * Call LLM with JSON output validation and auto-repair.
 */
export async function callLLMWithJSON<T>(
  prompt: string,
  validate: (data: unknown) => T,
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const fullPrompt = i === 0
        ? prompt
        : `${prompt}\n\nPrevious attempt failed with error: ${lastError?.message}\nPlease fix the JSON and try again.`;

      const response = await callLLM(fullPrompt);

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
      const jsonStr = jsonMatch[1]?.trim() || response.trim();

      const parsed = JSON.parse(jsonStr);
      return validate(parsed);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`Failed to get valid JSON after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Mock responses for development without API key.
 */
function getMockResponse(prompt: string): string {
  if (prompt.includes('classify')) {
    return JSON.stringify({
      primaryIssue: 'merge_conflict',
      secondaryIssues: [],
      estimatedRisk: 'medium',
    });
  }

  if (prompt.includes('plan') || prompt.includes('recovery')) {
    return JSON.stringify({
      version: 1,
      timestamp: new Date().toISOString(),
      issueType: 'merge_conflict',
      issueSummary: 'Repository has unresolved merge conflicts that need manual resolution.',
      risk: 'medium',
      steps: [
        {
          id: 'step-1',
          title: 'Review conflicting files',
          description: 'Examine the files with merge conflicts to understand what needs to be resolved.',
          commands: ['git status'],
          expected: 'You will see a list of files with conflicts marked as "both modified".',
          undo: {
            possible: true,
            commands: [],
            description: 'This is a read-only operation, no undo needed.',
          },
          dangerous: false,
          requiresUserInput: false,
        },
        {
          id: 'step-2',
          title: 'Open and resolve conflicts',
          description: 'Edit each conflicting file and resolve the conflicts by choosing or combining changes.',
          commands: ['# Edit files manually to resolve conflict markers'],
          expected: 'Files no longer contain <<<<<<, =======, or >>>>>>> markers.',
          undo: {
            possible: true,
            commands: ['git checkout --conflict=merge <file>'],
            description: 'Restore conflict markers to try resolution again.',
          },
          dangerous: false,
          requiresUserInput: true,
          userInputHint: 'Remove conflict markers and keep desired code.',
        },
        {
          id: 'step-3',
          title: 'Stage resolved files',
          description: 'Mark conflicts as resolved by staging the files.',
          commands: ['git add <resolved-files>'],
          expected: 'Files are staged and ready for commit.',
          undo: {
            possible: true,
            commands: ['git reset HEAD <file>'],
            description: 'Unstage files if you need to make more changes.',
          },
          dangerous: false,
          requiresUserInput: false,
        },
        {
          id: 'step-4',
          title: 'Complete the merge',
          description: 'Commit the resolved merge.',
          commands: ['git commit'],
          expected: 'Merge is complete and working directory is clean.',
          undo: {
            possible: true,
            commands: ['git reset --soft HEAD~1'],
            description: 'Undo the merge commit while keeping changes staged.',
          },
          dangerous: false,
          requiresUserInput: false,
        },
      ],
      reflogRecovery: {
        description: 'If something goes wrong, you can always return to your pre-merge state using reflog.',
        relevantEntries: ['HEAD@{1}'],
        recoveryCommand: 'git reset --hard HEAD@{1}',
      },
    });
  }

  if (prompt.includes('verify')) {
    return JSON.stringify({
      stepsCompleted: ['step-1'],
      issueResolved: false,
      remainingIssues: ['Conflicts still present'],
      nextStepId: 'step-2',
      guidance: 'Continue with step 2: resolve the conflict markers in the files.',
    });
  }

  return '{}';
}


import fs from 'fs';
import path from 'path';
import CopilotSdkAdapter from './agents/CopilotSdkAdapter';
import { ToolExecutionEvent } from './agents/types';

export async function runCopilotModelTest() {
  const logPath = path.resolve(process.cwd(), 'model-test-results-retry.txt');
  const log = (msg: string) => {
    console.log(msg);
    fs.appendFileSync(logPath, msg + '\n');
  };

  log('--- Starting Copilot Model Retry Test ---');
  log(`Time: ${new Date().toISOString()}`);

  const adapter = new CopilotSdkAdapter();
  
  try {
    const allModels = adapter.getAvailableModels();
    
    // Filter for only the models we want to re-test
    const targetModelIds = [
        'claude-sonnet-4.5',
        'claude-opus-4.5',
        'claude-haiku-4.5',
        'gemini-3-pro',
        'gpt-5',
        'gpt-5-mini'
    ];

    const models = allModels.filter(m => targetModelIds.includes(m.id));

    log(`Testing ${models.length} targeted models.`);

    // Ensure client is started
    try {
        await adapter.startClient();
        log('SDK Client started successfully.');
    } catch (e) {
        log(`CRITICAL: Failed to start SDK client. Error: ${e}`);
        return;
    }

    const projectPath = process.cwd();
    const mockOnToolEvent = (event: ToolExecutionEvent) => {};

    for (const model of models) {
      log(`\nTesting Model: ${model.id} (${model.name})...`);
      try {
        log(`Creating session for ${model.id}...`);
        
        // Increased timeout during session creation/testing
        const session = await adapter.createSession(projectPath, mockOnToolEvent, model.id);
        
        log(`Session created. Sending "hi"...`);
        
        // Increased timeout to 20s
        const response = await session.sendAndWait({ 
            prompt: 'hi',
        }, 20000); 

        log(`SUCCESS: Model ${model.id} responded.`);
        
        await session.destroy(); 

      } catch (error) {
        log(`FAILED: Model ${model.id} error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    log('\n--- Retry Test Completed ---');
    try {
        await adapter.stopClient();
    } catch (e) { log(`Error stopping client: ${e}`); }

  } catch (err) {
    log(`CRITICAL ERROR: ${err}`);
  }
}

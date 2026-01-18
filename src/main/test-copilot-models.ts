
import fs from 'fs';
import path from 'path';
import CopilotSdkAdapter from './agents/CopilotSdkAdapter';
import { ToolExecutionEvent } from './agents/types';

export async function runCopilotModelTest() {
  const logPath = path.resolve(process.cwd(), 'model-test-results.txt');
  const log = (msg: string) => {
    console.log(msg);
    fs.appendFileSync(logPath, msg + '\n');
  };

  log('--- Starting Copilot Model Test ---');
  log(`Time: ${new Date().toISOString()}`);

  const adapter = new CopilotSdkAdapter();
  
  try {
    const models = adapter.getAvailableModels();
    log(`Found ${models.length} models defined.`);

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
        const session = await adapter.createSession(projectPath, mockOnToolEvent, model.id);
        
        // Try to send a simple hello message
        // Note: The adapter doesn't expose a simple chat method easily without going through executeSdk,
        // but since we have the raw session, we can use session.sendAndWait().
        // SDK typings might be tricky, but let's try assuming standard SDK method.
        
        log(`Session created. Sending "hi"...`);
        
        const response = await session.sendAndWait({ 
            prompt: 'hi',
        }, 10000); // 10s timeout

        log(`SUCCESS: Model ${model.id} responded.`);
        // log(`Response: ${JSON.stringify(response)}`); // Optional, might be verbose

        await session.destroy(); // Cleanup

      } catch (error) {
        log(`FAILED: Model ${model.id} error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    log('\n--- Test Completed ---');
    try {
        await adapter.stopClient();
    } catch (e) { log(`Error stopping client: ${e}`); }

  } catch (err) {
    log(`CRITICAL ERROR: ${err}`);
  }
}

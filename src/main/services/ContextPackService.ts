// ===========================================
// ContextPackService (Desktop)
// ===========================================
// Generates context pack files locally using user's SOTA models.
// Writes files directly to project folder - no GitHub app required.

import * as fs from 'fs/promises';
import * as path from 'path';
import { IdeationService, IdeationSession, ContextPackPrompts, AgentConfigTemplate } from './IdeationService';

// ===========================================
// Types
// ===========================================

export interface GeneratedFile {
  path: string;
  content: string;
  type: 'context_pack' | 'agent_config';
}

export interface ContextPackResult {
  files: GeneratedFile[];
  projectPath: string;
  generatedAt: Date;
}

export interface ContextPackGenerationOptions {
  generateAgentConfigs?: boolean;
  agents?: ('cursor' | 'claude' | 'copilot' | 'windsurf')[];
  overwrite?: boolean;
}

// ===========================================
// ContextPackService
// ===========================================

export const ContextPackService = {
  /**
   * Generate context pack content using SOTA model
   * This creates the prompt and should be called with CopilotSdkAdapter
   */
  async buildContextPackPrompt(
    type: 'product' | 'tech_spec' | 'active_plan',
    ideationSummary: Record<string, unknown>,
    planContent?: string
  ): Promise<string> {
    // Fetch prompt template from server
    const prompts = await IdeationService.fetchContextPackPrompts();
    const promptTemplate = prompts[type];
    
    if (!promptTemplate) {
      throw new Error(`Unknown context pack type: ${type}`);
    }
    
    // Build the full prompt with context
    const fullPrompt = `${promptTemplate.prompt}

## Ideation Summary
${JSON.stringify(ideationSummary, null, 2)}

${planContent ? `## Generated Plan\n${planContent}` : ''}

Generate the file content now. Start directly with the content, no preamble.`;
    
    return fullPrompt;
  },

  /**
   * Get the file paths for context pack files
   */
  getContextPackPaths(projectPath: string): Record<string, string> {
    return {
      product: path.join(projectPath, 'docs', '@product.md'),
      tech_spec: path.join(projectPath, 'docs', '@tech-spec.md'),
      active_plan: path.join(projectPath, 'docs', '@active-plan.md'),
    };
  },

  /**
   * Write generated context pack files to local project folder
   */
  async writeContextPackFiles(
    projectPath: string,
    files: Array<{ type: string; content: string }>,
    options: ContextPackGenerationOptions = {}
  ): Promise<GeneratedFile[]> {
    const writtenFiles: GeneratedFile[] = [];
    const filePaths = this.getContextPackPaths(projectPath);
    
    // Ensure docs directory exists
    const docsDir = path.join(projectPath, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    
    for (const file of files) {
      const filePath = filePaths[file.type];
      if (!filePath) {
        console.warn(`Unknown file type: ${file.type}`);
        continue;
      }
      
      // Check if file exists and overwrite option
      try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (exists && !options.overwrite) {
          console.log(`⏭️ Skipping ${file.type} - file exists (use overwrite option)`);
          continue;
        }
      } catch {
        // File doesn't exist, safe to write
      }
      
      // Write the file
      await fs.writeFile(filePath, file.content, 'utf-8');
      console.log(`✅ Written: ${filePath}`);
      
      writtenFiles.push({
        path: filePath,
        content: file.content,
        type: 'context_pack',
      });
    }
    
    return writtenFiles;
  },

  /**
   * Generate and write agent config files
   */
  async writeAgentConfigs(
    projectPath: string,
    ideationSummary: Record<string, unknown>,
    agents: ('cursor' | 'claude' | 'copilot' | 'windsurf')[] = ['cursor', 'claude', 'copilot'],
    options: ContextPackGenerationOptions = {}
  ): Promise<GeneratedFile[]> {
    const writtenFiles: GeneratedFile[] = [];
    
    // Fetch templates from server
    const templates = await IdeationService.fetchAgentConfigTemplates();
    
    for (const agent of agents) {
      const template = templates[agent];
      if (!template) {
        console.warn(`No template found for agent: ${agent}`);
        continue;
      }
      
      const filePath = path.join(projectPath, template.path);
      
      // Check if file exists
      try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (exists && !options.overwrite) {
          console.log(`⏭️ Skipping ${agent} config - file exists`);
          continue;
        }
      } catch {
        // File doesn't exist
      }
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      
      // Personalize template with project info
      let content = template.template;
      if (ideationSummary.project_idea) {
        content = `# ${ideationSummary.project_idea}\n\n${content}`;
      }
      
      // Write the file
      await fs.writeFile(filePath, content, 'utf-8');
      console.log(`✅ Written agent config: ${filePath}`);
      
      writtenFiles.push({
        path: filePath,
        content,
        type: 'agent_config',
      });
    }
    
    return writtenFiles;
  },

  /**
   * Full context pack generation flow
   * Coordinates with CopilotSdkAdapter for SOTA model generation
   */
  async generateFullContextPack(
    projectPath: string,
    ideationSession: IdeationSession,
    planContent: string,
    generateFn: (prompt: string) => Promise<string>,
    options: ContextPackGenerationOptions = {}
  ): Promise<ContextPackResult> {
    console.log(`📦 Generating context pack for: ${projectPath}`);
    
    const ideationSummary = IdeationService.extractSummary(ideationSession);
    const allFiles: GeneratedFile[] = [];
    
    // Generate each context pack file
    const fileTypes: Array<'product' | 'tech_spec' | 'active_plan'> = ['product', 'tech_spec', 'active_plan'];
    
    for (const type of fileTypes) {
      console.log(`📝 Generating ${type}...`);
      
      // Build the prompt
      const prompt = await this.buildContextPackPrompt(type, ideationSummary, planContent);
      
      // Generate content using SOTA model (via callback)
      const content = await generateFn(prompt);
      
      // Write to disk
      const written = await this.writeContextPackFiles(projectPath, [{ type, content }], options);
      allFiles.push(...written);
    }
    
    // Generate agent configs if requested
    if (options.generateAgentConfigs !== false) {
      const agentConfigFiles = await this.writeAgentConfigs(
        projectPath,
        ideationSummary,
        options.agents || ['cursor', 'claude', 'copilot'],
        options
      );
      allFiles.push(...agentConfigFiles);
    }
    
    console.log(`✅ Context pack generated: ${allFiles.length} files`);
    
    return {
      files: allFiles,
      projectPath,
      generatedAt: new Date(),
    };
  },

  /**
   * Preview what files would be generated (no actual generation)
   */
  async previewContextPack(
    projectPath: string,
    options: ContextPackGenerationOptions = {}
  ): Promise<{ files: string[]; existingFiles: string[] }> {
    const filePaths = this.getContextPackPaths(projectPath);
    const agents = options.agents || ['cursor', 'claude', 'copilot'];
    
    const allPaths = Object.values(filePaths);
    
    // Add agent config paths
    const templates = await IdeationService.fetchAgentConfigTemplates();
    for (const agent of agents) {
      if (templates[agent]) {
        allPaths.push(path.join(projectPath, templates[agent].path));
      }
    }
    
    // Check which files already exist
    const existingFiles: string[] = [];
    for (const filePath of allPaths) {
      try {
        await fs.access(filePath);
        existingFiles.push(filePath);
      } catch {
        // Doesn't exist
      }
    }
    
    return {
      files: allPaths,
      existingFiles,
    };
  },
};

export default ContextPackService;

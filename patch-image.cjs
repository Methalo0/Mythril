const fs = require('fs');
const p = 'C:/Users/Perry/Documents/Mythril/apps/x/packages/core/src/runtime/tools/domains/image.ts';
let s = fs.readFileSync(p, 'utf8');

// 1. widen runImageGeneration prompt param
const sigOld = `async function runImageGeneration(
    backend: ImageBackend,
    modelId: string,
    prompt: string,`;
const sigNew = `async function runImageGeneration(
    backend: ImageBackend,
    modelId: string,
    prompt: string | { images: Uint8Array[]; text?: string },`;
if (!s.includes(sigOld)) throw new Error('sig not found');
s = s.replace(sigOld, sigNew);

// 2. tool schema: add imagePath before aspectRatio
const schemaAnchor = `            aspectRatio: z.string().optional().describe('Aspect ratio of the image as width:height`;
if (!s.includes(schemaAnchor)) throw new Error('schema anchor not found');
s = s.replace(schemaAnchor,
  `            imagePath: z.string().optional().describe('Absolute path to an existing image to edit or use as reference (editing models like flux-2 only). Omit for plain text-to-image.'),
` + schemaAnchor);

// 3. execute signature
const execOld = `            { prompt, filename, aspectRatio, model }: { prompt: string; filename?: string; aspectRatio?: string; model?: string },`;
const execNew = `            { prompt, filename, aspectRatio, model, imagePath }: { prompt: string; filename?: string; aspectRatio?: string; model?: string; imagePath?: string },`;
if (!s.includes(execOld)) throw new Error('exec sig not found');
s = s.replace(execOld, execNew);

// 4. build prompt payload with optional input image
const callOld = 'const { image, warnings } = await runImageGeneration(backend, modelId, prompt, aspect, signal);';
const callNew = `let inputImage: Uint8Array | null = null;
                if (imagePath) {
                    try {
                        inputImage = new Uint8Array(await fs.readFile(imagePath));
                    } catch {
                        return { success: false, error: 'Could not read image at ' + imagePath };
                    }
                }
                const promptPayload = inputImage ? { images: [inputImage], text: prompt } : prompt;
                const { image, warnings } = await runImageGeneration(backend, modelId, promptPayload, aspect, signal);`;
if (!s.includes(callOld)) throw new Error('call not found');
s = s.replace(callOld, callNew);

fs.writeFileSync(p, s);
console.log('done');

# TCS Quick Start

> Build a compiler in hours, not weeks.

## Prerequisites

- Node.js 18+
- pnpm
- Anthropic API key

## 1. Define Your Triangle (5 min)

Pick 3 representations of the same semantic content:

```
Example: Form Builder
├── Visual: Form UI mockup/description
├── Structured: JSON Schema
└── Compact: FormDSL
```

## 2. Write Initial Spec (15 min)

```markdown
# FormDSL Spec v0.1

## Syntax
form "name"
  ? field_id "Label" type [validation]
  ! message "text"
  -> next_field
end

## Types
Tx = text, Em = email, Ph = phone, Nm = number

## Example
form "contact"
  ? name "Your name" Tx [required]
  ? email "Email" Em [required]
  ! thanks "Thank you!"
end
```

## 3. Create Sample Generator (10 min)

```typescript
// tcs/generate.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function generateTriangle(prompt: string) {
  const [visual, structured, dsl] = await Promise.all([
    client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: `Describe this form visually: ${prompt}` }]
    }),
    client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: `Generate JSON Schema for: ${prompt}` }]
    }),
    client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You write FormDSL. Spec: [paste spec here]`,
      messages: [{ role: 'user', content: prompt }]
    }),
  ]);

  return { visual, structured, dsl };
}
```

## 4. Create Triangulator (10 min)

```typescript
// tcs/triangulate.ts
export async function triangulate(sample: Triangle) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Compare these 3 representations. Are they semantically equivalent?

VISUAL:
${sample.visual}

JSON SCHEMA:
${JSON.stringify(sample.structured, null, 2)}

DSL:
${sample.dsl}

Return JSON: { equivalent: boolean, disagreements: string[], specGaps: string[] }`
    }]
  });

  return JSON.parse(response.content[0].text);
}
```

## 5. Run TCS Loop (iterate)

```typescript
// tcs/iterate.ts
async function tcsIteration(spec: string, sampleCount = 10) {
  // Generate samples
  const prompts = await generatePrompts(sampleCount);
  const samples = await Promise.all(prompts.map(generateTriangle));

  // Triangulate
  const results = await Promise.all(samples.map(triangulate));

  // Collect findings
  const findings = results
    .filter(r => !r.equivalent)
    .flatMap(r => r.specGaps);

  // Evolve spec if needed
  if (findings.length > 0) {
    spec = await evolveSpec(spec, findings);
  }

  // Build/update compiler
  await buildCompiler(spec);

  // Test
  const testResults = await runTests(samples.filter((_, i) => results[i].equivalent));

  return { spec, passRate: testResults.passRate, findings };
}

// Main loop
let spec = readFileSync('spec.md', 'utf-8');
while (true) {
  const result = await tcsIteration(spec);
  spec = result.spec;

  if (result.passRate === 1 && result.findings.length === 0) {
    console.log('Converged!');
    break;
  }
}
```

## 6. Output

After convergence:

```
output/
├── spec-final.md      # Evolved specification
├── compiler/
│   ├── scanner.ts     # Tokenizer
│   ├── parser.ts      # AST builder
│   └── emitter.ts     # Code generator
└── tests/
    └── samples.json   # Validated test cases
```

## Tips

1. **Start small** - 5-10 samples per iteration
2. **Parallelize** - Generate/triangulate concurrently
3. **Trust disagreements** - They reveal real spec gaps
4. **Checkpoint often** - Save state every iteration
5. **Let it converge** - Don't manually fix, let TCS find issues

## Example Run

```bash
$ pnpm tcs:run --spec form-dsl.md --target 50

Iteration 1: 10 samples, 3 disagreements, 2 spec changes
Iteration 2: 10 samples, 1 disagreement, 1 spec change
Iteration 3: 10 samples, 0 disagreements, 0 spec changes
Iteration 4: 20 samples, 0 disagreements, 0 spec changes
✓ Converged at 50 samples, 4 iterations
```

## Quality Rules (Non-Negotiable)

1. **No bypassing** - Errors reveal spec gaps, don't suppress them
2. **No patches** - Generalize fixes, don't add special cases
3. **Production code** - Strict TypeScript, no TODOs, no debug code
4. **Redesign when stuck** - Bad architecture can't be patched

```typescript
// ❌ WRONG
try { parse(input) } catch { return null }  // Bypassing
if (sample === 'special') { ... }            // Isolated patch
const x: any = ...                            // Not production

// ✅ RIGHT
const result = parse(input)                   // Let it fail, fix root cause
handleAllCases(sample)                        // Generalized solution
const x: ParsedNode = ...                     // Strict types
```

## Next Steps

- Read [TCS-AI-METHODOLOGY.md](./TCS-AI-METHODOLOGY.md) for full theory
- Read [TCS-CLAUDE-CODE.md](./TCS-CLAUDE-CODE.md) for Claude Code execution
- Check [TCS-ROADMAP.md](./TCS-ROADMAP.md) for liquid package applications

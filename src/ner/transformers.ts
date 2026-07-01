import type { NerProvider, PIIEntity, PIIType } from '../types.js';
import { chunkText } from './chunk.js';

/**
 * Options for {@link TransformersNerProvider}.
 */
export interface TransformersNerOptions {
  /**
   * Hugging Face model id exporting an ONNX token-classification head.
   * Defaults to a CoNLL-2003 BERT NER model suitable for prototyping; swap to a
   * PII-fine-tuned DistilBERT once your eval justifies it.
   */
  model?: string;
  /** Use the int8-quantized weights (~30-65MB). Default true. */
  quantized?: boolean;
  /** 'webgpu' | 'wasm' | 'cpu'. Omit to let the runtime auto-select. */
  device?: string;
  /** Window size in characters for long-input chunking. */
  windowChars?: number;
  /** Overlap in characters between consecutive windows. */
  overlapChars?: number;
  /**
   * Injection seam for the underlying `pipeline` factory. Tests pass a fake;
   * production leaves it undefined and we dynamically import the peer dep.
   */
  pipelineFactory?: PipelineFactory;
}

/** Minimal shape of a Transformers.js token-classification result item. */
export interface TokenClassificationResult {
  entity_group?: string;
  entity?: string;
  score: number;
  word: string;
  start?: number;
  end?: number;
}

/** Callable token-classification pipeline. */
export type TokenClassificationPipeline = (
  text: string,
  options?: Record<string, unknown>,
) => Promise<TokenClassificationResult[]>;

/** Factory that builds a pipeline for a task/model — mirrors `pipeline`. */
export type PipelineFactory = (
  task: 'token-classification',
  model: string,
  options?: Record<string, unknown>,
) => Promise<TokenClassificationPipeline>;

const DEFAULT_MODEL = 'Xenova/bert-base-NER';

/** Map raw model labels (PER / ORG / LOC / MISC, with optional B-/I- prefix). */
function mapLabel(label: string | undefined): PIIType | null {
  if (!label) return null;
  const tag = label.replace(/^[BI]-/, '').toUpperCase();
  switch (tag) {
    case 'PER':
    case 'PERSON':
      return 'PERSON';
    case 'ORG':
      return 'ORG';
    case 'LOC':
    case 'GPE':
    case 'LOCATION':
      return 'LOCATION';
    case 'MISC':
      return 'MISC';
    default:
      return null;
  }
}

/**
 * Contextual NER provider backed by Transformers.js + ONNX Runtime Web.
 *
 * Runs a token-classification model in the browser (WebGPU with WASM fallback),
 * chunks long inputs with a sliding window, and returns character-offset spans
 * for PERSON / ORG / LOCATION. The heavy peer dependency is loaded lazily on
 * first use, so importing this module has no cost until you call `detect`.
 */
export class TransformersNerProvider implements NerProvider {
  private readonly opts: Required<
    Omit<TransformersNerOptions, 'device' | 'pipelineFactory'>
  > &
    Pick<TransformersNerOptions, 'device' | 'pipelineFactory'>;
  private pipe: Promise<TokenClassificationPipeline> | null = null;

  constructor(options: TransformersNerOptions = {}) {
    this.opts = {
      model: options.model ?? DEFAULT_MODEL,
      quantized: options.quantized ?? true,
      windowChars: options.windowChars ?? 1600,
      overlapChars: options.overlapChars ?? 200,
      device: options.device,
      pipelineFactory: options.pipelineFactory,
    };
  }

  /** Lazily build (and cache) the pipeline. */
  private getPipeline(): Promise<TokenClassificationPipeline> {
    if (this.pipe) return this.pipe;
    this.pipe = this.buildPipeline();
    return this.pipe;
  }

  private async buildPipeline(): Promise<TokenClassificationPipeline> {
    const factory = this.opts.pipelineFactory ?? (await loadPipelineFactory());
    const built: Record<string, unknown> = {
      dtype: this.opts.quantized ? 'q8' : 'fp32',
    };
    if (this.opts.device) built.device = this.opts.device;
    return factory('token-classification', this.opts.model, built);
  }

  async detect(text: string): Promise<PIIEntity[]> {
    if (!text) return [];
    const pipe = await this.getPipeline();
    const chunks = chunkText(text, this.opts.windowChars, this.opts.overlapChars);
    const entities: PIIEntity[] = [];

    for (const chunk of chunks) {
      const results = await pipe(chunk.text, {
        // Merge sub-word tokens into whole-entity spans.
        aggregation_strategy: 'simple',
      });
      for (const r of results) {
        const type = mapLabel(r.entity_group ?? r.entity);
        if (type === null) continue;
        if (r.start == null || r.end == null || r.end <= r.start) continue;
        entities.push({
          type,
          start: chunk.offset + r.start,
          end: chunk.offset + r.end,
          text: text.slice(chunk.offset + r.start, chunk.offset + r.end),
          source: 'ner',
          confidence: r.score,
        });
      }
    }
    return entities;
  }
}

/** Dynamically import the optional peer dependency. */
async function loadPipelineFactory(): Promise<PipelineFactory> {
  try {
    // Indirect specifier so the optional peer dep isn't statically resolved at
    // build time; it only needs to exist at runtime if the NER layer is used.
    const specifier = '@huggingface/transformers';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      pipeline: PipelineFactory;
    };
    return mod.pipeline;
  } catch {
    throw new Error(
      "The NER layer requires the optional peer dependency '@huggingface/transformers'. " +
        'Install it (npm i @huggingface/transformers) or pass a `pipelineFactory`.',
    );
  }
}

/** Convenience factory. */
export function createTransformersNer(
  options?: TransformersNerOptions,
): TransformersNerProvider {
  return new TransformersNerProvider(options);
}

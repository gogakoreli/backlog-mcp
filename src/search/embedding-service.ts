import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Local embedding service using transformers.js.
 * Generates 384-dimensional vectors for semantic search.
 */
export class EmbeddingService {
  private embedder: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the embedding model (lazy, called on first use).
   * Downloads model on first run (~23MB, cached in ~/.cache/huggingface).
   */
  async init(): Promise<void> {
    if (this.embedder) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.embedder = await pipeline('feature-extraction', MODEL_ID, {
        dtype: 'fp32',
      });
    })();

    return this.initPromise;
  }

  /**
   * Generate embedding vector for text.
   * @returns 384-dimensional normalized vector
   */
  async embed(text: string): Promise<number[]> {
    if (!this.embedder) {
      await this.init();
    }

    const output = await this.embedder!(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Output is a Tensor, convert to array
    return Array.from(output.data as Float32Array);
  }

  /**
   * Check if the service is ready (model loaded).
   */
  isReady(): boolean {
    return this.embedder !== null;
  }
}
